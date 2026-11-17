// 쌔미노트 웹 - Cloudflare Worker (노션 중계 서버)
//
// 역할
//  1) 노션 토큰을 안전하게 보관하고 브라우저 대신 노션 API 를 호출한다. (노션 API 는 브라우저 직접 호출(CORS) 불가)
//  2) 앱 접속 비밀번호(APP_PASSWORD)로 요청을 인증한다.
//  3) 공공데이터포털 특일정보 API 를 중계한다. (선택)
//
// 환경변수 (wrangler secret put ...)
//  NOTION_TOKEN     노션 내부 통합(Integration) 시크릿
//  NOTION_PARENT    데이터베이스를 만들 노션 페이지 ID (통합에 공유되어 있어야 함)
//  APP_PASSWORD     웹앱 접속 비밀번호
//  ALLOWED_ORIGIN   허용할 웹앱 주소(쉼표 구분). 예: https://아이디.github.io
//  DATA_GO_KR_KEY   (선택) 공공데이터포털 한국천문연구원 특일정보 서비스키

const NOTION_VERSION = '2022-06-28';
const PREFIX = '쌔미노트_';

// ---------- 노션 속성 헬퍼 ----------
function chunks(text, size = 1800) {
  const chars = Array.from(String(text ?? ''));
  const out = [];
  for (let i = 0; i < chars.length && out.length < 100; i += size) out.push(chars.slice(i, i + size).join(''));
  return out;
}
const T = (s) => ({ title: chunks(s).map((c) => ({ type: 'text', text: { content: c } })) });
const R = (s) => ({ rich_text: chunks(s).map((c) => ({ type: 'text', text: { content: c } })) });
const N = (n) => ({ number: n == null || n === '' || isNaN(+n) ? null : +n });
const D = (s) => ({ date: s ? { start: s } : null });
const S = (s) => ({ select: s ? { name: String(s).replace(/,/g, ' ') } : null });
const M = (arr) => ({ multi_select: (arr || []).filter(Boolean).map((s) => ({ name: String(s).replace(/,/g, ' ').slice(0, 100) })) });
const CB = (b) => ({ checkbox: !!b });

