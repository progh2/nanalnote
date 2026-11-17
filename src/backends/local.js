// 로컬 저장소 백엔드: 브라우저 localStorage 에 학년도별로 저장, 학생 사진은 IndexedDB
import { idbPut, idbGet, idbDel } from '../lib/photos.js';
import { sget, sset } from '../lib/securestore.js';

const urls = new Map();
const KEY = (y) => `sn:data:${y}`;

export class LocalBackend {
  constructor() { this.name = 'local'; this.label = '이 브라우저(로컬)'; }

  async loadYear(year) {
    try { return JSON.parse(sget(KEY(year)) || 'null') || {}; } catch { return {}; }
  }

  async applyOps(year, ops) {
    const data = await this.loadYear(year);
    const results = [];
    for (const op of ops) {
      const list = (data[op.col] ||= []);
      if (op.op === 'delete') {
        data[op.col] = list.filter((x) => x.id !== op.id);
        results.push({ ok: true });
      } else {
        const item = { ...op.item };
        if (String(item.id || '').startsWith('n_')) item.id = 'l_' + item.id.slice(2);
        const i = list.findIndex((x) => x.id === item.id);
        if (i >= 0) list[i] = item; else list.push(item);
        results.push({ ok: true, id: item.id });
      }
    }
    sset(KEY(year), JSON.stringify(data));
    return results;
  }

  /** 로컬에 저장된 학년도 목록 */
  async listYears() {
    const ys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const m = localStorage.key(i).match(/^sn:data:(\d{4})$/);
      if (m) ys.push(+m[1]);
    }
    return ys.sort();
  }

  holidayFetcher() { return null; }

  // ---------- 파일 (사진, 학사일정 자료): IndexedDB ----------
  async putFile(year, folder, name, blob) {
    const key = `${year}/${folder}/${name}`;
    await idbPut(key, blob);
    if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
    urls.set(key, URL.createObjectURL(blob));
    return name;
  }

  async fileUrl(year, folder, name) {
    if (!name) return null;
    // 예전 버전 사진 키: `${year}/${uid}` (photo === 'idb')
    const key = `${year}/${folder}/${name}`;
    if (urls.has(key)) return urls.get(key);
    const blob = await idbGet(key).catch(() => null);
    if (!blob) return null;
    urls.set(key, URL.createObjectURL(blob));
    return urls.get(key);
  }

  async deleteFile(year, folder, name) {
    const key = `${year}/${folder}/${name}`;
    await idbDel(key).catch(() => {});
    urls.delete(key);
  }

  async savePhoto(year, student, blob) { return this.putFile(year, '사진', `${student.uid}.jpg`, blob); }

  async photoUrl(year, student) {
    if (!student?.photo) return null;
    if (student.photo === 'idb') { // 예전 형식
      const key = `${year}/${student.uid}`;
      if (urls.has(key)) return urls.get(key);
      const blob = await idbGet(key).catch(() => null);
      if (!blob) return null;
      urls.set(key, URL.createObjectURL(blob));
      return urls.get(key);
    }
    return this.fileUrl(year, '사진', student.photo);
  }

  async deletePhoto(year, student) {
    if (!student?.photo) return;
    if (student.photo === 'idb') await idbDel(`${year}/${student.uid}`).catch(() => {});
    else await this.deleteFile(year, '사진', student.photo);
  }
}
