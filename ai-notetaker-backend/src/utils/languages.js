/**
 * Languages the AI can write in. The client sends the lowercase key; the prompt uses the value, so the model is told
 * exactly which script and region to use. Chinese is three languages here: Simplified, Traditional (Taiwan) and
 * Traditional (Hong Kong). Old clients that only send 'chinese' keep getting Simplified.
 */
const LANGUAGE_NAMES = Object.freeze({
  // Major World Languages
  english: 'english', spanish: 'spanish', french: 'french', german: 'german', portuguese: 'portuguese', italian: 'italian',
  chinese: 'Simplified Chinese',
  chinese_traditional: 'Traditional Chinese (Taiwan)',
  chinese_traditional_hk: 'Traditional Chinese (Hong Kong)',
  japanese: 'japanese', korean: 'korean',
  // South Asian Languages
  hindi: 'hindi', bengali: 'bengali', tamil: 'tamil', telugu: 'telugu', urdu: 'urdu', marathi: 'marathi', gujarati: 'gujarati', punjabi: 'punjabi',
  // European Languages
  dutch: 'dutch', polish: 'polish', russian: 'russian', ukrainian: 'ukrainian', swedish: 'swedish', norwegian: 'norwegian',
  danish: 'danish', finnish: 'finnish', greek: 'greek', czech: 'czech', romanian: 'romanian', hungarian: 'hungarian',
  // Middle Eastern & African Languages
  arabic: 'arabic', hebrew: 'hebrew', turkish: 'turkish', persian: 'persian', swahili: 'swahili',
  // Southeast Asian Languages
  thai: 'thai', vietnamese: 'vietnamese', indonesian: 'indonesian', malay: 'malay', tagalog: 'tagalog',
});

const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_NAMES);

/**
 * Prompt suffix asking for output in [language]. Empty for English and for anything not on the list (the value can
 * come straight from a query string, so it is never copied into the prompt; own-property lookup only).
 */
function getLanguageInstruction(language) {
  if (typeof language !== 'string' || language === 'english') return '';
  if (!Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, language)) return '';
  const name = LANGUAGE_NAMES[language];
  return `\n\nIMPORTANT: Respond entirely in ${name}. All output must be in ${name}.`;
}

module.exports = { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, getLanguageInstruction };
