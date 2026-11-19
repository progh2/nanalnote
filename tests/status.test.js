import { test } from 'node:test';
import assert from 'node:assert/strict';
const { statusAt, logToText, textToLog, textToLeaving, leavingToText, flagsToText, textToFlags, normStudent } = await import('../src/lib/students.js');

const st = { statusLog: [
  { date: '2025-04-01', type: '휴학', memo: '질병' },
  { date: '2025-09-01', type: '복학', grade: 1 },
  { date: '2026-03-02', type: '휴학' },
  { date: '2026-06-10', type: '기타', memo: '상담' },
  { date: '2026-09-01', type: '복학', grade: 2 },
] };

test('보는 날짜 기준 학적 상태 (휴학→복학→휴학→복학, 기타는 상태를 바꾸지 않음)', () => {
  assert.equal(statusAt(st, '2025-03-10').state, 'active');
  assert.equal(statusAt(st, '2025-05-01').state, 'leave');
  assert.equal(statusAt(st, '2025-10-01').state, 'active');
  assert.equal(statusAt(st, '2026-07-01').state, 'leave');
  assert.equal(statusAt(st, '2026-07-01').ev.date, '2026-03-02');
  assert.equal(statusAt(st, '2026-09-01').ev.grade, 2);
  assert.equal(statusAt({ statusLog: [{ date: '2026-05-01', type: '전출' }] }, '2026-05-01').state, 'gone');
  assert.equal(statusAt({ statusLog: [{ date: '2026-05-01', type: '자퇴' }, { date: '2027-03-02', type: '재입학', grade: 2 }] }, '2027-03-02').state, 'active');
  assert.equal(statusAt({}, '2026-01-01').state, 'active');
});

test('파일 칸 왕복: 학적·전출예정·표시', () => {
  assert.deepEqual(textToLog(logToText(st.statusLog)), st.statusLog);
  assert.deepEqual(textToLog('2026-12-01 학년 변경(3학년) - 조기 진급'), [{ date: '2026-12-01', type: '학년 변경', grade: 3, memo: '조기 진급' }]);
  assert.deepEqual(textToLog('엉터리; 2026-01-01 모름'), []);
  const lv = { type: '퇴학', date: '2026-12-01', memo: '징계' };
  assert.deepEqual(textToLeaving(leavingToText(lv)), lv);
  assert.equal(textToLeaving('이사'), null);
  assert.equal(flagsToText(['watch', 'good']), '◆●');
  assert.deepEqual(textToFlags('●'), ['watch']);
});

test('정리: 학적은 날짜순, 빈 표시는 지움', () => {
  const n = normStudent({ name: '가', statusLog: [{ date: '2026-09-01', type: '복학', grade: '2' }, { date: '2026-03-02', type: '휴학', memo: ' ' }], flags: [], flagMemo: ' ' });
  assert.deepEqual(n.statusLog, [{ date: '2026-03-02', type: '휴학' }, { date: '2026-09-01', type: '복학', grade: 2 }]);
  assert.equal(n.flags, undefined);
  assert.equal(n.flagMemo, undefined);
});
