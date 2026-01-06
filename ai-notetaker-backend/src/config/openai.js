const OpenAI = require('openai');

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OpenAI API key');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model configurations
const MODELS = {
  GPT4: 'gpt-4-turbo-preview',
  GPT4_MINI: 'gpt-4o-mini',
  GPT35: 'gpt-3.5-turbo',
  WHISPER: 'whisper-1',
  DALLE3: 'dall-e-3',
};

// Pricing per 1K tokens (as of Nov 2024, update as needed)
const PRICING = {
  'gpt-4-turbo-preview': { input: 0.01, output: 0.03 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'whisper-1': { perMinute: 0.006 },
  'dall-e-3': { perImage: { '1024x1024': 0.04, '1024x1792': 0.08, '1792x1024': 0.08 } },
};

module.exports = {
  openai,
  MODELS,
  PRICING,
};
