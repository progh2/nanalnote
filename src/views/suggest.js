// 글 쓰는 칸에서 학생·사람·기관 이름 추천
// - 이름 첫 두 글자 이상을 쓰면(예: "오세") 그렇게 시작하는 학생을 추천
// - "..." 뒤에 이름 일부나 학번을 쓰면(예: "...오", "...21") 이름 어디에든 들어간 학생을 찾기
// - 고르면 "학번 이름" 으로 바꿔 넣는다 (동명이인도 정확히 연결, 뒤에 조사를 바로 이어 써도 됨)
import { h, fill } from '../lib/util.js';
import { studentLabel, classKey, sortStudents } from '../lib/students.js';
import { sortPeople, namesOf, personLabel, KINDS, nameGroups, distinctQual } from '../lib/people.js';

/** 추천 후보: { key, names, find(검색용), insert(넣을 글), main, sub } */
function candidates(students, people) {
  const studentNames = new Set(students.map((s) => s.name));
  const groups = nameGroups(people);
  return [
    ...sortStudents(students).map((s) => ({ key: `s:${s.uid || s.id}`, names: [s.name], find: `${s.studentNo || ''} ${s.name}`, insert: studentLabel(s), main: studentLabel(s), sub: classKey(s) ? `${classKey(s)}반` : '' })),
    ...sortPeople(people).filter((p) => p.name).map((p) => {
      const group = groups.get(p.name) || [p];
      // 동명이인이면 "김민수(2학년부)" 처럼 구분말을 붙여 넣는다
      const q = p.kind === 'person' && group.length > 1 ? distinctQual(p, p.name, group) : '';
      return {
        key: `p:${p.id}`, names: namesOf(p), find: [...namesOf(p), p.org || ''].join(' '),
        // 같은 이름 학생이 있으면 호칭까지 넣어야 사람으로 알아본다
        insert: q ? `${p.name}(${q})` : p.kind === 'person' && studentNames.has(p.name) ? personLabel(p) || `${p.name} 선생님` : p.name,
        main: personLabel(p), sub: [KINDS[p.kind], p.org, group.length > 1 ? '동명이인' : ''].filter(Boolean).join(' · '),
      };
    }),
  ];
}

const MAX = 8;

/** textarea 안 글자 위치의 화면 좌표 (같은 모양의 보이지 않는 div 로 잰다) */
function caretXY(ta, index) {
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'textIndent', 'tabSize']) div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', top: '0', left: '-9999px', visibility: 'hidden', whiteSpace: ta.tagName === 'INPUT' ? 'pre' : 'pre-wrap', wordWrap: 'break-word', overflow: 'hidden', width: `${ta.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)}px`, borderStyle: 'solid' });
  div.textContent = ta.value.slice(0, index);
  const span = document.createElement('span');
  span.textContent = '​';
  div.appendChild(span);
  document.body.appendChild(div);
  const r = ta.getBoundingClientRect();
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
  const out = { x: r.left + span.offsetLeft - ta.scrollLeft, y: r.top + span.offsetTop - ta.scrollTop + lh };
  div.remove();
  return out;
}

