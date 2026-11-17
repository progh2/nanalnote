import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; },
};

const { serialize, parse } = await import('../src/lib/mdformat.js');
const { DropboxBackend } = await import('../src/backends/dropbox.js');
const { Store } = await import('../src/store.js');

const strip = (d) => JSON.parse(JSON.stringify(d, (k, v) => (k === 'id' ? undefined : v)));
let n = 0;
const mk = () => `x${n++}`;

const sample = {
  settings: [{ id: 'a', key: 'main', value: { teacherInfo: '3학년 2반 | 담임', schoolLevel: 'elem', showModified: false, timetable: { 1: ['국어', '수학'], 2: ['', '사회'], 3: [], 4: [], 5: ['체육'] } } }],
  students: [{ id: 'b', no: 1, name: '이몽룡' }, { id: 'c', no: 2, name: '성춘향' }],
  schedule: [{ id: 'd', date: '2026-03-02', text: '입학식\n시업식' }],
  days: [{ id: 'e', date: '2026-03-02', updatedAt: '2026-03-02T07:00:00.000Z' }],
  lessons: [{ id: 'f', date: '2026-03-02', period: 1, subject: '국어', content: '받아쓰기\n# 제목처럼 보이는 줄\n- 목록' }, { id: 'g', date: '2026-03-02', period: 3, subject: '', content: '' }],
  tasks: [{ id: 'h', text: '가정통신문 (2장)', created: '2026-03-02', doneDate: '2026-03-04' }, { id: 'i', text: '회의', created: '2026-03-03', doneDate: null }],
  attendance: [{ id: 'j', date: '2026-03-02', student: '성춘향', type: '지각', reason: '질병', note: '병원 · 진료' }],
  counsel: [{ id: 'k', date: '2026-03-02', order: 0, text: '이몽룡 울었다.\n달래줌', students: ['이몽룡'] }, { id: 'l', date: '2026-03-02', order: 1, text: '## 성춘향 지각', students: [] }],
  records: [{ id: 'm', title: '독서록', created: '2026-03-05', doneDate: null, entries: { 이몽룡: 'O', 성춘향: '미제출 | 다음주' } }],
};

test('마크다운 왕복 변환이 손실 없이 동일', () => {
  const files = serialize(2026, sample);
  const back = parse(2026, files, mk);
  const exp = strip(sample);
  exp.counsel[1].students = []; // 학생 인식은 별도 테스트에서 확인
  const got = strip(back);
  got.counsel[1].students = [];
  assert.deepEqual(got, exp);
  assert.ok(files.get('/2026학년도/일지/2026-03-02.md').includes('### 1교시 · 국어'));
});

test('사람이 손으로 쓴 마크다운도 읽는다', () => {
  const files = new Map([
    ['/2026학년도/업무일지.md', '# 업무일지\n- [x] 손으로 쓴 일\n- [ ] 할 일 (작성 2026-04-01)\n'],
    ['/2026학년도/일지/2026-04-01.md', '## 수업일지\n### 2교시: 과학\n실험\n\n## 메모\n개인 메모는 보존\n'],
  ]);
  const d = parse(2026, files, mk);
  assert.equal(d.tasks[0].doneDate, '2026-03-01');
  assert.equal(d.tasks[1].created, '2026-04-01');
  assert.equal(d.lessons[0].subject, '과학');
  assert.equal(d.lessons[0].content, '실험');
  const again = serialize(2026, d).get('/2026학년도/일지/2026-04-01.md');
  assert.ok(again.includes('## 메모\n개인 메모는 보존'));
});

