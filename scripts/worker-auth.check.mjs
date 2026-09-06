import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'test-public-key' };
const refreshRequest = (value, origin = 'https://sanadapp.pro') => new Request('https://sanadapp.pro/api/auth/refresh', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value),
});
test('refresh validates method, payload and origin', async () => {
  assert.equal((await worker.fetch(new Request('https://sanadapp.pro/api/auth/refresh'), env)).status, 405);
  assert.equal((await worker.fetch(refreshRequest({}), env)).status, 400);
  assert.equal((await worker.fetch(refreshRequest({ refreshToken: 'fake' }, 'https://other.test'), env)).status, 403);
});
test('refresh forwards the grant and returns rotated credentials without caching', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url.search, '?grant_type=refresh_token');
    assert.deepEqual(JSON.parse(options.body), { refresh_token: 'old-refresh' });
    return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, user: { id: 'user' } });
  };
  try {
    const response = await worker.fetch(refreshRequest({ refreshToken: 'old-refresh' }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).session.refreshToken, 'new-refresh');
  } finally { globalThis.fetch = original; }
});
test('upstream outage remains a server error rather than invalid credentials', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: 'Unavailable' }, { status: 503 });
  try {
    assert.equal((await worker.fetch(refreshRequest({ refreshToken: 'refresh' }), env)).status, 503);
  } finally { globalThis.fetch = original; }
});

test('rejects oversized bodies even without Content-Length', async () => {
  const request = refreshRequest({ refreshToken: 'x'.repeat(2 * 1024 * 1024) });
  assert.equal(request.headers.has('Content-Length'), false);
  assert.equal((await worker.fetch(request, env)).status, 413);
});
test('rejects non-JSON and mutation via GET', async () => {
  const request = new Request('https://sanadapp.pro/api/auth/sign-in', {method:'POST', body:'email=test'});
  assert.equal((await worker.fetch(request, env)).status, 415);
  assert.equal((await worker.fetch(new Request('https://sanadapp.pro/api/workspace/clear'), env)).status, 405);
});
test('database diagnostic details never reach clients and APIs carry security headers', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message:'private-row-value', hint:'secret-hint' }, {status:400});
  try {
    const result = await worker.fetch(refreshRequest({refreshToken:'test'}),env);
    assert.equal((await result.text()).includes('private-row-value'),false);
    assert.equal(result.headers.get('X-Frame-Options'),'DENY');
    assert.equal(result.headers.get('Referrer-Policy'),'no-referrer');
    assert.equal(result.headers.has('X-Data-Region'),false);
  } finally { globalThis.fetch = original; }
});
test('missing encryption configuration blocks data writes', async () => {
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, options) => {
    if(options.method !== 'GET') writes++;
    return Response.json({id:'user'});
  };
  try {
    const result = await worker.fetch(new Request('https://sanadapp.pro/api/workspace/profile',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test'},body:'{"profile":{}}'
    }),env);
    assert.equal(result.status,503);
    assert.equal(writes,0);
  } finally { globalThis.fetch = original; }
});
