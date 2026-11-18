import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; } };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { FolderBackend } = await import('../src/backends/folder.js');
const { Store } = await import('../src/store.js');

/** 메모리 파일 시스템 (Tauri fs 플러그인과 같은 함수 이름) */
function memFs() {
  const files = new Map(); // path -> { data: string|Uint8Array, mtime }
  const dirs = new Set(['/']);
  let clock = 1000;
  const norm = (p) => p.replace(/\/+$/, '');
  const fs = {
    files, touch: (p) => { files.get(p).mtime = ++clock; },
    async exists(p) { p = norm(p); return files.has(p) || dirs.has(p); },
    async mkdir(p) { p = norm(p); const parts = p.split('/'); for (let i = 2; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/')); },
    async readDir(p) {
      p = norm(p);
      if (!dirs.has(p)) throw new Error('not found');
      const out = new Map();
      for (const k of [...files.keys(), ...dirs]) {
        if (!k.startsWith(p + '/')) continue;
        const name = k.slice(p.length + 1).split('/')[0];
        const isDir = dirs.has(`${p}/${name}`);
        out.set(name, { name, isDirectory: isDir, isFile: !isDir });
      }
      return [...out.values()];
    },
    async readTextFile(p) { const f = files.get(p); if (!f) throw new Error('not found'); return f.data; },
    async writeTextFile(p, t) { files.set(p, { data: t, mtime: ++clock }); },
    async readFile(p) { const f = files.get(p); if (!f) throw new Error('not found'); return f.data; },
    async writeFile(p, b) { files.set(p, { data: b, mtime: ++clock }); },
    async remove(p) { if (!files.delete(p)) throw new Error('No such file'); },
    async stat(p) { const f = files.get(p); if (!f) throw new Error('not found'); return { mtime: new Date(f.mtime) }; },
  };
  return fs;
}

test('이 컴퓨터 폴더: 마크다운으로 저장·불러오기, 바깥에서 바뀐 파일은 덮어쓰지 않음, 사진 파일', async () => {
  const fs = memFs();
  const s = new Store(new FolderBackend({ folder: '/USB/나날노트자료', fs }));
  await s.load(2026);
  s.work.students.push({ id: 'n_1', uid: 'U1', studentNo: '2105', name: '오세영' });
  s.setCounselText('2026-11-18', '2105 오세영이 질문을 많이 함 #진로');
  s.setDayNote('2026-11-18', '부장회의 #회의');
  let r = await s.save(['2026-11-18']);
  assert.ok(r.ok, JSON.stringify(r));
  const day = '/USB/나날노트자료/2026학년도/일지/2026-11-18.md';
  assert.ok(fs.files.get(day).data.includes('2105 오세영이 질문을 많이 함'));
  assert.ok(fs.files.has('/USB/나날노트자료/2026학년도/학생명단.md'));

  // 다른 컴퓨터(새 백엔드)에서 다시 열기
  const s2 = new Store(new FolderBackend({ folder: '/USB/나날노트자료', fs }));
  await s2.load(2026);
  assert.deepEqual(s2.work.counsel[0].students, ['U1']);
  assert.equal(s2.dayNote('2026-11-18'), '부장회의 #회의');

  // 동기화로 바깥에서 파일이 바뀜 → s 의 저장은 거부, 한 번 더 저장하면 덮어씀
  fs.files.get(day).data = fs.files.get(day).data.replace('부장회의', '교무회의'); fs.touch(day);
  s.setDayNote('2026-11-18', '부장회의 #회의 추가');
  r = await s.save(['2026-11-18']);
  assert.equal(r.ok, false);
  assert.match(r.error, /먼저 바뀐 파일/);
  assert.ok(fs.files.get(day).data.includes('교무회의'));
  r = await s.save(['2026-11-18']);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(fs.files.get(day).data.includes('부장회의 #회의 추가'));

  // 사진
  const b = s.backend;
  const name = await b.savePhoto(2026, { uid: 'U1', studentNo: '2105', name: '오세영', photo: '' }, new Blob(['jpg']));
  assert.equal(name, '2105_오세영.jpg');
  assert.ok(fs.files.has('/USB/나날노트자료/2026학년도/사진/2105_오세영.jpg'));
});
