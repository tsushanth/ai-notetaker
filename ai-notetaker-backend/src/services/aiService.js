const { openai, MODELS, PRICING } = require('../config/openai');
const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');

/**
 * Maximum characters to send to AI (approximately 100K tokens = ~400K chars)
 * GPT-4's context is 128K tokens, we leave room for system prompts and response
 */
const MAX_CONTENT_CHARS = 350000;

/**
 * Truncate content to fit within token limits
 * Uses intelligent truncation: keeps beginning and samples from rest
 */
function truncateContent(content, maxChars = MAX_CONTENT_CHARS) {
  if (content.length <= maxChars) {
    return content;
  }

  // For very long content, keep the first 80% and last 10% of allowed chars
  const firstPart = Math.floor(maxChars * 0.85);
  const lastPart = Math.floor(maxChars * 0.10);

  const truncated = content.substring(0, firstPart) +
    '\n\n[... content truncated for length ...]\n\n' +
    content.substring(content.length - lastPart);

  logger.info('Content truncated for AI processing', {
    originalLength: content.length,
    truncatedLength: truncated.length,
    maxChars
  });

  return truncated;
}

/**
 * Get language instruction for AI prompts
 */
function getLanguageInstruction(language) {
  if (!language || language === 'english') {
    return '';
  }
  return `\n\nIMPORTANT: Respond entirely in ${language}. All output must be in ${language}.`;
}

class AIService {