const plain = (arr) => (arr || []).map((x) => x.plain_text ?? x.text?.content ?? '').join('');
const gT = (p, k) => plain(p.properties[k]?.title);
const gR = (p, k) => plain(p.properties[k]?.rich_text);
const gN = (p, k) => p.properties[k]?.number ?? null;
const gD = (p, k) => p.properties[k]?.date?.start ?? null;
const gDay = (p, k) => (gD(p, k) || '').slice(0, 10) || null;
const gS = (p, k) => p.properties[k]?.select?.name ?? '';
const gM = (p, k) => (p.properties[k]?.multi_select || []).map((x) => x.name);
const parseJSON = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// ---------- 컬렉션 스키마 ----------
// 첫 번째 속성이 제목(title) 속성이다. 모든 DB 에 학년도(number) 속성이 있다.
const SCHEMAS = {
  settings: {
    name: '설정',
    props: { 키: 'title', 값: 'rich_text' },
    to: (x) => ({ 키: T(x.key), 값: R(JSON.stringify(x.value ?? {})) }),
    from: (p) => ({ key: gT(p, '키'), value: parseJSON(gR(p, '값'), {}) }),
  },
  students: {
    name: '학생',
    props: { 이름: 'title', 학번: 'rich_text', 학년: 'number', 반: 'number', 번호: 'number', 성별: 'rich_text', 이메일: 'email', 전화번호: 'phone_number', 사진: 'rich_text', ID: 'rich_text' },
    to: (x) => ({ 이름: T(x.name), 학번: R(x.studentNo), 학년: N(x.grade), 반: N(x.cls), 번호: N(x.no), 성별: R(x.gender), 이메일: { email: x.email || null }, 전화번호: { phone_number: x.phone || null }, 사진: R(x.photo), ID: R(x.uid) }),
    from: (p) => ({ name: gT(p, '이름'), studentNo: gR(p, '학번'), grade: gN(p, '학년'), cls: gN(p, '반'), no: gN(p, '번호'), gender: gR(p, '성별'), email: p.properties.이메일?.email || '', phone: p.properties.전화번호?.phone_number || '', photo: gR(p, '사진'), uid: gR(p, 'ID') || undefined }),
  },
  schedule: {
    name: '학사일정',
    props: { 일정: 'title', 날짜: 'date', 휴업: 'checkbox', 수능대비: 'checkbox' },
    to: (x) => ({ 일정: T(x.text), 날짜: D(x.date), 휴업: CB(x.holiday), 수능대비: CB(x.csat) }),
    from: (p) => ({ text: gT(p, '일정'), date: gDay(p, '날짜'), ...(p.properties.휴업?.checkbox ? { holiday: true } : {}), ...(p.properties.수능대비?.checkbox ? { csat: true } : {}) }),
  },
  days: {
    name: '교사수첩',
    props: { 날짜: 'title', 일자: 'date', 최종수정: 'date', 노트: 'rich_text' },
    to: (x) => ({ 날짜: T(x.date), 일자: D(x.date), 최종수정: D(x.updatedAt), 노트: R(x.note) }),
    from: (p) => ({ date: gT(p, '날짜'), updatedAt: gD(p, '최종수정'), ...(gR(p, '노트') ? { note: gR(p, '노트') } : {}) }),
  },
  lessons: {
    name: '수업일지',
    props: { 수업: 'title', 날짜: 'date', 교시: 'number', 과목: 'rich_text', 학반: 'rich_text', 교실: 'rich_text', 내용: 'rich_text' },
    to: (x) => ({ 수업: T([x.date, x._period || `${x.period}교시`, x.subject, x.cls].filter(Boolean).join(' ')), 날짜: D(x.date), 교시: N(x.period), 과목: R(x.subject), 학반: R(x.cls), 교실: R(x.room), 내용: R(x.content) }),
    from: (p) => ({ date: gDay(p, '날짜'), period: gN(p, '교시'), subject: gR(p, '과목'), cls: gR(p, '학반'), room: gR(p, '교실'), content: gR(p, '내용') }),
  },
  tasks: {
    name: '업무일지',
    props: { 내용: 'title', 중요도: 'select', 작성일: 'date', 마감일: 'date', 완료일: 'date', 완료: 'checkbox', 순서: 'number' },
    to: (x) => ({ 내용: T(x.text), 중요도: S({ A: 'A', B: 'B', C: 'C', Z: '언젠가' }[x.priority] || ''), 작성일: D(x.created), 마감일: D(x.due), 완료일: D(x.doneDate), 완료: CB(x.doneDate), 순서: N(x.order) }),
    from: (p) => {
      const pr = { A: 'A', B: 'B', C: 'C', 언젠가: 'Z' }[gS(p, '중요도')];
      return { text: gT(p, '내용'), created: gDay(p, '작성일'), doneDate: gDay(p, '완료일'), ...(gDay(p, '마감일') ? { due: gDay(p, '마감일') } : {}),
        ...(pr ? { priority: pr } : {}), ...(gN(p, '순서') != null ? { order: gN(p, '순서') } : {}) };
    },
  },
  attendance: {
    name: '학생출결',
    props: { 학생: 'title', 날짜: 'date', 교시: 'rich_text', 수업: 'rich_text', 학반: 'rich_text', 구분: 'select', 사유: 'select', 비고: 'rich_text' },
    to: (x) => ({ 학생: T(x._label || x.student), 날짜: D(x.date), 교시: R((x.periods || []).join(',')), 수업: R(x.subject), 학반: R(x.cls), 구분: S(x.type), 사유: S(x.reason), 비고: R(x.note) }),
    from: (p) => {
      const periods = gR(p, '교시').split(',').map(Number).filter(Boolean);
      return { student: gT(p, '학생'), date: gDay(p, '날짜'), type: gS(p, '구분'), reason: gS(p, '사유'), note: gR(p, '비고'),
        ...(periods.length ? { periods } : {}), ...(gR(p, '수업') ? { subject: gR(p, '수업') } : {}), ...(gR(p, '학반') ? { cls: gR(p, '학반') } : {}) };
    },
  },
  counsel: {
    name: '상담일지',
    props: { 요약: 'title', 날짜: 'date', 순서: 'number', 학생: 'multi_select', 내용: 'rich_text' },
    to: (x) => ({ 요약: T(Array.from(x.text || '').slice(0, 60).join('').replace(/\n/g, ' ')), 날짜: D(x.date), 순서: N(x.order), 학생: M(x._labels || x.students), 내용: R(x.text) }),
    from: (p) => ({ date: gDay(p, '날짜'), order: gN(p, '순서') ?? 0, students: gM(p, '학생'), text: gR(p, '내용') }),
  },
  records: {
    name: '학급요록',
    props: { 제목: 'title', 등록일: 'date', 완료일: 'date', 대상: 'rich_text', 학생별: 'rich_text' },
    to: (x) => ({ 제목: T(x.title), 등록일: D(x.created), 완료일: D(x.doneDate), 대상: R(x.cls), 학생별: R(JSON.stringify(x._entries || x.entries || {})) }),
    from: (p) => ({ title: gT(p, '제목'), created: gDay(p, '등록일'), doneDate: gDay(p, '완료일'), ...(gR(p, '대상') ? { cls: gR(p, '대상') } : {}), entries: parseJSON(gR(p, '학생별'), {}) }),
  },
  notes: {
    name: '포스트잇',
    props: { 메모: 'title', 내용: 'rich_text', 색: 'rich_text', 위치: 'rich_text' },
    to: (x) => ({ 메모: T(Array.from(x.text || '').slice(0, 40).join('').replace(/\n/g, ' ')), 내용: R(x.text), 색: R(x.color), 위치: R(JSON.stringify({ x: x.x, y: x.y, w: x.w, h: x.h, min: !!x.min })) }),
    from: (p) => ({ text: gR(p, '내용'), color: gR(p, '색') || 'yellow', ...parseJSON(gR(p, '위치'), {}) }),
  },
  docs: {
    name: '학사일정자료',
    props: { 제목: 'title', 종류: 'select', 기간: 'rich_text', 판: 'number', 파일: 'rich_text', 쪽: 'rich_text', 올린날: 'date' },
    to: (x) => ({ 제목: T(x.title), 종류: S(x.kind), 기간: R(x.period), 판: N(x.rev || 1), 파일: R(x.file), 쪽: R(JSON.stringify({ pages: x.pages || [], src: x.src || '', textFile: x.textFile || '' })), 올린날: D(x.uploaded) }),
    from: (p) => ({ title: gT(p, '제목'), kind: gS(p, '종류'), period: gR(p, '기간'), rev: gN(p, '판') || 1, file: gR(p, '파일'), uploaded: gDay(p, '올린날'), ...parseJSON(gR(p, '쪽'), {}) }),
  },
  trips: {
    name: '출장',
    props: { 출장지: 'title', 날짜: 'date', 시간: 'rich_text', 목적: 'rich_text' },
    to: (x) => ({ 출장지: T(x.place), 날짜: D(x.date), 시간: R(x.time), 목적: R(x.purpose) }),
    from: (p) => ({ place: gT(p, '출장지'), date: gDay(p, '날짜'), time: gR(p, '시간'), purpose: gR(p, '목적') }),
  },
};

