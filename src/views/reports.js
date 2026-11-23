// 보고서 탭: 캘린더, 학생출결, 수업일지(수업·학반별), 상담일지(학생별), 학급요록, 출장, 학생 활동(대회·활동), 기간지정 다운로드
import { h, fmtDate, parseDate, today, yearRange, addDays, koDate, downloadBlob, toast, WEEKDAYS, pad, fill } from '../lib/util.js';
import { ATT_TYPES } from '../store.js';
import { exportRange, exportLessons, exportCounsel, exportAttendance, exportRecord, exportTrips } from '../lib/export.js';
import { studentLabel, classKey } from '../lib/students.js';
import { classSelect } from './ui.js';
import { activityRows, ACTIVITY_HEAD, activityRowCells, spanOf, KINDS } from '../lib/contests.js';
import { xlsxBlob } from '../lib/xlsx.js';
import { openContest } from './contests.js';
import { mentionInline } from './mentions.js';

const TABS = [['calendar', '캘린더'], ['attendance', '학생출결'], ['lessons', '수업일지'], ['counsel', '상담일지'], ['records', '학급요록'], ['trips', '출장'], ['tasks', '업무일지'], ['activities', '학생 활동'], ['range', '기간지정 다운로드']];

export function renderReports(app) {
  const views = { calendar, attendance, lessons, counsel, records, trips, tasks, activities, range };
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
    if (store.isSchoolHoliday(d)) cls.push('school-holiday');
    const trips = store.tripsOn(d);
    const dues = store.work.tasks.filter((x) => x.due === d && (x.text || '').trim());
    const sched = store.scheduleText(d);
    const specials = h('div.cal-specials');
    const cell = h(`div.${cls.join('.')}`, { title: '더블클릭하면 이 날짜의 교사수첩으로 이동', ondblclick: () => goto(app, d), tabindex: 0, onkeydown: (e) => e.key === 'Enter' && goto(app, d) },
      h('div.cal-num', String(dd.getDate()), h('span.marks', marks)),
      specials,
      sched ? h(`div.cal-sched${store.isSchoolHoliday(d) ? '.red' : ''}`, sched) : null,
      store.isCsat(d) ? h('div.csat-cal', '수능대비 시간표') : null,
      trips.length ? h('div.trip', `🚗 출장${trips[0].place ? ` ${trips[0].place}` : ''}${trips.length > 1 ? ` 외 ${trips.length - 1}` : ''}`) : null,
      dues.map((x) => h(`div.due-cal${x.doneDate ? '.done' : ''}`, { title: `마감: ${x.text}` }, `📌${x.priority && x.priority !== 'Z' ? `[${x.priority}]` : ''} ${x.text}`)));
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
      h('div.legend', h('span.dot.lesson'), '수업 ', h('span.dot.counsel'), '상담 ', h('span.dot.att'), '출결 · 🚗 출장 · 📌 업무 마감')),
    grid,
    h('p.muted.small', '날짜를 더블클릭하면 그 날의 교사수첩으로 이동합니다. 공휴일과 학교 휴업일은 빨간색, 오늘은 파란색으로 표시됩니다.'));
}

