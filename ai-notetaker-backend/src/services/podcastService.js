const { anthropic, MODELS } = require('../config/openai');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');
const aiService = require('./aiService');

class PodcastService {
  /**
   * Generate a podcast script from note content
   */
  async generatePodcastScript(userId, noteId, options = {}) {
    const { style = 'conversational', duration = 'medium' } = options;

    try {
      const note = await noteService.getNoteById(userId, noteId);
      if (!note) {
        throw new AppError('Note not found', 404);
      }

      const durationGuide = {
        short: '3-5 minutes (about 450-750 words)',
        medium: '5-10 minutes (about 750-1500 words)',
        long: '10-15 minutes (about 1500-2250 words)'
      };

      const styleGuide = {
        conversational: 'casual, friendly, and engaging - like talking to a friend',
        educational: 'clear, informative, and well-structured - like a lecture',
        storytelling: 'narrative-driven with anecdotes and examples',
        interview: 'Q&A format with host and expert perspectives'
      };

      const prompt = `Create a podcast script based on the following content. The style should be ${styleGuide[style]} and the duration should be ${durationGuide[duration]}.

Format the script with:
- [HOST]: for host dialogue
- [MUSIC]: for music cues
- [SFX]: for sound effects
- Scene breaks with "---"

Make it engaging, informative, and suitable for audio listening. Include an introduction, main content broken into segments, and a conclusion with key takeaways.

Content:
${note.content}`;

      const completion = await anthropic.messages.create({
        model: MODELS.GPT4_MINI,
        system: 'You are an expert podcast scriptwriter who creates engaging, well-paced audio content.',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: duration === 'long' ? 3000 : duration === 'medium' ? 2000 : 1000
      });

      const script = completion.content[0].text;

      // Extract segments from script
      const segments = this.parseScriptSegments(script);

      // Save AI content
      const aiContent = await aiService.saveAIContent(noteId, 'podcast', {
        script,
        segments,
        style,
        duration,
        model: MODELS.GPT4_MINI
      });

      // Log usage
      await aiService.logUsage(userId, 'podcast', completion.usage);

      logger.info('Podcast script generated', { userId, noteId, style, duration });

      return {
        id: aiContent.id,
        script,
        segments,
        style,
        duration,
        word_count: script.split(/\s+/).length,
        estimated_duration: this.estimateDuration(script),
        note_id: noteId
      };

    } catch (error) {
      logger.error('Error generating podcast', { error: error.message, userId, noteId });
      throw new AppError('Failed to generate podcast script', 500);
    }
  }

  /**
   * Parse script into segments for easier playback
   */
  parseScriptSegments(script) {
    const segments = [];
    const lines = script.split('\n');
    let currentSegment = {
      type: 'dialogue',
      speaker: 'HOST',
      content: ''
    };

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (!trimmedLine) continue;

      // Check for segment markers
      if (trimmedLine === '---') {
        if (currentSegment.content) {
          segments.push({ ...currentSegment });
        }
        currentSegment = {
          type: 'break',
          content: '---'
        };
        segments.push({ ...currentSegment });
        currentSegment = {
          type: 'dialogue',
          speaker: 'HOST',
          content: ''
        };
        continue;
      }

      // Check for speaker tags
      const speakerMatch = trimmedLine.match(/^\[([A-Z]+)\]:\s*(.*)/);
      if (speakerMatch) {
        if (currentSegment.content) {
          segments.push({ ...currentSegment });
        }
        
        const speaker = speakerMatch[1];
        const content = speakerMatch[2];
        
        currentSegment = {
          type: speaker === 'MUSIC' || speaker === 'SFX' ? 'audio_cue' : 'dialogue',
          speaker,
          content
        };
        continue;
      }

      // Add to current segment
      if (currentSegment.content) {
        currentSegment.content += ' ' + trimmedLine;
      } else {
        currentSegment.content = trimmedLine;
      }
    }

    // Add final segment
    if (currentSegment.content) {
      segments.push(currentSegment);
    }

    return segments;
  }

  /**
   * Estimate podcast duration based on word count
   * Average speaking rate: ~150 words per minute
   */
  estimateDuration(script) {
    const words = script.split(/\s+/).length;
    const minutes = Math.ceil(words / 150);
    return `${minutes} minutes`;
  }

  /**
   * Generate podcast with AI voices (Text-to-Speech)
   * This would use OpenAI's TTS API
   */
  async generatePodcastAudio(userId, scriptId) {
    try {
      // Get script
      const { data: aiContent, error } = await require('../config/supabase').supabase
        .from('ai_content')
        .select('*')
        .eq('id', scriptId)
        .eq('content_type', 'podcast')
        .single();

      if (error || !aiContent) {
        throw new AppError('Podcast script not found', 404);
      }

      // Verify ownership
      const note = await noteService.getNoteById(userId, aiContent.note_id);
      if (!note) {
        throw new AppError('Unauthorized', 403);
      }

      const script = aiContent.content.script;

      // Generate audio using ElevenLabs TTS via ttsService
      const ttsService = require('./ttsService');
      const audioBuffer = await ttsService.synthesize(script, { voice: 'alloy', speed: 1.0 });

      // Upload to storage
      const storageService = require('./storageService');
      const uploadResult = await storageService.uploadFile(
        userId,
        {
          buffer: audioBuffer,
          mimetype: 'audio/mpeg',
          originalname: 'podcast.mp3'
        },
        'podcasts'
      );

      logger.info('Podcast audio generated', { userId, scriptId });

      return {
        audio_url: uploadResult.url,
        audio_path: uploadResult.path,
        duration: this.estimateDuration(script)
      };

    } catch (error) {
      logger.error('Error generating podcast audio', { error: error.message, userId, scriptId });
      throw new AppError('Failed to generate podcast audio', 500);
    }
  }
}

module.exports = new PodcastService();
