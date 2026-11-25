// 태그 탭: #태그 목록과 태그 카드(설명·기간·상태·고정), 태그가 붙은 기록을 날짜순으로 모아 보기
// 사업·행사·프로젝트는 #태그로 쓰고, 카드에 설명과 기간을 적어 두면 한눈에 관리할 수 있다.
import { h, koDate, today, newId, modal, toast, fill } from '../lib/util.js';
import { summaryBlock, stagesBlock, resourcesBlock, membersBlock } from './projectparts.js';

export const TAG_FILES = '태그자료';
const PROJECT_STAGES = ['계획', '신청·공모', '운영', '중간 점검', '결과 보고', '정산'];
import { tagEntries, tagCounts, TYPE_LABEL, renameTag, tagNameError } from '../lib/tags.js';
import { renderMd } from '../lib/notemd.js';
import { mentionedPids, personLabel } from '../lib/people.js';
import { dday } from '../store.js';
import { mentionInline, openPerson } from './mentions.js';
import { scrollToDetail } from './ui.js';

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
  // 카드가 없으면 만들어 둔다 (빈 카드는 저장되지 않음 — 무언가 적으면 저장)
  let c = store.tagCard(tag);
  if (!c) { c = { id: newId(), tag }; store.work.tagcards.push(c); }
  const set = (patch, redraw = true) => { store.updateTagCard(tag, patch); if (redraw) app.render(); };
  const v = app.tagView;
  v.memoView ||= {};
  v.memoView[tag] ||= {};
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
    summaryBlock(app, c, 'memo', { title: '설명', view: v.memoView[tag], placeholder: `#${tag} 은(는) 어떤 일인가요? 목적, 대상, 예산, 추진 방법 등을 적어 두세요. ## 제목, - 목록을 쓸 수 있어요.` }),
    h('div.row.tag-card-dates',
      h('label', h('span.small.muted', '시작 '), h('input', { type: 'date', value: c.start || '', onchange: (e) => set({ start: e.target.value }) })),
      h('span', '~'),
      h('label', h('span.small.muted', '끝 '), h('input', { type: 'date', value: c.end || '', onchange: (e) => set({ end: e.target.value }) })),
      c.end && c.status !== 'done' ? (() => { const d = dday(c.end, t); return h(`span.due-btn${d.n < 0 ? '.over' : d.n <= 3 ? '.soon' : ''}`, d.label); })() : null,
      !c.start && !c.end && dates.length ? h('span.muted.small', `기록: ${koDate(dates[0])} ~ ${koDate(dates.at(-1))}`) : null),
    h('div.tag-card-sum.muted.small', [...byType].map(([k, n]) => `${TYPE_LABEL[k]} ${n}`).join(' · ') || '아직 기록이 없습니다'),
    stagesBlock(app, c, { presets: PROJECT_STAGES, hint: '계획·신청·운영·결과 보고처럼 단계를 넣으면 날짜를 따라가고, 교사수첩 그날에도 보입니다.' }),
    resourcesBlock(app, c, { folder: TAG_FILES, base: tag }),
    membersBlock(app, c),
    openTasks.length ? h('div.tag-card-block',
      h('div.small', h('strong', `남은 업무 ${openTasks.length}`)),
      h('ul.tag-tasks', openTasks.map((e) => {
        const d = e.due ? dday(e.due, t) : null;
        return h('li', d ? h(`span.due-btn${d.n < 0 ? '.over' : d.n <= 3 ? '.soon' : ''}`, d.label) : null, ' ', h('span', plain(e.text)));
      }))) : null,
    people.length ? h('div.tag-card-block',
      h('div.small', h('strong', '함께 나온 사람·기관')),
      h('div.chips', people.map(([p, n]) => {
        const listed = (c.members || []).some((m) => m.ref === `p:${p.uid}`);
        return h('span.suggest-chip',
          h('button.chip-btn', { onclick: () => openPerson(app, p.id) }, `${p.kind === 'org' ? '🏢' : '👤'} ${personLabel(p)} `, h('small', String(n))),
          listed ? null : h('button.icon-btn.chip-x', { title: '관련 인물 표에 넣기', 'aria-label': `${personLabel(p)} 관련 인물에 넣기`, onclick: () => { c.members ||= []; c.members.push({ ref: `p:${p.uid}`, role: '', memo: '' }); store.markDirty(); app.render(); } }, '+'));
      }))) : null);
}

