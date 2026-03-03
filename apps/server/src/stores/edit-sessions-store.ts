import path from "node:path";
import { rm } from "node:fs/promises";
import type { EditSessionRecord } from "../types.js";
import { JsonFile } from "../utils/json-file.js";
import { EDIT_SESSIONS_FILE, EDITS_DIR } from "../utils/paths.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class EditSessionsStore {
  private readonly file = new JsonFile<EditSessionRecord[]>(EDIT_SESSIONS_FILE, []);

  public async getById(sessionId: string): Promise<EditSessionRecord | undefined> {
    const sessions = await this.file.get();
    return sessions.find((session) => session.sessionId === sessionId);
  }

  public async create(session: EditSessionRecord): Promise<EditSessionRecord> {
    await this.file.update((sessions) => [session, ...sessions]);
    return session;
  }

  public async update(
    sessionId: string,
    updater: (session: EditSessionRecord) => EditSessionRecord
  ): Promise<EditSessionRecord | undefined> {
    let updated: EditSessionRecord | undefined;
    await this.file.update((sessions) => {
      const next = [...sessions];
      const index = next.findIndex((session) => session.sessionId === sessionId);
      if (index < 0) {
        return sessions;
      }
      const current = next[index];
      if (!current) {
        return sessions;
      }
      updated = updater({
        ...current,
        clips: current.clips.map((clip) => ({ ...clip })),
        timeline: current.timeline.map((item) => ({ ...item }))
      });
      if (updated) {
        updated.updatedAt = nowIso();
        next[index] = updated;
      }
      return next;
    });
    return updated;
  }

  public async delete(sessionId: string): Promise<boolean> {
    let found = false;
    await this.file.update((sessions) => {
      const next = sessions.filter((session) => {
        const keep = session.sessionId !== sessionId;
        if (!keep) {
          found = true;
        }
        return keep;
      });
      return next;
    });
    if (found) {
      await rm(path.join(EDITS_DIR, sessionId), { recursive: true, force: true });
    }
    return found;
  }
}
