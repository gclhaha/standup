/**
 * 火柴人渲染：把 MediaPipe 的 33 个关键点画成一条发光的骨架。
 */

const BONES = [
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 23], [12, 24],
  [23, 24],
  [23, 25], [25, 27],
  [24, 26], [26, 28]
];

const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export class Skeleton {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.videoW = 1280;
    this.videoH = 720;
  }

  resize(cssW, cssH, dpr) {
    this.w = cssW;
    this.h = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setVideoSize(w, h) {
    if (w > 0 && h > 0) {
      this.videoW = w;
      this.videoH = h;
    }
  }

  /** 归一化坐标 -> 屏幕坐标（object-fit: contain + 水平镜像） */
  project(lm) {
    const vw = this.videoW;
    const vh = this.videoH;
    const scale = Math.min(this.w / vw, this.h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const ox = (this.w - dw) / 2;
    const oy = (this.h - dh) / 2;
    const x = ox + lm.x * dw;
    const y = oy + lm.y * dh;
    return [this.w - x, y];
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  /**
   * @param {Array} landmarks 归一化关键点
   * @param {number} intensity 0..1 运动强度
   * @param {number} t 时间（秒），用于呼吸动画
   */
  draw(landmarks, intensity, t) {
    const ctx = this.ctx;
    this.clear();
    if (!landmarks) return;

    const pts = landmarks.map((lm) => this.project(lm));

    // 强度决定色相：青绿(160) -> 琥珀(42) -> 赤红(2)
    // 开方后低强度也能看出颜色变化，否则收紧阈值后骨架会一直是青的
    const vivid = Math.pow(Math.min(1, Math.max(0, intensity)), 0.55);
    const hue = 160 - vivid * 158;
    const base = `hsl(${hue}, 100%, 62%)`;
    const glow = `hsla(${hue}, 100%, 55%, 0.22)`;
    const core = `hsla(${hue}, 100%, 86%, 1)`;

    const unit = Math.max(1.6, Math.min(this.w, this.h) * 0.0035);
    const pulse = 1 + 0.06 * Math.sin(t * 5.2);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. 外层光晕
    ctx.strokeStyle = glow;
    ctx.lineWidth = unit * 7 * pulse;
    this.strokeBones(pts);
    ctx.stroke();

    // 2. 主体
    ctx.strokeStyle = base;
    ctx.lineWidth = unit * 2.6 * pulse;
    ctx.globalAlpha = 0.85;
    this.strokeBones(pts);
    ctx.stroke();

    // 3. 内芯
    ctx.strokeStyle = core;
    ctx.lineWidth = unit * 0.9;
    ctx.globalAlpha = 1;
    this.strokeBones(pts);
    ctx.stroke();

    // 关节
    for (const i of JOINTS) {
      const lm = landmarks[i];
      if (!lm || (lm.visibility !== undefined && lm.visibility < 0.4)) continue;
      const [x, y] = pts[i];
      ctx.beginPath();
      ctx.fillStyle = glow;
      ctx.arc(x, y, unit * 4.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = core;
      ctx.arc(x, y, unit * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 头
    const nose = landmarks[0];
    const ls = landmarks[11];
    const rs = landmarks[12];
    if (nose && ls && rs && nose.visibility > 0.4) {
      const [nx, ny] = pts[0];
      const [sx1, sy1] = pts[11];
      const [sx2, sy2] = pts[12];
      const shoulderW = Math.hypot(sx2 - sx1, sy2 - sy1);
      const r = Math.max(unit * 6, shoulderW * 0.30);

      ctx.beginPath();
      ctx.strokeStyle = glow;
      ctx.lineWidth = unit * 6;
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = base;
      ctx.lineWidth = unit * 2.4;
      ctx.globalAlpha = 0.9;
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = core;
      ctx.lineWidth = unit * 0.9;
      ctx.globalAlpha = 1;
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  strokeBones(pts) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      const pa = pts[a];
      const pb = pts[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
    }
  }
}
