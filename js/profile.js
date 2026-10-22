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

export function renderHeatmap(store, container) {
  const today = dayKey();
  const days = store.recentDays(30);

  container.innerHTML = days
    .map((d) => {
      const cls = level(d.count);
      const isToday = d.key === today ? 'today' : '';
      const skip = d.skips ? `，跳过 ${d.skips} 次` : '';
      const label = `${d.key}　运动 ${d.count} 次${skip}`;
      return `<i class="${cls} ${isToday}" title="${label}"></i>`;
    })
    .join('');
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

  renderHeatmap(store, el.heatmap);
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

export function exportCSV(store) {
  const stamp = dayKey().replace(/-/g, '');
  downloadFile(store.toCSV(), `不许坐着-运动记录-${stamp}.csv`, 'text/csv;charset=utf-8');
}

export function exportJSON(store) {
  const stamp = dayKey().replace(/-/g, '');
  downloadFile(store.toJSON(), `不许坐着-备份-${stamp}.json`, 'application/json;charset=utf-8');
}
