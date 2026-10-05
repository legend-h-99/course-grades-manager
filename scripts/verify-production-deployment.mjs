import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const base = process.env.PRODUCTION_BASE_URL || 'https://sanadapp.pro';
const root = process.env.PRODUCTION_BUILD_DIR || 'dist/public';
const html = await readFile(join(root, 'index.html'), 'utf8');
const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
assert.ok(entry, 'Production artifact must include its JavaScript entry');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = digest(await readFile(join(root, entry.slice(1))));
let verified = false;
let lastError;
for (let attempt = 1; attempt <= 24; attempt++) {
  try {
    const home = await fetch(base + '/', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    assert.equal(home.status, 200);
    assert.ok((await home.text()).includes(entry), 'Live homepage does not yet reference the built release');
    const asset = await fetch(base + entry, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    assert.equal(asset.status, 200);
    assert.equal(digest(Buffer.from(await asset.arrayBuffer())), expected, 'Live bundle differs from the production artifact');
    verified = true;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < 24) await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
if (!verified) throw lastError;
console.log('PASS live frontend matches built artifact: ' + entry);
for (const path of ['/api/auth/me', '/api/workspace', '/api/workspace/courses']) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 401, 'Anonymous access must be denied: ' + path);
  assert.ok(response.headers.get('content-type')?.includes('application/json'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  console.log('PASS private API denies anonymous access: ' + path);
}
const privacy = await fetch(base + '/privacy.html', { signal: AbortSignal.timeout(10000) });
assert.equal(privacy.status, 200);
console.log('PASS privacy page is available');
