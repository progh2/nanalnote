// 사진: 올리기 전에 알맞게 줄여 저장 용량과 전송량을 줄인다.
// - 학생·사람 사진: 긴 쪽 최대 400px JPEG (화면에서 96px 로 보여도 선명하게)
// - 기관 로고: 긴 쪽 최대 320px PNG (투명 배경 유지)
export const PHOTO_SIZE = 400;
export const LOGO_SIZE = 320;

export async function resizeImage(file, max = PHOTO_SIZE, quality = 0.85, type = 'image/jpeg') {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`이미지를 읽을 수 없습니다: ${file.name || '붙여 넣은 그림'}`)); i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
    const g = c.getContext('2d');
    if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); } // 투명 PNG 를 JPEG 로 바꿀 때 검게 되지 않게
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, type, quality));
  } finally { URL.revokeObjectURL(url); }
}

/** 붙여넣기·끌어다 놓기에서 그림 파일 꺼내기 */
export function imageFromTransfer(dt) {
  for (const it of dt?.items || []) if (it.kind === 'file' && it.type.startsWith('image/')) return it.getAsFile();
  for (const f of dt?.files || []) if (f.type.startsWith('image/')) return f;
  return null;
}

/** [붙여넣기] 단추: 클립보드의 그림 읽기 (브라우저가 허락을 물을 수 있음) */
export async function readClipboardImage() {
  if (!navigator.clipboard?.read) throw new Error('이 브라우저는 단추로 붙여넣기를 지원하지 않습니다. 사진 칸을 누른 뒤 Ctrl+V 해 주세요.');
  const items = await navigator.clipboard.read();
  for (const it of items) {
    const t = it.types.find((x) => x.startsWith('image/'));
    if (t) { const b = await it.getType(t); return new File([b], `붙여넣기.${t.split('/')[1] || 'png'}`, { type: t }); }
  }
  throw new Error('클립보드에 그림이 없습니다. 사진을 복사(캡처)한 뒤 다시 해 보세요.');
}

/** 파일 이름에 쓸 수 없는 문자 제거 */
export const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim() || '학생';

// ---------- IndexedDB (로컬 저장소용, 잠금이 켜져 있으면 암호화) ----------
import { vaultEnabled, isUnlocked, encryptBytes, decryptBytes } from './vault.js';
let dbp;
function db() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('sammynote', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('photos', mode);
    const req = fn(t.objectStore('photos'));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}
export async function idbPut(key, blob) {
  let val = blob;
  if (vaultEnabled() && isUnlocked()) val = { enc: 1, type: blob.type, data: await encryptBytes(await blob.arrayBuffer()) };
  return tx('readwrite', (s) => s.put(val, key));
}
export async function idbGet(key) {
  const v = await tx('readonly', (s) => s.get(key));
  if (v && v.enc) return new Blob([await decryptBytes(v.data)], { type: v.type });
  return v;
}
export const idbDel = (key) => tx('readwrite', (s) => s.delete(key));
