// 교사수첩 탭: 학사일정·특일, 수업일지, 업무일지, 학생출결, 학생 상담 일지, 학급요록
import { h, newId, weekdayOf, fmtDateTime, downloadBlob, toast, confirmDialog, modal, today, pad, fill } from '../lib/util.js';
import { dayRows, fmtRange, currentRow, EVENING_BASE } from '../lib/bell.js';

const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
import { splitParagraphs } from '../lib/counsel.js';
import { tokenizeStudents, studentLabel } from '../lib/students.js';
import { studentSelect, classSelect } from './ui.js';
import { ATT_TYPES, ATT_REASONS, ttCell, courseShort, dday, PRIORITIES, priorityOf, priorityLabel } from '../store.js';
import { exportDay, fileExt, dlLabel } from '../lib/export.js';
import { showStudentCounsel } from './students.js';
import { extractTags, tagNodes } from '../lib/tags.js';
import { splitSections, renderMd, toggleTodo } from '../lib/notemd.js';
import { openTag } from './tags.js';
import { attachStudentSuggest } from './suggest.js';
import { mentionInline } from './mentions.js';
import { dayEvents } from '../lib/contests.js';
import { openContest } from './contests.js';
import { seoulWeather, weatherText } from '../lib/weather.js';
import { quoteOf } from '../lib/quotes.js';

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
    fill(specialsEl, ...(list.length
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
    specialsEl,
    // 대회·활동 일정 (단계 시작·마감)
    (() => {
      // 대회·활동, #태그(사업) 일정 (단계 시작·마감)
      const ev = [...dayEvents(store.work.contests, date).map((x) => ({ ...x, open: () => openContest(app, x.c.id), label: `🏆 ${x.c.name} · ${x.text}` })),
        ...dayEvents((store.work.tagcards || []).map((c) => ({ ...c, name: `#${c.tag}` })), date).map((x) => ({ ...x, open: () => openTag(app, x.c.tag), label: `#${x.c.tag} · ${x.text}` }))];
      return ev.length ? h('div.specials.contest-day', ev.map((x) => h('button.chip.contest-chip', { onclick: x.open, title: '열기' }, x.label))) : null;
    })());

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
      fill(wrap, h('button.subj-view', { title: l.subject ? `${l.subject} (눌러서 바꾸기)` : `${subjLabel} 입력`, 'aria-label': `${label} ${subjLabel}`, onclick: edit }, short || h('span.muted', '—')));
    };
    const edit = () => {
      const inp = h('input', { value: l.subject, list: 'subject-list', 'aria-label': `${label} ${subjLabel}`,
        oninput: (e) => { l.subject = e.target.value; store.setLesson(date, l.period, { subject: e.target.value }); },
        onblur: () => { const cur = store.lessonsFor(date, wd).find((x) => x.period === l.period); if (cur) l = cur; show(); },
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
      fill(wrap, inp);
      inp.focus(); inp.select();
    };
    show();
    return wrap;
  };
  // ----- 시간대 앵커: 업무의 ⚓ 를 교시·시간 일정 줄에 끌어다 놓으면 "그 시간에 한 일"로 연결 -----
  const anchored = (slot) => store.work.tasks.filter((t) => t.at?.date === date && t.at.slot === slot);
  const anchorChips = (slot) => {
    const list = anchored(slot);
    return list.length ? h('div.anchor-chips', list.map((t) => h(`span.anchor-chip${t.doneDate ? '.done' : ''}`, { title: t.text },
      '⚓ ', String(t.text || '').slice(0, 28),
      h('button', { type: 'button', title: '시간 연결 풀기', 'aria-label': '시간 연결 풀기', onclick: () => { delete t.at; store.markDirty(); app.render(); } }, '×')))) : null;
  };
  const TASK_MIME = 'application/x-nanal-task';
  const dropSlot = (tr, slot) => {
    tr.dataset.slot = slot;
    tr.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes(TASK_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'link'; tr.classList.add('drop-on'); } });
    tr.addEventListener('dragleave', () => tr.classList.remove('drop-on'));
    tr.addEventListener('drop', (e) => {
      tr.classList.remove('drop-on');
      const id = e.dataTransfer.getData(TASK_MIME);
      const t = store.work.tasks.find((x) => x.id === id);
      if (!t) return;
      e.preventDefault();
      t.at = { date, slot };
      store.markDirty();
      app.render();
    });
    return tr;
  };
  const lessonTr = (l, r) => {
    const label = store.periodLabel(l.period);
    return dropSlot(h(`tr${nowRow && r && nowRow === r ? '.now' : ''}${l.period > EVENING_BASE ? '.evening' : ''}`,
      h('td.center.plabel', label, absentBadge(l.period)),
      hasTimes ? h('td.center.time', r ? fmtRange(r) : '') : null,
      h('td', subjectCell(l, label)),
      sec ? h('td', h('input', { value: l.cls || '', list: 'class-list', placeholder: '학반', 'aria-label': `${label} 학반`, oninput: (e) => store.setLesson(date, l.period, { cls: e.target.value }) })) : null,
      sec ? h('td', h('input', { value: l.room || '', list: 'room-list', placeholder: '교실', 'aria-label': `${label} 교실`, oninput: (e) => store.setLesson(date, l.period, { room: e.target.value }) })) : null,
      h('td', (() => {
        const ta = autoGrow(h('textarea', { rows: 1, value: l.content, 'aria-label': `${label} 내용`, oninput: (e) => store.setLesson(date, l.period, { content: e.target.value }) }));
        attachStudentSuggest(ta, () => store.studentsOf(l.cls || '').length ? store.studentsOf(l.cls || '') : store.work.students, () => store.work.people, () => store.tagList());
        return [ta, anchorChips(`p${l.period}`)];
      })())), `p${l.period}`);
  };
  // ----- 시간 일정: 회의·행사처럼 교시 밖의 일정을 시각 순서대로 끼워 넣는다 -----
  const dayRec = () => { let d = store.day(date); if (!d) { d = { id: newId(), date }; store.work.days.push(d); } return d; };
  const events = [...(store.day(date)?.events || [])].sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
  const eventTr = (ev) => {
    const times = h('div.ev-times',
      h('input', { type: 'time', value: ev.start || '', 'aria-label': '시작 시각', onchange: (e) => { ev.start = e.target.value; store.markDirty(); app.render(); } }),
      h('input', { type: 'time', value: ev.end || '', 'aria-label': '끝 시각', onchange: (e) => { ev.end = e.target.value; store.markDirty(); } }));
    const title = h('input.ev-title', { value: ev.title || '', placeholder: '일정 (예: 교직원 회의 · 3층 회의실)', 'aria-label': '일정 제목', oninput: (e) => { ev.title = e.target.value; store.markDirty(); } });
    attachStudentSuggest(title, () => store.work.students, () => store.work.people, () => store.tagList());
    const del = h('button.icon-btn', { type: 'button', title: '일정 지우기', 'aria-label': '일정 지우기', onclick: () => {
      const d = store.day(date);
      d.events = (d.events || []).filter((x) => x !== ev);
      if (!d.events.length) delete d.events;
      for (const t of store.work.tasks) if (t.at?.date === date && t.at.slot === ev.start) delete t.at;
      store.markDirty(); app.render();
    } }, '✕');
    const tr = h('tr.event-row',
      h('td.center.plabel', '🗓', hasTimes ? null : times),
      hasTimes ? h('td.center.time', times) : null,
      h('td', { colspan: 2 + (sec ? 2 : 0) }, h('div.ev-line', title, del), ev.start ? anchorChips(ev.start) : null));
    return ev.start ? dropSlot(tr, ev.start) : tr;
  };
  // 시정표 순서(등교 → 교시 → 점심 → … → 저녁 → 방과후)대로, 식사·등교는 안내 줄로 표시
  const used = new Set();
  const trs = [];
  const pendingEv = [...events];
  const flushEvents = (before) => { while (pendingEv.length && pendingEv[0].start && (!before || pendingEv[0].start < before)) trs.push(eventTr(pendingEv.shift())); };
  for (const r of rowsOfDay) {
    if (hasTimes && r.start) flushEvents(r.start);
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
  flushEvents(null);
  for (const ev of pendingEv) trs.push(eventTr(ev)); // 시각을 안 정한 일정
  const lessonCard = card('수업일지',
    h('div.row', { style: { margin: 0 } },
      h('span.muted.small', isHol ? '휴업일' : nowRow ? `지금: ${nowRow.label} ${fmtRange(nowRow)}` : wd === 0 || wd === 6 ? '주말' : ''),
      h(`label.check.small${bopts.csat ? '.csat-on' : ''}`, { title: '이 날만 점심을 3교시 다음으로 (시각은 설정 > 일과 시간)' },
        h('input', { type: 'checkbox', checked: bopts.csat, onchange: (e) => { store.setCsat(date, e.target.checked); app.render(); } }), ' 수능대비 시간표'),
      h('button.small', { title: '회의·행사처럼 교시 밖의 일정을 시각과 함께 넣기', onclick: () => {
        const d = dayRec();
        (d.events ||= []).push({ id: newId(), start: '', end: '', title: '' });
        store.markDirty(); app.render();
        requestAnimationFrame(() => { const r = [...document.querySelectorAll('.event-row')].find((x) => !x.querySelector('.ev-title').value); r?.querySelector('input[type=time]')?.focus(); });
      } }, '+ 시간 일정')),
    dl,
    h('table.grid.lessons',
      h('thead', h('tr', h('th', { style: { width: '4.8em' } }, '교시'), hasTimes ? h('th', { style: { width: '7.5em' } }, '시간') : null, h('th', { style: { width: sec ? '10em' : '8em' } }, subjLabel),
        sec ? h('th', { style: { width: '6em' } }, '학반') : null, sec ? h('th', { style: { width: '9em' } }, '교실') : null, h('th', '내용'))),
      h('tbody', trs)),
    hasTimes ? null : h('p.muted.small', '설정 > 일과 시간에서 등교·교시별 시각, 점심·저녁 시간을 넣으면 여기에 함께 보입니다.'));

  // 시간대 이름: 'p3' → "3교시", '15:30' → "15:30 교직원 회의"
  const slotLabel = (slot, onDate = date) => {
    if (!slot) return '';
    if (/^p\d+$/.test(slot)) return store.periodLabel(+slot.slice(1));
    const ev = (store.day(onDate)?.events || []).find((x) => x.start === slot);
    return ev?.title ? `${slot} ${ev.title.slice(0, 10)}` : slot;
  };
  // ⚓ 를 눌렀을 때: 이 날의 교시·시간 일정 중에서 고르기 (손가락 화면용)
  const pickSlot = async (t) => {
    const opts = [
      ...lessons.map((l) => ({ slot: `p${l.period}`, label: `${store.periodLabel(l.period)}${l.subject ? ` · ${courseShort(s, l.subject)}` : ''}${l.cls ? ` ${l.cls}` : ''}` })),
      ...events.filter((ev) => ev.start).map((ev) => ({ slot: ev.start, label: `🗓 ${ev.start}${ev.end ? `~${ev.end}` : ''} ${ev.title || ''}` })),
    ];
    const v = await modal('어느 시간에 한 일인가요?', h('div', h('p.muted.small', `"${String(t.text).slice(0, 40)}" — ${date} 수업일지의 교시·시간 일정에 연결합니다. PC 에서는 ⚓ 를 그 줄로 끌어다 놓아도 됩니다.`)),
      [...opts.map((o) => ({ label: o.label, value: o.slot })), ...(t.at ? [{ label: '연결 풀기', value: '-' }] : []), { label: '취소', value: null }]);
    if (!v) return;
    if (v === '-') delete t.at; else t.at = { date, slot: v };
    store.markDirty(); app.render();
  };

  // ----- 업무일지 -----
  const taskList = h('div.tasks');
  const taskInline = noteInline(app); // 업무 글·메모 속 #태그·이름 연결
  const drawTasks = () => {
    const tasks = store.visibleTasks(date);
    const allDone = tasks.length > 0 && tasks.every((t) => t.doneDate === date);
    const row = (t) => {
      const check = h('input', { type: 'checkbox', checked: t?.doneDate === date, disabled: !t, 'aria-label': '완료',
        onchange: (e) => {
          t.doneDate = e.target.checked ? date : null; rowEl.classList.toggle('done', e.target.checked); store.markDirty();
          drawNote(); // 완료하면 결과 메모 단추가 또렷해진다
        } });
      const input = h('input.task-text', {
        value: t?.text || '', placeholder: t ? '' : '할 일을 입력하세요 (Enter: 다음 줄)',
        oninput: (e) => {
          if (!t) {
            // 빈 줄에 입력을 시작하면 그 줄이 새 업무가 되고, 아래에 새 빈 줄이 생긴다 (한글 조합이 끊기지 않도록 다시 그리지 않음)
            t = { id: newId(), text: e.target.value, created: date, doneDate: null, priority: 'Z' };
            if (store.settings.taskSort === 'manual') t.order = Math.max(0, ...store.work.tasks.map((x) => x.order || 0)) + 10;
            store.work.tasks.push(t);
            check.disabled = false;
            input.placeholder = '';
            drawDue();
            drawNote();
            drawAnchor();
            delBtn.hidden = false;
            rowEl.classList.add('editing'); // 새로 쓰는 중에는 입력칸 그대로
            activate();
            taskList.append(row(null));
          } else t.text = e.target.value;
          store.markDirty();
        },
        onkeydown: (e) => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); taskList.querySelector('.task-row:last-child input.task-text')?.focus(); }
          if (e.key === 'Escape' && t) { e.preventDefault(); input.blur(); }
        },
        onblur: () => { if (t) { rowEl.classList.remove('editing'); drawLabel(); } },
      });
      // 보통 때는 글자로(줄바꿈해서 다 보이게, #태그·이름 연결), 누르면 입력칸
      const label = h('span.task-label', { onclick: (e) => {
        if (!t || e.target.closest('button') || rowEl.dataset.dragged) { delete rowEl.dataset.dragged; return; }
        rowEl.classList.add('editing');
        input.focus();
        const n = input.value.length; input.setSelectionRange(n, n);
      } });
      const drawLabel = () => { if (t) fill(label, ...(t.text ? taskInline(t.text) : [h('span.muted', '(빈 업무)')])); };
      // #태그·이름 추천 (업무에 #사업명 을 붙여 두면 태그 카드의 "남은 업무"로 모인다)
      attachStudentSuggest(input, () => store.work.students, () => store.work.people, () => store.tagList());
      // 마감일 아이콘: 누르면 날짜 고르기, 정해 두면 D-day 표시 (달력에도 보임)
      const dueWrap = h('span.due');
      // 마감일: 배지 위에 투명한 날짜 칸을 겹쳐 둔다 → 누르면 바로 날짜 창, 창이 떠도 칸이 사라지지 않음
      // D-day 는 보고 있는 날짜가 아니라 실제 오늘 기준
      const drawDue = () => {
        if (!t) { fill(dueWrap); return; }
        const d = dday(t.due, today());
        const badge = h(`span.due-btn${d ? (d.n < 0 ? '.over' : d.n <= 3 ? '.soon' : '') : ''}`, d ? d.label : '📅');
        const inp = h('input.due-input', {
          type: 'date', value: t.due || '', 'aria-label': '마감일', title: t.due ? `마감 ${t.due} (눌러서 바꾸기)` : '마감일 정하기',
          onclick: (e) => { try { e.target.showPicker?.(); } catch { /* 지원 안 하는 브라우저는 기본 동작 */ } },
          onchange: (e) => { if (e.target.value) t.due = e.target.value; else delete t.due; store.markDirty(); drawTasks(); },
        });
        fill(dueWrap, ...[h('label.due-pick', badge, inp),
          t.due ? h('button.icon-btn.due-clear', { title: '마감일 지우기', 'aria-label': '마감일 지우기', onclick: () => { delete t.due; store.markDirty(); drawTasks(); } }, '✕') : null].filter(Boolean));
      };
      drawDue();
      // 중요도: 눌러서 A · B · C · 언젠가 중 하나를 바로 고른다 (새 업무는 언젠가)
      const prio = h('select.prio', { 'aria-label': '중요도', title: '중요도', disabled: !t, onchange: (e) => {
        if (!t) return;
        t.priority = e.target.value;
        store.markDirty();
        drawTasks(); // 중요도 묶음이 바뀌므로 바로 자리 이동
      } }, PRIORITIES.map(([k, l]) => h('option', { value: k }, l)));
      const paintPrio = () => { const p = t ? priorityOf(t) : 'Z'; prio.value = p; prio.disabled = !t; prio.className = `prio p-${p}${t ? '' : ' ghost-prio'}`; };
      paintPrio();
      // 결과·진행 메모: 💬 를 누르면 업무 아래에 메모 칸 (완료한 업무의 진행 결과 등)
      const noteBtn = h('button.icon-btn.task-note-btn', { type: 'button', title: '결과·진행 메모', 'aria-label': '결과·진행 메모', onclick: () => {
        if (!t) return;
        const open = app.taskNoteOpen ||= new Set();
        if (open.has(t.id)) open.delete(t.id); else open.add(t.id);
        drawNote(true);
      } }, '💬');
      const noteBox = h('div.task-note');
      // 메모는 열었을 때만 칸을 차지한다 (닫으면 💬 단추에 점과 미리보기 풍선만)
      const drawNote = (focus = false) => {
        if (!t) { noteBtn.hidden = true; fill(noteBox); return; }
        const has = !!(t.result || '').trim();
        const open = app.taskNoteOpen?.has(t.id);
        noteBtn.hidden = false;
        noteBtn.className = `icon-btn task-note-btn${has ? ' has' : ''}${t.doneDate ? ' done' : ''}${open ? ' open' : ''}`;
        noteBtn.title = has ? `결과·진행 메모: ${t.result.trim().split('\n').slice(0, 3).join(' / ').slice(0, 120)}` : '결과·진행 메모 쓰기';
        if (open) {
          const close = () => { app.taskNoteOpen?.delete(t.id); drawNote(); };
          const ta = autoGrow(h('textarea', { rows: 1, value: t.result || '', placeholder: '결과·진행 메모 (#태그·이름도 알아봐요)', 'aria-label': '결과·진행 메모',
            oninput: (e) => { t.result = e.target.value; if (!t.result.trim()) delete t.result; store.markDirty(); drawBtn(); },
            onkeydown: (e) => { if (e.key === 'Escape') close(); },
            onblur: () => setTimeout(() => { if (document.activeElement !== ta && !document.querySelector('.suggest')) close(); }, 0) }));
          attachStudentSuggest(ta, () => store.work.students, () => store.work.people, () => store.tagList());
          fill(noteBox, ta);
          if (focus) requestAnimationFrame(() => ta.focus());
        } else if (has) {
          // 메모는 숨기지 않고 작은 글자로 늘 보인다 — 누르면 고치기
          fill(noteBox, h('div.task-memo', { title: '눌러서 고치기', onclick: (e) => { if (e.target.closest('button')) return; (app.taskNoteOpen ||= new Set()).add(t.id); drawNote(true); } },
            taskInline(t.result.trim())));
        } else fill(noteBox);
      };
      const drawBtn = () => { const has = !!(t?.result || '').trim(); noteBtn.classList.toggle('has', has); };
      // ⚓ 시간 연결: 끌어다 수업일지의 교시·시간 일정 줄에 놓거나, 눌러서 고르기
      const anchorBtn = h('button.icon-btn.task-anchor', { type: 'button', draggable: 'true', 'aria-label': '시간대에 연결',
        ondragstart: (e) => { if (!t) { e.preventDefault(); return; } e.dataTransfer.setData(TASK_MIME, t.id); e.dataTransfer.setData('text/plain', t.text); e.dataTransfer.effectAllowed = 'link'; document.body.classList.add('anchoring'); },
        ondragend: () => document.body.classList.remove('anchoring'),
        onclick: () => t && pickSlot(t) });
      const drawAnchor = () => {
        if (!t) { anchorBtn.hidden = true; return; }
        anchorBtn.hidden = false;
        // 줄에는 짧게(3교시, 15:30), 풍선 도움말에 자세히
        const short = (sl) => (/^p\d+$/.test(sl) ? store.periodLabel(+sl.slice(1)) : sl);
        const on = t.at?.date === date ? short(t.at.slot) : t.at ? `${t.at.date.slice(5).replace('-', '/')}` : '';
        const full = t.at ? `${t.at.date} ${slotLabel(t.at.slot, t.at.date)}` : '';
        anchorBtn.className = `icon-btn task-anchor${on ? ' on' : ''}`;
        anchorBtn.title = on ? `연결된 시간: ${full} (끌어다 다른 줄에 놓거나 눌러서 바꾸기)` : '수업일지의 교시·시간 일정 줄로 끌어다 놓으면 그 시간에 한 일로 연결 (눌러서 고르기)';
        fill(anchorBtn, '⚓', on ? h('small', on) : null);
      };
      const delBtn = h('button.icon-btn.task-del', { type: 'button', title: '업무 지우기', 'aria-label': '업무 지우기', onclick: async () => {
        if (!t) return;
        if (!(await confirmDialog('업무 지우기', `"${String(t.text || '').slice(0, 40)}"${t.result ? ' (결과 메모 포함)' : ''}을(를) 지울까요?`, '지우기'))) return;
        store.work.tasks = store.work.tasks.filter((x) => x !== t);
        app.taskNoteOpen?.delete(t.id);
        store.markDirty(); app.render();
      } }, '🗑');
      const handle = h('span.task-handle', { title: '끌어서 순서 바꾸기 (같은 중요도 안에서)', 'aria-hidden': 'true' }, '⋮⋮');
      drawNote();
      const rowEl = h(`div.task-row${t?.doneDate === date ? '.done' : ''}${t ? '' : '.editing'}`, handle, prio, check, label, input, dueWrap, anchorBtn, noteBtn, delBtn, noteBox);
      drawLabel();
      drawAnchor();
      if (!t) delBtn.hidden = true;
      // 업무가 생기면(처음부터 있거나, 빈 줄에 입력을 시작하면) 순서 바꾸기·중요도를 켠다
      function activate() {
        rowEl.dataset.id = t.id;
        rowEl.dataset.prio = priorityOf(t);
        paintPrio();
      }
      // 본문을 길게 누르면 들어 올려 같은 중요도 안에서 끌어 옮긴다 (손가락·마우스 공통)
      longPressDrag(rowEl, input, () => t, () => priorityOf(t));
      if (t) activate();
      return rowEl;
    };
    const sortSel = h('select.task-sort', { 'aria-label': '업무 정렬', onchange: (e) => {
      if (e.target.value === 'manual') store.reorderTasks(store.visibleTasks(date).map((x) => x.id));
      else store.updateSettings({ taskSort: 'auto' });
      drawTasks();
    } }, h('option', { value: 'auto', selected: store.settings.taskSort !== 'manual' }, '중요도 안에서 마감일 순'), h('option', { value: 'manual', selected: store.settings.taskSort === 'manual' }, '중요도 안에서 직접 정한 순서'));
    fill(taskList, 
      h('div.task-tools', sortSel, h('span.muted.small', '할 일을 길게 눌러 끌면 같은 중요도 안에서 순서를 바꿀 수 있어요')),
      h('label.bulk', h('input', { type: 'checkbox', checked: allDone, onchange: (e) => {
        for (const t of store.visibleTasks(date)) t.doneDate = e.target.checked ? date : null;
        store.markDirty(); drawTasks();
      } }), ' 전체 완료'),
      ...tasks.map(row), row(null));
  };
  /**
   * 길게 누르기(0.45초) → 끌기. 움직임이 먼저 생기면(스크롤) 취소.
   * 같은 중요도(data-prio)의 줄 사이에서만 자리를 바꾸고, 놓으면 그 순서로 저장한다.
   */
  // 손가락으로 끄는 동안 화면이 스크롤되지 않게: 터치 시작 전부터 등록돼 있어야 브라우저가 기다려 준다
  taskList.addEventListener('touchmove', (e) => { if (taskList.querySelector('.task-row.lifted')) e.preventDefault(); }, { passive: false });
  function longPressDrag(rowEl, input, getTask, getPrio) {
    let timer = null, start = null, dragging = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    // 줄을 옮기면(DOM 이동) 포인터 캡처가 풀리므로, 끄는 동안의 움직임은 문서 전체에서 받는다
    const onMove = (e) => {
      if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
      if (!dragging) return;
      e.preventDefault();
      const same = [...taskList.querySelectorAll(`.task-row[data-id][data-prio="${getPrio()}"]`)].filter((r) => r !== rowEl);
      const before = same.find((r) => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
      if (before) { if (rowEl.nextElementSibling !== before) taskList.insertBefore(rowEl, before); }
      else if (same.length) { const last = same.at(-1); if (last.nextElementSibling !== rowEl) last.after(rowEl); }
    };
    const detach = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
    const onUp = () => {
      cancel();
      detach();
      if (!dragging) return;
      dragging = false;
      rowEl.dataset.dragged = '1'; setTimeout(() => delete rowEl.dataset.dragged, 300);
      rowEl.classList.remove('lifted');
      store.reorderTasks([...taskList.querySelectorAll('.task-row[data-id]')].map((r) => r.dataset.id));
      drawTasks();
    };
    rowEl.addEventListener('contextmenu', (e) => { if (timer || dragging) e.preventDefault(); });
    rowEl.addEventListener('pointerdown', (e) => {
      if (!getTask() || e.button > 0 || e.target.closest('button, select, textarea, input[type=checkbox], input[type=date]')) return;
      const onHandle = !!e.target.closest('.task-handle');
      // 마우스는 손잡이(⋮⋮)를 잡으면 바로 끌기 — 글자칸을 길게 누르면 글자 선택과 부딪힌다. 손가락은 길게 누르기.
      if (e.pointerType === 'mouse' && !onHandle) return;
      start = { x: e.clientX, y: e.clientY };
      cancel(); detach();
      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
      if (onHandle) {
        e.preventDefault();
        dragging = true;
        input.blur();
        rowEl.classList.add('lifted');
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        dragging = true;
        input.blur();
        window.getSelection?.().removeAllRanges();
        navigator.vibrate?.(15);
        rowEl.classList.add('lifted');
      }, 450);
    });
  }
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
    fill(attBody, ...rows.map((a) => {
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
        h('td', studentSelect(store, a.student, (v) => { a.student = v; store.markDirty(); }, { cls: a.cls || '', date })),
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
    fill(tripBody, ...trips.map((t) => h('div.trip-row',
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

  // ----- 오늘의 노트 (날짜별, #태그) -----
  const noteCard = dayNoteCard(app, date);

  // ----- 학생 상담 일지 (가리기 기능) -----
  const counselView = h('div.counsel-view');
  let liveT;
  const livePreview = (text) => { clearTimeout(liveT); liveT = setTimeout(() => drawCounselView(text), 300); };
  const drawCounselView = (text) => {
    const paras = splitParagraphs(text);
    const plain = mentionInline(app, { onTag: (tag) => openTag(app, tag), update: (fn) => store.setCounselText(date, fn(store.counselText(date))) });
    fill(counselView, ...paras.map((p) => h('p.counsel-para', plain(p))));
  };
  const counselTa = autoGrow(h('textarea.counsel', {
    rows: 6,
    placeholder: '오늘 있었던 특이사항을 자유롭게 기록하세요.\n· "학번 이름" 또는 (동명이인이 없으면) "이름" 뒤에 한 칸 띄우면 학생으로 인식합니다. 예: "10203 홍길동 학생이 …"\n· 이름 두 글자를 쓰면 학생을 추천하고, "...고" 처럼 ... 뒤에 이름 일부나 학번을 쓰면 찾아 줘요. 빈 줄로 단락을 나누면 각각 별개의 상담 일지가 됩니다.',
    value: store.counselText(date),
    oninput: (e) => { store.setCounselText(date, e.target.value); livePreview(e.target.value); },
    onblur: (e) => drawCounselView(e.target.value),
  }));
  drawCounselView(counselTa.value);
  attachStudentSuggest(counselTa, () => store.work.students, () => store.work.people, () => store.tagList());
  // 학생 넣기: 학반 → 학생 고르면 커서 위치에 "학번 이름 " 삽입
  let pickCls = '';
  const pickWrap = h('span');
  const drawPick = () => fill(pickWrap, studentSelect(store, '', (uid) => {
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
    if (!hasStudents) { fill(recWrap, h('p.muted', '학생 정보를 등록하면 학급요록을 사용할 수 있습니다.')); return; }
    const groups = new Map();
    for (const r of recs) { const k = r.cls || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    fill(recWrap, ...[...groups].map(([cls, list]) => h('div.records-wrap',
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
        downloadBlob(blob, `교사수첩_${date}.${fileExt()}`);
      } }, dlLabel() + ' 다운로드'),
      h('button.primary', { onclick: () => app.save() }, '저 장')));

  // ----- 그날 날씨 (서울) -----
  const weatherEl = h('div.nb-weather.muted.small', { title: '서울 기준 날씨 (Open-Meteo)' });
  seoulWeather(date, today()).then((w) => {
    if (w) weatherEl.textContent = `서울 ${weatherText(w)}`;
    else weatherEl.remove();
  }).catch(() => weatherEl.remove());

  const ord = (el, n) => { el.style.setProperty('--ord', n); return el; };
  return h('div.notebook',
    h('div.print-only.print-title', `교사수첩 ${date}`),
    // 넓은 화면: 왼쪽에 학사일정·수업일지·학생출결·노트·상담·요록이 이어서 흐르고(업무가 길어도 빈 공간이 생기지 않게),
    // 오른쪽에 날씨·출장·업무일지. 좁은 화면은 order 로 날씨 → 학사일정 → 수업일지 → 출결 → 출장 → 업무 → 노트 → 상담 → 요록
    h(`div.nb-grid.nb-main${sec ? '.sec' : ''}`,
      h('div.col.nb-left', ord(scheduleCard, 1), ord(lessonCard, 2), ord(attCard, 3), ord(noteCard, 6), ord(privacy, 7), ord(recCard, 8)),
      h('div.col.nb-right', ord(weatherEl, 0), ord(tripCard, 4), ord(taskCard, 5), ord(quoteBox(date), 5), ord(reflectCard(app, date), 5))),
    footer);
}

// ----- 오늘의 문구 (프랭클린 플래너처럼 하루 한 줄) -----
function quoteBox(date) {
  const q = quoteOf(date);
  if (!q) return h('div');
  return h('figure.nb-quote', h('blockquote', q[0]), h('figcaption', `— ${q[1]}`));
}

// ----- 하루 돌아보기: 건강(몸·마음 별점) · 감사 · 공부 -----
function starPicker(app, date, key, label) {
  const wrap = h('span.stars', { role: 'radiogroup', 'aria-label': `${label} 컨디션` });
  const paint = () => {
    const v = app.store.day(date)?.[key] || 0;
    wrap.querySelectorAll('button').forEach((b, i) => { b.textContent = i < v ? '★' : '☆'; b.classList.toggle('on', i < v); b.setAttribute('aria-checked', String(i + 1 === v)); });
  };
  for (let i = 1; i <= 5; i++) {
    wrap.append(h('button.star', { type: 'button', role: 'radio', title: `${label} ${i}점`, 'aria-label': `${label} ${i}점`,
      onclick: () => { const cur = app.store.day(date)?.[key] || 0; app.store.setDayField(date, key, cur === i ? 0 : i); paint(); } }));
  }
  paint();
  return h('span.star-row', h('span.star-label', label), wrap);
}

function reflectCard(app, date) {
  const { store } = app;
  const box = (key, title, ph) => h('div.reflect-item',
    h('label.reflect-title', { for: `rf-${key}` }, title),
    autoGrow(h('textarea.reflect-text', { id: `rf-${key}`, rows: 1, value: store.day(date)?.[key] || '', placeholder: ph, 'data-keep': `rf-${key}`,
      oninput: (e) => store.setDayField(date, key, e.target.value.trim() ? e.target.value : '') })));
  return card('하루 돌아보기', null,
    h('div.reflect-item',
      h('div.reflect-title', '건강'),
      h('div.star-rows', starPicker(app, date, 'body', '몸'), starPicker(app, date, 'mind', '마음')),
      autoGrow(h('textarea.reflect-text', { rows: 1, value: store.day(date)?.health || '', placeholder: '오늘 몸 상태, 운동, 잠, 먹은 것…', 'aria-label': '건강 메모', 'data-keep': 'rf-health',
        oninput: (e) => store.setDayField(date, 'health', e.target.value.trim() ? e.target.value : '') }))),
    box('thanks', '감사한 일', '오늘 고마웠던 일·사람'),
    box('study', '공부한 것', '오늘 배우고 익힌 것 (예: 자격증 2장, 문제 30개)'));
}

// ----- 오늘의 노트: 쓰기 ↔ 보기, --- 로 주제 나누기, 간단한 마크다운 -----
const NOTE_MODE_KEY = 'sn:noteMode';

/** 노트 글자 속 #태그·학생·사람·기관 이름을 누를 수 있는 노드로 */
export const noteInline = (app, update = null) => mentionInline(app, { onTag: (tag) => openTag(app, tag), update });

function dayNoteCard(app, date) {
  const { store } = app;
  let mode = store.dayNote(date).trim() ? (localStorage.getItem(NOTE_MODE_KEY) || 'view') : 'edit';
  const body = h('div.note-body');
  const modeBtn = h('button.small');
  const info = h('span.muted.small');

  const ta = autoGrow(h('textarea.day-note', {
    rows: 4, value: store.dayNote(date), 'aria-label': '오늘의 노트',
    placeholder: '오늘의 노트 — 회의 내용, 주고받은 이야기, 생각, 아이디어를 자유롭게.\n' +
      '· #회의 #수행평가 처럼 #태그를 붙이면 태그 메뉴에서 모아 볼 수 있어요.\n' +
      '· 한 줄에 --- 만 쓰면 주제가 나뉘어 따로 보여요. (아래 "― 주제 나누기" 단추)\n' +
      '· ## 제목, - 목록, - [ ] 할 일, **굵게** 도 쓸 수 있어요.',
    oninput: (e) => { store.setDayNote(date, e.target.value); drawInfo(); },
  }));
  attachStudentSuggest(ta, () => store.work.students, () => store.work.people, () => store.tagList());

  /** 커서 자리에 글 넣기 (줄 단위면 줄 처음에) */
  const insert = (snippet, { line = false } = {}) => {
    const v = ta.value;
    let at = ta.selectionStart ?? v.length;
    if (line) {
      at = v.lastIndexOf('\n', at - 1) + 1;
    }
    let s = snippet;
    if (!line && at > 0 && v[at - 1] !== '\n') s = '\n' + s;
    ta.setRangeText(s, at, at, 'end');
    ta.dispatchEvent(new Event('input'));
    ta.focus();
  };
  const tools = h('div.note-tools',
    h('button.small', { type: 'button', title: '주제 나누기 (--- 한 줄)', onclick: () => insert('---\n') }, '― 주제 나누기'),
    h('button.small', { type: 'button', title: '제목 (## )', onclick: () => insert('## ', { line: true }) }, '제목'),
    h('button.small', { type: 'button', title: '목록 (- )', onclick: () => insert('- ', { line: true }) }, '• 목록'),
    h('button.small', { type: 'button', title: '할 일 (- [ ] )', onclick: () => insert('- [ ] ', { line: true }) }, '☐ 할 일'),
    h('button.small', { type: 'button', title: '#태그', onclick: () => { ta.setRangeText('#', ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); } }, '#'));

  const drawInfo = () => {
    const secs = splitSections(ta.value);
    const tags = new Set(extractTags(ta.value));
    info.textContent = [secs.length > 1 ? `주제 ${secs.length}개` : '', tags.size ? `태그 ${tags.size}개` : ''].filter(Boolean).join(' · ');
  };

  const openEdit = (line = null) => {
    mode = 'edit'; localStorage.setItem(NOTE_MODE_KEY, 'edit'); draw();
    requestAnimationFrame(() => {
      ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px';
      if (line != null) {
        const pos = ta.value.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0);
        ta.setSelectionRange(pos, pos);
      }
      ta.focus({ preventScroll: line == null });
    });
  };

  const drawView = () => {
    const text = store.dayNote(date);
    const secs = splitSections(text);
    if (!secs.length) return h('p.muted.note-empty', { onclick: () => openEdit() }, '아직 쓴 노트가 없어요. 눌러서 쓰기');
    const plain = noteInline(app, (fn) => store.setDayNote(date, fn(store.dayNote(date))));
    const onToggle = (line) => { const next = toggleTodo(store.dayNote(date), line); store.setDayNote(date, next); ta.value = next; draw(); };
    return h('div.note-secs', secs.map((s, i) => h(`article.note-sec${secs.length > 1 ? '.multi' : ''}`, {
      title: '두 번 누르면 이 부분을 고칩니다',
      ondblclick: (e) => { if (!e.target.closest('button, a, input, label')) openEdit(s.start); },
    },
    h('button.note-sec-edit', { type: 'button', title: '이 부분 고치기', 'aria-label': '이 부분 고치기', onclick: () => openEdit(s.start) }, '✎'),
    secs.length > 1 ? h('div.note-sec-no', `${i + 1}`) : null,
    h('div.md', renderMd(s.text, { start: s.start, plain, onToggle })))));
  };

  const draw = () => {
    modeBtn.textContent = mode === 'edit' ? '✓ 다 썼어요 (보기)' : '✎ 쓰기';
    if (mode === 'edit') fill(body, tools, ta);
    else fill(body, drawView());
    drawInfo();
  };
  modeBtn.onclick = () => {
    if (mode === 'edit') { mode = 'view'; localStorage.setItem(NOTE_MODE_KEY, 'view'); draw(); } else openEdit();
  };
  draw();
  return card('오늘의 노트', h('div.row', { style: { margin: 0, gap: '6px', alignItems: 'center' } }, info, modeBtn,
    h('button.small', { onclick: () => { app.tab = 'tags'; app.render(); } }, '# 태그')), body);
}
