// 학사일정 탭: 연간일정 · 월중일정 · 주간계획을 이미지(붙여넣기 가능) 또는 PDF 로 올려 두고 틈틈이 보기
import { h, newId, toast, confirmDialog, pickFile, addDays, fmtDate, parseDate, koDate, pad } from '../lib/util.js';
import { safeName } from '../lib/photos.js';

const KINDS = [['annual', '연간일정'], ['monthly', '월중일정'], ['weekly', '주간계획']];
const FOLDER = '학사일정자료';
const mondayOf = (d) => { const x = parseDate(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return fmtDate(x); };

let pasteHandler = null;

/** 현재 보고 있는 기간 (월중: YYYY-MM, 주간: 그 주 월요일) */
function periodOf(app, kind) {
  app.docView ||= {};
  if (kind === 'monthly') return (app.docView.month ||= app.date.slice(0, 7));
  if (kind === 'weekly') return (app.docView.week ||= mondayOf(app.date));
  return '';
}

async function upload(app, kind, file) {
  const { store } = app;
  if (!store.backend.putFile) return toast('이 저장소는 파일을 지원하지 않습니다.', 'error');
  const period = periodOf(app, kind);
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!isPdf && !/^image\//.test(file.type)) return toast('이미지나 PDF 만 올릴 수 있습니다.', 'error');
  const ext = isPdf ? 'pdf' : (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const label = KINDS.find(([k]) => k === kind)[1];
  const name = safeName(`${period || store.year}_${label}_${Date.now().toString(36)}`) + `.${ext}`;
  try {
    toast('올리는 중…');
    await store.backend.putFile(store.year, FOLDER, name, file);
    const title = (file.name && !/^image\.\w+$/.test(file.name) ? file.name.replace(/\.[^.]+$/, '') : '') || `${period || `${store.year}학년도`} ${label}`;
    store.work.docs.push({ id: newId(), kind, period, title, file: name });
    store.markDirty();
    await app.save({ silent: true });
    app.docView.sel = name;
    toast('올렸습니다.', 'ok');
    app.render();
  } catch (e) { toast(e.message, 'error'); }
}

export function renderSchedule(app) {
  const { store } = app;
  app.docView ||= {};
  const kind = (app.docView.kind ||= 'monthly');
  const period = periodOf(app, kind);

  // 붙여넣기(Ctrl+V)로 이미지 올리기
  if (pasteHandler) document.removeEventListener('paste', pasteHandler);
  pasteHandler = (e) => {
    if (app.tab !== 'schedule') return;
    const file = [...(e.clipboardData?.files || [])].find((f) => /^image\/|pdf/.test(f.type));
    if (!file) return;
    e.preventDefault();
    upload(app, app.docView.kind, file);
  };
  document.addEventListener('paste', pasteHandler);

  const docs = store.work.docs.filter((d) => d.kind === kind && (kind === 'annual' || d.period === period));
  const sel = docs.find((d) => d.file === app.docView.sel) || docs.at(-1);

  // 기간 이동
  let nav = null;
  if (kind === 'monthly') {
    const [y, m] = period.split('-').map(Number);
    const shift = (n) => { const d = new Date(y, m - 1 + n, 1); app.docView.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; app.render(); };
    nav = h('div.row', h('button.icon-btn', { onclick: () => shift(-1) }, '◀'), h('strong', `${y}년 ${m}월`), h('button.icon-btn', { onclick: () => shift(1) }, '▶'),
      h('button.small', { onclick: () => { app.docView.month = app.date.slice(0, 7); app.render(); } }, '이번 달'));
  } else if (kind === 'weekly') {
    const shift = (n) => { app.docView.week = addDays(period, 7 * n); app.render(); };
    nav = h('div.row', h('button.icon-btn', { onclick: () => shift(-1) }, '◀'), h('strong', `${koDate(period)} 주`), h('button.icon-btn', { onclick: () => shift(1) }, '▶'),
      h('button.small', { onclick: () => { app.docView.week = mondayOf(app.date); app.render(); } }, '이번 주'));
  }

  const viewer = h('div.doc-viewer', sel ? h('p.muted', '불러오는 중…') : h('div.doc-empty',
    h('p', '아직 올린 자료가 없습니다.'),
    h('p.muted.small', '[올리기]로 이미지·PDF 파일을 고르거나, 캡처한 이미지를 이 화면에서 Ctrl+V 로 붙여 넣으세요.')));
  if (sel) {
    store.backend.fileUrl?.(store.year, FOLDER, sel.file).then((url) => {
      if (!url) { viewer.replaceChildren(h('p.err', '파일을 불러오지 못했습니다.')); return; }
      viewer.replaceChildren(/\.pdf$/i.test(sel.file)
        ? h('iframe.doc-frame', { src: url, title: sel.title })
        : h('a', { href: url, target: '_blank', rel: 'noopener', title: '새 창에서 크게 보기' }, h('img.doc-img', { src: url, alt: sel.title })));
    }).catch((e) => viewer.replaceChildren(h('p.err', e.message)));
  }

  // 이번 달 학사일정(텍스트)도 함께
  const monthItems = kind === 'monthly' ? store.work.schedule.filter((x) => x.date.startsWith(period)).sort((a, b) => a.date.localeCompare(b.date)) : [];

  return h('div.schedule-page',
    h('nav.subtabs', KINDS.map(([k, l]) => h(`button${kind === k ? '.active' : ''}`, { onclick: () => { app.docView.kind = k; app.docView.sel = null; app.render(); } }, l))),
    h('section.card',
      h('div.card-head', h('h2', KINDS.find(([k]) => k === kind)[1]),
        h('div.row', { style: { margin: 0 } },
          h('button.primary.small', { onclick: async () => { const f = await pickFile('image/*,application/pdf'); if (f) upload(app, kind, f); } }, '⬆ 올리기'),
          sel ? h('button.small', { onclick: async () => {
            if (!(await confirmDialog('자료 삭제', `"${sel.title}" 을(를) 지울까요?`, '지우기'))) return;
            await store.backend.deleteFile?.(store.year, FOLDER, sel.file);
            store.work.docs = store.work.docs.filter((d) => d !== sel); store.markDirty(); await app.save({ silent: true }); app.render();
          } }, '삭제') : null)),
      nav,
      docs.length > 1 ? h('div.chips', docs.map((d) => h(`button.chip-btn${d === sel ? '.active' : ''}`, { onclick: () => { app.docView.sel = d.file; app.render(); } }, d.title || d.file))) : null,
      h('div.doc-layout',
        viewer,
        monthItems.length ? h('aside.doc-side', h('h3', '이번 달 학사일정'),
          h('ul', monthItems.map((x) => h('li', h('button.link', { onclick: async () => { app.tab = 'notebook'; await app.setDate(x.date); } }, x.date.slice(5)), ' ', h(x.holiday ? 'span.red' : 'span', x.text))))) : null),
      h('p.muted.small', '이미지는 캡처 후 이 화면에서 Ctrl+V 로 바로 붙여 넣을 수 있습니다. 드롭박스는 "학사일정자료" 폴더에 파일로 저장됩니다.')));
}
