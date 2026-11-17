import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; },
};
const smem = new Map();
globalThis.sessionStorage = { getItem: (k) => (smem.has(k) ? smem.get(k) : null), setItem: (k, v) => smem.set(k, String(v)), removeItem: (k) => smem.delete(k) };

const vault = await import('../src/lib/vault.js');
const ss = await import('../src/lib/securestore.js');
const { Store, dday, courseShort, sortTasks } = await import('../src/store.js');
const { LocalBackend } = await import('../src/backends/local.js');
const { rawBell, cascadeFrom, dayRows } = await import('../src/lib/bell.js');
const { mentionedUids, searchStudents } = await import('../src/lib/students.js');

test('PIN 잠금: 평문 → 암호화 이전, 틀린 PIN 거부, 맞는 PIN 으로 복원, 잠금 끄기', async () => {
  localStorage.setItem('sn:data:2026', '{"students":[{"name":"비밀"}]}');
  localStorage.setItem('sn:theme', 'dark');
  await vault.setupPin('123456');
  await ss.loadAll();
  assert.ok(localStorage.getItem('sn:data:2026').startsWith('enc1:'));
  assert.equal(localStorage.getItem('sn:theme'), 'dark'); // 민감하지 않은 값은 그대로
  ss.sset('sn:dropbox', '{"refreshToken":"RT"}');
  await ss.flush();
  assert.ok(!localStorage.getItem('sn:dropbox').includes('RT'));
  assert.equal(ss.sget('sn:dropbox'), '{"refreshToken":"RT"}');

  vault.lockNow(); ss.memClear();
  assert.equal(ss.sget('sn:dropbox'), null);
  await assert.rejects(vault.unlockPin('000000'), /맞지 않/);
  await vault.unlockPin('123456');
  await ss.loadAll();
  assert.equal(ss.sget('sn:data:2026'), '{"students":[{"name":"비밀"}]}');

  await vault.changePin('654321');
  vault.lockNow(); ss.memClear();
  await assert.rejects(vault.unlockPin('123456'));
  await vault.unlockPin('654321');
  await ss.loadAll();
  await ss.decryptAllToPlain(); vault.removeVault();
  assert.equal(localStorage.getItem('sn:dropbox'), '{"refreshToken":"RT"}');
  assert.equal(vault.vaultEnabled(), false);
});

test('자동 저장: 입력 중 비운 항목은 화면에 남고 저장소에서만 빠졌다가 다시 쓰면 새로 저장', async () => {
  const s = new Store(new LocalBackend());
  await s.load(2030);
  const t = { id: 'n_1', text: '회의', created: '2030-03-02', doneDate: null };
  s.work.tasks.push(t); s.markDirty();
  await s.save();
  assert.equal(s.base.tasks.length, 1);
  t.text = ''; s.markDirty();
  await s.save();
  assert.equal(s.base.tasks.length, 0);
  assert.equal(s.work.tasks[0], t); // 같은 객체가 화면에 남음
  t.text = '회의 준비'; s.markDirty();
  const r = await s.save();
  assert.ok(r.ok);
  assert.equal(s.base.tasks.length, 1);
  assert.equal(s.base.tasks[0].text, '회의 준비');
  // 새 요록: 제목 입력 전에 자동 저장돼도 사라지지 않음
  const rec = { id: 'n_r', title: '', created: '2030-03-02', doneDate: null, entries: {} };
  s.work.records.push(rec); s.markDirty();
  await s.save();
  assert.equal(s.work.records.includes(rec), true);
  assert.equal(s.base.records.length, 0);
});

