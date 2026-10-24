/**
 * 本地数据层。
 *
 * 配置和记录都存在 localStorage：一条记录约 70 字节，按每天 8 次算，
 * 一年 3000 条约 200KB，localStorage 的 5MB 能撑二十多年，不需要 IndexedDB。
 *
 * 写入策略：配置立即落盘；记录走 300ms 防抖，避免频繁 IO。
 */

const KEY_CONFIG = 'standup.config.v1';
const KEY_LOG = 'standup.log.v1';
const KEY_LEGACY = 'standup.reminder.v1';

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 本地时区的 YYYY-MM-DD，不能用 toISOString（那是 UTC，会跨天） */
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeText(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class Store {
  constructor() {
    this.config = {
      duration: 30,
      interval: 60,
      reminderOn: false,
      nextAt: 0,
      display: 'stage',
      theme: 'mint'
    };
    this.log = { v: 1, days: {} };
    this._timer = null;
    this.load();
  }

  /* ---------------- 读写 ---------------- */

  load() {
    try {
      const c = JSON.parse(localStorage.getItem(KEY_CONFIG) || 'null');
      if (c && typeof c === 'object') {
        if (typeof c.duration === 'number') this.config.duration = c.duration;
        if (typeof c.interval === 'number') this.config.interval = c.interval;
        if (typeof c.reminderOn === 'boolean') this.config.reminderOn = c.reminderOn;
        if (typeof c.nextAt === 'number') this.config.nextAt = c.nextAt;
        if (c.display === 'stage' || c.display === 'real') this.config.display = c.display;
        if (typeof c.theme === 'string') this.config.theme = c.theme;
      }
    } catch (_) {}

    try {
      const l = JSON.parse(localStorage.getItem(KEY_LOG) || 'null');
      if (l && l.days && typeof l.days === 'object') this.log = l;
    } catch (_) {}

    // 从早先只存闹钟状态的版本迁移
    try {
      const old = JSON.parse(localStorage.getItem(KEY_LEGACY) || 'null');
      if (old && old.on) {
        this.config.interval = Number(old.interval) || 60;
        this.config.reminderOn = true;
        this.config.nextAt = Number(old.nextAt) || 0;
        this.saveConfig();
        localStorage.removeItem(KEY_LEGACY);
      }
    } catch (_) {}
  }

  saveConfig() {
    try {
      localStorage.setItem(KEY_CONFIG, JSON.stringify(this.config));
    } catch (_) {}
  }

  /** 记录写入防抖，避免一次运动结束连写多次 */
  saveLog() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      try {
        localStorage.setItem(KEY_LOG, JSON.stringify(this.log));
      } catch (e) {
        // 配额满了：至少别让页面崩，调用方负责提示用户导出
        console.warn('存储空间不足', e);
      }
    }, 300);
  }

  flush() {
    clearTimeout(this._timer);
    try {
      localStorage.setItem(KEY_LOG, JSON.stringify(this.log));
    } catch (_) {}
  }

  /* ---------------- 写入 ---------------- */

  _day(at) {
    const k = dayKey(new Date(at));
    const d = this.log.days[k] || (this.log.days[k] = { sessions: [], skips: [] });
    if (!Array.isArray(d.sessions)) d.sessions = [];
    if (!Array.isArray(d.skips)) d.skips = [];
    return d;
  }

  /**
   * 记一次完成的运动
   * @param {number} seconds 有效运动秒数
   * @param {number} intensity 0..1 平均强度
   * @param {string} src 'reminder' | 'manual'
   */
  addSession({ seconds, intensity, jumps, src = 'manual', at = Date.now() }) {
    const d = this._day(at);
    d.sessions.push({
      t: at,
      d: Math.round(seconds * 10) / 10,
      i: Math.round(intensity * 100) / 100,
      j: Math.round(Number(jumps) || 0),
      src
    });
    this.saveLog();
  }

  /** 按时间戳找一条记录，找不到返回 null */
  findSession(t) {
    for (const k of Object.keys(this.log.days)) {
      const s = (this.log.days[k].sessions || []).find((x) => x.t === t);
      if (s) return { day: k, session: s };
    }
    return null;
  }

  /** 旧数据没有存开合跳，按同一套公式补算 */
  static jumpsOf(session) {
    if (typeof session.j === 'number' && session.j > 0) return session.j;
    return Math.round((session.d || 0) * (0.35 + (session.i || 0) * 1.15));
  }

  /** kind: 'skip' 放弃本次 / 'snooze' 顺延 / 'today' 今天不再提醒 */
  addSkip(kind = 'skip', at = Date.now()) {
    const d = this._day(at);
    d.skips.push({ t: at, kind });
    this.saveLog();
  }

  /* ---------------- 查询 ---------------- */

  hasSession(key) {
    const d = this.log.days[key];
    return !!(d && d.sessions && d.sessions.length);
  }

  /** 连续打卡天数；今天还没动的话从昨天往前数，给用户当天机会 */
  streak() {
    const today = new Date();
    let cursor = new Date(today);

    if (!this.hasSession(dayKey(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }

    let n = 0;
    // 上限保护，避免脏数据导致死循环
    for (let i = 0; i < 4000; i++) {
      if (!this.hasSession(dayKey(cursor))) break;
      n++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return n;
  }

  /** 近 N 天，按时间从旧到新 */
  recentDays(n = 30) {
    const out = [];
    const base = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const k = dayKey(d);
      const rec = this.log.days[k];
      out.push({
        key: k,
        date: d,
        count: rec?.sessions?.length || 0,
        skips: rec?.skips?.length || 0
      });
    }
    return out;
  }

  /** 最近 N 条运动记录，新的在前 */
  recentSessions(n = 20) {
    const out = [];
    const keys = Object.keys(this.log.days).sort().reverse();

    for (const k of keys) {
      const list = (this.log.days[k].sessions || []).slice().reverse();
      for (const s of list) {
        out.push({ ...s, day: k });
        if (out.length >= n) return out;
      }
    }
    return out;
  }

  stats() {
    const days = this.log.days;
    const keys = Object.keys(days);

    let totalSec = 0;
    let totalSessions = 0;
    let totalSkips = 0;
    let activeDays = 0;

    for (const k of keys) {
      const d = days[k];
      const ss = d.sessions || [];
      const ks = d.skips || [];
      if (ss.length) activeDays++;
      totalSkips += ks.length;
      for (const s of ss) {
        totalSec += s.d || 0;
        totalSessions++;
      }
    }

    let weekSessions = 0;
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const rec = days[dayKey(d)];
      weekSessions += rec?.sessions?.length || 0;
    }

    return {
      streak: this.streak(),
      totalSessions,
      totalSkips,
      totalSec,
      weekSessions,
      activeDays
    };
  }

  /* ---------------- 导出 ---------------- */

  toCSV() {
    const rows = [['日期', '时间', '时长(秒)', '平均强度', '来源']];
    const keys = Object.keys(this.log.days).sort();

    for (const k of keys) {
      const list = (this.log.days[k].sessions || []).slice().sort((a, b) => a.t - b.t);
      for (const s of list) {
        const d = new Date(s.t);
        rows.push([
          k,
          `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
          s.d,
          Math.round((s.i || 0) * 100) + '%',
          s.src === 'reminder' ? '提醒触发' : '手动开始'
        ]);
      }
    }

    // BOM 让 Excel 正确识别 UTF-8
    return '\ufeff' + rows.map((r) => r.join(',')).join('\r\n');
  }

  toJSON() {
    return JSON.stringify(
      {
        app: 'stand-up',
        version: 1,
        exportedAt: new Date().toISOString(),
        config: this.config,
        log: this.log
      },
      null,
      2
    );
  }

  /**
   * 从备份文件恢复。按时间戳去重合并，不覆盖当前已有的记录，
   * 这样重复导入同一份文件也不会产生重复数据。
   */
  importJSON(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { ok: false, reason: 'parse' };
    }

    if (!data || typeof data !== 'object' || !data.log || !data.log.days) {
      return { ok: false, reason: 'format' };
    }
    if (typeof data.log.days !== 'object') {
      return { ok: false, reason: 'format' };
    }

    let addedSessions = 0;
    let touchedDays = 0;

    for (const [key, day] of Object.entries(data.log.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      if (!day || typeof day !== 'object') continue;

      const target = this.log.days[key] || (this.log.days[key] = { sessions: [], skips: [] });
      if (!Array.isArray(target.sessions)) target.sessions = [];
      if (!Array.isArray(target.skips)) target.skips = [];

      const seenT = new Set(target.sessions.map((s) => s.t));
      const list = Array.isArray(day.sessions) ? day.sessions : [];

      for (const s of list) {
        if (!s || typeof s.t !== 'number' || !isFinite(s.t)) continue;
        if (seenT.has(s.t)) continue;
        target.sessions.push({
          t: s.t,
          d: Number(s.d) || 0,
          i: Number(s.i) || 0,
          src: s.src === 'reminder' ? 'reminder' : 'manual'
        });
        seenT.add(s.t);
        addedSessions++;
      }

      const seenK = new Set(target.skips.map((s) => s.t));
      const skips = Array.isArray(day.skips) ? day.skips : [];

      for (const k of skips) {
        if (!k || typeof k.t !== 'number' || !isFinite(k.t)) continue;
        if (seenK.has(k.t)) continue;
        target.skips.push({ t: k.t, kind: k.kind || 'skip' });
        seenK.add(k.t);
      }

      if (target.sessions.length) touchedDays++;
    }

    for (const k of Object.keys(this.log.days)) {
      const d = this.log.days[k];
      if (Array.isArray(d.sessions)) d.sessions.sort((a, b) => a.t - b.t);
      if (Array.isArray(d.skips)) d.skips.sort((a, b) => a.t - b.t);
    }

    this.flush();
    return { ok: true, addedSessions, touchedDays };
  }

  clearAll() {
    this.log = { v: 1, days: {} };
    this.flush();
  }
}
