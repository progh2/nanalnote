import { test } from 'node:test';
import assert from 'node:assert/strict';
const { parseTSV, toTSV, truthy } = await import('../src/lib/tsv.js');

test('엑셀에서 복사한 글자 나누기 (끝 줄바꿈, 빈 칸, 따옴표로 감싼 줄바꿈 칸)', () => {
  assert.deepEqual(parseTSV('코딩왕\t20101 김민준\t통과\r\n\t20104\t\r\n'), [['코딩왕', '20101 김민준', '통과'], ['', '20104', '']]);
  assert.deepEqual(parseTSV('"첫 줄\n둘째 줄"\t"말하길 ""안녕"""\n다음'), [['첫 줄\n둘째 줄', '말하길 "안녕"'], ['다음']]);
  assert.deepEqual(parseTSV('한 칸'), [['한 칸']]);
  assert.deepEqual(parseTSV(''), []);
  assert.deepEqual(parseTSV('a "b" c'), [['a "b" c']]); // 칸 중간 따옴표는 그대로
});

test('복사용 글자로 바꿨다가 다시 나눠도 같음', () => {
  const rows = [['가', '나\n다', ''], ['"따옴표"', 'tab\there', '끝']];
  assert.deepEqual(parseTSV(toTSV(rows)), rows);
});

test('수료 같은 예/아니오 칸', () => {
  for (const v of ['O', 'o', '✓', '예', '수료', 'TRUE', '1']) assert.equal(truthy(v), true, v);
  for (const v of ['', 'X', '아니오', '미수료', '0']) assert.equal(truthy(v), false, v);
});
