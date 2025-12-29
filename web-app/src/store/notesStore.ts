import { create } from 'zustand';
import type { Note, AIContent, ChatMessage } from '@/types';

interface NotesState {
  notes: Note[];
  currentNote: Note | null;
  aiContent: Record<string, AIContent[]>;
  chatHistory: Record<string, ChatMessage[]>;
  isLoading: boolean;
  error: string | null;
}

interface NotesStore extends NotesState {
  setNotes: (notes: Note[]) => void;
  addNote: (note: Note) => void;
  updateNote: (noteId: string, updates: Partial<Note>) => void;
  removeNote: (noteId: string) => void;
  setCurrentNote: (note: Note | null) => void;
  setAIContent: (noteId: string, content: AIContent[]) => void;
  addChatMessage: (noteId: string, message: ChatMessage) => void;
  clearChatHistory: (noteId: string) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],
  currentNote: null,
  aiContent: {},
  chatHistory: {},
  isLoading: false,
  error: null,

  setNotes: (notes) => set({ notes }),

  addNote: (note) => set((state) => ({
    notes: [note, ...state.notes]
  })),

  updateNote: (noteId, updates) => set((state) => ({
    notes: state.notes.map((n) =>
      n.id === noteId ? { ...n, ...updates } : n
    ),
    currentNote: state.currentNote?.id === noteId
      ? { ...state.currentNote, ...updates }
      : state.currentNote
  })),

  removeNote: (noteId) => set((state) => ({
    notes: state.notes.filter((n) => n.id !== noteId),
    currentNote: state.currentNote?.id === noteId ? null : state.currentNote
  })),

  setCurrentNote: (note) => set({ currentNote: note }),

  setAIContent: (noteId, content) => set((state) => ({
    aiContent: { ...state.aiContent, [noteId]: content }
  })),

  addChatMessage: (noteId, message) => set((state) => ({
    chatHistory: {
      ...state.chatHistory,
      [noteId]: [...(state.chatHistory[noteId] || []), message]
    }
  })),

  clearChatHistory: (noteId) => set((state) => ({
    chatHistory: { ...state.chatHistory, [noteId]: [] }
  })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),
}));
