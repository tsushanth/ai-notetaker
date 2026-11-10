import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Contract test: every backend path that web-app/src/lib/api.ts calls must exist in the backend route table
// (app.js mounts + routes/*.js), with the same HTTP method. This is what would have caught the record, PDF
// and YouTube flows pointing at routes that never existed.

const here = dirname(fileURLToPath(import.meta.url));
const backendSrc = join(here, '..', '..', 'ai-notetaker-backend', 'src');
const apiTs = readFileSync(join(here, '..', 'src', 'lib', 'api.ts'), 'utf8');

type Route = { method: string; path: string };

/** Backend route table: app.js mounts joined with each router file's own routes. */
export function backendRoutes(src = backendSrc): Route[] {
  const app = readFileSync(join(src, 'app.js'), 'utf8');
  const fileOf = new Map<string, string>();
  for (const m of app.matchAll(/const\s+(\w+)\s*=\s*require\(\s*['"]\.\/routes\/(\w+)['"]\s*\)/g)) fileOf.set(m[1], m[2]);

  const routes: Route[] = [];
  // Routes registered directly on app (webhooks).
  for (const m of app.matchAll(/\bapp\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g)) {
    routes.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  for (const m of app.matchAll(/\bapp\.use\(\s*['"](\/[^'"]*)['"]\s*,(?:[^;]*?\)\s*,)?\s*(\w+)\s*\)/g)) {
    const file = fileOf.get(m[2]);
    if (!file) continue; // inline middleware or a router built elsewhere
    const body = readFileSync(join(src, 'routes', `${file}.js`), 'utf8');
    for (const r of body.matchAll(/\brouter\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]*)['"`]/g)) {
      const sub = r[2] === '/' ? '' : r[2];
      routes.push({ method: r[1].toUpperCase(), path: (m[1].replace(/\/$/, '') + sub) || '/' });
    }
  }
  return routes;
}

/** Calls found in api.ts: [method, normalised path]. `${x}` segments become `:p`, queries are dropped. */
export function webCalls(source = apiTs): Array<{ method: string; path: string; raw: string }> {
  const literal = /[`'"](?:\$\{API_BASE_URL\})?(\/api\/[^`'"]*)[`'"]/g;
  const hits = [...source.matchAll(literal)];
  return hits.map((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index! : source.length;
    const segment = source.slice(h.index!, end);
    const methodMatch = segment.match(/method:\s*['"](GET|POST|PUT|DELETE|PATCH)['"]/);
    let path = h[1].split('?')[0];
    path = path.replace(/(\$\{[^}]*\})+/g, ':p');
    return { method: methodMatch ? methodMatch[1] : 'GET', path, raw: h[1] };
  });
}

const segs = (p: string) => p.split('/').filter(Boolean);
export function matches(route: Route, call: { method: string; path: string }): boolean {
  if (route.method !== call.method) return false;
  const a = segs(route.path);
  const b = segs(call.path);
  if (a.length !== b.length) return false;
  return a.every((s, i) => s === b[i] || s.startsWith(':') || b[i].startsWith(':'));
}

test('the route table parser finds the routes Android uses', () => {
  const routes = backendRoutes();
  for (const [method, path] of [
    ['POST', '/api/recordings/upload'],
    ['POST', '/api/recordings/transcribe'],
    ['POST', '/api/uploads/pdf'],
    ['POST', '/api/uploads/video-url'],
    ['POST', '/api/ai/summary'],
    ['DELETE', '/api/user/delete-account'],
    ['GET', '/api/user/data-export'],
  ]) {
    assert.ok(routes.some((r) => r.method === method && r.path === path), `${method} ${path} should be in the backend route table`);
  }
});

test('the api.ts scanner sees the calls (guards against the regex silently matching nothing)', () => {
  const calls = webCalls();
  assert.ok(calls.length > 30, `expected more than 30 calls, found ${calls.length}`);
  assert.ok(calls.some((c) => c.method === 'POST' && c.path === '/api/ai/chat'));
  assert.ok(calls.some((c) => c.method === 'GET' && c.path === '/api/ai/note/:p'));
});

test('every path web-app/src/lib/api.ts calls exists in the backend with the same method', () => {
  const routes = backendRoutes();
  const missing = webCalls()
    .filter((c) => !routes.some((r) => matches(r, c)))
    .map((c) => `${c.method} ${c.raw}`);
  assert.deepEqual(missing, [], `api.ts calls routes the backend does not have:\n  ${missing.join('\n  ')}`);
});

test('the old, never-existing ingestion paths are not used', () => {
  for (const bad of ['/api/notes/upload/audio', '/api/notes/upload/pdf', '/api/notes/youtube']) {
    assert.ok(!apiTs.includes(bad), `${bad} must not appear in api.ts`);
  }
});
