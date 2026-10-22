import { Skeleton } from './skeleton.js';
import { Tracker } from './tracker.js';
import { Sfx } from './audio.js';
import { makeShareCard, makeProfileCard, downloadOrShare } from './share.js';
import { Reminder } from './reminder.js';
import { Store } from './store.js';
import { renderProfile, exportJSON } from './profile.js';

const $ = (id) => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has('debug');

const el = {
  intro: $('intro'),
  stage: $('stage'),
  result: $('result'),

  ledeSec: $('lede-sec'),
  chips: Array.from(document.querySelectorAll('.chip')),
  btnStart: $('btn-start'),

  viewport: $('viewport'),
  video: $('video'),
  videoBg: $('video-bg'),
  overlay: $('overlay'),

  timer: $('timer'),
  meterFill: $('meter-fill'),
  meterText: $('meter-text'),
  meterPct: $('meter-pct'),
  coach: $('coach'),

  edgeAlarm: $('edge-alarm'),
  alarmWord: $('alarm-word'),

  btnQuit: $('btn-quit'),
  quitFill: document.querySelector('#btn-quit .fill'),

  boot: $('boot'),
  bootText: $('boot-text'),

  resultEyebrow: $('result-eyebrow'),
  resultTitle: $('result-title'),
  resultSub: $('result-sub'),
  statTime: $('stat-time'),
  statInt: $('stat-int'),
  statJump: $('stat-jump'),
  btnAgain: $('btn-again'),
  btnShare: $('btn-share'),
  btnHome: $('btn-home'),

  fatal: $('fatal'),
  fatalTitle: $('fatal-title'),
  fatalText: $('fatal-text'),
  btnRetry: $('btn-retry'),
  toast: $('toast'),

  fab: $('btn-profile'),
  profile: $('profile'),
  btnProfileClose: $('btn-profile-close'),
  pStreak: $('p-streak'),
  pWeek: $('p-week'),
  pTotal: $('p-total'),
  pSkips: $('p-skips'),
  heatmap: $('heatmap'),
  heatmapMonths: $('heatmap-months'),
  recent: $('recent'),
  btnShareProfile: $('btn-share-profile'),
  btnImport: $('btn-import-json'),
  importFile: $('import-file'),
  btnExportJson: $('btn-export-json'),
  btnClearData: $('btn-clear-data'),
  reminderSkip: $('reminder-skip'),

  reminderCard: $('reminder-card'),
  reminderSwitch: $('reminder-switch'),
  reminderIntervals: $('reminder-intervals'),
  reminderCountdown: $('reminder-countdown'),
  reminderSub: $('reminder-sub'),
  reminderOff: $('reminder-off'),
  reminderToast: $('reminder-toast'),
  reminderGo: $('reminder-go'),
  reminderSnooze: $('reminder-snooze')
};

const store = new Store();
const skeleton = new Skeleton(el.overlay);
const tracker = new Tracker();
const sfx = new Sfx();

const state = {
  screen: 'intro',
  duration: store.config.duration || 30,
  elapsed: 0,
  moved: 0,
  intensitySum: 0,
  idle: 0,
  beat: 0,
  running: false,
  startedAt: 0,
  everDetected: false,
  fsTimer: null,
  lastResult: null,
  sharing: false,
  stream: null,
  warned: false,
  hiddenAt: 0,
  frames: 0,
  fpsTime: 0,
  fps: 0,
  lastCoach: '',
  reminderInterval: 60,
  challengeSource: 'manual'
};

/* ---------------- 运动闹钟 ---------------- */

const reminder = new Reminder({
  config: store.config,
  onChange: () => store.saveConfig(),
  onFire: () => {
    if (state.running) return; // 正在挑战就别打扰
    sfx.warn();
    showReminderToast();
  },
  onActivate: () => {
    hideReminderToast();
    if (state.screen !== 'stage') {
      goFullscreen();
      startChallenge('reminder');
    }
  },
  onTick: () => {
    if (reminder.on) {
      el.reminderCountdown.textContent = reminder.remainText();
    }
  }
});

