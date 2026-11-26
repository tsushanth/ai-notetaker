/**
 * Read Aloud through Amazon Polly, with the voice chosen by the note's language. The self-hosted worker (English voices
 * only) stays as the fallback: every "no" or failure here returns null and the caller uses the worker.
 *
 * OFF unless TTS_POLLY_ENABLED=true AND POLLY_ACCESS_KEY_ID / POLLY_SECRET_ACCESS_KEY are set. Only those two names are
 * read: the AWS_* keys of this app (used for email) are never used for speech.
 *
 * Hard cap: at most USD 50 per calendar month (UTC), counted at list price with no free tier, reserved in one database
 * call (reserve_paid_speech) BEFORE anything is sent. If that cannot be done, Polly is not used. The environment can
 * lower the cap, never raise it.
 */
const { logger } = require('../utils/logger');
const { reportCounted } = require('../utils/failureReporter');
const { splitForSpeech } = require('../utils/speechText');

const HARD_CAP_USD = 50;
const USD_PER_CHAR = { neural: 16 / 1e6, standard: 4 / 1e6 }; // aws.amazon.com/polly/pricing, 2026-11-26
const CHUNK_CHARS = 2800;      // SynthesizeSpeech takes 3,000 billed characters per request
const REQUEST_TIMEOUT_MS = 30_000;
const RAW_BITS_PER_SECOND = 48_000; // Polly's 24 kHz MP3

// [language code, female voice, male voice, engine]. Where Polly has only one gender the same voice serves both.
const VOICES = {
  en: ['en-US', 'Joanna', 'Matthew', 'neural'],
  es: ['es-US', 'Lupe', 'Pedro', 'neural'],
  pt: ['pt-BR', 'Camila', 'Thiago', 'neural'],
  fr: ['fr-FR', 'Lea', 'Remi', 'neural'],
  de: ['de-DE', 'Vicki', 'Daniel', 'neural'],
  it: ['it-IT', 'Bianca', 'Adriano', 'neural'],
  pl: ['pl-PL', 'Ola', 'Ola', 'neural'],
  tr: ['tr-TR', 'Burcu', 'Burcu', 'neural'],
  ar: ['ar-AE', 'Hala', 'Zayd', 'neural'],
  hi: ['hi-IN', 'Kajal', 'Kajal', 'neural'],
  ja: ['ja-JP', 'Kazuha', 'Takumi', 'neural'],
  ko: ['ko-KR', 'Seoyeon', 'Seoyeon', 'neural'],
  zh: ['cmn-CN', 'Zhiyu', 'Zhiyu', 'neural'],
  nl: ['nl-NL', 'Laura', 'Laura', 'neural'],
  sv: ['sv-SE', 'Elin', 'Elin', 'neural'],
  no: ['nb-NO', 'Ida', 'Ida', 'neural'],
  da: ['da-DK', 'Sofie', 'Sofie', 'neural'],
  fi: ['fi-FI', 'Suvi', 'Suvi', 'neural'],
  cs: ['cs-CZ', 'Jitka', 'Jitka', 'neural'],
  ru: ['ru-RU', 'Tatyana', 'Maxim', 'standard'],
  ro: ['ro-RO', 'Carmen', 'Carmen', 'standard'],
  is: ['is-IS', 'Dora', 'Karl', 'standard'],
};
const MALE_APP_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx']);
// Scripts that settle the language on their own; the statistical guess is only used when none of these dominates.
const SCRIPTS = [
  ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu, 0.1], // Japanese mixes kana with Han characters
  ['ko', /\p{Script=Hangul}/gu, 0.3],
  ['zh', /\p{Script=Han}/gu, 0.3],
];

/** ISO 639-1 code of the note's language, or null when unsure. */
function detectLanguage(text, detect = (t) => require('tinyld').detect(t)) {
  const sample = String(text || '').slice(0, 5000);
  const letters = (sample.match(/\p{L}/gu) || []).length;
  if (letters < 20) return null;
  for (const [code, pattern, share] of SCRIPTS) if ((sample.match(pattern) || []).length / letters >= share) return code;
  const guess = detect(sample);
  if (guess === 'nb' || guess === 'nn') return 'no';
  return guess || null;
}

function getPollyConfig(env = process.env) {
  const accessKeyId = String(env.POLLY_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env.POLLY_SECRET_ACCESS_KEY || '').trim();
  const asked = Number(env.POLLY_MONTHLY_CAP_USD);
  return {
    enabled: String(env.TTS_POLLY_ENABLED || '').trim().toLowerCase() === 'true' && !!accessKeyId && !!secretAccessKey,
    region: String(env.POLLY_REGION || '').trim() || 'us-east-1',
    capUsd: env.POLLY_MONTHLY_CAP_USD !== undefined && env.POLLY_MONTHLY_CAP_USD !== '' && asked >= 0 ? Math.min(asked, HARD_CAP_USD) : HARD_CAP_USD,
    credentials: { accessKeyId, secretAccessKey },
  };
}

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** The Polly request for one piece. Plain text at normal speed; SSML only to change the speed. */
function pieceRequest(text, [languageCode, female, male, engine], appVoice, speed) {
  const rate = Math.round(Math.max(0.5, Math.min(2, Number(speed) || 1)) * 100);
  return {
    Engine: engine,
    LanguageCode: languageCode,
    VoiceId: MALE_APP_VOICES.has(String(appVoice).toLowerCase()) ? male : female,
    OutputFormat: 'mp3',
    SampleRate: '24000',
    ...(rate === 100 ? { TextType: 'text', Text: text } : { TextType: 'ssml', Text: `<speak><prosody rate="${rate}%">${escapeXml(text)}</prosody></speak>` }),
  };
}

