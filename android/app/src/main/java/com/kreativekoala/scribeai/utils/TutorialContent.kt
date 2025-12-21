// utils/TutorialContent.kt

package com.kreativekoala.scribeai.utils

import com.kreativekoala.scribeai.data.models.Note
import com.kreativekoala.scribeai.data.models.AIContent
import com.kreativekoala.scribeai.data.models.QuizQuestion
import com.kreativekoala.scribeai.data.models.Flashcard
import com.kreativekoala.scribeai.data.models.AIContentData

/**
 * Pre-generated tutorial note with all AI features included
 * This allows users to explore all features immediately
 */
object TutorialContent {

    const val TUTORIAL_ID = "00000000-0000-0000-0000-000000000001"
    const val TUTORIAL_TITLE = "Welcome to Scribe AI 👋"

    const val TUTORIAL_CONTENT = """# Welcome to Scribe AI 👋

Transform your lectures, videos, and documents into smart study materials powered by AI.

---

## 🚀 Getting Started

Scribe AI makes it easy to create study notes from any source. Here's what you can do:

### 📱 Record or Upload Audio
Record lectures directly in the app or upload existing audio files. Our AI will transcribe and summarize everything for you.

**How to use:**
1. Tap the + button on the home screen
2. Select "Record or upload audio"
3. Record live or upload an audio file
4. Wait for AI transcription (usually 30-60 seconds)

### 🎥 YouTube Videos
Got a great educational video? Just paste the YouTube link and Scribe AI will extract the transcript and create notes.

**Requirements:**
- Video must have captions/subtitles enabled
- Works with auto-generated or manual captions
- Supports most public YouTube videos

**How to use:**
1. Tap the + button
2. Select "YouTube video"
3. Paste the video URL
4. Generate notes instantly

### 📄 Upload Documents
Upload PDFs, Word docs, PowerPoint slides, or any text document. Scribe AI will analyze and organize the content.

**Supported formats:**
- PDF documents
- Word documents (DOCX)
- PowerPoint presentations (PPTX)
- Plain text files (TXT)
- And more!

### 📸 Scan Documents
Use your camera to scan physical documents, handwritten notes, or textbooks. Our OCR technology extracts the text automatically.

**Tips for best results:**
- Good lighting conditions
- Clear focus on text
- Flat, unwrinkled pages
- Dark text on light background

---

## ✨ AI-Powered Features

Once you've created a note, explore these powerful AI features accessible through the tabs at the top:

### 📝 Summary Tab
Generate concise summaries of your notes in three lengths:
- **Short**: Quick overview (2-3 paragraphs)
- **Medium**: Balanced summary (4-6 paragraphs)  
- **Long**: Detailed analysis (8+ paragraphs)

Perfect for quick review before exams!

### 🎙️ Podcast Tab
Convert your notes into an audio podcast! Listen while commuting, exercising, or relaxing.

**Features:**
- Natural-sounding AI voice
- Adjustable playback speed
- Perfect for auditory learners
- Listen on-the-go

### ❓ Quiz Tab
Test your knowledge with AI-generated multiple-choice quizzes based on your notes.

**What you get:**
- Multiple-choice questions
- Covers key concepts from your notes
- Instant feedback
- Perfect for exam preparation

### 💬 Chat Tab
Ask questions about your notes! Our AI assistant can:
- Explain complex concepts
- Provide examples
- Answer specific questions
- Help you understand difficult topics
- Use voice input for hands-free interaction

### 🎴 Flashcards Tab
Generate flashcards automatically for effective studying using spaced repetition.

**Features:**
- Question on front, answer on back
- Tap to flip cards
- Perfect for memorization
- Export for later review

---

## 💎 Free vs Pro

### Free Plan (1 Notebook)
- Create 1 notebook
- All AI features included
- Record audio
- Scan documents
- Upload files

### Pro Plan (Unlimited)
- **Unlimited notebooks**
- All AI features
- Priority processing
- Faster response times
- Support future development

**Upgrade anytime** by tapping the upgrade button in the menu!

---

## 📚 Best Practices

### For Students
1. Record every lecture
2. Generate summaries for quick review
3. Use quizzes before exams
4. Create flashcards for memorization
5. Chat with notes to clarify concepts

### For Professionals
1. Record meetings and presentations
2. Upload training materials
3. Generate summaries for reports
4. Use podcasts for commute learning
5. Create reference flashcards

### For Researchers
1. Upload research papers (PDFs)
2. Generate summaries of key findings
3. Use chat to explore concepts
4. Create flashcards for terminology
5. Generate quizzes for comprehension

---

## 🎯 Tips for Success

### Recording Tips
- Use a quiet environment
- Speak clearly and at moderate pace
- Keep phone close to speaker
- Use external mic for better quality

### Document Upload Tips
- Ensure text is readable
- Use clear scans (300 DPI+)
- Remove any watermarks
- Text-based PDFs work best

### Getting Better AI Results
- Provide clear, structured content
- Break long content into smaller notes
- Use descriptive titles
- Review AI outputs and regenerate if needed

---

## 🔒 Privacy & Security

- Your notes are private and encrypted
- AI processing happens securely
- We never share your data
- You can delete notes anytime
- Export your data when needed

---

## 🎓 Start Learning!

You're all set! Try exploring the tabs above to see each AI feature in action:

1. **Summary** - See a short summary of this tutorial
2. **Podcast** - Listen to this tutorial as audio
3. **Quiz** - Test your knowledge about Scribe AI
4. **Chat** - Ask questions about the features
5. **Flashcards** - Study key concepts

**Ready to create your first note?** Tap the + button on the home screen!

---

## 💡 Need Help?

- Check the tabs above to explore features
- Try the Chat tab to ask questions
- Visit Settings for more options
- Contact support if you need assistance

Welcome aboard, and happy learning! 🚀📚
"""

