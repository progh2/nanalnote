// 데스크톱 앱(Tauri)에서만 쓰는 기능: 포터블 여부, 폴더 고르기, 파일 저장 창, 바깥 링크 열기
// 웹에서는 이 모듈의 함수들이 아무것도 하지 않는다. (Tauri 패키지는 필요할 때만 불러온다)

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let pathsCache = null;
/** { portable, base_dir, default_data_dir } */
export async function appPaths() {
  if (!isDesktop()) return null;
  if (pathsCache) return pathsCache;
  const { invoke } = await import('@tauri-apps/api/core');
  pathsCache = await invoke('app_paths');
  return pathsCache;
}

/** 포터블은 드라이브 문자가 바뀌어도(USB) 되도록 '@portable' 로 저장해 두고 실행할 때 실제 경로로 바꾼다 */
export const PORTABLE_FOLDER = '@portable';
export async function resolveFolder(folder) {
  if (folder === PORTABLE_FOLDER || !folder) return (await appPaths())?.default_data_dir || '';
  return folder;
}

export async function pickFolder(defaultPath) {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const dir = await open({ directory: true, multiple: false, defaultPath, title: '나날노트 자료 폴더 고르기' });
  return typeof dir === 'string' ? dir : null;
}

/** 데스크톱에서는 내려받기 대신 "다른 이름으로 저장" 창 */
export async function saveBlobDesktop(blob, filename) {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const path = await save({ defaultPath: filename, title: '저장할 곳 고르기' });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}

/** 바깥 링크(블로그, GitHub 등)는 기본 브라우저로 */
export function installDesktopHooks() {
  if (!isDesktop()) return;
  document.addEventListener('click', async (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      e.preventDefault();
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      openUrl(href).catch(() => {});
    } else if (/^blob:/i.test(href) && a.target === '_blank') {
      e.preventDefault(); // 앱 안에서는 새 창을 열 수 없으므로 무시 (이미지는 화면에 이미 보임)
    }
  }, true);
}