// ---------- 학생출결 (수업별 시수) ----------
function attendance(app) {
  const { store } = app;
  const yr = yearRange(store.year);
  app.attRange ||= { start: yr.start, end: yr.end, cls: '', subject: '' };
  const st = app.attRange;
  const subjects = [...new Set(store.work.attendance.map((a) => a.subject).filter(Boolean))].sort();
  const wrap = h('div');
  // 한 기록의 시수: 수업별 기록이면 교시 수, 종일 기록이면 1
  const hours = (a) => (a.periods?.length || 1);
  const draw = () => {
    const studs = store.studentsOf(st.cls);
    const inCls = new Set(studs.map((x) => x.uid));
    const rows = store.work.attendance.filter((a) => a.date >= st.start && a.date <= st.end && (!st.cls || inCls.has(a.student) || a.cls === st.cls) && (!st.subject || a.subject === st.subject))
      .sort((a, b) => (a.date + (a.periods?.[0] ?? 0) + store.label(a.student)).localeCompare(b.date + (b.periods?.[0] ?? 0) + store.label(b.student)));
    const cellFor = (uid, type) => {
      const list = rows.filter((a) => a.student === uid && a.type === type);
      if (!list.length) return h('td.center.muted', '·');
      const by = {};
      for (const a of list) by[a.reason || '-'] = (by[a.reason || '-'] || 0) + hours(a);
      return h('td.center', String(list.reduce((n, a) => n + hours(a), 0)), h('div.small.muted', Object.entries(by).map(([k, v]) => `${k}${v}`).join(' ')));
    };
    const withRec = studs.filter((x) => rows.some((a) => a.student === x.uid));
    fill(wrap, 
      h('label.check.small', h('input', { type: 'checkbox', checked: !!st.onlyRec, onchange: (e) => { st.onlyRec = e.target.checked; draw(); } }), ' 기록 있는 학생만'),
      h('p.muted.small', '숫자는 시수(빠진 교시 수)입니다. 수업을 정하지 않은 "종일" 기록은 1로 셉니다.'),
      h('table.grid', h('thead', h('tr', h('th', '학생'), ATT_TYPES.map((t) => h('th', t)), h('th', '합계(시수)'))),
        h('tbody', (st.onlyRec ? withRec : studs).map((x) => h('tr', h('th', studentLabel(x)), ATT_TYPES.map((t) => cellFor(x.uid, t)),
          h('td.center', String(rows.filter((a) => a.student === x.uid).reduce((n, a) => n + hours(a), 0))))))),
      h('h3', `상세 내역 (${rows.length}건)`),
      rows.length ? h('table.grid', h('thead', h('tr', h('th', '날짜'), h('th', '수업'), h('th', '학생'), h('th', '구분'), h('th', '사유'), h('th', '비고'))),
        h('tbody', rows.map((a) => h('tr', h('td', h('button.link', { onclick: () => goto(app, a.date) }, a.date)),
          h('td', a.periods?.length ? `${a.periods.join('·')}교시 ${a.subject || ''} ${a.cls || ''}` : '종일'),
          h('td', store.label(a.student)), h('td', a.type), h('td', a.reason), h('td', a.note)))))
        : h('p.muted', '해당 조건의 출결 기록이 없습니다.'),
    );
    wrap.rows = rows;
  };
  draw();
  return h('section.card',
    h('div.card-head', h('h2', '학생출결 모아보기'),
      h('button.small', { onclick: async () => downloadBlob(await exportAttendance(wrap.rows.map((a) => ({ ...a, student: store.label(a.student) })), st), `학생출결_${[st.subject, st.cls].filter(Boolean).join('_') || '전체'}_${st.start}_${st.end}.docx`) }, '⬇ Word')),
    h('div.row',
      store.classList().length ? classSelect(store, st.cls, (v) => { st.cls = v; draw(); }) : null,
      subjects.length ? h('select', { 'aria-label': '수업명', onchange: (e) => { st.subject = e.target.value; draw(); } }, h('option', { value: '' }, '모든 수업'), subjects.map((x) => h('option', { value: x, selected: x === st.subject }, x))) : null,
      dateRangeInputs(st, draw)), wrap);
}

