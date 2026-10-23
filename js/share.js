/**
 * 生成一张竖版成绩卡片，用于保存或直接分享到社交平台。
 */

import { pickStreakLine, pickSessionLine } from './lines.js';

const W = 1080;
const H = 1440;

function setFont(ctx, size, weight = 400, family = 'PingFang SC') {
  ctx.font = `${weight} ${size}px "${family}", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`;
}

function drawSpaced(ctx, text, x, y, spacing) {
  // 手动字距，兼容不支持 letterSpacing 的环境
  if (typeof ctx.letterSpacing === 'string') {
    ctx.letterSpacing = spacing + 'px';
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
    return;
  }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

export function makeShareCard({ seconds, intensity, jumps, title, dateStr }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 背景
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#070b11');
  bg.addColorStop(0.55, '#05070a');
  bg.addColorStop(1, '#030507');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 底部青色光晕
  const glow = ctx.createRadialGradient(W * 0.5, H * 1.08, 40, W * 0.5, H * 1.08, 780);
  glow.addColorStop(0, 'rgba(59, 255, 193, 0.20)');
  glow.addColorStop(0.45, 'rgba(59, 255, 193, 0.055)');
  glow.addColorStop(1, 'rgba(59, 255, 193, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // 右上角光环
  ctx.save();
  ctx.strokeStyle = 'rgba(59, 255, 193, 0.16)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(W - 60, 40, 300 + i * 78, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // 顶部标识
  ctx.fillStyle = 'rgba(59, 255, 193, 0.92)';
  setFont(ctx, 27, 500);
  drawSpaced(ctx, '起身', 96, 138, 10);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
  setFont(ctx, 22, 400);
  drawSpaced(ctx, 'STAND UP · 单次', 96, 180, 4);

  // 大数字
  ctx.fillStyle = '#f4fffb';
  setFont(ctx, 232, 200);
  ctx.fillText(seconds, 88, 610);

  // 单位
  ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
  setFont(ctx, 30, 300);
  drawSpaced(ctx, '秒 · 有效运动', 96, 678, 3);

  // 标题
  ctx.fillStyle = '#3bffc1';
  setFont(ctx, 46, 500);
  ctx.fillText(title, 96, 790);

  // 分隔线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(96, 858);
  ctx.lineTo(W - 96, 858);
  ctx.stroke();

  // 数据
  const rows = [
    ['平均强度', intensity],
    ['约等于开合跳', jumps + ' 个']
  ];

  let ry = 950;
  for (const [label, value] of rows) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
    setFont(ctx, 27, 300);
    drawSpaced(ctx, label, 96, ry, 2);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
    setFont(ctx, 34, 400);
    ctx.textAlign = 'right';
    ctx.fillText(value, W - 96, ry);
    ctx.textAlign = 'left';

    ry += 92;
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.beginPath();
  ctx.moveTo(96, 1092);
  ctx.lineTo(W - 96, 1092);
  ctx.stroke();

  // 底部标语
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  setFont(ctx, 38, 300);
  const sessionLine = pickSessionLine((parseFloat(intensity) || 0) / 100);
  drawSpaced(ctx, sessionLine, 96, 1200, 2);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.30)';
  setFont(ctx, 24, 300);
  drawSpaced(ctx, dateStr, 96, 1258, 2);

  // 右下角标记
  ctx.fillStyle = 'rgba(59, 255, 193, 0.55)';
  ctx.beginPath();
  ctx.arc(W - 118, 1240, 9, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

/* ---------------- 个人记录分享卡 ---------------- */

function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHeatStrip(ctx, store, centerX, topY) {
  const CELL = 16;
  const GAP = 5;
  const WEEKS = 26;
  const totalW = WEEKS * CELL + (WEEKS - 1) * GAP;
  const x0 = centerX - totalW / 2;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());

  const start = new Date(weekStart);
  start.setDate(weekStart.getDate() - (WEEKS - 1) * 7);

  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      if (date > today) continue;

      const rec = store.log.days[key(date)];
      const count = rec?.sessions?.length || 0;

      let color;
      if (count >= 5) color = 'rgba(59,255,193,0.92)';
      else if (count >= 3) color = 'rgba(59,255,193,0.46)';
      else if (count >= 1) color = 'rgba(59,255,193,0.19)';
      else color = 'rgba(255,255,255,0.062)';

      ctx.save();
      if (count >= 5) {
        ctx.shadowColor = 'rgba(59,255,193,0.55)';
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = color;
      roundRect(ctx, x0 + w * (CELL + GAP), topY + d * (CELL + GAP), CELL, CELL, 3.5);
      ctx.fill();
      ctx.restore();
    }
  }
}

export function makeProfileCard(store, stats, dateStr) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#070b11');
  bg.addColorStop(0.55, '#05070a');
  bg.addColorStop(1, '#030507');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.5, H * 1.06, 40, W * 0.5, H * 1.06, 800);
  glow.addColorStop(0, 'rgba(59, 255, 193, 0.18)');
  glow.addColorStop(0.45, 'rgba(59, 255, 193, 0.05)');
  glow.addColorStop(1, 'rgba(59, 255, 193, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.strokeStyle = 'rgba(59, 255, 193, 0.14)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(W - 60, 40, 300 + i * 78, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = 'rgba(59, 255, 193, 0.92)';
  setFont(ctx, 27, 500);
  drawSpaced(ctx, '起身', 96, 138, 10);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
  setFont(ctx, 22, 400);
  drawSpaced(ctx, 'STAND UP · 我的记录', 96, 180, 4);

  // 主角：连续天数
  ctx.fillStyle = '#f4fffb';
  setFont(ctx, 196, 200);
  ctx.fillText(String(stats.streak), 88, 500);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
  setFont(ctx, 30, 300);
  drawSpaced(ctx, '天连续运动', 96, 566, 3);

  // 半年热力图
  drawHeatStrip(ctx, store, W / 2, 648);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(96, 848);
  ctx.lineTo(W - 96, 848);
  ctx.stroke();

  const hours = stats.totalSec / 3600;
  const rows = [
    ['累计运动', stats.totalSessions + ' 次'],
    ['累计时长', hours < 1 ? Math.round(stats.totalSec / 60) + ' 分钟' : hours.toFixed(1) + ' 小时']
  ];

  let ry = 930;
  for (const [label, value] of rows) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
    setFont(ctx, 27, 300);
    drawSpaced(ctx, label, 96, ry, 2);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
    setFont(ctx, 34, 400);
    ctx.textAlign = 'right';
    ctx.fillText(value, W - 96, ry);
    ctx.textAlign = 'left';

    ry += 92;
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.beginPath();
  ctx.moveTo(96, 1072);
  ctx.lineTo(W - 96, 1072);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  setFont(ctx, 38, 300);
  drawSpaced(ctx, pickStreakLine(stats.streak), 96, 1180, 2);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.30)';
  setFont(ctx, 24, 300);
  drawSpaced(ctx, dateStr, 96, 1240, 2);

  ctx.fillStyle = 'rgba(59, 255, 193, 0.55)';
  ctx.beginPath();
  ctx.arc(W - 118, 1222, 9, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

