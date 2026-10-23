/**
 * 个人中心：把 Store 里的数据渲染成概览、热力图和记录列表。
 */

import { dayKey } from './store.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDuration(sec) {
  if (sec < 60) return Math.round(sec) + ' 秒';
  const m = sec / 60;
  if (m < 60) return m.toFixed(1) + ' 分';
  const h = m / 60;
  return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' 小时';
}

function level(count) {
  if (count >= 5) return 'c3';
  if (count >= 3) return 'c2';
  if (count >= 1) return 'c1';
  return '';
}

export function renderHeatmap(store, container, monthsEl, weeks = 26) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dow = today.getDay(); // 0 = 周日
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - dow);

  // 最早那一周的周日
  const start = new Date(weekStart);
  start.setDate(weekStart.getDate() - (weeks - 1) * 7);

  const todayKey = dayKey(today);
  const parts = [];

  // 按列填充：每一列是一周，七行对应周日到周六
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const key = dayKey(date);

      if (date > today) {
        parts.push('<i class="blank"></i>');
        continue;
      }

      const rec = store.log.days[key];
      const count = rec?.sessions?.length || 0;
      const isToday = key === todayKey ? 'today' : '';
      const skip = rec?.skips?.length ? `，跳过 ${rec.skips.length} 次` : '';
      const label = `${key}　运动 ${count} 次${skip}`;

      parts.push(`<i class="${level(count)} ${isToday}" title="${label}"></i>`);
    }
  }

  container.innerHTML = parts.join('');

  // 月份刻度：先切出每个月的列区间，跨度不足两列的（如起始那几天的残月）不标
  if (monthsEl) {
    const segs = [];

    for (let w = 0; w < weeks; w++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7);
      const m = d.getMonth();

      if (!segs.length || segs[segs.length - 1].m !== m) {
        segs.push({ m, start: w + 1, end: w + 1 });
      } else {
        segs[segs.length - 1].end = w + 1;
      }
    }

    const labels = segs
      .filter((s) => s.end - s.start >= 1)
      .map((s) => ({ col: s.start, text: `${s.m + 1} 月` }));

    monthsEl.innerHTML = labels
      .map((l) => `<span style="grid-column: ${l.col}">${l.text}</span>`)
      .join('');
  }
}

export function renderRecent(store, container, limit = 12) {
  const list = store.recentSessions(limit);

  if (!list.length) {
    container.innerHTML = '<li class="empty">还没有记录。完成一次运动，这里就会有第一条。</li>';
    return;
  }

  const today = dayKey();

  container.innerHTML = list
    .map((s) => {
      const d = new Date(s.t);
      const dateText = s.day === today ? '今天' : s.day.slice(5).replace('-', '/');
      const pct = Math.round((s.i || 0) * 100);
      return `<li>
        <span class="when">${dateText} ${pad(d.getHours())}:${pad(d.getMinutes())}<em>强度 ${pct}%</em></span>
        <span class="what">${(s.d || 0).toFixed(0)} 秒 · ${s.src === 'reminder' ? '提醒触发' : '手动开始'}</span>
      </li>`;
    })
    .join('');
}

export function renderProfile(store, el) {
  const s = store.stats();

  el.streak.textContent = String(s.streak);
  el.week.textContent = String(s.weekSessions);
  el.total.textContent = fmtDuration(s.totalSec);
  el.skips.textContent = String(s.totalSkips);

  renderHeatmap(store, el.heatmap, el.heatmapMonths);
  renderRecent(store, el.recent);
}

export function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportJSON(store) {
  const stamp = dayKey().replace(/-/g, '');
  downloadFile(store.toJSON(), `起身-备份-${stamp}.json`, 'application/json;charset=utf-8');
}