    // Pre-generated SHORT summary
    const val TUTORIAL_SUMMARY_SHORT = """Scribe AI transforms your lectures, videos, and documents into smart study materials using AI. 

Create notes by recording audio, uploading YouTube videos, scanning documents, or uploading files (PDF, DOCX, PPTX). Once created, use powerful AI features: generate summaries in three lengths, convert notes to podcasts, take AI-generated quizzes, chat with your notes to ask questions, and create flashcards for memorization.

The free plan includes 1 notebook with all features. Upgrade to Pro for unlimited notebooks. Start by tapping the + button to create your first note!"""

    // Pre-generated MEDIUM summary
    const val TUTORIAL_SUMMARY_MEDIUM = """Scribe AI is your AI-powered study companion that transforms any content into structured, interactive learning materials.

**Creating Notes:**
You can create notes from multiple sources: record or upload audio for automatic transcription, paste YouTube video links (with captions), upload documents (PDF, DOCX, PPTX, TXT), or scan physical documents using your camera with OCR technology.

**AI Features:**
Once you've created a note, explore five powerful AI features through the tabs:
- Summary: Generate concise overviews in short, medium, or long formats
- Podcast: Convert notes to audio for on-the-go learning
- Quiz: Test knowledge with AI-generated multiple-choice questions
- Chat: Ask questions and get explanations about your notes
- Flashcards: Create flip cards for effective memorization

**Plans:**
Free users get 1 notebook with all AI features. Pro users get unlimited notebooks, priority processing, and faster response times.

**Best Practices:**
For best results, use quiet environments for recording, ensure good lighting for scans, and provide clear, structured content. Your data is private, encrypted, and never shared.

Ready to start? Tap the + button on your home screen to create your first note!"""

