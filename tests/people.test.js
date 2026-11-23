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

// ---------- 동명이인 ----------
const { qualifiedText, resolveAmbiguous, ambiguousPids, distinctQual, nameGroups } = await import('../src/lib/people.js');
const twins = [
  normPerson({ id: 'k1', name: '김민수', title: '선생님', org: '2학년부' }),
  normPerson({ id: 'k2', name: '김민수', title: '선생님', org: '○○중', aliases: '체육김민수' }),
  normPerson({ id: 'k3', name: '박지영', title: '장학사' }),
  normPerson({ id: 'k4', name: '박지영', title: '선생님', org: '3학년부' }),
  normPerson({ id: 'o1', kind: 'org', name: '경기도교육청', aliases: '교육청' }),
  normPerson({ id: 'o2', kind: 'org', name: '서울특별시교육청', aliases: '교육청' }),
];
const pk = (text, st = []) => tokenizeMentions(text, st, twins).filter((t) => t.uid || t.pid || t.amb).map((t) => `${t.text}=${t.uid || t.pid || `?${t.amb.join(',')}`}`);

test('동명이인: 괄호로 소속·다른 이름을 붙이면 그 사람', () => {
  assert.deepEqual(pk('김민수(2학년부) 선생님께, 김민수(○○중)쌤이, 김민수(체육김민수)'), ['김민수(2학년부) 선생님=k1', '김민수(○○중)쌤=k2', '김민수(체육김민수)=k2']);
});

test('동명이인: 호칭이 다르면 호칭으로, 같으면 누군지 모름', () => {
  assert.deepEqual(pk('박지영 장학사님과 박지영 선생님'), ['박지영 장학사님=k3', '박지영 선생님=k4']);
  assert.deepEqual(pk('김민수 선생님께 김민수에게'), ['김민수 선생님=?k1,k2', '김민수=?k1,k2']);
  assert.deepEqual(pk('교육청에 공문'), ['교육청=?o1,o2']);
  assert.deepEqual(pk('경기도교육청에'), ['경기도교육청=o1']);
  assert.deepEqual(ambiguousPids('김민수 선생님', [], twins), ['k1', 'k2']);
  // 같은 이름 학생이 있으면 호칭 없는 이름은 학생
  assert.deepEqual(pk('김민수가 김민수 선생님께', [{ uid: 'u9', studentNo: '1101', name: '김민수' }]), ['김민수=u9', '김민수 선생님=?k1,k2']);
});

test('동명이인 고르기 → 글을 구분된 이름으로 고친다', () => {
  const g = nameGroups(twins).get('김민수');
  assert.equal(distinctQual(twins[0], '김민수', g), '2학년부');
  assert.equal(qualifiedText('김민수 선생님', '김민수', twins[1], twins), '김민수(○○중) 선생님');
  assert.equal(qualifiedText('교육청', '교육청', twins[4], twins), '경기도교육청');
  const text = '김민수(2학년부) 선생님과 김민수 선생님, 또 김민수 선생님';
  const out = resolveAmbiguous(text, '김민수 선생님', '김민수(○○중) 선생님', twins);
  assert.equal(out, '김민수(2학년부) 선생님과 김민수(○○중) 선생님, 또 김민수(○○중) 선생님');
  // 구분할 말이 없으면 빈 문자열
  const same = [normPerson({ id: 'a', name: '이하나', title: '선생님' }), normPerson({ id: 'b', name: '이하나', title: '선생님' })];
  assert.equal(qualifiedText('이하나 선생님', '이하나', same[0], same), '');
});

// ---------- 겸임 호칭, T·샘·쌤, 추천 거르기 ----------
const { titlesOf, teacherInfo } = await import('../src/lib/people.js');

test('호칭 여러 개(겸임)와 교원 정보', () => {
  const p = normPerson({ name: '정다온', title: '부장, 선생님 ,교무부장', teacher: true, level: '중등', subject: '정보' });
  assert.equal(p.title, '부장, 선생님, 교무부장');
  assert.deepEqual(titlesOf(p), ['부장', '선생님', '교무부장']);
  assert.equal(teacherInfo(p), '중등 · 정보');
  assert.equal(normPerson({ name: '가', level: '중등' }).level, undefined); // 교원이 아니면 학교급 없음
});

test('이름 뒤 T·샘·쌤도 선생님으로, 겸임 호칭으로 동명이인 구분', () => {
  const ps = [normPerson({ id: 'a', name: '정다온', title: '선생님' })];
  const pk2 = (text, list = ps) => tokenizeMentions(text, [], list).filter((t) => t.pid || t.amb).map((t) => `${t.text}=${t.pid || '?'}`);
  assert.deepEqual(pk2('정다온T가 말하길, 정다온샘이랑 정다온 쌤께'), ['정다온T=a', '정다온샘=a', '정다온 쌤=a']);
  assert.deepEqual(pk2('정다온TV'), []); // TV 는 호칭이 아님
  const twins = [normPerson({ id: 'x', name: '박지영', title: '부장, 선생님' }), normPerson({ id: 'y', name: '박지영', title: '선생님' })];
  assert.deepEqual(pk2('박지영 부장님과 박지영 선생님', twins), ['박지영 부장님=x', '박지영 선생님=?']);
});

test('기록에서 찾은 이름: 일상 표현은 거르고, 뺀 말은 다시 추천하지 않음', () => {
  const texts = ['수능감독 선생님 명단', '같이 가는 선생님', '이번에는 교장선생님께', '학교에서 선생님', '정다온T 연락', '이수진샘 회의', '박하늘 선생님'];
  assert.deepEqual(findUnregistered(texts, []).map((x) => `${x.name}:${x.title}`), ['박하늘:선생님', '이수진:선생님', '정다온:선생님']);
  assert.deepEqual(findUnregistered(texts, [], ['박하늘']).map((x) => x.name), ['이수진', '정다온']);
});

test('졸업생이 지금 선생님: "○○ 선생님"은 선생님 기록, "○○(2015졸업)"은 졸업생 기록', () => {
  const ps = [normPerson({ id: 't', name: '정다온', title: '선생님' }), normPerson({ id: 'a', kind: 'alumni', name: '정다온', gradYear: 2015 })];
  const pk3 = (text) => tokenizeMentions(text, [], ps).filter((x) => x.pid || x.amb).map((x) => `${x.text}=${x.pid || `?${x.amb.join(',')}`}`);
  assert.deepEqual(pk3('정다온 선생님께, 정다온(2015졸업) 시절 사진, 정다온이'), ['정다온 선생님=t', '정다온(2015졸업)=a', '정다온=?t,a']);
});
