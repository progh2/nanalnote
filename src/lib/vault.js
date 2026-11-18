// 이 기기 잠금: PIN(6자리) / 패스키(지문·얼굴·Windows Hello)로 여는 데이터 키
//
// - 무작위 데이터 키(AES-GCM 256)로 이 브라우저에 저장되는 민감 정보(드롭박스 로그인, 캐시, 로컬 데이터, 사진)를 암호화한다.
// - 데이터 키는 PIN 에서 만든 키(PBKDF2-SHA256)로 감싸서(wrap) 저장한다. 패스키는 WebAuthn PRF 확장으로 얻은 비밀로 한 번 더 감싼다.
// - 앱 코드가 공개되어 있어도 PIN(또는 패스키) 없이는 저장된 정보를 풀 수 없다.
//   단, 6자리 PIN 은 경우의 수가 100만 개라 기기를 통째로 가져간 공격자의 오프라인 대입을 오래 버티지는 못한다(PBKDF2 로 느리게 할 뿐).

const META = 'sn:vault';
const ITER = 310000;
const enc8 = new TextEncoder();
const dec8 = new TextDecoder();

const b64 = (buf) => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

let dataKey = null; // CryptoKey (AES-GCM)
let rawKey = null; // Uint8Array — 패스키 등록 때 다시 감싸기 위해 열려 있는 동안만 보관

const meta = () => { try { return JSON.parse(localStorage.getItem(META) || 'null'); } catch { return null; } };
const saveMeta = (m) => localStorage.setItem(META, JSON.stringify(m));

export const vaultEnabled = () => !!meta();
export const isUnlocked = () => !!dataKey;
export const hasPasskey = () => !!meta()?.passkey;

async function aesKey(raw, usages = ['encrypt', 'decrypt']) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);
}
async function pinKey(pin, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc8.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key, bytes) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv); out.set(new Uint8Array(ct), 12);
  return out;
}
async function open(key, bytes) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
}

async function useRaw(raw) {
  rawKey = raw;
  dataKey = await aesKey(raw);
}

export const validPin = (pin) => /^\d{6}$/.test(pin);

/** 처음 PIN 설정 (새 데이터 키 생성) */
export async function setupPin(pin) {
  if (!validPin(pin)) throw new Error('PIN 은 숫자 6자리여야 합니다.');
  const raw = rand(32);
  const salt = rand(16);
  const wrapped = await seal(await pinKey(pin, salt, ITER), raw);
  saveMeta({ v: 1, iter: ITER, salt: b64(salt), wrapped: b64(wrapped) });
  await useRaw(raw);
}

/** PIN 으로 열기. 틀리면 예외 */
export async function unlockPin(pin) {
  const m = meta();
  if (!m) throw new Error('잠금이 설정되어 있지 않습니다.');
  try {
    const raw = await open(await pinKey(pin, unb64(m.salt), m.iter), unb64(m.wrapped));
    await useRaw(raw);
  } catch {
    throw new Error('PIN 이 맞지 않습니다.');
  }
}

/** PIN 바꾸기 (열려 있어야 함, 데이터 키는 그대로) */
export async function changePin(pin) {
  if (!rawKey) throw new Error('먼저 잠금을 풀어 주세요.');
  if (!validPin(pin)) throw new Error('PIN 은 숫자 6자리여야 합니다.');
  const m = meta();
  const salt = rand(16);
  m.salt = b64(salt); m.iter = ITER;
  m.wrapped = b64(await seal(await pinKey(pin, salt, ITER), rawKey));
  saveMeta(m);
}

export function lockNow() { dataKey = null; rawKey = null; }

/** 잠금 해제 정보 삭제 (암호화된 값은 더 이상 풀 수 없게 됨) */
export function removeVault() { localStorage.removeItem(META); lockNow(); }

// ---------- 암호화 도우미 ----------
export async function encryptString(s) { return 'enc1:' + b64(await seal(dataKey, enc8.encode(s))); }
export async function decryptString(s) {
  if (!String(s).startsWith('enc1:')) return s;
  return dec8.decode(await open(dataKey, unb64(s.slice(5))));
}
export async function encryptBytes(buf) { return seal(dataKey, new Uint8Array(buf)); }
export async function decryptBytes(buf) { return open(dataKey, new Uint8Array(buf)); }

// ---------- 패스키 (WebAuthn PRF) ----------
export function passkeyAvailable() {
  return !!(window.PublicKeyCredential && navigator.credentials?.create);
}

async function prfKey(prfOut) {
  const digest = await crypto.subtle.digest('SHA-256', prfOut);
  return aesKey(digest);
}

/** 지문·얼굴·Windows Hello 등록 (PIN 으로 열린 상태에서) */
export async function registerPasskey() {
  if (!rawKey) throw new Error('먼저 PIN 으로 잠금을 풀어 주세요.');
  if (!passkeyAvailable()) throw new Error('이 브라우저는 패스키를 지원하지 않습니다.');
  const prfSalt = rand(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: '나날노트' },
      user: { id: rand(16), name: 'nanalnote', displayName: '나날노트 (이 기기)' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      extensions: { prf: { eval: { first: prfSalt } } },
      timeout: 60000,
    },
  });
  let out = cred.getClientExtensionResults?.().prf;
  if (!out?.enabled && !out?.results?.first) throw new Error('이 기기·브라우저는 패스키로 암호를 여는 기능(PRF)을 지원하지 않습니다. PIN 을 사용하세요.');
  let first = out.results?.first;
  if (!first) first = await prfFromGet(cred.rawId, prfSalt); // 일부 브라우저는 등록 때 결과를 주지 않음
  const m = meta();
  m.passkey = { id: b64(cred.rawId), salt: b64(prfSalt), wrapped: b64(await seal(await prfKey(first), rawKey)) };
  saveMeta(m);
}

async function prfFromGet(rawId, prfSalt) {
  const a = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: rawId }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: prfSalt } } },
      timeout: 60000,
    },
  });
  const first = a.getClientExtensionResults?.().prf?.results?.first;
  if (!first) throw new Error('이 기기·브라우저는 패스키로 암호를 여는 기능(PRF)을 지원하지 않습니다. PIN 을 사용하세요.');
  return first;
}

export async function unlockPasskey() {
  const pk = meta()?.passkey;
  if (!pk) throw new Error('등록된 패스키가 없습니다.');
  const first = await prfFromGet(unb64(pk.id), unb64(pk.salt));
  try {
    await useRaw(await open(await prfKey(first), unb64(pk.wrapped)));
  } catch {
    throw new Error('패스키로 열 수 없습니다. PIN 을 사용하세요.');
  }
}

export function removePasskey() { const m = meta(); if (m) { delete m.passkey; saveMeta(m); } }
