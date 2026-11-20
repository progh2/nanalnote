// 표 복사·붙여넣기 형식 (엑셀·구글 스프레드시트가 클립보드에 넣는 탭 구분 글자)
// - 칸은 탭, 줄은 줄바꿈. 칸 안에 줄바꿈·탭·따옴표가 있으면 "…" 로 감싸고 " 는 "" 로.

/** 클립보드 글자 → 2차원 배열 */
export function parseTSV(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [], cell = '', i = 0, quoted = false;
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // 엑셀은 끝에 줄바꿈을 하나 더 붙인다 → 맨 끝 빈 줄 제거
  while (rows.length && rows.at(-1).length === 1 && rows.at(-1)[0] === '') rows.pop();
  return rows;
}

/** 2차원 배열 → 클립보드 글자 */
export function toTSV(rows) {
  return rows.map((r) => r.map((v) => {
    const t = String(v ?? '');
    return /[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }).join('\t')).join('\n');
}

/** 예·아니오 칸에 붙여넣은 글자 → true/false */
export const truthy = (v) => /^(o|◯|○|v|✓|✔|y|yes|true|1|예|네|수료|완료|참)$/i.test(String(v ?? '').trim());
