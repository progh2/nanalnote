// 노션 백엔드: Cloudflare Worker(중계 서버)를 통해 노션 데이터베이스에 저장
// 노션 토큰은 Worker 에만 보관되고, 브라우저에는 앱 접속 비밀번호만 저장된다.

import { COLLECTIONS } from '../store.js';

const BATCH = 25; // Worker 무료 플랜 하위요청 제한(50)을 고려한 배치 크기

export class NotionBackend {
  constructor({ url, key }) {
    this.name = 'notion';
    this.label = '노션(Notion)';
    this.url = String(url || '').replace(/\/+$/, '');
    this.key = key || '';
  }

  async req(path, opts = {}) {
    if (!this.url) throw new Error('Worker 주소가 설정되지 않았습니다.');
    let res;
    try {
      res = await fetch(this.url + path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', 'X-App-Key': this.key, ...(opts.headers || {}) },
      });
    } catch (e) {
      throw new Error(`Worker 에 연결할 수 없습니다 (${e.message}). 주소와 CORS 설정(ALLOWED_ORIGIN)을 확인하세요.`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  ping() { return this.req('/api/ping'); }
  setup() { return this.req('/api/setup', { method: 'POST' }); }

  async loadYear(year) {
    const data = {};
    await Promise.all(COLLECTIONS.map(async (col) => {
      const items = [];
      let cursor = null;
      do {
        const r = await this.req(`/api/year/${year}/${col}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
        items.push(...r.items);
        cursor = r.next;
      } while (cursor);
      data[col] = items;
    }));
    return data;
  }

  /** ctx.label(uid) 로 사람이 읽는 학생 이름("학번 이름")을 붙여 보낸다 */
  async applyOps(year, ops, ctx = {}) {
    const label = ctx.label || ((x) => x);
    ops = ops.map((op) => {
      if (op.op !== 'upsert') return op;
      const item = { ...op.item };
      if (op.col === 'attendance') item._label = label(item.student);
      if (op.col === 'counsel') item._labels = (item.students || []).map(label);
      if (op.col === 'records') item._entries = Object.fromEntries(Object.entries(item.entries || {}).map(([k, v]) => [label(k), v]));
      return { ...op, item };
    });
    const results = [];
    for (let i = 0; i < ops.length; i += BATCH) {
      const chunk = ops.slice(i, i + BATCH);
      try {
        const r = await this.req('/api/batch', { method: 'POST', body: JSON.stringify({ year, ops: chunk }) });
        results.push(...r.results);
      } catch (e) {
        results.push(...chunk.map(() => ({ ok: false, error: e.message })));
      }
    }
    return results;
  }

  holidayFetcher() {
    return async (year, month) => {
      const r = await this.req(`/api/holidays?year=${year}&month=${month}`);
      return r.items;
    };
  }
}

NotionBackend.prototype.savePhoto = async function () { throw new Error('노션 저장소는 학생 사진을 지원하지 않습니다. 드롭박스나 로컬 저장소를 사용하세요.'); };
NotionBackend.prototype.photoUrl = async function () { return null; };
NotionBackend.prototype.deletePhoto = async function () {};
