// 태그 탭: #태그 목록과, 태그가 붙은 기록을 날짜순으로 모아 보기
import { h, koDate } from '../lib/util.js';
import { tagEntries, tagCounts, tagNodes, TYPE_LABEL } from '../lib/tags.js';
import { renderMd } from '../lib/notemd.js';
import { mentionInline } from './mentions.js';

export function openTag(app, tag) { app.tagView = { ...(app.tagView || {}), tag }; app.tab = 'tags'; app.render(); }

export function renderTags(app) {
  const { store } = app;
  const v = (app.tagView ||= { tag: '', q: '', type: '' });
  const entries = tagEntries(store);
  const counts = tagCounts(entries).filter(([t]) => !v.q || t.includes(v.q.replace(/^#/, '')));
  if (!v.tag && counts.length) v.tag = counts[0][0];
  const list = entries.filter((e) => e.tag === v.tag && (!v.type || e.type === v.type))
    .sort((a, b) => (b.date || '0').localeCompare(a.date || '0'));
  const types = [...new Set(entries.filter((e) => e.tag === v.tag).map((e) => e.type))];
  const pick = (t) => { v.tag = t; v.type = ''; app.render(); };
  const plain = mentionInline(app, { onTag: pick, activeTag: v.tag });
  const go = async (d) => { if (!d) return; app.tab = 'notebook'; await app.setDate(d); app.render(); };

  const search = h('input', { type: 'search', placeholder: '태그 찾기', value: v.q, oninput: (e) => { v.q = e.target.value; clearTimeout(search.t); search.t = setTimeout(() => app.render(), 250); } });
  const left = h('section.card.tag-list-card',
    h('div.card-head', h('h2', `태그 (${tagCounts(entries).length})`)),
    search,
    counts.length
      ? h('div.tag-cloud', counts.map(([t, n]) => h(`button.chip-btn${t === v.tag ? '.active' : ''}`, { onclick: () => { v.tag = t; v.type = ''; app.render(); } }, `#${t} `, h('small', String(n)))))
      : h('p.muted', '아직 태그가 없습니다. 교사수첩의 노트·업무·수업일지 등에 #회의 #수행평가 처럼 적어 보세요.'));

  // 날짜별로 묶기
  const groups = [];
  for (const e of list) {
    const k = e.date || '날짜 없음';
    if (groups.at(-1)?.k !== k) groups.push({ k, items: [] });
    groups.at(-1).items.push(e);
  }
  const right = h('section.card',
    h('div.card-head', h('h2', v.tag ? `#${v.tag}` : '태그를 고르세요'), h('span.muted.small', `${list.length}건 · ${store.year}학년도`)),
    types.length > 1 ? h('div.chips', h(`button.chip-btn${!v.type ? '.active' : ''}`, { onclick: () => { v.type = ''; app.render(); } }, '전체'),
      types.map((t) => h(`button.chip-btn${v.type === t ? '.active' : ''}`, { onclick: () => { v.type = t; app.render(); } }, TYPE_LABEL[t]))) : null,
    groups.length ? h('div.tag-timeline', groups.map((g) => h('div.tag-day',
      h('div.tag-date', g.k === '날짜 없음' ? g.k : h('button.link', { onclick: () => go(g.k) }, koDate(g.k))),
      g.items.map((e) => h(`div.tag-item${e.type === 'counsel' ? '.private-item' : ''}`,
        h(`span.type-badge.t-${e.type}`, TYPE_LABEL[e.type]),
        e.label ? h('strong.small', `${e.label} `) : null,
        e.md
          ? h('div.tag-text.md', renderMd(e.text, { plain }))
          : h('span.tag-text', plain(e.text)),
        e.done ? h('span.muted.small', ' (완료)') : null))))) : h('p.muted', '기록이 없습니다.'));
  return h('div.split.tags-page', left, right);
}
