import { test } from 'node:test';
import assert from 'node:assert/strict';
const { tokenizeMentions, mentionedPids, mentionedStudentUids, findUnregistered, parsePeopleLines, normPerson } = await import('../src/lib/people.js');

const students = [{ uid: 'u1', studentNo: '2105', name: '고은별' }, { uid: 'u2', studentNo: '2106', name: '김민수' }];
const people = [
  normPerson({ id: 'p1', kind: 'person', name: '김민수', title: '선생님' }),
  normPerson({ id: 'p2', kind: 'person', name: '박지영', title: '장학사' }),
  normPerson({ id: 'o1', kind: 'org', name: '경기도교육청', aliases: '교육청, 도교육청' }),
];
const pick = (text) => tokenizeMentions(text, students, people).filter((t) => t.uid || t.pid).map((t) => `${t.text}=${t.uid || t.pid}`);

test('호칭이 붙으면 사람, 조사가 붙어도 된다', () => {
  assert.deepEqual(pick('김민수 선생님께 전화함'), ['김민수 선생님=p1']);
  assert.deepEqual(pick('김민수쌤이 말하길'), ['김민수쌤=p1']);
  assert.deepEqual(pick('박지영 장학사님과 통화'), ['박지영 장학사님=p2']);
});

test('같은 이름 학생이 있으면 호칭 없는 이름은 학생', () => {
  assert.deepEqual(pick('김민수가 결석'), ['김민수=u2']);
  assert.deepEqual(pick('2106 김민수 학생과 김민수 선생님'), ['2106 김민수=u2', '김민수 선생님=p1']);
  assert.deepEqual(mentionedStudentUids('김민수 선생님께 고은별이 갔다', students, people), ['u1']);
});

test('학생과 겹치지 않는 이름은 호칭 없이도, 기관은 다른 이름으로도', () => {
  assert.deepEqual(pick('박지영에게 회신'), ['박지영=p2']);
  assert.deepEqual(pick('교육청에 공문, 경기도교육청 회신, 도교육청으로'), ['교육청=o1', '경기도교육청=o1', '도교육청=o1']);
  assert.deepEqual(pick('교육청장 회의'), []); // 다른 단어의 일부는 아님
  assert.deepEqual(mentionedPids('교육청 #방과후 김민수쌤', students, people), ['o1', 'p1']);
});

test('기록에서 명부에 없는 "○○○ 선생님" 찾기', () => {
  const r = findUnregistered(['이수진 선생님께 부탁', '이수진선생님이 연락', '담임선생님과 상담', '김민수 선생님', '정하늘 주무관님'], people);
  assert.deepEqual(r.map((x) => `${x.name}:${x.count}`), ['이수진:2', '정하늘:1']);
});

test('붙여넣기 줄 나누기 (쉼표·탭)', () => {
  const r = parsePeopleLines('김민수, 선생님, 2학년부, 010-1, a@b.kr\n이수진\t주무관\t행정실\n\n', 'person');
  assert.equal(r.length, 2);
  assert.equal(r[1].org, '행정실');
  assert.equal(parsePeopleLines('경기도교육청, 031-0', 'org')[0].phone, '031-0');
});
