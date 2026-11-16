// 교사수첩 탭: 학사일정·특일, 수업일지, 업무일지, 학생출결, 학생 상담 일지, 학급요록
import { h, newId, weekdayOf, fmtDateTime, downloadBlob, toast, confirmDialog } from '../lib/util.js';
import { splitParagraphs, tokenize } from '../lib/counsel.js';
import { ATT_TYPES, ATT_REASONS } from '../store.js';
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
  const scheduleCard = card('학사일정', null,
    autoGrow(h('textarea', {
      rows: 2, placeholder: '오늘의 학사일정 (설정 > 일괄 등록으로 1년치를 한 번에 올릴 수 있어요)',
      value: store.scheduleText(date), oninput: (e) => store.setScheduleText(date, e.target.value),
    })),
    specialsEl);

  // ----- 수업일지 -----
  const subjLabel = s.schoolLevel === 'secondary' ? '학반/교실' : '과목';
  const subjects = [...new Set(Object.values(s.timetable).flat().filter(Boolean))];
  const dl = h('datalist#subject-list', subjects.map((x) => h('option', { value: x })));
  const lessons = store.lessonsFor(date, wd);
  const lessonCard = card('수업일지', h('span.muted.small', wd === 0 || wd === 6 ? '주말' : ''),
    dl,
    h('table.grid.lessons',
      h('thead', h('tr', h('th', { style: { width: '3.5em' } }, '교시'), h('th', { style: { width: '9em' } }, subjLabel), h('th', '내용'))),
      h('tbody', lessons.map((l) => h('tr',
        h('td.center', `${l.period}`),
        h('td', h('input', { value: l.subject, list: 'subject-list', 'aria-label': `${l.period}교시 ${subjLabel}`, oninput: (e) => store.setLesson(date, l.period, { subject: e.target.value }) })),
        h('td', autoGrow(h('textarea', { rows: 1, value: l.content, 'aria-label': `${l.period}교시 내용`, oninput: (e) => store.setLesson(date, l.period, { content: e.target.value }) }))))))));

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
            taskList.append(row(null));
          } else t.text = e.target.value;
          store.markDirty();
        },
        onkeydown: (e) => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); taskList.querySelector('.task-row:last-child input.task-text')?.focus(); }
        },
      });
      const rowEl = h(`div.task-row${t?.doneDate === date ? '.done' : ''}`, check, input);
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

  // ----- 학생출결 -----
  const names = store.studentNames();
  const attBody = h('tbody');
  const drawAtt = () => {
    const rows = store.work.attendance.filter((a) => a.date === date);
    const sel = (opts, val, on, label) => h('select', { onchange: on, 'aria-label': label }, h('option', { value: '' }, '-'), opts.map((o) => h('option', { value: o, selected: o === val }, o)));
    attBody.replaceChildren(...rows.map((a) => h('tr',
      h('td', sel(names.includes(a.student) || !a.student ? names : [a.student, ...names], a.student, (e) => { a.student = e.target.value; store.markDirty(); }, '학생')),
      h('td', sel(ATT_TYPES, a.type, (e) => { a.type = e.target.value; store.markDirty(); }, '구분')),
      h('td', sel(ATT_REASONS, a.reason, (e) => { a.reason = e.target.value; store.markDirty(); }, '사유')),
      h('td', h('input', { value: a.note || '', placeholder: '비고', oninput: (e) => { a.note = e.target.value; store.markDirty(); } })),
      h('td', h('button.icon-btn', { title: '삭제', onclick: () => { store.work.attendance = store.work.attendance.filter((x) => x !== a); store.markDirty(); drawAtt(); } }, '✕')))));
    if (!rows.length) attBody.append(h('tr', h('td.muted.center', { colspan: 5 }, '오늘 출결 특이사항 없음')));
  };
  drawAtt();
  const attCard = card('학생출결상황',
    h('button.small', { onclick: () => {
      if (!names.length) return toast('먼저 학생 정보를 등록하세요 (설정 > 일괄 등록 또는 학생관리).', 'error');
      store.work.attendance.push({ id: newId(), date, student: '', type: '결석', reason: '질병', note: '' });
      store.markDirty(); drawAtt();
    } }, '+ 추가'),
    h('table.grid.att-table', h('thead', h('tr', h('th', '학생'), h('th', '구분'), h('th', '사유'), h('th', '비고'), h('th', ''))), attBody));

  // ----- 학생 상담 일지 (가리기 기능) -----
  const counselView = h('div.counsel-view');
  const drawCounselView = (text) => {
    const paras = splitParagraphs(text);
    counselView.replaceChildren(...paras.map((p) => h('p.counsel-para', tokenize(p, names).map((t) => t.name
      ? h('button.name-link', { onclick: () => showStudentCounsel(app, t.name), title: `${t.name} 상담 모아보기` }, t.text)
      : t.text))));
  };
  const counselTa = autoGrow(h('textarea.counsel', {
    rows: 6,
    placeholder: '오늘 있었던 특이사항을 자유롭게 기록하세요.\n· 학생 이름 뒤에 한 칸 띄우면 학생으로 인식합니다. (예: "홍길동 학생이 …")\n· 빈 줄로 단락을 나누면 각각 별개의 상담 일지가 됩니다.',
    value: store.counselText(date),
    oninput: (e) => store.setCounselText(date, e.target.value),
    onblur: (e) => drawCounselView(e.target.value),
  }));
  drawCounselView(counselTa.value);
  const hidden = sessionStorage.getItem('sn:privacy') !== 'show';
  const privacy = h(`section.card.private${hidden ? '.veiled' : ''}`,
    h('div.card-head', h('h2', '학생 상담 일지 및 특이사항'),
      h('button.small', { onclick: (e) => {
        const veiled = privacy.classList.toggle('veiled');
        sessionStorage.setItem('sn:privacy', veiled ? 'hide' : 'show');
        e.target.textContent = veiled ? '보이기' : '가리기';
      } }, hidden ? '보이기' : '가리기')),
    h('div.veil-body', counselTa, h('div.muted.small', '이름을 누르면 그 학생의 상담 일지를 모아볼 수 있어요.'), counselView),
    h('div.veil-cover', '학생 개인정보 보호를 위해 가려져 있습니다. [보이기]를 누르세요.'));

  // ----- 학급요록 -----
  const recWrap = h('div.records-wrap');
  const drawRecords = () => {
    const recs = store.visibleRecords(date);
    if (!names.length) { recWrap.replaceChildren(h('p.muted', '학생 정보를 등록하면 학급요록을 사용할 수 있습니다.')); return; }
    recWrap.replaceChildren(h('table.grid.records',
      h('thead', h('tr', h('th.sticky', '학생'), recs.map((r) => h('th',
        h('div.rec-head',
          h('input', { type: 'checkbox', title: '완료', checked: r.doneDate === date, onchange: (e) => { r.doneDate = e.target.checked ? date : null; store.markDirty(); } }),
          h('input.rec-title', { value: r.title, placeholder: '제목 (예: 독서록)', oninput: (e) => { r.title = e.target.value; store.markDirty(); } }),
          h('button.icon-btn', { title: '요록 삭제', onclick: async () => {
            if (!(await confirmDialog('학급요록 삭제', `"${r.title || '제목 없음'}" 요록과 학생별 내용을 모두 삭제할까요? (저장해야 반영됩니다)`, '삭제'))) return;
            store.work.records = store.work.records.filter((x) => x !== r); store.markDirty(); drawRecords();
          } }, '✕')),
        h('div.muted.small', `등록 ${r.created}`))))),
      h('tbody', names.map((n) => h('tr', h('th.sticky', n), recs.map((r) => h('td',
        h('input', { value: r.entries?.[n] || '', 'aria-label': `${r.title} ${n}`, oninput: (e) => { (r.entries ||= {})[n] = e.target.value; store.markDirty(); } }))))))));
    if (!recs.length) recWrap.append(h('p.muted.small', '진행 중인 요록이 없습니다. [+ 새 요록]으로 제출물·과제 확인표를 만들어 보세요.'));
  };
  drawRecords();
  const recCard = card('학급요록',
    h('button.small', { onclick: () => {
      store.work.records.push({ id: newId(), title: '', created: date, doneDate: null, entries: {} });
      store.markDirty(); drawRecords();
      recWrap.querySelector('th:last-child .rec-title')?.focus();
    } }, '+ 새 요록'),
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
    h('div.nb-grid',
      h('div.col', scheduleCard, lessonCard),
      h('div.col', taskCard, attCard)),
    privacy,
    recCard,
    footer);
}
