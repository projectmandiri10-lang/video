import { nanoid } from "nanoid";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  EDIT_TARGET_HEIGHT,
  EDIT_TARGET_WIDTH,
  MIN_EDIT_CLIP_SECONDS
} from "../constants.js";
import type {
  EditClipAsset,
  EditSessionRecord,
  EditTimelineItem
} from "../types.js";
import { EditSessionsStore } from "../stores/edit-sessions-store.js";
import { EDITS_DIR } from "../utils/paths.js";
import { probeVideoDuration } from "../utils/video.js";
import { renderEditedPreviewFromTimeline } from "../utils/audio.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function sessionPreviewPublicPath(sessionId: string): string {
  return `/edits/${sessionId}/preview.mp4`;
}

export class EditorService {
  public constructor(private readonly sessionsStore: EditSessionsStore) {}

  public async createSession(): Promise<EditSessionRecord> {
    const sessionId = nanoid(10);
    const sessionDir = path.join(EDITS_DIR, sessionId);
    await mkdir(path.join(sessionDir, "clips"), { recursive: true });

    const now = nowIso();
    const session: EditSessionRecord = {
      sessionId,
      createdAt: now,
      updatedAt: now,
      clips: [],
      timeline: [],
      targetWidth: EDIT_TARGET_WIDTH,
      targetHeight: EDIT_TARGET_HEIGHT
    };
    return this.sessionsStore.create(session);
  }

  public async getSession(sessionId: string): Promise<EditSessionRecord | undefined> {
    return this.sessionsStore.getById(sessionId);
  }

  public async addClip(
    sessionId: string,
    input: {
      originalName: string;
      mimeType: string;
      filePath: string;
    }
  ): Promise<EditSessionRecord> {
    const session = await this.sessionsStore.getById(sessionId);
    if (!session) {
      throw new Error("Session editor tidak ditemukan.");
    }
    const clipId = nanoid(8);
    const durationSec = await probeVideoDuration(input.filePath);
    const clip: EditClipAsset = {
      clipId,
      originalName: input.originalName,
      mimeType: input.mimeType,
      filePath: input.filePath,
      durationSec,
      createdAt: nowIso()
    };

    const updated = await this.sessionsStore.update(sessionId, (current) => ({
      ...current,
      clips: [...current.clips, clip]
    }));
    if (!updated) {
      throw new Error("Gagal menyimpan clip ke session.");
    }
    return updated;
  }

  public async updateTimeline(
    sessionId: string,
    timeline: EditTimelineItem[]
  ): Promise<EditSessionRecord> {
    const session = await this.sessionsStore.getById(sessionId);
    if (!session) {
      throw new Error("Session editor tidak ditemukan.");
    }

    const clipsById = new Map(session.clips.map((clip) => [clip.clipId, clip]));
    for (const item of timeline) {
      const clip = clipsById.get(item.clipId);
      if (!clip) {
        throw new Error(`Clip ${item.clipId} tidak ditemukan pada session.`);
      }
      if (item.endSec <= item.startSec) {
        throw new Error(`Range trim clip ${item.clipId} tidak valid.`);
      }
      if (item.startSec < 0 || item.endSec > clip.durationSec + 0.001) {
        throw new Error(`Range trim clip ${item.clipId} melebihi durasi source.`);
      }
      if (item.endSec - item.startSec < MIN_EDIT_CLIP_SECONDS) {
        throw new Error(
          `Durasi clip minimal ${MIN_EDIT_CLIP_SECONDS} detik (clip ${item.clipId}).`
        );
      }
    }

    const updated = await this.sessionsStore.update(sessionId, (current) => ({
      ...current,
      timeline: timeline.map((item) => ({ ...item }))
    }));
    if (!updated) {
      throw new Error("Gagal menyimpan timeline.");
    }
    return updated;
  }

  public async renderPreview(sessionId: string): Promise<EditSessionRecord> {
    const session = await this.sessionsStore.getById(sessionId);
    if (!session) {
      throw new Error("Session editor tidak ditemukan.");
    }
    if (!session.timeline.length) {
      throw new Error("Timeline kosong. Tambahkan clip dan trim dulu.");
    }

    const clipsById = new Map(session.clips.map((clip) => [clip.clipId, clip]));
    const timelineInputs = session.timeline.map((item) => {
      const clip = clipsById.get(item.clipId);
      if (!clip) {
        throw new Error(`Clip ${item.clipId} pada timeline tidak ditemukan.`);
      }
      return { clip, item };
    });

    const previewPath = path.join(EDITS_DIR, sessionId, "preview.mp4");
    await renderEditedPreviewFromTimeline(
      timelineInputs,
      previewPath,
      session.targetWidth,
      session.targetHeight
    );
    const previewDurationSec = await probeVideoDuration(previewPath);

    const updated = await this.sessionsStore.update(sessionId, (current) => ({
      ...current,
      previewPath,
      previewDurationSec
    }));
    if (!updated) {
      throw new Error("Gagal update preview session.");
    }
    return updated;
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    return this.sessionsStore.delete(sessionId);
  }
}
