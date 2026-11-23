// 대회·활동 탭: 대회·공모전·프로그램 목록과 상세(개요·일정·자료·참가 학생/팀·단계별 결과·수상·수료)
import { h, fill, newId, toast, confirmDialog, downloadBlob, koDate, today, pickFile } from '../lib/util.js';
import { KINDS, RESULTS, AWARDS, STAGE_PRESETS, STATUS, FILES_FOLDER, stageId, spanOf, contestStatus, nextEvent, awardCount, contestSheets, resultText, activityRows, ACTIVITY_HEAD, activityRowCells } from '../lib/contests.js';
import { studentLabel, resolveRef } from '../lib/students.js';
import { renderMd } from '../lib/notemd.js';
import { xlsxBlob } from '../lib/xlsx.js';
import { mentionInline } from './mentions.js';
import { scrollToDetail } from './ui.js';
import { attachStudentSuggest } from './suggest.js';
import { createSheet } from './sheet.js';
import { summaryBlock, stagesBlock, resourcesBlock, projectsOf } from './projectparts.js';

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 60) || '파일';
const dd = (n) => (n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `D+${-n}`);
const ddClass = (n) => (n < 0 ? '.over' : n <= 3 ? '.soon' : '');

export function openContest(app, id) {
  app.contestView = { ...(app.contestView || {}), sel: id };
  app.tab = 'contests';
  app.render();
}

const grow = (el) => {
  const fit = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
  el.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return el;
};

export function renderContests(app) {
  const { store } = app;
  const v = (app.contestView ||= { sel: '', q: '', status: '' });
  const t = today();
  const list = (store.work.contests || []);
  const order = { active: 0, soon: 1, done: 2 };
  const shown = list
    .filter((c) => (!v.status || contestStatus(c, t) === v.status) && (!v.q || [c.name, c.host, c.kind, c.summary].some((x) => (x || '').includes(v.q))))
    .sort((a, b) => order[contestStatus(a, t)] - order[contestStatus(b, t)]
      || (nextEvent(a, t)?.date || spanOf(a).end || '9999').localeCompare(nextEvent(b, t)?.date || spanOf(b).end || '9999')
      || a.name.localeCompare(b.name, 'ko'));
  if (v.sel) v.sel = store.currentId(v.sel);
  const sel = list.find((c) => c.id === v.sel) || null;

  const add = () => {
    const c = { id: newId(), name: '새 대회', kind: '대회', start: '', end: '', stages: [], entries: [] };
    store.work.contests.push(c);
    store.markDirty();
    v.sel = c.id;
    app.render();
    requestAnimationFrame(() => { const el = document.querySelector('.contest-name'); el?.focus(); el?.select(); });
  };
  const search = h('input', { type: 'search', placeholder: '이름·주최로 찾기', value: v.q, oninput: (e) => { v.q = e.target.value; clearTimeout(search.t); search.t = setTimeout(() => app.render(), 250); } });
  const left = h('section.card.contest-list-card',
    h('div.card-head', h('h2', `대회·활동 (${list.length})`),
      h('div.row', { style: { margin: 0, gap: '6px' } },
        h('button.small.primary', { onclick: add }, '+ 새로 만들기'),
        list.length ? h('button.small', { title: '모든 대회·활동의 참가 학생을 엑셀로', onclick: () => exportAll(app) }, '⬇ 엑셀') : null)),
    search,
    h('div.chips', [['', '전체'], ['active', STATUS.active], ['soon', STATUS.soon], ['done', STATUS.done]].map(([k, l]) =>
      h(`button.chip-btn${(v.status || '') === k ? '.active' : ''}`, { onclick: () => { v.status = k; app.render(); } }, l))),
    shown.length ? h('ul.contest-list', shown.map((c) => {
      const st = contestStatus(c, t);
      const nx = nextEvent(c, t);
      const sp = spanOf(c);
      const people = new Set((c.entries || []).flatMap((e) => e.members || [])).size;
      const aw = awardCount(c);
      return h(`li${c.id === v.sel ? '.active' : ''}${st === 'done' ? '.done' : ''}`, { onclick: () => { v.sel = c.id; app.render(); scrollToDetail('.contests-page > section.card:last-child'); } },
        h('div.contest-li-top', h(`span.kind-badge.k-${KINDS.indexOf(c.kind)}`, c.kind || '대회'), h('strong', c.name || '(이름 없음)'),
          nx && st !== 'done' ? h(`span.due-btn${ddClass(nx.n)}`, { title: `${nx.label} ${nx.date}` }, dd(nx.n)) : null),
        h('div.muted.small', [sp.start || sp.end ? `${sp.start ? koDate(sp.start).replace(/\s*\(.\)/, '') : ''} ~ ${sp.end ? koDate(sp.end).replace(/\s*\(.\)/, '') : ''}` : '기간 미정',
          nx && st !== 'done' ? `다음: ${nx.label}` : STATUS[st], people ? `${people}명` : '', aw ? `🏆 ${aw}` : ''].filter(Boolean).join(' · ')));
    })) : h('p.muted', list.length ? '맞는 항목이 없습니다.' : '대회·공모전·캠프 같은 활동을 만들어 개요·일정·자료와 참가 학생, 단계별 결과, 수상·수료를 관리하세요.'));

  const right = sel ? detail(app, sel) : h('section.card', h('div.card-head', h('h2', '대회·활동')),
    h('div.help',
      h('p', '대회·공모전·프로그램(캠프·연수 등)마다 한 장씩 만들어 관리합니다.'),
      h('ul',
        h('li', '개요와 주요 자료(포스터·사이트·안내 문서), 접수·예선·본선 같은 단계별 일정을 적어 두면 교사수첩 그날에도 보이고 D-day 로 따라갑니다.'),
        h('li', '참가는 팀(또는 개인)마다 한 줄: 학생, 단계별 결과(통과·탈락…), 수상, 수료를 표처럼 적습니다. 엑셀로 내려받을 수 있습니다.'),
        h('li', '학생관리에서 학생마다, 보고서 > 학생 활동에서 학급별로 모아 봅니다.')),
      h('p.muted.small', '학년도 폴더의 "대회·활동.md"에 저장되고, 파일은 "대회·활동자료" 폴더에 들어갑니다.')));
  return h('div.split.contests-page', left, right);
}

