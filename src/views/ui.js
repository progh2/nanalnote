// 여러 화면에서 쓰는 작은 UI 조각
import { h } from '../lib/util.js';
import { studentLabel, classKey } from '../lib/students.js';

/** 학반별로 묶인 학생 선택 상자 (값 = uid) */
export function studentSelect(store, value, onChange, { cls = '', label = '학생', placeholder = '- 학생 -' } = {}) {
  const list = store.studentsOf(cls);
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
      if (url) el.replaceChildren(h('img', { src: url, alt: s.name }));
    }).catch(() => {});
  }
  return el;
}
