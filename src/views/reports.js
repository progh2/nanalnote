// 보고서 탭: 캘린더, 학생출결 모아보기, 수업일지(과목별), 상담일지(학생별), 학급요록 모아보기, 기간지정 다운로드
import { h, fmtDate, parseDate, today, yearRange, addDays, koDate, downloadBlob, toast, WEEKDAYS, pad } from '../lib/util.js';
import { ATT_TYPES } from '../store.js';
import { exportRange, exportLessons, exportCounsel, exportAttendance, exportRecord } from '../lib/export.js';

const TABS = [['calendar', '캘린더'], ['attendance', '학생출결'], ['lessons', '수업일지'], ['counsel', '상담일지'], ['records', '학급요록'], ['range', '기간지정 다운로드']];

export function renderReports(app) {
  const views = { calendar, attendance, lessons, counsel, records, range };
  return h('div.reports',
    h('nav.subtabs', TABS.map(([k, l]) => h(`button${app.reportTab === k ? '.active' : ''}`, { onclick: () => { app.reportTab = k; app.render(); } }, l))),
    views[app.reportTab](app));
}

const goto = async (app, d) => { app.tab = 'notebook'; await app.setDate(d); app.render(); };

function dateRangeInputs(state, onChange) {
  return h('div.row.range-inputs',
    h('label', '시작 ', h('input', { type: 'date', value: state.start, onchange: (e) => { state.start = e.target.value; onChange(); } })),
    h('label', '종료 ', h('input', { type: 'date', value: state.end, onchange: (e) => { state.end = e.target.value; onChange(); } })));
}

// ---------- 캘린더 ----------
function calendar(app) {
  const { store } = app;
  app.calMonth ||= app.date.slice(0, 7);
  const [y, m] = app.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDate = addDays(fmtDate(first), -first.getDay());
  const grid = h('div.cal-grid', WEEKDAYS.map((w, i) => h(`div.cal-wd${i === 0 ? '.sun' : i === 6 ? '.sat' : ''}`, w)));
  const cells = new Map();
  const t = today();
  for (let i = 0; i < 42; i++) {
    const d = addDays(startDate, i);
    const dd = parseDate(d);
    const cls = ['cal-cell'];
    if (dd.getMonth() !== m - 1) cls.push('other');
    if (dd.getDay() === 0) cls.push('sun');
    if (dd.getDay() === 6) cls.push('sat');
    if (d === t) cls.push('today');
    if (d === app.date) cls.push('selected');
    const marks = [];
    if (store.work.lessons.some((l) => l.date === d && l.content)) marks.push(h('span.dot.lesson', { title: '수업일지' }));
    if (store.work.counsel.some((c) => c.date === d)) marks.push(h('span.dot.counsel', { title: '상담일지' }));
    if (store.work.attendance.some((a) => a.date === d)) marks.push(h('span.dot.att', { title: '출결' }));
    const sched = store.scheduleText(d);
    const specials = h('div.cal-specials');
    const cell = h(`div.${cls.join('.')}`, { title: '더블클릭하면 이 날짜의 교사수첩으로 이동', ondblclick: () => goto(app, d), tabindex: 0, onkeydown: (e) => e.key === 'Enter' && goto(app, d) },
      h('div.cal-num', String(dd.getDate()), h('span.marks', marks)),
      specials,
      sched ? h('div.cal-sched', sched) : null);
    cells.set(d, { cell, specials });
    grid.append(cell);
  }
  // 특일 정보는 비동기로 채움 (앞뒤 달 포함)
  const months = new Set([...cells.keys()].map((d) => d.slice(0, 7)));
  for (const ym of months) {
    const [yy, mm] = ym.split('-').map(Number);
    app.monthSpecials(yy, mm).then((list) => {
      for (const x of list) {
        const c = cells.get(x.date);
        if (!c) continue;
        if (x.holiday) c.cell.classList.add('holiday');
        c.specials.append(h(`div${x.holiday ? '.red' : ''}`, x.name));
      }
    });
  }
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1); app.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; app.render(); };
  return h('section.card.calendar',
    h('div.card-head',
      h('div.row', h('button.icon-btn', { onclick: () => shift(-1) }, '◀'), h('h2', `${y}년 ${m}월`), h('button.icon-btn', { onclick: () => shift(1) }, '▶'),
        h('button.ghost.small', { onclick: () => { app.calMonth = today().slice(0, 7); app.render(); } }, '이번 달')),
      h('div.legend', h('span.dot.lesson'), '수업 ', h('span.dot.counsel'), '상담 ', h('span.dot.att'), '출결')),
    grid,
    h('p.muted.small', '날짜를 더블클릭하면 그 날의 교사수첩으로 이동합니다. 공휴일은 빨간색, 오늘은 파란색으로 표시됩니다.'));
}

