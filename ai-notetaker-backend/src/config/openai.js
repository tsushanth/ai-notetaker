const Anthropic = require('@anthropic-ai/sdk');

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('Missing Anthropic API key');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Model configurations
const MODELS = {
  CLAUDE_SONNET: 'claude-sonnet-4-6',
  CLAUDE_HAIKU: 'claude-haiku-4-5-20251001',
  // Legacy aliases for backwards compatibility in usage logs
  GPT4: 'claude-sonnet-4-6',
  GPT4_MINI: 'claude-sonnet-4-6',
  GPT35: 'claude-haiku-4-5-20251001',
  WHISPER: 'whisper-1',
  DALLE3: 'dall-e-3',
};

// Pricing per 1K tokens (Anthropic pricing)
const PRICING = {
  'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
  'whisper-1': { perMinute: 0.006 },
  'dall-e-3': { perImage: { '1024x1024': 0.04, '1024x1792': 0.08, '1792x1024': 0.08 } },
};

module.exports = {
  anthropic,
  MODELS,
  PRICING,
};
