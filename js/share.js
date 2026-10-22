/**
 * 生成一张竖版成绩卡片，用于保存或直接分享到社交平台。
 */

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
  drawSpaced(ctx, '不许坐着', 96, 138, 7);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
  setFont(ctx, 22, 400);
  drawSpaced(ctx, 'STAND UP · 1024', 96, 180, 4);

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
  drawSpaced(ctx, '身体不动，闹钟不停。', 96, 1200, 3);

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

export async function downloadOrShare(canvas, filename) {
  // 优先走系统分享面板。注意：用户取消分享时不能再降级成下载，
  // 否则会出现"点了没反应，回头发现多出一张图"的情况。
  if (typeof navigator.canShare === 'function' && typeof navigator.share === 'function') {
    try {
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (blob) {
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: '不许坐着' });
          return 'shared';
        }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // 其他错误才降级到下载
    }
  }

  // 降级：用 Blob URL 下载，比超长 data URL 更稳
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return 'failed';

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = filename;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return 'downloaded';
}
