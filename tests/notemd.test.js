import { test } from 'node:test';
import assert from 'node:assert/strict';
const { splitSections, toggleTodo, parseBlocks, sectionTitle } = await import('../src/lib/notemd.js');
const { tagEntries } = await import('../src/lib/tags.js');

const NOTE = `## 교무회의
- 수행평가 일정 #회의
- [ ] 계획서 내기

---
교육청 장학사님 통화 #방과후
금요일까지 회신

-----

`;

test('구분선으로 주제 나누기 (빈 주제는 빼고, 줄 번호 유지)', () => {
  const s = splitSections(NOTE);
  assert.equal(s.length, 2);
  assert.equal(s[0].title, '교무회의');
  assert.equal(s[0].start, 0);
  assert.equal(s[1].title, '교육청 장학사님 통화 #방과후');
  assert.equal(s[1].start, 5);
  assert.equal(splitSections('').length, 0);
  assert.equal(splitSections('한 줄 메모').length, 1);
  assert.equal(splitSections('a\n===\nb\n***\nc').length, 3);
  assert.equal(splitSections('a --- b').length, 1); // 줄 가운데 --- 는 구분선 아님
});

test('제목·목록·할 일·인용·문단 구분, #태그 는 제목이 아님', () => {
  const b = parseBlocks('# 큰 제목\n#회의 메모\n둘째 줄\n\n- 가\n1. 하나\n- [x] 끝남\n> 인용');
  assert.deepEqual(b.map((x) => x.type), ['head', 'p', 'li', 'oli', 'todo', 'quote']);
  assert.deepEqual(b[1].lines, ['#회의 메모', '둘째 줄']);
  assert.equal(b[4].done, true);
  assert.equal(sectionTitle('- [ ] **할 일** 하나'), '할 일 하나');
});

test('할 일 체크 뒤집기는 그 줄만 바꾼다', () => {
  const s = splitSections(NOTE);
  const line = parseBlocks(s[0].text, s[0].start).find((x) => x.type === 'todo').line;
  assert.equal(line, 2);
  const next = toggleTodo(NOTE, line);
  assert.ok(next.includes('- [x] 계획서 내기'));
  assert.equal(toggleTodo(next, line), NOTE);
  assert.equal(toggleTodo(NOTE, 0), NOTE); // 할 일이 아닌 줄은 그대로
});

test('태그 모아보기: 노트는 태그가 붙은 주제만', () => {
  const store = { work: { days: [{ date: '2026-03-03', note: NOTE }], tasks: [], lessons: [], counsel: [], schedule: [], trips: [], attendance: [], notes: [] }, counselDraft: {}, periodLabel: () => '', label: () => '' };
  const e = tagEntries(store);
  const hoo = e.find((x) => x.tag === '방과후');
  assert.ok(hoo.text.startsWith('교육청'));
  assert.ok(!hoo.text.includes('교무회의'));
  assert.ok(e.find((x) => x.tag === '회의').text.startsWith('## 교무회의'));
});

test('제목·구분선이 든 노트도 일지 파일로 저장했다가 그대로 읽힌다', async () => {
  const { serialize, parse } = await import('../src/lib/mdformat.js');
  let n = 0;
  const back = parse(2026, serialize(2026, { days: [{ date: '2026-03-03', note: NOTE.trim() }] }), () => `x${n++}`);
  assert.equal(back.days[0].note, NOTE.trim());
});
