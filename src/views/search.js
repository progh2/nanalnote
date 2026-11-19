// 전체 검색 창 (Ctrl+K, 또는 머리줄의 🔍)
import { h, fill, koDate } from '../lib/util.js';
import { searchAll, queryTerms, matchRanges, snippet } from '../lib/search.js';
import { studentLabel, classKey } from '../lib/students.js';
import { personLabel, KINDS } from '../lib/people.js';
import { TYPE_LABEL } from '../lib/tags.js';
import { showStudentCounsel } from './students.js';
import { openPerson } from './mentions.js';

let open = null; // 열려 있는 창 (두 번 열지 않기)
let lastQuery = '';

/** 글에서 맞은 부분을 <mark> 로 */
function marked(text, terms) {
  const out = [];
  let last = 0;
  for (const [a, b] of matchRanges(text, terms)) {
    if (a > last) out.push(text.slice(last, a));
    out.push(h('mark', text.slice(a, b)));
    last = b;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function openSearch(app) {
  if (open) { open.input.focus(); open.input.select(); return; }
  const input = h('input.search-input', { type: 'search', placeholder: '학생·사람·기관·태그·기록 찾기 (예: 교육청 공문, 고은별, #방과후)', value: lastQuery, 'aria-label': '전체 검색', autocomplete: 'off' });
  const body = h('div.search-results', { role: 'listbox' });
  let items = []; // [{el, go}]
  let idx = 0;

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); open = null; };
  const choose = (i) => { const it = items[i]; if (!it) return; close(); it.go(); };
  const paint = () => items.forEach((it, i) => it.el.classList.toggle('active', i === idx));
  const item = (go, ...kids) => {
    const i = items.length;
    const el = h('div.search-item', { role: 'option', onmousedown: (e) => { e.preventDefault(); choose(i); }, onmousemove: () => { if (idx !== i) { idx = i; paint(); } } }, ...kids);
    items.push({ el, go });
    return el;
  };
  const goDate = async (d) => { app.tab = 'notebook'; if (d) await app.setDate(d); app.render(); };

  const draw = () => {
    const q = input.value;
    lastQuery = q;
    items = []; idx = 0;
    if (!q.trim()) {
      fill(body, h('div.search-hint.muted',
        h('p', '띄어 쓴 낱말이 모두 들어간 것을 찾습니다. 조사가 붙어도 됩니다.'),
        h('p', '↑↓ 고르기 · Enter 열기 · Esc 닫기'),
        h('p.small', `지금 학년도(${app.store.year}학년도) 자료에서 찾습니다.`)));
      return;
    }
    const terms = queryTerms(q);
    const r = searchAll(app.store, q);
    const group = (title, n, list) => (list.length ? [h('div.search-group', title, n != null ? h('span.muted', ` ${n}`) : null), ...list] : []);
    fill(body,
      ...group('학생', null, r.students.map((s) => item(() => showStudentCounsel(app, s.uid),
        h('span.search-kind', '🎓'), h('strong', marked(studentLabel(s), terms)), classKey(s) ? h('span.muted.small', ` ${classKey(s)}반`) : null))),
      ...group('사람·기관', null, r.people.map((p) => item(() => openPerson(app, p.id),
        h('span.search-kind', p.kind === 'org' ? '🏢' : '👤'), h('strong', marked(personLabel(p), terms)),
        h('span.muted.small', ` ${[KINDS[p.kind], p.org, p.phone].filter(Boolean).join(' · ')}`)))),
      ...group('태그', null, r.tags.map(([t, n]) => item(() => { app.tagView = { tag: t, q: '', type: '' }; app.tab = 'tags'; app.render(); },
        h('span.search-kind', '#'), h('strong', marked(`#${t}`, terms)), h('span.muted.small', ` ${n}건`)))),
      ...group('기록', r.records.length + r.more, r.records.map((e) => {
        const sn = snippet(e.text, terms);
        return item(() => goDate(e.date),
          h('div.search-rec-head', h(`span.type-badge.t-${e.type}`, TYPE_LABEL[e.type]), h('span.muted.small', e.date ? ` ${koDate(e.date)}` : ' 날짜 없음'),
            e.label ? h('strong.small', ` ${e.label}`) : null, e.done ? h('span.muted.small', ' (완료)') : null),
          h('div.search-snippet', marked(sn.text, terms)));
      })),
      r.more ? h('div.muted.small.search-more', `외 ${r.more}건 — 낱말을 더 넣어 좁혀 보세요`) : null,
      r.total ? null : h('p.muted.search-hint', `"${q}" — 찾은 것이 없습니다.`));
    paint();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); idx = (idx + 1) % items.length; paint(); items[idx].el.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; paint(); items[idx].el.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && !e.isComposing && document.activeElement === input) { e.preventDefault(); choose(idx); }
  };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 120); });
  const overlay = h('div.modal-overlay.search-overlay', { onclick: (e) => e.target === overlay && close() },
    h('div.search-box', { role: 'dialog', 'aria-label': '전체 검색' },
      h('div.search-bar', h('span.search-icon', '🔍'), input, h('button.icon-btn', { onclick: close, 'aria-label': '닫기' }, '✕')),
      body));
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  open = { input };
  draw();
  input.focus();
  input.select();
}
