/**
 * Script to generate onboarding sample podcast audio
 * Run with: node scripts/generate-onboarding-audio.js
 */

require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Biology podcast script - conversational style between two hosts
const BIOLOGY_PODCAST_SCRIPT = `
Host 1: Hey there! Welcome to another episode of Study Notes. Today we're diving into something super fascinating - cellular biology!

Host 2: Oh, I love this topic! We're talking about the building blocks of life itself. So let's start with the basics - what's the difference between prokaryotes and eukaryotes?

Host 1: Great question! So prokaryotes are like the simpler, more ancient cells. Think bacteria. They don't have a nucleus - their DNA just floats around in the cytoplasm.

Host 2: Right! And eukaryotes are more complex. These are the cells that make up plants, animals, fungi - even us! They have a proper nucleus with a membrane protecting their DNA.

Host 1: Exactly. And here's something cool - the mitochondria, often called the powerhouse of the cell, is found only in eukaryotic cells. It's what generates most of our cellular energy.

Host 2: Speaking of mitochondria - fun fact - scientists believe they were once separate organisms that got absorbed by larger cells billions of years ago! That's the endosymbiotic theory.

Host 1: Mind-blowing, right? So to summarize - prokaryotes are simple, no nucleus, like bacteria. Eukaryotes are complex, have a nucleus, and include all the multicellular organisms we see around us.

Host 2: Perfect breakdown! Thanks for joining us on Study Notes. Keep learning, keep growing!
`;

async function generateAudio() {
  console.log('🎙️ Generating onboarding sample podcast audio...');

  if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found in environment');
    process.exit(1);
  }

  try {
    // Clean the script for TTS
    const cleanScript = BIOLOGY_PODCAST_SCRIPT
      .replace(/Host \d+:/g, '') // Remove speaker labels
      .replace(/\n\n+/g, ' ') // Replace multiple newlines with space
      .trim();

    console.log(`📝 Script length: ${cleanScript.length} characters`);

    // Generate audio using OpenAI TTS
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd', // Use HD model for better quality
        input: cleanScript,
        voice: 'nova', // Nova has a natural, friendly voice
        response_format: 'mp3',
        speed: 1.0
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`TTS API error: ${error}`);
    }

    const audioBuffer = await response.buffer();
    console.log(`✅ Audio generated: ${(audioBuffer.length / 1024).toFixed(2)} KB`);

    // Save to file
    const outputPath = path.join(__dirname, '..', '..', 'ios', 'scribeai', 'Resources', 'onboarding_sample.mp3');

    // Ensure directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, audioBuffer);
    console.log(`💾 Audio saved to: ${outputPath}`);

    // Also save as m4a format for iOS compatibility
    const m4aOutputPath = outputPath.replace('.mp3', '.m4a');
    console.log(`\n⚠️ Note: You may need to convert ${outputPath} to m4a format for iOS.`);
    console.log(`   Or update the iOS code to load .mp3 instead of .m4a`);

    console.log('\n✅ Done! Make sure to add the audio file to your Xcode project.');

  } catch (error) {
    console.error('❌ Error generating audio:', error.message);
    process.exit(1);
  }
}

generateAudio();
