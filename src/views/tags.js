// 태그 탭: #태그 목록과 태그 카드(설명·기간·상태·고정), 태그가 붙은 기록을 날짜순으로 모아 보기
// 사업·행사·프로젝트는 #태그로 쓰고, 카드에 설명과 기간을 적어 두면 한눈에 관리할 수 있다.
import { h, koDate, today } from '../lib/util.js';
import { tagEntries, tagCounts, TYPE_LABEL } from '../lib/tags.js';
import { renderMd } from '../lib/notemd.js';
import { mentionedPids, personLabel } from '../lib/people.js';
import { dday } from '../store.js';
import { mentionInline, openPerson } from './mentions.js';

export function openTag(app, tag) { app.tagView = { ...(app.tagView || {}), tag, type: '' }; app.tab = 'tags'; app.render(); }

export const STATUS = { active: '진행 중', done: '끝남' };

const grow = (el) => {
  const fit = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
  el.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return el;
};

/** 태그 카드: 설명·기간·상태·고정 + 요약(기록 수, 남은 업무, 함께 나온 사람·기관) */
function tagCardView(app, tag, all, plain) {
  const { store } = app;
  const c = store.tagCard(tag) || {};
  const set = (patch, redraw = true) => { store.updateTagCard(tag, patch); if (redraw) app.render(); };
  const dates = all.map((e) => e.date).filter(Boolean).sort();
  const byType = new Map();
  for (const e of all) byType.set(e.type, (byType.get(e.type) || 0) + 1);
  const openTasks = all.filter((e) => e.type === 'task' && !e.done)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const pc = new Map();
  for (const e of all) for (const pid of mentionedPids(e.text, store.work.students, store.work.people)) pc.set(pid, (pc.get(pid) || 0) + 1);
  const people = [...pc].map(([pid, n]) => [store.person(pid), n]).filter(([p]) => p).sort((a, b) => b[1] - a[1]);
  const t = today();

  return h(`div.tag-card${c.status === 'done' ? '.done' : ''}`,
    h('div.row.tag-card-top',
      h('div.chips', { style: { margin: 0 } },
        [['', '상태 없음'], ['active', STATUS.active], ['done', STATUS.done]].map(([k, l]) =>
          h(`button.chip-btn${(c.status || '') === k ? '.active' : ''}`, { onclick: () => set({ status: k }) }, l))),
      h(`button.chip-btn${c.pinned ? '.active' : ''}`, { title: '태그 목록 맨 앞에 고정', onclick: () => set({ pinned: !c.pinned }) }, c.pinned ? '📌 고정됨' : '📌 고정')),
    h('label.tag-card-memo', h('span.small.muted', '설명'),
      grow(h('textarea', {
        rows: 2, value: c.memo || '', placeholder: `#${tag} 은(는) 어떤 일인가요? 목적, 대상, 예산, 담당 등을 적어 두세요.`,
        oninput: (e) => set({ memo: e.target.value }, false),
      }))),
    h('div.row.tag-card-dates',
      h('label', h('span.small.muted', '시작 '), h('input', { type: 'date', value: c.start || '', onchange: (e) => set({ start: e.target.value }) })),
      h('span', '~'),
      h('label', h('span.small.muted', '끝 '), h('input', { type: 'date', value: c.end || '', onchange: (e) => set({ end: e.target.value }) })),
      c.end && c.status !== 'done' ? (() => { const d = dday(c.end, t); return h(`span.due-btn${d.n < 0 ? '.over' : d.n <= 3 ? '.soon' : ''}`, d.label); })() : null,
      !c.start && !c.end && dates.length ? h('span.muted.small', `기록: ${koDate(dates[0])} ~ ${koDate(dates.at(-1))}`) : null),
    h('div.tag-card-sum.muted.small', [...byType].map(([k, n]) => `${TYPE_LABEL[k]} ${n}`).join(' · ') || '아직 기록이 없습니다'),
    openTasks.length ? h('div.tag-card-block',
      h('div.small', h('strong', `남은 업무 ${openTasks.length}`)),
      h('ul.tag-tasks', openTasks.map((e) => {
        const d = e.due ? dday(e.due, t) : null;
        return h('li', d ? h(`span.due-btn${d.n < 0 ? '.over' : d.n <= 3 ? '.soon' : ''}`, d.label) : null, ' ', h('span', plain(e.text)));
      }))) : null,
    people.length ? h('div.tag-card-block',
      h('div.small', h('strong', '함께 나온 사람·기관')),
      h('div.chips', people.map(([p, n]) => h('button.chip-btn', { onclick: () => openPerson(app, p.id) }, `${p.kind === 'org' ? '🏢' : '👤'} ${personLabel(p)} `, h('small', String(n)))))) : null);
}

