/**
 * 卡片上的那句话。
 *
 * 不随机抽别人的句子，而是按用户当前状态挑——连续天数决定语气，
 * 同一天用同一个种子，保证当天看到和分享出去的是同一句。
 *
 * 所有文案自己写，没有版权问题，也省掉外部依赖。
 *
 * 写作原则：
 *   1. 只写已经得到的，不评判做得不够的地方
 *   2. 不把静止描述成负面状态（身体不动不等于身体不在）
 *   3. 用书面一点的表达，不用网络语和口号式感叹
 */

const POOLS = {
  // 从没动过，或者断掉了
  start: [
    '起身是一天里最小的成就',
    '今天动一动，日子就有了精神',
    '好的开始，从这一下算起'
  ],
  // 1-2 天
  spark: [
    '连着两天，身体记住了这份轻快',
    (n) => `${n} 天，节奏已经起来了`,
    '起步的这两步，最见心气'
  ],
  // 3-6 天
  forming: [
    (n) => `第 ${n} 天，习惯正在长成`,
    '这几天，日子有了新的节拍',
    '一天一次，身体开始期待'
  ],
  // 7-29 天
  steady: [
    '一周之后，起身成了自然',
    '这些天，你把时间用在了自己身上',
    '坚持到这里，已经是一种秩序'
  ],
  // 30-99 天
  solid: [
    (n) => `${n} 天，稳当得像一件日常`,
    (n) => `${n} 天，身体和日子都舒展了`,
    '一个月有余，这是自己给的礼物'
  ],
  // 100 天以上
  deep: [
    (n) => `${n} 天，长久的坚持最动人`,
    '这些数字，是你对自己的诚意',
    '久到不必提醒，起身已是习惯'
  ]
};

// 带数字的句子写成函数，用它真实的连续天数，
// 否则 45 天的卡片会印上「三十天」这种对不上的话
function resolve(entry, streak) {
  return typeof entry === 'function' ? entry(streak) : entry;
}

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
  return resolve(pool[daySeed(date) % pool.length], streak);
}

/** 单次成绩卡：按这一次的用力度挑 */
export function pickSessionLine(intensity, date = new Date()) {
  let pool;

  if (intensity >= 0.55) {
    pool = [
      '力气用得干净，收得也利落',
      '动到这个份上，整个人都打开了',
      '这一组的分量，身体收下了'
    ];
  } else if (intensity >= 0.28) {
    pool = [
      '这几下，把气顺开了',
      '动过之后，人就轻快',
      '不必很猛，动起来就有光'
    ];
  } else {
    pool = [
      '起身这一下，就是好的开始',
      '步子虽小，方向是对的',
      '每一次起身，都是在照顾自己'
    ];
  }

  return pool[daySeed(date) % pool.length];
}

const SESSION_TITLES = {
  high: ['动作到位。', '起势漂亮。', '舒展有力。'],
  mid: ['动得从容。', '恰到好处。', '气息匀了。'],
  low: ['稳稳起步。', '轻轻一动。', '慢慢来，也是往前。']
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