    // Pre-generated LONG summary
    const val TUTORIAL_SUMMARY_LONG = """Welcome to Scribe AI, your comprehensive AI-powered study companion designed to transform any educational content into structured, interactive learning materials.

**Content Creation Methods:**
Scribe AI offers four versatile ways to create study notes:

1. Audio Recording & Upload: Record lectures directly in the app or upload existing audio files. The AI transcribes and summarizes content automatically, typically in 30-60 seconds. For best results, use quiet environments and keep your device close to the speaker.

2. YouTube Integration: Extract transcripts from educational videos by simply pasting the URL. The feature supports videos with auto-generated or manual captions. Most public educational content works seamlessly.

3. Document Upload: Import PDFs, Word documents (DOCX), PowerPoint presentations (PPTX), and text files (TXT). The AI analyzes and organizes the content for easy studying. Text-based PDFs and clear scans (300 DPI+) work best.

4. Document Scanning: Use your camera to scan physical materials like textbooks, handwritten notes, or printed documents. OCR technology extracts text automatically. Ensure good lighting, clear focus, and flat pages for optimal results.

**AI-Powered Learning Features:**
After creating a note, access five powerful AI features through the tabbed interface:

- Summary Tab: Generate summaries in three customizable lengths. Short summaries (2-3 paragraphs) provide quick overviews perfect for last-minute review. Medium summaries (4-6 paragraphs) offer balanced coverage of main points. Long summaries (8+ paragraphs) deliver detailed analysis with comprehensive explanations.

- Podcast Tab: Convert written notes into natural-sounding audio podcasts. Perfect for auditory learners or studying while commuting, exercising, or multitasking. Features include adjustable playback speed and high-quality AI voices.

- Quiz Tab: Test comprehension with automatically generated multiple-choice questions based on your note content. Questions cover key concepts and provide instant feedback, making them ideal for exam preparation and knowledge retention checks.

- Chat Tab: Interact with an AI assistant that has full context of your notes. Ask questions about complex concepts, request examples, seek clarifications, or explore related topics. Voice input is supported for hands-free interaction.

- Flashcards Tab: Generate digital flashcards automatically with questions on the front and answers on the back. Tap to flip cards and use spaced repetition for effective memorization. Perfect for learning terminology, definitions, and key facts.

**Subscription Plans:**
The Free plan includes 1 notebook with complete access to all AI features—summaries, podcasts, quizzes, chat, and flashcards. This lets you fully experience Scribe AI's capabilities.

The Pro plan unlocks unlimited notebooks, priority processing for faster AI generation, improved response times, and helps support ongoing development and new features.

**Best Practices by User Type:**

Students should record every lecture, generate summaries for efficient review sessions, use quizzes before exams, create flashcards for memorization-heavy subjects, and leverage the chat feature to clarify difficult concepts.

Professionals can record meetings and presentations, upload training materials and documentation, generate executive summaries for reports, listen to content as podcasts during commutes, and create quick-reference flashcards.

Researchers benefit from uploading research papers and articles, generating summaries of key findings and methodologies, using chat to explore complex concepts in depth, creating flashcards for specialized terminology, and generating comprehension quizzes.

**Privacy and Security:**
Your notes are completely private and encrypted. All AI processing happens securely on our servers. We never share, sell, or use your data for training. You maintain full control—delete notes anytime and export your data whenever needed.

**Getting Started:**
Start exploring by reviewing the tabs at the top of this tutorial note. Try the Summary tab to see condensed versions, the Podcast tab to hear this content, the Quiz tab to test your understanding, the Chat tab to ask questions, and the Flashcards tab to study key concepts.

When ready to create your first real note, tap the purple + button on the home screen. Welcome to smarter studying with Scribe AI!"""