test('시정표: 50분 자동 채우기, 수능대비 점심 3교시 다음', () => {
  const b = rawBell({ schoolLevel: 'secondary', bell: { periodCount: 7, lunch: { after: 4 } } });
  b.times[0] = { start: '08:30' }; cascadeFrom(b, 1);
  assert.deepEqual(b.times.slice(0, 4).map((t) => t.start), ['08:30', '09:30', '10:30', '11:30']);
  assert.equal(b.times[3].end, '12:20');
  assert.equal(b.lunch.start, '12:20');
  b.times[4] = { start: '13:10' }; cascadeFrom(b, 5);
  assert.equal(b.lunch.end, '13:10');
  assert.deepEqual(b.times.slice(4).map((t) => `${t.start}-${t.end}`), ['13:10-14:00', '14:10-15:00', '15:10-16:00']);
  // 수능대비 시간표는 그 날에만 (opts.csat)
  const normal = dayRows({ schoolLevel: 'secondary', bell: b });
  assert.deepEqual(normal.slice(0, 6).map((r) => r.label), ['1교시', '2교시', '3교시', '4교시', '점심', '5교시']);
  // 시각을 비워 두면 3교시 끝 기준 자동: 점심 11:20~12:10(평소 점심 50분), 4교시 12:10~13:00
  let rows = dayRows({ schoolLevel: 'secondary', bell: b }, { csat: true });
  assert.deepEqual(rows.slice(0, 6).map((r) => r.label), ['1교시', '2교시', '3교시', '점심', '4교시', '5교시']);
  assert.deepEqual([rows[3].start, rows[3].end, rows[4].start, rows[4].end], ['11:20', '12:10', '12:10', '13:00']);
  b.csat = { lunch: { start: '11:30', end: '12:20' }, p4: { start: '12:20', end: '13:10' } };
  rows = dayRows({ schoolLevel: 'secondary', bell: b }, { csat: true });
  assert.equal(rows[4].start, '12:20');
});

test('조사 붙은 이름 인식, 검색, D-day, 축약 수업명', () => {
  const st = [{ uid: 'a', studentNo: '2105', name: '오세영' }, { uid: 'b', studentNo: '2106', name: '김하나' }];
  assert.deepEqual(mentionedUids('2105 오세영이 무엇을 했다', st), ['a']);
  assert.deepEqual(mentionedUids('김하나에게 2105 오세영을 소개', st), ['b', 'a']);
  assert.deepEqual(mentionedUids('오세영님', st), []); // 조사가 아닌 글자가 붙으면 인식하지 않음
  assert.deepEqual(searchStudents('2105 오세영이', st).map((x) => x.uid), ['a']);
  assert.deepEqual(searchStudents('김하나에게', st).map((x) => x.uid), ['b']);
  assert.equal(dday('2026-11-20', '2026-11-17').label, 'D-3');
  assert.equal(dday('2026-11-17', '2026-11-17').label, 'D-day');
  assert.equal(dday('2026-11-15', '2026-11-17').label, 'D+2');
  assert.equal(courseShort({ courses: [{ name: '인공지능 기초', short: 'AI기초' }, '정보'] }, '인공지능 기초'), 'AI기초');
  assert.equal(courseShort({ courses: ['정보'] }, '정보'), '정보');
});

test('수능대비 시간표: 날짜별 표시 저장·복원', async () => {
  const s = new Store(new LocalBackend());
  await s.load(2031);
  s.setCsat('2031-11-05', true);
  await s.save();
  const s2 = new Store(new LocalBackend());
  await s2.load(2031);
  assert.equal(s2.isCsat('2031-11-05'), true);
  assert.equal(s2.isCsat('2031-11-06'), false);
  s2.setCsat('2031-11-05', false);
  await s2.save();
  assert.equal(s2.base.schedule.length, 0); // 일정 글도 표시도 없으면 지움
});

test('업무 중요도 자동 정렬과 직접 순서', async () => {
  const T = (id, priority, due, created = '2032-03-02') => ({ id, text: id, created, doneDate: null, ...(priority ? { priority } : {}), ...(due ? { due } : {}) });
  const list = [T('later', 'Z'), T('c', 'C'), T('b-late', 'B', '2032-03-20'), T('a', 'A'), T('b-soon', 'B', '2032-03-05'), T('none')];
  assert.deepEqual(sortTasks(list, 'auto', '2032-03-03').map((t) => t.id), ['a', 'b-soon', 'b-late', 'none', 'c', 'later']);
  const done = { ...T('a-done', 'A'), doneDate: '2032-03-03' };
  assert.equal(sortTasks([...list, done], 'auto', '2032-03-03').at(-1).id, 'a-done'); // 그날 완료한 일은 아래로

  const s = new Store(new LocalBackend());
  await s.load(2032);
  s.work.tasks.push(...list.map((t) => ({ ...t })));
  s.markDirty(); await s.save();
  const auto = s.visibleTasks('2032-03-03').map((t) => t.id);
  assert.equal(auto[0], 'a');
  // 끌어서 'later' 를 맨 위로 → 직접 정하기로 전환
  s.reorderTasks(['later', ...auto.filter((x) => x !== 'later')]);
  assert.equal(s.settings.taskSort, 'manual');
  await s.save();
  const s2 = new Store(new LocalBackend());
  await s2.load(2032);
  assert.deepEqual(s2.visibleTasks('2032-03-03').map((t) => t.id), ['later', ...auto.filter((x) => x !== 'later')]);
});
