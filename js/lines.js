/**
 * 卡片上的那句话。
 *
 * 不随机抽别人的句子，而是按用户当前状态挑——连续天数决定语气，
 * 同一天用同一个种子，保证当天看到和分享出去的是同一句。
 *
 * 所有文案自己写，没有版权问题，也省掉外部依赖。
 */

const POOLS = {
  // 从没动过，或者断掉了
  start: [
    '还没开始，也可以现在开始',
    '今天第一组，先把身体叫醒',
    '起身这件事，什么时候都不算晚'
  ],
  // 1-2 天
  spark: [
    '开始了，最难的就是这一步',
    '两天，身体正在记起怎么动',
    '开头总是最费劲的，你已经过了'
  ],
  // 3-6 天
  forming: [
    '第三天，习惯正在形成',
    '连续几天，椅子开始不习惯你',
    '这几天不算多，但已经不一样了'
  ],
  // 7-29 天
  steady: [
    '一周以上，它不只是提醒了',
    '这些天，你没把身体交给椅子',
    '它正在变成你生活的一部分'
  ],
  // 30-99 天
  solid: [
    '一个月，这不是冲动是选择',
    '三十天，你和身体重新谈了谈',
    '能坚持到这里的人，其实不多'
  ],
  // 100 天以上
  deep: [
    '一百天，你比多数人了解身体',
    '这些数字背后是每天的诚实',
    '很久了，久到它已经不需要提醒'
  ]
};

function pickBucket(streak) {
  if (streak <= 0) return POOLS.start;
  if (streak < 3) return POOLS.spark;
  if (streak < 7) return POOLS.forming;
  if (streak < 30) return POOLS.steady;
  if (streak < 100) return POOLS.solid;
  return POOLS.deep;
}

/** 用日期做种子，同一天稳定返回同一句 */
function daySeed(d) {
  const s = `${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function pickStreakLine(streak, date = new Date()) {
  const pool = pickBucket(streak);
  return pool[daySeed(date) % pool.length];
}

/** 单次成绩卡：按这次的表现挑 */
export function pickSessionLine(intensity, date = new Date()) {
  let pool;

  if (intensity >= 0.55) {
    pool = [
      '这组够狠，身体记住了',
      '这个强度，不是敷衍自己',
      '动到这个份上，值了'
    ];
  } else if (intensity >= 0.28) {
    pool = [
      '动了，就比坐着强',
      '这几十秒，身体是醒着的',
      '不算猛，但确实动了'
    ];
  } else {
    pool = [
      '动了一下，总比不动好',
      '幅度不大，但没坐着',
      '下次可以再用力一点'
    ];
  }

  return pool[daySeed(date) % pool.length];
}

const SESSION_TITLES = {
  high: ['你动了。', '身体醒了。', '这才是起身。'],
  mid: ['动了，但不够狠。', '勉强算过关。', '及格的一次。'],
  low: ['算你动了。', '这也能过。', '低空掠过。']
};

/** 单次成绩卡的主标题，用时间戳做种子，同一次运动每次看都一样 */
export function pickSessionTitle(intensity, seed = Date.now()) {
  let pool;
  if (intensity >= 0.55) pool = SESSION_TITLES.high;
  else if (intensity >= 0.28) pool = SESSION_TITLES.mid;
  else pool = SESSION_TITLES.low;

  const n = Math.abs(Math.floor(seed / 1000)) % pool.length;
  return pool[n];
}
