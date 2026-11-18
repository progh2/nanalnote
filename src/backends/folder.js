// 이 컴퓨터 폴더 저장소 (데스크톱 앱 전용)
// - 드롭박스와 똑같은 마크다운 형식으로 고른 폴더에 저장한다: {폴더}/{학년도}학년도/*.md, 일지/, 사진/, 학사일정자료/ …
// - 드롭박스 프로그램이 동기화하는 폴더(Dropbox/Apps/<앱 폴더>)를 고르면 웹판과 같은 자료를 함께 쓴다.
// - 포터블판은 USB 안의 "나날노트자료" 폴더를 쓴다.
// - 다른 기기에서 먼저 고친 파일(동기화로 바뀐 파일)은 덮어쓰지 않고 알리고, 한 번 더 저장하면 덮어쓴다.
import { serialize, parse, pathOf, yearDir, FILES } from '../lib/mdformat.js';
import { safeName } from '../lib/photos.js';
import { resolveFolder } from '../lib/desktop.js';

let idSeq = 0;
const makeId = () => `f_${(idSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const tauriFs = () => import('@tauri-apps/plugin-fs');

export class FolderBackend {
  /** @param fs 테스트용으로 파일 함수들을 바꿔 끼울 수 있다 (기본: Tauri fs 플러그인) */
  constructor({ folder, fs = null }) {
    this.fsImpl = fs;
    this.name = 'folder';
    this.label = '이 컴퓨터 폴더 (마크다운 파일)';
    this.folder = folder;
    this.years = new Map(); // year -> { data, files: Map<rel, { text, mtime }> }
    this.force = new Set();
    this.urls = new Map();
  }

  async fs() { return this.fsImpl || tauriFs(); }

  async root() {
    if (!this.rootPath) this.rootPath = (await resolveFolder(this.folder)).replace(/[\\/]+$/, '');
    if (!this.rootPath) throw new Error('자료 폴더가 정해지지 않았습니다. 설정 > 저장소에서 폴더를 고르세요.');
    return this.rootPath;
  }
  async abs(rel) { return `${await this.root()}${rel}`; } // rel 은 '/2026학년도/...' 형태

  async mtimeOf(path) {
    const { stat } = await this.fs();
    try { const s = await stat(path); return s.mtime ? new Date(s.mtime).getTime() : 0; } catch { return null; }
  }

  async listMd(dirAbs, relBase, out) {
    const { readDir } = await this.fs();
    let entries = [];
    try { entries = await readDir(dirAbs); } catch { return out; }
    for (const e of entries) {
      const rel = `${relBase}/${e.name}`;
      if (e.isDirectory) await this.listMd(`${dirAbs}/${e.name}`, rel, out);
      else if (/\.md$/i.test(e.name)) out.push(rel);
    }
    return out;
  }

  async loadYear(year) {
    const { readTextFile, exists, mkdir } = await this.fs();
    const root = await this.root();
    if (!(await exists(root))) await mkdir(root, { recursive: true });
    const rels = await this.listMd(`${root}${yearDir(year)}`, yearDir(year), []);
    const files = new Map();
    for (const rel of rels) {
      const abs = `${root}${rel}`;
      files.set(rel, { text: await readTextFile(abs), mtime: await this.mtimeOf(abs) });
    }
    const data = parse(year, new Map([...files].map(([k, v]) => [k, v.text])), makeId);
    this.years.set(year, { data, files });
    return JSON.parse(JSON.stringify(data));
  }

  async applyOps(year, ops) {
    if (!this.years.has(year)) await this.loadYear(year);
    const { writeTextFile, mkdir, remove } = await this.fs();
    const y = this.years.get(year);
    const results = ops.map(() => ({ ok: true }));
    const opPaths = [];
    ops.forEach((op, i) => {
      const list = y.data[op.col];
      if (!list) { results[i] = { ok: false, error: `알 수 없는 항목: ${op.col}` }; opPaths.push(null); return; }
      if (op.op === 'delete') {
        const old = list.find((x) => x.id === op.id);
        opPaths.push(old ? pathOf(year, op.col, old) : null);
        y.data[op.col] = list.filter((x) => x.id !== op.id);
      } else {
        const item = { ...op.item };
        if (String(item.id || '').startsWith('n_')) item.id = makeId();
        const k = list.findIndex((x) => x.id === item.id);
        const old = k >= 0 ? list[k] : null;
        if (k >= 0) list[k] = item; else list.push(item);
        opPaths.push(old && pathOf(year, op.col, old) !== pathOf(year, op.col, item) ? null : pathOf(year, op.col, item));
        results[i] = { ok: true, id: item.id };
      }
    });

    const next = serialize(year, y.data);
    const failed = new Map();
    for (const [rel, text] of next) {
      const cur = y.files.get(rel);
      if (cur?.text === text) continue;
      const abs = await this.abs(rel);
      try {
        // 동기화 등으로 그 사이 파일이 바뀌었으면 덮어쓰지 않는다 (한 번 더 저장하면 덮어씀)
        if (!this.force.has(rel)) {
          const m = await this.mtimeOf(abs);
          if (cur ? m !== null && cur.mtime !== null && m !== cur.mtime : m !== null) {
            this.force.add(rel);
            failed.set(rel, `다른 곳(동기화된 다른 기기 등)에서 먼저 바뀐 파일이라 저장하지 않았습니다: ${rel}. 새로고침하면 그 내용을 불러오고, 한 번 더 저장하면 이 내용으로 덮어씁니다.`);
            continue;
          }
        }
        await mkdir(abs.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
        await writeTextFile(abs, text);
        this.force.delete(rel);
        y.files.set(rel, { text, mtime: await this.mtimeOf(abs) });
      } catch (e) { failed.set(rel, `파일 저장 실패: ${e?.message || e}`); }
    }
    const fixed = new Set(Object.values(FILES).map((f) => `${yearDir(year)}/${f}`));
    for (const rel of [...y.files.keys()]) {
      if (next.has(rel) || !(fixed.has(rel) || /\/일지\/\d{4}-\d{2}-\d{2}\.md$/.test(rel))) continue;
      try { await remove(await this.abs(rel)); y.files.delete(rel); } catch (e) {
        if (/not found|no such|cannot find/i.test(String(e))) y.files.delete(rel); else failed.set(rel, `파일 삭제 실패: ${e?.message || e}`);
      }
    }
    if (failed.size) {
      const anyErr = [...failed.values()][0];
      ops.forEach((op, i) => { const p = opPaths[i]; if (p == null || failed.has(p)) results[i] = { ok: false, error: p ? failed.get(p) || anyErr : anyErr }; });
    }
    return results;
  }

  // ---------- 파일 (사진, 학사일정 자료) ----------
  async putFile(year, folder, name, blob) {
    const { writeFile, mkdir } = await this.fs();
    const dir = await this.abs(`${yearDir(year)}/${folder}`);
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${name}`, new Uint8Array(await blob.arrayBuffer()));
    this.urls.set(`${year}/${folder}/${name}`, URL.createObjectURL(blob));
    return name;
  }

  async fileUrl(year, folder, name) {
    if (!name) return null;
    const key = `${year}/${folder}/${name}`;
    if (this.urls.has(key)) return this.urls.get(key);
    const { readFile } = await this.fs();
    try {
      const bytes = await readFile(await this.abs(`${yearDir(year)}/${folder}/${name}`));
      const type = /\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : /\.txt$/i.test(name) ? 'text/plain' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : '';
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      this.urls.set(key, url);
      return url;
    } catch { return null; }
  }

  async deleteFile(year, folder, name) {
    if (!name) return;
    const { remove } = await this.fs();
    await remove(await this.abs(`${yearDir(year)}/${folder}/${name}`)).catch(() => {});
    this.urls.delete(`${year}/${folder}/${name}`);
  }

  async savePhoto(year, student, blob) {
    const name = `${safeName(student.studentNo ? `${student.studentNo}_${student.name}` : student.name)}.jpg`;
    await this.putFile(year, '사진', name, blob);
    if (student.photo && student.photo !== name) await this.deleteFile(year, '사진', student.photo);
    return name;
  }
  photoUrl(year, student) { return this.fileUrl(year, '사진', student?.photo); }
  deletePhoto(year, student) { return this.deleteFile(year, '사진', student?.photo); }

  holidayFetcher() { return null; }
}