    // Pre-generated podcast script
    const val TUTORIAL_PODCAST_SCRIPT = """Welcome to Scribe AI - your intelligent study companion! Let me walk you through everything this app can do for you.

Scribe AI transforms any content into smart study materials using artificial intelligence. Whether you're a student, professional, or lifelong learner, this app makes studying more efficient and effective.

Let's start with how to create notes. You have four options.

First, you can record or upload audio. Simply tap the plus button and select record audio. The app will transcribe your recording and create organized notes automatically. This is perfect for lectures, meetings, or any spoken content. The transcription usually takes just 30 to 60 seconds.

Second, you can import YouTube videos. Just paste a YouTube link, and Scribe AI will extract the transcript and create notes. The video needs to have captions or subtitles, but most educational content does. It's instant and effortless.

Third, upload documents. Scribe AI supports PDFs, Word documents, PowerPoint presentations, and text files. Just upload your file, and the AI will analyze and organize the content into structured notes.

Fourth, scan physical documents. Use your phone's camera to scan textbooks, handwritten notes, or printed materials. The optical character recognition technology extracts the text automatically. For best results, use good lighting and keep pages flat.

Now, here's where it gets really powerful. Once you've created a note, you get five AI-powered features accessible through tabs.

The Summary tab generates concise summaries in three lengths. Choose short for a quick 2-3 paragraph overview, medium for a balanced 4-6 paragraph summary, or long for an 8-plus paragraph detailed analysis. This is perfect for quick review before exams.

The Podcast tab, which you're experiencing right now, converts your notes into audio. Listen while commuting, exercising, or doing chores. It's ideal for auditory learners and makes studying truly portable.

The Quiz tab creates multiple-choice questions based on your note content. Test your knowledge and get instant feedback. It's like having a personal tutor that knows exactly what's in your notes.

The Chat tab lets you ask questions about your notes. Need clarification on a complex concept? Want examples? Just ask! The AI assistant has full context of your notes and can explain anything in detail. You can even use voice input for hands-free interaction.

The Flashcards tab generates digital flashcards automatically. Each card has a question on the front and the answer on the back. Tap to flip and use spaced repetition for effective memorization.

Let's talk about pricing. The free plan includes one notebook with all features. That's right - you get everything: summaries, podcasts, quizzes, chat, and flashcards. This lets you fully experience what Scribe AI can do.

The Pro plan unlocks unlimited notebooks, priority processing, and faster response times. If you're serious about studying efficiently, Pro is definitely worth it.

Here are some best practices. For students: record every lecture, generate summaries for review, use quizzes before exams, create flashcards for memorization, and chat with your notes to clarify concepts.

For professionals: record meetings and presentations, upload training materials, generate summaries for reports, listen to podcasts during your commute, and create reference flashcards.

For researchers: upload research papers, generate summaries of findings, use chat to explore concepts deeply, create flashcards for terminology, and generate comprehension quizzes.

A few tips for getting the best results. When recording, use a quiet environment and speak clearly. When uploading documents, ensure text is readable and use high-quality scans. When scanning physical materials, use good lighting and keep pages flat.

Your privacy is paramount. All your notes are private and encrypted. AI processing happens securely, and we never share your data. You can delete notes anytime and export your data whenever you need it.

So, what should you do next? Try exploring the other tabs in this tutorial note. Check out the Summary tab to see different length summaries. Try the Quiz tab to test what you've learned about Scribe AI. Use the Chat tab to ask any questions. And review the Flashcards tab to see key concepts.

When you're ready to create your first real note, just tap the purple plus button on the home screen. Choose your input method - audio, YouTube, document upload, or scan - and let the AI do the rest.

Welcome aboard, and happy learning! Scribe AI is here to make your study sessions more productive and less stressful. Let's get started!"""

