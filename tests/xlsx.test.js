import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
const { readXlsx, writeXlsx, colIndex, colName, findHeaderRow } = await import('../src/lib/xlsx.js');

test('열 이름 ↔ 번호', () => {
  assert.equal(colIndex('A1'), 0); assert.equal(colIndex('Z'), 25); assert.equal(colIndex('AA3'), 26); assert.equal(colIndex('AZ'), 51);
  for (const i of [0, 25, 26, 51, 52, 701, 702]) assert.equal(colIndex(colName(i)), i);
});

test('쓰고 다시 읽기: 글자·빈칸·특수문자·여러 시트', () => {
  const rows = [['학번', '이름', '메모'], ['020101', '김<민>준 & "친구"', '첫 줄\n둘째 줄'], ['20102', '', '끝 칸만']];
  const back = readXlsx(writeXlsx([{ name: '학생/명단', rows }, { name: '둘째', rows: [['a']] }]));
  assert.equal(back.length, 2);
  assert.equal(back[0].name, '학생 명단');
  assert.deepEqual(back[0].rows, rows);
  assert.deepEqual(back[1].rows, [['a']]);
});

test('엑셀이 저장한 모양(공유 문자열·숫자·서식 글자·빈 줄) 읽기', () => {
  const files = {
    'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="명렬표" sheetId="1" r:id="rId3"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId3" Type="ws" Target="worksheets/data.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>2학년 1반 명렬표</t></si><si><t>학번</t></si><si><r><t>성</t></r><r><rPr><b/></rPr><t>명</t></r></si><si><t xml:space="preserve">김민준 </t><rPh><t>キム</t></rPh></si></sst>',
    'xl/worksheets/data.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3" t="s"><v>2</v></c></row><row r="4"><c r="A4"><v>20101</v></c><c r="C4" t="s"><v>3</v></c><c r="D4" t="b"><v>1</v></c><c r="E4"><v>1.5E-1</v></c></row></sheetData></worksheet>',
  };
  const [s] = readXlsx(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
  assert.equal(s.name, '명렬표');
  assert.deepEqual(s.rows, [['2학년 1반 명렬표'], [], ['학번', '', '성명'], ['20101', '', '김민준 ', 'TRUE', '0.15']]);
  assert.equal(findHeaderRow(s.rows, [['학번'], ['이름', '성명']]), 2);
});

test('예전 .xls 나 엉뚱한 파일은 알아듣기 쉬운 오류', () => {
  assert.throws(() => readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), /xls/);
  assert.throws(() => readXlsx(strToU8('hello')), /xlsx/);
});
