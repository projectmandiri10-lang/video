import FormData from "form-data";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SettingsStore } from "../src/stores/settings-store.js";
import { JobsStore } from "../src/stores/jobs-store.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import type { EditClipAsset, EditSessionRecord, EditTimelineItem, StyleId } from "../src/types.js";
import { resetTestStorage } from "./helpers.js";
import { EDITS_DIR } from "../src/utils/paths.js";

describe("api integration", () => {
  const logger = pino({ level: "silent" });
  const settingsStore = new SettingsStore();
  const jobsStore = new JobsStore();
  const enqueueCalls: Array<{ jobId: string; styleIds?: StyleId[] }> = [];
  const openCalls: string[] = [];
  const editorSessions = new Map<string, EditSessionRecord>();
  let mockSessionCounter = 0;

  const editorService = {
    async createSession() {
      mockSessionCounter += 1;
      const now = new Date().toISOString();
      const sessionId = `session-test-${mockSessionCounter}`;
      await mkdir(path.join(EDITS_DIR, sessionId, "clips"), { recursive: true });
      const session: EditSessionRecord = {
        sessionId,
        createdAt: now,
        updatedAt: now,
        clips: [],
        timeline: [],
        targetWidth: 720,
        targetHeight: 1280
      };
      editorSessions.set(session.sessionId, session);
      return session;
    },
    async getSession(sessionId: string) {
      return editorSessions.get(sessionId);
    },
    async addClip(
      sessionId: string,
      input: { originalName: string; mimeType: string; filePath: string }
    ) {
      const session = editorSessions.get(sessionId);
      if (!session) {
        throw new Error("Session editor tidak ditemukan.");
      }
      const clip: EditClipAsset = {
        clipId: `clip-${session.clips.length + 1}`,
        originalName: input.originalName,
        mimeType: input.mimeType,
        filePath: input.filePath,
        durationSec: 8,
        createdAt: new Date().toISOString()
      };
      const updated: EditSessionRecord = {
        ...session,
        updatedAt: new Date().toISOString(),
        clips: [...session.clips, clip]
      };
      editorSessions.set(sessionId, updated);
      return updated;
    },
    async updateTimeline(sessionId: string, timeline: EditTimelineItem[]) {
      const session = editorSessions.get(sessionId);
      if (!session) {
        throw new Error("Session editor tidak ditemukan.");
      }
      const updated: EditSessionRecord = {
        ...session,
        updatedAt: new Date().toISOString(),
        timeline: timeline.map((item) => ({ ...item }))
      };
      editorSessions.set(sessionId, updated);
      return updated;
    },
    async renderPreview(sessionId: string) {
      const session = editorSessions.get(sessionId);
      if (!session) {
        throw new Error("Session editor tidak ditemukan.");
      }
      const previewDir = path.join(EDITS_DIR, sessionId);
      await mkdir(previewDir, { recursive: true });
      const previewPath = path.join(previewDir, "preview.mp4");
      await writeFile(previewPath, "mock-preview", "utf8");
      const updated: EditSessionRecord = {
        ...session,
        updatedAt: new Date().toISOString(),
        previewPath,
        previewDurationSec: 12
      };
      editorSessions.set(sessionId, updated);
      return updated;
    },
    async deleteSession(sessionId: string) {
      return editorSessions.delete(sessionId);
    }
  };
  const processor = {
    enqueue(jobId: string, styleIds?: StyleId[]) {
      enqueueCalls.push({ jobId, styleIds });
    }
  };

  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    enqueueCalls.length = 0;
    openCalls.length = 0;
    editorSessions.clear();
    mockSessionCounter = 0;
    await resetTestStorage();
    await settingsStore.set(DEFAULT_SETTINGS);
    const previewSessionId = "edit-ready";
    const previewDir = path.join(EDITS_DIR, previewSessionId);
    await mkdir(previewDir, { recursive: true });
    const previewPath = path.join(previewDir, "preview.mp4");
    await writeFile(previewPath, "fake-preview-video", "utf8");
    const now = new Date().toISOString();
    editorSessions.set(previewSessionId, {
      sessionId: previewSessionId,
      createdAt: now,
      updatedAt: now,
      clips: [],
      timeline: [],
      previewPath,
      previewDurationSec: 30,
      targetWidth: 720,
      targetHeight: 1280
    });

    app = await buildApp({
      logger,
      webOrigin: "http://localhost:5173",
      settingsStore,
      jobsStore,
      editorService,
      processor,
      probeDuration: async () => 30,
      openOutputLocation: async (folderPath) => {
        openCalls.push(folderPath);
      }
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("creates job from multipart upload", async () => {
    const form = new FormData();
    form.append("video", Buffer.from("fake-video-data"), {
      filename: "clip.mp4",
      contentType: "video/mp4"
    });
    form.append("title", "Judul Tes");
    form.append("description", "Deskripsi Tes");
    form.append("affiliateLink", "https://contoh-affiliate.test/abc");
    form.append("styleId", "evergreen");
    form.append("sourceType", "upload");

    const response = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });

    expect(response.statusCode).toBe(202);
    const payload = response.json() as { jobId: string; status: string };
    expect(payload.status).toBe("queued");
    expect(enqueueCalls.length).toBe(1);
    expect(enqueueCalls[0]?.jobId).toBe(payload.jobId);
    expect(enqueueCalls[0]?.styleIds).toEqual(["evergreen"]);
    const saved = await jobsStore.getById(payload.jobId);
    expect(saved?.affiliateLink).toBe("https://contoh-affiliate.test/abc");
    expect(saved?.styles.map((style) => style.styleId)).toEqual(["evergreen"]);
  });

  it("rejects create job if styleId is missing", async () => {
    const form = new FormData();
    form.append("video", Buffer.from("fake-video-data"), {
      filename: "clip.mp4",
      contentType: "video/mp4"
    });
    form.append("title", "Judul Tanpa Style");
    form.append("description", "Deskripsi Tanpa Style");
    form.append("affiliateLink", "https://contoh-affiliate.test/no-style");
    form.append("sourceType", "upload");

    const response = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });

    expect(response.statusCode).toBe(400);
  });

  it("updates settings and affects next fetch", async () => {
    const updated = {
      ...DEFAULT_SETTINGS,
      scriptModel: "custom-script-model"
    };
    const putResponse = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: updated
    });
    expect(putResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/settings"
    });
    expect(getResponse.statusCode).toBe(200);
    const fetched = getResponse.json() as typeof updated;
    expect(fetched.scriptModel).toBe("custom-script-model");
  });

  it("retries failed style only", async () => {
    const form = new FormData();
    form.append("video", Buffer.from("fake-video-data"), {
      filename: "clip.mp4",
      contentType: "video/mp4"
    });
    form.append("title", "Judul Retry");
    form.append("description", "Deskripsi Retry");
    form.append("affiliateLink", "https://contoh-affiliate.test/retry");
    form.append("styleId", "evergreen");
    form.append("sourceType", "upload");

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      styles: job.styles.map((style, idx) =>
        idx === 0
          ? {
              ...style,
              status: "failed",
              errorMessage: "mock fail",
              updatedAt: new Date().toISOString()
            }
          : style
      )
    }));

    const retryResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/retry`,
      payload: {
        styleId: "evergreen"
      }
    });

    expect(retryResponse.statusCode).toBe(200);
    expect(enqueueCalls.length).toBeGreaterThan(1);
    expect(enqueueCalls[enqueueCalls.length - 1]?.styleIds).toEqual(["evergreen"]);
  });

  it("opens output location", async () => {
    const form = new FormData();
    form.append("video", Buffer.from("fake-video-data"), {
      filename: "clip.mp4",
      contentType: "video/mp4"
    });
    form.append("title", "Judul Lokasi");
    form.append("description", "Deskripsi Lokasi");
    form.append("affiliateLink", "https://contoh-affiliate.test/lokasi");
    form.append("styleId", "evergreen");
    form.append("sourceType", "upload");

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };

    const openResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/open-location`,
      payload: {
        styleId: "evergreen"
      }
    });

    expect(openResponse.statusCode).toBe(200);
    expect(openCalls.length).toBe(1);
    expect(openCalls[0]).toContain(payload.jobId);
  });

  it("creates job from editing preview source", async () => {
    const form = new FormData();
    form.append("title", "Judul Editing");
    form.append("description", "Deskripsi Editing");
    form.append("affiliateLink", "https://contoh-affiliate.test/editing");
    form.append("styleId", "evergreen");
    form.append("sourceType", "editing");
    form.append("editSessionId", "edit-ready");

    const response = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });

    expect(response.statusCode).toBe(202);
    const payload = response.json() as { jobId: string };
    const saved = await jobsStore.getById(payload.jobId);
    expect(saved?.sourceType).toBe("editing");
    expect(saved?.editSessionId).toBe("edit-ready");
    expect(saved?.videoMimeType).toBe("video/mp4");
  });

  it("creates editor session and uploads clip", async () => {
    const createSessionResponse = await app.inject({
      method: "POST",
      url: "/api/editor/session"
    });
    expect(createSessionResponse.statusCode).toBe(201);
    const createdSession = createSessionResponse.json() as { sessionId: string };

    const clipForm = new FormData();
    clipForm.append("clip_1", Buffer.from("fake-clip-data"), {
      filename: "clip-1.mp4",
      contentType: "video/mp4"
    });
    const uploadResponse = await app.inject({
      method: "POST",
      url: `/api/editor/${createdSession.sessionId}/clips`,
      payload: clipForm.getBuffer(),
      headers: clipForm.getHeaders()
    });

    expect(uploadResponse.statusCode).toBe(200);
    const updatedSession = uploadResponse.json() as EditSessionRecord;
    expect(updatedSession.clips.length).toBe(1);
  });

  it("updates editor timeline and renders preview", async () => {
    const now = new Date().toISOString();
    editorSessions.set("timeline-session", {
      sessionId: "timeline-session",
      createdAt: now,
      updatedAt: now,
      clips: [
        {
          clipId: "clip-a",
          originalName: "a.mp4",
          mimeType: "video/mp4",
          filePath: "x",
          durationSec: 8,
          createdAt: now
        }
      ],
      timeline: [],
      targetWidth: 720,
      targetHeight: 1280
    });

    const timelineResponse = await app.inject({
      method: "PUT",
      url: "/api/editor/timeline-session/timeline",
      payload: {
        timeline: [{ clipId: "clip-a", startSec: 0, endSec: 6 }]
      }
    });
    expect(timelineResponse.statusCode).toBe(200);

    const previewResponse = await app.inject({
      method: "POST",
      url: "/api/editor/timeline-session/render-preview"
    });
    expect(previewResponse.statusCode).toBe(200);
    const rendered = previewResponse.json() as EditSessionRecord;
    expect(rendered.previewPublicPath).toContain("/edits/timeline-session/preview.mp4");
  });
});
