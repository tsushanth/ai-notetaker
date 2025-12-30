import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Supported languages matching backend validation
export const SUPPORTED_LANGUAGES = [
  // Major World Languages
  { code: 'english', name: 'English', nativeName: 'English' },
  { code: 'spanish', name: 'Spanish', nativeName: 'Español' },
  { code: 'french', name: 'French', nativeName: 'Français' },
  { code: 'german', name: 'German', nativeName: 'Deutsch' },
  { code: 'portuguese', name: 'Portuguese', nativeName: 'Português' },
  { code: 'italian', name: 'Italian', nativeName: 'Italiano' },
  { code: 'chinese', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'chinese_traditional', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'japanese', name: 'Japanese', nativeName: '日本語' },
  { code: 'korean', name: 'Korean', nativeName: '한국어' },
  // South Asian Languages
  { code: 'hindi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'bengali', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'tamil', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'telugu', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'urdu', name: 'Urdu', nativeName: 'اردو' },
  { code: 'marathi', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'gujarati', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'punjabi', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  // European Languages
  { code: 'dutch', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'polish', name: 'Polish', nativeName: 'Polski' },
  { code: 'russian', name: 'Russian', nativeName: 'Русский' },
  { code: 'ukrainian', name: 'Ukrainian', nativeName: 'Українська' },
  { code: 'swedish', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'norwegian', name: 'Norwegian', nativeName: 'Norsk' },
  { code: 'danish', name: 'Danish', nativeName: 'Dansk' },
  { code: 'finnish', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'greek', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'czech', name: 'Czech', nativeName: 'Čeština' },
  { code: 'romanian', name: 'Romanian', nativeName: 'Română' },
  { code: 'hungarian', name: 'Hungarian', nativeName: 'Magyar' },
  // Middle Eastern & African Languages
  { code: 'arabic', name: 'Arabic', nativeName: 'العربية' },
  { code: 'hebrew', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'turkish', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'persian', name: 'Persian', nativeName: 'فارسی' },
  { code: 'swahili', name: 'Swahili', nativeName: 'Kiswahili' },
  // Southeast Asian Languages
  { code: 'thai', name: 'Thai', nativeName: 'ไทย' },
  { code: 'vietnamese', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'indonesian', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'malay', name: 'Malay', nativeName: 'Bahasa Melayu' },
  { code: 'tagalog', name: 'Tagalog', nativeName: 'Tagalog' },
] as const;

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];

interface SettingsState {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: 'english',
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
