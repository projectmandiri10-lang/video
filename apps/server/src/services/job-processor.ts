import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { AppSettings, JobRecord, StyleId, StyleRun } from "../types.js";
import { JobsStore } from "../stores/jobs-store.js";
import { SettingsStore } from "../stores/settings-store.js";
import { buildScriptPrompt } from "./prompt-builder.js";
import { GeminiService } from "./gemini-service.js";
import { OUTPUTS_DIR } from "../utils/paths.js";
import { buildSrt } from "../utils/srt.js";
import {
  burnSubtitleToVideo,
  combineVideoWithVoiceOver,
  writeWav24kMono
} from "../utils/audio.js";
import { STYLE_LABELS } from "../constants.js";
import { ensureSocialMetadata } from "../utils/model-output.js";

interface QueueItem {
  jobId: string;
  styleIds?: StyleId[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function findStyleConfig(settings: AppSettings, styleId: StyleId) {
  return settings.styles.find((style) => style.styleId === styleId);
}

function fallbackCaption(title: string, description: string): string {
  const shortDescription = description.split(".")[0]?.trim() || description.trim();
  return `${title} - ${shortDescription}. Cek detail produk di komentar dan deskripsi.`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function fallbackHashtags(title: string, styleId: StyleId): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3)
    .slice(0, 4)
    .map((word) => `#${word}`);
  const base = ["#reelsfacebook", "#affiliate", "#rekomendasiproduk", "#belanjaonline"];
  const styleTag = `#${styleId}`;
  return [...base, styleTag, ...words];
}

function parseGeminiQuotaMessage(message: string): string | undefined {
  try {
    const payload = JSON.parse(message) as {
      error?: {
        code?: number;
        status?: string;
        message?: string;
        details?: Array<Record<string, unknown>>;
      };
    };
    const status = payload.error?.status || "";
    const code = payload.error?.code || 0;
    if (!(status === "RESOURCE_EXHAUSTED" || code === 429)) {
      return undefined;
    }

    let retryDelay = "";
    for (const detail of payload.error?.details || []) {
      const detailType = String(detail["@type"] || "");
      if (detailType.includes("RetryInfo")) {
        retryDelay = String(detail["retryDelay"] || "").trim();
      }
    }

    const retryText = retryDelay ? ` Coba lagi dalam ${retryDelay}.` : "";
    return `Kuota Gemini habis untuk saat ini.${retryText} Cek billing/quota API key Anda atau tunggu reset kuota.`;
  } catch {
    return undefined;
  }
}

export interface IJobProcessor {
  enqueue(jobId: string, styleIds?: StyleId[]): void;
}

export class JobProcessor implements IJobProcessor {
  private readonly queue: QueueItem[] = [];
  private running = false;
  private idleResolvers: Array<() => void> = [];

  public constructor(
    private readonly jobsStore: JobsStore,
    private readonly settingsStore: SettingsStore,
    private readonly gemini: GeminiService,
    private readonly logger: FastifyBaseLogger
  ) {}

  public enqueue(jobId: string, styleIds?: StyleId[]): void {
    this.queue.push({ jobId, styleIds });
    void this.consume();
  }

  public async whenIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private resolveIdle(): void {
    if (this.running || this.queue.length > 0) {
      return;
    }
    for (const resolve of this.idleResolvers.splice(0)) {
      resolve();
    }
  }

