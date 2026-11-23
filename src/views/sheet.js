// 스프레드시트처럼 쓰는 표 (구글 스프레드시트·엑셀 느낌)
// - 칸을 누르면 고르고, 바로 글자를 치면 고쳐 쓰기(한글 조합 포함), 두 번 누르거나 F2 는 이어 쓰기
// - ←↑→↓ / Enter / Tab 으로 옮기기, Shift+화살표·끌기로 범위, Ctrl+C·X·V 복사·잘라내기·붙여넣기(엑셀·구글 시트에서 복사한 표),
//   Delete 지우기, Ctrl+Z 되돌리기, Ctrl+A 전체. 붙여넣기가 넘치면 줄을 새로 만든다.
// - 맨 아래 빈 줄에 쓰면 새 줄이 생긴다.
//
// columns: [{ key, title, width(em), type: 'text'|'bool'|'list', options, placeholder, readonly, wrap,
//             get(row) → 글자(bool 은 true/false), set(row, 글자) → 경고 글자(있으면 알림) }]
import { h, toast, confirmDialog } from '../lib/util.js';
import { parseTSV, toTSV, truthy } from '../lib/tsv.js';

const coarse = () => window.matchMedia('(pointer: coarse)').matches;

/**
 * @param o.rows () => 지금 줄 배열 (살아 있는 배열)
 * @param o.addRow () => 새 줄 (호출하는 쪽이 배열에 넣고 돌려준다)
 * @param o.removeRows (줄 배열) => void
 * @param o.onChange () => void  고친 뒤 (저장 표시 등)
 * @param o.snapshot / o.restore  되돌리기용
 */
