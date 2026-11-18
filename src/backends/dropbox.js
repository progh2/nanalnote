// 드롭박스 백엔드: 학년도 데이터를 마크다운 파일로 드롭박스 앱 폴더(Apps/<앱 이름>)에 저장
// - PKCE 로그인만 사용 (App key 는 공개값, App secret 없음, 서버 없음). pdf-ink 의 dropbox.js 를 바탕으로 함.
// - 저장할 때는 불러온 시점의 rev 로 update 하므로, 그 사이 다른 기기에서 고친 파일은 덮어쓰지 않고 알린다.
//   같은 파일을 한 번 더 저장하면 이 기기 내용으로 덮어쓴다.

import { serialize, parse, pathOf, yearDir, FILES } from '../lib/mdformat.js';
import { safeName } from '../lib/photos.js';
import { sget, sset, sdel } from '../lib/securestore.js';

// 공용 PC 모드: 로그인 정보를 이 탭(sessionStorage)에만 두고, 캐시는 메모리에만 둔다. 탭을 닫으면 사라진다.
const PUBLIC_KEY = 'sn:dropbox:public';
export const isPublicMode = () => sessionStorage.getItem(PUBLIC_KEY) === '1';
let memCache = {};
const readSession = () => (isPublicMode() ? sessionStorage.getItem('sn:dropbox') : sget('sn:dropbox'));
const writeSession = (v) => (isPublicMode() ? sessionStorage.setItem('sn:dropbox', v) : sset('sn:dropbox', v));

export const DROPBOX_APP_KEY = import.meta.env?.VITE_DROPBOX_APP_KEY || 'r774qv1d7hq5fl6';
const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const REVOKE_URL = 'https://api.dropboxapi.com/2/auth/token/revoke';
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

const SESSION_KEY = 'sn:dropbox';
const PKCE_KEY = 'sn:dropbox:pkce';
const CACHE_KEY = 'sn:dropbox:cache';
const TOKEN_SKEW_MS = 60_000;
const PARALLEL = 6;

// ---------- PKCE (pdf-ink 에서 가져옴) ----------
function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const makeVerifier = () => base64url(crypto.getRandomValues(new Uint8Array(64)));
async function challengeFor(v) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));
}
/** 리디렉트 주소: 앱이 열린 주소 (예: https://progh2.github.io/nanalnote/) — App Console 에 등록되어 있어야 함 */
export function redirectUri(loc = location) {
  return loc.origin + loc.pathname.replace(/index\.html$/, '');
}
/** 드롭박스 헤더는 ASCII 만 허용하므로 한글 경로를 \uXXXX 로 이스케이프 */
export const asciiHeader = (v) => String(v).replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);

function sessionFromToken(p, prev = null) {
  if (!p?.access_token) return null;
  return {
    accessToken: p.access_token,
    refreshToken: p.refresh_token || prev?.refreshToken || '',
    expiresAt: Date.now() + (Number(p.expires_in) || 0) * 1000,
    accountId: p.account_id || prev?.accountId || '',
  };
}

export function loadSession() {
  try { return JSON.parse(readSession() || 'null'); } catch { return null; }
}

/** 드롭박스 로그인 화면으로 이동 */
/** @param publicMode 공용 PC: 로그인 정보를 저장하지 않음 */
export async function startLogin(publicMode = false) {
  if (publicMode) sessionStorage.setItem(PUBLIC_KEY, '1'); else sessionStorage.removeItem(PUBLIC_KEY);
  const verifier = makeVerifier();
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    client_id: DROPBOX_APP_KEY, response_type: 'code', code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256', redirect_uri: redirectUri(), token_access_type: 'offline', state,
  });
  location.assign(`${AUTH_URL}?${params}`);
}

