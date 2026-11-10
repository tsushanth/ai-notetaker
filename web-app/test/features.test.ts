import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ALL_FEATURES_OFF, parseFeatureFlags } from '../src/lib/features.ts';
import { FRAME_CSP, FRAME_SANDBOX, withFrameCsp } from '../src/lib/frameHtml.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '..', 'src', p), 'utf8');

test('every flag is off by default and for any broken answer', () => {
  const off = { phone_calls: false, learn: false, create: false, compete: false };
  assert.deepEqual(ALL_FEATURES_OFF, off);
  for (const bad of [undefined, null, 'x', 5, {}, { data: null }, { data: 'yes' }, { success: true }, { data: { learn: 'true' } }, { data: { learn: 1 } }]) {
    assert.deepEqual(parseFeatureFlags(bad), off, JSON.stringify(bad));
  }
});

test('only a literal true switches a flag on, and only that flag', () => {
  assert.deepEqual(parseFeatureFlags({ success: true, data: { learn: true, create: false, phone_calls: 'on' } }), {
    phone_calls: false, learn: true, create: false, compete: false,
  });
});

test('the Turn-into-a-lesson button and the Learn page wait for the server flag', () => {
  const note = src('app/(dashboard)/notes/[id]/page.tsx');
  assert.match(note, /\{flags\.learn && \(\s*<button\s+onClick=\{handleStartLearning\}/);
  const learn = src('app/learn/[sessionId]/page.tsx');
  assert.match(learn, /if \(!flags\.learn\)/);
  assert.match(learn, /if \(!flagsLoaded\)/);
});

test('model-written lessons never get the web origin: no allow-same-origin anywhere in the web app', () => {
  assert.equal(FRAME_SANDBOX, 'allow-scripts');
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const offenders = walk(join(here, '..', 'src')).filter((f) => /\.(tsx?|jsx?)$/.test(f) && /allow-same-origin/.test(readFileSync(f, 'utf8')) && !f.endsWith('frameHtml.ts'));
  assert.deepEqual(offenders, []);
  const learn = src('app/learn/[sessionId]/page.tsx');
  assert.match(learn, /sandbox=\{FRAME_SANDBOX\}/);
  assert.match(learn, /withFrameCsp\(getLessonHtmlWithBridge/);
  assert.match(learn, /event\.source !== iframeRef\.current\.contentWindow/);
});

test('lesson HTML gets a CSP that blocks network access before any of its own script runs', () => {
  assert.match(FRAME_CSP, /connect-src 'none'/);
  assert.match(FRAME_CSP, /default-src 'none'/);
  assert.match(FRAME_CSP, /form-action 'none'/);
  for (const html of ['<!DOCTYPE html><html lang="en"><head><title>t</title></head><body>b</body></html>', '<html><body>b</body></html>', '<p>b</p>']) {
    const out = withFrameCsp(html);
    assert.ok(out.includes('Content-Security-Policy'));
    assert.ok(out.indexOf('Content-Security-Policy') < out.indexOf('b</') || out.indexOf('Content-Security-Policy') < out.indexOf('>b<'), html);
  }
  assert.ok(withFrameCsp('<head></head><body></body>').startsWith('<head><meta http-equiv="Content-Security-Policy"'));
});
