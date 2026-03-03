import cors from "@fastify/cors";
import multipart, { type MultipartFile } from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import mime from "mime-types";
import { nanoid } from "nanoid";
import {
  GEMINI_EXCITED_PRESETS,
  GEMINI_TTS_VOICES,
  MAX_UPLOAD_BYTES,
  findTtsVoiceByName
} from "./constants.js";
import { JobsStore } from "./stores/jobs-store.js";
import { SettingsStore } from "./stores/settings-store.js";
import type {
  EditSessionRecord,
  GenerateSpeechInput,
  JobRecord,
  StyleId,
  VideoSourceType
} from "./types.js";
import {
  parseSpeechRate,
  parseTtsPreviewInput,
  parseRetryStyleId,
  parseSettings,
  parseTimelineItems,
  parseVideoSourceType,
  parseVoiceGender
} from "./validation.js";
import {
  EDITS_DIR,
  OUTPUTS_DIR,
  UPLOADS_DIR,
  WEB_DIST_DIR
} from "./utils/paths.js";
import { probeVideoDuration } from "./utils/video.js";
import type { IJobProcessor } from "./services/job-processor.js";
import { openPathInExplorer } from "./utils/open-location.js";
import { EditorService, sessionPreviewPublicPath } from "./services/editor-service.js";
import { writeWav24kMono } from "./utils/audio.js";

