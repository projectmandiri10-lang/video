import { z } from "zod";
import { STYLE_ORDER } from "./constants.js";
import type {
  AppSettings,
  EditTimelineItem,
  StyleId,
  VideoSourceType,
  VoiceGender
} from "./types.js";

const styleIdSchema = z.enum(STYLE_ORDER);

const styleSchema = z.object({
  styleId: styleIdSchema,
  enabled: z.boolean(),
  promptTemplate: z.string().trim().min(1),
  voiceName: z.string().trim().min(1),
  speechRate: z.number().min(0.7).max(1.3)
});

export const settingsSchema = z.object({
  scriptModel: z.string().trim().min(1),
  ttsModel: z.string().trim().min(1),
  language: z.literal("id-ID"),
  maxVideoSeconds: z.number().int().min(10).max(180),
  safetyMode: z.literal("safe_marketing"),
  ctaPosition: z.literal("end"),
  concurrency: z.literal(1),
  styles: z
    .array(styleSchema)
    .length(STYLE_ORDER.length)
    .refine((styles) => {
      const ids = styles.map((style) => style.styleId);
      return STYLE_ORDER.every((id) => ids.includes(id));
    }, "Semua style harus ada.")
});

export const retrySchema = z.object({
  styleId: styleIdSchema
});

const sourceTypeSchema = z.enum(["upload", "editing"]);
const voiceGenderSchema = z.enum(["female", "male", "neutral"]);
const speechRateSchema = z.number().min(0.7).max(1.3);

export const openLocationSchema = z.object({
  styleId: styleIdSchema
});

export const timelineItemSchema = z.object({
  clipId: z.string().trim().min(1),
  startSec: z.number().min(0),
  endSec: z.number().positive()
});

export const updateTimelineSchema = z.object({
  timeline: z.array(timelineItemSchema).min(1)
});

const ttsPreviewSchema = z.object({
  voiceName: z.string().trim().min(1),
  speechRate: speechRateSchema.optional(),
  text: z.string().trim().min(1).max(220).optional()
});

export function parseSettings(input: unknown): AppSettings {
  const result = settingsSchema.parse(input);
  const sorted = [...result.styles].sort(
    (a, b) => STYLE_ORDER.indexOf(a.styleId) - STYLE_ORDER.indexOf(b.styleId)
  );
  return {
    ...result,
    styles: sorted
  };
}

export function parseRetryStyleId(input: unknown): StyleId {
  const parsed = retrySchema.parse(input);
  return parsed.styleId;
}

export function parseVideoSourceType(input: unknown): VideoSourceType {
  return sourceTypeSchema.parse(input);
}

export function parseTimelineItems(input: unknown): EditTimelineItem[] {
  const parsed = updateTimelineSchema.parse(input);
  return parsed.timeline;
}

export function parseVoiceGender(input: unknown): VoiceGender {
  return voiceGenderSchema.parse(input);
}

export function parseSpeechRate(input: unknown): number {
  const numeric = typeof input === "number" ? input : Number(input);
  return speechRateSchema.parse(numeric);
}

export function parseTtsPreviewInput(input: unknown): {
  voiceName: string;
  speechRate: number;
  text?: string;
} {
  const parsed = ttsPreviewSchema.parse(input);
  return {
    voiceName: parsed.voiceName,
    speechRate: parsed.speechRate ?? 1,
    text: parsed.text
  };
}