// ---------- 수업일지 (수업명·학반별) ----------
function lessons(app) {
  const { store } = app;
  const sec = store.settings.schoolLevel === 'secondary';
  const subjects = [...new Set(store.work.lessons.map((l) => l.subject).filter(Boolean))].sort();
  const classes = [...new Set(store.work.lessons.map((l) => l.cls).filter(Boolean))].sort();
  const yr = yearRange(store.year);
  app.lessonRange ||= { start: yr.start, end: yr.end, subject: subjects[0] || '', cls: '' };
  const st = app.lessonRange;
  const list = () => store.work.lessons
    .filter((l) => (!st.subject || l.subject === st.subject) && (!st.cls || l.cls === st.cls) && (l.content || '').trim() && l.date >= st.start && l.date <= st.end)
    .sort((a, b) => (a.date + pad(a.period)).localeCompare(b.date + pad(b.period)));
  const wrap = h('div');
  const draw = () => {
    const rows = list();
    fill(wrap, rows.length
      ? h('table.grid', h('thead', h('tr', h('th', { style: { width: '11em' } }, '날짜'), h('th', { style: { width: '5.5em' } }, '교시'), h('th', { style: { width: '8em' } }, sec ? '수업명' : '과목'),
        sec ? h('th', { style: { width: '4.5em' } }, '학반') : null, sec ? h('th', { style: { width: '6em' } }, '교실') : null, h('th', '내용'))),
        h('tbody', rows.map((l) => h('tr', h('td', h('button.link', { onclick: () => goto(app, l.date) }, koDate(l.date))), h('td.center', store.periodLabel(l.period)), h('td', l.subject),
          sec ? h('td.center', l.cls || '') : null, sec ? h('td', l.room || '') : null, h('td.pre', l.content)))))
      : h('p.muted', '해당 조건의 수업일지가 없습니다.'));
  };
  draw();
  const sel = (label, val, opts, on) => h('label', `${label} `, h('select', { onchange: (e) => { on(e.target.value); draw(); } }, h('option', { value: '' }, '전체'), opts.map((x) => h('option', { value: x, selected: x === val }, x))));
  const title = [st.subject, st.cls].filter(Boolean).join('_') || '전체';
  return h('section.card',
    h('div.card-head', h('h2', '수업일지 모아보기'),
      h('button.small', { onclick: async () => downloadBlob(await exportLessons(store, [st.subject, st.cls].filter(Boolean).join(' ') || '전체', list()), `수업일지_${title}.docx`) }, '⬇ Word')),
    h('div.row',
      sel(sec ? '수업명' : '과목', st.subject, subjects, (v) => (st.subject = v)),
      sec ? sel('학반', st.cls, classes, (v) => (st.cls = v)) : null,
      dateRangeInputs(st, draw)),
    wrap);
}

// ---------- 상담일지 (학생별) ----------
function counsel(app) {
  const { store } = app;
  app.counselView ||= { cls: '', uid: '' };
  const cv = app.counselView;
  const studs = store.studentsOf(cv.cls);
  const counts = Object.fromEntries(studs.map((x) => [x.uid, store.counselFor(x.uid).length]));
  if (!studs.some((x) => x.uid === cv.uid)) cv.uid = (studs.find((x) => counts[x.uid]) || studs[0])?.uid || '';
  const items = cv.uid ? store.counselFor(cv.uid) : [];
  const label = store.label(cv.uid);
  return h('section.card.private-report',
    h('div.card-head', h('h2', '학생별 상담 일지'),
      h('button.small', { onclick: async () => downloadBlob(await exportCounsel(label, items), `상담일지_${label}.docx`) }, '⬇ Word')),
    store.classList().length ? h('div.row', classSelect(store, cv.cls, (v) => { cv.cls = v; app.render(); })) : null,
    h('div.chips', studs.map((x) => h(`button.chip-btn${x.uid === cv.uid ? '.active' : ''}${counts[x.uid] ? '' : '.dim'}`, { onclick: () => { cv.uid = x.uid; app.render(); } }, `${studentLabel(x)} `, h('small', String(counts[x.uid]))))),
    items.length
      ? h('div.counsel-list', items.map((c) => h('div.counsel-item', h('button.link', { onclick: () => goto(app, c.date) }, koDate(c.date)), h('p', c.text))))
      : h('p.muted', '기록된 상담 일지가 없습니다.'));
}

