// 잠금 화면: PIN 6자리 또는 패스키(지문·얼굴·Windows Hello)
import { h, confirmDialog, fill } from '../lib/util.js';
import { unlockPin, unlockPasskey, hasPasskey, removeVault } from '../lib/vault.js';
import { sensitiveKeys } from '../lib/securestore.js';
import { APP_NAME } from '../brand.js';

const FAIL_KEY = 'sn:vault:fails';

export function showLockScreen(root) {
  return new Promise((resolve) => {
    let pin = '';
    let busy = false;
    const dots = h('div.pin-dots');
    const msg = h('p.lock-msg', ' ');
    const drawDots = () => fill(dots, ...Array.from({ length: 6 }, (_, i) => h(`span${i < pin.length ? '.on' : ''}`)));
    drawDots();

    const done = () => { document.removeEventListener('keydown', onKey); resolve(); };
    const fails = () => JSON.parse(localStorage.getItem(FAIL_KEY) || '{"n":0,"until":0}');

    async function tryPin() {
      const f = fails();
      if (Date.now() < f.until) { msg.textContent = `잠시 후 다시 시도하세요 (${Math.ceil((f.until - Date.now()) / 1000)}초)`; pin = ''; drawDots(); return; }
      busy = true; msg.textContent = '확인 중…';
      try {
        await unlockPin(pin);
        localStorage.removeItem(FAIL_KEY);
        done();
      } catch (e) {
        const n = f.n + 1;
        // 5번 틀릴 때마다 대기 시간이 늘어난다 (30초, 60초, …)
        const until = n % 5 === 0 ? Date.now() + 30000 * (n / 5) : 0;
        localStorage.setItem(FAIL_KEY, JSON.stringify({ n, until }));
        msg.textContent = until ? `${n}번 틀렸습니다. ${30 * (n / 5)}초 뒤에 다시 시도하세요.` : e.message;
        root.querySelector('.lock-box')?.classList.add('shake');
        setTimeout(() => root.querySelector('.lock-box')?.classList.remove('shake'), 400);
      } finally { busy = false; pin = ''; drawDots(); }
    }
    const press = (d) => {
      if (busy) return;
      if (d === 'del') pin = pin.slice(0, -1);
      else if (pin.length < 6) pin += d;
      drawDots();
      if (pin.length === 6) tryPin();
    };
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
    };
    document.addEventListener('keydown', onKey);

    const pk = hasPasskey() ? h('button.primary', { onclick: async () => {
      msg.textContent = '지문·얼굴·Windows Hello 를 확인해 주세요…';
      try { await unlockPasskey(); localStorage.removeItem(FAIL_KEY); done(); } catch (e) { msg.textContent = e.message; }
    } }, '🔑 지문·얼굴·Windows Hello 로 열기') : null;

    fill(root, h('div.lock-screen',
      h('div.lock-box',
        h('div.lock-logo', '✎'),
        h('h2', `${APP_NAME} 잠금`),
        h('p.muted', 'PIN 6자리를 입력하세요'),
        dots, msg,
        h('div.pinpad', [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => h('button', { onclick: () => press(String(n)) }, String(n))),
          h('span'), h('button', { onclick: () => press('0') }, '0'), h('button', { onclick: () => press('del'), 'aria-label': '지우기' }, '⌫')),
        pk,
        h('button.link.small', { onclick: async () => {
          if (!(await confirmDialog('PIN 을 잊었어요', '이 기기에 저장된 로그인 정보·캐시·로컬 데이터·사진을 지우고 잠금을 해제합니다. 드롭박스·컴퓨터 폴더에 저장된 일지는 그대로 남으며, 다시 연결하면 됩니다. "이 브라우저(로컬)" 저장소만 썼다면 그 자료는 되살릴 수 없습니다. 계속할까요?', '지우고 초기화'))) return;
          for (const k of sensitiveKeys()) localStorage.removeItem(k);
          localStorage.removeItem(FAIL_KEY);
          indexedDB.deleteDatabase('sammynote');
          removeVault();
          location.reload();
        } }, 'PIN 을 잊었어요'))));
    root.querySelector('.pinpad button')?.focus();
  });
}
