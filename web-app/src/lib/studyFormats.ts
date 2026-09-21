// Shared across the homepage and auth pages so the "what you get" copy stays
// consistent wherever it appears.
export const STUDY_FORMATS = [
  { name: 'Smart notes', body: 'An organized outline and summary, not a wall of transcript.' },
  { name: 'Flashcards', body: 'Generated from the material, ready for spaced repetition.' },
  { name: 'Quizzes', body: 'AI-written questions to test what actually stuck.' },
  { name: 'Podcasts', body: 'Your notes, narrated, for the walk between classes.' },
] as const;
