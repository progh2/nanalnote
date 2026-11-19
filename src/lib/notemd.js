// 노트용 간단한 마크다운
// - 한 줄에 --- (또는 ===, ***) 만 쓰면 주제 구분선 → 주제마다 카드로 나눠 보인다
// - # 제목 / ## 제목 / ### 제목 (# 뒤에 한 칸 띄어야 제목, 붙여 쓰면 #태그)
// - "- " "* " 목록, "1. " 번호 목록, "- [ ] " 할 일(누르면 체크), "> " 인용
// - **굵게**, ~~취소선~~
import { h } from './util.js';

export const SEP_RE = /^\s*(-{3,}|={3,}|\*{3,}|_{3,})\s*$/;
const HEAD_RE = /^(#{1,3})\s+(.*)$/;
const TODO_RE = /^(\s*)[-*]\s+\[( |x|X)\]\s+(.*)$/;
const UL_RE = /^(\s*)[-*•]\s+(.*)$/;
const OL_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;

/** 첫 줄로 주제 제목 만들기 */
export function sectionTitle(text) {
  const first = String(text || '').split('\n').find((l) => l.trim()) || '';
  return first.replace(HEAD_RE, '$2').replace(TODO_RE, '$3').replace(UL_RE, '$2').replace(/\*\*|~~/g, '').trim();
}

/** 구분선으로 주제 나누기 → [{text, title, start}] (start = 원문에서 시작 줄 번호, 빈 주제는 뺀다) */
export function splitSections(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let buf = [], start = 0;
  const flush = (next) => {
    const body = buf.join('\n');
    if (body.trim()) {
      // 앞뒤 빈 줄은 빼되, 줄 번호는 맞춘다
      const lead = buf.findIndex((l) => l.trim());
      out.push({ text: body.trim(), title: sectionTitle(body), start: start + lead });
    }
    buf = []; start = next;
  };
  lines.forEach((l, i) => { if (SEP_RE.test(l)) flush(i + 1); else buf.push(l); });
  flush(lines.length);
  return out;
}

/** i 번째 줄의 할 일 체크 상태를 뒤집은 새 문자열 */
export function toggleTodo(text, lineNo) {
  const lines = String(text || '').split('\n');
  const m = lines[lineNo]?.match(TODO_RE);
  if (!m) return text;
  lines[lineNo] = lines[lineNo].replace(/\[( |x|X)\]/, m[2] === ' ' ? '[x]' : '[ ]');
  return lines.join('\n');
}

/** 블록 단위 분석 (화면과 시험에서 함께 쓴다) → [{type, ...}] */
export function parseBlocks(text, start = 0) {
  const lines = String(text || '').split('\n');
  const out = [];
  let para = null;
  const endPara = () => { para = null; };
  lines.forEach((l, k) => {
    const line = start + k;
    let m;
    if (!l.trim()) { endPara(); return; }
    if ((m = l.match(HEAD_RE))) { endPara(); out.push({ type: 'head', level: m[1].length, text: m[2], line }); return; }
    if ((m = l.match(TODO_RE))) { endPara(); out.push({ type: 'todo', done: m[2] !== ' ', text: m[3], indent: m[1].length, line }); return; }
    if ((m = l.match(UL_RE))) { endPara(); out.push({ type: 'li', text: m[2], indent: m[1].length, line }); return; }
    if ((m = l.match(OL_RE))) { endPara(); out.push({ type: 'oli', num: +m[2], text: m[3], indent: m[1].length, line }); return; }
    if ((m = l.match(QUOTE_RE))) {
      const last = out.at(-1);
      if (last?.type === 'quote' && !para) last.lines.push(m[1]); else out.push({ type: 'quote', lines: [m[1]], line });
      endPara(); return;
    }
    if (para) { para.lines.push(l); return; }
    para = { type: 'p', lines: [l], line };
    out.push(para);
  });
  return out;
}

/** **굵게** ~~취소~~ 를 나누고, 나머지 글자는 plain(text) 으로 (태그·학생 이름 강조용) */
function inlineNodes(text, plain) {
  const out = [];
  const re = /\*\*(.+?)\*\*|~~(.+?)~~/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...[].concat(plain(text.slice(last, m.index))));
    out.push(m[1] != null ? h('strong', [].concat(plain(m[1]))) : h('s', [].concat(plain(m[2]))));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...[].concat(plain(text.slice(last))));
  return out;
}

/**
 * 마크다운을 화면 노드로
 * @param {string} text
 * @param {{start?:number, plain?:(s:string)=>any, onToggle?:(line:number)=>void}} opt
 */
export function renderMd(text, { start = 0, plain = (s) => s, onToggle = null } = {}) {
  const inl = (s) => inlineNodes(s, plain);
  const nodes = [];
  let list = null;
  for (const b of parseBlocks(text, start)) {
    const isItem = b.type === 'li' || b.type === 'oli' || b.type === 'todo';
    if (!isItem) list = null;
    if (b.type === 'head') nodes.push(h(`div.md-h${b.level}`, inl(b.text)));
    else if (b.type === 'p') nodes.push(h('p.md-p', b.lines.flatMap((l, i) => (i ? [h('br'), ...inl(l)] : inl(l)))));
    else if (b.type === 'quote') nodes.push(h('blockquote.md-quote', b.lines.flatMap((l, i) => (i ? [h('br'), ...inl(l)] : inl(l)))));
    else {
      const tag = b.type === 'oli' ? 'ol' : 'ul';
      if (!list || list.tag !== tag) {
        list = { tag, el: h(`${tag}.md-list`, b.type === 'oli' ? { start: b.num } : {}) };
        nodes.push(list.el);
      }
      const pad = { style: { marginLeft: `${Math.min(b.indent, 8) * 0.6}em` } };
      if (b.type === 'todo') {
        const cb = h('input', { type: 'checkbox', checked: b.done, disabled: !onToggle, onclick: (e) => { e.stopPropagation(); onToggle?.(b.line); } });
        list.el.append(h(`li.md-todo${b.done ? '.done' : ''}`, pad, h('label', cb, h('span', inl(b.text)))));
      } else list.el.append(h('li', pad, inl(b.text)));
    }
  }
  return nodes;
}
