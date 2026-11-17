// 로컬 저장소 백엔드: 브라우저 localStorage 에 학년도별로 저장, 학생 사진은 IndexedDB
import { idbPut, idbGet, idbDel } from '../lib/photos.js';

const urls = new Map();
const KEY = (y) => `sn:data:${y}`;

export class LocalBackend {
  constructor() { this.name = 'local'; this.label = '이 브라우저(로컬)'; }

  async loadYear(year) {
    try { return JSON.parse(localStorage.getItem(KEY(year)) || 'null') || {}; } catch { return {}; }
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
    localStorage.setItem(KEY(year), JSON.stringify(data));
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

  async savePhoto(year, student, blob) {
    const key = `${year}/${student.uid}`;
    await idbPut(key, blob);
    if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
    urls.set(key, URL.createObjectURL(blob));
    return 'idb';
  }

  async photoUrl(year, student) {
    if (!student?.photo) return null;
    const key = `${year}/${student.uid}`;
    if (urls.has(key)) return urls.get(key);
    const blob = await idbGet(key).catch(() => null);
    if (!blob) return null;
    urls.set(key, URL.createObjectURL(blob));
    return urls.get(key);
  }

  async deletePhoto(year, student) {
    const key = `${year}/${student.uid}`;
    await idbDel(key).catch(() => {});
    urls.delete(key);
  }
}
