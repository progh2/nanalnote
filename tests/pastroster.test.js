import { test } from 'node:test';
import assert from 'node:assert/strict';
const { parsePastRows, photoUrlOf, planPastImport } = await import('../src/lib/pastroster.js');

// 구글 시트에서 복사하면 탭으로 나뉜 글
const TEXT = `1101\t홍길동\thttps://drive.google.com/uc?id=FAKE-id_0001/view?usp=drive_link
1507\t이몽룡\thttps://drive.google.com/uc?id=AAA
1607\t이몽룡\thttps://drive.google.com/uc?id=BBB
2101\t김철수\thttps://drive.google.com/uc?id=CCC
2411\t박영희\thttps://drive.google.com/uc?id=DDD
3101\t최민호\thttps://drive.google.com/uc?id=EEE
1999\t없는학생
머리줄\t이름\t사진`;

test('붙여 넣은 표 읽기 (탭·띄어쓰기, 링크 없는 줄도)', () => {
  const rows = parsePastRows(TEXT + '\n1102 성춘향 https://drive.google.com/uc?id=XYZ');
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0], { no: '1101', grade: 1, cls: 1, name: '홍길동', url: 'https://drive.google.com/uc?id=FAKE-id_0001/view?usp=drive_link' });
  assert.equal(rows[6].url, '');
  assert.equal(rows[7].name, '성춘향');
});

test('구글 드라이브 링크 → 그림 주소', () => {
  assert.equal(photoUrlOf('https://drive.google.com/uc?id=FAKE-id_0001/view?usp=drive_link'), 'https://lh3.googleusercontent.com/d/FAKE-id_0001=w600');
  assert.equal(photoUrlOf('https://drive.google.com/file/d/AbC_9-x/view', 400), 'https://lh3.googleusercontent.com/d/AbC_9-x=w400');
  assert.equal(photoUrlOf('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(photoUrlOf(''), '');
});

test('지금 명단과 맞추기: 한 학년 위 같은 이름, 동명이인은 같은 반 우선, 3학년은 졸업생', () => {
  const st = [
    { uid: 'a', name: '홍길동', grade: 2, cls: 1 },
    { uid: 'b', name: '이몽룡', grade: 2, cls: 5 },
    { uid: 'c', name: '이몽룡', grade: 2, cls: 6 },
    { uid: 'd', name: '김철수', grade: 3, cls: 1 },
    { uid: 'e', name: '박영희', grade: 3, cls: 2 }, { uid: 'f', name: '박영희', grade: 3, cls: 3 },
    { uid: 'g', name: '김철수', grade: 2, cls: 1 }, // 학년이 맞지 않음
  ];
  const plan = planPastImport(parsePastRows(TEXT), st, 3);
  assert.deepEqual(plan.matches.map((m) => `${m.row.no}→${m.student.uid}`), ['1101→a', '1507→b', '1607→c', '2101→d']);
  assert.deepEqual(plan.ambiguous.map((x) => `${x.row.no}:${x.cands.map((c) => c.uid).join('')}`), ['2411:ef']);
  assert.deepEqual(plan.alumni.map((r) => r.no), ['3101']);
  assert.deepEqual(plan.missing.map((r) => r.no), ['1999']);
});
