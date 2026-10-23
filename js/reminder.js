/**
 * 页面内定时提醒。
 *
 * 原理：标签页保持打开时，用 1 秒一次的轮询检查是否到点，到点走系统通知。
 * Chrome 对后台标签的定时器会节流到每分钟一次，所以这里不用一次性 setTimeout，
 * 而是每次比对绝对时间戳——即使被节流，最多晚一分钟，不会错过。
 *
 * 配置由外部注入（Store.config），这里只负责计时和发通知。
 */

const TITLE_BASE = '起身 · 坐久了，起来动一动';

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
  /**
   * @param {object} opts
   * @param {object} opts.config    Store.config 的引用，直接读写
   * @param {Function} opts.onChange 配置变化时回调（用于落盘）
   */
  constructor({ config, onChange, onFire, onActivate, onTick } = {}) {
    this.cfg = config || { interval: 60, reminderOn: false, nextAt: 0 };
    this.onChange = onChange || (() => {});
    this.onFire = onFire || (() => {});
    this.onActivate = onActivate || (() => {});
    this.onTick = onTick || (() => {});
    this.timer = null;
    this.icon = null;
  }

  get on() {
    return !!this.cfg.reminderOn;
  }

  get interval() {
    return this.cfg.interval || 60;
  }

  get supported() {
    return typeof window.Notification !== 'undefined';
  }

  get permission() {
    return this.supported ? Notification.permission : 'unsupported';
  }

  get remainMs() {
    if (!this.on) return 0;
    return Math.max(0, (this.cfg.nextAt || 0) - Date.now());
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

    this.cfg.reminderOn = true;
    this.cfg.interval = intervalMinutes;
    this.cfg.nextAt = Date.now() + intervalMinutes * 60000;
    this.onChange();
    this.start();
    return { ok: true, nextAt: this.cfg.nextAt };
  }

  disable() {
    this.cfg.reminderOn = false;
    this.cfg.nextAt = 0;
    this.onChange();
    this.stop();
    document.title = TITLE_BASE;
  }

  /** 顺延，不算放弃 */
  snooze(ms = 5 * 60000) {
    this.cfg.nextAt = Date.now() + ms;
    this.onChange();
    this.updateTitle();
  }

  /** 今天都不再提醒，明早（或下次手动开启）恢复 */
  dismissToday() {
    const end = new Date();
    end.setHours(23, 59, 59, 0);
    this.cfg.nextAt = end.getTime() + 1000;
    this.onChange();
    this.updateTitle();
  }

  setIntervalMinutes(min) {
    this.cfg.interval = min;
    if (this.on) {
      this.cfg.nextAt = Date.now() + min * 60000;
    }
    this.onChange();
    this.updateTitle();
  }

  start() {
    this.stop();
    if (!this.on) return;

    // 隔了很久再打开：重新计时，而不是立刻炸一次
    if (!this.cfg.nextAt || this.cfg.nextAt <= Date.now()) {
      this.cfg.nextAt = Date.now() + this.interval * 60000;
      this.onChange();
    }

    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    if (!this.on) return;

    if (Date.now() >= this.cfg.nextAt) {
      this.fire();
      this.cfg.nextAt = Date.now() + this.interval * 60000;
      this.onChange();
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
      // 部分环境不允许直接构造通知，忽略即可，页面内浮层仍会出现
    }
  }

  updateTitle() {
    if (!this.on) {
      document.title = TITLE_BASE;
      return;
    }
    const ms = this.remainMs;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    document.title = `(${m}:${pad(s)}) 起身`;
  }

  remainText() {
    const ms = this.remainMs;
    if (ms <= 0) return '即将提醒';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m} 分 ${pad(s)} 秒后提醒`;
  }

  nextTimeText() {
    if (!this.cfg.nextAt) return '';
    const d = new Date(this.cfg.nextAt);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