// ---------- 학생출결 ----------
function attendance(app) {
  const { store } = app;
  const yr = yearRange(store.year);
  app.attRange ||= { start: yr.start, end: yr.end };
  const st = app.attRange;
  const wrap = h('div');
  const draw = () => {
    const rows = store.work.attendance.filter((a) => a.date >= st.start && a.date <= st.end).sort((a, b) => (a.date + a.student).localeCompare(b.date + b.student));
    const names = store.studentNames();
    const count = (n, type) => rows.filter((a) => a.student === n && a.type === type);
    const cellFor = (n, type) => {
      const list = count(n, type);
      if (!list.length) return h('td.center.muted', '·');
      const by = {};
      for (const a of list) by[a.reason || '-'] = (by[a.reason || '-'] || 0) + 1;
      return h('td.center', { title: Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') }, String(list.length), h('div.small.muted', Object.entries(by).map(([k, v]) => `${k}${v}`).join(' ')));
    };
    wrap.replaceChildren(
      h('table.grid', h('thead', h('tr', h('th', '학생'), ATT_TYPES.map((t) => h('th', t)), h('th', '합계'))),
        h('tbody', names.map((n) => h('tr', h('th', n), ATT_TYPES.map((t) => cellFor(n, t)), h('td.center', String(rows.filter((a) => a.student === n).length)))))),
      h('h3', `상세 내역 (${rows.length}건)`),
      rows.length ? h('table.grid', h('thead', h('tr', h('th', '날짜'), h('th', '학생'), h('th', '구분'), h('th', '사유'), h('th', '비고'))),
        h('tbody', rows.map((a) => h('tr', h('td', h('button.link', { onclick: () => goto(app, a.date) }, a.date)), h('td', a.student), h('td', a.type), h('td', a.reason), h('td', a.note)))))
        : h('p.muted', '해당 기간의 출결 기록이 없습니다.'),
    );
    wrap.rows = rows;
  };
  draw();
  return h('section.card',
    h('div.card-head', h('h2', '학생출결 모아보기'),
      h('button.small', { onclick: async () => downloadBlob(await exportAttendance(wrap.rows, st), `학생출결_${st.start}_${st.end}.docx`) }, '⬇ Word')),
    dateRangeInputs(st, draw), wrap);
}

// ---------- 수업일지 (과목별) ----------
function lessons(app) {
  const { store } = app;
  const subjects = [...new Set(store.work.lessons.map((l) => l.subject).filter(Boolean))].sort();
  app.lessonSubject ??= subjects[0] || '';
  const yr = yearRange(store.year);
  app.lessonRange ||= { start: yr.start, end: yr.end };
  const st = app.lessonRange;
  const list = () => store.work.lessons
    .filter((l) => (!app.lessonSubject || l.subject === app.lessonSubject) && (l.content || '').trim() && l.date >= st.start && l.date <= st.end)
    .sort((a, b) => (a.date + pad(a.period)).localeCompare(b.date + pad(b.period)));
  const wrap = h('div');
  const draw = () => {
    const rows = list();
    wrap.replaceChildren(rows.length
      ? h('table.grid', h('thead', h('tr', h('th', { style: { width: '11em' } }, '날짜'), h('th', { style: { width: '4em' } }, '교시'), h('th', { style: { width: '8em' } }, '과목'), h('th', '내용'))),
        h('tbody', rows.map((l) => h('tr', h('td', h('button.link', { onclick: () => goto(app, l.date) }, koDate(l.date))), h('td.center', String(l.period)), h('td', l.subject), h('td.pre', l.content)))))
      : h('p.muted', '해당 조건의 수업일지가 없습니다.'));
  };
  draw();
  return h('section.card',
    h('div.card-head', h('h2', '수업일지 모아보기'),
      h('button.small', { onclick: async () => downloadBlob(await exportLessons(store, app.lessonSubject, list()), `수업일지_${app.lessonSubject || '전체'}.docx`) }, '⬇ Word')),
    h('div.row',
      h('label', '과목 ', h('select', { onchange: (e) => { app.lessonSubject = e.target.value; draw(); } },
        h('option', { value: '' }, '전체'), subjects.map((s) => h('option', { value: s, selected: s === app.lessonSubject }, s)))),
      dateRangeInputs(st, draw)),
    wrap);
}

// ---------- 상담일지 (학생별) ----------
function counsel(app) {
  const { store } = app;
  const names = store.studentNames();
  app.counselStudent ||= names[0] || '';
  const wrap = h('div');
  const draw = () => {
    const items = app.counselStudent ? store.counselFor(app.counselStudent) : [];
    wrap.replaceChildren(items.length
      ? h('div.counsel-list', items.map((c) => h('div.counsel-item', h('button.link', { onclick: () => goto(app, c.date) }, koDate(c.date)), h('p', c.text))))
      : h('p.muted', '기록된 상담 일지가 없습니다.'));
  };
  draw();
  const counts = Object.fromEntries(names.map((n) => [n, store.counselFor(n).length]));
  return h('section.card.private-report',
    h('div.card-head', h('h2', '학생별 상담 일지'),
      h('button.small', { onclick: async () => downloadBlob(await exportCounsel(app.counselStudent, store.counselFor(app.counselStudent)), `상담일지_${app.counselStudent}.docx`) }, '⬇ Word')),
    h('div.chips', names.map((n) => h(`button.chip-btn${n === app.counselStudent ? '.active' : ''}`, { onclick: () => { app.counselStudent = n; app.render(); } }, `${n} `, h('small', String(counts[n]))))),
    wrap);
}

// ---------- 학급요록 모아보기 ----------
function records(app) {
  const { store } = app;
  const titles = [...new Set(store.work.records.map((r) => r.title).filter(Boolean))];
  app.recordTitle ||= titles[0] || '';
  const recs = store.work.records.filter((r) => r.title === app.recordTitle).sort((a, b) => a.created.localeCompare(b.created));
  const names = store.studentNames();
  return h('section.card',
    h('div.card-head', h('h2', '학급요록 모아보기')),
    h('p.muted.small', '이름이 같은 요록끼리 모아 봅니다. (예: 매주 "독서록" 이라는 같은 이름으로 만들기)'),
    titles.length ? h('div.chips', titles.map((t) => h(`button.chip-btn${t === app.recordTitle ? '.active' : ''}`, { onclick: () => { app.recordTitle = t; app.render(); } }, t))) : h('p.muted', '작성된 학급요록이 없습니다.'),
    recs.length ? h('div.records-wrap', h('table.grid.records',
      h('thead', h('tr', h('th.sticky', '학생'), recs.map((r) => h('th', `${r.created}${r.doneDate ? ' ✓' : ''}`, h('button.icon-btn', { title: 'Word 다운로드', onclick: async () => downloadBlob(await exportRecord(store, r), `학급요록_${r.title}_${r.created}.docx`) }, '⬇'))))),
      h('tbody', names.map((n) => h('tr', h('th.sticky', n), recs.map((r) => h('td', r.entries?.[n] || ''))))))) : null);
}

// ---------- 기간지정 다운로드 ----------
function range(app) {
  const { store } = app;
  if (!app.dlRange) {
    // 기본값: 전월
    const d = parseDate(today());
    const s = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const e = new Date(d.getFullYear(), d.getMonth(), 0);
    app.dlRange = { start: fmtDate(s), end: fmtDate(e), includeIncomplete: false };
  }
  const st = app.dlRange;
  const datesWithContent = () => {
    const set = new Set();
    for (const col of ['days', 'lessons', 'counsel', 'attendance', 'schedule']) for (const x of store.work[col]) if (x.date) set.add(x.date);
    for (const t of store.work.tasks) { if (t.doneDate) set.add(t.doneDate); }
    return [...set].filter((d) => d >= st.start && d <= st.end).sort();
  };
  const info = h('p.muted');
  const upd = () => { info.textContent = `작성된 일지 ${datesWithContent().length}일분`; };
  upd();
  const btn = h('button.primary', { onclick: async () => {
    const dates = datesWithContent();
    if (!dates.length) return toast('해당 기간에 작성된 일지가 없습니다.', 'error');
    btn.disabled = true; btn.classList.add('busy'); btn.textContent = '만드는 중…';
    try {
      const blob = await exportRange(store, dates, (d) => app.specials(d), { includeIncomplete: st.includeIncomplete });
      downloadBlob(blob, `교사수첩_${st.start}_${st.end}.docx`);
    } finally { btn.disabled = false; btn.classList.remove('busy'); btn.textContent = '⬇ Word 다운로드'; }
  } }, '⬇ Word 다운로드');
  return h('section.card',
    h('div.card-head', h('h2', '교사수첩 기간지정 다운로드')),
    h('p.muted.small', '여러 날짜의 일지를 한 파일로 내려받습니다. 매월 또는 학기별로 내려받아 결재를 올리는 것을 추천합니다. 문서 꼬리말 특성상 최종수정일시는 제외되며, 기본적으로 완료 체크된 업무일지만 포함됩니다.'),
    h('div.row',
      h('button.small', { onclick: () => { const r = yearRange(store.year); st.start = r.start; st.end = r.end; app.render(); } }, '학년도 전체'),
      h('button.small', { onclick: () => { const d = parseDate(today()); st.start = fmtDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)); st.end = fmtDate(new Date(d.getFullYear(), d.getMonth(), 0)); app.render(); } }, '전월'),
      h('button.small', { onclick: () => { const d = parseDate(today()); st.start = fmtDate(new Date(d.getFullYear(), d.getMonth(), 1)); st.end = today(); app.render(); } }, '이번 달')),
    dateRangeInputs(st, upd),
    h('label.check', h('input', { type: 'checkbox', checked: st.includeIncomplete, onchange: (e) => { st.includeIncomplete = e.target.checked; } }), ' 미완료 업무일지 포함'),
    info,
    h('div.row', btn));
}
