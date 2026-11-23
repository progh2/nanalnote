import { test } from 'node:test';
import assert from 'node:assert/strict';
const { inverseKind, relationsOf, hasRelation } = await import('../src/lib/relations.js');

test('거꾸로 부르는 말 (성별에 따라)', () => {
  assert.equal(inverseKind('아버지', '남', '남'), '아들');
  assert.equal(inverseKind('어머니', '여', '여'), '딸');
  assert.equal(inverseKind('보호자', '', ''), '자녀');
  assert.equal(inverseKind('아들', '남', '남'), '아버지');
  assert.equal(inverseKind('딸', '여', ''), '부모');
  assert.equal(inverseKind('오빠', '남', '여'), '여동생');
  assert.equal(inverseKind('남동생', '남', '여'), '누나');
  assert.equal(inverseKind('여동생', '여', '남'), '오빠');
  assert.equal(inverseKind('여동생', '여', '여'), '언니');
  assert.equal(inverseKind('남동생', '남', ''), '손위 형제');
  assert.equal(inverseKind('담임', '', ''), '담임 학생');
  assert.equal(inverseKind('형제자매'), '형제자매');
});

test('한쪽에서 적은 관계가 양쪽에 보인다', () => {
  const rels = [{ a: 'p:dad', b: 's:kid', kind: '아버지' }, { a: 's:sis', b: 's:kid', kind: '누나' }, { a: 's:kid', b: 'p:t', kind: '기타', memo: '동아리 제자' }];
  const g = { 's:kid': '남', 's:sis': '여', 'p:dad': '남' };
  const gender = (r) => g[r] || '';
  assert.deepEqual(relationsOf(rels, 's:kid', gender).map((x) => `${x.label}:${x.other}`), ['아버지:p:dad', '누나:s:sis', '동아리 제자:p:t']);
  assert.deepEqual(relationsOf(rels, 'p:dad', gender).map((x) => `${x.label}:${x.other}`), ['아들:s:kid']);
  assert.deepEqual(relationsOf(rels, 's:sis', gender).map((x) => `${x.label}:${x.other}`), ['남동생:s:kid']);
  assert.equal(hasRelation(rels, 'p:dad', 's:kid', '아버지'), true);
});
