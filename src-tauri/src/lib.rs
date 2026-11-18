// 나날노트 데스크톱 앱 (Windows · macOS · Linux)
//
// - 웹앱(dist)을 그대로 띄운다.
// - 포터블 모드: 실행 파일(또는 .app / AppImage) 옆에 `portable.txt` 가 있으면
//   자료(나날노트자료)와 웹뷰 저장소(설정·잠금 정보)를 모두 그 폴더 안에 둔다 → USB 에 넣고 다닐 수 있다.
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize, Clone)]
struct AppPaths {
    portable: bool,
    /// 실행 파일이 놓인 폴더 (macOS 는 .app 이 놓인 폴더, Linux AppImage 는 AppImage 파일이 놓인 폴더)
    base_dir: String,
    /// 자료(마크다운·사진·문서)를 둘 기본 폴더
    default_data_dir: String,
}

/// 실행 파일이 놓인 "사용자에게 보이는" 폴더
fn base_dir() -> PathBuf {
    // Linux AppImage: 실행 중에는 임시 마운트 경로이므로 AppImage 파일 위치를 쓴다
    if let Some(p) = std::env::var_os("APPIMAGE") {
        if let Some(parent) = PathBuf::from(p).parent() {
            return parent.to_path_buf();
        }
    }
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    // macOS: 나날노트.app/Contents/MacOS/나날노트 → .app 이 놓인 폴더
    if cfg!(target_os = "macos") {
        if let Some(app_dir) = dir.ancestors().find(|p| p.extension().map(|e| e == "app").unwrap_or(false)) {
            if let Some(parent) = app_dir.parent() {
                return parent.to_path_buf();
            }
        }
    }
    dir
}

fn is_portable(base: &PathBuf) -> bool {
    base.join("portable.txt").exists()
}

fn compute_paths(app: &tauri::AppHandle) -> AppPaths {
    let base = base_dir();
    let portable = is_portable(&base);
    let data = if portable {
        base.join("나날노트자료")
    } else {
        app.path()
            .document_dir()
            .map(|d| d.join("나날노트"))
            .unwrap_or_else(|_| base.join("나날노트자료"))
    };
    AppPaths {
        portable,
        base_dir: base.to_string_lossy().into_owned(),
        default_data_dir: data.to_string_lossy().into_owned(),
    }
}

/// 웹 화면에서 부른다: 포터블 여부와 기본 자료 폴더
#[tauri::command]
fn app_paths(app: tauri::AppHandle) -> AppPaths {
    compute_paths(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![app_paths])
        .setup(|app| {
            let paths = compute_paths(app.handle());
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("나날노트")
                .inner_size(1280.0, 860.0)
                .min_inner_size(360.0, 560.0);
            if paths.portable {
                // 설정·잠금 정보 같은 웹 저장소도 USB 안에 (Windows·Linux 에서 지원)
                let webview_dir = PathBuf::from(&paths.base_dir).join("나날노트자료").join(".webview");
                let _ = std::fs::create_dir_all(&webview_dir);
                builder = builder.data_directory(webview_dir);
            }
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("나날노트를 시작하지 못했습니다");
}
