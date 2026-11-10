import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SITE_URL, sharedNoteCtaUrl } from '../src/lib/site.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('the shared-note buttons go to our own site with the share-loop tags', () => {
  for (const placement of ['header', 'footer', 'expired'] as const) {
    const url = new URL(sharedNoteCtaUrl(placement));
    assert.equal(url.origin, 'https://scribeai.online');
    assert.equal(url.searchParams.get('utm_source'), 'share');
    assert.equal(url.searchParams.get('utm_medium'), 'note');
    assert.equal(url.searchParams.get('utm_campaign'), 'shared_note');
    assert.equal(url.searchParams.get('utm_content'), placement);
  }
  assert.equal(SITE_URL, 'https://scribeai.online');
});

test('the shared-note page uses the helper and links to no other site', () => {
  const page = readFileSync(join(here, '..', 'src', 'app', 'shared', '[token]', 'page.tsx'), 'utf8');
  assert.equal((page.match(/sharedNoteCtaUrl\(/g) || []).length, 3);
  const hrefs = [...page.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs.filter((h) => /^https?:/.test(h)), []);
});

test('no web source file links to scribeai.app (a different company)', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const offenders = walk(join(here, '..', 'src')).filter((f) => /\.(tsx?|css)$/.test(f) && readFileSync(f, 'utf8').includes('scribeai.app'));
  assert.deepEqual(offenders, []);
});