    // Pre-generated quiz questions
    // Note: correctAnswer is String (option index as string), not Int
    val TUTORIAL_QUIZ_QUESTIONS = listOf(
        QuizQuestion(
            question = "How many notebooks can you create with the free plan?",
            options = listOf("Unlimited", "3 notebooks", "1 notebook", "5 notebooks"),
            correctAnswer = "2",  // String index
            explanation = "The free plan includes 1 notebook with access to all AI features."
        ),
        QuizQuestion(
            question = "Which AI feature converts your notes into audio format?",
            options = listOf("Summary", "Podcast", "Quiz", "Chat"),
            correctAnswer = "1",  // String index
            explanation = "The Podcast tab converts your notes into audio that you can listen to on-the-go."
        ),
        QuizQuestion(
            question = "What type of YouTube videos work with Scribe AI?",
            options = listOf(
                "Any YouTube video",
                "Only paid videos",
                "Videos with captions/subtitles",
                "Only educational channel videos"
            ),
            correctAnswer = "2",  // String index
            explanation = "YouTube videos must have captions or subtitles (auto-generated or manual) for Scribe AI to extract the transcript."
        ),
        QuizQuestion(
            question = "Which tab lets you ask questions about your notes?",
            options = listOf("Summary", "Quiz", "Chat", "Flashcards"),
            correctAnswer = "2",  // String index
            explanation = "The Chat tab allows you to interact with an AI assistant that can answer questions about your note content."
        ),
        QuizQuestion(
            question = "How many summary lengths are available?",
            options = listOf("1", "2", "3", "4"),
            correctAnswer = "2",  // String index
            explanation = "Summaries are available in three lengths: short (2-3 paragraphs), medium (4-6 paragraphs), and long (8+ paragraphs)."
        ),
        QuizQuestion(
            question = "What file formats does Scribe AI support for document upload?",
            options = listOf(
                "Only PDF",
                "PDF, DOCX, PPTX, TXT",
                "Only Word documents",
                "PDF and TXT only"
            ),
            correctAnswer = "1",  // String index
            explanation = "Scribe AI supports multiple document formats including PDF, DOCX (Word), PPTX (PowerPoint), and TXT files."
        ),
        QuizQuestion(
            question = "What technology does Scribe AI use to extract text from scanned documents?",
            options = listOf("Manual transcription", "OCR (Optical Character Recognition)", "Voice recognition", "Barcode scanning"),
            correctAnswer = "1",  // String index
            explanation = "Scribe AI uses OCR (Optical Character Recognition) technology to automatically extract text from scanned images and documents."
        ),
        QuizQuestion(
            question = "Which feature is best for memorizing terminology and definitions?",
            options = listOf("Summary", "Podcast", "Quiz", "Flashcards"),
            correctAnswer = "3",  // String index
            explanation = "Flashcards are specifically designed for memorization with questions on the front and answers on the back."
        ),
        QuizQuestion(
            question = "How long does audio transcription typically take?",
            options = listOf("5-10 minutes", "30-60 seconds", "2-3 minutes", "It's instant"),
            correctAnswer = "1",  // String index
            explanation = "Audio transcription and note generation typically takes 30-60 seconds to complete."
        ),
        QuizQuestion(
            question = "What is a key benefit of the Pro plan?",
            options = listOf(
                "Access to AI features",
                "Ability to create notes",
                "Unlimited notebooks",
                "App download"
            ),
            correctAnswer = "2",  // String index
            explanation = "The main benefit of Pro is unlimited notebooks. Free users are limited to 1 notebook, while Pro users can create as many as they want."
        )
    )

