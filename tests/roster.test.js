import { test } from 'node:test';
import assert from 'node:assert/strict';
const { parseStudentRows, applyStudents } = await import('../src/lib/roster.js');

test('학교 명렬표 모양: 제목 줄 아래 머리줄, 다른 열 이름, "1반"·"남자" 같은 값', () => {
  const rows = [['2026학년도 2학년 명렬표'], [], ['학년', '반', '번호', '성명', '성 별', '휴대전화', '비고'], ['2', '1반', '1', '김민준', '남자', '010-1111-2222', ''], ['2', '1반', '2', '이서연', '여', '', '전입'], ['', '', '', '', '', '', ''], ['학년', '반', '번호', '성명']];
  const r = parseStudentRows(rows);
  assert.equal(r.header, 2);
  assert.deepEqual(r.found, ['grade', 'cls', 'no', 'name', 'gender', 'phone']);
  assert.equal(r.list.length, 2);
  assert.deepEqual([r.list[0].grade, r.list[0].cls, r.list[0].no, r.list[0].studentNo, r.list[0].gender, r.list[0].phone], [2, 1, 1, '20101', '남', '010-1111-2222']);
  assert.equal(r.list[1].gender, '여');
});

test('학번 겹침 알림, 머리줄 없는 예전 형식', () => {
  assert.deepEqual(parseStudentRows([['학번', '이름'], ['20101', '가'], ['20101', '나']]).dupNos, ['20101']);
  const old = parseStudentRows([['1', '가나다'], ['2', '라마바']]);
  assert.deepEqual(old.list.map((s) => [s.no, s.name]), [[1, '가나다'], [2, '라마바']]);
  assert.throws(() => parseStudentRows([['아무거나']]), /이름/);
});

const cur = [
  { id: 'a', uid: 'U1', studentNo: '20101', grade: 2, cls: 1, no: 1, name: '김민준', phone: '010-0000-0000', flags: ['watch'], photo: 'p.jpg' },
  { id: 'b', uid: 'U2', studentNo: '20102', grade: 2, cls: 1, no: 2, name: '이서연' },
  { id: 'c', uid: 'U3', studentNo: '', grade: 2, cls: null, no: null, name: '박도윤' }, // 이어받아 학번 없음
  { id: 'd', uid: 'U4', studentNo: '20199', grade: 2, cls: 1, no: 99, name: '휴학생', statusLog: [{ date: '2026-03-02', type: '휴학' }] },
];

test('더하고 고치기: 학번이 같으면 고치고(빈 칸은 유지), 없으면 추가, 목록에 없는 학생은 그대로', () => {
  const list = parseStudentRows([['학번', '이름', '연락처'], ['20101', '김민준', ''], ['20103', '박도윤', ''], ['20104', '최하은', '010-9']]).list;
  const r = applyStudents(cur, list, 'merge', { date: '2026-11-20' });
  assert.deepEqual([r.added, r.updated, r.removed], [1, 2, 0]);
  const by = Object.fromEntries(r.students.map((s) => [s.name, s]));
  assert.equal(by['김민준'].phone, '010-0000-0000'); // 빈 칸은 지우지 않음
  assert.deepEqual(by['김민준'].flags, ['watch']);
  assert.equal(by['김민준'].photo, 'p.jpg');
  assert.equal(by['박도윤'].uid, 'U3'); // 학번 없던 학생과 이어짐
  assert.equal(by['박도윤'].studentNo, '20103');
  assert.ok(by['이서연'] && by['휴학생']);
  assert.equal(r.students.length, 5);
});

test('바꾸기: 목록에 없는 학생은 빠지되 휴학생은 남고, 지난 학년도와 잇기', () => {
  const prev = [{ uid: 'P9', studentNo: '10105', grade: 1, name: '최하은', flags: ['good'] }];
  const list = parseStudentRows([['학번', '이름', '이전학번'], ['20101', '김민준', ''], ['20104', '최하은', '10105']]).list;
  const r = applyStudents(cur, list, 'replace', { prev, date: '2026-11-20' });
  assert.deepEqual(r.students.map((s) => s.name).sort(), ['김민준', '최하은', '휴학생'].sort());
  assert.equal(r.removed, 2);
  assert.equal(r.linked, 1);
  const ha = r.students.find((s) => s.name === '최하은');
  assert.equal(ha.uid, 'P9');
  assert.deepEqual(ha.flags, ['good']);
});
