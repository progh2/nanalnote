// 글 쓰는 칸에서 학생 이름 추천
// - 이름 첫 두 글자 이상을 쓰면(예: "오세") 그렇게 시작하는 학생을 추천
// - "..." 뒤에 이름 일부나 학번을 쓰면(예: "...오", "...21") 이름 어디에든 들어간 학생을 찾기
// - 고르면 "학번 이름" 으로 바꿔 넣는다 (동명이인도 정확히 연결, 뒤에 조사를 바로 이어 써도 됨)
import { h, fill } from '../lib/util.js';
import { studentLabel, classKey, sortStudents } from '../lib/students.js';

const MAX = 8;

/** textarea 안 글자 위치의 화면 좌표 (같은 모양의 보이지 않는 div 로 잰다) */
function caretXY(ta, index) {
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'textIndent', 'tabSize']) div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', top: '0', left: '-9999px', visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflow: 'hidden', width: `${ta.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)}px`, borderStyle: 'solid' });
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

/** 지금 커서 앞의 글자를 보고 추천할 상황인지 판단 */
function context(ta, students) {
  const pos = ta.selectionStart;
  if (pos !== ta.selectionEnd) return null;
  const before = ta.value.slice(0, pos);
  let m = before.match(/\.\.\.([0-9가-힣A-Za-z]*)$/);
  if (m) {
    const q = m[1];
    const list = students.filter((s) => !q || (/^\d+$/.test(q) ? (s.studentNo || '').startsWith(q) : s.name.includes(q) || studentLabel(s).includes(q)));
    return { start: pos - m[0].length, end: pos, q, list, mode: 'search' };
  }
  m = before.match(/(^|[^0-9가-힣A-Za-z])([가-힣]{2,})$/);
  if (m) {
    const q = m[2];
    const start = pos - q.length;
    if (/\d{3,}\s*$/.test(before.slice(0, start))) return null; // 이미 "학번 이름" 으로 쓴 경우
    const list = students.filter((s) => s.name.startsWith(q));
    return list.length ? { start, end: pos, q, list, mode: 'prefix' } : null;
  }
  return null;
}

/**
 * @param ta textarea
 * @param getStudents () => 학생 배열
 */
export function attachStudentSuggest(ta, getStudents) {
  let menu = null, items = [], idx = 0, ctx = null;
  const close = () => { menu?.remove(); menu = null; ctx = null; };
  const pick = (s) => {
    if (!ctx) return;
    ta.focus();
    // 띄어쓰기 없이 넣는다: 바로 "이/가/에게" 같은 조사를 이어 써도 학생으로 인식된다
    ta.setRangeText(studentLabel(s), ctx.start, ctx.end, 'end');
    close();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const paint = () => {
    [...menu.querySelectorAll('.suggest-item')].forEach((el, i) => el.classList.toggle('active', i === idx));
  };
  const open = () => {
    const students = sortStudents(getStudents() || []);
    ctx = students.length ? context(ta, students) : null;
    if (!ctx || !ctx.list.length) { close(); return; }
    items = ctx.list.slice(0, MAX);
    idx = Math.min(idx, items.length - 1);
    if (!menu) { menu = h('div.suggest', { role: 'listbox' }); document.body.append(menu); }
    fill(menu, 
      h('div.suggest-head', ctx.mode === 'search' ? (ctx.q ? `"${ctx.q}" 찾기` : '학생 찾기 — 이름 일부나 학번을 쓰세요') : '학생 추천'),
      ...items.map((s, i) => h(`div.suggest-item${i === idx ? '.active' : ''}`, {
        role: 'option',
        onmousedown: (e) => { e.preventDefault(); pick(s); }, // 칸의 포커스를 잃기 전에 고른다
      }, h('strong', studentLabel(s)), classKey(s) ? h('span.muted.small', ` ${classKey(s)}반`) : null)),
      ctx.list.length > MAX ? h('div.suggest-more.muted.small', `외 ${ctx.list.length - MAX}명 — 더 쓰면 좁혀집니다`) : null,
      h('div.suggest-foot.muted.small', '↑↓ 이동 · Enter/Tab 넣기 · Esc 닫기'));
    const { x, y } = caretXY(ta, ctx.start);
    const w = Math.min(280, window.innerWidth - 16);
    menu.style.width = `${w}px`;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
    const below = y + 4;
    menu.style.top = `${below}px`;
    // 화면 아래가 모자라면 위로
    requestAnimationFrame(() => { if (menu && below + menu.offsetHeight > window.innerHeight - 8) menu.style.top = `${Math.max(8, y - menu.offsetHeight - 28)}px`; });
  };
  ta.addEventListener('input', () => { idx = 0; open(); });
  ta.addEventListener('click', () => { idx = 0; open(); });
  ta.addEventListener('keydown', (e) => {
    if (!menu || !ctx) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % items.length; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; paint(); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) { e.preventDefault(); pick(items[idx]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  ta.addEventListener('blur', () => setTimeout(close, 150));
  ta.addEventListener('scroll', close);
}

// 화면을 스크롤하면 떠 있는 추천 창을 닫는다 (한 번만 등록)
window.addEventListener('scroll', (e) => { if (!e.target?.closest?.('.suggest')) document.querySelectorAll('.suggest').forEach((m) => m.remove()); }, { passive: true, capture: true });