export function renderTags(app) {
  const { store } = app;
  const v = (app.tagView ||= { tag: '', q: '', type: '', status: '' });
  const entries = tagEntries(store);
  // 기록에는 없어도 카드를 만든 태그는 목록에 보인다
  const countMap = new Map(tagCounts(entries));
  for (const c of store.work.tagcards) if (!countMap.has(c.tag)) countMap.set(c.tag, 0);
  const card = (t) => store.tagCard(t) || {};
  const allTags = [...countMap].sort((a, b) => (card(b[0]).pinned ? 1 : 0) - (card(a[0]).pinned ? 1 : 0)
    || (card(a[0]).status === 'done' ? 1 : 0) - (card(b[0]).status === 'done' ? 1 : 0)
    || b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  const q = v.q.replace(/^#/, '');
  const counts = allTags.filter(([t]) => (!q || t.includes(q))
    && (!v.status || (v.status === 'done' ? card(t).status === 'done' : card(t).status !== 'done')));
  if (!v.tag && counts.length) v.tag = counts[0][0];
  const mine = entries.filter((e) => e.tag === v.tag);
  const list = mine.filter((e) => !v.type || e.type === v.type).sort((a, b) => (b.date || '0').localeCompare(a.date || '0'));
  const types = [...new Set(mine.map((e) => e.type))];
  const pick = (t) => { v.tag = t; v.type = ''; app.render(); };
  const plain = mentionInline(app, { onTag: pick, activeTag: v.tag });
  const go = async (d) => { if (!d) return; app.tab = 'notebook'; await app.setDate(d); app.render(); };

  const tagBtn = ([t, n]) => {
    const c = card(t);
    return h(`button.chip-btn${t === v.tag ? '.active' : ''}${c.status === 'done' ? '.tag-done' : ''}`,
      { onclick: () => pick(t), title: [STATUS[c.status], c.memo].filter(Boolean).join(' — ') || `#${t}` },
      c.pinned ? '📌 ' : '', `#${t} `, h('small', String(n)));
  };
  const search = h('input', { type: 'search', placeholder: '태그 찾기', value: v.q, oninput: (e) => { v.q = e.target.value; clearTimeout(search.t); search.t = setTimeout(() => app.render(), 250); } });
  const left = h('section.card.tag-list-card',
    h('div.card-head', h('h2', `태그 (${allTags.length})`)),
    search,
    h('div.chips', [['', '전체'], ['active', '진행 중·기타'], ['done', '끝남']].map(([k, l]) =>
      h(`button.chip-btn${(v.status || '') === k ? '.active' : ''}`, { onclick: () => { v.status = k; v.tag = ''; app.render(); } }, l))),
    counts.length
      ? h('div.tag-cloud', counts.map(tagBtn))
      : h('p.muted', allTags.length ? '맞는 태그가 없습니다.' : '아직 태그가 없습니다. 교사수첩의 노트·업무·수업일지 등에 #회의 #수행평가 처럼 적어 보세요. # 을 쓰면 쓰던 태그를 추천합니다.'));

  // 날짜별로 묶기
  const groups = [];
  for (const e of list) {
    const k = e.date || '날짜 없음';
    if (groups.at(-1)?.k !== k) groups.push({ k, items: [] });
    groups.at(-1).items.push(e);
  }
  const right = h('section.card',
    h('div.card-head', h('h2', v.tag ? `#${v.tag}` : '태그를 고르세요'), h('span.muted.small', `${mine.length}건 · ${store.year}학년도`)),
    v.tag ? tagCardView(app, v.tag, mine, plain) : null,
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
        e.done ? h('span.muted.small', ' (완료)') : null))))) : (v.tag ? h('p.muted', '기록이 없습니다.') : null));
  return h('div.split.tags-page', left, right);
}
