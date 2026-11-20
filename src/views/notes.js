// 포스트잇: 화면 어디에나(바깥 여백 포함) 띄워 두는 메모. 어느 탭에 가도 보인다. 위치·크기·색이 저장된다.
import { h, newId, confirmDialog, fill } from '../lib/util.js';

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

/** 포스트잇을 둘 수 있는 범위: 머리줄 아래 ~ 화면 끝 */
function bounds() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const top0 = Math.round(document.getElementById('header')?.getBoundingClientRect().bottom || 0) + 4;
  return { vw, vh, top0, narrow: true }; // 화면 밖으로 나가 잃어버리지 않게 늘 화면 안에
}

// 화면을 돌리거나 창 크기를 바꾸면 다시 맞춘다
let lastApp = null;
const openOnPhone = new Set(); // 휴대폰에서 펼쳐 둔 포스트잇 (저장 안 함)
let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => lastApp && renderNotes(lastApp), 150); });

export function renderNotes(app) {
  lastApp = app;
  const layer = document.getElementById('notes');
  if (!layer || !app.store?.year) return;
  const store = app.store;
  const { vw, vh, top0, narrow } = bounds();
  // 휴대폰에서는 포스트잇이 화면을 많이 가리므로 접어서 보여 준다 (누르면 펼침, 저장 상태는 그대로)
  const small = vw < 720;
  fill(layer, ...store.work.notes.map((n) => {
    const min = n.min || (small && !openOnPhone.has(n.id) && !n.temp);
    // 좁은 화면(휴대폰·폴드 커버)에서는 화면 안에 다 들어오게, 어디서든 머리줄(메뉴)은 가리지 않게
    const w = Math.min(n.w || 220, vw - 16);
    const hh = Math.min(n.h || 170, vh - top0 - 16);
    const el = h(`div.postit${min ? '.min' : ''}`, { 'data-id': n.id, style: {
      left: `${clamp(n.x || 0, 0, narrow ? vw - w - 4 : vw - 60)}px`, top: `${clamp(n.y || 0, top0, Math.max(top0, vh - (narrow ? (n.min ? 40 : hh) + 4 : 30)))}px`,
      width: `${w}px`, height: min ? 'auto' : `${hh}px`, background: COLORS[n.color] || COLORS.yellow,
    } });
    const bar = h('div.postit-bar',
      h('span.postit-title', min ? (n.text.split('\n')[0] || '메모').slice(0, 18) : ''),
      ...Object.keys(COLORS).map((c) => h('button.dot-btn', { title: '색', style: { background: COLORS[c] }, onclick: (e) => { e.stopPropagation(); n.color = c; store.markDirty(); renderNotes(app); } })),
      h('button.icon-btn', { title: min ? '펼치기' : '접기', onclick: (e) => {
        e.stopPropagation();
        if (small && !n.min) { if (openOnPhone.has(n.id)) openOnPhone.delete(n.id); else openOnPhone.add(n.id); } // 휴대폰에서만 잠깐 펼치기
        else { n.min = !n.min; if (small && !n.min) openOnPhone.add(n.id); store.markDirty(); }
        renderNotes(app);
      } }, min ? '▢' : '–'),
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
        const b = bounds();
        el.style.left = `${clamp(ev.clientX - sx, 0, b.narrow ? b.vw - el.offsetWidth - 4 : b.vw - 60)}px`;
        el.style.top = `${clamp(ev.clientY - sy, b.top0, b.vh - 30)}px`;
      };
      const up = () => {
        bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up);
        n.x = el.offsetLeft; n.y = el.offsetTop; store.markDirty();
      };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
    });
    el.append(bar);
    if (!min) {
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