export function createSheet(o) {
  const cols = o.columns;
  const st = { r: 0, c: 0, ar: 0, ac: 0, editing: false, mode: 'enter', drag: false, undo: [] };
  const table = h('table.sheet-table');
  const editor = h('textarea.sheet-editor', { rows: 1, spellcheck: 'false', autocomplete: 'off', 'aria-label': '칸 입력' });
  const opts = h('div.sheet-options');
  const scroll = h('div.sheet-scroll', table, editor, opts);
  const status = h('span.sheet-status.muted.small');
  const root = h('div.sheet', scroll);
  const rows = () => o.rows();
  const nRows = () => rows().length + 1; // 맨 아래 빈 줄
  let cells = []; // [r][c] → td

  const display = (col, row) => {
    if (!row) return '';
    const v = col.get(row);
    if (col.type === 'bool') return v ? '✓' : '';
    return v == null ? '' : String(v);
  };
  const raw = (col, row) => {
    if (!row) return '';
    const v = col.get(row);
    if (col.type === 'bool') return v ? 'O' : '';
    return v == null ? '' : String(v);
  };

  // ---------- 그리기 ----------
  function render() {
    const list = rows();
    cells = [];
    const head = h('thead', h('tr', h('th.sheet-corner', { title: '모두 고르기', onmousedown: (e) => { e.preventDefault(); selectAll(); } }, ''),
      cols.map((col, c) => h('th', { style: col.width ? { width: `${col.width}em`, minWidth: `${col.width}em` } : null, onmousedown: (e) => { e.preventDefault(); selectCol(c); } }, col.title))));
    const body = h('tbody');
    for (let r = 0; r < nRows(); r++) {
      const row = list[r];
      const tds = cols.map((col, c) => {
        // col.render(row) 가 있으면 그것으로 (이름·#태그를 누를 수 있게 등)
        const shown = row && col.render ? col.render(row) : display(col, row);
        const td = h(`td${col.readonly ? '.ro' : ''}${col.type === 'bool' ? '.bool' : ''}${col.wrap ? '.wrap' : ''}${!row ? '.ghost' : ''}`, { 'data-r': r, 'data-c': c }, (Array.isArray(shown) ? (shown.length ? shown : '') : shown) || (!row && c === 0 && o.ghostText ? h('span.muted', o.ghostText) : ''));
        return td;
      });
      cells.push(tds);
      body.append(h(`tr${!row ? '.ghost-row' : ''}`, h('th.sheet-rh', { 'data-r': r, onmousedown: (e) => { e.preventDefault(); selectRow(r, e.shiftKey); } }, row ? String(r + 1) : '+'), tds));
    }
    // 열 너비를 정한 대로 (스프레드시트처럼 남는 폭을 억지로 늘리지 않음)
    const total = 2.6 + cols.reduce((n, col) => n + (col.width || 8), 0);
    table.style.width = `${total}em`;
    table.replaceChildren(h('colgroup', h('col', { style: { width: '2.6em' } }), cols.map((col) => h('col', { style: { width: `${col.width || 8}em` } }))), head, body);
    clamp();
    paint();
  }

  function clamp() {
    const maxR = nRows() - 1, maxC = cols.length - 1;
    st.r = Math.min(Math.max(0, st.r), maxR); st.ar = Math.min(Math.max(0, st.ar), maxR);
    st.c = Math.min(Math.max(0, st.c), maxC); st.ac = Math.min(Math.max(0, st.ac), maxC);
  }
  const range = () => ({ r1: Math.min(st.r, st.ar), r2: Math.max(st.r, st.ar), c1: Math.min(st.c, st.ac), c2: Math.max(st.c, st.ac) });

  function paint() {
    const { r1, r2, c1, c2 } = range();
    cells.forEach((tds, r) => tds.forEach((td, c) => {
      td.classList.toggle('sel', r >= r1 && r <= r2 && c >= c1 && c <= c2 && (r1 !== r2 || c1 !== c2));
      td.classList.toggle('active', r === st.r && c === st.c);
    }));
    table.querySelectorAll('th.sheet-rh').forEach((th) => { const r = +th.dataset.r; th.classList.toggle('on', r >= r1 && r <= r2); });
    placeEditor();
    const n = (r2 - r1 + 1) * (c2 - c1 + 1);
    status.textContent = n > 1 ? `${r2 - r1 + 1}줄 × ${c2 - c1 + 1}칸 골랐음` : '';
  }

  function placeEditor() {
    const td = cells[st.r]?.[st.c];
    if (!td) return;
    editor.style.left = `${td.offsetLeft}px`;
    editor.style.top = `${td.offsetTop}px`;
    editor.style.width = `${td.offsetWidth}px`;
    editor.style.minHeight = `${td.offsetHeight}px`;
    editor.style.height = `${td.offsetHeight}px`;
    if (st.editing) { editor.style.height = 'auto'; editor.style.height = `${Math.max(td.offsetHeight, editor.scrollHeight)}px`; }
    opts.style.left = `${td.offsetLeft}px`;
    opts.style.top = `${td.offsetTop + td.offsetHeight}px`;
  }

  const keepVisible = () => cells[st.r]?.[st.c]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  // ---------- 고르기 ----------
  function select(r, c, extend = false) {
    if (st.editing) commit();
    st.r = r; st.c = c;
    if (!extend) { st.ar = r; st.ac = c; }
    clamp(); paint(); keepVisible();
    focusEditor();
  }
  const selectAll = () => { if (st.editing) commit(); st.ar = 0; st.ac = 0; st.r = nRows() - 1; st.c = cols.length - 1; paint(); focusEditor(); };
  const selectRow = (r, extend) => { if (st.editing) commit(); if (!extend) st.ar = r; st.r = r; st.ac = 0; st.c = cols.length - 1; paint(); focusEditor(); };
  const selectCol = (c) => { if (st.editing) commit(); st.ac = c; st.c = c; st.ar = 0; st.r = nRows() - 1; paint(); focusEditor(); };
  const focusEditor = () => { if (document.activeElement !== editor) editor.focus({ preventScroll: true }); };

  // ---------- 고치기 ----------
  const pushUndo = () => { if (o.snapshot) { st.undo.push(o.snapshot()); if (st.undo.length > 100) st.undo.shift(); } };
  const rowAt = (r) => {
    let row = rows()[r];
    if (!row) row = o.addRow();
    return row;
  };
  /** 칸 하나에 글자 넣기 → 경고 */
  function setCell(r, c, text) {
    const col = cols[c];
    if (!col || col.readonly) return '';
    if (r >= rows().length && !String(text ?? '').trim()) return ''; // 빈 줄에 빈 글자는 줄을 만들지 않음
    const row = rowAt(r);
    let v = String(text ?? '');
    if (col.type === 'bool') v = truthy(v) ? 'true' : '';
    else if (col.type === 'list' && v.trim() && col.options?.length) {
      // 앞 글자만 써도 하나뿐이면 그 보기로 ("통" → "통과")
      const t = v.trim();
      const hit = col.options.find((x) => x === t) || (col.options.filter((x) => x.startsWith(t)).length === 1 ? col.options.find((x) => x.startsWith(t)) : null);
      if (hit) v = hit;
    }
    return col.set(row, v) || '';
  }
  const changed = (warns = []) => {
    const msg = [...new Set(warns.filter(Boolean))];
    if (msg.length) toast(msg.join(' / '), 'error');
    o.onChange?.();
    render();
    return msg.length > 0;
  };

  function beginEdit(mode, initial = null) {
    const col = cols[st.c];
    if (!col || col.readonly) { if (col?.readonly && o.readonlyHint) toast(o.readonlyHint); return false; }
    if (col.type === 'bool') { toggleBool(); return false; }
    st.editing = true; st.mode = mode;
    st.ar = st.r; st.ac = st.c;
    root.classList.add('editing');
    if (initial != null) editor.value = initial;
    else editor.value = raw(col, rows()[st.r]);
    paint();
    showOptions();
    focusEditor();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
    return true;
  }
  function showOptions() {
    const col = cols[st.c];
    if (!st.editing || col?.type !== 'list' || !col.options?.length) { opts.replaceChildren(); opts.hidden = true; return; }
    opts.hidden = false;
    opts.replaceChildren(...col.options.map((x) => h('button', { type: 'button', onmousedown: (e) => { e.preventDefault(); editor.value = x; commit(); move(1, 0); } }, x)),
      h('button.muted', { type: 'button', onmousedown: (e) => { e.preventDefault(); editor.value = ''; commit(); } }, '지우기'));
  }
  function commit() {
    if (!st.editing) return;
    st.editing = false;
    root.classList.remove('editing');
    opts.replaceChildren(); opts.hidden = true;
    const col = cols[st.c];
    const before = raw(col, rows()[st.r]);
    const v = editor.value;
    editor.value = '';
    if (v === before) { paint(); return; }
    pushUndo();
    changed([setCell(st.r, st.c, v)]);
  }
  function cancel() {
    st.editing = false;
    root.classList.remove('editing');
    opts.replaceChildren(); opts.hidden = true;
    editor.value = '';
    paint();
  }
  function toggleBool() {
    const { r1, r2, c1, c2 } = range();
    const targets = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (cols[c].type === 'bool' && !cols[c].readonly) targets.push([r, c]);
    if (!targets.length) return;
    const on = !targets.every(([r, c]) => rows()[r] && cols[c].get(rows()[r]));
    pushUndo();
    changed(targets.map(([r, c]) => setCell(r, c, on ? 'O' : '')));
  }
  async function clearRange() {
    const { r1, r2, c1, c2 } = range();
    // 줄 전체를 골랐으면 줄 지우기
    if (c1 === 0 && c2 === cols.length - 1 && o.removeRows) {
      const list = rows().slice(r1, Math.min(r2, rows().length - 1) + 1);
      if (!list.length) return;
      if (!(await confirmDialog('줄 지우기', `${list.length}줄을 지울까요?`, '지우기'))) { focusEditor(); return; }
      pushUndo();
      o.removeRows(list);
      st.r = st.ar = Math.min(r1, rows().length);
      changed();
      focusEditor();
      return;
    }
    pushUndo();
    const warns = [];
    for (let r = r1; r <= Math.min(r2, rows().length - 1); r++) for (let c = c1; c <= c2; c++) warns.push(setCell(r, c, ''));
    changed(warns);
  }
  function move(dr, dc, extend = false) {
    if (st.editing) commit();
    const r = Math.min(Math.max(0, st.r + dr), nRows() - 1), c = Math.min(Math.max(0, st.c + dc), cols.length - 1);
    select(r, c, extend);
  }

  // ---------- 복사·붙여넣기 ----------
  function selectionTSV() {
    const { r1, r2, c1, c2 } = range();
    const out = [];
    for (let r = r1; r <= Math.min(r2, rows().length - 1); r++) out.push(cols.slice(c1, c2 + 1).map((col) => raw(col, rows()[r])));
    return toTSV(out);
  }
  function paste(text) {
    const data = parseTSV(text);
    if (!data.length) return;
    const { r1, r2, c1, c2 } = range();
    pushUndo();
    const warns = [];
    if (data.length === 1 && data[0].length === 1 && (r1 !== r2 || c1 !== c2)) {
      // 글자 하나를 고른 범위 전체에
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) warns.push(setCell(r, c, data[0][0]));
    } else {
      data.forEach((line, i) => line.forEach((v, j) => { if (c1 + j < cols.length) warns.push(setCell(r1 + i, c1 + j, v)); }));
      st.ar = r1; st.ac = c1;
      st.r = Math.min(r1 + data.length - 1, nRows()); st.c = Math.min(c1 + Math.max(...data.map((l) => l.length)) - 1, cols.length - 1);
    }
    if (!changed(warns)) toast(`${data.length}줄을 붙여 넣었습니다.`, 'ok');
  }

  // ---------- 이벤트 ----------
  editor.addEventListener('compositionstart', () => { if (!st.editing) beginEdit('enter', ''); });
  editor.addEventListener('input', () => {
    if (!st.editing) { const v = editor.value; if (!beginEdit('enter', v)) editor.value = ''; }
    placeEditor();
  });
  editor.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (st.editing) {
      if (k === 'Enter' && e.altKey) { e.preventDefault(); editor.setRangeText('\n', editor.selectionStart, editor.selectionEnd, 'end'); placeEditor(); return; }
      if (k === 'Enter') { e.preventDefault(); commit(); move(e.shiftKey ? -1 : 1, 0); return; }
      if (k === 'Tab') { e.preventDefault(); commit(); move(0, e.shiftKey ? -1 : 1); return; }
      if (k === 'Escape') { e.preventDefault(); cancel(); return; }
      if (st.mode === 'enter' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
        e.preventDefault(); commit();
        move(k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0, k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0);
      }
      return;
    }
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) {
      e.preventDefault();
      const [dr, dc] = arrows[k];
      if (ctrl) select(dr ? (dr < 0 ? 0 : nRows() - 1) : st.r, dc ? (dc < 0 ? 0 : cols.length - 1) : st.c, e.shiftKey);
      else move(dr, dc, e.shiftKey);
      return;
    }
    if (k === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); return; }
    if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Home') { e.preventDefault(); select(ctrl ? 0 : st.r, 0, e.shiftKey); return; }
    if (k === 'End') { e.preventDefault(); select(ctrl ? nRows() - 1 : st.r, cols.length - 1, e.shiftKey); return; }
    if (k === 'F2') { e.preventDefault(); beginEdit('edit'); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearRange(); return; }
    if (k === ' ' && cols[st.c]?.type === 'bool') { e.preventDefault(); toggleBool(); return; }
    if (ctrl && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (!st.undo.length) { toast('되돌릴 것이 없습니다.'); return; }
      o.restore(st.undo.pop());
      changed();
      return;
    }
    if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); selectAll(); return; }
    if (k === 'Escape') { st.ar = st.r; st.ac = st.c; paint(); }
  });
  editor.addEventListener('copy', (e) => { if (st.editing) return; e.preventDefault(); e.clipboardData.setData('text/plain', selectionTSV()); toast('복사했습니다.'); });
  editor.addEventListener('cut', (e) => { if (st.editing) return; e.preventDefault(); e.clipboardData.setData('text/plain', selectionTSV()); clearRange(); });
  editor.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    // 고치는 중에 한 칸짜리 글자는 그냥 이어 붙이기, 표 모양이면 표로
    if (st.editing && !/[\t\n]/.test(text.replace(/\n$/, ''))) return;
    e.preventDefault();
    if (st.editing) cancel();
    paste(text);
  });
  editor.addEventListener('blur', () => { setTimeout(() => { if (st.editing && document.activeElement !== editor) commit(); }, 0); });

  const cellOf = (t) => t.closest?.('td[data-r]');
  table.addEventListener('mousedown', (e) => {
    const td = cellOf(e.target);
    if (!td || e.button !== 0) return;
    e.preventDefault();
    const r = +td.dataset.r, c = +td.dataset.c;
    if (st.editing && r === st.r && c === st.c) return;
    const wasActive = r === st.r && c === st.c && st.r === st.ar && st.c === st.ac;
    // 칸 안의 이름·#태그 연결: 이미 고른 칸에서 누르면 따라가고, 처음 누르면 칸만 고른다 (구글 시트의 링크처럼)
    const link = e.target.closest?.('button.person-link, button.name-link, button.tag-link');
    st.followLink = !!(link && wasActive && !e.shiftKey);
    if (st.followLink) return;
    select(r, c, e.shiftKey);
    st.drag = !e.shiftKey;
    // 체크 칸: 이미 고른 칸을 한 번 더 누르면 바꾸기 (손가락 화면은 바로)
    if (cols[c].type === 'bool') { if (wasActive || coarse()) toggleBool(); return; }
    if (coarse()) beginEdit('edit');
  });
  table.addEventListener('click', (e) => {
    if (e.target.closest?.('button.person-link, button.name-link, button.tag-link') && !st.followLink) { e.stopPropagation(); e.preventDefault(); }
    st.followLink = false;
  }, true);
  table.addEventListener('mouseover', (e) => {
    if (!st.drag || !(e.buttons & 1)) return;
    const td = cellOf(e.target);
    if (!td) return;
    st.r = +td.dataset.r; st.c = +td.dataset.c;
    paint();
  });
  window.addEventListener('mouseup', () => { st.drag = false; });
  table.addEventListener('dblclick', (e) => {
    const td = cellOf(e.target);
    if (!td) return;
    if (cols[+td.dataset.c].type === 'bool') toggleBool(); else beginEdit('edit');
  });

  o.attachEditor?.(editor); // 이름·#태그 추천 등
  render();
  root.refresh = () => { if (!st.editing) render(); };
  root.focusSheet = () => focusEditor();
  root.statusEl = status;
  root.pasteText = paste; // 시험용
  return root;
}