    // Pre-generated flashcards
    val TUTORIAL_FLASHCARDS = listOf(
        Flashcard(
            front = "What is Scribe AI?",
            back = "An AI-powered app that transforms lectures, videos, and documents into smart study materials with features like summaries, podcasts, quizzes, chat, and flashcards."
        ),
        Flashcard(
            front = "How many ways can you create notes in Scribe AI?",
            back = "4 ways: Record/upload audio, YouTube videos, upload documents (PDF/DOCX/PPTX), or scan physical documents."
        ),
        Flashcard(
            front = "What are the three summary lengths available?",
            back = "Short (2-3 paragraphs), Medium (4-6 paragraphs), and Long (8+ paragraphs)"
        ),
        Flashcard(
            front = "What does the Podcast feature do?",
            back = "Converts written notes into natural-sounding audio that you can listen to while commuting, exercising, or multitasking."
        ),
        Flashcard(
            front = "What requirement do YouTube videos need?",
            back = "Videos must have captions or subtitles enabled (either auto-generated or manual)."
        ),
        Flashcard(
            front = "What is OCR?",
            back = "Optical Character Recognition - technology that extracts text from scanned images and physical documents."
        ),
        Flashcard(
            front = "How many notebooks does the free plan include?",
            back = "1 notebook with access to all AI features (summaries, podcast, quiz, chat, flashcards)."
        ),
        Flashcard(
            front = "What can you do in the Chat tab?",
            back = "Ask questions about your notes, get explanations of complex concepts, request examples, and interact with an AI assistant that has full context of your content."
        ),
        Flashcard(
            front = "What file formats are supported for document upload?",
            back = "PDF, DOCX (Word), PPTX (PowerPoint), TXT (text files), and more."
        ),
        Flashcard(
            front = "What makes the Pro plan different from Free?",
            back = "Pro unlocks unlimited notebooks, priority processing, faster response times, and supports ongoing development."
        ),
        Flashcard(
            front = "How long does audio transcription take?",
            back = "Typically 30-60 seconds for automatic transcription and note generation."
        ),
        Flashcard(
            front = "What are the 5 AI tabs in a note?",
            back = "Summary, Podcast, Quiz, Chat, and Flashcards - all accessible through tabs at the top of each note."
        )
    )

    /**
     * Creates a complete tutorial note with all AI content pre-generated
     */
    fun createTutorialNote(userId: String): Note {
        return Note(
            id = TUTORIAL_ID,
            userId = userId,
            title = TUTORIAL_TITLE,
            content = TUTORIAL_CONTENT,
            sourceType = "tutorial",
            sourceUrl = null,
            metadata = mapOf(
                "isTutorial" to true,
                "version" to "1.0"
            ),
            createdAt = getCurrentTimestamp(),
            updatedAt = getCurrentTimestamp()
        )
    }

    /**
     * Creates summary AIContentData for different lengths
     */
    fun createSummaryContent(length: String): AIContentData {
        val summary = when (length) {
            "short" -> TUTORIAL_SUMMARY_SHORT
            "long" -> TUTORIAL_SUMMARY_LONG
            else -> TUTORIAL_SUMMARY_MEDIUM
        }

        return AIContentData(
            id = "tutorial_summary_$length",
            noteId = TUTORIAL_ID,
            summary = summary
        )
    }

    /**
     * Creates podcast AIContentData
     */
    fun createPodcastContent(): AIContentData {
        return AIContentData(
            id = "tutorial_podcast",
            noteId = TUTORIAL_ID,
            script = TUTORIAL_PODCAST_SCRIPT,
            audioUrl = null,  // Will be generated on-demand if needed
            style = "conversational"
        )
    }

    /**
     * Creates quiz AIContentData with wrapped questions
     */
    fun createQuizContent(): AIContentData {
        return AIContentData(
            id = "tutorial_quiz",
            noteId = TUTORIAL_ID,
            questions = com.kreativekoala.scribeai.data.models.QuizQuestionsWrapper(
                quizQuestions = TUTORIAL_QUIZ_QUESTIONS
            )
        )
    }

    /**
     * Creates flashcards AIContentData
     */
    fun createFlashcardsContent(): AIContentData {
        return AIContentData(
            id = "tutorial_flashcards",
            noteId = TUTORIAL_ID,
            flashcards = TUTORIAL_FLASHCARDS
        )
    }

    private fun getCurrentTimestamp(): String {
        return java.text.SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss",
            java.util.Locale.getDefault()
        ).format(java.util.Date())
    }
}