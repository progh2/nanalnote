import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

// 노션 API 모의 서버
function mockNotion() {
  const dbs = new Map(); // id -> {title, pages: Map}
  let seq = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const parent = 'parentpage';
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push(`${init.method} ${u.pathname}`);
    const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
    let m;
    if (u.pathname === `/v1/blocks/${parent}/children`) {
      return ok({ results: [...dbs].map(([id, d]) => ({ id, type: 'child_database', child_database: { title: d.title } })), has_more: false });
    }
    if (u.pathname === '/v1/databases' && init.method === 'POST') {
      const id = uuid();
      dbs.set(id, { title: body.title[0].text.content, props: body.properties, pages: new Map() });
      return ok({ id });
    }
    if ((m = u.pathname.match(/^\/v1\/databases\/(.+)\/query$/))) {
      const db = dbs.get(m[1]);
      const y = body.filter.number.equals;
      return ok({ results: [...db.pages.values()].filter((p) => !p.archived && p.properties.학년도.number === y), has_more: false });
    }
    if (u.pathname === '/v1/pages' && init.method === 'POST') {
      const id = uuid();
      const props = {};
      // 요청 형식 → 응답 형식(plain_text) 변환
      for (const [k, v] of Object.entries(body.properties)) {
        if (v.title) props[k] = { title: v.title.map((t) => ({ plain_text: t.text.content })) };
        else if (v.rich_text) props[k] = { rich_text: v.rich_text.map((t) => ({ plain_text: t.text.content })) };
        else props[k] = v;
      }
      dbs.get(body.parent.database_id).pages.set(id, { id, properties: props });
      return ok({ id });
    }
    if ((m = u.pathname.match(/^\/v1\/pages\/(.+)$/)) && init.method === 'PATCH') {
      for (const d of dbs.values()) if (d.pages.has(m[1])) { if (body.archived) d.pages.get(m[1]).archived = true; }
      return ok({ id: m[1] });
    }
    return new Response(JSON.stringify({ message: 'not mocked ' + u.pathname }), { status: 404 });
  };
  return { dbs, calls };
}

const env = { NOTION_TOKEN: 't', NOTION_PARENT: 'parentpage', APP_PASSWORD: 'pw', ALLOWED_ORIGIN: 'https://me.github.io' };
const call = (path, { method = 'GET', body, key = 'pw', origin = 'https://me.github.io' } = {}) =>
  worker.fetch(new Request('https://w.dev' + path, { method, body: body && JSON.stringify(body), headers: { 'X-App-Key': key, Origin: origin, 'Content-Type': 'application/json' } }), env);

test('Worker: 인증, setup, batch, 조회 왕복', async () => {
  const { dbs } = mockNotion();
  assert.equal((await call('/api/ping', { key: 'bad' })).status, 401);
  const pre = await call('/api/ping', { method: 'OPTIONS' });
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://me.github.io');

  let r = await (await call('/api/setup', { method: 'POST' })).json();
  assert.equal(r.created.length, 9);
  assert.equal(dbs.size, 9);
  r = await (await call('/api/setup', { method: 'POST' })).json();
  assert.equal(r.created.length, 0);

  const ops = [
    { op: 'upsert', col: 'students', item: { id: 'n_1', no: 1, name: '이몽룡' } },
    { op: 'upsert', col: 'counsel', item: { id: 'n_2', date: '2026-03-02', order: 0, text: '이몽룡 울었다'.repeat(300), students: ['이몽룡'] } },
    { op: 'upsert', col: 'records', item: { id: 'n_3', title: '독서록', created: '2026-03-02', doneDate: null, entries: { 이몽룡: 'O' } } },
    { op: 'upsert', col: 'settings', item: { id: 'n_4', key: 'main', value: { teacherInfo: '3-2', timetable: { 1: ['국어'] } } } },
    { op: 'upsert', col: 'tasks', item: { id: 'n_5', text: '가정통신문', created: '2026-03-02', doneDate: '2026-03-03' } },
  ];
  r = await (await call('/api/batch', { method: 'POST', body: { year: 2026, ops } })).json();
  assert.ok(r.results.every((x) => x.ok), JSON.stringify(r));

  const get = async (col) => (await (await call(`/api/year/2026/${col}`)).json()).items;
  const counsel = await get('counsel');
  assert.equal(counsel[0].text, '이몽룡 울었다'.repeat(300)); // 2000자 초과 분할 후 복원
  assert.deepEqual(counsel[0].students, ['이몽룡']);
  assert.deepEqual((await get('records'))[0].entries, { 이몽룡: 'O' });
  assert.equal((await get('settings'))[0].value.teacherInfo, '3-2');
  assert.equal((await get('tasks'))[0].doneDate, '2026-03-03');
  assert.equal((await get('students')).length, 1);
  assert.equal((await get('students')).length, 1);
  assert.equal((await (await call('/api/year/2025/students')).json()).items.length, 0);

  const sid = (await get('students'))[0].id;
  r = await (await call('/api/batch', { method: 'POST', body: { year: 2026, ops: [{ op: 'delete', col: 'students', id: sid }] } })).json();
  assert.ok(r.results[0].ok);
  assert.equal((await get('students')).length, 0);
});
