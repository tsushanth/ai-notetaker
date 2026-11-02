import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { hasFormattedContent, shouldPollFormatting, displayContent, countWords, MIN_CHARS_TO_FORMAT } from '../src/lib/noteView.ts';

const long = 'word '.repeat(60); // 300 chars

test('hasFormattedContent mirrors Android: formatted text present AND status completed', () => {
  assert.equal(hasFormattedContent({ content: 'x', formatted_content: '# T', formatting_status: 'completed' }), true);
  assert.equal(hasFormattedContent({ content: 'x', formatted_content: '# T', formatting_status: 'processing' }), false);
  assert.equal(hasFormattedContent({ content: 'x', formatted_content: '', formatting_status: 'completed' }), false);
  assert.equal(hasFormattedContent({ content: 'x' }), false);
});

test('displayContent: formatted by default when available, raw when asked or when nothing is formatted', () => {
  const note = { content: 'raw text', formatted_content: '# Heading', formatting_status: 'completed' };
  assert.equal(displayContent(note, 'formatted'), '# Heading');
  assert.equal(displayContent(note, 'raw'), 'raw text');
  assert.equal(displayContent({ content: 'raw text' }, 'formatted'), 'raw text');
});

test('shouldPollFormatting: only for long, unformatted notes that are not known to have failed', () => {
  assert.equal(MIN_CHARS_TO_FORMAT, 200);
  assert.equal(shouldPollFormatting({ content: long }), true);
  assert.equal(shouldPollFormatting({ content: long, formatting_status: 'pending' }), true);
  assert.equal(shouldPollFormatting({ content: long, formatting_status: 'processing' }), true);
  assert.equal(shouldPollFormatting({ content: long, formatting_status: 'failed' }), false);
  assert.equal(shouldPollFormatting({ content: 'short' }), false);
  assert.equal(shouldPollFormatting({ content: long, formatted_content: '# Done', formatting_status: 'completed' }), false);
});

test('countWords counts whitespace-separated words and ignores blanks', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   \n  '), 0);
  assert.equal(countWords('one two\nthree\t four'), 4);
});

test('react-markdown with remark-gfm renders headings, lists and tables, and drops raw HTML', () => {
  const md = '# Title\n\n- a\n- b\n\n| h1 | h2 |\n|----|----|\n| c1 | c2 |\n\n**bold**\n\n<script>alert(1)</script>';
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, md));
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul>[\s\S]*<li>a<\/li>/);
  assert.match(html, /<table>[\s\S]*<th>h1<\/th>[\s\S]*<td>c1<\/td>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.doesNotMatch(html, /<script/i);
});
