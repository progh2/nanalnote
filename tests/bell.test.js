import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayRows, periodList, autoTimes, currentRow, parsePeriodLabel, periodLabel, bellOf } from '../src/lib/bell.js';
import { parse } from '../src/lib/mdformat.js';

const settings = { schoolLevel: 'secondary', bell: { arrival: '08:20', periodCount: 7, times: [], lunch: { start: '12:20', end: '13:10', after: 4 }, dinner: { enabled: true, start: '17:20', end: '18:10' }, evening: [{ label: '야자1', start: '18:20', end: '19:40' }] } };

test('하루 일과 순서: 등교 → 1~4교시 → 점심 → 5~7교시 → 저녁 → 방과후', () => {
  assert.deepEqual(dayRows(settings).map((r) => r.label), ['등교', '1교시', '2교시', '3교시', '4교시', '점심', '5교시', '6교시', '7교시', '저녁', '야자1']);
  assert.deepEqual(periodList(settings).map((r) => r.p), [1, 2, 3, 4, 5, 6, 7, 11]);
  assert.equal(periodLabel(settings, 11), '야자1');
  assert.equal(parsePeriodLabel(settings, '야자1'), 11);
  assert.equal(parsePeriodLabel(settings, '방과후2'), 12);
  assert.equal(parsePeriodLabel(settings, '3교시'), 3);
});

test('기본값: 초등 6교시, 중고 7교시, 시정표 미설정 시 등교·식사 줄 없음', () => {
  assert.equal(bellOf({ schoolLevel: 'elem' }).periodCount, 6);
  assert.equal(bellOf({ schoolLevel: 'secondary' }).periodCount, 7);
  assert.deepEqual(dayRows({}).map((r) => r.label), ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시']);
});

test('시각 자동 채우기 + 지금 교시', () => {
  const r = autoTimes({ first: '09:00', lesson: 40, rest: 10, count: 6, lunchAfter: 4, lunchLen: 50 });
  assert.deepEqual(r.times[0], { start: '09:00', end: '09:40' });
  assert.deepEqual(r.times[3], { start: '11:30', end: '12:10' });
  assert.deepEqual(r.lunch, { start: '12:10', end: '13:00' });
  assert.deepEqual(r.times[4], { start: '13:00', end: '13:40' });
  const rows = dayRows({ bell: { periodCount: 6, times: r.times, lunch: { ...r.lunch, after: 4 } } });
  assert.equal(currentRow(rows, '12:30').label, '점심');
  assert.equal(currentRow(rows, '09:39').label, '1교시');
  assert.equal(currentRow(rows, '09:45'), null);
});

test('예전 형식(시간 열 없는) 설정.md 도 읽는다', () => {
  const md = '- 학교급: 초등\n\n## 기본 시간표\n\n| 교시 | 월 | 화 | 수 | 목 | 금 |\n|---|---|---|---|---|---|\n| 1 | 국어 | 수학 | | | |\n';
  const d = parse(2026, new Map([['/2026학년도/설정.md', md]]), () => 'x');
  assert.equal(d.settings[0].value.timetable[1][0], '국어');
  assert.equal(d.settings[0].value.timetable[2][0], '수학');
});
