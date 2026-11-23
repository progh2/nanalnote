// 여러 화면에서 쓰는 작은 UI 조각
import { h, fill } from '../lib/util.js';
import { imageFromTransfer } from '../lib/photos.js';
import { PHOTO_FOLDER } from '../lib/people.js';
import { studentLabel, classKey, isActiveOn } from '../lib/students.js';

/** 학반별로 묶인 학생 선택 상자 (값 = uid) */
export function studentSelect(store, value, onChange, { cls = '', label = '학생', placeholder = '- 학생 -', date = '' } = {}) {
  // date 를 주면 그날 휴학·떠난 학생은 뺀다 (이미 골라 둔 학생은 그대로 보임)
  const list = store.studentsOf(cls).filter((s) => !date || isActiveOn(s, date) || s.uid === value);
  const groups = new Map();
  for (const s of list) {
    const k = classKey(s) || '학생';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const opt = (s) => h('option', { value: s.uid, selected: s.uid === value }, studentLabel(s));
  const known = list.some((s) => s.uid === value);
  return h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    h('option', { value: '' }, placeholder),
    !known && value ? h('option', { value, selected: true }, store.label(value)) : null,
    groups.size <= 1 ? list.map(opt) : [...groups].map(([k, arr]) => h('optgroup', { label: `${k}반` }, arr.map(opt))));
}

/** 학반 선택 상자 */
export function classSelect(store, value, onChange, { all = '전체 학반', label = '학반' } = {}) {
  return h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    h('option', { value: '' }, all),
    store.classList().map((c) => h('option', { value: c, selected: c === value }, c)));
}

/** 학생 사진 (비동기 로드). 사진이 없으면 이름 첫 글자 */
export function avatar(app, s, size = 44) {
  const el = h('span.avatar', { style: { width: `${size}px`, height: `${Math.round(size * 1.25)}px` } }, (s?.name || '?').slice(-2));
  if (s?.photo && app.store.backend.photoUrl) {
    app.store.backend.photoUrl(app.store.year, s).then((url) => {
      if (url) fill(el, h('img', { src: url, alt: s.name }));
    }).catch(() => {});
  }
  return el;
}

/**
 * 시각 고르기: [오전/오후] [시] [분(5분 단위)] — 값은 'HH:MM'(24시간)
 */
export function timeSelect(value, onChange, label = '시각') {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value || '');
  let H = m ? +m[1] : null, M = m ? +m[2] : null;
  const ap = h('select.t-ap', { 'aria-label': `${label} 오전/오후` }, h('option', { value: '' }, '--'), h('option', { value: 'am', selected: H != null && H < 12 }, '오전'), h('option', { value: 'pm', selected: H != null && H >= 12 }, '오후'));
  const hh = h('select.t-h', { 'aria-label': `${label} 시` }, h('option', { value: '' }, '--'),
    Array.from({ length: 12 }, (_, i) => i + 1).map((n) => h('option', { value: n, selected: H != null && ((H % 12) || 12) === n }, String(n))));
  const mins = Array.from({ length: 12 }, (_, i) => i * 5);
  if (M != null && !mins.includes(M)) mins.push(M), mins.sort((a, b) => a - b);
  const mm = h('select.t-m', { 'aria-label': `${label} 분` }, h('option', { value: '' }, '--'), mins.map((n) => h('option', { value: n, selected: M === n }, String(n).padStart(2, '0'))));
  const emit = () => {
    if (!ap.value || !hh.value) { if (!ap.value && !hh.value && !mm.value) onChange(''); return; }
    let hr = +hh.value % 12;
    if (ap.value === 'pm') hr += 12;
    const mi = mm.value === '' ? 0 : +mm.value;
    if (mm.value === '') mm.value = '0';
    onChange(`${String(hr).padStart(2, '0')}:${String(mi).padStart(2, '0')}`);
  };
  for (const el of [ap, hh, mm]) el.addEventListener('change', emit);
  return h('span.time-sel', ap, hh, mm);
}

/** 좁은 화면(한 줄로 쌓일 때)에서 목록을 고르면 아래 상세로 내려 준다 */
export function scrollToDetail(sel) {
  if (window.innerWidth > 900) return;
  requestAnimationFrame(() => {
    const el = document.querySelector(sel);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - (document.getElementById('header')?.offsetHeight || 0) - 8;
    window.scrollTo({ top, behavior: 'smooth' });
  });
}

/**
 * 사진 칸: 누르고 Ctrl+V, 끌어다 놓기로 그림을 받는다 (onFile(file))
 * 칸 밖에서도 붙여넣기가 되도록 app.pasteImage 를 걸어 둔다 (글 쓰는 칸이 아닐 때)
 */
export function photoDrop(app, el, onFile, label = '사진') {
  el.tabIndex = 0;
  el.classList.add('photo-drop');
  el.title = `${label}: 눌러서 고른 뒤 Ctrl+V 로 붙여넣기, 또는 그림을 끌어다 놓기`;
  el.setAttribute('aria-label', el.title);
  const take = (dt, e) => { const f = imageFromTransfer(dt); if (f) { e.preventDefault(); onFile(f); } };
  el.addEventListener('paste', (e) => take(e.clipboardData, e));
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', (e) => { el.classList.remove('drag'); take(e.dataTransfer, e); });
  app.pasteImage = onFile;
  return el;
}

/** 사람·기관 사진(로고) */
export function personAvatar(app, p, size = 44) {
  const org = p?.kind === 'org';
  const el = h(`span.avatar${org ? '.logo' : ''}`, { style: { width: `${size}px`, height: `${org ? size : Math.round(size * 1.25)}px` } }, org ? '🏢' : (p?.name || '?').slice(-2));
  if (p?.photo && app.store.backend.fileUrl) {
    app.store.backend.fileUrl(app.store.year, PHOTO_FOLDER, p.photo).then((url) => { if (url) fill(el, h('img', { src: url, alt: p.name })); }).catch(() => {});
  }
  return el;
}
