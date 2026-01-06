const Joi = require('joi');

/**
 * Supported languages for AI-generated content
 * Matches iOS and Android client language lists
 */
const SUPPORTED_LANGUAGES = [
  // Major World Languages
  'english', 'spanish', 'french', 'german', 'portuguese', 'italian',
  'chinese', 'chinese_traditional', 'japanese', 'korean',
  // South Asian Languages
  'hindi', 'bengali', 'tamil', 'telugu', 'urdu', 'marathi', 'gujarati', 'punjabi',
  // European Languages
  'dutch', 'polish', 'russian', 'ukrainian', 'swedish', 'norwegian',
  'danish', 'finnish', 'greek', 'czech', 'romanian', 'hungarian',
  // Middle Eastern & African Languages
  'arabic', 'hebrew', 'turkish', 'persian', 'swahili',
  // Southeast Asian Languages
  'thai', 'vietnamese', 'indonesian', 'malay', 'tagalog'
];

/**
 * Validation schemas for different endpoints
 */
const schemas = {
  createNote: Joi.object({
    title: Joi.string().min(1).max(500).required(),
    content: Joi.string().min(1).required(),
    source_type: Joi.string().valid('recording', 'pdf', 'video', 'slideshow', 'manual', 'scan', 'meeting', 'docx', 'txt', 'document', 'text', 'tutorial'),
    source_url: Joi.string().uri().allow('', null),
    metadata: Joi.object().default({})
  }),

  updateNote: Joi.object({
    title: Joi.string().min(1).max(500),
    content: Joi.string().min(1),
    metadata: Joi.object()
  }).min(1),

  generateAIContent: Joi.object({
    note_id: Joi.string().uuid().required(),
    // content_type is optional because specific endpoints like /flashcards, /quiz, etc.
    // already know the type from the URL. Only required for generic /generate endpoint.
    content_type: Joi.string().valid('summary', 'quiz', 'flashcards', 'podcast', 'diagram', 'mindmap', 'infographic'),
    options: Joi.object({
      length: Joi.string().valid('short', 'medium', 'long'),
      difficulty: Joi.string().valid('easy', 'medium', 'hard'),
      num_questions: Joi.number().min(1).max(50),
      num_cards: Joi.number().min(1).max(100),
      count: Joi.number().min(1).max(100), // Alias for num_cards (iOS uses this)
      style: Joi.string().valid('flowchart', 'mindmap', 'sequenceDiagram', 'modern', 'colorful', 'minimal', 'professional'), // diagram and infographic styles
      language: Joi.string().valid(...SUPPORTED_LANGUAGES).default('english'),
      generate_audio: Joi.boolean(),
      duration: Joi.string().valid('short', 'medium', 'long'),
      voice: Joi.string(),
      instructions: Joi.string().max(500),
      includeExploration: Joi.boolean() // Mind map option
    }).default({})
  }),

  processVideoUrl: Joi.object({
    url: Joi.string().uri().required(),
    title: Joi.string().min(1).max(500).optional()
  }),

  transcribeAudio: Joi.object({
    recording_id: Joi.string().uuid().required()
  }),

  chatWithNote: Joi.object({
    note_id: Joi.string().uuid().required(),
    question: Joi.string().min(1).max(1000).required(),
    language: Joi.string().valid(...SUPPORTED_LANGUAGES).default('english'),
    conversation_history: Joi.array().items(
      Joi.object({
        text: Joi.string().required(),
        isUser: Joi.boolean().required()
      })
    ).optional()
  })
};

/**
 * Middleware factory for validating request body
 */
const validate = (schemaName) => {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    
    if (!schema) {
      return res.status(500).json({
        success: false,
        error: 'Validation schema not found'
      });
    }

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: errorMessage
      });
    }

    req.validatedBody = value;
    next();
  };
};

module.exports = { validate, schemas };
