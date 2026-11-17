// AI 연동: Anthropic(Claude) · OpenAI(ChatGPT) · Ollama
// - 키는 이 브라우저에만(잠금 사용 시 암호화) 저장되고, 요청은 브라우저에서 각 회사 API 로 바로 간다(서버 없음).
// - 학사일정·주간업무계획 이미지/PDF(쪽 이미지)/HWPX 텍스트에서 날짜별 일정을 뽑는다.
import { sget, sset } from './securestore.js';

const KEY = 'sn:ai';
export const PROVIDERS = [['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI (ChatGPT)'], ['ollama', 'Ollama (내 컴퓨터)']];
export const DEFAULT_MODEL = { anthropic: 'claude-opus-5-5', openai: '', ollama: '' };
// 서버 측 거절 대비(fallbacks)를 지원하는 Claude 모델
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-sonnet-5-5']);

export function loadAI() {
  let c = {};
  try { c = JSON.parse(sget(KEY) || '{}'); } catch { /* 기본값 */ }
  return { provider: 'anthropic', keys: {}, models: { ...DEFAULT_MODEL }, ollamaUrl: 'http://localhost:11434', ...c, keys: { ...(c.keys || {}) }, models: { ...DEFAULT_MODEL, ...(c.models || {}) } };
}
export function saveAI(cfg) { sset(KEY, JSON.stringify(cfg)); }
export const aiReady = (cfg = loadAI()) => (cfg.provider === 'ollama' ? !!cfg.models.ollama : !!cfg.keys[cfg.provider] && !!cfg.models[cfg.provider]);

// ---------- Anthropic (공식 SDK, 필요할 때만 불러옴) ----------
async function anthropicClient(cfg) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // 정적 웹앱이라 서버가 없으므로 사용자가 넣은 키로 브라우저에서 직접 호출한다
  return new Anthropic({ apiKey: cfg.keys.anthropic, dangerouslyAllowBrowser: true });
}

// ---------- 모델 목록 ----------
export async function listModels(provider, cfg) {
  if (provider === 'anthropic') {
    const client = await anthropicClient(cfg);
    const out = [];
    for await (const m of client.models.list()) out.push({ id: m.id, name: m.display_name || m.id });
    return out;
  }
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${cfg.keys.openai}` } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message || `OpenAI ${res.status}`);
    return j.data.map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|transcribe|tts|image|embedding|search)/.test(id))
      .sort().map((id) => ({ id, name: id }));
  }
  if (provider === 'ollama') {
    let res;
    try { res = await fetch(`${cfg.ollamaUrl.replace(/\/+$/, '')}/api/tags`); } catch {
      throw new Error('Ollama 에 연결할 수 없습니다. Ollama 가 실행 중인지, OLLAMA_ORIGINS 에 이 사이트 주소가 허용되어 있는지 확인하세요.');
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    return (j.models || []).map((m) => ({ id: m.name, name: m.name }));
  }
  throw new Error('알 수 없는 AI');
}

// ---------- 공통 호출 ----------
const blobToB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

/** 이미지를 AI 에 보내기 좋게 줄인다 (긴 변 최대 1600px, JPEG) */
async function shrink(blob, max = 1600) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}

/**
 * 한 번 묻고 JSON 한 개를 받는다.
 * @param images Blob[] (최대 8장), text 추가 본문(HWPX 등에서 뽑은 글)
 */
async function askJSON(cfg, { system, prompt, images = [], text = '', zodSchema }) {
  const provider = cfg.provider;
  const model = cfg.models[provider];
  const imgs = await Promise.all(images.slice(0, 8).map(async (b) => blobToB64(await shrink(b))));
  const userText = text ? `${prompt}\n\n[문서 본문]\n${text.slice(0, 60000)}` : prompt;

  if (provider === 'anthropic') {
    const client = await anthropicClient(cfg);
    const content = [...imgs.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })), { type: 'text', text: userText }];
    const base = { model, max_tokens: 16000, system, messages: [{ role: 'user', content }] };
    let msg;
    if (FALLBACK_MODELS.has(model)) {
      // 안전 분류기가 거절하면 서버가 같은 요청을 대체 모델로 다시 실행 (fallbacks: default)
      const { betaZodOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/zod');
      msg = await client.beta.messages.parse({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { format: betaZodOutputFormat(zodSchema) } });
    } else {
      const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
      msg = await client.messages.parse({ ...base, output_config: { format: zodOutputFormat(zodSchema) } });
    }
    if (msg.stop_reason === 'refusal') throw new Error('AI 가 이 요청을 처리하지 않았습니다(거절). 다른 모델로 시도해 보세요.');
    if (msg.stop_reason === 'max_tokens') throw new Error('문서가 너무 길어 결과가 잘렸습니다. 쪽 수를 줄여 다시 시도하세요.');
    if (!msg.parsed_output) throw new Error('AI 응답을 해석하지 못했습니다.');
    return msg.parsed_output;
  }

  if (provider === 'openai') {
    const content = [{ type: 'text', text: userText }, ...imgs.map((d) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${d}` } }))];
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.keys.openai}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content }], response_format: { type: 'json_object' } }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message || `OpenAI ${res.status}`);
    return zodSchema.parse(JSON.parse(j.choices?.[0]?.message?.content || '{}'));
  }

  if (provider === 'ollama') {
    const res = await fetch(`${cfg.ollamaUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, format: 'json', messages: [{ role: 'system', content: system }, { role: 'user', content: userText, ...(imgs.length ? { images: imgs } : {}) }] }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Ollama ${res.status}`);
    return zodSchema.parse(JSON.parse(j.message?.content || '{}'));
  }
  throw new Error('AI 가 설정되지 않았습니다.');
}

