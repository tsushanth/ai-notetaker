const Joi = require('joi');

/**
 * Validation schemas for different endpoints
 */
const schemas = {
  createNote: Joi.object({
    title: Joi.string().min(1).max(500).required(),
    content: Joi.string().min(1).required(),
    source_type: Joi.string().valid('recording', 'pdf', 'video', 'slideshow', 'manual'),
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
    content_type: Joi.string().valid('summary', 'quiz', 'flashcards', 'podcast', 'diagram').required(),
    options: Joi.object({
      length: Joi.string().valid('short', 'medium', 'long'),
      difficulty: Joi.string().valid('easy', 'medium', 'hard'),
      num_questions: Joi.number().min(1).max(50),
      num_cards: Joi.number().min(1).max(100),
      style: Joi.string(),
      language: Joi.string().valid('english', 'spanish', 'french', 'german', 'portuguese', 'italian', 'chinese', 'japanese', 'korean', 'hindi').default('english')
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
    language: Joi.string().valid('english', 'spanish', 'french', 'german', 'portuguese', 'italian', 'chinese', 'japanese', 'korean', 'hindi').default('english'),
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
