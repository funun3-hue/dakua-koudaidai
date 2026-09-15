import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const origin = 'https://funun3-hue.github.io';
const validInput = {
  scene: '咖啡店/书店', group: '一个人', age: '同龄', gender: '不重要',
  style: '普通休闲', mood: '放松、没有在忙', detail: '正在看一本旅行书'
};

test('health endpoint does not expose secrets', async () => {
  const response = await worker.fetch(new Request('https://api.example/health'), { DEEPSEEK_API_KEY: 'secret' });
  assert.deepEqual(await response.json(), { ok: true, configured: true });
});

test('rejects unapproved origins', async () => {
  const request = new Request('https://api.example/api/generate', {
    method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    body: JSON.stringify(validInput)
  });
  const response = await worker.fetch(request, { DEEPSEEK_API_KEY: 'secret', ALLOWED_ORIGIN: origin });
  assert.equal(response.status, 403);
});

test('requires a server-side DeepSeek key', async () => {
  const request = new Request('https://api.example/api/generate', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(validInput)
  });
  const response = await worker.fetch(request, { ALLOWED_ORIGIN: origin });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'API_NOT_CONFIGURED' });
});

test('returns normalized structured advice', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      shouldApproach: true,
      starter: '“你也喜欢旅行类的书吗？”', reason: '来自现场细节。',
      follow: '“你最推荐哪一本？”', light: '“明白，你继续看吧。”',
      exit: '“谢谢，不打扰你看书了。”', signal: '对方继续低头看书时结束。'
    }) } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const request = new Request('https://api.example/api/generate', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'CF-Connecting-IP': 'test-ip' },
    body: JSON.stringify(validInput)
  });
  const response = await worker.fetch(request, { DEEPSEEK_API_KEY: 'secret', ALLOWED_ORIGIN: origin });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.starter, '“你也喜欢旅行类的书吗？”');
  assert.equal(body.shouldApproach, true);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
});
