/**
 * 页面内定时提醒。
 *
 * 原理：标签页保持打开时，用 1 秒一次的轮询检查是否到点，到点走系统通知。
 * Chrome 对后台标签的定时器会节流到每分钟一次，所以这里不用一次性 setTimeout，
 * 而是每次比对绝对时间戳——即使被节流，最多晚一分钟，不会错过。
 *
 * 状态存在 localStorage，刷新或第二天重新打开都能恢复。
 */

const STORE_KEY = 'standup.reminder.v1';
const TITLE_BASE = '不许坐着 · 关不掉的运动闹钟';

const LINES = [
  ['起来动一下', '30 秒，就差你了。'],
  ['时间到了', '坐着够久了，站起来动一动。'],
  ['你还在坐？', '身体不动，这个闹钟不会自己停。'],
  ['闹钟响了', '离开椅子，30 秒就好。'],
  ['该起身了', '腰和颈椎都在等你。']
];

function makeIcon() {
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, 192, 192);

  ctx.strokeStyle = '#3bffc1';
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.arc(96, 46, 21, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(96, 70);
  ctx.lineTo(96, 126);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(52, 90);
  ctx.lineTo(140, 90);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(96, 126);
  ctx.lineTo(64, 170);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(96, 126);
  ctx.lineTo(128, 170);
  ctx.stroke();

  return c.toDataURL('image/png');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export class Reminder {
  constructor({ onFire, onActivate, onTick } = {}) {
    this.onFire = onFire || (() => {});
    this.onActivate = onActivate || (() => {});
    this.onTick = onTick || (() => {});
    this.state = { on: false, interval: 60, nextAt: 0 };
    this.timer = null;
    this.icon = null;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return;
      this.state.on = !!s.on;
      this.state.interval = Math.min(240, Math.max(5, Number(s.interval) || 60));
      this.state.nextAt = Number(s.nextAt) || 0;
    } catch (_) {}
  }

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state));
    } catch (_) {}
  }

  get supported() {
    return typeof window.Notification !== 'undefined';
  }

  get permission() {
    return this.supported ? Notification.permission : 'unsupported';
  }

  get remainMs() {
    if (!this.state.on) return 0;
    return Math.max(0, this.state.nextAt - Date.now());
  }

  /** 必须在用户手势里调用，否则浏览器不给权限 */
  async enable(intervalMinutes) {
    if (!this.supported) return { ok: false, reason: 'unsupported' };

    let perm = this.permission;
    if (perm === 'default') {
      try {
        perm = await Notification.requestPermission();
      } catch (_) {
        perm = 'denied';
      }
    }
    if (perm !== 'granted') return { ok: false, reason: 'denied' };

    this.state.on = true;
    this.state.interval = intervalMinutes;
    this.state.nextAt = Date.now() + intervalMinutes * 60000;
    this.save();
    this.start();
    return { ok: true, nextAt: this.state.nextAt };
  }

  disable() {
    this.state.on = false;
    this.state.nextAt = 0;
    this.save();
    this.stop();
    document.title = TITLE_BASE;
  }

  start() {
    this.stop();
    if (!this.state.on) return;

    // 隔了很久再打开：重新计时，而不是立刻炸一次
    if (this.state.nextAt <= Date.now()) {
      this.state.nextAt = Date.now() + this.state.interval * 60000;
      this.save();
    }

    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    if (!this.state.on) return;

    if (Date.now() >= this.state.nextAt) {
      this.fire();
      this.state.nextAt = Date.now() + this.state.interval * 60000;
      this.save();
    }
    this.updateTitle();
    try {
      this.onTick();
    } catch (_) {}
  }

  fire() {
    this.notify();
    try {
      this.onFire();
    } catch (_) {}
  }

  notify() {
    if (this.permission !== 'granted') return;

    if (!this.icon) this.icon = makeIcon();

    const [title, body] = LINES[Math.floor(Math.random() * LINES.length)];

    try {
      const n = new Notification(title, {
        body,
        icon: this.icon,
        badge: this.icon,
        tag: 'standup-reminder',
        requireInteraction: true,
        silent: false
      });

      n.onclick = () => {
        window.focus();
        n.close();
        try {
          this.onActivate();
        } catch (_) {}
      };
    } catch (_) {
      // 某些环境（如移动端部分浏览器）不允许直接构造，忽略即可，页面内提示仍会显示
    }
  }

  updateTitle() {
    if (!this.state.on) return;
    const ms = this.remainMs;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    document.title = `(${m}:${pad(s)}) 不许坐着`;
  }

  /** 给界面用的可读倒计时 */
  remainText() {
    const ms = this.remainMs;
    if (ms <= 0) return '即将提醒';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m} 分 ${pad(s)} 秒后提醒`;
  }

  nextTimeText() {
    if (!this.state.nextAt) return '';
    const d = new Date(this.state.nextAt);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
