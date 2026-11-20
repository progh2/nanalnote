// 엑셀·CSV 올리기 (학생 명단 등)
import { h, fill, modal, toast, pickFile, readTextFile, parseCSV, newId } from '../lib/util.js';
import { readXlsx } from '../lib/xlsx.js';
import { parseStudentRows, applyStudents, FIELD_LABEL } from '../lib/roster.js';
import { studentLabel } from '../lib/students.js';
import { migrateRefs } from '../store.js';

export const TABLE_ACCEPT = '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';

/** 파일 → 시트들 [{name, rows}] (CSV 는 시트 하나) */
export async function readTable(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const zipOrXls = (head[0] === 0x50 && head[1] === 0x4b) || (head[0] === 0xd0 && head[1] === 0xcf);
  if (/\.xlsx?$/i.test(file.name) || zipOrXls) return readXlsx(await file.arrayBuffer());
  return [{ name: file.name.replace(/\.[^.]+$/, ''), rows: parseCSV(await readTextFile(file)) }];
}

/**
 * 학생 명단 올리기: 파일 고르기 → 미리 보기(시트·찾은 열·몇 명·겹침) → 더하고 고치기 / 바꾸기
 * @param file 이미 고른 파일 (없으면 고르게 한다)
 */
export async function openStudentImport(app, file = null) {
  const { store } = app;
  file ||= await pickFile(TABLE_ACCEPT);
  if (!file) return;
  let sheets;
  try { sheets = await readTable(file); } catch (e) { toast(e.message, 'error'); return; }
  sheets = sheets.filter((s) => s.rows.some((r) => r.some(Boolean)));
  if (!sheets.length) { toast('빈 파일입니다.', 'error'); return; }

  // 학생 표가 들어 있는 첫 시트부터 보여 준다
  const firstOk = sheets.findIndex((sh) => { try { return parseStudentRows(sh.rows).list.length > 0; } catch { return false; } });
  const st = { sheet: Math.max(0, firstOk), mode: store.work.students.length ? 'merge' : 'replace', parsed: null, error: '' };
  const view = h('div.import-view');
  const draw = () => {
    try { st.parsed = parseStudentRows(sheets[st.sheet].rows); st.error = ''; } catch (e) { st.parsed = null; st.error = e.message; }
    const p = st.parsed;
    fill(view,
      sheets.length > 1 ? h('label.row', '시트 ', h('select', { onchange: (e) => { st.sheet = +e.target.value; draw(); } },
        sheets.map((s, i) => h('option', { value: i, selected: i === st.sheet }, `${s.name} (${s.rows.length}줄)`)))) : null,
      st.error ? h('p.error-text', st.error) : null,
      p ? h('div',
        h('p', h('strong', `${p.list.length}명`), `을 읽었습니다. `,
          h('span.muted.small', `${p.header >= 0 ? `머리줄: ${p.header + 1}번째 줄 · ` : ''}찾은 열: ${p.found.map((k) => FIELD_LABEL[k]).join(', ')}`)),
        p.dupNos.length ? h('p.error-text', `학번이 겹칩니다: ${p.dupNos.join(', ')} — 고쳐서 다시 올려 주세요.`) : null,
        !p.found.includes('studentNo') && !(p.found.includes('grade') && p.found.includes('cls')) ? h('p.warn-text', '학번(또는 학년·반·번호) 열이 없어 이름으로만 맞춥니다. 동명이인이 있으면 학번 열을 넣어 주세요.') : null,
        h('div.records-wrap', h('table.grid.import-preview',
          h('thead', h('tr', h('th', '학번'), h('th', '이름'), h('th', '학년-반-번호'), h('th', '성별'), h('th', '연락처'))),
          h('tbody', p.list.slice(0, 8).map((s) => h('tr', h('td', s.studentNo || ''), h('td', s.name), h('td', [s.grade, s.cls, s.no].filter((x) => x != null).join('-')), h('td', s.gender || ''), h('td', [s.phone, s.email].filter(Boolean).join(' · '))))))),
        p.list.length > 8 ? h('p.muted.small', `… 외 ${p.list.length - 8}명`) : null,
        h('div.import-modes',
          h('label.check', h('input', { type: 'radio', name: 'imode', checked: st.mode === 'merge', onchange: () => { st.mode = 'merge'; } }),
            ' ', h('strong', '지금 명단에 더하고 고치기'), h('span.muted.small', ' — 학번이 같은 학생은 고치고, 새 학생은 더합니다. 파일에 없는 학생은 그대로 둡니다. 빈 칸은 지금 값을 지우지 않습니다.')),
          h('label.check', h('input', { type: 'radio', name: 'imode', checked: st.mode === 'replace', onchange: () => { st.mode = 'replace'; } }),
            ' ', h('strong', '새 명단으로 바꾸기'), h('span.muted.small', ' — 파일에 없는 학생은 명단에서 빠집니다(휴학생은 남김). 학번이 같은 학생의 기록·사진·표시는 유지됩니다.')))) : null);
  };
  draw();
  const ok = await modal(`학생 명단 올리기 — ${file.name}`, view, [{ label: '취소', value: false }, { label: '올리기', value: true, primary: true }]);
  if (!ok) return;
  const p = st.parsed;
  if (!p || !p.list.length) { toast(st.error || '올릴 학생이 없습니다.', 'error'); return; }
  if (p.dupNos.length) { toast(`학번이 겹칩니다: ${p.dupNos.join(', ')}`, 'error'); return; }

  let prev = [];
  try {
    const d = await store.backend.loadYear(store.year - 1);
    const ps = { students: d?.students || [], attendance: [], counsel: [], records: [] };
    migrateRefs(ps);
    prev = ps.students;
  } catch { /* 지난 학년도 없음 */ }
  const r = applyStudents(store.work.students, p.list, st.mode, { prev, date: app.date, newId });
  store.work.students = r.students;
  store.markDirty();
  toast(`학생 ${r.added}명 추가, ${r.updated}명 고침${r.removed ? `, ${r.removed}명 빠짐` : ''}${r.linked ? ` (지난 학년도 기록과 ${r.linked}명 연결)` : ''}`, 'ok');
  app.render();
  return r;
}

/** 예제: 학생 명단 */
export const STUDENT_TEMPLATE = [['학번', '학년', '반', '번호', '이름', '성별', '이메일', '전화번호', '이전학번'],
  ['10101', '1', '1', '1', '홍길동', '남', 'hong@example.com', '010-0000-0000', ''],
  ['10102', '1', '1', '2', '성춘향', '여', '', '', '']];

export { studentLabel };