// ---- 드롭박스 모의 서버 ----
function mockDropbox() {
  const fs = new Map(); // lower -> {path, rev, text}
  let rev = 0;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(u.pathname);
    const arg = init.headers?.['Dropbox-API-Arg'] ? JSON.parse(init.headers['Dropbox-API-Arg'].replace(/\\u([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))) : null;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
    if (u.pathname === '/2/files/list_folder') {
      const pre = body.path.toLowerCase() + '/';
      const entries = [...fs.values()].filter((f) => f.path.toLowerCase().startsWith(pre)).map((f) => ({ '.tag': 'file', name: f.path.split('/').pop(), path_lower: f.path.toLowerCase(), path_display: f.path, rev: f.rev }));
      if (!entries.length) return j({ error_summary: 'path/not_found/..' }, 409);
      return j({ entries, has_more: false });
    }
    if (u.pathname === '/2/files/download') return new Response(fs.get(arg.path.toLowerCase()).text);
    if (u.pathname === '/2/files/upload') {
      const k = arg.path.toLowerCase();
      const cur = fs.get(k);
      const m = arg.mode['.tag'];
      if ((m === 'add' && cur) || (m === 'update' && cur?.rev !== arg.mode.update)) return j({ error_summary: 'path/conflict/file/..' }, 409);
      const text = new TextDecoder().decode(init.body);
      const f = { path: arg.path, rev: `r${++rev}`, text };
      fs.set(k, f);
      return j({ path_display: f.path, rev: f.rev });
    }
    if (u.pathname === '/2/files/delete_v2') { fs.delete(body.path.toLowerCase()); return j({}); }
    return j({ error_summary: 'unmocked ' + u.pathname }, 400);
  };
  return { fs, calls };
}

test('드롭박스: 저장 → 다시 불러오기, 바뀐 파일만 업로드, 충돌 시 덮어쓰지 않음', async () => {
  const { fs, calls } = mockDropbox();
  localStorage.setItem('sn:dropbox', JSON.stringify({ accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600e3 }));

  const s = new Store(new DropboxBackend());
  await s.load(2026);
  s.work.students.push({ id: 'n_1', no: 1, name: '이몽룡' });
  s.setLesson('2026-03-02', 1, { content: '받아쓰기' });
  s.setCounselText('2026-03-02', '이몽룡 울었다');
  let r = await s.save(['2026-03-02']);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(fs.has('/2026학년도/학생명단.md'));
  assert.ok(fs.get('/2026학년도/일지/2026-03-02.md').text.includes('이몽룡 울었다'));

  // 다른 기기에서 불러오기 (캐시 없음)
  mem.delete('sn:dropbox:cache');
  const s2 = new Store(new DropboxBackend());
  await s2.load(2026);
  assert.equal(s2.work.counsel[0].students[0], '이몽룡');
  assert.equal(s2.lessonsFor('2026-03-02', 1)[0].content, '받아쓰기');

  // 업무만 추가 → 업무일지.md 하나만 업로드
  calls.length = 0;
  s.work.tasks.push({ id: 'n_t', text: '회의', created: '2026-03-02', doneDate: null }); s.markDirty();
  r = await s.save();
  assert.ok(r.ok);
  assert.deepEqual(calls.filter((c) => c === '/2/files/upload').length, 1);

  // s2 가 같은 날 일지를 먼저 고침 → s 의 저장은 충돌
  s2.setCounselText('2026-03-02', '이몽룡 웃었다'); await s2.save(['2026-03-02']);
  s.setCounselText('2026-03-02', '이몽룡 화났다');
  r = await s.save(['2026-03-02']);
  assert.equal(r.ok, false);
  assert.match(r.error, /다른 기기/);
  assert.ok(fs.get('/2026학년도/일지/2026-03-02.md').text.includes('웃었다'));
  assert.equal(s.dirty, true);
  // 한 번 더 저장하면 덮어씀
  r = await s.save(['2026-03-02']);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(fs.get('/2026학년도/일지/2026-03-02.md').text.includes('화났다'));

  // 하루치 기록(수업·상담·일지 항목)이 모두 없어지면 파일 삭제
  s.work.counsel = s.work.counsel.filter((c) => c.date !== '2026-03-02');
  s.setLesson('2026-03-02', 1, { content: '' });
  s.work.days = s.work.days.filter((d) => d.date !== '2026-03-02');
  r = await s.save();
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(fs.has('/2026학년도/일지/2026-03-02.md'), false);
});
