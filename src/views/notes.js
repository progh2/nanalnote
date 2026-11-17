// 포스트잇: 화면 어디에나(바깥 여백 포함) 띄워 두는 메모. 어느 탭에 가도 보인다. 위치·크기·색이 저장된다.
import { h, newId, confirmDialog } from '../lib/util.js';

const COLORS = { yellow: '#fff3a3', pink: '#ffd6e2', green: '#d4f5c9', blue: '#d3e9ff', purple: '#e6dcff' };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function addNote(app) {
  const notes = app.store.work.notes;
  const w = 220, hgt = 170;
  const n = { id: newId(), text: '', color: 'yellow', x: Math.max(8, window.innerWidth - w - 24 - (notes.length % 4) * 26), y: 150 + (notes.length % 6) * 30, w, h: hgt, temp: true };
  notes.push(n);
  app.store.markDirty();
  renderNotes(app);
  document.querySelector(`.postit[data-id="${n.id}"] textarea`)?.focus();
}

export function renderNotes(app) {
  const layer = document.getElementById('notes');
  if (!layer || !app.store?.year) return;
  const store = app.store;
  layer.replaceChildren(...store.work.notes.map((n) => {
    const el = h(`div.postit${n.min ? '.min' : ''}`, { 'data-id': n.id, style: {
      left: `${clamp(n.x || 0, 0, window.innerWidth - 60)}px`, top: `${clamp(n.y || 0, 0, window.innerHeight - 30)}px`,
      width: `${n.w || 220}px`, height: n.min ? 'auto' : `${n.h || 170}px`, background: COLORS[n.color] || COLORS.yellow,
    } });
    const bar = h('div.postit-bar',
      h('span.postit-title', n.min ? (n.text.split('\n')[0] || '메모').slice(0, 18) : ''),
      ...Object.keys(COLORS).map((c) => h('button.dot-btn', { title: '색', style: { background: COLORS[c] }, onclick: (e) => { e.stopPropagation(); n.color = c; store.markDirty(); renderNotes(app); } })),
      h('button.icon-btn', { title: n.min ? '펼치기' : '접기', onclick: (e) => { e.stopPropagation(); n.min = !n.min; store.markDirty(); renderNotes(app); } }, n.min ? '▢' : '–'),
      h('button.icon-btn', { title: '삭제', onclick: async (e) => {
        e.stopPropagation();
        if (n.text.trim() && !(await confirmDialog('포스트잇 삭제', '이 메모를 지울까요?', '지우기'))) return;
        store.work.notes = store.work.notes.filter((x) => x !== n); store.markDirty(); renderNotes(app);
      } }, '✕'));
    // 끌어서 옮기기
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
      const move = (ev) => {
        el.style.left = `${clamp(ev.clientX - sx, 0, window.innerWidth - 60)}px`;
        el.style.top = `${clamp(ev.clientY - sy, 0, window.innerHeight - 30)}px`;
      };
      const up = () => {
        bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up);
        n.x = el.offsetLeft; n.y = el.offsetTop; store.markDirty();
      };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
    });
    el.append(bar);
    if (!n.min) {
      const ta = h('textarea', { value: n.text, placeholder: '메모…', 'aria-label': '포스트잇 내용', oninput: (e) => { n.text = e.target.value; delete n.temp; store.markDirty(); } });
      el.append(ta);
      // 크기 조절(오른쪽 아래 모서리) 기록
      new ResizeObserver(() => {
        const w = Math.round(el.offsetWidth), hh = Math.round(el.offsetHeight);
        if (w && hh && (Math.abs(w - (n.w || 0)) > 2 || Math.abs(hh - (n.h || 0)) > 2)) { n.w = w; n.h = hh; store.markDirty(); }
      }).observe(el);
    }
    return el;
  }));
}
