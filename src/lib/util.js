// 공통 유틸리티: 날짜, DOM, CSV, 다운로드

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD' (로컬 시간 기준) */
export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> Date (로컬 자정) */
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const today = () => fmtDate(new Date());

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

/** 학년도: 3월 1일 기준 */
export function schoolYearOf(s) {
  const [y, m] = s.split('-').map(Number);
  return m >= 3 ? y : y - 1;
}

export function yearRange(year) {
  return { start: `${year}-03-01`, end: fmtDate(new Date(year + 1, 2, 0)) };
}

export function weekdayOf(s) {
  return parseDate(s).getDay();
}

export function koDate(s) {
  const d = parseDate(s);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 다양한 날짜 표기(2026-03-02, 2026.3.2, 2026/3/2, 20260302)를 정규화 */
export function normalizeDate(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (isNaN(d)) return null;
  return fmtDate(d);
}

let idSeq = 0;
export const newId = () => `n_${Date.now().toString(36)}_${(idSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const isTempId = (id) => !id || String(id).startsWith('n_');

export const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

/** 아주 작은 DOM 헬퍼: h('div.cls#id', {attrs, onclick}, ...children) */
export function h(sel, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs != null) children.unshift(attrs);
    attrs = {};
  }
  const [tagPart, ...rest] = sel.split(/(?=[.#])/);
  const el = document.createElement(tagPart || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** el 의 내용을 바꾼다. null·false·undefined 는 건너뛴다(그대로 넣으면 "null" 글자가 보임) */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}

/** CSV 파싱 (따옴표, 줄바꿈 포함 셀 지원) */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
}

export function toCSV(rows) {
  return '﻿' + rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

/** 엑셀(한국어)이 저장한 CSV는 CP949인 경우가 많으므로 UTF-8 실패 시 EUC-KR로 해석 */
export async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

let toastTimer;
export function toast(msg, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) { el = h('div#toast'); document.body.append(el); }
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), kind === 'error' ? 6000 : 2500);
}

/** 모달 대화상자. buttons: [{label, value, primary}] -> Promise<value> */
export function modal(title, body, buttons = [{ label: '닫기', value: null }]) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const overlay = h('div.modal-overlay', { onclick: (e) => e.target === overlay && close(null) },
      h('div.modal', { role: 'dialog', 'aria-label': title },
        h('div.modal-head', h('h3', title), h('button.icon-btn', { onclick: () => close(null), 'aria-label': '닫기' }, '✕')),
        h('div.modal-body', body),
        h('div.modal-foot', buttons.map((b) => h(`button${b.primary ? '.primary' : ''}`, { onclick: () => close(b.value) }, b.label)))));
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
  });
}

export const confirmDialog = (title, msg, okLabel = '확인') =>
  modal(title, h('p', msg), [{ label: '취소', value: false }, { label: okLabel, value: true, primary: true }]);

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
