const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/**
 * Level facts about an audio buffer, used ONLY to explain why a recording produced no transcript:
 * "the file is digital silence" (the device handed us zeros: mic muted/blocked/in use) is a very
 * different story from "there is sound but the provider found no speech". The audio is decoded
 * locally by ffmpeg (already in the image) and never leaves the machine; only two numbers and a
 * label come back, nothing about the content.
 *
 * ffmpeg's volumedetect reports an all-zero stream as -91.0 dB (its histogram floor), so anything at
 * or below SILENT_PEAK_DB is treated as digital silence. Real rooms sit far above that: the quiet
 * recordings seen in production peak around -16 to -9 dB, a clean voice at about -2 dB.
 *
 * measureLevel never throws and never blocks the request for long: it returns null if ffmpeg is
 * missing, fails, times out or prints something unexpected.
 */

const SILENT_PEAK_DB = -80;
const FFMPEG_TIMEOUT_MS = 15_000;

function parseVolumedetect(stderr) {
  const text = String(stderr || '');
  const max = /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(text);
  const mean = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(text);
  if (!max || !mean) return null;
  const peakDb = Number(max[1]);
  const meanDb = Number(mean[1]);
  if (!Number.isFinite(peakDb) || !Number.isFinite(meanDb)) return null;
  return { peakDb, meanDb, silent: peakDb <= SILENT_PEAK_DB };
}

/**
 * @param {Buffer} buffer audio file bytes (any container ffmpeg reads)
 * @param {{ ffmpegPath?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<{peakDb:number, meanDb:number, silent:boolean} | null>}
 */
async function measureLevel(buffer, { ffmpegPath = 'ffmpeg', timeoutMs = FFMPEG_TIMEOUT_MS } = {}) {
  if (!buffer || !buffer.length) return null;
  // A file, not a pipe: MediaRecorder writes the mp4 index (moov) at the end, which ffmpeg cannot read from a stream.
  const file = path.join(os.tmpdir(), `level-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(file, buffer, { mode: 0o600 });
    const stderr = await new Promise((resolve) => {
      execFile(
        ffmpegPath,
        ['-hide_banner', '-nostats', '-nostdin', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'],
        { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
        (err, _stdout, errOut) => resolve(err && !errOut ? '' : errOut)
      );
    });
    return parseVolumedetect(stderr);
  } catch (e) {
    return null;
  } finally {
    await fs.rm(file, { force: true }).catch(() => {});
  }
}

module.exports = { measureLevel, parseVolumedetect, SILENT_PEAK_DB };
