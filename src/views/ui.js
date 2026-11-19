// 여러 화면에서 쓰는 작은 UI 조각
import { h, fill } from '../lib/util.js';
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
