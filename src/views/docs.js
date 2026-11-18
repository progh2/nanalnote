// 문서 보관 화면 (학사일정 · 연락): 이미지 / PDF / HWPX 를 올려 두고 틈틈이 보기
// - PDF 는 쪽마다 이미지로 바꿔 바로 보이게 하고, 원본 파일은 언제든 내려받을 수 있다.
// - 계획이 바뀌면 같은 문서의 "개정판"을 올린다 (1판, 2판, …). 예전 판도 볼 수 있다.
// - 학사일정 문서는 AI 로 날짜별 일정을 뽑아 학사일정에 넣을 수 있다(미리 보고 고른 뒤 반영).
import { h, newId, toast, confirmDialog, modal, pickFile, addDays, fmtDate, parseDate, koDate, pad, today, downloadBlob, schoolYearOf, WEEKDAYS } from '../lib/util.js';
import { safeName } from '../lib/photos.js';
import { pdfToImages, hwpxExtract, kindOfFile } from '../lib/docfiles.js';
import { loadAI, aiReady, extractSchedule } from '../lib/ai.js';

const mondayOf = (d) => { const x = parseDate(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return fmtDate(x); };
const seriesKey = (d) => `${d.kind}|${d.period || ''}|${d.title}`;
const pasteHandlers = {};

export const SCHEDULE_DOCS = {
  key: 'schedule', folder: '학사일정자료', ai: true,
  kinds: [['annual', '연간일정'], ['monthly', '월중일정'], ['weekly', '주간업무계획']],
};
export const CONTACT_DOCS = {
  key: 'contacts', folder: '연락처자료', ai: false,
  kinds: [['contacts', '연락처']],
};

const KIND_KEY = (cfg) => `sn:docs:${cfg.key}:kind`;

function viewState(app, cfg) {
  app.docView ||= {};
  // 마지막에 보던 탭(연간/월중/주간)을 기억해서 다시 연다
  const saved = localStorage.getItem(KIND_KEY(cfg));
  const v = (app.docView[cfg.key] ||= { kind: cfg.kinds.some(([k]) => k === saved) ? saved : cfg.kinds[0][0] });
  if (v.kind === 'monthly') v.period = (v.month ||= app.date.slice(0, 7));
  else if (v.kind === 'weekly') v.period = (v.week ||= mondayOf(app.date));
  else v.period = '';
  return v;
}

/** 이 기간에 자료가 없으면 가장 가까운 자료가 있는 기간으로 (처음 들어올 때만) */
function nearestPeriod(app, v) {
  const periods = [...new Set(app.store.work.docs.filter((d) => d.kind === v.kind && d.period).map((d) => d.period))].sort();
  if (!periods.length || periods.includes(v.period)) return null;
  const past = periods.filter((p) => p <= v.period);
  return past.at(-1) || periods[0];
}

const periodText = (kind, p) => (kind === 'weekly' ? `${+p.slice(5, 7)}월 ${+p.slice(8, 10)}일 주` : `${p.slice(0, 4)}년 ${+p.slice(5, 7)}월`);

/** 올릴 때 어느 주(달)의 자료인지 묻는다 */
async function askPeriod(app, v) {
  if (v.kind !== 'weekly' && v.kind !== 'monthly') return v.period;
  const weekly = v.kind === 'weekly';
  const cur = v.period;
  const next = weekly ? addDays(cur, 7) : (() => { const [y, m] = cur.split('-').map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; })();
  const thisNow = weekly ? mondayOf(today()) : today().slice(0, 7);
  const pick = h('input', { type: weekly ? 'date' : 'month', value: cur, 'aria-label': weekly ? '주 고르기' : '달 고르기' });
  const label = (p) => `${periodText(v.kind, p)}${p === thisNow ? ' (이번' + (weekly ? ' 주)' : ' 달)') : ''}`;
  const choice = await modal(weekly ? '어느 주의 주간업무계획인가요?' : '어느 달의 월중일정인가요?',
    h('div', h('p.muted.small', weekly ? '금요일에 다음 주 계획을 올릴 때는 "다음 주"를 고르세요.' : '다음 달 일정을 미리 올릴 때는 "다음 달"을 고르세요.'),
      h('div.row', h('label', '직접 고르기 ', pick))),
    [{ label: '취소', value: null }, { label: label(cur), value: cur }, { label: label(next), value: next, primary: true }, { label: '고른 날짜로', value: 'pick' }]);
  if (choice === 'pick') {
    if (!pick.value) return null;
    return weekly ? mondayOf(pick.value) : pick.value.slice(0, 7);
  }
  return choice;
}

/** 파일 하나를 받아 원본 + 보기용 이미지(+본문)를 저장하고 문서 항목을 만든다 */
async function ingest(app, cfg, file, { series = null, period: forced = undefined } = {}) {
  const { store } = app;
  const v = viewState(app, cfg);
  if (!store.backend.putFile) throw new Error('이 저장소는 파일을 지원하지 않습니다.');
  const type = kindOfFile(file);
  if (type === 'hwp') throw new Error('예전 한글 파일(.hwp)은 열 수 없습니다. 한글에서 "다른 이름으로 저장 → HWPX 또는 PDF"로 저장해 올려 주세요.');
  if (type === 'other') throw new Error('이미지, PDF, HWPX 파일만 올릴 수 있습니다.');
  const kind = series?.kind || v.kind;
  const period = series ? series.period : forced !== undefined ? forced : v.period;
  const label = cfg.kinds.find(([k]) => k === kind)[1];
  const ext = (file.name.match(/\.[^.]+$/)?.[0] || (type === 'image' ? `.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}` : '')).toLowerCase();
  const base = safeName(`${period || store.year}_${label}_${Date.now().toString(36)}`);
  const folder = cfg.folder;
  const put = (name, blob) => store.backend.putFile(store.year, folder, name, blob);

  toast('원본을 올리는 중…');
  const original = `${base}${ext}`;
  await put(original, file);
  const doc = {
    id: newId(), kind, period, file: original, pages: [], src: type, uploaded: today(),
    title: series?.title || ((file.name && !/^image\.\w+$/.test(file.name) ? file.name.replace(/\.[^.]+$/, '') : '') || `${period || `${store.year}학년도`} ${label}`),
    rev: series ? Math.max(...store.work.docs.filter((d) => seriesKey(d) === seriesKey(series)).map((d) => d.rev || 1)) + 1 : 1,
  };
  if (type === 'image') doc.pages = [original];
  if (type === 'pdf') {
    const { images, total } = await pdfToImages(file, { onProgress: (i, n) => toast(`PDF 쪽 이미지 만드는 중… ${i}/${n}`) });
    for (const [i, blob] of images.entries()) {
      const name = `${base}_p${i + 1}.jpg`;
      toast(`쪽 이미지 올리는 중… ${i + 1}/${images.length}`);
      await put(name, blob);
      doc.pages.push(name);
    }
    if (total > images.length) toast(`앞 ${images.length}쪽만 이미지로 만들었습니다 (전체 ${total}쪽, 원본은 그대로 보관).`);
  }
  if (type === 'hwpx') {
    const { text, preview } = await hwpxExtract(file);
    if (preview) { const name = `${base}_미리보기.png`; await put(name, preview); doc.pages.push(name); }
    if (text) { doc.textFile = `${base}_본문.txt`; await put(doc.textFile, new Blob([text], { type: 'text/plain' })); }
  }
  store.work.docs.push(doc);
  store.markDirty();
  await app.save({ silent: true });
  v.sel = seriesKey(doc); v.rev = doc.rev;
  if (kind === 'weekly') v.week = period;
  if (kind === 'monthly') v.month = period;
  toast(series ? `${doc.rev}판을 올렸습니다.` : '올렸습니다.', 'ok');
  return doc;
}

async function blobOf(app, cfg, name) {
  const url = await app.store.backend.fileUrl?.(app.store.year, cfg.folder, name);
  if (!url) throw new Error('파일을 불러오지 못했습니다.');
  return (await fetch(url)).blob();
}

/** AI 로 학사일정 추출 → 미리 보고 골라서 반영 */
export async function aiExtract(app, cfg, doc) {
  const ai = loadAI();
  if (!aiReady(ai)) { toast('설정 > AI 에서 AI 를 먼저 연결하세요.', 'error'); return; }
  const { store } = app;
  toast('AI 가 문서를 읽는 중… (쪽 수에 따라 1분 정도 걸릴 수 있어요)');
  let events;
  try {
    const images = [];
    for (const p of (doc.pages || []).slice(0, 8)) images.push(await blobOf(app, cfg, p));
    const text = doc.textFile ? await (await blobOf(app, cfg, doc.textFile)).text() : '';
    events = await extractSchedule(ai, { images, text, ctx: { year: store.year, kind: doc.kind, period: doc.period } });
  } catch (e) { toast(`AI 추출 실패: ${e.message}`, 'error'); return; }
  if (!events.length) { toast('문서에서 날짜별 일정을 찾지 못했습니다.', 'error'); return; }

  events.sort((a, b) => a.date.localeCompare(b.date));
  const rows = events.map((e) => ({ ...e, on: schoolYearOf(e.date) === store.year }));
  let mode = 'append';
  const body = h('div',
    h('p.muted.small', `${events.length}개 날짜의 일정을 찾았습니다. 확인하고 고친 뒤 [반영]을 누르세요. 다른 학년도 날짜는 빼 두었습니다.`),
    h('div.row', h('label.check', h('input', { type: 'radio', name: 'mode', checked: true, onchange: () => (mode = 'append') }), ' 기존 일정 뒤에 덧붙이기'),
      h('label.check', h('input', { type: 'radio', name: 'mode', onchange: () => (mode = 'replace') }), ' 기존 일정을 바꾸기')),
    h('div.records-wrap', h('table.grid.ai-table',
      h('thead', h('tr', h('th', ''), h('th', '날짜'), h('th', '추출한 일정'), h('th', '지금 학사일정'), h('th', '휴업'))),
      h('tbody', rows.map((r) => h('tr',
        h('td.center', h('input', { type: 'checkbox', checked: r.on, onchange: (e) => (r.on = e.target.checked) })),
        h('td', `${r.date.slice(5)} (${WEEKDAYS[parseDate(r.date).getDay()]})`),
        h('td', h('input', { value: r.text, oninput: (e) => (r.text = e.target.value) })),
        h('td.muted.small', store.scheduleText(r.date)),
        h('td.center', h('input', { type: 'checkbox', checked: r.holiday, onchange: (e) => (r.holiday = e.target.checked) }))))))));
  const ok = await modal('AI 학사일정 추출 결과', body, [{ label: '취소', value: false }, { label: '반영', value: true, primary: true }]);
  if (!ok) return;
  let n = 0;
  for (const r of rows) {
    if (!r.on || !r.text.trim() || schoolYearOf(r.date) !== store.year) continue;
    const cur = store.scheduleText(r.date).trim();
    const parts = cur ? cur.split(/\s*,\s*|\n/) : [];
    const next = mode === 'replace' || !cur ? r.text.trim() : parts.includes(r.text.trim()) || cur.includes(r.text.trim()) ? cur : `${cur}, ${r.text.trim()}`;
    store.setScheduleText(r.date, next);
    if (r.holiday && !store.isSchoolHoliday(r.date)) store.setSchoolHoliday(r.date, true);
    // setSchoolHoliday 가 빈 글을 '휴업일'로 채우므로 추출한 글을 다시 넣는다
    if (r.holiday) store.setScheduleText(r.date, next);
    n++;
  }
  await app.save({ silent: true });
  toast(`학사일정 ${n}일에 반영했습니다.`, 'ok');
  app.render();
}

export function renderDocs(app, cfg, { bottom = null } = {}) {
  const { store } = app;
  const v = viewState(app, cfg);
  const kind = v.kind;
  const label = cfg.kinds.find(([k]) => k === kind)[1];

  const upload = async (file, series = null) => {
    try {
      const period = series ? undefined : await askPeriod(app, v);
      if (period === null) return;
      const doc = await ingest(app, cfg, file, { series, period });
      app.render();
      if (cfg.ai && aiReady() && (await confirmDialog('AI 로 학사일정 넣기', '올린 문서에서 AI 로 날짜별 일정을 뽑아 학사일정에 넣을까요? (반영 전에 미리 보고 고를 수 있어요)', '추출하기'))) aiExtract(app, cfg, doc);
    } catch (e) { toast(e.message, 'error'); }
  };

  // 붙여넣기(Ctrl+V) / 끌어다 놓기
  if (pasteHandlers[cfg.key]) document.removeEventListener('paste', pasteHandlers[cfg.key]);
  pasteHandlers[cfg.key] = (e) => {
    if (app.tab !== cfg.key) return;
    if (e.target.closest?.('textarea, input')) return;
    const file = [...(e.clipboardData?.files || [])][0];
    if (!file) return;
    e.preventDefault();
    upload(file);
  };
  document.addEventListener('paste', pasteHandlers[cfg.key]);

  // 기간 이동
  let nav = null;
  if (kind === 'monthly') {
    const [y, m] = v.period.split('-').map(Number);
    const shift = (n) => { const d = new Date(y, m - 1 + n, 1); v.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; v.sel = null; app.render(); };
    nav = h('div.row', h('button.icon-btn', { onclick: () => shift(-1) }, '◀'), h('strong', `${y}년 ${m}월`), h('button.icon-btn', { onclick: () => shift(1) }, '▶'),
      h('button.small', { onclick: () => { v.month = app.date.slice(0, 7); v.sel = null; app.render(); } }, '이번 달'));
  } else if (kind === 'weekly') {
    const shift = (n) => { v.week = addDays(v.period, 7 * n); v.sel = null; app.render(); };
    nav = h('div.row', h('button.icon-btn', { onclick: () => shift(-1) }, '◀'), h('strong', `${koDate(v.period)} 주`), h('button.icon-btn', { onclick: () => shift(1) }, '▶'),
      h('button.small', { onclick: () => { v.week = mondayOf(app.date); v.sel = null; app.render(); } }, '이번 주'));
  }

  // 처음 들어왔는데 이 기간 자료가 없으면 가장 가까운 자료를 보여 준다
  let fallbackNote = null;
  if (!v.entered && (kind === 'weekly' || kind === 'monthly')) {
    v.entered = true;
    const near = nearestPeriod(app, v);
    if (near) {
      const was = v.period;
      if (kind === 'weekly') v.week = near; else v.month = near;
      v.period = near;
      fallbackNote = h('p.fallback-note', `${kind === 'weekly' ? '이번 주' : '이번 달'}(${periodText(kind, was)}) 자료가 없어 가장 가까운 ${periodText(kind, near)} 자료를 보여 드려요. `,
        h('button.link', { onclick: () => { if (kind === 'weekly') v.week = was; else v.month = was; app.render(); } }, kind === 'weekly' ? '이번 주로' : '이번 달로'));
    }
  }
  // 최근 자료 바로가기
  const recent = (kind === 'weekly' || kind === 'monthly')
    ? [...new Set(store.work.docs.filter((d) => d.kind === kind && d.period).map((d) => d.period))].sort().reverse().slice(0, 6) : [];

  // 이 기간의 문서들 (같은 제목 = 같은 문서의 판들)
  const docs = store.work.docs.filter((d) => d.kind === kind && (d.period || '') === v.period);
  const series = [...new Map(docs.map((d) => [seriesKey(d), d])).keys()];
  const curKey = series.includes(v.sel) ? v.sel : series.at(-1);
  const revs = docs.filter((d) => seriesKey(d) === curKey).sort((a, b) => (a.rev || 1) - (b.rev || 1));
  const doc = revs.find((d) => (d.rev || 1) === v.rev) || revs.at(-1);

  const viewer = h('div.doc-viewer');
  if (!doc) {
    viewer.append(h('div.doc-empty', h('p', `아직 올린 ${label} 자료가 없습니다.`),
      h('p.muted.small', '[올리기]로 이미지·PDF·HWPX 파일을 고르거나, 캡처한 이미지를 이 화면에서 Ctrl+V 로 붙여 넣으세요.')));
  } else {
    const pages = doc.pages || [];
    if (!pages.length && !doc.textFile) viewer.append(h('p.muted', '미리보기가 없습니다. [원본 받기]로 파일을 내려받아 보세요.'));
    const pageBox = h('div.doc-pages');
    viewer.append(pageBox);
    // 쪽마다 자리를 먼저 만들고, 이미지는 동시에(최대 4개씩) 받아 채운다 → 드롭박스에서도 빨리 보임
    const slots = pages.map((_, i) => { const el = h('div.doc-slot', `${i + 1}쪽 불러오는 중…`); pageBox.append(el); return el; });
    (async () => {
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, pages.length) }, async () => {
        while (next < pages.length) {
          const i = next++;
          const url = await store.backend.fileUrl?.(store.year, cfg.folder, pages[i]).catch(() => null);
          slots[i].replaceWith(url
            ? h('a', { href: url, target: '_blank', rel: 'noopener', title: `${i + 1}쪽 크게 보기` }, h('img.doc-img', { src: url, alt: `${doc.title} ${i + 1}쪽` }))
            : h('div.doc-slot.err', `${i + 1}쪽을 불러오지 못했습니다`));
        }
      }));
      if (doc.textFile) {
        const url = await store.backend.fileUrl?.(store.year, cfg.folder, doc.textFile).catch(() => null);
        if (url) pageBox.append(h('details.doc-text', { open: !pages.length }, h('summary', '문서 본문 (HWPX 에서 뽑은 글)'), h('pre', await (await fetch(url)).text())));
      }
    })();
  }

  const btns = h('div.row', { style: { margin: 0 } },
    h('button.primary.small', { onclick: async () => { const f = await pickFile('image/*,application/pdf,.pdf,.hwpx'); if (f) upload(f); } }, '⬆ 올리기'),
    doc ? h('button.small', { title: '계획이 바뀌었을 때 같은 문서의 새 판을 올립니다', onclick: async () => { const f = await pickFile('image/*,application/pdf,.pdf,.hwpx'); if (f) upload(f, doc); } }, '🔄 개정판 올리기') : null,
    doc ? h('button.small', { onclick: async () => {
      try { downloadBlob(await blobOf(app, cfg, doc.file), `${safeName(doc.title)}${(doc.rev || 1) > 1 ? `_${doc.rev}판` : ''}${doc.file.match(/\.[^.]+$/)?.[0] || ''}`); } catch (e) { toast(e.message, 'error'); }
    } }, '⬇ 원본 받기') : null,
    doc && cfg.ai ? h('button.small', { onclick: () => aiExtract(app, cfg, doc) }, '🤖 AI 로 학사일정 넣기') : null,
    doc ? h('button.small', { onclick: async () => {
      if (!(await confirmDialog('자료 삭제', `"${doc.title}"${revs.length > 1 ? ` ${doc.rev || 1}판` : ''}을(를) 지울까요?`, '지우기'))) return;
      for (const f of new Set([doc.file, ...(doc.pages || []), doc.textFile].filter(Boolean))) await store.backend.deleteFile?.(store.year, cfg.folder, f);
      store.work.docs = store.work.docs.filter((d) => d !== doc); store.markDirty(); await app.save({ silent: true }); v.rev = null; app.render();
    } }, '삭제') : null);

  // 이번 달 학사일정(텍스트)도 함께
  const monthItems = kind === 'monthly' ? store.work.schedule.filter((x) => x.date.startsWith(v.period)).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const weekItems = kind === 'weekly' ? store.work.schedule.filter((x) => x.date >= v.period && x.date <= addDays(v.period, 6)).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const sideItems = [...monthItems, ...weekItems];

  return h('div.schedule-page',
    cfg.kinds.length > 1 ? h('nav.subtabs', cfg.kinds.map(([k, l]) => h(`button${kind === k ? '.active' : ''}`, { onclick: () => { v.kind = k; v.sel = null; v.rev = null; v.entered = false; localStorage.setItem(KIND_KEY(cfg), k); app.render(); } }, l))) : null,
    h('section.card',
      h('div.card-head', h('h2', label), btns),
      nav,
      fallbackNote,
      recent.length ? h('div.chips.recent-periods', h('span.small.muted', '최근 자료: '), recent.map((p) => h(`button.chip-btn${p === v.period ? '.active' : ''}`, { onclick: () => { if (kind === 'weekly') v.week = p; else v.month = p; v.sel = null; v.rev = null; app.render(); } }, periodText(kind, p)))) : null,
      series.length > 1 ? h('div.chips', series.map((k) => {
        const latest = docs.filter((d) => seriesKey(d) === k).sort((a, b) => (b.rev || 1) - (a.rev || 1))[0];
        return h(`button.chip-btn${k === curKey ? '.active' : ''}`, { onclick: () => { v.sel = k; v.rev = null; app.render(); } }, latest.title);
      })) : null,
      revs.length > 1 ? h('div.chips.revs', h('span.small.muted', '판: '), revs.map((d, i) => h(`button.chip-btn${d === doc ? '.active' : ''}`, { onclick: () => { v.sel = curKey; v.rev = d.rev || 1; app.render(); } },
        `${d.rev || 1}판${i === revs.length - 1 ? ' (최신)' : ''}`, h('small', ` ${d.uploaded || ''}`)))) : null,
      doc ? h('p.muted.small', `${doc.title}${(doc.rev || 1) > 1 ? ` · ${doc.rev}판` : ''} · ${{ pdf: 'PDF', image: '이미지', hwpx: 'HWPX' }[doc.src] || ''}${doc.uploaded ? ` · ${doc.uploaded} 올림` : ''}${doc.pages?.length > 1 ? ` · ${doc.pages.length}쪽` : ''}`) : null,
      h('div.doc-layout',
        viewer,
        sideItems.length ? h('aside.doc-side', h('h3', kind === 'weekly' ? '이번 주 학사일정' : '이번 달 학사일정'),
          h('ul', sideItems.map((x) => h('li', h('button.link', { onclick: async () => { app.tab = 'notebook'; await app.setDate(x.date); } }, `${x.date.slice(5)}(${WEEKDAYS[parseDate(x.date).getDay()]})`), ' ', h(x.holiday ? 'span.red' : 'span', x.text))))) : null),
      h('p.muted.small', `PDF 는 쪽마다 이미지로 바꿔 보여 주고 원본은 [원본 받기]로 언제든 내려받을 수 있습니다. 캡처 이미지는 Ctrl+V 로 붙여 넣을 수 있어요. 드롭박스는 "${cfg.folder}" 폴더에 저장됩니다.`)),
    bottom);
}

// ---------- 화면들 ----------
export const renderSchedule = (app) => renderDocs(app, SCHEDULE_DOCS);

export function renderContacts(app) {
  const { store } = app;
  const memo = h('textarea.contact-memo', {
    rows: 12, value: store.settings.contactMemo || '',
    placeholder: '각종 관계자 연락처를 자유롭게 적어 두세요.\n예)\n행정실 김○○ 주무관 내선 201\n보건실 내선 105\n방과후 코디네이터 010-0000-0000',
    oninput: (e) => store.updateSettings({ contactMemo: e.target.value }),
  });
  const bottom = h('section.card',
    h('div.card-head', h('h2', '관계자 연락처 메모')),
    memo,
    h('p.muted.small', '자동 저장됩니다. 학년도별로 따로 보관됩니다.'));
  return renderDocs(app, CONTACT_DOCS, { bottom });
}