/* ---------------- 轻提示 ---------------- */

let toastTimer = null;

function toast(msg) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
}

function showReminderToast() {
  if (!el.reminderToast) return;
  el.reminderToast.classList.add('show');
}

function hideReminderToast() {
  if (!el.reminderToast) return;
  el.reminderToast.classList.remove('show');
}

function renderReminder() {
  const on = reminder.on;
  el.reminderCard.classList.toggle('on', on);
  el.reminderSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
  el.reminderSub.textContent = on
    ? `每 ${reminder.interval} 分钟提醒一次`
    : '每隔一段时间提醒你起身，标签页开着就行';
}

const COACH = {
  noPerson: '站到镜头前',
  noLower: '退后一点，让腿也进画面',
  feetOut: '脚出画面了，再退一步',
  tooClose: '太近了，退后让全身进画面',
  sitting: '站起来，坐着不算',
  idle: '停下不算数，继续动',
  low: '幅度再大一点',
  good: '很好，就这样',
  great: '这个节奏，保持住'
};

const RESULT_LINES = {
  high: [
    ['你动了。', '这几十秒里，你的身体是真的在动，不是坐在椅子上点头。'],
    ['身体醒了。', '强度够、持续够，这一组是实打实的。'],
    ['这才是起身。', '不是伸个懒腰就算，是把整副骨架都用上了。']
  ],
  mid: [
    ['动了，但不够狠。', '计时走完了，不过强度还有空间，下次把幅度拉开。'],
    ['勉强算过关。', '身体确实动了，但离"舒展"还差一点。'],
    ['及格的一次。', '至少没坐着，这已经比大部分人强。']
  ],
  low: [
    ['算你动了。', '强度很低，这更像是在原地晃。下次认真一点。'],
    ['这也能过。', '看得出来你很想坐下，但好歹是站起来了。'],
    ['低空掠过。', '差一点就不能算数了，下一次别这么敷衍。']
  ]
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ---------------- 屏幕切换 ---------------- */

function showScreen(name) {
  state.screen = name;
  el.intro.classList.toggle('active', name === 'intro');
  el.stage.classList.toggle('active', name === 'stage');
  el.result.classList.toggle('active', name === 'result');
  el.profile.classList.toggle('active', name === 'profile');

  // 挑战中和个人中心里都藏起入口，避免误触
  el.fab.classList.toggle('hidden', name === 'stage' || name === 'profile');
}

/* ---------------- 全屏 ---------------- */

function goFullscreen() {
  const el2 = document.documentElement;
  if (document.fullscreenElement) return;
  const fn = el2.requestFullscreen || el2.webkitRequestFullscreen;
  if (fn) {
    try {
      const p = fn.call(el2);
      if (p && p.catch) p.catch(() => {});
    } catch (_) {}
  }
}

function exitFullscreen() {
  if (!document.fullscreenElement) return;
  try {
    const p = document.exitFullscreen();
    if (p && p.catch) p.catch(() => {});
  } catch (_) {}
}

/* ---------------- 摄像头 ---------------- */

async function openCamera() {
  if (!window.isSecureContext) {
    throw Object.assign(new Error('insecure'), { code: 'insecure' });
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 960 },
      height: { ideal: 540 },
      frameRate: { ideal: 30, max: 30 }
    }
  });

  state.stream = stream;
  el.video.srcObject = stream;
  el.videoBg.srcObject = stream;

  await el.video.play().catch(() => {});
  await el.videoBg.play().catch(() => {});

  skeleton.setVideoSize(el.video.videoWidth, el.video.videoHeight);
  resizeCanvas();
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  el.video.srcObject = null;
  el.videoBg.srcObject = null;
}

/* ---------------- 画布尺寸 ---------------- */

function resizeCanvas() {
  const r = el.viewport.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  skeleton.setVideoSize(el.video.videoWidth, el.video.videoHeight);
  skeleton.resize(r.width, r.height, dpr);
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeCanvas, 120);
});

