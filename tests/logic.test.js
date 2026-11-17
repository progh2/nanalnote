import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage 대용
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; },
};

const { splitParagraphs, mentionedStudents, tokenize } = await import('../src/lib/counsel.js');
const { Store } = await import('../src/store.js');
const { LocalBackend } = await import('../src/backends/local.js');
const { schoolYearOf, normalizeDate, parseCSV } = await import('../src/lib/util.js');
const { builtinMonth } = await import('../src/lib/holidays.js');

test('상담일지: 빈 줄로 단락 분리', () => {
  assert.deepEqual(splitParagraphs('이몽룡 울었다\n달래줌\n\n\n성춘향 결석\n  \n홍길동 지각'), ['이몽룡 울었다\n달래줌', '성춘향 결석', '홍길동 지각']);
});

test('상담일지: 이름 + 띄어쓰기 규칙', () => {
  const names = ['이몽룡', '성춘향', '홍길동1'];
  assert.deepEqual(mentionedStudents('이몽룡 학생과 성춘향, 상담', names), ['이몽룡', '성춘향']);
  assert.deepEqual(mentionedStudents('이몽룡이 울었다', names), []);
  assert.deepEqual(mentionedStudents('홍길동1 칭찬', names), ['홍길동1']);
  assert.deepEqual(mentionedStudents('김이몽룡 학생', names), []);
  const t = tokenize('오늘 이몽룡 상담', names);
  assert.deepEqual(t, [{ text: '오늘 ' }, { text: '이몽룡', name: '이몽룡' }, { text: ' 상담' }]);
});

test('학년도/날짜 정규화/CSV', () => {
  assert.equal(schoolYearOf('2026-02-28'), 2025);
  assert.equal(schoolYearOf('2026-03-01'), 2026);
  assert.equal(normalizeDate('2026.3.2'), '2026-03-02');
  assert.equal(normalizeDate('20260302'), '2026-03-02');
  assert.equal(normalizeDate('2026년 3월 2일'), '2026-03-02');
  assert.deepEqual(parseCSV('﻿날짜,일정\r\n2026-03-02,"입학식, 시업식"\r\n2026-03-03,\r\n'), [['날짜', '일정'], ['2026-03-02', '입학식, 시업식'], ['2026-03-03', '']]);
});

test('내장 특일정보', () => {
  const mar = builtinMonth(2026, 3);
  assert.ok(mar.find((x) => x.date === '2026-03-01' && x.holiday));
  assert.ok(mar.find((x) => x.date === '2026-03-02' && x.holiday));
});

test('Store: 저장/diff/업무일지 노출 규칙/상담 단락 변환', async () => {
  const s = new Store(new LocalBackend());
  await s.load(2026);
  s.work.students.push({ id: 'n_a', uid: 'u1', no: 1, name: '이몽룡' }, { id: 'n_b', uid: 'u2', no: 2, name: '성춘향' });
  s.updateSettings({ timetable: { 1: ['국어', '수학'] } });
  s.setLesson('2026-03-02', 1, { content: '자기소개' }); // 월요일
  s.work.tasks.push({ id: 'n_t', text: '가정통신문', created: '2026-03-02', doneDate: null });
  s.setCounselText('2026-03-02', '이몽룡 울었다\n\n성춘향 결석');
  let r = await s.save(['2026-03-02']);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(s.dirty, false);
  assert.ok(s.work.students.every((x) => x.id.startsWith('l_')));
  assert.equal(s.work.counsel.length, 2);
  assert.deepEqual(s.counselFor('u1').map((c) => c.text), ['이몽룡 울었다']);
  assert.equal(s.lessonsFor('2026-03-02', 1)[0].subject, '국어');
  assert.equal(s.lessonsFor('2026-03-09', 1)[1].subject, '수학');
  assert.ok(s.day('2026-03-02').updatedAt);

  // 업무 완료 → 완료일까지 보이고 다음날부터 안 보임
  s.work.tasks[0].doneDate = '2026-03-04';
  assert.equal(s.visibleTasks('2026-03-01').length, 0);
  assert.equal(s.visibleTasks('2026-03-04').length, 1);
  assert.equal(s.visibleTasks('2026-03-05').length, 0);

  // 상담 단락 줄이면 삭제 op, 수업 내용 지우면 삭제
  s.setCounselText('2026-03-02', '이몽룡 울었다');
  s.setLesson('2026-03-02', 1, { content: '' });
  const before = s.work.lessons.length;
  r = await s.save(['2026-03-02']);
  assert.ok(r.ok);
  assert.equal(s.work.counsel.length, 1);
  assert.equal(s.work.lessons.length, before - 1);
  assert.equal(s.diff().length, 0);

  // 다시 불러와도 동일
  const s2 = new Store(new LocalBackend());
  await s2.load(2026);
  assert.equal(s2.work.counsel.length, 1);
  assert.equal(s2.settings.timetable[1][0], '국어');
});