/** 로그인 후 돌아왔을 때 ?code= 를 토큰으로 교환. 처리했으면 true */
export async function completeLogin() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code'), state = q.get('state'), err = q.get('error');
  if (!code && !err) return false;
  const pk = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
  sessionStorage.removeItem(PKCE_KEY);
  history.replaceState(null, '', redirectUri()); // 주소창에서 code 즉시 제거
  if (err) throw new Error(`드롭박스 연결이 취소되었습니다 (${q.get('error_description') || err}).`);
  if (!pk || pk.state !== state) throw new Error('드롭박스 로그인 상태가 맞지 않습니다. 다시 시도해 주세요.');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: DROPBOX_APP_KEY, code_verifier: pk.verifier, redirect_uri: redirectUri() }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`드롭박스 토큰 발급 실패: ${j.error_description || j.error || res.status}`);
  writeSession(JSON.stringify(sessionFromToken(j)));
  return true;
}

/** 연결 끊기: 토큰 폐기 + 이 브라우저의 세션·캐시 삭제 */
export async function logout() {
  const s = loadSession();
  sdel(SESSION_KEY);
  sdel(CACHE_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(PUBLIC_KEY);
  memCache = {};
  if (s?.accessToken) await fetch(REVOKE_URL, { method: 'POST', headers: { Authorization: `Bearer ${s.accessToken}` } }).catch(() => {});
}

// ---------- 백엔드 ----------
let idSeq = 0;
const makeId = () => `d_${(idSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export class DropboxBackend {
  constructor() {
    this.name = 'dropbox';
    this.label = '드롭박스 (Apps 폴더, 마크다운 파일)';
    this.session = loadSession();
    this.years = new Map(); // year -> { data, files: Map<lowerPath, {path, rev, text}> }
    this.force = new Set(); // 충돌 알림 후 다음 저장 때 덮어쓸 경로
  }

  get connected() { return !!this.session?.refreshToken || !!this.session?.accessToken; }

  async token() {
    if (!this.session) throw new Error('드롭박스에 연결되어 있지 않습니다. 설정에서 [드롭박스 연결]을 눌러 주세요.');
    if (Number(this.session.expiresAt || 0) - TOKEN_SKEW_MS > Date.now()) return this.session.accessToken;
    if (!this.session.refreshToken) throw new Error('드롭박스 로그인이 만료되었습니다. 다시 연결해 주세요.');
    const res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.session.refreshToken, client_id: DROPBOX_APP_KEY }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`드롭박스 로그인 갱신 실패 (${j.error_description || res.status}). 다시 연결해 주세요.`);
    this.session = sessionFromToken(j, this.session);
    writeSession(JSON.stringify(this.session));
    return this.session.accessToken;
  }

  async rpc(endpoint, body) {
    const res = await fetch(`${API}/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error_summary || `Dropbox ${res.status}`); e.status = res.status; e.body = j; throw e; }
    return j;
  }

  async account() { return this.rpc('users/get_current_account', null); }

  async listYear(year) {
    const out = [];
    try {
      let r = await this.rpc('files/list_folder', { path: yearDir(year), recursive: true, limit: 2000 });
      out.push(...r.entries);
      while (r.has_more) { r = await this.rpc('files/list_folder/continue', { cursor: r.cursor }); out.push(...r.entries); }
    } catch (e) {
      if (e.status === 409 && /not_found/.test(e.body?.error_summary || '')) return [];
      throw e;
    }
    return out.filter((x) => x['.tag'] === 'file' && /\.md$/i.test(x.name));
  }

  async download(path) {
    const res = await fetch(`${CONTENT}/files/download`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Dropbox-API-Arg': asciiHeader(JSON.stringify({ path })) },
    });
    if (!res.ok) throw new Error(`파일을 받지 못했습니다: ${path} (${res.status})`);
    return res.text();
  }

  async upload(path, text, rev) {
    const res = await fetch(`${CONTENT}/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': asciiHeader(JSON.stringify({ path, mode: rev ? { '.tag': 'update', update: rev } : { '.tag': 'add' }, autorename: false, mute: true, strict_conflict: true })),
      },
      body: new TextEncoder().encode(text),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const conflict = res.status === 409 && /conflict/.test(j.error_summary || '');
      const e = new Error(conflict ? 'conflict' : j.error_summary || `업로드 실패 ${res.status}`);
      e.conflict = conflict;
      throw e;
    }
    return j; // metadata (rev)
  }

  readCache() {
    if (isPublicMode()) return memCache;
    try { return JSON.parse(sget(CACHE_KEY) || '{}'); } catch { return {}; }
  }
  writeCache(cache) {
    if (isPublicMode()) { memCache = cache; return; }
    try { sset(CACHE_KEY, JSON.stringify(cache)); } catch { sdel(CACHE_KEY); }
  }

  async loadYear(year) {
    const entries = await this.listYear(year);
    const cache = this.readCache();
    const files = new Map();
    // 바뀐 파일만 내려받기 (rev 가 같으면 캐시 사용)
    await pool(entries, PARALLEL, async (e) => {
      const key = e.path_lower;
      let text = cache[key]?.rev === e.rev ? cache[key].text : null;
      if (text == null) { text = await this.download(e.path_lower); cache[key] = { rev: e.rev, text }; }
      files.set(key, { path: e.path_display, rev: e.rev, text });
    });
    // 이 학년도에서 사라진 캐시 정리
    const prefix = yearDir(year).toLowerCase() + '/';
    for (const k of Object.keys(cache)) if (k.startsWith(prefix) && !files.has(k)) delete cache[k];
    this.writeCache(cache);
    const data = parse(year, new Map([...files.values()].map((f) => [f.path, f.text])), makeId);
    this.years.set(year, { data, files });
    return JSON.parse(JSON.stringify(data));
  }

  async applyOps(year, ops) {
    if (!this.years.has(year)) await this.loadYear(year);
    const y = this.years.get(year);
    const results = ops.map(() => ({ ok: true }));
    const opPaths = [];
    // 1) 메모리 모델에 반영
    ops.forEach((op, i) => {
      const list = y.data[op.col];
      if (!list) { results[i] = { ok: false, error: `알 수 없는 항목: ${op.col}` }; opPaths.push(null); return; }
      if (op.op === 'delete') {
        const old = list.find((x) => x.id === op.id);
        opPaths.push(old ? pathOf(year, op.col, old).toLowerCase() : null);
        y.data[op.col] = list.filter((x) => x.id !== op.id);
      } else {
        const item = { ...op.item };
        if (String(item.id || '').startsWith('n_')) item.id = makeId();
        const k = list.findIndex((x) => x.id === item.id);
        const old = k >= 0 ? list[k] : null;
        if (k >= 0) list[k] = item; else list.push(item);
        // 날짜가 바뀐 항목은 이전 파일도 다시 써야 하지만, 경로는 직렬화 비교로 자동 처리된다
        opPaths.push(pathOf(year, op.col, item).toLowerCase());
        if (old && pathOf(year, op.col, old) !== pathOf(year, op.col, item)) opPaths[opPaths.length - 1] = null;
        results[i] = { ok: true, id: item.id };
      }
    });

    // 2) 직렬화해서 바뀐 파일만 업로드, 비게 된 파일은 삭제
    const next = serialize(year, y.data);
    const nextLower = new Map([...next].map(([p, t]) => [p.toLowerCase(), { path: p, text: t }]));
    const failed = new Map(); // lowerPath -> error
    const cache = this.readCache();
    const uploads = [...nextLower].filter(([k, f]) => y.files.get(k)?.text !== f.text);
    await pool(uploads, PARALLEL, async ([k, f]) => {
      const cur = y.files.get(k);
      try {
        let meta;
        if (this.force.has(k)) {
          const res = await fetch(`${CONTENT}/files/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': asciiHeader(JSON.stringify({ path: f.path, mode: { '.tag': 'overwrite' }, mute: true })) },
            body: new TextEncoder().encode(f.text),
          });
          meta = await res.json();
          if (!res.ok) throw new Error(meta.error_summary || `업로드 실패 ${res.status}`);
          this.force.delete(k);
        } else meta = await this.upload(cur?.path || f.path, f.text, cur?.rev);
        y.files.set(k, { path: meta.path_display || f.path, rev: meta.rev, text: f.text });
        cache[k] = { rev: meta.rev, text: f.text };
      } catch (e) {
        if (e.conflict) {
          this.force.add(k);
          failed.set(k, `다른 기기에서 먼저 수정된 파일이라 저장하지 않았습니다 (${f.path}). 새로고침하면 다른 기기의 내용을 불러오고, 한 번 더 저장하면 이 기기 내용으로 덮어씁니다.`);
        } else failed.set(k, e.message);
      }
    });
    // 앱이 관리하는 파일(고정 파일 5개 + 일지)만 삭제 대상. 사용자가 따로 둔 .md 는 건드리지 않는다.
    const fixed = new Set(Object.values(FILES).map((f) => `${yearDir(year)}/${f}`.toLowerCase()));
    const managed = (k) => fixed.has(k) || /\/일지\/\d{4}-\d{2}-\d{2}\.md$/.test(k);
    const removals = [...y.files.keys()].filter((k) => managed(k) && !nextLower.has(k));
    await pool(removals, PARALLEL, async (k) => {
      try {
        await this.rpc('files/delete_v2', { path: y.files.get(k).path });
        y.files.delete(k); delete cache[k];
      } catch (e) {
        if (/not_found/.test(e.body?.error_summary || '')) { y.files.delete(k); delete cache[k]; }
        else failed.set(k, e.message);
      }
    });
    this.writeCache(cache);

    // 3) 실패한 파일에 속한 작업은 실패로 보고 (store 가 '저장 안 됨' 상태를 유지)
    if (failed.size) {
      const anyErr = [...failed.values()][0];
      ops.forEach((op, i) => {
        const p = opPaths[i];
        if (p == null ? true : failed.has(p)) results[i] = { ok: false, error: p ? failed.get(p) : anyErr };
      });
    }
    return results;
  }

  holidayFetcher() { return null; }

  // ---------- 파일: {학년도}학년도/{폴더}/{이름} (학생 사진, 학사일정 자료) ----------
  filePath(year, folder, name) { return `${yearDir(year)}/${folder}/${name}`; }

  async putFile(year, folder, name, blob) {
    const path = this.filePath(year, folder, name);
    const res = await fetch(`${CONTENT}/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': asciiHeader(JSON.stringify({ path, mode: { '.tag': 'overwrite' }, mute: true })) },
      body: blob,
    });
    if (!res.ok) throw new Error(`파일 업로드 실패 (${res.status})`);
    this.fileUrls ||= new Map();
    this.fileUrls.set(path.toLowerCase(), URL.createObjectURL(blob));
    return name;
  }

  async fileUrl(year, folder, name) {
    if (!name) return null;
    const path = this.filePath(year, folder, name);
    this.fileUrls ||= new Map();
    const k = path.toLowerCase();
    if (this.fileUrls.has(k)) return this.fileUrls.get(k);
    const res = await fetch(`${CONTENT}/files/download`, { method: 'POST', headers: { Authorization: `Bearer ${await this.token()}`, 'Dropbox-API-Arg': asciiHeader(JSON.stringify({ path })) } });
    if (!res.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    this.fileUrls.set(k, url);
    return url;
  }

  async deleteFile(year, folder, name) {
    if (!name) return;
    const path = this.filePath(year, folder, name);
    await this.rpc('files/delete_v2', { path }).catch(() => {});
    this.fileUrls?.delete(path.toLowerCase());
  }

  // 학생 사진: 사진/학번_이름.jpg
  async savePhoto(year, student, blob) {
    const name = `${safeName(student.studentNo ? `${student.studentNo}_${student.name}` : student.name)}.jpg`;
    await this.putFile(year, '사진', name, blob);
    if (student.photo && student.photo !== name) await this.deleteFile(year, '사진', student.photo);
    return name;
  }
  photoUrl(year, student) { return this.fileUrl(year, '사진', student?.photo); }
  deletePhoto(year, student) { return this.deleteFile(year, '사진', student?.photo); }
}
