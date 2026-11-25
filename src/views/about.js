// 소개 탭: 이 앱이 영감을 받은 원 쌔미노트 안내, 기능 비교, 만든 사람·문의
import { h } from '../lib/util.js';
import { APP_NAME, APP_SUB, ORIGINAL, REPO } from '../brand.js';
import { isDesktop } from '../lib/desktop.js';

const TITLE = [APP_NAME, APP_SUB].filter(Boolean).join(' ');

const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

// [항목, 원 쌔미노트, 이 웹 버전]
const ROWS = [
  ['실행 환경', 'Windows 프로그램 (설치 또는 포터블 실행파일)', '웹 브라우저 (PC·휴대폰·태블릿), 홈 화면에 설치 가능'],
  ['자료 저장', '내 PC 에만 저장 (USB·클라우드 폴더로 들고 다니기)', '이 브라우저 / 드롭박스(마크다운 파일) / 이 컴퓨터 폴더(데스크톱 앱) 중 선택'],
  ['학사일정 · 일괄 등록', '○ (CSV)', '○ (CSV, 휴업일·수능대비 표시) + 문서에서 AI 로 뽑아 넣기'],
  ['수업일지', '○ 기본 시간표, 그날만 바꾸기', '○ + 중·고 수업명·학반·교실, 일과 시간(시정표), 수능대비 시간표'],
  ['업무일지', '○ 완료 처리, 일괄 완료', '○ + 중요도, 마감일·D-day, 순서 바꾸기'],
  ['학생 상담 일지', '○ 이름 인식, 학생별 모아보기', '○ + 학번·동명이인 구분, 조사 인식, 이름 추천'],
  ['학생 출결', '○ 출결 모아보기', '○ + 수업별 출결, 빠진 시수 집계'],
  ['학급요록', '○', '○ + 대상 학반, 같은 요록 모아보기'],
  ['특일정보 · 캘린더', '○ 국경일·절기, 캘린더', '○ + 마감일·출장·휴업일 표시'],
  ['기간지정 다운로드', '○ 한글 → Word(docx)', '○ 한글(hwpx)·Word(docx), 인쇄'],
  ['학년도 전환', '○ 3월 1일 기준', '○ + 학년도가 바뀌어도 같은 학생 기록 잇기'],
  ['개인정보', 'PC 밖으로 나가지 않음', '클라우드를 고르면 외부에 저장됨 → PIN 잠금·암호화로 기기 보호'],
];
const WEB_ONLY = [
  '디자인 테마 8종, 글자 크기 조절, 휴대폰·폴드 화면',
  '학생 명단 학번·사진·연락처, 학반별 담임·부담임',
  '오늘의 노트와 #태그 모아보기, 포스트잇',
  '학사일정·연락 메뉴: 이미지·PDF·HWPX 보관, 개정판, AI 학사일정 추출',
  '출장 기록, 자동 저장, 여러 기기에서 같은 자료 보기',
];

const DL = `${REPO}/releases/latest/download/`;

/** 접속한 기기의 운영체제 */
function detectOS() {
  const ua = navigator.userAgent || '';
  const pf = navigator.userAgentData?.platform || navigator.platform || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(pf) && navigator.maxTouchPoints > 1)) return 'mobile';
  if (/Win/i.test(pf) || /Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(pf) || /Mac OS X/i.test(ua)) return 'mac';
  if (/Linux/i.test(pf) || /Linux/i.test(ua)) return 'linux';
  return '';
}