/* ---------------- 每帧回调 ---------------- */

function onFrame(d) {
  if (state.screen !== 'stage') return;

  const dt = d.dt || 0;
  const t = performance.now() / 1000;

  skeleton.draw(d.landmarks, d.intensity, t);

  // 帧率统计
  state.frames++;
  if (t - state.fpsTime > 1) {
    state.fps = Math.round(state.frames / (t - state.fpsTime));
    state.frames = 0;
    state.fpsTime = t;
  }

  if (!state.running) return;

  if (d.detected && d.postureOk) state.everDetected = true;

  const active = d.active;

  if (active) {
    state.idle = 0;
    state.moved += dt;
    state.intensitySum += d.intensity * dt;
    state.elapsed = Math.min(state.duration, state.elapsed + dt);
  } else {
    state.idle += dt;
    // 停太久会倒退，倒逼你真的动
    if (state.idle > 3.5) {
      state.elapsed = Math.max(0, state.elapsed - dt * 0.45);
    }
  }

  updateHud(d, active, dt);

  if (state.elapsed >= state.duration - 0.001) {
    finish();
  }
}

/* ---------------- HUD ---------------- */

function updateHud(d, active, dt) {
  const remain = Math.max(0, state.duration - state.elapsed);
  el.timer.textContent = remain.toFixed(1);

  const pct = Math.round(d.intensity * 100);
  el.meterFill.style.width = Math.min(100, d.intensity * 100) + '%';
  el.meterPct.textContent = pct + '%';

  const cold = d.intensity < 0.15;
  el.timer.classList.toggle('warn', cold && state.running && state.idle > 1.2);

  // 教练文案
  let text;
  let cls = '';

  if (!d.detected) {
    text = COACH.noPerson;
    cls = 'off';
  } else if (!d.postureOk) {
    text = COACH[d.posture.reason] || COACH.noLower;
    cls = 'off';
  } else if (state.idle > 1.2) {
    text = COACH.idle;
    cls = 'off';
  } else if (d.intensity > 0.55) {
    text = COACH.great;
    cls = 'hot';
  } else if (d.intensity > 0.24) {
    text = COACH.good;
    cls = 'hot';
  } else {
    text = COACH.low;
  }

  if (text !== state.lastCoach) {
    el.coach.textContent = text;
    state.lastCoach = text;
  }
  el.coach.classList.toggle('hot', cls === 'hot');
  el.coach.classList.toggle('off', cls === 'off');

  el.meterText.textContent = DEBUG
    ? `m ${d.motion.toFixed(2)} / 需 ${d.trigger.toFixed(2)}`
    : !d.detected
      ? '未检测到人体'
      : !d.postureOk
        ? '需要全身入镜'
        : active
          ? '运动中'
          : '静止';

  // 告警
  const sinceStart = (performance.now() - state.startedAt) / 1000;
  const grace = state.everDetected ? 2.4 : 9.0;
  const alarm = state.running && sinceStart > grace &&
    (!d.detected ? state.idle > 1.8 : state.idle > 1.4);
  if (alarm !== state.warned) {
    state.warned = alarm;
    el.edgeAlarm.classList.toggle('on', alarm);
    el.alarmWord.classList.toggle('on', alarm);
    if (alarm) {
      el.alarmWord.textContent = !d.detected
        ? '看不到你'
        : !d.postureOk
          ? (d.posture.reason === 'sitting' ? '站起来' : '退后一点')
          : '继续动！';
      sfx.warn();
    }
  }

  // 节拍
  if (active) {
    state.beat += dt;
    if (state.beat > 0.62) {
      state.beat = 0;
      sfx.tick(1 + d.intensity * 0.35);
    }
  }
}

/* ---------------- 挑战流程 ---------------- */

