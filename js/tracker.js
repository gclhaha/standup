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
 * normal 是默认档，触发阈值 0.56；loose 是更早那版的手感；
 * strict 需要大幅摆臂或跳跃。地址栏 ?sens= 可切换。
 */
const SENSITIVITY = {
  loose:  { deadZone: 0.10, scale: 1.55, activeAt: 0.14 },  // 触发 约 0.38
  normal: { deadZone: 0.16, scale: 1.80, activeAt: 0.19 },  // 触发 约 0.56
  strict: { deadZone: 0.42, scale: 3.40, activeAt: 0.38 }   // 触发 约 1.77
};

function pickSensitivity() {
  let level = 'normal';
  try {
    level = new URLSearchParams(location.search).get('sens') || 'normal';
  } catch (_) {}
  return SENSITIVITY[level] || SENSITIVITY.normal;
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
    this.posture = { ok: false, reason: 'noPerson' };
    this.sitTime = 0;
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
      this.posture = { ok: false, reason: 'noPerson' };
      this.motion *= 0.86;
      this.prev = null;
      this.emit(dt);
      return;
    }

    // 上半身要可信
    const upperOk = (lm[11]?.visibility ?? 0) > 0.55 && (lm[12]?.visibility ?? 0) > 0.55;
    const conf = (lm[11]?.visibility ?? 0) + (lm[12]?.visibility ?? 0) +
                 (lm[23]?.visibility ?? 0) + (lm[24]?.visibility ?? 0);
    this.detected = conf > 1.2 && upperOk;

    // 姿势校验：必须全身入镜，且不是坐着
    this.posture = this.checkPosture(lm, results.poseWorldLandmarks, dt);

    // 姿势不合格就不画骨架：MediaPipe 在看不到腿时会"猜"出腿的位置，
    // 画出来是乱的，而且这些猜测点会污染运动量计算
    this.lastLandmarks = (this.detected && this.posture.ok) ? lm : null;

    if (!this.posture.ok) {
      this.motion *= 0.8;
    }

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

  /**
   * 判断是否"整个人在画面里、并且站着"。
   * 这一步是为了挡住两类误判：只露头摆头、以及坐在椅子上动上半身。
   */
  checkPosture(lm, world, dt) {
    // 1. 下半身关键点必须真的看得见
    const lower = [23, 24, 25, 26, 27, 28];
    let visible = 0;
    for (const i of lower) {
      if ((lm[i]?.visibility ?? 0) > 0.55) visible++;
    }
    if (visible < 5) return { ok: false, reason: 'noLower' };

    // 2. 脚要在画面里
    const ankleY = Math.max(lm[27].y, lm[28].y);
    if (ankleY > 1.02) return { ok: false, reason: 'feetOut' };

    // 3. 头顶到脚踝要有足够跨度，说明不是只拍到上半身
    const headY = lm[0]?.y ?? 0.2;
    if (ankleY - headY < 0.42) return { ok: false, reason: 'tooClose' };

    // 4. 膝盖弯曲过度 = 坐着。用世界坐标算膝角，不受画面宽高比影响。
    //    加时间迟滞，抬腿、跳跃这些瞬时屈膝不会误伤。
    const angle = this.kneeAngle(world);
    if (angle !== null && angle < 135) {
      this.sitTime += dt;
    } else {
      this.sitTime = Math.max(0, this.sitTime - dt * 2.5);
    }
    if (this.sitTime > 1.1) return { ok: false, reason: 'sitting' };

    return { ok: true, reason: 'ok' };
  }

  kneeAngle(world) {
    if (!world || world.length < 29) return null;

    const angleAt = (h, k, a) => {
      if (!h || !k || !a) return null;
      const v1x = h.x - k.x, v1y = h.y - k.y, v1z = h.z - k.z;
      const v2x = a.x - k.x, v2y = a.y - k.y, v2z = a.z - k.z;
      const m1 = Math.hypot(v1x, v1y, v1z);
      const m2 = Math.hypot(v2x, v2y, v2z);
      if (m1 < 1e-4 || m2 < 1e-4) return null;
      const cos = (v1x * v2x + v1y * v2y + v1z * v2z) / (m1 * m2);
      return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    };

    const l = angleAt(world[23], world[25], world[27]);
    const r = angleAt(world[24], world[26], world[28]);
    const vals = [l, r].filter((v) => v !== null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  emit(dt) {
    const { deadZone, scale, activeAt } = this.sens;
    const excess = Math.max(0, this.motion - this.floor - deadZone);
    const intensity = Math.min(1, excess / scale);
    // 当前档位下，运动量需要达到多少才算"在动"
    const trigger = this.floor + deadZone + activeAt * scale;
    const postureOk = !!(this.posture && this.posture.ok);

    if (this.onFrame) {
      this.onFrame({
        landmarks: this.lastLandmarks,
        detected: this.detected,
        posture: this.posture || { ok: false, reason: 'noPerson' },
        postureOk,
        motion: this.motion,
        floor: this.floor,
        intensity,
        active: this.detected && postureOk && intensity >= activeAt,
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