/** 연결 테스트: 아주 짧은 질문 하나 */
export async function testAI(cfg) {
  const { z } = await import('zod');
  const out = await askJSON(cfg, { system: '짧게 JSON 으로만 답한다.', prompt: '{"ok": true, "reply": "인사말 한 단어"} 형식으로 답하세요.', zodSchema: z.object({ ok: z.boolean(), reply: z.string() }) });
  return out.reply || 'OK';
}

/**
 * 학사일정·주간업무계획에서 날짜별 일정 추출
 * @param ctx { year(학년도), kind: annual|monthly|weekly, period: 'YYYY-MM' | 주 시작 'YYYY-MM-DD' | '' }
 * @returns [{ date: 'YYYY-MM-DD', text, holiday }]
 */
export async function extractSchedule(cfg, { images = [], text = '', ctx }) {
  const { z } = await import('zod');
  const schema = z.object({ events: z.array(z.object({ date: z.string(), text: z.string(), holiday: z.boolean() })) });
  const kind = { annual: '연간 학사일정', monthly: '월중 행사(학사)일정', weekly: '주간업무계획' }[ctx.kind] || '학사일정';
  const range = ctx.kind === 'monthly' ? `${ctx.period} 한 달` : ctx.kind === 'weekly' ? `${ctx.period} 에 시작하는 주` : `${ctx.year}학년도(${ctx.year}-03-01 ~ ${ctx.year + 1}-02-말일)`;
  const system = '너는 한국 초·중·고등학교의 학사일정 문서를 읽고 날짜별 일정을 정확히 뽑아내는 도우미다. 문서에 없는 내용은 만들지 않는다.';
  const prompt = [
    `다음은 ${kind} 문서다. 대상 기간: ${range}.`,
    '날짜별 일정을 뽑아 {"events":[{"date":"YYYY-MM-DD","text":"…","holiday":false}]} 형식의 JSON 으로만 답하라.',
    '- 연도가 표시되지 않은 날짜는 대상 기간에 맞는 연도로 쓴다 (3~12월은 학년도 연도, 1~2월은 다음 해).',
    '- 같은 날짜의 여러 일정은 한 항목의 text 에 ", " 로 이어서 쓴다. 학년·부서 표시는 괄호로 짧게 남긴다. 예: "3학년 모의고사(교무부), 학부모 상담주간".',
    '- 여러 날에 걸친 일정(예: 3.4~3.6 수학여행)은 각 날짜마다 넣는다.',
    '- 재량휴업일·개교기념일·방학 같이 학생이 등교하지 않는 날은 holiday 를 true 로 한다. 법정 공휴일만 있는 날은 넣지 않아도 된다.',
    '- 일정이 없는 날은 넣지 않는다. 담당자 이름·시간 같은 세부 사항은 꼭 필요할 때만 짧게.',
  ].join('\n');
  const out = await askJSON(cfg, { system, prompt, images, text, zodSchema: schema });
  return out.events
    .map((e) => ({ date: String(e.date).trim(), text: String(e.text).trim(), holiday: !!e.holiday }))
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.text);
}