interface BuildAppOptions {
  logger: FastifyBaseLogger;
  webOrigin: string;
  settingsStore: SettingsStore;
  jobsStore: JobsStore;
  editorService: EditorService;
  processor: IJobProcessor;
  speechGenerator?: {
    generateSpeech: (
      input: GenerateSpeechInput
    ) => Promise<{ data: Buffer; mimeType: string }>;
  };
  probeDuration?: (videoPath: string) => Promise<number>;
  openOutputLocation?: (folderPath: string) => Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createStyleRuns(styleIds: StyleId[]): JobRecord["styles"] {
  return styleIds.map((styleId) => ({
    styleId,
    status: "pending",
    updatedAt: nowIso()
  }));
}

function pickVideoExtension(part: MultipartFile): string {
  const fromName = path.extname(part.filename || "").trim();
  if (fromName) {
    return fromName;
  }
  const fromMime = mime.extension(part.mimetype || "");
  return fromMime ? `.${fromMime}` : ".mp4";
}

function toClientEditSession(session: EditSessionRecord) {
  return {
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    targetWidth: session.targetWidth,
    targetHeight: session.targetHeight,
    previewDurationSec: session.previewDurationSec,
    previewPublicPath: session.previewPath
      ? sessionPreviewPublicPath(session.sessionId)
      : undefined,
    timeline: session.timeline,
    clips: session.clips.map((clip) => ({
      clipId: clip.clipId,
      originalName: clip.originalName,
      mimeType: clip.mimeType,
      durationSec: clip.durationSec,
      createdAt: clip.createdAt
    }))
  };
}

async function maybeRegisterWebStatic(app: FastifyInstance): Promise<void> {
  try {
    await access(WEB_DIST_DIR);
  } catch {
    return;
  }
  const indexHtml = await readFile(path.join(WEB_DIST_DIR, "index.html"), "utf8");

  await app.register(fastifyStatic, {
    root: WEB_DIST_DIR,
    wildcard: false,
    prefix: "/",
    decorateReply: false
  });

  app.get("/*", async (request, reply) => {
    if (request.url.startsWith("/api") || request.url.startsWith("/outputs")) {
      return reply.code(404).send({ message: "Not found" });
    }
    reply.type("text/html; charset=utf-8");
    return reply.send(indexHtml);
  });
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: options.logger });
  const durationProbe = options.probeDuration ?? probeVideoDuration;
  const openOutputLocation = options.openOutputLocation ?? openPathInExplorer;

  await app.register(cors, {
    origin: options.webOrigin,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  });
  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 24
    }
  });
  await app.register(fastifyStatic, {
    root: OUTPUTS_DIR,
    prefix: "/outputs/",
    decorateReply: false
  });
  await app.register(fastifyStatic, {
    root: EDITS_DIR,
    prefix: "/edits/",
    decorateReply: false
  });
  await maybeRegisterWebStatic(app);

  app.get("/api/health", async () => ({
    status: "ok",
    now: nowIso()
  }));

  app.get("/api/settings", async () => options.settingsStore.get());

  app.put("/api/settings", async (request, reply) => {
    try {
      const parsed = parseSettings(request.body);
      await options.settingsStore.set(parsed);
      return reply.send(parsed);
    } catch (error) {
      return reply.code(400).send({
        message: "Settings tidak valid.",
        error: (error as { message?: string })?.message
      });
    }
  });

  app.get("/api/tts/voices", async () => {
    return {
      voices: GEMINI_TTS_VOICES,
      excitedPresets: GEMINI_EXCITED_PRESETS
    };
  });

  app.post("/api/tts/preview", async (request, reply) => {
    if (!options.speechGenerator) {
      return reply.code(503).send({
        message: "Speech generator tidak tersedia di server."
      });
    }

    try {
      const payload = parseTtsPreviewInput(request.body);
      const voice = findTtsVoiceByName(payload.voiceName);
      if (!voice) {
        return reply.code(400).send({
          message: `Voice ${payload.voiceName} tidak tersedia pada katalog Gemini.`
        });
      }
      const settings = await options.settingsStore.get();
      const sampleText =
        payload.text ||
        "Ini contoh voice over excited untuk video affiliate. Cek detail produk di komentar dan deskripsi.";
      const audio = await options.speechGenerator.generateSpeech({
        model: settings.ttsModel,
        text: sampleText,
        voiceName: voice.voiceName,
        speechRate: payload.speechRate
      });

      const previewDir = path.join(OUTPUTS_DIR, "_voice_previews");
      await mkdir(previewDir, { recursive: true });
      const filename = `${Date.now()}-${voice.voiceName}-${nanoid(5)}.wav`;
      const outputPath = path.join(previewDir, filename);
      await writeWav24kMono(audio.data, audio.mimeType, outputPath, payload.speechRate);

      return reply.send({
        voiceName: voice.voiceName,
        previewPath: `/outputs/_voice_previews/${filename}`
      });
    } catch (error) {
      return reply.code(400).send({
        message: "Gagal membuat preview voice.",
        error: (error as { message?: string })?.message
      });
    }
  });

  app.get("/api/jobs", async () => {
    const jobs = await options.jobsStore.list();
    return jobs;
  });

  app.delete("/api/jobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }
    if (job.overallStatus === "running" || job.overallStatus === "queued") {
      return reply.code(400).send({
        message: "Job dengan status running/queued tidak bisa dihapus."
      });
    }

    const deleted = await options.jobsStore.delete(params.jobId);
    if (!deleted) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }
    return reply.code(204).send();
  });

  app.post("/api/editor/session", async (_request, reply) => {
    try {
      const session = await options.editorService.createSession();
      return reply.code(201).send(toClientEditSession(session));
    } catch (error) {
      return reply.code(500).send({
        message: "Gagal membuat session editor.",
        error: (error as { message?: string })?.message
      });
    }
  });

  app.get("/api/editor/:sessionId", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const session = await options.editorService.getSession(params.sessionId);
    if (!session) {
      return reply.code(404).send({ message: "Session editor tidak ditemukan." });
    }
    return reply.send(toClientEditSession(session));
  });

  app.post("/api/editor/:sessionId/clips", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const session = await options.editorService.getSession(params.sessionId);
    if (!session) {
      return reply.code(404).send({ message: "Session editor tidak ditemukan." });
    }

    const parts = (
      request as unknown as {
        parts: () => AsyncIterable<MultipartFile | any>;
      }
    ).parts();
    const uploadedFilePaths: string[] = [];
    let lastSession = session;

    try {
      for await (const part of parts) {
        if (part.type !== "file") {
          continue;
        }
        const ext = pickVideoExtension(part);
        const clipPath = path.join(EDITS_DIR, params.sessionId, "clips", `${nanoid(8)}${ext}`);
        await pipeline(part.file, createWriteStream(clipPath));
        uploadedFilePaths.push(clipPath);
        lastSession = await options.editorService.addClip(params.sessionId, {
          originalName: part.filename || "clip.mp4",
          mimeType: part.mimetype || "video/mp4",
          filePath: clipPath
        });
      }
      if (!uploadedFilePaths.length) {
        return reply.code(400).send({ message: "Tidak ada file clip yang diupload." });
      }
      return reply.send(toClientEditSession(lastSession));
    } catch (error) {
      await Promise.all(uploadedFilePaths.map((item) => rm(item, { force: true })));
      return reply.code(400).send({
        message: "Gagal upload clip editor.",
        error: (error as { message?: string })?.message
      });
    }
  });

  app.put("/api/editor/:sessionId/timeline", async (request, reply) => {
    const params = request.params as { sessionId: string };
    try {
      const timeline = parseTimelineItems(request.body);
      const session = await options.editorService.updateTimeline(params.sessionId, timeline);
      return reply.send(toClientEditSession(session));
    } catch (error) {
      const message = (error as { message?: string })?.message || "Timeline tidak valid.";
      const statusCode = message.includes("tidak ditemukan") ? 404 : 400;
      return reply.code(statusCode).send({ message });
    }
  });

  app.post("/api/editor/:sessionId/render-preview", async (request, reply) => {
    const params = request.params as { sessionId: string };
    try {
      const session = await options.editorService.renderPreview(params.sessionId);
      return reply.send(toClientEditSession(session));
    } catch (error) {
      const message = (error as { message?: string })?.message || "Gagal render preview.";
      const statusCode = message.includes("tidak ditemukan") ? 404 : 400;
      return reply.code(statusCode).send({ message });
    }
  });

  app.delete("/api/editor/:sessionId", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const deleted = await options.editorService.deleteSession(params.sessionId);
    if (!deleted) {
      return reply.code(404).send({ message: "Session editor tidak ditemukan." });
    }
    return reply.code(204).send();
  });

  app.get("/api/jobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }
    return job;
  });

  app.post("/api/jobs/:jobId/retry", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }

    let styleId: StyleId;
    try {
      styleId = parseRetryStyleId(request.body);
    } catch (error) {
      return reply.code(400).send({
        message: "styleId tidak valid.",
        error: (error as { message?: string })?.message
      });
    }

    const style = job.styles.find((item) => item.styleId === styleId);
    if (!style) {
      return reply.code(404).send({ message: "Style pada job tidak ditemukan." });
    }
    if (!["failed", "interrupted"].includes(style.status)) {
      return reply.code(400).send({
        message: "Retry hanya untuk style dengan status failed/interrupted."
      });
    }

    await options.jobsStore.update(params.jobId, (current) => ({
      ...current,
      updatedAt: nowIso(),
      overallStatus: "queued",
      styles: current.styles.map((item) =>
        item.styleId === styleId
          ? {
              ...item,
              status: "pending",
              errorMessage: undefined,
              retryCount: 0,
              nextRetryAt: undefined,
              lastErrorCode: undefined,
              updatedAt: nowIso()
            }
          : item
      )
    }));

    options.processor.enqueue(params.jobId, [styleId]);
    return reply.send({ ok: true });
  });

  app.post("/api/jobs/:jobId/open-location", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }

    let styleId: StyleId;
    try {
      styleId = parseRetryStyleId(request.body);
    } catch (error) {
      return reply.code(400).send({
        message: "styleId tidak valid.",
        error: (error as { message?: string })?.message
      });
    }

    const style = job.styles.find((item) => item.styleId === styleId);
    if (!style) {
      return reply.code(404).send({ message: "Style pada job tidak ditemukan." });
    }

    const outputDir = path.join(OUTPUTS_DIR, job.jobId);
    try {
      await mkdir(outputDir, { recursive: true });
      await openOutputLocation(outputDir);
      return reply.send({ ok: true, folderPath: outputDir });
    } catch (error) {
      return reply.code(500).send({
        message: "Gagal membuka lokasi file.",
        error: (error as { message?: string })?.message
      });
    }
  });

  app.post("/api/jobs", async (request, reply) => {
    const parts = (
      request as unknown as {
        parts: () => AsyncIterable<MultipartFile | any>;
      }
    ).parts();
    let title = "";
    let description = "";
    let affiliateLink = "";
    let styleIdRaw = "";
    let sourceTypeRaw = "";
    let editSessionId = "";
    let voiceNameRaw = "";
    let voiceGenderRaw = "";
    let speechRateRaw = "";
    let uploadedOriginalName = "";
    let videoPath = "";
    let videoMimeType = "video/mp4";
    let uploadDir = "";
    const jobId = nanoid(10);

    for await (const part of parts) {
      if (part.type === "file" && part.fieldname === "video") {
        uploadDir = path.join(UPLOADS_DIR, jobId);
        await mkdir(uploadDir, { recursive: true });
        const extension = pickVideoExtension(part);
        videoPath = path.join(uploadDir, `source${extension}`);
        videoMimeType = part.mimetype || "video/mp4";
        uploadedOriginalName = part.filename || path.basename(videoPath);
        await pipeline(part.file, createWriteStream(videoPath));
        continue;
      }
      if (part.type === "field" && part.fieldname === "title") {
        title = String(part.value || "").trim();
      }
      if (part.type === "field" && part.fieldname === "description") {
        description = String(part.value || "").trim();
      }
      if (part.type === "field" && part.fieldname === "affiliateLink") {
        affiliateLink = String(part.value || "").trim();
      }
      if (part.type === "field" && part.fieldname === "styleId") {
        styleIdRaw = String(part.value || "").trim();
      }
      if (part.type === "field" && part.fieldname === "sourceType") {
        sourceTypeRaw = String(part.value || "").trim();
      }
      if (part.type === "field" && part.fieldname === "editSessionId") {
        editSessionId = String(part.value || "").trim();
      }
      if (part.type === "field" && part.fieldname === "voiceName") {
        voiceNameRaw = String(part.value || "").trim();
      }
      if (part.type === "field" && part.fieldname === "voiceGender") {
        voiceGenderRaw = String(part.value || "").trim();
      }
      if (part.type === "field" && part.fieldname === "speechRate") {
        speechRateRaw = String(part.value || "").trim();
      }
      if (part.type === "file") {
        part.file.resume();
      }
    }

    if (!title || !description || !affiliateLink) {
      if (uploadDir) {
        await rm(uploadDir, { recursive: true, force: true });
      }
      return reply
        .code(400)
        .send({ message: "Field title, description, dan affiliateLink wajib diisi." });
    }
    if (!styleIdRaw) {
      if (uploadDir) {
        await rm(uploadDir, { recursive: true, force: true });
      }
      return reply.code(400).send({ message: "Field styleId wajib diisi." });
    }

    let selectedStyleId: StyleId;
    try {
      selectedStyleId = parseRetryStyleId({ styleId: styleIdRaw });
    } catch (error) {
      if (uploadDir) {
        await rm(uploadDir, { recursive: true, force: true });
      }
      return reply.code(400).send({
        message: "styleId tidak valid.",
        error: (error as { message?: string })?.message
      });
    }

    let sourceType: VideoSourceType;
    try {
      sourceType = parseVideoSourceType(sourceTypeRaw);
    } catch (error) {
      if (uploadDir) {
        await rm(uploadDir, { recursive: true, force: true });
      }
      return reply.code(400).send({
        message: "sourceType tidak valid. Gunakan 'upload' atau 'editing'.",
        error: (error as { message?: string })?.message
      });
    }

    try {
      const settings = await options.settingsStore.get();
      const selectedStyle = settings.styles.find(
        (style) => style.styleId === selectedStyleId
      );
      if (!selectedStyle?.enabled) {
        await rm(uploadDir, { recursive: true, force: true });
        return reply.code(400).send({
          message: `Style ${selectedStyleId} tidak aktif di settings.`
        });
      }

      let selectedVoiceName = selectedStyle.voiceName;
      if (voiceNameRaw) {
        const voice = findTtsVoiceByName(voiceNameRaw);
        if (!voice) {
          if (uploadDir) {
            await rm(uploadDir, { recursive: true, force: true });
          }
          return reply.code(400).send({
            message: `Voice ${voiceNameRaw} tidak tersedia pada katalog Gemini.`
          });
        }
        selectedVoiceName = voice.voiceName;
      }

      let selectedVoiceGender = findTtsVoiceByName(selectedVoiceName)?.gender;
      if (voiceGenderRaw) {
        try {
          selectedVoiceGender = parseVoiceGender(voiceGenderRaw);
        } catch (error) {
          if (uploadDir) {
            await rm(uploadDir, { recursive: true, force: true });
          }
          return reply.code(400).send({
            message: "voiceGender tidak valid.",
            error: (error as { message?: string })?.message
          });
        }
      }

      let selectedSpeechRate = selectedStyle.speechRate;
      if (speechRateRaw) {
        try {
          selectedSpeechRate = parseSpeechRate(speechRateRaw);
        } catch (error) {
          if (uploadDir) {
            await rm(uploadDir, { recursive: true, force: true });
          }
          return reply.code(400).send({
            message: "speechRate tidak valid (range 0.7 - 1.3).",
            error: (error as { message?: string })?.message
          });
        }
      }

      let chosenVideoPath = videoPath;
      let chosenVideoMime = videoMimeType;
      let chosenVideoLabel = uploadedOriginalName || "Uploaded video";
      let chosenEditSessionId: string | undefined;

      if (sourceType === "upload") {
        if (!videoPath) {
          if (uploadDir) {
            await rm(uploadDir, { recursive: true, force: true });
          }
          return reply.code(400).send({ message: "File video wajib diisi untuk source upload." });
        }
      } else {
        if (uploadDir) {
          await rm(uploadDir, { recursive: true, force: true });
        }
        if (!editSessionId) {
          return reply.code(400).send({
            message: "editSessionId wajib diisi untuk source editing."
          });
        }
        const session = await options.editorService.getSession(editSessionId);
        if (!session) {
          return reply.code(404).send({ message: "Session editor tidak ditemukan." });
        }
        if (!session.previewPath) {
          return reply.code(400).send({
            message: "Preview editing belum tersedia. Render preview dulu sebelum generate."
          });
        }
        await access(session.previewPath);
        chosenVideoPath = session.previewPath;
        chosenVideoMime = "video/mp4";
        chosenVideoLabel = `Editing Preview ${editSessionId}`;
        chosenEditSessionId = editSessionId;
      }

      const durationSec = await durationProbe(chosenVideoPath);
      if (durationSec > settings.maxVideoSeconds) {
        if (uploadDir) {
          await rm(uploadDir, { recursive: true, force: true });
        }
        return reply.code(400).send({
          message: `Durasi video ${durationSec.toFixed(2)}s melebihi batas ${settings.maxVideoSeconds}s.`
        });
      }

      const now = nowIso();
      const job: JobRecord = {
        jobId,
        createdAt: now,
        updatedAt: now,
        title,
        description,
        affiliateLink,
        sourceType,
        editSessionId: chosenEditSessionId,
        sourceVideoLabel: chosenVideoLabel,
        voiceName: selectedVoiceName,
        voiceGender: selectedVoiceGender,
        speechRate: selectedSpeechRate,
        videoPath: chosenVideoPath,
        videoMimeType: chosenVideoMime,
        videoDurationSec: durationSec,
        overallStatus: "queued",
        styles: createStyleRuns([selectedStyleId])
      };
      await options.jobsStore.create(job);
      options.processor.enqueue(jobId, [selectedStyleId]);

      return reply.code(202).send({
        jobId,
        status: "queued"
      });
    } catch (error) {
      await rm(uploadDir, { recursive: true, force: true });
      return reply.code(400).send({
        message: "Gagal memproses upload video.",
        error: (error as { message?: string })?.message
      });
    }
  });

  return app;
}
