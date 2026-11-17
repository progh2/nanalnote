# 쌔미노트 Web

교사수첩 프로그램 **[쌔미노트](https://blog.naver.com/powertruth)**(Windows용)의 기능을 웹으로 옮긴 버전입니다.
여러 디자인 테마를 고를 수 있고, 데이터는 **드롭박스에 마크다운(.md) 파일**로 저장합니다.

**앱 주소: <https://progh2.github.io/sammynote/>**
PC와 휴대폰 모두 쓸 수 있고, 휴대폰은 "홈 화면에 추가"로 앱처럼 설치할 수 있습니다.

```
브라우저 (GitHub Pages)  ──PKCE 로그인──►  Dropbox  Apps/<앱 폴더>/2026학년도/*.md
                         (서버 없음, 로그인 정보는 이 브라우저에만)
```

저장소는 세 가지 중에서 고릅니다.

| 저장소 | 설명 |
|---|---|
| **드롭박스 (추천)** | 학년도별 마크다운 파일. 메모장·Obsidian 으로 열리고, Claude(드롭박스 커넥터)가 그대로 읽을 수 있음 |
| 이 브라우저(로컬) | 설치 없이 바로 체험. 이 브라우저에만 저장 |
| 노션 (고급) | Cloudflare Worker 중계가 필요. 노션 데이터베이스 9개에 저장 |

## 드롭박스 저장 형식

```
Apps/<앱 폴더>/2026학년도/
  설정.md            교원정보·학교급·기본 시간표
  학생명단.md         | 번호 | 이름 |
  학사일정.md         - 2026-03-02: 입학식
  업무일지.md         - [x] 가정통신문 배부 (작성 2026-03-02, 완료 2026-03-04)
  학급요록.md         ## 독서록 / - 등록: / - 완료: / | 학생 | 내용 |
  일지/2026-03-02.md  하루치 수업일지·학생출결·상담일지
```

- 형식만 지키면 파일을 직접 고쳐도 됩니다. 일지 파일에 직접 추가한 `## 메모` 같은 다른 단락은 앱이 지우지 않고 그대로 둡니다.
- 일지는 하루에 파일 하나라서, 여러 기기에서 써도 겹칠 일이 적습니다.
- 다른 기기에서 먼저 고친 파일은 **덮어쓰지 않고 알려 줍니다.**
  새로고침하면 그 내용을 불러오고, 한 번 더 저장하면 지금 기기의 내용으로 덮어씁니다.
- 바뀐 파일만 내려받도록 이 브라우저에 캐시를 둡니다. [연결 끊기]를 누르면 로그인 정보와 캐시가 함께 지워집니다.

### 드롭박스 앱 설정 (개발자용, 한 번만)

[Dropbox App Console](https://www.dropbox.com/developers/apps) 에서 앱을 다음과 같이 설정합니다.
- 종류: Scoped access, **App folder**
- Permissions: `files.metadata.read`, `files.content.read`, `files.content.write`
- Redirect URIs: `https://progh2.github.io/sammynote/`, `http://localhost:5173/`
- Allow public clients (PKCE): **Allow**

App key는 공개값이라 `src/backends/dropbox.js` 에 기본값으로 들어 있습니다.
`VITE_DROPBOX_APP_KEY` 환경변수로 바꿀 수 있습니다. App secret은 쓰지 않습니다.

## 기능 (원본 쌔미노트 대응)

| 원본 기능 | 웹 버전 |
|---|---|
| 학사일정 일괄등록 / 날짜별 조회·수정 | ✅ CSV 업로드(엑셀 CP949·UTF-8 모두 지원), 교사수첩에서 편집 |
| 수업일지 (기본 시간표 → 당일만 변경) | ✅ 초등 6교시(과목) / 중·고 8교시(학반·교실) |
| 업무일지 (작성일~완료일까지 표시, 일괄 완료) | ✅ Enter로 다음 줄, 전체 완료 체크 |
| 학생 상담 일지 (`이름␣` 인식, 빈 줄로 단락 구분, 이름 클릭 → 모아보기) | ✅ 기본은 **가리기** 상태 (학생 노출 방지) |
| 학생출결상황 + 보고서 모아보기 | ✅ 학생별·구분별 집계, 사유 내역 |
| 학급요록 (완료 전까지 계속 표시, 제목 자동 채번, 같은 제목 모아보기) | ✅ |
| 특일정보 (국경일·공휴일·기념일·24절기) | ✅ 공공데이터 API(선택), 없으면 내장 데이터 |
| 캘린더 (특일·학사일정, 더블클릭으로 이동) | ✅ 작성 표시(수업·상담·출결 점) |
| 오늘 일지 인쇄 / Word 다운로드 (최종수정일시 꼬리말) | ✅ `.docx` (한컴오피스에서도 열림) |
| 기간지정 다운로드 (기본 전월, 완료 업무만 / 미완료 포함 옵션) | ✅ |
| 학년도 자동 전환(3월 1일) / 과거 학년도 열람 | ✅ 학년도별로 따로 저장 |
| 저장 버튼 + Ctrl+S, 저장 안 한 변경 확인 | ✅ 꾹 눌러도 한 번만 저장 |
| 표 드래그 복사 → 엑셀 붙여넣기 | ✅ 일반 HTML 표 |
| 포터블 / 여러 PC 사용 | ✅ 웹이므로 어디서나 (드롭박스·노션 저장 시), 휴대폰 홈 화면 설치 |
| — | ➕ 테마 8종, 모바일 화면, JSON 백업·복원, 로컬→노션 이전 |

## 개발

### 로컬 실행

노션 없이도 동작합니다. 데이터는 **브라우저(localStorage)** 에 저장됩니다.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 단위 테스트
```

## 노션 저장소 (고급)

### 노션 준비

1. <https://www.notion.so/my-integrations> 에서 **새 통합(Internal integration)** 을 만들고 **시크릿**(`ntn_…`)을 복사합니다.
2. 노션에 데이터를 둘 빈 페이지(예: `쌔미노트 데이터`)를 만듭니다.
   페이지 오른쪽 위 `⋯` → **연결(Connections)** 에서 방금 만든 통합을 추가합니다.
3. 페이지 주소의 마지막 32자리가 **페이지 ID** 입니다.
   `https://www.notion.so/쌔미노트-데이터-`**`1a2b3c…`**

앱의 **[노션 DB 만들기]** 를 누르면 이 페이지 아래에 데이터베이스 9개가 만들어집니다.
학생, 학사일정, 교사수첩, 수업일지, 업무일지, 학생출결, 상담일지, 학급요록, 설정입니다.
노션에서 직접 보고 필터링·수정해도 앱에 반영됩니다. 예를 들어 상담일지 DB는 `학생` 속성으로 필터할 수 있습니다.

### Cloudflare Worker 배포 (무료)

```bash
cd worker
npx wrangler login
# wrangler.toml 의 ALLOWED_ORIGIN 을 내 GitHub Pages 주소로 수정 (예: https://아이디.github.io)
npx wrangler secret put NOTION_TOKEN      # 노션 통합 시크릿
npx wrangler secret put NOTION_PARENT     # 노션 페이지 ID
npx wrangler secret put APP_PASSWORD      # 웹앱 접속 비밀번호 (길게!)
npx wrangler secret put DATA_GO_KR_KEY    # (선택) 공공데이터포털 '한국천문연구원_특일 정보' 서비스키
npx wrangler deploy                       # → https://sammynote-worker.<계정>.workers.dev
```

로컬 테스트용 설정은 `worker/.dev.vars.example` 을 `.dev.vars` 로 복사해 채운 뒤 `npx wrangler dev` 로 실행합니다.

## GitHub Pages 배포

1. 이 폴더를 GitHub 저장소로 올립니다.
2. 저장소 **Settings → Pages → Source: GitHub Actions** 를 선택합니다.
3. `main` 브랜치에 push 하면 `.github/workflows/deploy.yml` 이 테스트·빌드 후 자동 배포합니다.

### 앱에서 노션 연결

**설정 → 저장소** 에 Worker 주소와 접속 비밀번호를 입력합니다.
그다음 **[연결 테스트] → [노션 DB 만들기] → [노션 사용하기]** 를 차례로 누릅니다.
로컬 모드로 쓰던 자료가 있으면 **[로컬 데이터를 노션으로 옮기기]** 를 누릅니다.

## 개인정보 주의

원본 쌔미노트는 개인정보보호법상 민감정보(상담 내역 등)를 다루기 때문에 교사 PC에만 저장했습니다.
웹 버전은 드롭박스나 노션(외부 클라우드)에 저장하므로 아래를 꼭 지켜 주세요.
- 쌔미노트 폴더나 노션 페이지를 다른 사람과 공유하지 마세요.
- Claude 같은 AI 커넥터에 연결하면 상담 내용이 그 서비스로 전달됩니다. 학교 지침을 먼저 확인하세요.
- `APP_PASSWORD` 는 길고 추측하기 어렵게 정하세요. 공용 PC에서는 사용 후 설정을 지우세요.
  저장소 설정과 비밀번호는 브라우저 localStorage 에 남습니다.
- 학생정보는 번호와 이름만 넣습니다. 학교·교육청의 정보보호 지침을 먼저 확인하세요.

## 구조

```
src/
  main.js              앱 셸(헤더·탭·저장·단축키)
  store.js             학년도 단위 상태 + 변경분(diff) 저장
  backends/local.js    localStorage 저장소
  backends/dropbox.js  드롭박스 저장소 (PKCE, rev 충돌 감지, 캐시)
  backends/notion.js   Worker 경유 노션 저장소
  views/               notebook(교사수첩) · students · reports · settings
  lib/mdformat.js      학년도 데이터 <-> 마크다운 파일 변환
  lib/                 counsel(상담 파싱) · holidays · export(docx) · util
  styles/themes.css    테마 (CSS 변수) — 블록 추가 + src/themes.js 등록으로 새 테마
worker/src/index.js    Cloudflare Worker (노션 스키마 매핑, 특일정보 중계)
tests/                 node --test 단위 테스트 (드롭박스·노션 API 모의 포함)
```
