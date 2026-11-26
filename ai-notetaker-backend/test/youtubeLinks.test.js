// Every common shape of a YouTube link yields the video id.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
function stub(rel, exports) { const abs = require.resolve(rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports }; }
stub('../src/utils/logger', { logger: { info() {}, warn() {}, error() {}, debug() {} } });
stub('../src/middleware/errorHandler', { AppError: class extends Error {} });
stub('../src/services/noteService', {});

const youtube = require('../src/services/youtubeTranscriptService');

test('video id from watch, short, live and share links, whatever the order of parameters', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=abcDEF12_-3',
    'https://m.youtube.com/watch?app=desktop&v=abcDEF12_-3&t=10s',
    'https://www.youtube.com/watch?feature=shared&v=abcDEF12_-3#x',
    'https://youtu.be/abcDEF12_-3?si=zzz',
    'https://youtube.com/shorts/abcDEF12_-3?feature=share',
    'https://www.youtube.com/live/abcDEF12_-3?si=zzz',
    'https://www.youtube.com/embed/abcDEF12_-3',
    'https://Youtube.com/watch?v=abcDEF12_-3',
  ]) assert.equal(youtube.extractYouTubeId(url), 'abcDEF12_-3', url);
});

test('links with no video in them give no id', () => {
  for (const url of [
    'https://www.youtube.com/@somechannel',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/watch?list=PL123',
    'https://www.youtube.com/watch?vv=abc',
  ]) assert.equal(youtube.extractYouTubeId(url), null, url);
});