// ---------- 학급요록 모아보기 ----------
function records(app) {
  const { store } = app;
  const key = (r) => `${r.title}\u0000${r.cls || ''}`;
  const groups = [...new Map(store.work.records.filter((r) => r.title).map((r) => [key(r), { title: r.title, cls: r.cls || '' }])).values()];
  if (!groups.some((g) => `${g.title}\u0000${g.cls}` === app.recordKey)) app.recordKey = groups[0] ? `${groups[0].title}\u0000${groups[0].cls}` : '';
  const recs = store.work.records.filter((r) => key(r) === app.recordKey).sort((a, b) => a.created.localeCompare(b.created));
  const cls = recs[0]?.cls || '';
  return h('section.card',
    h('div.card-head', h('h2', '학급요록 모아보기')),
    h('p.muted.small', '이름(과 대상 학반)이 같은 요록끼리 모아 봅니다. (예: 매주 "독서록" 이라는 같은 이름으로 만들기)'),
    groups.length ? h('div.chips', groups.map((g) => h(`button.chip-btn${`${g.title}\u0000${g.cls}` === app.recordKey ? '.active' : ''}`, { onclick: () => { app.recordKey = `${g.title}\u0000${g.cls}`; app.render(); } }, g.title, g.cls ? h('small', ` ${g.cls}`) : null))) : h('p.muted', '작성된 학급요록이 없습니다.'),
    recs.length ? h('div.records-wrap', h('table.grid.records',
      h('thead', h('tr', h('th.sticky', '학생'), recs.map((r) => h('th', `${r.created}${r.doneDate ? ' ✓' : ''}`, h('button.icon-btn', { title: 'Word 다운로드', onclick: async () => downloadBlob(await exportRecord(store, r), `학급요록_${r.title}_${r.created}.docx`) }, '⬇'))))),
      h('tbody', store.studentsOf(cls).map((x) => h('tr', h('th.sticky', studentLabel(x)), recs.map((r) => h('td', r.entries?.[x.uid] || ''))))))) : null);
}

