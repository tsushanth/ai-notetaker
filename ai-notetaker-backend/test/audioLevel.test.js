const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { measureLevel, parseVolumedetect } = require('../src/utils/audioLevel');

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('parseVolumedetect: reads peak/mean and flags the -91 dB floor as digital silence', () => {
  const quiet = '[Parsed_volumedetect_0 @ 0x1] mean_volume: -35.4 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -8.8 dB\n';
  assert.deepEqual(parseVolumedetect(quiet), { peakDb: -8.8, meanDb: -35.4, silent: false });
  const zeros = '[Parsed_volumedetect_0 @ 0x1] mean_volume: -91.0 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -91.0 dB\n';
  assert.deepEqual(parseVolumedetect(zeros), { peakDb: -91, meanDb: -91, silent: true });
});

test('parseVolumedetect: garbage or missing fields give null, never a guess', () => {
  for (const bad of [undefined, null, '', 'Invalid data found when processing input', 'mean_volume: -20 dB', 'max_volume: nan dB mean_volume: x dB']) {
    assert.equal(parseVolumedetect(bad), null);
  }
});

test('measureLevel: empty buffer and a missing ffmpeg binary resolve to null (never throw)', async () => {
  assert.equal(await measureLevel(Buffer.alloc(0)), null);
  assert.equal(await measureLevel(null), null);
  assert.equal(await measureLevel(Buffer.from('x'), { ffmpegPath: '/nonexistent/ffmpeg' }), null);
});

test('measureLevel: non-audio bytes resolve to null and leave no temp file behind', async () => {
  const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('level-')).length;
  assert.equal(await measureLevel(Buffer.from('definitely not audio')), null);
  const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('level-')).length;
  assert.equal(after, before);
});

test('measureLevel: real m4a files (moov at the end, as MediaRecorder writes them)', { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiolevel-test-'));
  try {
    const make = (name, src) => {
      const f = path.join(dir, name);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', src, '-t', '2', '-ac', '1', '-c:a', 'aac', '-b:a', '96k', f]);
      return fs.readFileSync(f);
    };
    const silent = await measureLevel(make('silent.m4a', 'anullsrc=r=44100:cl=mono'));
    assert.equal(silent.silent, true); assert.ok(silent.peakDb <= -80);
    const tone = await measureLevel(make('tone.m4a', 'sine=frequency=440:sample_rate=44100,volume=0.1'));
    assert.equal(tone.silent, false); assert.ok(tone.peakDb > -40 && tone.peakDb < 0, `peak ${tone.peakDb}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
