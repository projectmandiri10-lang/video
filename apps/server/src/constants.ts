import type { AppSettings, StyleId } from "./types.js";

export const MAX_HISTORY = 20;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const DEFAULT_PORT = 8787;
export const EDIT_TARGET_WIDTH = 720;
export const EDIT_TARGET_HEIGHT = 1280;
export const MIN_EDIT_CLIP_SECONDS = 5;

const STYLE_PROMPTS: Record<StyleId, string> = {
  evergreen:
    "Buat naskah voice-over gaya evergreen untuk video affiliate. Tekankan manfaat jangka panjang produk, bahasa natural, tidak berlebihan, CTA di akhir (arahkan ke komentar dan deskripsi).",
  soft_selling:
    "Buat naskah voice-over gaya soft selling. Bangun empati, jelaskan problem pengguna, tawarkan produk sebagai solusi halus, CTA di akhir (arahkan ke komentar dan deskripsi).",
  hard_selling:
    "Buat naskah voice-over gaya hard selling dengan urgency wajar. Fokus value, promo, alasan beli sekarang, tetap aman tanpa klaim absolut, CTA di akhir (arahkan ke komentar dan deskripsi).",
  problem_solution:
    "Buat naskah voice-over edukasi problem-solution. Awali pain point, jelaskan penyebab singkat, masukkan solusi produk secara praktis, CTA di akhir (arahkan ke komentar dan deskripsi)."
};

const STYLE_VOICES: Record<StyleId, string> = {
  evergreen: "Aoede",
  soft_selling: "Leda",
  hard_selling: "Kore",
  problem_solution: "Puck"
};

export const STYLE_ORDER: StyleId[] = [
  "evergreen",
  "soft_selling",
  "hard_selling",
  "problem_solution"
];

export const DEFAULT_SETTINGS: AppSettings = {
  scriptModel: "gemini-3-flash-preview",
  ttsModel: "gemini-2.5-flash-preview-tts",
  language: "id-ID",
  maxVideoSeconds: 60,
  safetyMode: "safe_marketing",
  ctaPosition: "end",
  concurrency: 1,
  styles: STYLE_ORDER.map((styleId) => ({
    styleId,
    enabled: true,
    promptTemplate: STYLE_PROMPTS[styleId],
    voiceName: STYLE_VOICES[styleId],
    speechRate: 1
  }))
};

export const STYLE_LABELS: Record<StyleId, string> = {
  evergreen: "Evergreen",
  soft_selling: "Soft Selling",
  hard_selling: "Hard Selling",
  problem_solution: "Edukasi Problem-Solution"
};
