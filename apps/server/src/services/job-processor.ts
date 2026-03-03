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
import {
  classifyGeminiError,
  getAutoRetryDelaySec,
  MAX_AUTO_RETRY,
  type GeminiErrorCode
} from "../utils/gemini-retry.js";

interface QueueItem {
  jobId: string;
  styleIds?: StyleId[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildTitleVideoFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "video";
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
  const lowered = message.toLowerCase();
  if (lowered.includes('"status":"unavailable"') || /\b503\b/.test(lowered)) {
    return "Model Gemini sedang high demand (503 UNAVAILABLE). Coba retry job ini lagi dalam 1-5 menit.";
  }

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
    if (status === "UNAVAILABLE" || code === 503) {
      return "Model Gemini sedang high demand (503 UNAVAILABLE). Coba retry job ini lagi dalam 1-5 menit.";
    }
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
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

  public async restoreScheduledRetries(): Promise<void> {
    const jobs = await this.jobsStore.list();
    for (const job of jobs) {
      for (const style of job.styles) {
        if (style.status !== "pending" || !style.nextRetryAt) {
          continue;
        }
        const retryAtMs = Date.parse(style.nextRetryAt);
        if (!Number.isFinite(retryAtMs)) {
          continue;
        }
        if (retryAtMs <= Date.now()) {
          this.enqueue(job.jobId, [style.styleId]);
          continue;
        }
        this.scheduleRetry(job.jobId, style.styleId, style.nextRetryAt);
      }
    }
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

  private retryKey(jobId: string, styleId: StyleId): string {
    return `${jobId}:${styleId}`;
  }

  private clearRetryTimer(jobId: string, styleId: StyleId): void {
    const key = this.retryKey(jobId, styleId);
    const timer = this.retryTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(key);
    }
  }

  private scheduleRetry(jobId: string, styleId: StyleId, nextRetryAt: string): void {
    this.clearRetryTimer(jobId, styleId);
    const key = this.retryKey(jobId, styleId);
    const retryAtMs = Date.parse(nextRetryAt);
    if (!Number.isFinite(retryAtMs)) {
      return;
    }
    const delayMs = Math.max(0, retryAtMs - Date.now());
    if (delayMs === 0) {
      this.enqueue(jobId, [styleId]);
      return;
    }
    const timer = setTimeout(() => {
      this.retryTimers.delete(key);
      this.enqueue(jobId, [styleId]);
    }, delayMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    this.retryTimers.set(key, timer);
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
      const errorCode = classifyGeminiError(error);
      if (errorCode === "UNAVAILABLE") {
        for (const styleId of selectedStyleIds) {
          await this.scheduleUnavailableRetry(item.jobId, styleId);
        }
        return;
      }
      const message = this.toErrorMessage(error);
      await this.markStylesFailed(item.jobId, selectedStyleIds, message, errorCode);
      return;
    }

    for (const styleId of selectedStyleIds) {
      this.clearRetryTimer(item.jobId, styleId);
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
        const videoBaseName = `${buildTitleVideoFilename(job.title)}-${styleId}`;
        const mp4NoSubtitlePath = path.join(outputDir, `${videoBaseName}-nosub.mp4`);
        const mp4Path = path.join(outputDir, `${videoBaseName}.mp4`);
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
                  nextRetryAt: undefined,
                  lastErrorCode: undefined,
                  srtPath: `/outputs/${current.jobId}/${styleId}.srt`,
                  wavPath: `/outputs/${current.jobId}/${styleId}.wav`,
                  mp4Path: `/outputs/${current.jobId}/${videoBaseName}.mp4`,
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
        const errorCode = classifyGeminiError(error);
        if (errorCode === "UNAVAILABLE") {
          await this.scheduleUnavailableRetry(item.jobId, styleId);
          this.logger.warn(
            { err: error, jobId: item.jobId, styleId },
            "Style pending auto-retry karena model high demand."
          );
          continue;
        }
        await this.updateStyle(
          item.jobId,
          styleId,
          "failed",
          this.toErrorMessage(error),
          errorCode
        );
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
    message: string,
    errorCode: GeminiErrorCode = "OTHER"
  ): Promise<void> {
    await this.jobsStore.update(jobId, (current) => {
      const nextStyles = current.styles.map<StyleRun>((style) =>
        styleIds.includes(style.styleId)
          ? {
              ...style,
              status: "failed",
              errorMessage: message,
              nextRetryAt: undefined,
              lastErrorCode: errorCode,
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

  private async scheduleUnavailableRetry(jobId: string, styleId: StyleId): Promise<void> {
    let nextRetryAt: string | undefined;
    await this.jobsStore.update(jobId, (current) => {
      const nextStyles = current.styles.map<StyleRun>((style) => {
        if (style.styleId !== styleId) {
          return style;
        }
        const retryCount = style.retryCount ?? 0;
        if (retryCount >= MAX_AUTO_RETRY) {
          return {
            ...style,
            status: "failed",
            errorMessage: `Model Gemini sedang high demand. Auto retry sudah mencapai batas ${MAX_AUTO_RETRY}x, silakan manual retry.`,
            nextRetryAt: undefined,
            lastErrorCode: "UNAVAILABLE",
            updatedAt: nowIso()
          };
        }

        const nextRetryCount = retryCount + 1;
        const delaySec = getAutoRetryDelaySec(nextRetryCount);
        if (!delaySec) {
          return {
            ...style,
            status: "failed",
            errorMessage: "Auto retry tidak dapat dijadwalkan. Silakan manual retry.",
            nextRetryAt: undefined,
            lastErrorCode: "UNAVAILABLE",
            updatedAt: nowIso()
          };
        }
        nextRetryAt = new Date(Date.now() + delaySec * 1000).toISOString();
        return {
          ...style,
          status: "pending",
          retryCount: nextRetryCount,
          nextRetryAt,
          lastErrorCode: "UNAVAILABLE",
          errorMessage: `Model Gemini high demand (503 UNAVAILABLE). Auto retry #${nextRetryCount} pada ${nextRetryAt}.`,
          updatedAt: nowIso()
        };
      });
      return {
        ...current,
        updatedAt: nowIso(),
        styles: nextStyles,
        overallStatus: JobsStore.computeOverallStatus(nextStyles)
      };
    });

    if (nextRetryAt) {
      this.scheduleRetry(jobId, styleId, nextRetryAt);
      return;
    }
    this.clearRetryTimer(jobId, styleId);
  }

  private async updateStyle(
    jobId: string,
    styleId: StyleId,
    status: JobRecord["styles"][number]["status"],
    errorMessage?: string,
    errorCode: GeminiErrorCode = "OTHER"
  ): Promise<void> {
    await this.jobsStore.update(jobId, (current) => {
      const nextStyles = current.styles.map<StyleRun>((style) =>
        style.styleId !== styleId
          ? style
          : {
              ...style,
              status,
              errorMessage,
              nextRetryAt: status === "pending" ? style.nextRetryAt : undefined,
              lastErrorCode:
                status === "failed"
                  ? errorCode
                  : status === "pending"
                    ? style.lastErrorCode
                    : undefined,
              updatedAt: nowIso()
            }
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
