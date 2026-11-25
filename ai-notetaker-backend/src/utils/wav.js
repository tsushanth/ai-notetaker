/**
 * Minimal RIFF/WAVE joining. Concatenating WAV files byte for byte yields a file that players read only up to the end of
 * the first part, so the sample data is extracted and one header written for the whole.
 */

function parseWav(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  let fmt = null;
  let data = null;
  for (let off = 12; off + 8 <= buf.length;) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, Math.min(off + 8 + size, buf.length));
    if (id === 'fmt ') fmt = body;
    else if (id === 'data') data = body;
    off += 8 + size + (size % 2);
  }
  if (!fmt || fmt.length < 16 || !data) throw new Error('WAV file is missing its format or data');
  return { fmt, data, byteRate: fmt.readUInt32LE(8), blockAlign: fmt.readUInt16LE(12) };
}

/** Join WAV buffers that share one format, with `gapMs` of silence between them. */
function concatWav(buffers, gapMs = 0) {
  const parts = buffers.map(parseWav);
  if (parts.length === 0) throw new Error('no audio to join');
  const { fmt, byteRate, blockAlign } = parts[0];
  if (parts.some((p) => !p.fmt.equals(fmt))) throw new Error('audio parts have different formats');
  const gap = Buffer.alloc(Math.floor((byteRate * gapMs) / 1000 / (blockAlign || 1)) * (blockAlign || 1));
  const data = Buffer.concat(parts.flatMap((p, i) => (i ? [gap, p.data] : [p.data])));
  const header = Buffer.alloc(20);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + 8 + fmt.length + 8 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(fmt.length, 16);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, fmt, dataHeader, data]);
}

/** Length in seconds, from the header and the sample data. */
function wavSeconds(buf) {
  const { data, byteRate } = parseWav(buf);
  return byteRate ? data.length / byteRate : 0;
}

module.exports = { parseWav, concatWav, wavSeconds };
