/**
 * 姿态追踪 + 运动量估计。
 *
 * 运动量 = 身体主干关键点在画面中的平均位移速度（按关键点加权），
 * 再做指数平滑。这个值天然不受帧率影响，也不需要预设动作模板，
 * 挥手、深蹲、开合跳、原地跑都能被识别成"在动"。
 */

// 11..16 手臂，23..28 腿。四肢权重更高，避免轻微晃动被当成运动。
const BODY = [
  { i: 11, w: 0.55 }, { i: 12, w: 0.55 },
  { i: 13, w: 1.0 },  { i: 14, w: 1.0 },
  { i: 15, w: 1.7 },  { i: 16, w: 1.7 },
  { i: 23, w: 0.55 }, { i: 24, w: 0.55 },
  { i: 25, w: 1.0 },  { i: 26, w: 1.0 },
  { i: 27, w: 1.5 },  { i: 28, w: 1.5 }
];

/**
 * 灵敏度档位。三个数值都在控制"多难才算动起来"：
 *   deadZone  死区，运动量要先穿过这段才产生强度，调大 = 更迟钝
 *   scale     强度归一化除数，调大 = 同样的动作得到的强度更低
 *   activeAt  判定为"运动中"的最低强度，调大 = 门槛更高
 *
 * 默认 high（即最早的手感）。地址栏加 ?sens=mid / ?sens=low 可以调严格。
 */
const SENSITIVITY = {
  high: { deadZone: 0.10, scale: 1.55, activeAt: 0.14 },
  mid:  { deadZone: 0.24, scale: 2.30, activeAt: 0.28 },
  low:  { deadZone: 0.42, scale: 3.40, activeAt: 0.38 }
};

function pickSensitivity() {
  let level = 'high';
  try {
    level = new URLSearchParams(location.search).get('sens') || 'high';
  } catch (_) {}
  return SENSITIVITY[level] || SENSITIVITY.high;
}

export class Tracker {
  constructor() {
    this.pose = null;
    this.ready = false;
    this.busy = false;
    this.prev = null;
    this.prevTime = 0;
    this.motion = 0;
    this.floor = 0.06;      // 静止基线，缓慢自适应
    this.detected = false;
    this.onFrame = null;
    this.frames = 0;
    this.fpsT = 0;
    this.fps = 0;
    this.sens = pickSensitivity();
  }

  async init(onFrame) {
    if (typeof window.Pose === 'undefined') {
      throw new Error('识别引擎未加载');
    }

    this.onFrame = onFrame;

    this.pose = new window.Pose({
      locateFile: (file) => `./vendor/mediapipe/${file}`
    });

    this.pose.setOptions({
      modelComplexity: 0,
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.45
    });

    this.pose.onResults((r) => this.handle(r));

    await this.pose.initialize();
    this.ready = true;
  }

  handle(results) {
    const now = performance.now();
    const dt = this.prevTime ? Math.min(0.12, (now - this.prevTime) / 1000) : 0;
    this.prevTime = now;

    const lm = results.poseLandmarks;

    if (!lm) {
      this.detected = false;
      this.lastLandmarks = null;
      this.motion *= 0.86;
      this.prev = null;
      this.emit(dt);
      return;
    }

    // 至少躯干要可信，否则当成没检测到
    const conf = (lm[11]?.visibility ?? 0) + (lm[12]?.visibility ?? 0) +
                 (lm[23]?.visibility ?? 0) + (lm[24]?.visibility ?? 0);
    this.detected = conf > 1.2;
    this.lastLandmarks = this.detected ? lm : null;

    if (dt > 0) {
      let sum = 0;
      let wsum = 0;

      if (this.prev) {
        for (const b of BODY) {
          const a = this.prev[b.i];
          const c = lm[b.i];
          if (!a || !c) continue;
          if ((a.visibility ?? 1) < 0.45 || (c.visibility ?? 1) < 0.45) continue;
          const d = Math.hypot(c.x - a.x, c.y - a.y);
          sum += d * b.w;
          wsum += b.w;
        }
      }

      const speed = wsum > 0 ? (sum / wsum) / dt : 0;

      // 上升快、下降慢，避免动作之间的空档被判成停止
      const k = speed > this.motion ? 0.34 : 0.12;
      this.motion += (speed - this.motion) * k;

      // 静止基线自适应：往下追得快，往上爬得慢
      if (this.motion < this.floor) {
        this.floor += (this.motion - this.floor) * 0.25;
      } else {
        this.floor += 0.05 * dt;
      }
      this.floor = Math.max(0.02, Math.min(0.5, this.floor));

      this.prev = lm;
    }

    this.frames++;
    this.emit(dt);
  }

  emit(dt) {
    const { deadZone, scale, activeAt } = this.sens;
    const excess = Math.max(0, this.motion - this.floor - deadZone);
    const intensity = Math.min(1, excess / scale);
    // 当前档位下，运动量需要达到多少才算"在动"
    const trigger = this.floor + deadZone + activeAt * scale;

    if (this.onFrame) {
      this.onFrame({
        landmarks: this.lastLandmarks,
        detected: this.detected,
        motion: this.motion,
        floor: this.floor,
        intensity,
        active: this.detected && intensity >= activeAt,
        threshold: activeAt,
        trigger,
        dt
      });
    }
  }

  async send(video) {
    if (!this.ready || this.busy) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    this.busy = true;
    try {
      await this.pose.send({ image: video });
    } catch (e) {
      // 单帧失败不中断
    } finally {
      this.busy = false;
    }
  }
}
