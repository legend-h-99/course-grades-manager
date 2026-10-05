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

test('course list accepts GET and maps database fields', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => url.pathname === '/auth/v1/user'
    ? Response.json({ id: 'user' })
    : Response.json([{ id: 'course', name: 'Test', code: 'ABC', kind: 'theory', section_number: '101', saved_at: 'today', updated_at: 'today' }]);
  try {
    const result = await worker.fetch(new Request('https://sanadapp.pro/api/workspace/courses', { headers: { Authorization: 'Bearer test' } }), env);
    assert.equal(result.status, 200);
    assert.equal((await result.json())[0].sectionNumber, '101');
    assert.equal((await worker.fetch(new Request('https://sanadapp.pro/api/workspace/courses'), env)).status, 401);
  } finally { globalThis.fetch = original; }
});
test('requested course must belong to the current user', async () => {
  const original = globalThis.fetch;
  const courseId = '00000000-0000-4000-8000-000000000001';
  let checkedMembership = false;
  globalThis.fetch = async (url) => {
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'user' });
    if (url.pathname === '/rest/v1/course_trainers') {
      assert.equal(url.searchParams.get('course_id'), 'eq.' + courseId);
      assert.equal(url.searchParams.get('user_id'), 'eq.user');
      checkedMembership = true;
    }
    return Response.json([]);
  };
  const encryptedEnv = { ...env, FIELD_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') };
  try {
    const headers = { Authorization: 'Bearer test' };
    assert.equal((await worker.fetch(new Request('https://sanadapp.pro/api/workspace?courseId=invalid', {headers}), encryptedEnv)).status, 400);
    assert.equal((await worker.fetch(new Request('https://sanadapp.pro/api/workspace?courseId=' + courseId, {headers}), encryptedEnv)).status, 404);
    assert.equal(checkedMembership, true);
  } finally { globalThis.fetch = original; }
});

test('invalid grade payload is rejected before any database write', async () => {
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, options) => { if(options.method !== 'GET') writes++; return Response.json({id:'user'}); };
  const baseState = { account:{}, trainer:{}, course:{code:'TEST'}, trainees:[{id:'t'}], assessments:[{id:'a',maxScore:20,weight:0}], grades:[] };
  try {
    for (const grade of [{traineeId:'t',assessmentId:'a',score:21},{traineeId:'t',assessmentId:'a',score:-1},{traineeId:'other',assessmentId:'a',score:1}]) {
      const r = await worker.fetch(new Request('https://sanadapp.pro/api/workspace/save',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test'},body:JSON.stringify({state:{...baseState,grades:[grade]}})}),env);
      assert.equal(r.status,400);
    }
    assert.equal(writes,0);
  } finally {globalThis.fetch=original;}
});

test('trainee order survives saves with randomized name encryption', async () => {
  const original = globalThis.fetch;
  let rows = [];
  const course = {id:'course',created_by:'user',updated_at:'old',code:'COURSE'};
  globalThis.fetch = async (url, options) => {
    if(url.pathname === '/auth/v1/user') return Response.json({id:'user'});
    if(url.pathname === '/rest/v1/courses') return Response.json([course]);
    if(url.pathname === '/rest/v1/course_trainers') return Response.json([{course_id:'course'}]);
    if(url.pathname === '/rest/v1/course_invites') return Response.json([{token:'INVITE'}]);
    if(url.pathname === '/rest/v1/trainees') {
      if(options.method === 'POST') { rows=JSON.parse(options.body); return Response.json([]); }
      if(url.searchParams.get('select') === 'id') return Response.json(rows.map(r=>({id:r.id})));
      assert.equal(url.searchParams.get('order'),'sort_order.asc,id.asc');
      return Response.json([...rows].sort((a,b)=>a.sort_order-b.sort_order));
    }
    return Response.json([]);
  };
  const encryptedEnv={...env,FIELD_ENCRYPTION_KEY:Buffer.alloc(32).toString('base64')};
  const state={account:{},trainer:{},course:{code:'COURSE',updatedAt:'old'},trainees:[{id:'b',name:'متدرب ثان',trainingNumber:'002'},{id:'a',name:'متدرب أول',trainingNumber:'001'}],assessments:[],grades:[]};
  const headers={'Content-Type':'application/json',Authorization:'Bearer test'};
  try {
    for(let i=0;i<2;i++) {
      assert.equal((await worker.fetch(new Request('https://sanadapp.pro/api/workspace/save',{method:'POST',headers,body:JSON.stringify({state})}),encryptedEnv)).status,200);
      assert.deepEqual(rows.map(r=>r.sort_order),[0,1]);
      const response=await worker.fetch(new Request('https://sanadapp.pro/api/workspace',{headers}),encryptedEnv);
      assert.equal(response.status,200);
      assert.deepEqual((await response.json()).trainees.map(t=>[t.id,t.name]),[['b','متدرب ثان'],['a','متدرب أول']]);
    }
  } finally {globalThis.fetch=original;}
});