function detail(app, c) {
  const { store } = app;
  const t = today();
  const dirty = () => store.markDirty();
  const label = (uid) => store.label(uid);
  c.stages ||= []; c.entries ||= [];

  // ----- 기본 정보 ----- (이름을 고치면 목록에 반영하되, 포커스가 이 영역을 떠날 때 다시 그린다)
  let namePending = false;
  const head = h('div.contest-head', { onfocusout: (e) => { if (namePending && !head.contains(e.relatedTarget)) { namePending = false; setTimeout(() => app.render(), 0); } } },
    h('input.contest-name', { value: c.name, 'aria-label': '대회·활동 이름', placeholder: '이름 (예: 2026 SW 공모전)', oninput: (e) => { c.name = e.target.value; dirty(); }, onchange: () => { namePending = true; } }),
    h('div.row', { style: { gap: '6px' } },
      h('div.chips', { style: { margin: 0 } }, KINDS.map((k) => h(`button.chip-btn${c.kind === k ? '.active' : ''}`, { onclick: () => { c.kind = k; dirty(); app.render(); } }, k))),
      h('label.check.small', h('input', { type: 'checkbox', checked: !!c.completion, onchange: (e) => { c.completion = e.target.checked; dirty(); app.render(); } }), ' 수료 관리')),
    h('div.inline-form.contest-meta',
      h('label', '주최', h('input', { value: c.host || '', placeholder: '주최·주관', style: { width: '14em' }, oninput: (e) => { c.host = e.target.value; dirty(); } })),
      h('label', '기간', h('input', { type: 'date', value: c.start || '', onchange: (e) => { c.start = e.target.value; dirty(); app.render(); } })),
      h('span', '~'),
      h('input', { type: 'date', value: c.end || '', 'aria-label': '끝', onchange: (e) => { c.end = e.target.value; dirty(); app.render(); } })));

  // ----- 개요 · 일정 · 자료 (태그 카드와 함께 쓰는 칸) -----
  const summaryCard = summaryBlock(app, c, 'summary', { view: (app.contestView.summaryView ||= {}), placeholder: '개요 — 목적, 대상, 주제, 참가 방법, 유의 사항 등. ## 제목, - 목록, #태그 를 쓸 수 있어요.' });
  const stagesCard = stagesBlock(app, c, { presets: STAGE_PRESETS, hint: '접수·예선·본선처럼 단계를 넣으면 날짜를 따라가고, 참가 표에 단계별 결과 칸이 생깁니다.',
    beforeRemove: async (s) => {
      const used = c.entries.some((e) => e.results?.[s.id]);
      if (used && !(await confirmDialog('단계 지우기', `"${s.name}" 단계와 이 단계의 참가 결과를 지울까요?`, '지우기'))) return false;
      for (const e of c.entries) if (e.results) delete e.results[s.id];
      return true;
    } });
  const resCard = resourcesBlock(app, c, { folder: FILES_FOLDER, base: c.name });

  // ----- 참가 (스프레드시트처럼: 바로 고치기, 엑셀·구글 시트에서 붙여넣기) -----
  const idx = store.studentIndex();
  /** "20101 김민준, 20102 이서연" / "20101 20102" / "김민준 이서연" → uid 들 + 못 찾은 것 */
  const parseMembers = (text) => {
    const refs = String(text || '').split(/[,\s;/·]+/).filter(Boolean).map((x) => resolveRef(x, idx) || x);
    const found = refs.filter((r) => typeof r !== 'string');
    const miss = refs.filter((r) => typeof r === 'string' && !found.some((x) => x.name === r));
    return { uids: [...new Set(found.map((x) => x.uid))], miss };
  };
  const sumEl = h('h3', { style: { margin: 0 } });
  const drawSum = () => {
    const members = new Set(c.entries.flatMap((e) => e.members || []));
    sumEl.textContent = `참가 (${c.entries.length}줄 · ${members.size}명${awardCount(c) ? ` · 🏆 ${awardCount(c)}` : ''}${c.completion ? ` · 수료 ${c.entries.filter((e) => e.done).length}` : ''})`;
  };
  drawSum();
  const sheet = createSheet({
    rows: () => c.entries,
    addRow: () => { const e = { id: newId(), team: '', members: [], results: {}, award: '', memo: '' }; c.entries.push(e); return e; },
    removeRows: (list) => { c.entries = c.entries.filter((e) => !list.includes(e)); },
    onChange: () => { dirty(); drawSum(); },
    snapshot: () => JSON.stringify(c.entries),
    restore: (snap) => { c.entries = JSON.parse(snap); },
    ghostText: '여기에 쓰거나 붙여넣으면 새 줄',
    columns: [
      { key: 'team', title: '팀', width: 8, get: (e) => e.team || '', set: (e, v) => { e.team = v.trim(); } },
      { key: 'members', title: '학생 (학번·이름)', width: 16, wrap: true, get: (e) => (e.members || []).map(label).join(', '),
        set: (e, v) => { const { uids, miss } = parseMembers(v); e.members = uids; return miss.length ? `학생을 찾지 못했습니다: ${miss.join(', ')}` : ''; } },
      ...c.stages.map((stg) => ({ key: stg.id, title: stg.name, width: 5.5, type: 'list', options: RESULTS,
        get: (e) => e.results?.[stg.id] || '', set: (e, v) => { e.results ||= {}; if (v.trim()) e.results[stg.id] = v.trim(); else delete e.results[stg.id]; } })),
      { key: 'award', title: '수상', width: 7, type: 'list', options: AWARDS, get: (e) => e.award || '', set: (e, v) => { e.award = v.trim(); } },
      ...(c.completion ? [{ key: 'done', title: '수료', width: 3.5, type: 'bool', get: (e) => !!e.done, set: (e, v) => { if (v) e.done = true; else delete e.done; } }] : []),
      { key: 'memo', title: '메모', width: 12, wrap: true, get: (e) => e.memo || '', set: (e, v) => { e.memo = v; } },
    ],
  });
  const entriesCard = h('div.contest-block',
    h('div.card-head', { style: { margin: '18px 0 8px' } }, sumEl,
      h('div.row', { style: { margin: 0, gap: '6px' } },
        h('button.small', { onclick: () => downloadBlob(xlsxBlob(contestSheets(c, label, store.work.students)), `${safe(c.name)}.xlsx`) }, '⬇ 엑셀로 내려받기'))),
    h('p.muted.small.sheet-help', '스프레드시트처럼 칸을 눌러 바로 쓰고, 엑셀·구글 시트에서 복사한 표를 Ctrl+V 로 붙여 넣을 수 있어요. 학생 칸은 "20101 20102"처럼 학번이나 이름을 쉼표·띄어쓰기로. 줄 번호를 눌러 고른 뒤 Delete 로 줄 지우기, Ctrl+Z 되돌리기. ', sheet.statusEl),
    sheet);

  const st = contestStatus(c, t);
  const nx = nextEvent(c, t);
  return h('section.card.contest-detail',
    h('div.card-head', h('h2', `${c.kind || '대회'} · ${STATUS[st]}`, nx && st !== 'done' ? h(`span.due-btn${ddClass(nx.n)}`, `${nx.label} ${dd(nx.n)}`) : null),
      h('div.row', { style: { margin: 0, gap: '6px' } },
        h('button.small', { onclick: () => { app.contestView.sel = ''; app.render(); } }, '닫기'),
        h('button.small.danger', { onclick: async () => {
          if (!(await confirmDialog('대회·활동 지우기', `"${c.name}"과 참가 기록을 모두 지울까요? 올린 파일도 지웁니다.`, '지우기'))) return;
          for (const f of c.files || []) { try { await store.backend.deleteFile?.(store.year, FILES_FOLDER, f.file); } catch { /* 없음 */ } }
          store.work.contests = store.work.contests.filter((x) => x !== c); dirty(); app.contestView.sel = ''; app.render();
        } }, '지우기'))),
    head,
    summaryCard,
    stagesCard,
    resCard,
    entriesCard);
}

