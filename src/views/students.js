// 학생관리 탭: 학생 명단 편집 + 학생별 상담 일지/출결/요록 모아보기
import { h, newId, koDate, downloadBlob, confirmDialog, modal, toast } from '../lib/util.js';
import { exportCounsel } from '../lib/export.js';

function counselList(app, name, onGo) {
  const items = app.store.counselFor(name);
  if (!items.length) return h('p.muted', '기록된 상담 일지가 없습니다.');
  return h('div.counsel-list', items.map((c) => h('div.counsel-item',
    h('button.link', { onclick: () => onGo(c.date), title: '이 날짜의 교사수첩으로 이동' }, koDate(c.date)),
    h('p', c.text))));
}

/** 상담 내역 조회 창 (교사수첩에서 학생 이름 클릭 시) */
export async function showStudentCounsel(app, name) {
  let goDate = null;
  const body = h('div',
    h('div.row', h('button.small', { onclick: async () => downloadBlob(await exportCounsel(name, app.store.counselFor(name)), `상담일지_${name}.docx`) }, '⬇ Word 다운로드')),
    counselList(app, name, (d) => { goDate = d; document.querySelector('.modal-overlay')?.click(); }));
  await modal(`${name} 학생 상담 일지`, body);
  if (goDate) { app.tab = 'notebook'; await app.setDate(goDate); app.render(); }
}

export function renderStudents(app) {
  const { store } = app;
  const students = [...store.work.students].sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
  const sel = app.selectedStudent && students.find((s) => s.name === app.selectedStudent) ? app.selectedStudent : students[0]?.name;

  const listBody = h('tbody', students.map((s) => h(`tr${s.name === sel ? '.selected' : ''}`,
    h('td', h('input.num', { type: 'number', value: s.no ?? '', 'aria-label': '번호', oninput: (e) => { s.no = e.target.value === '' ? null : +e.target.value; store.markDirty(); } })),
    h('td', h('input', { value: s.name, 'aria-label': '이름', oninput: (e) => { s.name = e.target.value; store.markDirty(); } })),
    h('td', h('button.small', { onclick: () => { app.selectedStudent = s.name; app.render(); } }, '보기')),
    h('td', h('button.icon-btn', { title: '삭제', onclick: async () => {
      if (!(await confirmDialog('학생 삭제', `${s.name} 학생을 명단에서 삭제할까요? (작성한 일지는 남습니다)`, '삭제'))) return;
      store.work.students = store.work.students.filter((x) => x !== s); store.markDirty(); app.render();
    } }, '✕')))));

  const left = h('section.card',
    h('div.card-head', h('h2', `학생 명단 (${students.length}명)`),
      h('button.small', { onclick: () => {
        const no = Math.max(0, ...students.map((s) => s.no || 0)) + 1;
        store.work.students.push({ id: newId(), no, name: '' }); store.markDirty(); app.render();
      } }, '+ 학생 추가')),
    h('p.muted.small', '동명이인은 홍길동1, 홍길동2 처럼 구분해 주세요. 이름으로 상담 일지를 모읍니다.'),
    h('table.grid', h('thead', h('tr', h('th', { style: { width: '5em' } }, '번호'), h('th', '이름'), h('th', ''), h('th', ''))), listBody),
    h('div.row', h('button.primary', { onclick: () => {
      const names = store.work.students.map((s) => s.name.trim());
      if (names.some((n) => !n)) return toast('이름이 빈 학생이 있습니다.', 'error');
      if (new Set(names).size !== names.length) return toast('중복된 이름이 있습니다. 홍길동1, 홍길동2 처럼 구분하세요.', 'error');
      app.save();
    } }, '명단 저장')));

  let right;
  if (!sel) right = h('section.card', h('p.muted', '학생을 등록하면 학생별 기록을 모아볼 수 있습니다.'));
  else {
    const att = store.work.attendance.filter((a) => a.student === sel).sort((a, b) => a.date.localeCompare(b.date));
    const recs = store.work.records.filter((r) => (r.entries?.[sel] || '').trim());
    const go = async (d) => { app.tab = 'notebook'; await app.setDate(d); app.render(); };
    right = h('div.col',
      h('section.card',
        h('div.card-head', h('h2', `${sel} · 상담 일지`),
          h('button.small', { onclick: async () => downloadBlob(await exportCounsel(sel, store.counselFor(sel)), `상담일지_${sel}.docx`) }, '⬇ Word')),
        counselList(app, sel, go)),
      h('section.card', h('div.card-head', h('h2', `${sel} · 출결`)),
        att.length ? h('table.grid', h('thead', h('tr', h('th', '날짜'), h('th', '구분'), h('th', '사유'), h('th', '비고'))),
          h('tbody', att.map((a) => h('tr', h('td', h('button.link', { onclick: () => go(a.date) }, a.date)), h('td', a.type), h('td', a.reason), h('td', a.note)))))
          : h('p.muted', '출결 특이사항이 없습니다.')),
      h('section.card', h('div.card-head', h('h2', `${sel} · 학급요록`)),
        recs.length ? h('table.grid', h('thead', h('tr', h('th', '요록'), h('th', '등록일'), h('th', '내용'))),
          h('tbody', recs.map((r) => h('tr', h('td', r.title), h('td', r.created), h('td', r.entries[sel])))))
          : h('p.muted', '요록 기록이 없습니다.')));
  }
  return h('div.split', left, right);
}
