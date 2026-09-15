const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;
const requestBuckets = new Map();

const allowed = {
  scene: new Set(['同一桌/聚会', '排队', '电梯/等候区', '咖啡店/书店', '课程/活动', '工作场合']),
  group: new Set(['一个人', '两个人', '多人一起']),
  age: new Set(['同龄', '年长', '年轻']),
  gender: new Set(['不重要', '男', '女']),
  style: new Set(['', '普通休闲', '运动户外', '商务正式', '文艺或有明显兴趣元素']),
  mood: new Set(['', '放松、没有在忙', '正在做事，但不匆忙', '有点拘谨或安静', '戴耳机、看手机或明显很忙'])
};

function json(data, status = 200, origin = '') {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function isAllowedOrigin(origin, configuredOrigin) {
  if (!origin) return false;
  if (origin === configuredOrigin) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

function rateLimited(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const bucket = requestBuckets.get(ip);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    requestBuckets.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validateInput(body) {
  const input = {
    scene: cleanText(body.scene, 30),
    group: cleanText(body.group, 20),
    age: cleanText(body.age, 20),
    gender: cleanText(body.gender, 20),
    style: cleanText(body.style, 40),
    mood: cleanText(body.mood, 40),
    detail: cleanText(body.detail, 240)
  };
  for (const key of Object.keys(allowed)) {
    if (!allowed[key].has(input[key])) throw new Error(`INVALID_${key.toUpperCase()}`);
  }
  return input;
}

function buildPrompt(input) {
  return `请根据以下现实场景，给出自然、简短、尊重边界的中文搭话建议，并仅输出 JSON。

场景：${input.scene}
对方人数：${input.group}
大概年龄：${input.age}
性别：${input.gender}
整体形象/打扮：${input.style || '未选择'}
对方状态：${input.mood || '未选择'}
可聊的现场细节：${input.detail || '没有补充'}

JSON 必须包含：
{
  "shouldApproach": true,
  "starter": "一句能直接说出口的开场",
  "reason": "为什么这样说自然",
  "follow": "对方愿意聊时的下一句",
  "light": "对方只简短回应时的一句",
  "exit": "自然结束对话的一句",
  "signal": "何时应该停止打扰"
}

要求：
1. 使用口语化简体中文，每个字段尽量一两句话。
2. 优先利用共同环境和用户填写的具体细节，不虚构事实。
3. 不评价身体、长相或吸引力，不使用油腻称赞，不制造压力。
4. 不因性别或打扮套刻板印象；这些信息只用于调整称呼和正式程度。
5. 如果对方戴耳机、明显忙碌、回避目光或不适合被打扰，将 shouldApproach 设为 false，并给出“不搭话”或只问必要问题的建议。
6. 不提供纠缠、操控、跟踪、性暗示或绕过拒绝的建议。`;
}

function normalizeResult(value) {
  const fallback = '对方如果回应简短、继续忙自己的事或身体转开，就礼貌结束。';
  return {
    shouldApproach: value.shouldApproach !== false,
    starter: cleanText(value.starter, 180) || '现在不必勉强开口，保持自然即可。',
    reason: cleanText(value.reason, 240) || '先尊重现场节奏和对方的注意力。',
    follow: cleanText(value.follow, 180) || '如果对方主动回应，再顺着共同话题聊一句。',
    light: cleanText(value.light, 180) || '“明白，你先忙。”',
    exit: cleanText(value.exit, 180) || '“好，那不打扰了。”',
    signal: cleanText(value.signal, 240) || fallback
  };
}

async function generateWithDeepSeek(input, env) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || 'deepseek-flash',
      messages: [
        { role: 'system', content: '你是谨慎、自然的现实社交表达助手。必须输出有效 JSON，不得输出 Markdown。' },
        { role: 'user', content: buildPrompt(input) }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 700,
      stream: false
    }),
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) {
    const text = await response.text();
    console.error('DeepSeek request failed', response.status, text.slice(0, 300));
    throw new Error(`DEEPSEEK_${response.status}`);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('EMPTY_MODEL_RESPONSE');
  return normalizeResult(JSON.parse(content));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const configuredOrigin = env.ALLOWED_ORIGIN || 'https://funun3-hue.github.io';
    const allowedOrigin = isAllowedOrigin(origin, configuredOrigin) ? origin : '';

    if (request.method === 'OPTIONS') {
      if (!allowedOrigin) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': allowedOrigin,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '86400',
          'vary': 'Origin'
        }
      });
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, configured: Boolean(env.DEEPSEEK_API_KEY) });
    }
    if (url.pathname !== '/api/generate' || request.method !== 'POST') {
      return json({ error: 'NOT_FOUND' }, 404, allowedOrigin);
    }
    if (!allowedOrigin) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
    if (!env.DEEPSEEK_API_KEY) return json({ error: 'API_NOT_CONFIGURED' }, 503, allowedOrigin);
    if (rateLimited(request)) return json({ error: 'TOO_MANY_REQUESTS' }, 429, allowedOrigin);

    try {
      const length = Number(request.headers.get('content-length') || 0);
      if (length > 8192) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413, allowedOrigin);
      const input = validateInput(await request.json());
      const result = await generateWithDeepSeek(input, env);
      return json(result, 200, allowedOrigin);
    } catch (error) {
      const code = error instanceof SyntaxError ? 'INVALID_JSON' : error.message;
      const status = String(code).startsWith('INVALID_') ? 400 : 502;
      console.error('Generate failed', code);
      return json({ error: status === 400 ? code : 'GENERATION_FAILED' }, status, allowedOrigin);
    }
  }
};