/** 모든 대회·활동 → 엑셀 (대회 목록 + 참가 학생) */
export function exportAll(app) {
  const { store } = app;
  const label = (uid) => store.label(uid);
  const cs = store.work.contests || [];
  const t = today();
  const rows = [['이름', '종류', '주최', '시작', '끝', '상태', '단계', '참가 줄', '참가 학생', '수상']];
  for (const c of cs) {
    const sp = spanOf(c);
    rows.push([c.name, c.kind || '', c.host || '', sp.start, sp.end, STATUS[contestStatus(c, t)], (c.stages || []).map((s) => `${s.name}${s.start || s.end ? `(${[s.start, s.end].filter(Boolean).join('~')})` : ''}`).join(', '),
      String((c.entries || []).length), String(new Set((c.entries || []).flatMap((e) => e.members || [])).size), String(awardCount(c))]);
  }
  downloadBlob(xlsxBlob([{ name: '대회·활동 목록', rows }, { name: '참가 학생', rows: [ACTIVITY_HEAD, ...activityRows(cs, store.work.students, label).map(activityRowCells)] }]), `대회·활동_${store.year}학년도.xlsx`);
}

/** 학생관리용: 학생 한 명의 대회·활동 카드 */
export function studentActivitiesCard(app, uid) {
  const { store } = app;
  const items = [];
  for (const c of store.work.contests || []) for (const e of c.entries || []) if ((e.members || []).includes(uid)) items.push({ c, e });
  items.sort((a, b) => (spanOf(b.c).start || '').localeCompare(spanOf(a.c).start || ''));
  const projects = projectsOf(store, `s:${uid}`);
  return h('section.card',
    h('div.card-head', h('h2', `대회·활동${projects.length ? '·사업' : ''} (${items.length + projects.length})`), h('button.small', { onclick: () => { app.contestView = { ...(app.contestView || {}), sel: '' }; app.tab = 'contests'; app.render(); } }, '대회·활동 메뉴')),
    items.length ? h('ul.activity-list', items.map(({ c, e }) => {
      const sp = spanOf(c);
      return h('li',
        h('button.link', { onclick: () => openContest(app, c.id) }, c.name), ' ', h('span.muted.small', `${c.kind || ''} · ${[sp.start, sp.end].filter(Boolean).join(' ~ ')}`),
        h('div.small', [e.team ? `팀 ${e.team}` : '', resultText(c, e), c.completion ? (e.done ? '수료' : '미수료') : ''].filter(Boolean).join(' · '),
          e.award ? h('strong.award', ` 🏆 ${e.award}`) : null));
    })) : projects.length ? null : h('p.muted', '참가한 대회·활동이 없습니다.'),
    projects.length ? h('div.chips', { style: { marginTop: '6px' } }, projects.map((x) => h('button.chip-btn', { onclick: () => { app.tagView = { ...(app.tagView || {}), tag: x.tag, type: '' }; app.tab = 'tags'; app.render(); } }, `#${x.tag}${x.role ? ` · ${x.role}` : ''}`))) : null);
}

