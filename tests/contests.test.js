import { test } from 'node:test';
import assert from 'node:assert/strict';
const { spanOf, contestStatus, nextEvent, dayEvents, resultText, activityRows, contestSheets, awardCount } = await import('../src/lib/contests.js');
const { readXlsx, writeXlsx } = await import('../src/lib/xlsx.js');

const c = {
  id: 'c', name: 'SW 공모전', kind: '공모전', host: '과기정통부', completion: true,
  stages: [{ id: 'a', name: '접수', start: '2026-05-01', end: '2026-05-31' }, { id: 'b', name: '예선', start: '2026-09-10' }, { id: 'd', name: '본선', start: '2026-11-20', end: '2026-11-21' }],
  entries: [{ id: 'e1', team: '코딩왕', members: ['u1', 'u2'], results: { b: '통과', d: '참가' }, award: '금상', done: true }, { id: 'e2', members: ['u3'], results: { b: '탈락' } }],
};
const students = [{ uid: 'u1', studentNo: '20101', name: '김민준' }, { uid: 'u2', studentNo: '20102', name: '이서연' }, { uid: 'u3', studentNo: '20103', name: '박도윤' }];
const label = (uid) => { const s = students.find((x) => x.uid === uid); return s ? `${s.studentNo} ${s.name}` : uid; };

test('기간·상태: 대회 기간이 없으면 단계 날짜로', () => {
  assert.deepEqual(spanOf(c), { start: '2026-05-01', end: '2026-11-21' });
  assert.equal(contestStatus(c, '2026-04-01'), 'soon');
  assert.equal(contestStatus(c, '2026-11-20'), 'active');
  assert.equal(contestStatus(c, '2026-12-01'), 'done');
  assert.equal(contestStatus({ name: 'x' }, '2026-01-01'), 'active');
});

test('다음 일정과 D-day, 그날 일정', () => {
  assert.deepEqual(nextEvent(c, '2026-05-10'), { date: '2026-05-31', label: '접수 마감', n: 21 });
  assert.deepEqual(nextEvent(c, '2026-09-10'), { date: '2026-09-10', label: '예선', n: 0 });
  assert.equal(nextEvent(c, '2026-12-01'), null);
  assert.deepEqual(dayEvents([c], '2026-11-20').map((x) => x.text), ['본선 시작']);
  assert.deepEqual(dayEvents([c], '2026-09-10').map((x) => x.text), ['예선']);
  assert.deepEqual(dayEvents([{ name: 'y', start: '2026-03-02', stages: [] }], '2026-03-02').map((x) => x.text), ['시작']);
});

test('결과·학생별 줄·엑셀 시트', () => {
  assert.equal(resultText(c, c.entries[0]), '예선 통과 · 본선 참가');
  assert.equal(awardCount(c), 1);
  const rows = activityRows([c], students, label);
  assert.deepEqual(rows.map((r) => [r.studentNo, r.award, r.done]), [['20101', '금상', '수료'], ['20102', '금상', '수료'], ['20103', '', '미수료']]);
  const sheets = contestSheets(c, label, students);
  assert.deepEqual(sheets.map((s) => s.name), ['개요', '일정', '참가', '참가 학생']);
  assert.deepEqual(sheets[2].rows[0], ['팀', '학생', '접수', '예선', '본선', '수상', '수료', '메모']);
  assert.deepEqual(sheets[2].rows[1], ['코딩왕', '20101 김민준, 20102 이서연', '', '통과', '참가', '금상', '수료', '']);
  // 엑셀로 써서 다시 읽어도 같은 내용
  const back = readXlsx(writeXlsx(sheets));
  const trim = (r) => { const a = [...r]; while (a.length && a.at(-1) === '') a.pop(); return a; };
  assert.deepEqual(back[2].rows[1], trim(sheets[2].rows[1])); // 끝의 빈 칸은 엑셀에 남지 않음
});