/** #태그 쓰는 중이면 쓰던 태그 추천: 그렇게 시작하는 것 먼저, 다음은 들어 있는 것 (많이 쓴 순) */
function tagContext(ta, getTags) {
  const pos = ta.selectionStart;
  if (pos !== ta.selectionEnd) return null;
  const m = ta.value.slice(0, pos).match(/(^|[\s([{,.;:!?'"])#([0-9A-Za-z가-힣_-]*)$/);
  if (!m) return null;
  const tags = getTags() || []; // 태그 목록은 # 뒤에서만 계산
  const q = m[2];
  const starts = tags.filter(([t]) => t.startsWith(q) && t !== q);
  const has = q ? tags.filter(([t]) => !t.startsWith(q) && t.includes(q)) : [];
  const list = [...starts, ...has].map(([t, n]) => ({ key: `t:${t}`, insert: `#${t} `, main: `#${t}`, sub: n ? `${n}건` : '' }));
  return list.length ? { start: pos - q.length - 1, end: pos, q, list, mode: 'tag' } : null;
}

/** 지금 커서 앞의 글자를 보고 추천할 상황인지 판단 */
function context(ta, cands) {
  const pos = ta.selectionStart;
  if (pos !== ta.selectionEnd) return null;
  const before = ta.value.slice(0, pos);
  let m = before.match(/\.\.\.([0-9가-힣A-Za-z]*)$/);
  if (m) {
    const q = m[1];
    const list = cands.filter((c) => !q || (/^\d+$/.test(q) ? c.find.startsWith(q) : c.find.includes(q)));
    return { start: pos - m[0].length, end: pos, q, list, mode: 'search' };
  }
  m = before.match(/(^|[^0-9가-힣A-Za-z])([가-힣]{2,})$/);
  if (m) {
    const q = m[2];
    const start = pos - q.length;
    if (/\d{3,}\s*$/.test(before.slice(0, start))) return null; // 이미 "학번 이름" 으로 쓴 경우
    // 이미 다 쓴 이름 하나뿐이면 굳이 띄우지 않는다
    const list = cands.filter((c) => c.names.some((n) => n.startsWith(q)));
    if (list.length === 1 && list[0].names.includes(q) && list[0].insert === q) return null;
    return list.length ? { start, end: pos, q, list, mode: 'prefix' } : null;
  }
  return null;
}

/**
 * @param ta textarea
 * @param getStudents () => 학생 배열
 * @param getPeople () => 사람·기관 배열 (없어도 됨)
 * @param getTags () => [[태그, 개수]] (없어도 됨) — # 을 쓰면 추천
 */
export function attachStudentSuggest(ta, getStudents, getPeople = () => [], getTags = () => []) {
  let menu = null, items = [], idx = 0, ctx = null;
  const close = () => { menu?.remove(); menu = null; ctx = null; openMenus.delete(replace); };
  const replace = () => { if (menu) requestAnimationFrame(place); };
  const pick = (c) => {
    if (!ctx) return;
    ta.focus();
    // 띄어쓰기 없이 넣는다: 바로 "이/가/에게" 같은 조사를 이어 써도 알아본다
    ta.setRangeText(c.insert, ctx.start, ctx.end, 'end');
    close();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const paint = () => {
    [...menu.querySelectorAll('.suggest-item')].forEach((el, i) => el.classList.toggle('active', i === idx));
  };
  const open = () => {
    ctx = tagContext(ta, getTags);
    if (!ctx) {
      const cands = candidates(getStudents() || [], getPeople() || []);
      ctx = cands.length ? context(ta, cands) : null;
    }
    if (!ctx || !ctx.list.length) { close(); return; }
    items = ctx.list.slice(0, MAX);
    idx = Math.min(idx, items.length - 1);
    if (!menu) { menu = h('div.suggest', { role: 'listbox' }); document.body.append(menu); openMenus.add(replace); }
    fill(menu, 
      h('div.suggest-head', ctx.mode === 'tag' ? '태그 추천 — 새 태그면 그대로 쓰세요' : ctx.mode === 'search' ? (ctx.q ? `"${ctx.q}" 찾기` : '찾기 — 이름 일부나 학번을 쓰세요') : '이름 추천'),
      ...items.map((c, i) => h(`div.suggest-item${i === idx ? '.active' : ''}`, {
        role: 'option',
        onmousedown: (e) => { e.preventDefault(); pick(c); }, // 칸의 포커스를 잃기 전에 고른다
      }, h('strong', c.main), c.sub ? h('span.muted.small', ` ${c.sub}`) : null)),
      ctx.list.length > MAX ? h('div.suggest-more.muted.small', `외 ${ctx.list.length - MAX}개 — 더 쓰면 좁혀집니다`) : null,
      h('div.suggest-foot.muted.small', '↑↓ 이동 · Enter/Tab 넣기 · Esc 닫기'));
    place();
  };
  /**
   * 자리 잡기: 휴대폰 키보드가 올라오면 실제로 보이는 영역(visualViewport)이 줄어든다.
   * 그 영역 안에서 커서 아래에 넣고, 모자라면 커서 위로 뒤집는다. 높이는 남은 공간에 맞춘다.
   */
  const place = () => {
    if (!menu || !ctx) return;
    const vv = window.visualViewport;
    const visTop = vv ? vv.offsetTop : 0, visLeft = vv ? vv.offsetLeft : 0;
    const visH = vv ? vv.height : window.innerHeight, visW = vv ? vv.width : window.innerWidth;
    const visBottom = visTop + visH;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const { x, y } = caretXY(ta, ctx.start); // y = 커서 줄의 아래쪽
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    const caretTop = y - lh;
    const w = touch ? visW - 16 : Math.min(300, visW - 16);
    menu.style.width = `${w}px`;
    menu.style.left = `${touch ? visLeft + 8 : Math.max(visLeft + 8, Math.min(x, visLeft + visW - w - 8))}px`;
    menu.style.maxHeight = 'none';
    const natural = menu.scrollHeight;
    const below = visBottom - y - 10;
    const above = caretTop - visTop - 10;
    if (natural <= below || below >= above) {
      menu.style.top = `${y + 4}px`;
      menu.style.maxHeight = `${Math.max(90, below)}px`;
    } else {
      const hgt = Math.min(natural, above);
      menu.style.top = `${Math.max(visTop + 6, caretTop - hgt - 4)}px`;
      menu.style.maxHeight = `${Math.max(90, above)}px`;
    }
  };
  ta.addEventListener('input', () => { idx = 0; open(); });
  ta.addEventListener('click', () => { idx = 0; open(); });
  // 칸 자체의 Enter 처리(예: 업무일지 다음 줄로)보다 먼저 받는다
  ta.addEventListener('keydown', (e) => {
    if (!menu || !ctx) return;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === 'ArrowDown') { stop(); idx = (idx + 1) % items.length; paint(); }
    else if (e.key === 'ArrowUp') { stop(); idx = (idx - 1 + items.length) % items.length; paint(); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) { stop(); pick(items[idx]); }
    else if (e.key === 'Escape') { stop(); close(); }
  }, true);
  ta.addEventListener('blur', () => setTimeout(close, 150));
  ta.addEventListener('scroll', replace);
}

// 키보드가 올라오며 화면이 움직이거나 스크롤하면, 떠 있는 추천 창의 자리를 다시 잡는다 (전역 리스너 한 번만)
const openMenus = new Set();
const replaceAll = () => openMenus.forEach((fn) => fn());
window.addEventListener('scroll', replaceAll, { passive: true, capture: true });
window.visualViewport?.addEventListener('resize', replaceAll);
window.visualViewport?.addEventListener('scroll', replaceAll);
