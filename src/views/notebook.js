// 교사수첩 탭: 학사일정·특일, 수업일지, 업무일지, 학생출결, 학생 상담 일지, 학급요록
import { h, newId, weekdayOf, fmtDateTime, downloadBlob, toast, confirmDialog, today, pad } from '../lib/util.js';
import { dayRows, fmtRange, currentRow, EVENING_BASE } from '../lib/bell.js';

const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
import { splitParagraphs } from '../lib/counsel.js';
import { tokenizeStudents, studentLabel } from '../lib/students.js';
import { studentSelect, classSelect } from './ui.js';
import { ATT_TYPES, ATT_REASONS, ttCell, courseShort, dday } from '../store.js';
import { exportDay } from '../lib/export.js';
import { showStudentCounsel } from './students.js';

/** textarea 높이 자동 조절 */
export function autoGrow(el) {
  const fit = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
  el.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return el;
}

const card = (title, extra, ...body) => h('section.card', h('div.card-head', h('h2', title), extra), ...body);

export function renderNotebook(app) {
  const { store, date } = app;
  const s = store.settings;
  const wd = weekdayOf(date);

  // ----- 학사일정 + 특일 -----
  const specialsEl = h('div.specials', h('span.muted', '특일정보 확인 중…'));
  app.specials(date).then((list) => {
    specialsEl.replaceChildren(...(list.length
      ? list.map((x) => h(`span.chip${x.holiday ? '.holiday' : ''}`, x.name))
      : [h('span.muted', '오늘의 국경일·절기 정보 없음')]));
  });
  const isHol = store.isSchoolHoliday(date);
  const scheduleCard = card('학사일정',
    h('label.check.small', { title: '재량휴업일 등 학교가 쉬는 날' },
      h('input', { type: 'checkbox', checked: isHol, onchange: (e) => { store.setSchoolHoliday(date, e.target.checked); app.render(); } }), ' 휴업일(쉬는 날)'),
    autoGrow(h('textarea', {
      rows: 2, placeholder: '오늘의 학사일정 (설정 > 일괄 등록으로 1년치를 한 번에 올릴 수 있어요)',
      value: store.scheduleText(date), oninput: (e) => store.setScheduleText(date, e.target.value),
    })),
    isHol ? h('div.specials', h('span.chip.holiday', '🏖 학교 휴업일')) : null,
    specialsEl);

  // ----- 수업일지 -----
  const sec = s.schoolLevel === 'secondary';
  const subjLabel = sec ? '수업명' : '과목';
  const cells = Object.values(s.timetable).flat().map(ttCell);
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const dl = h('div', { style: { display: 'none' } },
    h('datalist#subject-list', uniq([...(s.courses || []), ...cells.map((c) => c.subject)]).map((x) => h('option', { value: x }))),
    h('datalist#class-list', uniq([...store.classList(), ...cells.map((c) => c.cls)]).map((x) => h('option', { value: x }))),
    h('datalist#room-list', uniq([...(s.rooms || []), ...cells.map((c) => c.room)]).map((x) => h('option', { value: x }))));
  const lessons = store.lessonsFor(date, wd);
  const bopts = store.bellOpts(date);
  const rowsOfDay = dayRows(s, bopts);
  const hasTimes = rowsOfDay.some((r) => r.start || r.end);
  const nowRow = date === today() ? currentRow(rowsOfDay, nowHM()) : null;
  // 이 교시에 기록된 결석·지각 등 (수업별 출결)
  const absentBadge = (p) => {
    const n = store.work.attendance.filter((a) => a.date === date && (a.periods || []).includes(p)).length;
    return n ? h('div.absent-badge', { title: '이 수업의 출결 기록' }, `출결 ${n}`) : null;
  };
  // 수업명: 평소엔 축약 이름(설정 > 내 수업)을 보여 주고, 누르면 고칠 수 있다
  const subjectCell = (l, label) => {
    const wrap = h('div.subj-cell');
    const show = () => {
      const short = courseShort(s, l.subject);
      wrap.replaceChildren(h('button.subj-view', { title: l.subject ? `${l.subject} (눌러서 바꾸기)` : `${subjLabel} 입력`, 'aria-label': `${label} ${subjLabel}`, onclick: edit }, short || h('span.muted', '—')));
    };
    const edit = () => {
      const inp = h('input', { value: l.subject, list: 'subject-list', 'aria-label': `${label} ${subjLabel}`,
        oninput: (e) => { l.subject = e.target.value; store.setLesson(date, l.period, { subject: e.target.value }); },
        onblur: () => { const cur = store.lessonsFor(date, wd).find((x) => x.period === l.period); if (cur) l = cur; show(); },
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
      wrap.replaceChildren(inp);
      inp.focus(); inp.select();
    };
    show();
    return wrap;
  };
  const lessonTr = (l, r) => {
    const label = store.periodLabel(l.period);
    return h(`tr${nowRow && r && nowRow === r ? '.now' : ''}${l.period > EVENING_BASE ? '.evening' : ''}`,
      h('td.center.plabel', label, absentBadge(l.period)),
      hasTimes ? h('td.center.time', r ? fmtRange(r) : '') : null,
      h('td', subjectCell(l, label)),
      sec ? h('td', h('input', { value: l.cls || '', list: 'class-list', placeholder: '학반', 'aria-label': `${label} 학반`, oninput: (e) => store.setLesson(date, l.period, { cls: e.target.value }) })) : null,
      sec ? h('td', h('input', { value: l.room || '', list: 'room-list', placeholder: '교실', 'aria-label': `${label} 교실`, oninput: (e) => store.setLesson(date, l.period, { room: e.target.value }) })) : null,
      h('td', autoGrow(h('textarea', { rows: 1, value: l.content, 'aria-label': `${label} 내용`, oninput: (e) => store.setLesson(date, l.period, { content: e.target.value }) }))));
  };
  // 시정표 순서(등교 → 교시 → 점심 → … → 저녁 → 방과후)대로, 식사·등교는 안내 줄로 표시
  const used = new Set();
  const trs = [];
  for (const r of rowsOfDay) {
    if (r.p == null) {
      trs.push(h(`tr.bell-row.${r.kind}${nowRow === r ? '.now' : ''}`,
        h('td.center.plabel', { colspan: hasTimes ? 1 : 2 }, { arrival: '🏫 ', lunch: '🍚 ', dinner: '🍱 ' }[r.kind] + r.label),
        hasTimes ? h('td.center.time', fmtRange(r)) : null,
        h('td', { colspan: (hasTimes ? 2 : 1) + (sec ? 2 : 0) }, h('span.muted.small', { arrival: '등교 시각', lunch: '점심시간', dinner: '저녁 식사 시간' }[r.kind]))));
      continue;
    }
    const l = lessons.find((x) => x.period === r.p);
    used.add(r.p);
    if (l) trs.push(lessonTr(l, r));
  }
  for (const l of lessons) if (!used.has(l.period)) trs.push(lessonTr(l, null));
  const lessonCard = card('수업일지',
    h('div.row', { style: { margin: 0 } },
      h('span.muted.small', isHol ? '휴업일' : nowRow ? `지금: ${nowRow.label} ${fmtRange(nowRow)}` : wd === 0 || wd === 6 ? '주말' : ''),
      h(`label.check.small${bopts.csat ? '.csat-on' : ''}`, { title: '이 날만 점심을 3교시 다음으로 (시각은 설정 > 일과 시간)' },
        h('input', { type: 'checkbox', checked: bopts.csat, onchange: (e) => { store.setCsat(date, e.target.checked); app.render(); } }), ' 수능대비 시간표')),
    dl,
    h('table.grid.lessons',
      h('thead', h('tr', h('th', { style: { width: '4.8em' } }, '교시'), hasTimes ? h('th', { style: { width: '7.5em' } }, '시간') : null, h('th', { style: { width: sec ? '10em' : '8em' } }, subjLabel),
        sec ? h('th', { style: { width: '6em' } }, '학반') : null, sec ? h('th', { style: { width: '9em' } }, '교실') : null, h('th', '내용'))),
      h('tbody', trs)),
    hasTimes ? null : h('p.muted.small', '설정 > 일과 시간에서 등교·교시별 시각, 점심·저녁 시간을 넣으면 여기에 함께 보입니다.'));

  // ----- 업무일지 -----
  const taskList = h('div.tasks');
  const drawTasks = () => {
    const tasks = store.visibleTasks(date);
    const allDone = tasks.length > 0 && tasks.every((t) => t.doneDate === date);
    const row = (t) => {
      const check = h('input', { type: 'checkbox', checked: t?.doneDate === date, disabled: !t, 'aria-label': '완료',
        onchange: (e) => { t.doneDate = e.target.checked ? date : null; rowEl.classList.toggle('done', e.target.checked); store.markDirty(); } });
      const input = h('input.task-text', {
        value: t?.text || '', placeholder: t ? '' : '할 일을 입력하세요 (Enter: 다음 줄)',
        oninput: (e) => {
          if (!t) {
            // 빈 줄에 입력을 시작하면 그 줄이 새 업무가 되고, 아래에 새 빈 줄이 생긴다 (한글 조합이 끊기지 않도록 다시 그리지 않음)
            t = { id: newId(), text: e.target.value, created: date, doneDate: null };
            store.work.tasks.push(t);
            check.disabled = false;
            input.placeholder = '';
            drawDue();
            taskList.append(row(null));
          } else t.text = e.target.value;
          store.markDirty();
        },
        onkeydown: (e) => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); taskList.querySelector('.task-row:last-child input.task-text')?.focus(); }
        },
      });
      // 마감일 아이콘: 누르면 날짜 고르기, 정해 두면 D-day 표시 (달력에도 보임)
      const dueWrap = h('span.due');
      const drawDue = () => {
        if (!t) { dueWrap.replaceChildren(); return; }
        const d = dday(t.due, date);
        dueWrap.replaceChildren(h(`button.due-btn${d ? (d.n < 0 ? '.over' : d.n <= 3 ? '.soon' : '') : ''}`, {
          title: t.due ? `마감 ${t.due} (눌러서 바꾸기)` : '마감일 정하기',
          onclick: () => {
            const inp = h('input', { type: 'date', value: t.due || '', 'aria-label': '마감일',
              onchange: (e) => { if (e.target.value) t.due = e.target.value; else delete t.due; store.markDirty(); drawDue(); },
              onblur: () => drawDue() });
            dueWrap.replaceChildren(inp, t.due ? h('button.icon-btn', { title: '마감일 지우기', onmousedown: (e) => { e.preventDefault(); delete t.due; store.markDirty(); drawDue(); } }, '✕') : null);
            inp.focus(); inp.showPicker?.();
          },
        }, d ? d.label : '📅'));
      };
      drawDue();
      const rowEl = h(`div.task-row${t?.doneDate === date ? '.done' : ''}`, check, input, dueWrap);
      return rowEl;
    };
    taskList.replaceChildren(
      h('label.bulk', h('input', { type: 'checkbox', checked: allDone, onchange: (e) => {
        for (const t of store.visibleTasks(date)) t.doneDate = e.target.checked ? date : null;
        store.markDirty(); drawTasks();
      } }), ' 전체 완료'),
      ...tasks.map(row), row(null));
  };
  drawTasks();
  const taskCard = card('업무일지', h('span.muted.small', '완료한 일은 다음 날부터 보이지 않아요'), taskList);

  // ----- 학생출결 (수업별) -----
  const hasStudents = store.work.students.length > 0;
  // 오늘 수업 묶음: 같은 수업명·학반이 이어지는 교시는 하나로 (예: 3·4교시 정보 2-2)
  const lessonBlocks = (() => {
    const ls = store.lessonsFor(date, wd).filter((l) => l.subject || l.cls);
    const blocks = [];
    for (const l of ls) {
      const last = blocks.at(-1);
      if (last && last.subject === l.subject && last.cls === (l.cls || '') && last.periods.at(-1) === l.period - 1 && l.period <= 10) last.periods.push(l.period);
      else blocks.push({ periods: [l.period], subject: l.subject, cls: l.cls || '' });
    }
    const out = [];
    for (const b of blocks) {
      out.push(b);
      if (b.periods.length > 1) for (const p of b.periods) out.push({ periods: [p], subject: b.subject, cls: b.cls });
    }
    return out;
  })();
  const blockKey = (b) => (b.periods || []).join(',');
  const blockLabel = (b) => `${b.periods.map((p) => store.periodLabel(p).replace('교시', '')).join('·')}교시 ${courseShort(s, b.subject)} ${b.cls}`.trim();
  const attBody = h('tbody');
  const drawAtt = () => {
    const rows = store.work.attendance.filter((a) => a.date === date);
    const sel = (opts, val, on, label) => h('select', { onchange: on, 'aria-label': label }, h('option', { value: '' }, '-'), opts.map((o) => h('option', { value: o, selected: o === val }, o)));
    attBody.replaceChildren(...rows.map((a) => {
      const cur = blockKey(a);
      const known = lessonBlocks.some((b) => blockKey(b) === cur);
      const lessonSel = h('select', { 'aria-label': '수업', onchange: (e) => {
        const b = lessonBlocks.find((x) => blockKey(x) === e.target.value);
        if (b) Object.assign(a, { periods: [...b.periods], subject: b.subject, cls: b.cls });
        else { delete a.periods; delete a.subject; delete a.cls; }
        store.markDirty(); drawAtt();
      } },
        h('option', { value: '' }, '종일 / 수업 외'),
        !known && cur ? h('option', { value: cur, selected: true }, blockLabel(a)) : null,
        lessonBlocks.map((b) => h('option', { value: blockKey(b), selected: blockKey(b) === cur }, blockLabel(b))));
      return h('tr',
        h('td', lessonSel),
        h('td', studentSelect(store, a.student, (v) => { a.student = v; store.markDirty(); }, { cls: a.cls || '' })),
        h('td', sel(ATT_TYPES, a.type, (e) => { a.type = e.target.value; store.markDirty(); }, '구분')),
        h('td', sel(ATT_REASONS, a.reason, (e) => { a.reason = e.target.value; store.markDirty(); }, '사유')),
        h('td', h('input', { value: a.note || '', placeholder: '비고 (예: 독감A형)', oninput: (e) => { a.note = e.target.value; store.markDirty(); } })),
        h('td', h('button.icon-btn', { title: '삭제', onclick: () => { store.work.attendance = store.work.attendance.filter((x) => x !== a); store.markDirty(); drawAtt(); } }, '✕')));
    }));
    if (!rows.length) attBody.append(h('tr', h('td.muted.center', { colspan: 6 }, '오늘 출결 특이사항 없음')));
  };
  drawAtt();
  const attCard = card('학생출결상황',
    h('button.small', { onclick: () => {
      if (!hasStudents) return toast('먼저 학생 정보를 등록하세요 (학생관리 또는 설정 > 일괄 등록).', 'error');
      // 지금 하고 있는 수업이 있으면 그 수업으로 시작
      const nowB = nowRow?.p ? lessonBlocks.find((b) => b.periods.includes(nowRow.p) && b.periods.length > 1) || lessonBlocks.find((b) => b.periods.includes(nowRow.p)) : null;
      const a = { id: newId(), date, student: '', type: '결석', reason: '질병', note: '' };
      if (nowB) Object.assign(a, { periods: [...nowB.periods], subject: nowB.subject, cls: nowB.cls });
      store.work.attendance.push(a);
      store.markDirty(); drawAtt();
    } }, '+ 추가'),
    h('p.muted.small', '수업을 고르면 그 학반 학생만 나옵니다. 보고서 > 학생출결에서 수업별로 빠진 시수를 볼 수 있어요.'),
    h('table.grid.att-table', h('thead', h('tr', h('th', '수업'), h('th', '학생'), h('th', '구분'), h('th', '사유'), h('th', '비고'), h('th', ''))), attBody));

  // ----- 출장 -----
  const tripBody = h('div.trips');
  const drawTrips = () => {
    const trips = store.tripsOn(date);
    tripBody.replaceChildren(...trips.map((t) => h('div.trip-row',
      h('input', { value: t.time || '', placeholder: '시간 (예: 13:00~17:00)', 'aria-label': '출장 시간', oninput: (e) => { t.time = e.target.value; store.markDirty(); } }),
      h('input', { value: t.place || '', placeholder: '출장지', 'aria-label': '출장지', oninput: (e) => { t.place = e.target.value; store.markDirty(); } }),
      h('input', { value: t.purpose || '', placeholder: '목적·내용', 'aria-label': '출장 목적', oninput: (e) => { t.purpose = e.target.value; store.markDirty(); } }),
      h('button.icon-btn', { title: '삭제', onclick: () => { store.work.trips = store.work.trips.filter((x) => x !== t); store.markDirty(); drawTrips(); tripCheck.checked = store.tripsOn(date).length > 0; } }, '✕'))));
  };
  const addTrip = () => { store.work.trips.push({ id: newId(), date, time: '', place: '', purpose: '' }); store.markDirty(); drawTrips(); tripBody.querySelector('.trip-row:last-child input:nth-child(2)')?.focus(); };
  const tripCheck = h('input', { type: 'checkbox', checked: store.tripsOn(date).length > 0, onchange: async (e) => {
    if (e.target.checked) addTrip();
    else if (await confirmDialog('출장 해제', '이 날의 출장 기록을 지울까요? (저장해야 반영됩니다)', '지우기')) {
      store.work.trips = store.work.trips.filter((x) => x.date !== date); store.markDirty(); drawTrips();
    } else e.target.checked = true;
  } });
  drawTrips();
  const tripCard = card('출장', h('div.row', { style: { margin: 0 } }, h('label.check.small', tripCheck, ' 출장 있음'), h('button.small', { onclick: () => { tripCheck.checked = true; addTrip(); } }, '+ 추가')), tripBody);

  // ----- 학생 상담 일지 (가리기 기능) -----
  const counselView = h('div.counsel-view');
  let liveT;
  const livePreview = (text) => { clearTimeout(liveT); liveT = setTimeout(() => drawCounselView(text), 300); };
  const drawCounselView = (text) => {
    const paras = splitParagraphs(text);
    counselView.replaceChildren(...paras.map((p) => h('p.counsel-para', tokenizeStudents(p, store.work.students).map((t) => t.uid
      ? h('button.name-link', { onclick: () => showStudentCounsel(app, t.uid), title: `${store.label(t.uid)} 상담 모아보기` }, t.text)
      : t.text))));
  };
  const counselTa = autoGrow(h('textarea.counsel', {
    rows: 6,
    placeholder: '오늘 있었던 특이사항을 자유롭게 기록하세요.\n· "학번 이름" 또는 (동명이인이 없으면) "이름" 뒤에 한 칸 띄우면 학생으로 인식합니다. 예: "10203 홍길동 학생이 …"\n· 위의 [학생 넣기]로 골라 넣을 수 있어요. 빈 줄로 단락을 나누면 각각 별개의 상담 일지가 됩니다.',
    value: store.counselText(date),
    oninput: (e) => { store.setCounselText(date, e.target.value); livePreview(e.target.value); },
    onblur: (e) => drawCounselView(e.target.value),
  }));
  drawCounselView(counselTa.value);
  // 학생 넣기: 학반 → 학생 고르면 커서 위치에 "학번 이름 " 삽입
  let pickCls = '';
  const pickWrap = h('span');
  const drawPick = () => pickWrap.replaceChildren(studentSelect(store, '', (uid) => {
    const st = store.studentIndex().byUid.get(uid);
    if (!st) return;
    const ins = `${studentLabel(st)} `;
    const a = counselTa.selectionStart ?? counselTa.value.length, b = counselTa.selectionEnd ?? a;
    counselTa.setRangeText(ins, a, b, 'end');
    counselTa.dispatchEvent(new Event('input'));
    counselTa.focus();
    drawPick();
  }, { cls: pickCls, label: '학생 넣기', placeholder: '학생 넣기…' }));
  drawPick();
  const picker = hasStudents ? h('div.row.counsel-pick', h('span.small.muted', '학생 넣기'),
    store.classList().length ? classSelect(store, pickCls, (v) => { pickCls = v; drawPick(); }) : null, pickWrap) : null;
  const hidden = sessionStorage.getItem('sn:privacy') !== 'show';
  const privacy = h(`section.card.private${hidden ? '.veiled' : ''}`,
    h('div.card-head', h('h2', '학생 상담 일지 및 특이사항'),
      h('button.small', { onclick: (e) => {
        const veiled = privacy.classList.toggle('veiled');
        sessionStorage.setItem('sn:privacy', veiled ? 'hide' : 'show');
        e.target.textContent = veiled ? '보이기' : '가리기';
      } }, hidden ? '보이기' : '가리기')),
    h('div.veil-body', picker, counselTa, h('div.muted.small', '이름을 누르면 그 학생의 상담 일지를 모아볼 수 있어요.'), counselView),
    h('div.veil-cover', '학생 개인정보 보호를 위해 가려져 있습니다. [보이기]를 누르세요.'));

  // ----- 학급요록 (대상 학반별 표) -----
  const recWrap = h('div');
  let newRecCls = '';
  const drawRecords = () => {
    const recs = store.visibleRecords(date);
    if (!hasStudents) { recWrap.replaceChildren(h('p.muted', '학생 정보를 등록하면 학급요록을 사용할 수 있습니다.')); return; }
    const groups = new Map();
    for (const r of recs) { const k = r.cls || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    recWrap.replaceChildren(...[...groups].map(([cls, list]) => h('div.records-wrap',
      h('h3.small', cls ? `${cls}반` : '전체 학생'),
      h('table.grid.records',
        h('thead', h('tr', h('th.sticky', '학생'), list.map((r) => h('th',
          h('div.rec-head',
            h('input', { type: 'checkbox', title: '완료', checked: r.doneDate === date, onchange: (e) => { r.doneDate = e.target.checked ? date : null; store.markDirty(); } }),
            h('input.rec-title', { value: r.title, placeholder: '제목 (예: 독서록)', oninput: (e) => { r.title = e.target.value; store.markDirty(); } }),
            h('button.icon-btn', { title: '요록 삭제', onclick: async () => {
              if (!(await confirmDialog('학급요록 삭제', `"${r.title || '제목 없음'}" 요록과 학생별 내용을 모두 삭제할까요? (저장해야 반영됩니다)`, '삭제'))) return;
              store.work.records = store.work.records.filter((x) => x !== r); store.markDirty(); drawRecords();
            } }, '✕')),
          h('div.muted.small', `등록 ${r.created}`))))),
        h('tbody', store.studentsOf(cls).map((st) => h('tr', h('th.sticky', studentLabel(st)), list.map((r) => h('td',
          h('input', { value: r.entries?.[st.uid] || '', 'aria-label': `${r.title} ${studentLabel(st)}`, oninput: (e) => { (r.entries ||= {})[st.uid] = e.target.value; store.markDirty(); } }))))))))));
    if (!recs.length) recWrap.append(h('p.muted.small', '진행 중인 요록이 없습니다. 대상 학반을 고르고 [+ 새 요록]으로 제출물·과제 확인표를 만들어 보세요.'));
  };
  drawRecords();
  const recCard = card('학급요록',
    h('div.row', { style: { margin: 0 } },
      store.classList().length ? classSelect(store, newRecCls, (v) => { newRecCls = v; }, { all: '전체 학생', label: '새 요록 대상 학반' }) : null,
      h('button.small', { onclick: () => {
        const rec = { id: newId(), title: '', created: date, doneDate: null, entries: {} };
        if (newRecCls) rec.cls = newRecCls;
        store.work.records.push(rec);
        store.markDirty(); drawRecords();
        recWrap.querySelector('th:last-child .rec-title')?.focus();
      } }, '+ 새 요록')),
    h('p.muted.small', '완료 체크하지 않은 요록은 계속 보입니다. 같은 이름의 요록은 보고서에서 모아 볼 수 있어요.'),
    recWrap);

  // ----- 하단 -----
  const upd = store.day(date)?.updatedAt;
  const footer = h('div.notebook-foot',
    s.showModified ? h('span.muted', upd ? `최종수정일시: ${fmtDateTime(upd)}` : '아직 저장되지 않은 일지') : h('span'),
    h('div.row',
      h('button', { onclick: () => window.print() }, '🖨 인쇄'),
      h('button', { onclick: async () => {
        if (store.dirty) toast('저장하지 않은 내용도 포함해 내려받습니다.', 'info');
        const blob = await exportDay(store, date, await app.specials(date));
        downloadBlob(blob, `교사수첩_${date}.docx`);
      } }, '⬇ Word 다운로드'),
      h('button.primary', { onclick: () => app.save() }, '저 장')));

  return h('div.notebook',
    h('div.print-only.print-title', `교사수첩 ${date}`),
    // 중·고는 수업명·학반·교실 칸이 많아 수업일지를 전체 폭으로
    sec
      ? [h('div.nb-grid', h('div.col', scheduleCard, attCard), h('div.col', taskCard, tripCard)), lessonCard]
      : h('div.nb-grid', h('div.col', scheduleCard, lessonCard), h('div.col', taskCard, attCard, tripCard)),
    privacy,
    recCard,
    footer);
}