  /**
   * Chat with note content
   */
  async chatWithNote(userId, noteId, question, conversationHistory = [], language = 'english') {
    try {
      // Get note content
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        throw new AppError('Note not found', 404);
      }

      // Build conversation messages
      const messages = [
        {
          role: 'system',
          content: `You are a helpful AI assistant helping a student understand their notes. Here are the notes:

${truncateContent(note.content)}

Answer questions based on these notes. Be concise, clear, and educational.${getLanguageInstruction(language)}`
        }
      ];

      // Add conversation history
      if (conversationHistory && conversationHistory.length > 0) {
        conversationHistory.forEach(msg => {
          messages.push({
            role: msg.isUser ? 'user' : 'assistant',
            content: msg.text
          });
        });
      }

      // Add current question
      messages.push({
        role: 'user',
        content: question
      });

      // Call OpenAI API
      const completion = await openai.chat.completions.create({
        model: MODELS.GPT4_MINI,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1024
      });

      const answer = completion.choices[0].message.content;

      // Log usage
      await this.logUsage(userId, 'chat', completion.usage);

      logger.info('Chat response generated', { userId, noteId });

      return {
        answer,
        note_id: noteId
      };

    } catch (error) {
      logger.error('Error in chat', { error: error.message, userId, noteId });
      throw new AppError('Failed to generate chat response', 500);
    }
  }

  /**
   * Generate chat suggestions based on note content
   */
  async generateChatSuggestions(userId, noteId, language = 'english') {
    try {
      logger.info('Generating chat suggestions', { userId, noteId, language });

      // Get note content
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        throw new AppError('Note not found', 404);
      }

      // Truncate content if too long (to save tokens)
      const truncatedContent = note.content.length > 3000
        ? note.content.substring(0, 3000) + '...'
        : note.content;

      const completion = await openai.chat.completions.create({
        model: MODELS.GPT4_MINI,
        messages: [
          {
            role: 'system',
            content: `You are helping a student understand their notes. Based on the content provided, generate exactly 3 thoughtful questions the student might want to ask about this material. The questions should:
- Be specific to the actual content
- Help deepen understanding
- Range from basic comprehension to analytical thinking

Return ONLY a JSON array of 3 strings, no other text. Example: ["Question 1?", "Question 2?", "Question 3?"]${getLanguageInstruction(language)}`
          },
          {
            role: 'user',
            content: `Here are the notes:\n\n${truncatedContent}`
          }
        ],
        temperature: 0.7,
        max_tokens: 300
      });

      const responseText = completion.choices[0].message.content.trim();

      // Parse JSON response
      let suggestions;
      try {
        suggestions = JSON.parse(responseText);
        if (!Array.isArray(suggestions)) {
          throw new Error('Response is not an array');
        }
        // Ensure we have exactly 3 suggestions
        suggestions = suggestions.slice(0, 3);
      } catch (parseError) {
        logger.warn('Failed to parse suggestions JSON, using fallback', { responseText });
        // Fallback: try to extract questions from text
        suggestions = [
          "What are the main concepts covered in these notes?",
          "Can you explain the key points in simpler terms?",
          "What are some practical applications of this material?"
        ];
      }

      // Log usage
      await this.logUsage(userId, 'suggestions', completion.usage);

      logger.info('Chat suggestions generated', { userId, noteId, count: suggestions.length });

      return {
        suggestions,
        note_id: noteId
      };

    } catch (error) {
      logger.error('Error generating suggestions', { error: error.message, userId, noteId });
      throw new AppError('Failed to generate suggestions', 500);
    }
  }

  /**
   * Generate summary from note content
   */
  async generateSummary(userId, noteId, options = {}) {
    const { length = 'medium', language = 'english' } = options;

    try {
      // Get note content
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        throw new AppError('Note not found', 404);
      }

      const lengthInstructions = {
        short: 'in 2-3 sentences',
        medium: 'in 1-2 paragraphs',
        long: 'in a detailed, comprehensive summary'
      };

      const prompt = `Please provide a ${length} summary of the following content ${lengthInstructions[length]}:\n\n${truncateContent(note.content)}`;

      const completion = await openai.chat.completions.create({
        model: MODELS.GPT4_MINI,
        messages: [
          {
            role: 'system',
            content: `You are a helpful assistant that creates clear, concise summaries of educational content.${getLanguageInstruction(language)}`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: length === 'long' ? 1000 : length === 'medium' ? 500 : 200
      });

      const summary = completion.choices[0].message.content;

      // Save AI content
      const aiContent = await this.saveAIContent(noteId, 'summary', {
        summary,
        length,
        model: MODELS.GPT4_MINI
      });

      // Log usage
      await this.logUsage(userId, 'summary', completion.usage);

      logger.info('Summary generated', { userId, noteId, length });

      return {
        id: aiContent.id,
        summary,
        length,
        note_id: noteId
      };

    } catch (error) {
      logger.error('Error generating summary', { error: error.message, userId, noteId });
      throw new AppError('Failed to generate summary', 500);
    }
  }

  /**
   * Generate quiz questions from note content
   */
  async generateQuiz(userId, noteId, options = {}) {
    const { difficulty = 'medium', num_questions = 5, language = 'english' } = options;

    logger.info('Generating quiz', { userId, noteId, difficulty, num_questions, language });

    try {
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        throw new AppError('Note not found', 404);
      }

      const prompt = `Create ${num_questions} ${difficulty} multiple-choice quiz questions based on the following content. 
      
Format your response as a JSON array with this structure:
[
  {
    "question": "Question text?",
    "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
    "correct_answer": "A",
    "explanation": "Brief explanation of why this is correct"
  }
]

Content:
${truncateContent(note.content)}`;

      const completion = await openai.chat.completions.create({
        model: MODELS.GPT4_MINI,
        messages: [
          {
            role: 'system',
            content: `You are an expert educator who creates engaging, educational quiz questions. Always respond with valid JSON only.${getLanguageInstruction(language)}`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      });

      const responseContent = completion.choices[0].message.content;
      let questions;
      
      try {
        const parsed = JSON.parse(responseContent);
        questions = parsed.questions || parsed;
      } catch {
        throw new AppError('Failed to parse quiz questions', 500);
      }

      // Save AI content
      const aiContent = await this.saveAIContent(noteId, 'quiz', {
        questions,
        difficulty,
        num_questions,
        model: MODELS.GPT4_MINI
      });

      // Log usage
      await this.logUsage(userId, 'quiz', completion.usage);

      logger.info('Quiz generated', { userId, noteId, num_questions });

      return {
        id: aiContent.id,
        questions,
        difficulty,
        note_id: noteId
      };

    } catch (error) {
      logger.error('Error generating quiz', { error: error.message, userId, noteId });
      throw new AppError('Failed to generate quiz', 500);
    }
  }

  /**
   * Generate flashcards from note content
   */
  async generateFlashcards(userId, noteId, options = {}) {
    // Support both 'num_cards' and 'count' for backwards compatibility
    const { num_cards, count, language = 'english' } = options;
    const cardCount = num_cards || count || 10;

    logger.info('Generating flashcards', { userId, noteId, options, num_cards, count, cardCount });

    try {
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        throw new AppError('Note not found', 404);
      }

      const prompt = `Create ${cardCount} flashcards based on the following content. Each flashcard should have a front (question/term) and back (answer/definition).

Format your response as a JSON array with this structure:
[
  {
    "front": "Question or term",
    "back": "Answer or definition"
  }
]

Content:
${truncateContent(note.content)}`;

      // Scale max_tokens based on card count (approximately 100 tokens per card)
      const maxTokens = Math.min(Math.max(cardCount * 100, 1500), 4000);

      const completion = await openai.chat.completions.create({
        model: MODELS.GPT4_MINI,
        messages: [
          {
            role: 'system',
            content: `You are an expert educator who creates effective flashcards for studying. Always respond with valid JSON only. You MUST create exactly ${cardCount} flashcards - no more, no less.${getLanguageInstruction(language)}`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' }
      });

      const responseContent = completion.choices[0].message.content;
      let flashcards;
      
      try {
        const parsed = JSON.parse(responseContent);
        flashcards = parsed.flashcards || parsed.cards || parsed;
      } catch {
        throw new AppError('Failed to parse flashcards', 500);
      }

      // Save AI content
      const aiContent = await this.saveAIContent(noteId, 'flashcards', {
        flashcards,
        num_cards: cardCount,
        model: MODELS.GPT4_MINI
      });

      // Log usage
      await this.logUsage(userId, 'flashcards', completion.usage);

      logger.info('Flashcards generated', { userId, noteId, num_cards: cardCount });

      return {
        id: aiContent.id,
        flashcards,
        note_id: noteId
      };

    } catch (error) {
      logger.error('Error generating flashcards', { error: error.message, userId, noteId });
      throw new AppError('Failed to generate flashcards', 500);
    }
  }

  /**
   * Generate interactive mind map from note content
   * Returns a structured JSON mind map with nodes and connections
   */
  async generateMindMap(userId, noteId, options = {}) {
    const { language = 'english', includeExploration = true } = options;

    try {
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        throw new AppError('Note not found', 404);
      }

      const explorationInstruction = includeExploration
        ? `Additionally, for some key concepts, suggest 1-2 "exploratory" child nodes that go beyond the source material to help deepen understanding. Mark these with "isExploratory": true.`
        : '';

      const prompt = `Analyze the following content and create an interactive mind map structure. The mind map should:
1. Have a central topic node representing the main subject
2. Have 3-6 main branches representing key themes/topics
3. Each main branch should have 2-4 child nodes with supporting details
4. Keep labels concise (2-5 words) but include a longer "content" field for detail
5. Assign each main branch a different color from this palette: ["#BB86FC", "#03DAC6", "#CF6679", "#FF7597", "#FFB74D", "#81C784"]
${explorationInstruction}

Return ONLY valid JSON in this exact structure:
{
  "title": "Central Topic",
  "nodes": [
    {
      "id": "1",
      "label": "Short Label",
      "content": "Detailed explanation of this concept",
      "level": 0,
      "parentId": null,
      "color": "#BB86FC",
      "isExploratory": false
    },
    {
      "id": "1.1",
      "label": "Child Label",
      "content": "More detail about this subtopic",
      "level": 1,
      "parentId": "1",
      "color": "#BB86FC",
      "isExploratory": false
    }
  ]
}

Content to analyze:
${truncateContent(note.content)}`;

      const completion = await openai.chat.completions.create({
        model: MODELS.GPT4_MINI,
        messages: [
          {
            role: 'system',
            content: `You are an expert educator who creates clear, visually organized mind maps for studying. Create hierarchical structures that help visual learners understand and remember content. Always respond with valid JSON only.${getLanguageInstruction(language)}`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 3000,
        response_format: { type: 'json_object' }
      });

      const responseContent = completion.choices[0].message.content;
      let mindMapData;

      try {
        mindMapData = JSON.parse(responseContent);
      } catch {
        throw new AppError('Failed to parse mind map data', 500);
      }

      // Save AI content
      const aiContent = await this.saveAIContent(noteId, 'mindmap', {
        title: mindMapData.title,
        nodes: mindMapData.nodes,
        model: MODELS.GPT4_MINI
      });

      // Log usage
      await this.logUsage(userId, 'mindmap', completion.usage);

      logger.info('Mind map generated', { userId, noteId, nodeCount: mindMapData.nodes?.length });

      return {
        id: aiContent.id,
        title: mindMapData.title,
        nodes: mindMapData.nodes,
        note_id: noteId
      };

    } catch (error) {
      logger.error('Error generating mind map', { error: error.message, userId, noteId });
      throw new AppError('Failed to generate mind map', 500);
    }
  }

  /**
   * Generate visual learning diagram in Mermaid format
   */
  async generateDiagram(userId, noteId, options = {}) {
    const { style = 'flowchart', language = 'english' } = options;

    try {
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        throw new AppError('Note not found', 404);
      }

      const prompt = `Create a ${style} diagram in Mermaid syntax to visualize the key concepts from the following content. The diagram should help with visual learning and understanding relationships between concepts.

Return ONLY the Mermaid syntax, starting with the diagram type (e.g., "graph TD" or "mindmap" or "sequenceDiagram").

Content:
${note.content.substring(0, 3000)}`; // Limit content length

      const completion = await openai.chat.completions.create({
        model: MODELS.GPT4_MINI,
        messages: [
          {
            role: 'system',
            content: `You are an expert at creating educational diagrams using Mermaid syntax. Return only valid Mermaid syntax.${getLanguageInstruction(language)}`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.5,
        max_tokens: 1500
      });

      let diagram = completion.choices[0].message.content.trim();
      
      // Remove markdown code fences if present
      diagram = diagram.replace(/```mermaid\n?/g, '').replace(/```\n?/g, '').trim();

      // Save AI content
      const aiContent = await this.saveAIContent(noteId, 'diagram', {
        diagram,
        style,
        model: MODELS.GPT4_MINI
      });

      // Log usage
      await this.logUsage(userId, 'diagram', completion.usage);

      logger.info('Diagram generated', { userId, noteId, style });

      return {
        id: aiContent.id,
        diagram,
        style,
        note_id: noteId
      };

    } catch (error) {
      logger.error('Error generating diagram', { error: error.message, userId, noteId });
      throw new AppError('Failed to generate diagram', 500);
    }
  }

  /**
   * Generate podcast script from note content
   */
  async generatePodcast(userId, noteId, options = {}) {
    const { 
      duration = 'medium', 
      style = 'conversational',
      num_hosts = 2,
      generate_audio = true,
      voice = 'alloy',
      language = 'english'
    } = options;

    try {
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        throw new AppError('Note not found', 404);
      }

      const durationConfig = {
        short: { minutes: '3-5', words: 600, minWords: 500 },
        medium: { minutes: '8-12', words: 1400, minWords: 1200 },
        long: { minutes: '15-20', words: 2500, minWords: 2000 }
      };

      const config = durationConfig[duration] || durationConfig.medium;

      const styleInstructions = {
        conversational: 'Create a natural, engaging conversation between hosts with back-and-forth dialogue, enthusiasm, and occasional interjections.',
        educational: 'Create an educational podcast with clear explanations, examples, and teaching moments.',
        storytelling: 'Create a narrative-driven podcast that tells a compelling story around the content.',
        interview: 'Create an interview-style podcast where one host asks insightful questions and the other provides detailed answers.'
      };

      const prompt = `Create a ${config.minutes} minute podcast script based on the following content. ${styleInstructions[style]}

CRITICAL LENGTH REQUIREMENT: The script MUST be approximately ${config.words} words (minimum ${config.minWords} words). This is essential for achieving the ${config.minutes} minute runtime. Do NOT create a shorter script.

The podcast should have ${num_hosts} host(s). Use clear speaker labels like "Host 1:" and "Host 2:".

Guidelines:
- Make it engaging and natural with rich dialogue
- Include smooth transitions between topics
- Add appropriate energy and enthusiasm
- Use examples, analogies, and elaborations to reach the target length
- Include follow-up questions and detailed explanations
- End with a strong conclusion summarizing key takeaways
- IMPORTANT: Write a COMPLETE script that fills the full ${config.minutes} minute runtime

Content to discuss:
${truncateContent(note.content)}

Format the script with clear speaker labels and natural dialogue. Remember: the script must be at least ${config.minWords} words to achieve the desired podcast length.`;

      const completion = await openai.chat.completions.create({
        model: MODELS.GPT4_MINI,
        messages: [
          {
            role: 'system',
            content: `You are an expert podcast scriptwriter who creates engaging, natural-sounding podcast scripts. Write dialogue that sounds authentic and conversational.${getLanguageInstruction(language)}`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.9,
        max_tokens: duration === 'long' ? 6000 : duration === 'medium' ? 4000 : 2000
      });

      const script = completion.choices[0].message.content;

      // Prepare content object
      const contentData = {
        script,
        duration,
        style,
        num_hosts,
        model: MODELS.GPT4_MINI
      };

      // Generate audio if requested
      if (generate_audio) {
        try {
          logger.info('Generating podcast audio', { userId, noteId });
          
          const ttsService = require('./ttsService');
          
          // Generate audio from script
          const audioBuffer = await ttsService.generateAudio(script, voice);
          
          // Upload to Supabase storage
          const audioUrl = await ttsService.uploadAudio(audioBuffer, userId, noteId);
          
          contentData.audio_url = audioUrl;
          
          logger.info('Podcast audio generated', { userId, noteId, audioUrl });
        } catch (audioError) {
          logger.error('Failed to generate podcast audio', { 
            error: audioError.message, 
            userId, 
            noteId 
          });
          // Continue without audio - don't fail the whole request
          contentData.audio_generation_failed = true;
        }
      }

      // Save AI content
      const aiContent = await this.saveAIContent(noteId, 'podcast', contentData);

      // Log usage
      await this.logUsage(userId, 'podcast', completion.usage);

      logger.info('Podcast script generated', { 
        userId, 
        noteId, 
        duration, 
        style,
        hasAudio: !!contentData.audio_url
      });

      return {
        id: aiContent.id,
        script,
        audio_url: contentData.audio_url,
        duration,
        style,
        note_id: noteId
      };

    } catch (error) {
      logger.error('Error generating podcast', { 
        error: error.message, 
        userId, 
        noteId 
      });
      throw new AppError('Failed to generate podcast', 500);
    }
  }

  /**
   * Generate infographic image using DALL-E 3
   * Creates a visually rich infographic summarizing key concepts
   */
  async generateInfographic(userId, noteId, options = {}) {
    const { style = 'modern', language = 'english' } = options;

    try {
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        throw new AppError('Note not found', 404);
      }

      // Step 1: Extract key information for the infographic using GPT
      const extractionPrompt = `Analyze the following content and extract the most important information for creating a visual infographic.

Return a JSON object with:
{
  "title": "A compelling, concise title (max 8 words)",
  "subtitle": "A brief subtitle or tagline (max 12 words)",
  "key_stats": [{"value": "number or short text", "label": "description"}], // 2-4 important statistics or facts
  "main_sections": [{"title": "section title", "points": ["point 1", "point 2"]}], // 2-3 main topic sections with 2-3 bullet points each
  "key_takeaway": "The single most important conclusion or insight (1 sentence)"
}

Content to analyze:
${truncateContent(note.content, 8000)}`;

      const extractionCompletion = await openai.chat.completions.create({
        model: MODELS.GPT4_MINI,
        messages: [
          {
            role: 'system',
            content: `You are an expert at distilling complex information into clear, visual-friendly summaries for infographics. Extract only the most impactful information. Always respond with valid JSON only.${getLanguageInstruction(language)}`
          },
          {
            role: 'user',
            content: extractionPrompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: 'json_object' }
      });

      let extractedData;
      try {
        extractedData = JSON.parse(extractionCompletion.choices[0].message.content);
      } catch {
        throw new AppError('Failed to extract infographic data', 500);
      }

      // Log extraction usage
      await this.logUsage(userId, 'infographic_extraction', extractionCompletion.usage);

      // Step 2: Generate the infographic image using DALL-E 3
      const styleDescriptions = {
        modern: 'clean modern design with gradient backgrounds, rounded shapes, and sans-serif typography',
        colorful: 'vibrant colorful design with bold colors, playful icons, and dynamic layouts',
        minimal: 'minimalist design with plenty of white space, subtle colors, and elegant typography',
        professional: 'professional corporate style with structured layout, muted colors, and clear hierarchy'
      };

      const styleDesc = styleDescriptions[style] || styleDescriptions.modern;

      // Build the DALL-E prompt
      const dallePrompt = `Create a professional educational infographic with ${styleDesc}.

Title: "${extractedData.title}"
${extractedData.subtitle ? `Subtitle: "${extractedData.subtitle}"` : ''}

The infographic should include:
- A clear visual hierarchy with the title at the top
- ${extractedData.key_stats?.length || 0} highlighted statistics/facts shown as large numbers with icons
- ${extractedData.main_sections?.length || 0} distinct sections with icons representing each topic
- Visual elements like icons, simple illustrations, arrows, and connecting lines
- A "Key Takeaway" section at the bottom

Design requirements:
- Use a cohesive color palette (2-3 main colors plus accent)
- Include relevant simple icons/illustrations for each section
- Text should be readable and well-spaced
- Professional infographic layout similar to NotebookLM or Canva infographics
- Portrait orientation (taller than wide)
- High contrast for readability

Style: Educational study material infographic, clean and modern`;

      logger.info('Generating infographic with DALL-E 3', { userId, noteId, style });

      let imageResponse;
      try {
        imageResponse = await openai.images.generate({
          model: MODELS.DALLE3,
          prompt: dallePrompt,
          n: 1,
          size: '1024x1792', // Portrait orientation for infographics
          quality: 'hd',
          style: 'vivid'
        });
      } catch (dalleError) {
        logger.error('DALL-E 3 image generation failed', {
          error: dalleError.message,
          code: dalleError.code,
          userId,
          noteId
        });
        throw dalleError;
      }

      const imageUrl = imageResponse.data[0].url;
      const revisedPrompt = imageResponse.data[0].revised_prompt;
      logger.info('DALL-E 3 image generated successfully', { userId, noteId, imageUrl: imageUrl.substring(0, 50) + '...' });

      // Step 3: Upload the image to Supabase storage for persistence
      // DALL-E URLs expire, so we need to download and store
      const fetch = require('node-fetch');
      let imageResponseData;
      try {
        imageResponseData = await fetch(imageUrl);
        if (!imageResponseData.ok) {
          throw new Error(`Failed to download image: ${imageResponseData.status}`);
        }
      } catch (fetchError) {
        logger.error('Failed to download DALL-E image', { error: fetchError.message, userId, noteId });
        throw new AppError('Failed to download generated image', 500);
      }

      const imageBuffer = Buffer.from(await imageResponseData.arrayBuffer());

      const { supabaseAdmin } = require('../config/supabase');
      const fileName = `infographics/${userId}/${noteId}/${Date.now()}.png`;

      const { error: uploadError } = await supabaseAdmin
        .storage
        .from('notetaker-files')
        .upload(fileName, imageBuffer, {
          contentType: 'image/png',
          upsert: true
        });

      if (uploadError) {
        logger.error('Failed to upload infographic to storage', { error: uploadError.message });
        throw new AppError('Failed to save infographic', 500);
      }

      // Get public URL
      const { data: urlData } = supabaseAdmin
        .storage
        .from('notetaker-files')
        .getPublicUrl(fileName);

      const permanentUrl = urlData.publicUrl;

      // Save AI content
      const aiContent = await this.saveAIContent(noteId, 'infographic', {
        image_url: permanentUrl,
        extracted_data: extractedData,
        style,
        revised_prompt: revisedPrompt,
        model: MODELS.DALLE3
      });

      // Log image generation usage
      await this.logImageUsage(userId, 'infographic', '1024x1792');

      logger.info('Infographic generated successfully', {
        userId,
        noteId,
        style,
        contentId: aiContent.id
      });

      return {
        id: aiContent.id,
        image_url: permanentUrl,
        extracted_data: extractedData,
        style,
        note_id: noteId
      };

    } catch (error) {
      logger.error('Error generating infographic', {
        error: error.message,
        stack: error.stack,
        userId,
        noteId,
        errorCode: error.code,
        errorType: error.constructor.name
      });
      if (error instanceof AppError) throw error;

      // Provide more specific error messages
      if (error.code === 'content_policy_violation') {
        throw new AppError('Content not suitable for image generation', 400);
      }
      if (error.code === 'rate_limit_exceeded') {
        throw new AppError('Too many requests. Please try again later.', 429);
      }
      if (error.message?.includes('billing') || error.message?.includes('quota')) {
        throw new AppError('Image generation service temporarily unavailable', 503);
      }

      throw new AppError(`Failed to generate infographic: ${error.message}`, 500);
    }
  }

  /**
   * Log image generation usage for tracking
   */
  async logImageUsage(userId, actionType, size) {
    try {
      const pricing = PRICING[MODELS.DALLE3]?.perImage || {};
      const cost = pricing[size] || 0.04;

      await supabaseAdmin
        .from('usage_logs')
        .insert({
          user_id: userId,
          action_type: actionType,
          tokens_used: 0, // Images don't use tokens
          cost_usd: cost,
          metadata: {
            model: MODELS.DALLE3,
            size,
            type: 'image_generation'
          }
        });
    } catch (error) {
      logger.warn('Failed to log image usage', { error: error.message });
    }
  }

  /**
   * Get the most recent podcast for a note
   */
  async getLatestPodcastForNote(userId, noteId) {
    try {
      // Verify note belongs to user
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        return null;
      }

      const { data, error } = await supabaseAdmin
        .from('ai_content')
        .select('*')
        .eq('note_id', noteId)
        .eq('content_type', 'podcast')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error fetching latest podcast', { error: error.message, userId, noteId });
      return null;
    }
  }

  /**
   * Get all AI-generated content for a note
   */
  async getAIContentForNote(userId, noteId) {
    try {
      // Verify note belongs to user
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        throw new AppError('Note not found', 404);
      }

      const { data, error } = await supabaseAdmin
        .from('ai_content')
        .select('*')
        .eq('note_id', noteId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Log the order of content for debugging
      if (data && data.length > 0) {
        logger.info('AI content order debug', {
          noteId,
          itemCount: data.length,
          items: data.map(item => ({
            type: item.content_type,
            created_at: item.created_at,
            id: item.id
          }))
        });
      }

      // Transform ai_content to ensure proper structure for Android/iOS clients
      const transformedData = (data || []).map(item => {
        const content = item.content || {};

        // For quiz content, ensure questions are properly wrapped
        if (item.content_type === 'quiz' && content.questions) {
          if (Array.isArray(content.questions)) {
            content.questions = { quiz_questions: content.questions };
          }
        }

        // Add note_id and id to content for consistency
        content.note_id = content.note_id || item.note_id;
        content.id = content.id || item.id;

        return {
          ...item,
          content
        };
      });

      return transformedData;
    } catch (error) {
      logger.error('Error fetching AI content', { error: error.message, userId, noteId });
      throw new AppError('Failed to fetch AI content', 500);
    }
  }

  /**
   * Delete AI-generated content
   */
  async deleteAIContent(userId, contentId) {
    try {
      // Verify content belongs to user's note
      const { data: content } = await supabaseAdmin
        .from('ai_content')
        .select('note_id')
        .eq('id', contentId)
        .single();

      if (!content) return false;

      const note = await noteService.getNoteById(userId, content.note_id);
      if (!note) return false;

      const { error } = await supabaseAdmin
        .from('ai_content')
        .delete()
        .eq('id', contentId);

      if (error) throw error;

      logger.info('AI content deleted', { userId, contentId });
      return true;
    } catch (error) {
      logger.error('Error deleting AI content', { error: error.message, userId, contentId });
      throw new AppError('Failed to delete AI content', 500);
    }
  }

  /**
   * Save AI-generated content to database
   */
  async saveAIContent(noteId, contentType, content) {
    const { data, error } = await supabaseAdmin
      .from('ai_content')
      .insert({
        note_id: noteId,
        content_type: contentType,
        content
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  }

  /**
   * Log API usage for tracking
   */
  async logUsage(userId, actionType, usage) {
    try {
      const tokensUsed = usage.total_tokens || 0;
      const model = MODELS.GPT4_MINI;
      const pricing = PRICING[model] || { input: 0, output: 0 };
      
      const cost = (
        (usage.prompt_tokens || 0) * pricing.input / 1000 +
        (usage.completion_tokens || 0) * pricing.output / 1000
      );

      await supabaseAdmin
        .from('usage_logs')
        .insert({
          user_id: userId,
          action_type: actionType,
          tokens_used: tokensUsed,
          cost_usd: cost,
          metadata: {
            model,
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens
          }
        });
    } catch (error) {
      logger.warn('Failed to log usage', { error: error.message });
    }
  }
}

module.exports = new AIService();