test('Store: 요록 제목 자동 채번, 빈 요록 제거', async () => {
  const s = new Store(new LocalBackend());
  await s.load(2027);
  s.work.records.push({ id: 'n_r1', title: '', created: '2027-03-05', doneDate: null, entries: { u9: 'O' } });
  s.work.records.push({ id: 'n_r2', title: '', created: '2027-03-05', doneDate: null, entries: {} });
  s.markDirty();
  await s.save();
  assert.equal(s.work.records.length, 1);
  assert.equal(s.work.records[0].title, '20270305-1');
});

const { normStudent, mentionedUids, resolveRef, buildIndex, matchPhotoFile, tokenizeStudents } = await import('../src/lib/students.js');
const { migrateRefs } = await import('../src/store.js');

test('학생: 학번 ↔ 학년/반/번호, 동명이인은 학번으로 구분', () => {
  assert.deepEqual(normStudent({ studentNo: '10203', name: ' 이몽룡 ' }), { studentNo: '10203', grade: 1, cls: 2, no: 3, name: '이몽룡' });
  assert.equal(normStudent({ grade: 2, cls: 11, no: 7, name: 'a' }).studentNo, '21107');
  const st = [
    { uid: 'a', studentNo: '10203', name: '김민준' }, { uid: 'b', studentNo: '20511', name: '김민준' }, { uid: 'c', studentNo: '10204', name: '이서연' },
  ];
  // 동명이인은 이름만으로는 인식하지 않고, 학번을 붙이면 인식
  assert.deepEqual(mentionedUids('김민준 결석', st), []);
  assert.deepEqual(mentionedUids('20511 김민준 결석, 이서연 지각', st), ['b', 'c']);
  assert.deepEqual(mentionedUids('김민준(10203) 상담', st), ['a']);
  assert.deepEqual(tokenizeStudents('오늘 10203 김민준 칭찬', st).map((t) => t.uid || ''), ['', 'a', ' 칭찬'.length ? '' : '']);
  const idx = buildIndex(st);
  assert.equal(resolveRef('20511 김민준', idx).uid, 'b');
  assert.equal(resolveRef('이서연', idx).uid, 'c');
  assert.equal(resolveRef('김민준', idx), null);
  assert.equal(matchPhotoFile('IMG_20511_김민준.jpg', st).uid, 'b');
  assert.equal(matchPhotoFile('이서연.png', st).uid, 'c');
});

test('예전 데이터(이름 참조)를 uid 로 변환', () => {
  const d = { students: [{ id: 'x1', no: 1, name: '이몽룡' }], attendance: [{ student: '이몽룡' }], counsel: [{ students: ['이몽룡'] }], records: [{ entries: { 이몽룡: 'O' } }] };
  migrateRefs(d);
  assert.equal(d.students[0].uid, 'x1');
  assert.equal(d.attendance[0].student, 'x1');
  assert.deepEqual(d.counsel[0].students, ['x1']);
  assert.deepEqual(d.records[0].entries, { x1: 'O' });
});

test('휴업일·출장·중고 수업일지(수업명/학반/교실) 저장', async () => {
  const s = new Store(new LocalBackend());
  await s.load(2028);
  s.updateSettings({ schoolLevel: 'secondary', timetable: { 2: [{ subject: '정보', cls: '1-2', room: '컴퓨터실' }] } });
  s.setSchoolHoliday('2028-05-04', true);
  s.work.trips.push({ id: 'n_tr', date: '2028-05-02', time: '13:00~17:00', place: '교육청', purpose: '연수' });
  const l = s.lessonsFor('2028-05-02', 2)[0]; // 화요일
  assert.deepEqual([l.subject, l.cls, l.room], ['정보', '1-2', '컴퓨터실']);
  s.setLesson('2028-05-02', 1, { content: '조건문' });
  const r = await s.save(['2028-05-02']);
  assert.ok(r.ok);
  const s2 = new Store(new LocalBackend());
  await s2.load(2028);
  assert.equal(s2.isSchoolHoliday('2028-05-04'), true);
  assert.equal(s2.scheduleText('2028-05-04'), '휴업일');
  assert.equal(s2.tripsOn('2028-05-02')[0].place, '교육청');
  assert.equal(s2.work.lessons[0].room, '컴퓨터실');
});