function downloadCard() {
  const os = detectOS();
  const big = (key, label, sub, file) => h(`a.dl-btn${os === key ? '.recommended' : ''}`, { href: DL + file },
    h('span.dl-os', label), h('span.dl-sub', sub), os === key ? h('span.dl-tag', '이 컴퓨터용') : null);
  return h('section.card.download-card',
    h('div.card-head', h('h2', '설치용 프로그램 내려받기')),
    isDesktop()
      ? h('p', '지금 데스크톱 앱을 쓰고 계십니다. 새 버전은 ', h('a', { href: `${REPO}/releases/latest`, target: '_blank' }, '최신 릴리스'), '에서 받을 수 있어요.')
      : [
        h('p.muted.small', '인터넷 창 없이 쓰는 데스크톱 앱입니다. 받은 파일을 실행하면 설치됩니다. 웹판과 같은 기능이며, 자료는 이 컴퓨터 폴더(또는 드롭박스 동기화 폴더)에 저장됩니다.'),
        os === 'mobile' ? h('p.warn', '휴대폰·태블릿은 이 웹 주소를 그대로 쓰세요. 브라우저 메뉴의 "홈 화면에 추가"로 앱처럼 설치할 수 있습니다.') : null,
        h('div.dl-row',
          big('windows', 'Windows 용 받기', 'Windows 10/11 · 설치 파일(.exe)', 'nanalnote-windows-setup.exe'),
          big('mac', 'macOS 용 받기', '인텔·애플 칩 공용 · 디스크 이미지(.dmg)', 'nanalnote-macos.dmg')),
        h('p.small', 'USB 에 넣고 다니는 포터블판: ',
          h('a', { href: DL + 'nanalnote-windows-portable.zip' }, 'Windows 포터블(.zip)'), ' · ',
          h('a', { href: DL + 'nanalnote-macos-portable.zip' }, 'macOS 포터블(.zip)'), ' — 압축을 풀고 실행하면 자료가 USB 안에 저장됩니다.'),
        h('p.small', 'Linux: ',
          h('a', { href: DL + 'nanalnote-linux.AppImage' }, 'AppImage'), ' · ',
          h('a', { href: DL + 'nanalnote-linux.deb' }, '.deb'), ' · ',
          h('a', { href: `${REPO}/releases/latest`, target: '_blank', rel: 'noopener' }, '모든 파일 보기')),
        h('details.small',
          h('summary', '처음 실행할 때 경고가 나오면'),
          h('ul',
            h('li', 'Windows: "Windows의 PC 보호" 창에서 ', h('strong', '추가 정보 → 실행'), '을 누르세요. 개인이 만든 무료 프로그램이라 코드 서명이 없어서 나오는 경고입니다.'),
            h('li', 'macOS: dmg 를 열어 나날노트를 응용 프로그램 폴더로 끌어 놓은 뒤, 처음 한 번은 ', h('strong', 'Control(⌃)+클릭 → 열기'), '로 실행하세요. 또는 시스템 설정 → 개인정보 보호 및 보안 → "확인 없이 열기".'))),
      ]);
}

export function renderAbout() {
  return h('div.about',
    h('section.card.about-hero',
      h('div.about-logo', '✎'),
      h('div',
        h('h2', TITLE),
        h('p', '나날이 쓰는 교사수첩 웹앱입니다. 수업일지, 업무일지, 학생 상담·출결, 학사일정을 한곳에서 관리합니다.'))),

    downloadCard(),

    h('section.card.about-origin',
      h('div.card-head', h('h2', '원 쌔미노트에 대한 감사')),
      h('p', `${APP_NAME}는 한 선생님께서 직접 만들어 동료 교사들에게 무료로 나눠 주신 Windows 교사수첩 프로그램 `,
        h('strong', `'${ORIGINAL.name}'`), '에서 영감을 받아 만들었습니다.'),
      h('p', '손으로 쓰던 교사수첩을 컴퓨터로 옮기고, 상담 일지 속 학생 이름을 알아보아 학생별로 모아 보는 생각, 학급요록과 기간지정 다운로드 같은 기능들은 모두 원 쌔미노트에서 출발했습니다. ',
        '그 아이디어를 웹과 휴대폰에서도 쓸 수 있도록 다시 만들고, 중·고등학교 교과 교사에게 필요한 기능을 더했습니다. 원작과 헷갈리지 않도록 이름은 따로 지었습니다.'),
      h('p', '좋은 프로그램을 만들어 나눠 주신 원작자 선생님께 깊이 감사드립니다.'),
      h('div.row',
        ext(ORIGINAL.blog, h('span.btn-like', '원 쌔미노트 블로그 바로가기 →')),
        ext(ORIGINAL.intro, h('span.btn-like.ghost-like', '원 쌔미노트 소개 글'))),
      h('p.muted.small', `${APP_NAME}는 원작자와 별개로 만든 것이며 원 쌔미노트의 공식 버전이 아닙니다. 원 쌔미노트의 다운로드·업데이트·문의는 위 블로그에서 확인해 주세요.`)),

    h('section.card',
      h('div.card-head', h('h2', '기능 비교')),
      h('div.records-wrap', h('table.grid.compare',
        h('thead', h('tr', h('th', '항목'), h('th', '원 쌔미노트 (Windows)'), h('th', TITLE))),
        h('tbody', ROWS.map(([k, a, b]) => h('tr', h('th', k), h('td', a), h('td', b)))))),
      h('h3', `${APP_NAME}에 더한 것`),
      h('ul', WEB_ONLY.map((x) => h('li', x))),
      h('p.muted.small', `원 쌔미노트는 모든 자료를 교사의 PC 에만 두는 것을 원칙으로 했습니다. 상담 기록처럼 민감한 정보를 다루므로, ${APP_NAME}에서 클라우드 저장소를 쓸 때는 학교의 개인정보 보호 지침을 꼭 확인해 주세요.`)),

    h('section.card',
      h('div.card-head', h('h2', '만든 사람 · 문의')),
      h('p', `${APP_NAME}는 중·고등학교 교사가 자신의 수업과 업무에 맞게 만들어 쓰고 있는 프로그램입니다.`),
      h('p', '오류 제보와 기능 제안: ', ext(`${REPO}/issues`, 'GitHub 이슈'), ' · 소스 코드: ', ext(REPO, REPO.replace('https://', '')))));
}