// ---------- 출장 ----------
function trips(app) {
  const { store } = app;
  const yr = yearRange(store.year);
  app.tripRange ||= { start: yr.start, end: yr.end };
  const st = app.tripRange;
  const wrap = h('div');
  const list = () => store.work.trips.filter((t) => t.date >= st.start && t.date <= st.end).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const draw = () => {
    const rows = list();
    const days = new Set(rows.map((t) => t.date)).size;
    fill(wrap, 
      h('p', h('strong', `출장 ${rows.length}건 · ${days}일`)),
      rows.length ? h('table.grid', h('thead', h('tr', h('th', { style: { width: '11em' } }, '날짜'), h('th', { style: { width: '9em' } }, '시간'), h('th', '출장지'), h('th', '목적·내용'))),
        h('tbody', rows.map((t) => h('tr', h('td', h('button.link', { onclick: () => goto(app, t.date) }, koDate(t.date))), h('td', t.time || ''), h('td', t.place || ''), h('td', t.purpose || '')))))
        : h('p.muted', '해당 기간의 출장 기록이 없습니다. 교사수첩의 [출장] 칸에서 기록하세요.'));
  };
  draw();
  return h('section.card',
    h('div.card-head', h('h2', '출장 모아보기'),
      h('button.small', { onclick: async () => downloadBlob(await exportTrips(list(), st), `출장_${st.start}_${st.end}.docx`) }, '⬇ Word')),
    dateRangeInputs(st, draw), wrap);
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
    for (const col of ['days', 'lessons', 'counsel', 'attendance', 'schedule', 'trips']) for (const x of store.work[col]) if (x.date) set.add(x.date);
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

// ---------- 학생 활동 (대회·공모전·프로그램 참가·수상·수료) ----------
function activities(app) {
  const { store } = app;
  const yr = yearRange(store.year);
  app.actRange ||= { start: yr.start, end: yr.end, cls: '', kind: '', award: false, all: false };
  const st = app.actRange;
  const wrap = h('div');
  const label = (uid) => store.label(uid);
  const draw = () => {
    const studs = store.studentsOf(st.cls);
    const inCls = new Set(studs.map((x) => x.uid));
    // 기간이 겹치는 대회·활동 (날짜가 없으면 포함)
    const cs = (store.work.contests || []).filter((c) => {
      const sp = spanOf(c);
      return (!st.kind || c.kind === st.kind) && (!sp.end || sp.end >= st.start) && (!sp.start || sp.start <= st.end);
    });
    const rows = activityRows(cs, store.work.students, label).filter((r) => (!st.cls || inCls.has(r.uid)) && (!st.award || r.award));
    const byStu = new Map();
    for (const r of rows) { if (!byStu.has(r.uid)) byStu.set(r.uid, []); byStu.get(r.uid).push(r); }
    const order = st.all ? studs.map((x) => x.uid) : [...byStu.keys()];
    const awards = rows.filter((r) => r.award).length;
    fill(wrap,
      h('p', h('strong', `${byStu.size}명`), ` · 참가 ${rows.length}건 · 수상 ${awards}건`, st.cls ? h('span.muted.small', ` (${st.cls}반 ${studs.length}명 중)`) : null),
      order.length ? h('div.records-wrap', h('table.grid.activity-report',
        h('thead', h('tr', h('th', '학생'), h('th', '대회·활동'), h('th', '기간'), h('th', '팀'), h('th', '결과'), h('th', '수상'), h('th', '수료'))),
        h('tbody', order.flatMap((uid) => {
          const list = byStu.get(uid) || [];
          if (!list.length) return [h('tr', h('th', label(uid)), h('td.muted', { colspan: 6 }, '참가 기록 없음'))];
          return list.map((r, i) => h('tr',
            i === 0 ? h('th', { rowspan: list.length }, r.studentNo ? `${r.studentNo} ${r.name}` : r.name) : null,
            h('td', h('button.link', { onclick: () => openContest(app, r.c.id) }, r.contest), h('span.muted.small', ` ${r.kind}`)),
            h('td.nowrap.small', r.period), h('td', r.team), h('td.small', r.result), h('td', r.award ? h('strong', `🏆 ${r.award}`) : ''), h('td', r.done)));
        })))) : h('p.muted', '해당 조건의 활동 기록이 없습니다. 대회·활동 메뉴에서 참가 학생을 넣어 보세요.'),
      h('p.muted.small', '생활기록부 입력 전 정리용으로 엑셀로 내려받을 수 있습니다. 교내 수상 등 기재 기준은 학교 지침을 따르세요.'));
    wrap.rows = rows;
  };
  draw();
  return h('section.card',
    h('div.card-head', h('h2', '학생 활동 모아보기'),
      h('button.small', { onclick: () => downloadBlob(xlsxBlob([{ name: '학생 활동', rows: [ACTIVITY_HEAD, ...wrap.rows.map(activityRowCells)] }]), `학생활동_${st.cls || '전체'}_${st.start}_${st.end}.xlsx`) }, '⬇ 엑셀')),
    h('div.row',
      store.classList().length ? classSelect(store, st.cls, (v) => { st.cls = v; draw(); }) : null,
      h('select', { 'aria-label': '종류', onchange: (e) => { st.kind = e.target.value; draw(); } }, h('option', { value: '' }, '모든 종류'), KINDS.map((k) => h('option', { value: k, selected: k === st.kind }, k))),
      dateRangeInputs(st, draw),
      h('label.check.small', h('input', { type: 'checkbox', checked: st.award, onchange: (e) => { st.award = e.target.checked; draw(); } }), ' 수상만'),
      h('label.check.small', h('input', { type: 'checkbox', checked: st.all, onchange: (e) => { st.all = e.target.checked; draw(); } }), ' 기록 없는 학생도')),
    wrap);
}

// ---------- 업무일지 (완료한 일과 결과·진행 메모) ----------
function tasks(app) {
  const { store } = app;
  const yr = yearRange(store.year);
  app.taskRange ||= { start: yr.start, end: yr.end, mode: 'done', q: '' };
  const st = app.taskRange;
  const PL = { A: 'A', B: 'B', C: 'C', Z: '언젠가' };
  const wrap = h('div');
  const draw = () => {
    const q = st.q.trim();
    const list = store.work.tasks.filter((t) => {
      const d = st.mode === 'done' ? t.doneDate : t.created;
      if (st.mode === 'done' && !t.doneDate) return false;
      if (st.mode === 'open' && t.doneDate) return false;
      if (st.mode !== 'open' && (!d || d < st.start || d > st.end)) return false;
      if (st.mode === 'memo' && !(t.result || '').trim()) return false;
      return !q || `${t.text} ${t.result || ''}`.includes(q);
    }).sort((a, b) => (b.doneDate || b.created).localeCompare(a.doneDate || a.created));
    wrap.rows = list;
    const plain = mentionInline(app);
    fill(wrap,
      h('p.muted.small', `${list.length}건 — 결과·진행 메모를 여기서도 고칠 수 있습니다 (교사수첩에서는 완료한 다음 날부터 업무가 보이지 않아요).`),
      list.length ? h('div.task-report', list.map((t) => {
        const ta = h('textarea', { rows: 2, value: t.result || '', placeholder: '결과·진행 메모', 'aria-label': '결과·진행 메모',
          oninput: (e) => { t.result = e.target.value; if (!t.result.trim()) delete t.result; store.markDirty(); } });
        requestAnimationFrame(() => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; });
        ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; });
        return h('div.task-report-item',
          h('div.task-report-head',
            h(`span.prio-badge.p-${t.priority || 'B'}`, PL[t.priority] || 'B'),
            h('strong', plain(t.text)),
            h('span.muted.small', ` 작성 ${t.created}${t.due ? ` · 마감 ${t.due}` : ''}`),
            t.doneDate ? h('button.link.small', { onclick: () => goto(app, t.doneDate) }, ` ✓ ${t.doneDate} 완료`) : h('span.small.warn-text', ' 진행 중')),
          ta);
      })) : h('p.muted', '해당하는 업무가 없습니다.'));
  };
  draw();
  const search = h('input', { type: 'search', placeholder: '업무·메모 찾기', value: st.q, style: { width: '12em' }, oninput: (e) => { st.q = e.target.value; clearTimeout(search.t); search.t = setTimeout(draw, 250); } });
  return h('section.card',
    h('div.card-head', h('h2', '업무일지 · 결과 메모'),
      h('button.small', { onclick: () => {
        const rows = [['완료일', '중요도', '업무', '작성일', '마감일', '결과·진행 메모'], ...wrap.rows.map((t) => [t.doneDate || '', PL[t.priority] || 'B', t.text, t.created, t.due || '', t.result || ''])];
        downloadBlob(xlsxBlob([{ name: '업무일지', rows }]), `업무일지_${st.mode === 'open' ? '진행중' : `${st.start}_${st.end}`}.xlsx`);
      } }, '⬇ 엑셀')),
    h('div.row',
      h('div.chips', { style: { margin: 0 } }, [['done', '완료한 일'], ['memo', '메모 있는 일'], ['open', '진행 중'], ['all', '전체']].map(([k, l]) =>
        h(`button.chip-btn${st.mode === k ? '.active' : ''}`, { onclick: () => { st.mode = k; app.render(); } }, l))),
      st.mode !== 'open' ? dateRangeInputs(st, draw) : null,
      search),
    wrap);
}
