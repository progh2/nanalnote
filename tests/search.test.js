import { test } from 'node:test';
import assert from 'node:assert/strict';
const { searchAll, queryTerms, matchRanges, snippet } = await import('../src/lib/search.js');
const { normPerson } = await import('../src/lib/people.js');

const store = {
  work: {
    students: [{ uid: 'u1', studentNo: '2105', name: '고은별', grade: 2, cls: 1 }],
    people: [normPerson({ id: 'o1', kind: 'org', name: '경기도교육청', aliases: '교육청' }), normPerson({ id: 'p1', name: '이수진', title: '선생님', org: '행정실' })],
    days: [{ date: '2026-03-03', note: '## 회의\n교육청 공문 회신 #방과후\n---\n점심 메뉴' }, { date: '2026-03-05', note: '교육청에 다시 공문' }],
    tasks: [{ created: '2026-03-04', text: '방과후 강사 계약 #방과후', doneDate: '2026-03-06' }],
    lessons: [], counsel: [{ date: '2026-03-02', text: '2105 고은별이 진로 상담' }], schedule: [], trips: [], attendance: [], notes: [{ text: '공문 번호 정리' }],
  },
  counselDraft: {}, periodLabel: () => '', label: () => '',
};

test('조사를 떼고도 찾고, 낱말은 모두 들어가야 한다', () => {
  assert.deepEqual(queryTerms('교육청에 #방과후'), [['교육청에', '교육청'], ['방과후']]);
  const r = searchAll(store, '교육청에 공문');
  assert.deepEqual(r.records.map((e) => e.date), ['2026-03-05', '2026-03-03']); // 최근 날짜부터
  assert.ok(!r.records.some((e) => e.text.includes('점심'))); // 노트는 주제 단위
  assert.deepEqual(r.people.map((p) => p.id), ['o1']);
});

test('학생·사람·태그·포스트잇도 찾는다', () => {
  assert.equal(searchAll(store, '고은별').students[0].uid, 'u1');
  assert.equal(searchAll(store, '고은별').records[0].type, 'counsel');
  assert.equal(searchAll(store, '행정실').people[0].id, 'p1');
  assert.deepEqual(searchAll(store, '#방과').tags, [['방과후', 2]]);
  assert.ok(searchAll(store, '공문 번호').records.some((e) => e.type === 'postit'));
  assert.equal(searchAll(store, '  ').total, 0);
});

test('강조 구간과 잘라 보이기', () => {
  assert.deepEqual(matchRanges('교육청 공문 교육청', queryTerms('교육청')), [[0, 3], [7, 10]]);
  const long = '가'.repeat(200) + '공문' + '나'.repeat(200);
  const s = snippet(long, queryTerms('공문'));
  assert.ok(s.text.startsWith('…') && s.text.includes('공문') && s.text.endsWith('…'));
});
