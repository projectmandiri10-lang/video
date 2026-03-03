import type { AppSettings, StyleConfig, StyleId } from "../types.js";
import { applyTemplate } from "../utils/template.js";

const STYLE_LABEL: Record<StyleId, string> = {
  evergreen: "Evergreen",
  soft_selling: "Soft Selling",
  hard_selling: "Hard Selling",
  problem_solution: "Problem-Solution"
};

export interface PromptInput {
  settings: AppSettings;
  style: StyleConfig;
  title: string;
  description: string;
  videoDurationSec: number;
}

function estimateWordRange(durationSec: number): { min: number; target: number; max: number } {
  const safeDuration = Math.max(5, durationSec);
  // Estimasi 2.2 kata/detik untuk VO marketing Bahasa Indonesia.
  const target = Math.round(safeDuration * 2.2);
  const min = Math.max(20, Math.round(target * 0.85));
  const max = Math.max(min + 8, Math.round(target * 1.15));
  return { min, target, max };
}

export function buildScriptPrompt(input: PromptInput): string {
  const stylePrompt = applyTemplate(input.style.promptTemplate, {
    title: input.title,
    description: input.description
  });
  const words = estimateWordRange(input.videoDurationSec);

  return [
    "Anda adalah copywriter affiliate video pendek berbahasa Indonesia.",
    "Tugas: buat naskah voice-over yang persuasif, aman, dan natural.",
    "Aturan penting:",
    "- Gunakan Bahasa Indonesia, gaya percakapan.",
    "- Hindari klaim absolut/berlebihan/menyesatkan.",
    "- Fokus manfaat produk dan relevansi dengan video.",
    `- Panjang naskah harus sekitar ${words.target} kata (rentang ${words.min}-${words.max} kata) agar pas untuk durasi video ${input.videoDurationSec.toFixed(2)} detik.`,
    "- CTA harus di akhir naskah.",
    '- CTA wajib mengarahkan penonton untuk cek detail produk di komentar dan deskripsi.',
    '- Dilarang menggunakan CTA seperti "cek keranjang".',
    "",
    `Judul produk: ${input.title}`,
    `Deskripsi produk: ${input.description}`,
    `Instruksi style: ${stylePrompt}`,
    "",
    "Kembalikan teks naskah voice-over saja, tanpa penjelasan tambahan."
  ].join("\n");
}

export interface ReelsMetadataPromptInput {
  title: string;
  description: string;
  styleId: StyleId;
  scriptText: string;
}

export function buildReelsMetadataPrompt(input: ReelsMetadataPromptInput): string {
  return [
    "Anda adalah social media copywriter untuk Facebook Reels affiliate.",
    "Buat caption dan hashtags berdasarkan konten berikut.",
    "Aturan:",
    "- Bahasa Indonesia.",
    "- Caption maksimal 220 karakter, 1-2 kalimat, soft CTA di akhir.",
    "- CTA harus mengarahkan ke komentar dan deskripsi, bukan ke keranjang.",
    "- Jangan klaim berlebihan/absolut.",
    "- Hashtags 6 sampai 10, relevan produk, semuanya diawali #.",
    "- Kembalikan HANYA JSON valid tanpa markdown.",
    '- Format tepat: {"caption":"...","hashtags":["#a","#b"]}',
    "",
    `Style: ${STYLE_LABEL[input.styleId]}`,
    `Judul: ${input.title}`,
    `Deskripsi: ${input.description}`,
    `Naskah voice-over: ${input.scriptText}`
  ].join("\n");
}