// ---------- 노션 API ----------
async function notion(env, method, path, body, attempt = 0) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const wait = (+res.headers.get('Retry-After') || 1) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return notion(env, method, path, body, attempt + 1);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Notion ${res.status}: ${json.message || json.code || 'error'}`);
  return json;
}

let dbCache = { at: 0, ids: null };

/** 부모 페이지 아래의 쌔미노트 데이터베이스 ID 찾기 (10분 캐시) */
async function findDatabases(env, force = false) {
  if (!force && dbCache.ids && Date.now() - dbCache.at < 600000) return dbCache.ids;
  const ids = {};
  let cursor;
  do {
    const q = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const r = await notion(env, 'GET', `/blocks/${env.NOTION_PARENT}/children${q}`);
    for (const b of r.results) {
      if (b.type !== 'child_database' || b.archived || b.in_trash) continue;
      const title = b.child_database?.title || '';
      for (const [col, s] of Object.entries(SCHEMAS)) if (title === PREFIX + s.name) ids[col] = b.id;
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  dbCache = { at: Date.now(), ids };
  return ids;
}

async function setup(env) {
  const ids = await findDatabases(env, true);
  const created = [];
  const updated = [];
  for (const [col, s] of Object.entries(SCHEMAS)) {
    if (ids[col]) {
      // 새 버전에서 추가된 속성이 있으면 기존 DB 에 덧붙인다
      const db = await notion(env, 'GET', `/databases/${ids[col]}`);
      const missing = {};
      for (const [k, type] of Object.entries(s.props)) if (type !== 'title' && !db.properties?.[k]) missing[k] = { [type]: {} };
      if (Object.keys(missing).length) {
        await notion(env, 'PATCH', `/databases/${ids[col]}`, { properties: missing });
        updated.push(`${s.name}(${Object.keys(missing).join(', ')})`);
      }
      continue;
    }
    const properties = { 학년도: { number: { format: 'number' } } };
    for (const [k, type] of Object.entries(s.props)) properties[k] = { [type]: {} };
    if (col === 'attendance') {
      properties.구분 = { select: { options: ['결석', '지각', '조퇴', '결과'].map((name) => ({ name })) } };
      properties.사유 = { select: { options: ['질병', '미인정', '기타', '출석인정'].map((name) => ({ name })) } };
    }
    const db = await notion(env, 'POST', '/databases', {
      parent: { type: 'page_id', page_id: env.NOTION_PARENT },
      title: [{ type: 'text', text: { content: PREFIX + s.name } }],
      properties,
    });
    ids[col] = db.id;
    created.push(s.name);
  }
  dbCache = { at: Date.now(), ids };
  return { created, updated, databases: Object.keys(ids).length };
}

/** 한 컬렉션의 한 페이지(최대 100건) 조회. 무료 플랜 하위요청 제한 때문에 클라이언트가 페이지 단위로 반복 호출한다. */
async function queryPage(env, col, year, cursor) {
  const s = SCHEMAS[col];
  if (!s) { const e = new Error(`알 수 없는 컬렉션: ${col}`); e.status = 400; throw e; }
  const ids = await findDatabases(env);
  if (!ids[col]) {
    const err = new Error('노션 데이터베이스가 없습니다. 앱 설정에서 [노션 DB 만들기]를 먼저 실행하세요.');
    err.status = 409;
    throw err;
  }
  const r = await notion(env, 'POST', `/databases/${ids[col]}/query`, {
    filter: { property: '학년도', number: { equals: year } },
    page_size: 100,
    ...(cursor ? { start_cursor: cursor } : {}),
  });
  return { items: r.results.map((p) => ({ id: p.id, ...s.from(p) })), next: r.has_more ? r.next_cursor : null };
}

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

async function batch(env, year, ops) {
  const ids = await findDatabases(env);
  const results = [];
  for (const op of ops) {
    try {
      const s = SCHEMAS[op.col];
      if (!s || !ids[op.col]) throw new Error(`알 수 없는 컬렉션: ${op.col}`);
      if (op.op === 'delete') {
        if (UUID.test(op.id)) await notion(env, 'PATCH', `/pages/${op.id}`, { archived: true });
        results.push({ ok: true });
      } else if (op.op === 'upsert') {
        const properties = { ...s.to(op.item), 학년도: N(year) };
        if (UUID.test(op.item.id || '')) {
          await notion(env, 'PATCH', `/pages/${op.item.id}`, { properties });
          results.push({ ok: true, id: op.item.id });
        } else {
          const page = await notion(env, 'POST', '/pages', { parent: { database_id: ids[op.col] }, properties });
          results.push({ ok: true, id: page.id });
        }
      } else throw new Error(`알 수 없는 작업: ${op.op}`);
    } catch (e) {
      results.push({ ok: false, error: e.message });
    }
  }
  return results;
}

// ---------- 특일정보 (공공데이터포털) ----------
async function holidays(env, year, month) {
  if (!env.DATA_GO_KR_KEY) return [];
  const key = env.DATA_GO_KR_KEY.includes('%') ? env.DATA_GO_KR_KEY : encodeURIComponent(env.DATA_GO_KR_KEY);
  const base = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService';
  const mm = String(month).padStart(2, '0');
  const ops = [['getRestDeInfo', ''], ['getHoliDeInfo', ''], ['getAnniversaryInfo', ''], ['get24DivisionsInfo', '(절기)']];
  const seen = new Map();
  for (const [op, suffix] of ops) {
    try {
      const r = await fetch(`${base}/${op}?serviceKey=${key}&solYear=${year}&solMonth=${mm}&numOfRows=100&_type=json`);
      const j = await r.json();
      let items = j?.response?.body?.items?.item || [];
      if (!Array.isArray(items)) items = [items];
      for (const it of items) {
        const d = String(it.locdate);
        const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
        const name = `${it.dateName}${suffix}`;
        const k = date + name;
        const holiday = it.isHoliday === 'Y';
        if (!seen.has(k)) seen.set(k, { date, name, holiday });
        else if (holiday) seen.get(k).holiday = true;
      }
    } catch { /* 일부 실패는 무시 */ }
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- HTTP ----------
function corsHeaders(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin || '*' : allowed[0] || 'null',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-App-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(env, req);
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return json({ name: 'sammynote-worker', ok: true });

    if (!env.APP_PASSWORD || !safeEqual(req.headers.get('X-App-Key') || '', env.APP_PASSWORD)) {
      return json({ error: '접속 비밀번호가 올바르지 않습니다.' }, 401);
    }
    if (!env.NOTION_TOKEN || !env.NOTION_PARENT) return json({ error: 'Worker 에 NOTION_TOKEN / NOTION_PARENT 가 설정되지 않았습니다.' }, 500);

    try {
      const path = url.pathname;
      if (path === '/api/ping') {
        const ids = await findDatabases(env, true);
        return json({ ok: true, databases: Object.keys(ids).length, total: Object.keys(SCHEMAS).length, holidays: !!env.DATA_GO_KR_KEY });
      }
      if (path === '/api/setup' && req.method === 'POST') return json({ ok: true, ...(await setup(env)) });
      const m = path.match(/^\/api\/year\/(\d{4})\/(\w+)$/);
      if (m) return json(await queryPage(env, m[2], +m[1], url.searchParams.get('cursor')));
      if (path === '/api/batch' && req.method === 'POST') {
        const { year, ops } = await req.json();
        if (!Number.isInteger(year) || !Array.isArray(ops) || ops.length > 30) return json({ error: '잘못된 요청' }, 400);
        return json({ results: await batch(env, year, ops) });
      }
      if (path === '/api/holidays') {
        const y = +url.searchParams.get('year'), mo = +url.searchParams.get('month');
        if (!y || !mo) return json({ error: 'year, month 필요' }, 400);
        return json({ items: await holidays(env, y, mo) });
      }
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, e.status || 500);
    }
  },
};