  private async consume(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) {
        break;
      }
      try {
        await this.processItem(item);
      } catch (error) {
        this.logger.error({ err: error, jobId: item.jobId }, "Processing job gagal.");
      }
    }
    this.running = false;
    this.resolveIdle();
  }

  private async processItem(item: QueueItem): Promise<void> {
    const job = await this.jobsStore.getById(item.jobId);
    if (!job) {
      return;
    }
    const settings = await this.settingsStore.get();
    const selectedStyleIds =
      item.styleIds && item.styleIds.length
        ? item.styleIds
        : job.styles.map((style) => style.styleId);

    await this.jobsStore.update(item.jobId, (current) => ({
      ...current,
      overallStatus: "running",
      updatedAt: nowIso()
    }));

    let uploadedVideo;
    try {
      uploadedVideo = await this.gemini.uploadVideo(job.videoPath, job.videoMimeType);
    } catch (error) {
      const message = this.toErrorMessage(error);
      await this.markStylesFailed(item.jobId, selectedStyleIds, message);
      return;
    }

    for (const styleId of selectedStyleIds) {
      const styleConfig = findStyleConfig(settings, styleId);
      if (!styleConfig?.enabled) {
        await this.jobsStore.update(item.jobId, (current) => ({
          ...current,
          updatedAt: nowIso(),
          styles: current.styles.map<StyleRun>((style) =>
            style.styleId === styleId
              ? {
                  ...style,
                  status: "failed",
                  errorMessage: "Style dinonaktifkan di settings.",
                  updatedAt: nowIso()
                }
              : style
          )
        }));
        continue;
      }

      await this.updateStyle(item.jobId, styleId, "running");
      try {
        const scriptPrompt = buildScriptPrompt({
          settings,
          style: styleConfig,
          title: job.title,
          description: job.description,
          videoDurationSec: job.videoDurationSec
        });
        const scriptText = await this.gemini.generateScript({
          model: settings.scriptModel,
          prompt: scriptPrompt,
          video: uploadedVideo
        });

        const outputDir = path.join(OUTPUTS_DIR, job.jobId);
        await mkdir(outputDir, { recursive: true });

        const srtPath = path.join(outputDir, `${styleId}.srt`);
        const srtContent = buildSrt(scriptText, job.videoDurationSec);
        await writeFile(srtPath, srtContent, "utf8");

        const fallbackSocial = {
          caption: fallbackCaption(job.title, job.description),
          hashtags: fallbackHashtags(job.title, styleId)
        };
        const socialMetadata = await (async () => {
          try {
            const candidate = await this.gemini.generateSocialMetadata({
              model: settings.scriptModel,
              title: job.title,
              description: job.description,
              styleId,
              scriptText
            });
            return ensureSocialMetadata(
              candidate,
              fallbackSocial.caption,
              fallbackSocial.hashtags
            );
          } catch (error) {
            this.logger.warn(
              { err: error, jobId: item.jobId, styleId },
              "Generate caption/hashtags gagal, pakai fallback."
            );
            return fallbackSocial;
          }
        })();
        const captionPath = path.join(outputDir, `${styleId}-caption.txt`);
        const captionFileParts = [
          socialMetadata.caption,
          socialMetadata.hashtags.join(" "),
          job.affiliateLink?.trim() || ""
        ].filter((item) => item.length > 0);
        const captionFileContent = `${captionFileParts.join("\n\n")}\n`;
        await writeFile(captionPath, captionFileContent, "utf8");

        const audio = await this.gemini.generateSpeech({
          model: settings.ttsModel,
          text: scriptText,
          voiceName: job.voiceName || styleConfig.voiceName,
          speechRate: job.speechRate ?? styleConfig.speechRate
        });
        const wavPath = path.join(outputDir, `${styleId}.wav`);
        await writeWav24kMono(
          audio.data,
          audio.mimeType,
          wavPath,
          job.speechRate ?? styleConfig.speechRate
        );
        const mp4NoSubtitlePath = path.join(outputDir, `${styleId}-nosub.mp4`);
        const mp4Path = path.join(outputDir, `${styleId}.mp4`);
        await combineVideoWithVoiceOver(
          job.videoPath,
          wavPath,
          mp4NoSubtitlePath,
          job.videoDurationSec
        );
        await burnSubtitleToVideo(mp4NoSubtitlePath, srtPath, mp4Path);
        await rm(mp4NoSubtitlePath, { force: true });

        await this.jobsStore.update(item.jobId, (current) => ({
          ...current,
          updatedAt: nowIso(),
          styles: current.styles.map<StyleRun>((style) =>
            style.styleId === styleId
              ? {
                  ...style,
                  status: "done",
                  errorMessage: undefined,
                  srtPath: `/outputs/${current.jobId}/${styleId}.srt`,
                  wavPath: `/outputs/${current.jobId}/${styleId}.wav`,
                  mp4Path: `/outputs/${current.jobId}/${styleId}.mp4`,
                  captionPath: `/outputs/${current.jobId}/${styleId}-caption.txt`,
                  captionText: socialMetadata.caption,
                  hashtags: socialMetadata.hashtags,
                  updatedAt: nowIso()
                }
              : style
          )
        }));
        this.logger.info(
          { jobId: item.jobId, style: styleId },
          `Style ${STYLE_LABELS[styleId]} selesai.`
        );
      } catch (error) {
        await this.updateStyle(item.jobId, styleId, "failed", this.toErrorMessage(error));
        this.logger.error(
          { err: error, jobId: item.jobId, styleId },
          "Style processing gagal."
        );
      }
    }

    await this.jobsStore.update(item.jobId, (current) => ({
      ...current,
      updatedAt: nowIso(),
      overallStatus: JobsStore.computeOverallStatus(current.styles)
    }));
  }

  private async markStylesFailed(
    jobId: string,
    styleIds: StyleId[],
    message: string
  ): Promise<void> {
    await this.jobsStore.update(jobId, (current) => {
      const nextStyles = current.styles.map<StyleRun>((style) =>
        styleIds.includes(style.styleId)
          ? {
              ...style,
              status: "failed",
              errorMessage: message,
              updatedAt: nowIso()
            }
          : style
      );
      return {
        ...current,
        updatedAt: nowIso(),
        styles: nextStyles,
        overallStatus: JobsStore.computeOverallStatus(nextStyles)
      };
    });
  }

  private async updateStyle(
    jobId: string,
    styleId: StyleId,
    status: JobRecord["styles"][number]["status"],
    errorMessage?: string
  ): Promise<void> {
    await this.jobsStore.update(jobId, (current) => {
      const nextStyles = current.styles.map<StyleRun>((style) =>
        style.styleId === styleId
          ? {
              ...style,
              status,
              errorMessage,
              updatedAt: nowIso()
            }
          : style
      );
      return {
        ...current,
        updatedAt: nowIso(),
        styles: nextStyles,
        overallStatus: JobsStore.computeOverallStatus(nextStyles)
      };
    });
  }

  private toErrorMessage(error: unknown): string {
    const message = (error as { message?: string })?.message || "Error tidak diketahui.";
    const quotaMessage = parseGeminiQuotaMessage(message);
    if (quotaMessage) {
      return quotaMessage;
    }
    return message;
  }
}
