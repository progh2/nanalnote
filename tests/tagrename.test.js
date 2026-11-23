import { test } from 'node:test';
import assert from 'node:assert/strict';
const { replaceTagIn, renameTag, tagNameError } = await import('../src/lib/tags.js');

test('글 속 태그만 정확히 바꾼다 (더 긴 태그·이메일·숫자는 그대로)', () => {
  assert.deepEqual(replaceTagIn('#방과후 강사, (#방과후) #방과후학교 a#방과후 #방과후-2', '방과후', '방과후학교'),
    ['#방과후학교 강사, (#방과후학교) #방과후학교 a#방과후 #방과후-2', 2]);
  assert.deepEqual(replaceTagIn('없음', '방과후', 'x'), ['없음', 0]);
});

test('이름 규칙', () => {
  assert.equal(tagNameError('방과후 학교'), '태그 이름에는 한글·영문·숫자·_·- 만 쓸 수 있습니다 (띄어쓰기 없이).');
  assert.equal(tagNameError('2026'), '숫자만으로는 태그가 되지 않습니다.');
  assert.equal(tagNameError('#진로-캠프'), '');
  assert.equal(tagNameError(''), '새 이름을 쓰세요.');
});

test('모든 기록에서 바꾸고, 세기만 하기·태그 카드 이름 바꾸기', () => {
  const data = {
    days: [{ note: '회의 #방과후\n---\n#방과후 강사' }], tasks: [{ text: '계약 #방과후' }, { text: '#방과후학교 건' }],
    lessons: [], counsel: [{ text: '#방과후 상담' }], schedule: [{ text: '공고 #방과후' }], trips: [{ place: '교육청', purpose: '#방과후 협의' }],
    attendance: [], notes: [{ text: '#방과후' }], contests: [{ summary: '#방과후 연계', entries: [{ memo: '#방과후' }] }],
    tagcards: [{ tag: '방과후', memo: '설명', members: [{ memo: '#방과후 담당' }] }], people: [],
  };
  const drafts = { '2026-11-01': '오늘 #방과후' };
  const dry = renameTag(data, drafts, '방과후', '방과후학교', { dryRun: true });
  assert.deepEqual(dry, { records: 10, places: 11, merged: false });
  assert.equal(data.tasks[0].text, '계약 #방과후'); // 세기만 했으니 그대로
  renameTag(data, drafts, '방과후', '방과후학교');
  assert.equal(data.days[0].note, '회의 #방과후학교\n---\n#방과후학교 강사');
  assert.equal(data.tasks[1].text, '#방과후학교 건');
  assert.equal(drafts['2026-11-01'], '오늘 #방과후학교');
  assert.equal(data.trips[0].purpose, '#방과후학교 협의');
  assert.equal(data.tagcards[0].tag, '방과후학교');
});

test('이미 있는 태그로 바꾸면 합친다 (카드의 설명·일정·인물도)', () => {
  const data = {
    tasks: [{ text: '#캠프 준비' }, { text: '#진로캠프 예산' }],
    tagcards: [{ tag: '캠프', memo: '여름', stages: [{ name: '운영' }], members: [{ ref: 's:a' }] }, { tag: '진로캠프', memo: '진로', status: 'active', members: [{ ref: 'p:b' }] }],
  };
  const r = renameTag(data, {}, '캠프', '진로캠프');
  assert.equal(r.merged, true);
  assert.equal(data.tagcards.length, 1);
  const c = data.tagcards[0];
  assert.equal(c.tag, '진로캠프');
  assert.equal(c.memo, '진로\n\n---\n여름');
  assert.deepEqual(c.members.map((m) => m.ref), ['p:b', 's:a']);
  assert.equal(c.stages.length, 1);
  assert.equal(data.tasks[0].text, '#진로캠프 준비');
});