function defaultSend(cfg) {
  const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
  // One attempt: a hidden retry could be billed twice, and the worker is there when a request fails.
  const client = new PollyClient({ region: cfg.region, credentials: cfg.credentials, maxAttempts: 1 });
  return async (input) => {
    const out = await client.send(new SynthesizeSpeechCommand(input), { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return Buffer.from(await out.AudioStream.transformToByteArray());
  };
}

function defaultLedger() {
  const { supabaseAdmin } = require('../config/supabase');
  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    async reserve({ userId, noteId, engine, language, characters, costUsd, capUsd }) {
      return check(await supabaseAdmin.rpc('reserve_paid_speech', {
        p_user: userId, p_note: noteId, p_engine: engine, p_language: language, p_characters: characters, p_cost: costUsd, p_cap: capUsd,
      }));
    },
    async settle(id, patch) { check(await supabaseAdmin.from('paid_speech_usage').update(patch).eq('id', id)); },
  };
}

function createPollySpeech({ env = process.env, send, ledger, detect, encode } = {}) {
  let sender = send || null;
  let book = ledger || null;

  async function settle(id, patch) {
    // The reservation stays counted if this fails, so the cap still holds.
    try { await (book ||= defaultLedger()).settle(id, patch); } catch (error) {
      logger.error('Polly cost could not be settled', { id, error: error.message });
      reportCounted('polly_ledger', 'Polly cost could not be written to its ledger', {});
    }
  }

  return {
    /** MP3 of the whole text as { mp3, durationSeconds, language }, or null: use the worker. Never throws. */
    async synthesize(text, { voice = 'nova', speed = 1.0, userId = null, noteId = null } = {}) {
      const cfg = getPollyConfig(env);
      if (!cfg.enabled) return null;
      let reservation = null;
      let sent = 0;
      let engine = null;
      try {
        const language = detectLanguage(text, detect);
        const spec = language && VOICES[language];
        if (!spec) { logger.info('Polly has no voice for this note', { noteId, language }); return null; }
        engine = spec[3];
        const pieces = splitForSpeech(text, CHUNK_CHARS);
        if (!pieces.length) return null;
        const characters = pieces.reduce((n, p) => n + p.length, 0);
        const costUsd = Number((characters * USD_PER_CHAR[engine]).toFixed(6));
        reservation = await (book ||= defaultLedger()).reserve({ userId, noteId, engine, language, characters, costUsd, capUsd: cfg.capUsd });
        if (!reservation?.ok) {
          logger.warn('Polly monthly cap reached', { monthUsd: reservation?.month_usd, capUsd: cfg.capUsd });
          reportCounted('polly_budget', 'Polly monthly cap reached: Read Aloud uses the own worker', { month_usd: String(reservation?.month_usd), cap_usd: String(cfg.capUsd) });
          return null;
        }
        sender ||= defaultSend(cfg);
        const audio = [];
        for (const piece of pieces) {
          sent += piece.length;
          try {
            audio.push(await sender(pieceRequest(piece, spec, voice, speed)));
          } catch (error) {
            // A refused request (4xx: bad key, throttled, bad text) is not billed.
            const status = error.$metadata?.httpStatusCode;
            if (status >= 400 && status < 500) sent -= piece.length;
            throw error;
          }
        }
        await settle(reservation.id, { status: 'done', characters: sent, cost_usd: Number((sent * USD_PER_CHAR[engine]).toFixed(6)) });
        logger.info('Polly speech: cost', { noteId, language, engine, characters: sent, costUsd, monthUsd: reservation.month_usd, capUsd: cfg.capUsd });
        const joined = Buffer.concat(audio);
        // Re-encoded to the bitrate of stored files; if that is not possible the joined MP3 plays as it is.
        const mp3 = encode ? await encode(joined) : null;
        const bits = mp3 ? 64_000 : RAW_BITS_PER_SECOND;
        const out = mp3 || joined;
        return { mp3: out, durationSeconds: Math.ceil((out.length * 8) / bits), language };
      } catch (error) {
        logger.error('Polly failed, using the own worker', { noteId, error: error.name, detail: error.message });
        reportCounted('polly_failed', `Polly failed: ${String(error.name || 'Error').slice(0, 60)}`, {});
        if (reservation?.ok) await settle(reservation.id, { status: 'failed', characters: sent, cost_usd: Number((sent * USD_PER_CHAR[engine]).toFixed(6)) });
        return null;
      }
    },
  };
}

module.exports = { createPollySpeech, getPollyConfig, detectLanguage, pieceRequest, VOICES, HARD_CAP_USD, USD_PER_CHAR, CHUNK_CHARS };