export function renderTags(app) {
  const { store } = app;
  const v = (app.tagView ||= { tag: '', q: '', type: '', status: '' });
  v.q ??= ''; v.type ??= ''; v.status ??= ''; // 태그를 눌러 처음 들어온 경우
  const entries = tagEntries(store);
  // 기록에는 없어도 카드를 만든 태그는 목록에 보인다
  const countMap = new Map(tagCounts(entries));
  for (const c of store.work.tagcards) if (!countMap.has(c.tag)) countMap.set(c.tag, 0);
  const card = (t) => store.tagCard(t) || {};
  const allTags = [...countMap].sort((a, b) => (card(b[0]).pinned ? 1 : 0) - (card(a[0]).pinned ? 1 : 0)
    || (card(a[0]).status === 'done' ? 1 : 0) - (card(b[0]).status === 'done' ? 1 : 0)
    || b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  const statusOk = ([t]) => !v.status || (v.status === 'done' ? card(t).status === 'done' : card(t).status !== 'done');
  const filterTags = (qq) => { const q = String(qq || '').replace(/^#/, ''); return allTags.filter(([t]) => (!q || t.includes(q)) && statusOk([t])); };
  const counts = filterTags(v.q);
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
      { onclick: () => { pick(t); scrollToDetail('.tags-page > section.card:last-child'); }, title: [STATUS[c.status], c.memo].filter(Boolean).join(' — ') || `#${t}` },
      c.pinned ? '📌 ' : '', `#${t} `, h('small', String(n)));
  };
  // 검색칸에 칠 때는 태그 목록만 다시 그린다 (포커스·한글 조합 유지)
  const cloud = h('div.tag-cloud-wrap');
  const drawCloud = (arr) => fill(cloud, arr.length
    ? h('div.tag-cloud', arr.map(tagBtn))
    : h('p.muted', allTags.length ? '맞는 태그가 없습니다.' : '아직 태그가 없습니다. 교사수첩의 노트·업무·수업일지 등에 #회의 #수행평가 처럼 적어 보세요. # 을 쓰면 쓰던 태그를 추천합니다.'));
  drawCloud(counts);
  const search = h('input', { type: 'search', placeholder: '태그 찾기', 'data-keep': 'tag-search', value: v.q, oninput: (e) => { v.q = e.target.value; clearTimeout(search.t); search.t = setTimeout(() => drawCloud(filterTags(v.q)), 150); } });
  const left = h('section.card.tag-list-card',
    h('div.card-head', h('h2', `태그 (${allTags.length})`)),
    search,
    h('div.chips', [['', '전체'], ['active', '진행 중·기타'], ['done', '끝남']].map(([k, l]) =>
      h(`button.chip-btn${(v.status || '') === k ? '.active' : ''}`, { onclick: () => { v.status = k; v.tag = ''; app.render(); } }, l))),
    cloud);

  // 날짜별로 묶기
  const groups = [];
  for (const e of list) {
    const k = e.date || '날짜 없음';
    if (groups.at(-1)?.k !== k) groups.push({ k, items: [] });
    groups.at(-1).items.push(e);
  }
  const right = h('section.card',
    h('div.card-head', h('h2', v.tag ? `#${v.tag}` : '태그를 고르세요'), h('div.row', { style: { margin: 0, gap: '8px', alignItems: 'center' } }, h('span.muted.small', `${mine.length}건 · ${store.year}학년도`), v.tag ? h('button.small', { onclick: () => renameDialog(app, v.tag) }, '✎ 이름 바꾸기') : null)),
    v.tag ? tagCardView(app, v.tag, mine, plain) : null,
    types.length > 1 ? h('div.chips', h(`button.chip-btn${!v.type ? '.active' : ''}`, { onclick: () => { v.type = ''; app.render(); } }, '전체'),
      types.map((t) => h(`button.chip-btn${v.type === t ? '.active' : ''}`, { onclick: () => { v.type = t; app.render(); } }, TYPE_LABEL[t]))) : null,
    groups.length ? h('div.tag-timeline', groups.map((g) => h('div.tag-day',
      h('div.tag-date', g.k === '날짜 없음' ? g.k : h('button.link', { onclick: () => go(g.k) }, koDate(g.k))),
      g.items.map((e) => { const pl = mentionInline(app, { onTag: pick, activeTag: v.tag, update: e.update }); return h(`div.tag-item${e.type === 'counsel' ? '.private-item' : ''}`,
        h(`span.type-badge.t-${e.type}`, TYPE_LABEL[e.type]),
        e.label ? h('strong.small', `${e.label} `) : null,
        e.md
          ? h('div.tag-text.md', renderMd(e.text, { plain: pl }))
          : h('span.tag-text', pl(e.text)),
        e.done ? h('span.muted.small', ' (완료)') : null); })))) : (v.tag ? h('p.muted', '기록이 없습니다.') : null));
  return h('div.split.tags-page', left, right);
}

/** 태그 이름 바꾸기: 모든 기록의 #태그를 함께 바꾸고, 이미 있는 이름이면 합친다 */
async function renameDialog(app, old) {
  const { store } = app;
  const input = h('input', { value: old, 'aria-label': '새 태그 이름', style: { width: '100%' } });
  const info = h('p.small');
  const known = new Set(store.tagList().map(([t]) => t));
  const check = () => {
    const neu = input.value.trim().replace(/^#/, '');
    const err = tagNameError(neu);
    if (err) { info.className = 'small error-text'; info.textContent = err; return null; }
    if (neu === old) { info.className = 'small muted'; info.textContent = '새 이름을 쓰세요.'; return null; }
    const r = renameTag(store.work, store.counselDraft, old, neu, { dryRun: true });
    info.className = `small${known.has(neu) ? ' warn-text' : ''}`;
    info.textContent = `기록 ${r.records}개(${r.places}곳)의 #${old} 를 #${neu} 로 바꿉니다.${known.has(neu) ? ` #${neu} 이(가) 이미 있어 두 태그를 합칩니다 (카드의 설명·일정·자료·관련 인물도 합침).` : ''}`;
    return neu;
  };
  input.addEventListener('input', check);
  check();
  setTimeout(() => { input.focus(); input.select(); }, 50);
  const ok = await modal(`#${old} 이름 바꾸기`, h('div.form', h('label', '새 이름', input), info,
    h('p.muted.small', '노트·업무·수업일지·상담·학사일정·출장·출결 비고·포스트잇·대회 개요와 메모·태그 설명과 인물 메모의 태그를 함께 바꿉니다. #방과후 를 바꿔도 #방과후학교 같은 다른 태그는 그대로입니다.')),
  [{ label: '취소', value: false }, { label: '바꾸기', value: true, primary: true }]);
  if (!ok) return;
  const neu = check();
  if (!neu) { toast(info.textContent || '바꾸지 않았습니다.', 'error'); return; }
  const r = renameTag(store.work, store.counselDraft, old, neu);
  store.markDirty();
  app.tagView.tag = neu;
  app.render();
  toast(`#${old} → #${neu}: 기록 ${r.records}개를 바꿨습니다${r.merged ? ' (태그를 합쳤습니다)' : ''}.`, 'ok');
}
