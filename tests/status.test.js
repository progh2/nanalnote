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

// ---------- 입학 예정·임시 학번·학과 ----------
const { parseDeptRules, deptOf, entryYearOf, cleanNo, partsOfNo, sortStudents, buildIndex, resolveRef } = await import('../src/lib/students.js');
const RULES = `2024~2026 1~4반 뉴미디어소프트웨어과
2024~2026 5~6반 뉴미디어디자인과
2027~ 1~4반 지능형소프트웨어과
2027~ 5~6반 지능형디자인과`;

test('학과 규칙: 입학 학년도(없으면 학년으로 어림)와 반으로', () => {
  const rules = parseDeptRules(RULES);
  assert.equal(rules.length, 4);
  assert.deepEqual(rules[2], { from: 2027, to: 9999, c1: 1, c2: 4, name: '지능형소프트웨어과' });
  assert.equal(deptOf({ grade: 3, cls: 2 }, rules, 2026), '뉴미디어소프트웨어과'); // 2024 입학
  assert.equal(deptOf({ grade: 1, cls: 6 }, rules, 2026), '뉴미디어디자인과');
  assert.equal(deptOf({ grade: 1, cls: 5, entryYear: 2027 }, rules, 2026), '지능형디자인과');
  assert.equal(deptOf({ grade: 2, cls: 3, dept: '직접 쓴 과' }, rules, 2026), '직접 쓴 과');
  assert.equal(deptOf({ grade: 1, cls: 9 }, rules, 2026), '');
  assert.equal(entryYearOf({ grade: 2 }, 2026), 2025);
  assert.deepEqual(parseDeptRules('2025 3반 : 한 학년도 한 반\n잘못된 줄'), [{ from: 2025, to: 2025, c1: 3, c2: 3, name: '한 학년도 한 반' }]);
});

test('임시 학번과 입학 예정 상태', () => {
  assert.equal(cleanNo(' 임시 1101 '), '임시1101');
  assert.equal(cleanNo('20101번'), '20101');
  assert.deepEqual(partsOfNo('임시1101'), { grade: 1, cls: 1, no: 1 });
  const n = normStudent({ studentNo: '임시1203', name: '신입', entryYear: 2027 });
  assert.deepEqual([n.grade, n.cls, n.no], [1, 2, 3]);
  assert.equal(statusAt(n, '2026-11-26').state, 'pre');
  assert.equal(statusAt(n, '2027-03-02').state, 'active');
  const list = sortStudents([n, normStudent({ studentNo: '10101', name: '재학' })], 2026);
  assert.deepEqual(list.map((s) => s.name), ['재학', '신입']); // 입학 예정은 뒤로
  const idx = buildIndex([n]);
  assert.equal(resolveRef('임시1203', idx)?.name, '신입');
  assert.equal(resolveRef('임시1203 신입', idx)?.name, '신입');
});