async function startChallenge(source = 'manual') {
  state.challengeSource = source;
  state.elapsed = 0;
  state.moved = 0;
  state.intensitySum = 0;
  state.idle = 0;
  state.beat = 0;
  state.warned = false;
  state.running = false;
  state.everDetected = false;
  state.lastCoach = '';

  el.timer.textContent = state.duration.toFixed(1);
  el.meterFill.style.width = '0%';
  el.meterPct.textContent = '0%';
  el.meterText.textContent = '等待动作';
  el.edgeAlarm.classList.remove('on');
  el.alarmWord.classList.remove('on');
  el.coach.textContent = COACH.noPerson;
  el.coach.className = 'coach';

  showScreen('stage');
  el.boot.classList.remove('hide');
  el.bootText.textContent = '正在请求摄像头…';

  try {
    await openCamera();
  } catch (e) {
    onCameraError(e);
    return;
  }

  el.bootText.textContent = '正在唤醒识别引擎…';

  try {
    await tracker.init(onFrame);
  } catch (e) {
    console.error(e);
    showFatal('识别引擎没起来', '页面资源可能没有加载完整，刷新一次再试。');
    return;
  }

  el.bootText.textContent = '退后一步，让全身进入画面';
  await new Promise((r) => setTimeout(r, 900));

  el.boot.classList.add('hide');
  state.running = true;
  state.startedAt = performance.now();
  state.fpsTime = performance.now() / 1000;
  state.frames = 0;

  sfx.go();
  loop();
}

function loop() {
  if (state.screen !== 'stage') return;
  tracker.send(el.video);
  requestAnimationFrame(loop);
}

/* ---------------- 结束 ---------------- */

