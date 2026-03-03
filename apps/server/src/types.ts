export type StyleId =
  | "evergreen"
  | "soft_selling"
  | "hard_selling"
  | "problem_solution";

export type VideoSourceType = "upload" | "editing";
export type VoiceGender = "female" | "male" | "neutral";

export type StyleStatus = "pending" | "running" | "done" | "failed" | "interrupted";

export type JobOverallStatus =
  | "queued"
  | "running"
  | "success"
  | "partial_success"
  | "failed"
  | "interrupted";

export interface StyleConfig {
  styleId: StyleId;
  enabled: boolean;
  promptTemplate: string;
  voiceName: string;
  speechRate: number;
}

export interface AppSettings {
  scriptModel: string;
  ttsModel: string;
  language: "id-ID";
  maxVideoSeconds: number;
  safetyMode: "safe_marketing";
  ctaPosition: "end";
  concurrency: 1;
  styles: StyleConfig[];
}

export interface StyleRun {
  styleId: StyleId;
  status: StyleStatus;
  errorMessage?: string;
  retryCount?: number;
  nextRetryAt?: string;
  lastErrorCode?: "UNAVAILABLE" | "RESOURCE_EXHAUSTED" | "OTHER";
  srtPath?: string;
  wavPath?: string;
  mp4Path?: string;
  captionPath?: string;
  captionText?: string;
  hashtags?: string[];
  updatedAt: string;
}

export interface JobRecord {
  jobId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  description: string;
  affiliateLink?: string;
  sourceType: VideoSourceType;
  editSessionId?: string;
  sourceVideoLabel?: string;
  voiceName?: string;
  voiceGender?: VoiceGender;
  speechRate?: number;
  videoPath: string;
  videoMimeType: string;
  videoDurationSec: number;
  overallStatus: JobOverallStatus;
  styles: StyleRun[];
}

export interface UploadedGeminiVideo {
  fileUri: string;
  mimeType: string;
}

export interface GenerateScriptInput {
  model: string;
  prompt: string;
  video: UploadedGeminiVideo;
}

export interface GenerateSpeechInput {
  model: string;
  text: string;
  voiceName: string;
  speechRate: number;
}

export interface TtsVoiceOption {
  voiceName: string;
  label: string;
  tone: string;
  gender: VoiceGender;
}

export interface ExcitedVoicePreset {
  presetId: string;
  label: string;
  version: string;
  gender: "female" | "male";
  voiceName: string;
}

export interface SocialMetadata {
  caption: string;
  hashtags: string[];
}

export interface GenerateSocialMetadataInput {
  model: string;
  title: string;
  description: string;
  styleId: StyleId;
  scriptText: string;
}

export interface EditClipAsset {
  clipId: string;
  originalName: string;
  mimeType: string;
  filePath: string;
  durationSec: number;
  createdAt: string;
}

export interface EditTimelineItem {
  clipId: string;
  startSec: number;
  endSec: number;
}

export interface EditSessionRecord {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  clips: EditClipAsset[];
  timeline: EditTimelineItem[];
  previewPath?: string;
  previewDurationSec?: number;
  targetWidth: number;
  targetHeight: number;
}
