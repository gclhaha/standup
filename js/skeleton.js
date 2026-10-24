/**
 * 火柴人渲染。
 *
 * 两种风格：
 *   neon（默认）霓虹形体 + 拖影 + 粒子 + 脚下涟漪，重点表达“动得多猛”
 *   line         最初的纯线稿，地址栏加 ?style=line 可切回
 *
 * 关键点全部来自 MediaPipe，不画人脸、不画五官、不显示摄像头。
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

// 会喷粒子的关节：手腕与脚踝，动作幅度最大
const EMITTERS = [15, 16, 27, 28];

function pickStyle() {
  try {
    const v = new URLSearchParams(location.search).get('style');
    if (v === 'line') return 'line';
  } catch (_) {}
  return 'neon';
}

export class Skeleton {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.videoW = 1280;
    this.videoH = 720;
    this.style = pickStyle();

    this.trail = [];        // 拖影：最近几帧的点
    this.particles = [];
    this.ripples = [];
    this.prevPts = null;
    this.lastT = 0;
    this.lastRipple = 0;
    this.energy = 0;
    this.poseHue = 160;
    this.poseSwing = 158;
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

  /** 主题色相：静止时的基准色 + 强度拉满时的偏移量 */
  setPose(hue, swing) {
    this.poseHue = Number.isFinite(hue) ? hue : 160;
    this.poseSwing = Number.isFinite(swing) ? swing : 158;
  }

  hueOf(intensity) {
    const i = Math.min(1, Math.max(0, intensity || 0));
    return ((this.poseHue - i * this.poseSwing) % 360 + 360) % 360;
  }

  /** 切换绘制风格：neon 霓虹形体 / line 纯线稿 */
  setStyle(style) {
    const next = style === 'line' ? 'line' : 'neon';
    if (next === this.style) return;
    this.style = next;
    this.trail = [];
    this.particles = [];
    this.ripples = [];
    this.prevPts = null;
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
   * @param {number} t 时间（秒）
   */
  draw(landmarks, intensity, t) {
    const dt = this.lastT ? Math.min(0.12, Math.max(0.001, t - this.lastT)) : 0.016;
    this.lastT = t;
    this.energy += (intensity - this.energy) * Math.min(1, dt * 6);

    if (this.style === 'line') {
      this.clear();
      if (landmarks) this.drawLine(landmarks, intensity, t);
      return;
    }

    this.clear();
    this.updateEffects(dt);

    const hue = this.hueOf(intensity);
    const unit = Math.max(1.7, Math.min(this.w, this.h) * 0.0038);

    if (!landmarks) {
      this.trail = [];
      this.prevPts = null;
      this.drawRipples(hue);
      this.drawEffects(hue);
      return;
    }

    const pts = landmarks.map((lm) => this.project(lm));

    // 拖影：保留最近 8 帧，最新的在最后
    this.trail.push({ pts, intensity, t });
    if (this.trail.length > 8) this.trail.shift();

    this.emitFromJoints(pts, landmarks, dt, intensity);
    this.maybeRipple(pts, landmarks, intensity, t, unit);

    this.drawRipples(hue);
    this.drawTrails(unit);
    this.drawBody(pts, landmarks, hue, unit, t);
    this.drawEffects(hue);

    this.prevPts = pts;
  }

  /* ---------------- 形体 ---------------- */

  drawBody(pts, landmarks, hue, unit, t) {
    const ctx = this.ctx;
    const base = `hsl(${hue}, 100%, 64%)`;
    const core = `hsla(${hue}, 100%, 88%, 1)`;
    const pulse = 1 + 0.05 * Math.sin(t * 4.6);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. 胶囊身体：半透明填充 + 外发光，让“骨架”变成“形体”
    ctx.save();
    ctx.shadowColor = `hsla(${hue}, 100%, 60%, 0.55)`;
    // 小屏上关掉阴影发光，阴影是这一版最贵的绘制操作
    ctx.shadowBlur = this.w < 700 ? 0 : unit * 4.2;
    ctx.fillStyle = `hsla(${hue}, 100%, 66%, 0.10)`;
    ctx.strokeStyle = `hsla(${hue}, 100%, 66%, 0.42)`;
    ctx.lineWidth = unit * 0.7;

    const torsoW = this.boneWidth(pts, 11, 12, unit);
    for (const [a, b] of BONES) {
      if (!this.visible(landmarks, a, b)) continue;
      const w = this.limbWidth(a, b, unit, torsoW);
      this.capsule(pts[a], pts[b], w * pulse);
    }

    // 颈：头不应该悬空在肩膀上方
    if (landmarks[0] && (landmarks[0].visibility ?? 1) > 0.4 && this.visible(landmarks, 11, 12)) {
      const cx = (pts[11][0] + pts[12][0]) / 2;
      const cy = (pts[11][1] + pts[12][1]) / 2;
      const r = Math.max(unit * 6, torsoW * 0.30);
      const ty = pts[0][1] + r * 0.8;
      if (cy - ty > 2) this.capsule([cx, cy], [pts[0][0], ty], unit * 3);
    }

    // 躯干：肩与髋围成的半透明块
    if (this.visible(landmarks, 11, 12) && this.visible(landmarks, 23, 24)) {
      const [sx1, sy1] = pts[11];
      const [sx2, sy2] = pts[12];
      const [hx1, hy1] = pts[23];
      const [hx2, hy2] = pts[24];
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.lineTo(hx2, hy2);
      ctx.lineTo(hx1, hy1);
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue}, 100%, 66%, 0.09)`;
      ctx.fill();
    }
    ctx.restore();

    // 2. 中心亮线：保留骨架的可读性
    ctx.save();
    ctx.strokeStyle = base;
    ctx.lineWidth = unit * 1.5;
    ctx.shadowColor = base;
    ctx.shadowBlur = unit * 2.6;
    this.strokeBones(pts, landmarks);
    ctx.stroke();
    ctx.restore();

    // 脖子的高光，和头环接得上
    if (landmarks[0] && (landmarks[0].visibility ?? 1) > 0.4 && this.visible(landmarks, 11, 12)) {
      const cx = (pts[11][0] + pts[12][0]) / 2;
      const cy = (pts[11][1] + pts[12][1]) / 2;
      const r = Math.max(unit * 6, torsoW * 0.30);
      const ty = pts[0][1] + r * 0.8;
      if (cy - ty > 2) {
        ctx.save();
        ctx.strokeStyle = base;
        ctx.lineWidth = unit * 1.5;
        ctx.shadowColor = base;
        ctx.shadowBlur = unit * 2.6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(pts[0][0], ty);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 3. 关节：实心亮点
    for (const i of JOINTS) {
      const lm = landmarks[i];
      if (!lm || (lm.visibility ?? 1) < 0.4) continue;
      const [x, y] = pts[i];
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue}, 100%, 66%, 0.30)`;
      ctx.arc(x, y, unit * 3.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = core;
      ctx.arc(x, y, unit * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawHead(pts, landmarks, hue, unit, base, core);
  }

  drawHead(pts, landmarks, hue, unit, base, core) {
    const ctx = this.ctx;
    const nose = landmarks[0];
    const ls = landmarks[11];
    const rs = landmarks[12];
    if (!nose || !ls || !rs || (nose.visibility ?? 1) < 0.4) return;

    const [nx, ny] = pts[0];
    const shoulderW = Math.hypot(pts[12][0] - pts[11][0], pts[12][1] - pts[11][1]);
    const r = Math.max(unit * 6, shoulderW * 0.30);

    ctx.save();
    // 内发光：边缘亮、中心空，不画五官
    const g = ctx.createRadialGradient(nx, ny, r * 0.2, nx, ny, r);
    g.addColorStop(0, `hsla(${hue}, 100%, 70%, 0.02)`);
    g.addColorStop(0.78, `hsla(${hue}, 100%, 70%, 0.10)`);
    g.addColorStop(1, `hsla(${hue}, 100%, 70%, 0.30)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = base;
    ctx.shadowBlur = unit * 4;
    ctx.strokeStyle = base;
    ctx.lineWidth = unit * 1.4;
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = core;
    ctx.lineWidth = unit * 0.6;
    ctx.beginPath();
    ctx.arc(nx, ny, r * 0.86, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- 胶囊与工具 ---------------- */

  capsule(a, b, w) {
    const ctx = this.ctx;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) return;

    ctx.save();
    ctx.translate(a[0], a[1]);
    ctx.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(0, -w / 2, len, w, w / 2);
    } else {
      ctx.rect(0, -w / 2, len, w);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  visible(landmarks, a, b) {
    if (!landmarks) return true;
    if ((landmarks[a]?.visibility ?? 1) < 0.35) return false;
    if ((landmarks[b]?.visibility ?? 1) < 0.35) return false;
    return true;
  }

  boneWidth(pts, a, b, unit) {
    return Math.max(unit * 3, Math.hypot(pts[b][0] - pts[a][0], pts[b][1] - pts[a][1]));
  }

  limbWidth(a, b, unit, torsoW) {
    if (a === 11 && b === 12) return torsoW * 0.34;
    if (a === 23 && b === 24) return torsoW * 0.32;
    // 上臂/大腿粗一点，前臂/小腿细一点
    const proximal = [11, 12, 23, 24].includes(a) && b !== 24 && b !== 23;
    return unit * (proximal ? 4.4 : 3.4);
  }

  strokeBones(pts, landmarks) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      const pa = pts[a];
      const pb = pts[b];
      if (!pa || !pb) continue;
      if (!this.visible(landmarks, a, b)) continue;
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
    }
  }

  /* ---------------- 拖影、粒子、涟漪 ---------------- */

  drawTrails(unit) {
    const ctx = this.ctx;
    const n = this.trail.length;
    if (n < 3) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < n - 1; i++) {
      const f = this.trail[i];
      const age = (i + 1) / n;               // 越新越亮
      const hue = this.hueOf(f.intensity);
      ctx.strokeStyle = `hsla(${hue}, 100%, 66%, ${(age * 0.16).toFixed(3)})`;
      ctx.lineWidth = unit * (0.6 + age * 2.2);
      this.strokeBones(f.pts, null);
      ctx.stroke();
    }
    ctx.restore();
  }

  emitFromJoints(pts, landmarks, dt, intensity) {
    if (!this.prevPts || intensity < 0.16) return;

    for (const i of EMITTERS) {
      const lm = landmarks[i];
      if (!lm || (lm.visibility ?? 1) < 0.4) continue;
      const [x, y] = pts[i];
      const [px, py] = this.prevPts[i];
      const speed = Math.hypot(x - px, y - py) / Math.max(dt, 0.001);
      if (speed < 160) continue;
      if (Math.random() > 0.55) continue;
      if (this.particles.length > 110) break;

      const a = Math.random() * Math.PI * 2;
      const v = 24 + Math.random() * 60;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v * 0.6,
        vy: -Math.abs(Math.sin(a)) * v - 18,
        life: 0.6 + Math.random() * 0.5,
        max: 0.6 + Math.random() * 0.5,
        size: 0.8 + Math.random() * 1.6
      });
    }
  }

  updateEffects(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 26 * dt;          // 轻微下坠，像灰尘
      p.vx *= 0.985;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const r of this.ripples) {
      r.r += r.speed * dt;
      r.life -= dt;
    }
    this.ripples = this.ripples.filter((r) => r.life > 0);
  }

  drawEffects(hue) {
    const ctx = this.ctx;
    ctx.save();
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.fillStyle = `hsla(${hue}, 100%, 74%, ${(a * 0.85).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  maybeRipple(pts, landmarks, intensity, t, unit) {
    if (intensity < 0.5) return;
    if (t - this.lastRipple < 0.75) return;
    const a27 = landmarks[27];
    const a28 = landmarks[28];
    if (!a27 || !a28) return;
    if ((a27.visibility ?? 1) < 0.35 || (a28.visibility ?? 1) < 0.35) return;

    this.lastRipple = t;
    const fx = (pts[27][0] + pts[28][0]) / 2;
    const fy = Math.max(pts[27][1], pts[28][1]);
    // 半径跟屏幕尺度走，否则手机上会变成一个巨大的呼啦圈
    this.ripples.push({
      x: fx, y: fy,
      r: unit * 8,
      speed: unit * (34 + intensity * 26),
      life: 1.1,
      max: 1.1
    });
  }

  drawRipples(hue) {
    const ctx = this.ctx;
    for (const r of this.ripples) {
      const a = Math.max(0, r.life / r.max);
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.scale(1, 0.26);
      ctx.strokeStyle = `hsla(${hue}, 100%, 68%, ${(a * 0.38).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------------- 旧线稿（?style=line） ---------------- */

  drawLine(landmarks, intensity, t) {
    const ctx = this.ctx;
    const pts = landmarks.map((lm) => this.project(lm));

    const hue = this.hueOf(intensity);
    const base = `hsl(${hue}, 100%, 62%)`;
    const glow = `hsla(${hue}, 100%, 55%, 0.22)`;
    const core = `hsla(${hue}, 100%, 86%, 1)`;

    const unit = Math.max(1.6, Math.min(this.w, this.h) * 0.0035);
    const pulse = 1 + 0.06 * Math.sin(t * 5.2);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const a27 = landmarks[27];
    const a28 = landmarks[28];
    if (a27 && a28 && (a27.visibility ?? 1) > 0.3 && (a28.visibility ?? 1) > 0.3) {
      const fx = (pts[27][0] + pts[28][0]) / 2;
      const fy = Math.max(pts[27][1], pts[28][1]);
      const rx = Math.max(Math.abs(pts[28][0] - pts[27][0]) * 2.4, unit * 30);

      ctx.save();
      ctx.translate(fx, fy);
      ctx.scale(1, 0.26);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, `hsla(${hue}, 100%, 62%, 0.34)`);
      g.addColorStop(0.55, `hsla(${hue}, 100%, 60%, 0.10)`);
      g.addColorStop(1, `hsla(${hue}, 100%, 60%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.strokeStyle = glow;
    ctx.lineWidth = unit * 7 * pulse;
    this.strokeBones(pts, landmarks);
    ctx.stroke();

    ctx.strokeStyle = base;
    ctx.lineWidth = unit * 3 * pulse;
    ctx.globalAlpha = 0.85;
    this.strokeBones(pts, landmarks);
    ctx.stroke();

    ctx.strokeStyle = core;
    ctx.lineWidth = unit * 0.9;
    ctx.globalAlpha = 1;
    this.strokeBones(pts, landmarks);
    ctx.stroke();

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

    const nose = landmarks[0];
    const ls = landmarks[11];
    const rs = landmarks[12];
    if (nose && ls && rs && nose.visibility > 0.4) {
      const [nx, ny] = pts[0];
      const shoulderW = Math.hypot(pts[12][0] - pts[11][0], pts[12][1] - pts[11][1]);
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
}