function finish() {
  if (!state.running) return;
  state.running = false;

  const moved = state.moved;
  const avg = moved > 0 ? state.intensitySum / moved : 0;
  const jumps = Math.round(moved * (0.35 + avg * 1.15));

  const tier = avg > 0.50 ? 'high' : avg > 0.26 ? 'mid' : 'low';
  const [title, sub] = pick(RESULT_LINES[tier]);

  el.resultEyebrow.textContent = `${state.duration} 秒挑战完成`;
  el.resultTitle.textContent = title;
  el.resultSub.textContent = sub;
  el.statTime.textContent = moved.toFixed(1);
  el.statInt.textContent = Math.round(avg * 100) + '%';
  el.statJump.textContent = String(jumps);

  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  state.lastResult = {
    seconds: moved.toFixed(1),
    intensity: Math.round(avg * 100) + '%',
    jumps: String(jumps),
    title: title.replace(/。$/, ''),
    dateStr: `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
  };

  store.addSession({
    seconds: moved,
    intensity: avg,
    src: state.challengeSource
  });

  sfx.win();
  el.edgeAlarm.classList.remove('on');
  el.alarmWord.classList.remove('on');

  setTimeout(() => {
    stopCamera();
    exitFullscreen();
    showScreen('result');
  }, 420);
}

function doQuit() {
  state.running = false;
  stopCamera();
  exitFullscreen();
  sfx.denied();
  showScreen('intro');
}

/* ---------------- 错误 ---------------- */

function onCameraError(e) {
  const name = e && e.name;

  if (e && e.code === 'insecure') {
    showFatal('这里打不开摄像头', '浏览器只在 HTTPS 或 localhost 下允许访问摄像头。请用 https 地址打开这个页面。');
    return;
  }
  if (e && e.code === 'unsupported') {
    showFatal('浏览器不支持', '这个浏览器没有提供摄像头接口，换 Chrome、Edge 或 Safari 试试。');
    return;
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    showFatal('摄像头被拒绝了', '需要摄像头权限才能判断你有没有在动。点击地址栏左侧的图标，允许摄像头后重试。');
    return;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    showFatal('没找到摄像头', '这台设备上没有可用的摄像头。');
    return;
  }
  if (name === 'NotReadableError') {
    showFatal('摄像头被占用了', '别的程序正在使用它，关掉再试。');
    return;
  }

  showFatal('打不开摄像头', '未知错误：' + (name || 'unknown'));
}

function showFatal(title, text) {
  el.fatalTitle.textContent = title;
  el.fatalText.textContent = text;
  el.fatal.classList.add('on');
  state.running = false;
  stopCamera();
}

/* ---------------- 事件绑定 ---------------- */

el.chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    el.chips.forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.duration = Number(chip.dataset.duration);
    el.ledeSec.textContent = state.duration;
    store.config.duration = state.duration;
    store.saveConfig();
  });
});

el.btnStart.addEventListener('click', () => {
  goFullscreen();
  sfx.init();
  startChallenge();
});

el.btnRetry.addEventListener('click', () => {
  el.fatal.classList.remove('on');
  showScreen('intro');
});

el.btnAgain.addEventListener('click', () => {
  goFullscreen();
  startChallenge();
});

el.btnHome.addEventListener('click', () => {
  showScreen('intro');
});

el.btnShare.addEventListener('click', async () => {
  if (!state.lastResult || state.sharing) return;

  state.sharing = true;
  const btn = el.btnShare;
  const label = btn.querySelector('span') || btn;
  const original = label.textContent;

  btn.disabled = true;
  label.textContent = '正在生成…';

  let text = '已保存';
  try {
    const canvas = makeShareCard(state.lastResult);
    const stamp = state.lastResult.dateStr.replace(/\./g, '');
    const r = await downloadOrShare(canvas, `不许坐着-${stamp}.png`);
    if (r === 'cancelled') text = '已取消';
    else if (r === 'failed') text = '生成失败';
  } catch (e) {
    text = '保存失败';
    console.warn('share failed', e);
  }

  label.textContent = text;
  setTimeout(() => {
    label.textContent = original;
    btn.disabled = false;
    state.sharing = false;
  }, 1500);
});

// 长按退出
let holdRaf = null;
let holdStart = 0;

function endHold() {
  if (holdRaf) cancelAnimationFrame(holdRaf);
  holdRaf = null;
  if (el.quitFill) el.quitFill.style.width = '0%';
}

el.btnQuit.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  holdStart = performance.now();

  const step = () => {
    const p = Math.min(1, (performance.now() - holdStart) / 1400);
    if (el.quitFill) el.quitFill.style.width = p * 100 + '%';
    if (p >= 1) {
      endHold();
      doQuit();
      return;
    }
    holdRaf = requestAnimationFrame(step);
  };
  holdRaf = requestAnimationFrame(step);
});

['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
  el.btnQuit.addEventListener(ev, endHold);
});

// 挑战期间强制保持全屏：按 ESC 退出会自动回到全屏
function onFullscreenChange() {
  if (state.running && !document.fullscreenElement && !document.webkitFullscreenElement) {
    clearTimeout(state.fsTimer);
    state.fsTimer = setTimeout(() => {
      if (state.running) goFullscreen();
    }, 800);
  }
}

document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

// 切走标签页的惩罚
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    state.hiddenAt = performance.now();
  } else if (state.hiddenAt && state.running) {
    const away = (performance.now() - state.hiddenAt) / 1000;
    state.hiddenAt = 0;
    if (away > 2) {
      state.elapsed = Math.max(0, state.elapsed - Math.min(5, away * 0.6));
      sfx.warn();
    }
  }
});

// 页面关闭前的确认（只有挑战中才有）
window.addEventListener('beforeunload', (e) => {
  if (state.running) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ---------------- 运动闹钟交互 ---------------- */

// 把上次保存的配置回填到界面，避免每次都要重设
el.chips.forEach((c) => c.classList.toggle('active', Number(c.dataset.duration) === state.duration));
el.ledeSec.textContent = state.duration;

state.reminderInterval = reminder.interval;
el.reminderIntervals.querySelectorAll('.chip').forEach((c) => {
  c.classList.toggle('active', Number(c.dataset.min) === reminder.interval);
});

el.reminderIntervals.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  el.reminderIntervals.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  btn.classList.add('active');
  state.reminderInterval = Number(btn.dataset.min) || 60;
});

el.reminderSwitch.addEventListener('click', async () => {
  if (reminder.on) {
    reminder.disable();
    renderReminder();
    toast('运动闹钟已关闭');
    return;
  }

  const r = await reminder.enable(state.reminderInterval);
  if (!r.ok) {
    if (r.reason === 'denied') toast('通知权限被拒绝，没法提醒你');
    else if (r.reason === 'unsupported') toast('这个浏览器不支持系统通知');
    else toast('开启失败，换个浏览器试试');
    return;
  }

  sfx.init();
  renderReminder();
  toast('已开启，别关这个标签页');
});

el.reminderOff.addEventListener('click', () => {
  reminder.disable();
  renderReminder();
  toast('运动闹钟已关闭');
});

el.reminderGo.addEventListener('click', () => {
  hideReminderToast();
  goFullscreen();
  startChallenge('reminder');
});

el.reminderSkip.addEventListener('click', () => {
  hideReminderToast();
  store.addSkip('skip');
  toast('已跳过这一轮');
});

el.reminderSnooze.addEventListener('click', () => {
  hideReminderToast();
  store.addSkip('snooze');
  reminder.snooze();
  toast('5 分钟后提醒你');
});

// 首次点击页面时初始化音频，否则到点没声音
document.addEventListener('pointerdown', function once() {
  sfx.init();
  document.removeEventListener('pointerdown', once);
}, { once: true });

/* ---------------- 个人中心 ---------------- */

function openProfile() {
  renderProfile(store, {
    streak: el.pStreak,
    week: el.pWeek,
    total: el.pTotal,
    skips: el.pSkips,
    heatmap: el.heatmap,
    heatmapMonths: el.heatmapMonths,
    recent: el.recent
  });
  showScreen('profile');
}

el.fab.addEventListener('click', openProfile);
el.btnProfileClose.addEventListener('click', () => showScreen('intro'));

el.btnShareProfile.addEventListener('click', async () => {
  if (state.sharing) return;

  state.sharing = true;
  const btn = el.btnShareProfile;
  const label = btn.querySelector('span') || btn;
  const original = label.textContent;
  btn.disabled = true;
  label.textContent = '正在生成…';

  let text = '已保存';
  try {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())}`;
    const canvas = makeProfileCard(store, store.stats(), dateStr);
    const r = await downloadOrShare(canvas, `不许坐着-我的记录-${dateStr.replace(/\./g, '')}.png`);
    if (r === 'cancelled') text = '已取消';
    else if (r === 'failed') text = '生成失败';
  } catch (e) {
    text = '生成失败';
    console.warn('share profile failed', e);
  }

  label.textContent = text;
  setTimeout(() => {
    label.textContent = original;
    btn.disabled = false;
    state.sharing = false;
  }, 1500);
});

