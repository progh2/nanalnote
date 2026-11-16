// 학생 상담 일지 규칙 (원본 쌔미노트와 동일)
// - 빈 줄로 단락을 구분하면 각각 개별 상담 일지가 된다.
// - "학생이름 + 띄어쓰기" 로 학생을 표시한다. ("이몽룡이 울었다" 처럼 붙여 쓰면 인식하지 않음)
//   웹 버전에서는 이름 바로 뒤의 쉼표/마침표/콜론과 단락 끝도 인식한다.

export function splitParagraphs(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, '').replace(/\s+$/, ''))
    .filter((p) => p.trim() !== '');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function nameRegex(name) {
  // 앞: 문자열 시작 또는 한글/영문/숫자가 아닌 문자, 뒤: 공백/구두점/끝
  return new RegExp(`(^|[^0-9A-Za-z가-힣])(${escapeRe(name)})(?=[\\s,.:;!?)\\]]|$)`, 'g');
}

/** 단락에서 언급된 학생 이름 목록 */
export function mentionedStudents(paragraph, names) {
  const found = [];
  for (const n of names) {
    if (!n) continue;
    if (nameRegex(n).test(paragraph)) found.push(n);
  }
  return found;
}

/** 텍스트를 [{text, name?}] 조각으로 분해 (이름 클릭 링크 렌더링용) */
export function tokenize(paragraph, names) {
  const sorted = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!sorted.length) return [{ text: paragraph }];
  const re = new RegExp(`(^|[^0-9A-Za-z가-힣])(${sorted.map(escapeRe).join('|')})(?=[\\s,.:;!?)\\]]|$)`, 'g');
  const out = [];
  let last = 0, m;
  while ((m = re.exec(paragraph))) {
    const start = m.index + m[1].length;
    if (start > last) out.push({ text: paragraph.slice(last, start) });
    out.push({ text: m[2], name: m[2] });
    last = start + m[2].length;
    re.lastIndex = last;
  }
  if (last < paragraph.length) out.push({ text: paragraph.slice(last) });
  return out;
}
