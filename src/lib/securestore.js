// 민감 정보 저장소: 잠금(PIN)이 켜져 있으면 암호화해서 localStorage 에 쓰고, 풀린 동안은 메모리에서 읽는다.
// 읽기·쓰기는 동기 API(localStorage 와 같은 모양), 실제 암호화 쓰기는 순서대로 비동기 처리한다.
import { vaultEnabled, isUnlocked, encryptString, decryptString } from './vault.js';

const SENSITIVE = [/^sn:config$/, /^sn:dropbox$/, /^sn:dropbox:cache$/, /^sn:data:\d{4}$/, /^sn:ai$/];
export const isSensitive = (k) => SENSITIVE.some((r) => r.test(k));

const mem = new Map();
let chain = Promise.resolve();
const queue = (fn) => (chain = chain.then(fn).catch((e) => console.warn('암호화 저장 실패', e)));

const protectedMode = () => vaultEnabled();

export function sget(k) {
  if (!isSensitive(k) || !protectedMode()) return localStorage.getItem(k);
  return mem.has(k) ? mem.get(k) : null;
}

export function sset(k, v) {
  if (!isSensitive(k) || !protectedMode()) {
    try { localStorage.setItem(k, v); } catch (e) { if (k === 'sn:dropbox:cache') localStorage.removeItem(k); else throw e; }
    return;
  }
  mem.set(k, v);
  queue(async () => {
    if (!isUnlocked() || mem.get(k) !== v) return; // 더 새 값이 대기 중이면 건너뜀
    const ct = await encryptString(v);
    try { localStorage.setItem(k, ct); } catch { if (k === 'sn:dropbox:cache') localStorage.removeItem(k); }
  });
}

export function sdel(k) { mem.delete(k); localStorage.removeItem(k); }

/** 민감 키 목록 (키 이름은 비밀이 아님) */
export function sensitiveKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (isSensitive(k)) out.push(k); }
  return out;
}

/** 잠금 해제 직후: 저장된 값을 풀어서 메모리에 올린다. 아직 평문인 값은 암호화해서 다시 쓴다(처음 PIN 설정 시 이전). */
export async function loadAll() {
  mem.clear();
  for (const k of sensitiveKeys()) {
    const v = localStorage.getItem(k);
    if (v == null) continue;
    try {
      const plain = await decryptString(v);
      mem.set(k, plain);
      if (!v.startsWith('enc1:')) sset(k, plain);
    } catch {
      // 풀 수 없는 값(다른 키로 암호화된 값)은 버린다
      localStorage.removeItem(k);
    }
  }
  await flush();
}

/** 잠금을 끌 때: 메모리의 평문을 다시 그대로 저장 */
export async function decryptAllToPlain() {
  await flush();
  for (const [k, v] of mem) localStorage.setItem(k, v);
  mem.clear();
}

export const flush = () => chain;
export const memClear = () => mem.clear();