el.btnImport.addEventListener('click', () => el.importFile.click());

el.importFile.addEventListener('change', async () => {
  const file = el.importFile.files && el.importFile.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const r = store.importJSON(text);

    if (!r.ok) {
      toast(r.reason === 'parse' ? '文件内容不是有效的 JSON' : '这不是本应用的备份文件');
      return;
    }

    openProfile();
    toast(r.addedSessions > 0 ? `已恢复 ${r.addedSessions} 条记录` : '没有新记录，数据已经是最全的');
  } catch (e) {
    toast('导入失败，换个文件试试');
  } finally {
    el.importFile.value = '';
  }
});

el.btnExportJson.addEventListener('click', () => {
  exportJSON(store);
  toast('已导出备份');
});

let clearArmed = false;
let clearTimer = null;

el.btnClearData.addEventListener('click', () => {
  const label = el.btnClearData.querySelector('span') || el.btnClearData;

  if (!clearArmed) {
    clearArmed = true;
    label.textContent = '再点一次确认';
    clearTimer = setTimeout(() => {
      clearArmed = false;
      label.textContent = '清空记录';
    }, 3200);
    return;
  }

  clearTimeout(clearTimer);
  clearArmed = false;
  label.textContent = '清空记录';
  store.clearAll();
  openProfile();
  toast('记录已清空');
});

// 恢复上次的闹钟状态
renderReminder();
if (reminder.on) reminder.start();

// 初始画布尺寸
resizeCanvas();
