import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(CURRENT_DIR, "../../../..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const OUTPUTS_DIR = path.join(ROOT_DIR, "outputs");
export const UPLOADS_DIR = path.join(ROOT_DIR, "uploads");
export const EDITS_DIR = path.join(ROOT_DIR, "edits");
export const LOGS_DIR = path.join(ROOT_DIR, "logs");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
export const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
export const EDIT_SESSIONS_FILE = path.join(DATA_DIR, "edit-sessions.json");
export const WEB_DIST_DIR = path.join(ROOT_DIR, "apps", "web", "dist");

export async function ensureAppDirs(): Promise<void> {
  await Promise.all([
    mkdir(DATA_DIR, { recursive: true }),
    mkdir(OUTPUTS_DIR, { recursive: true }),
    mkdir(UPLOADS_DIR, { recursive: true }),
    mkdir(EDITS_DIR, { recursive: true }),
    mkdir(LOGS_DIR, { recursive: true })
  ]);
}
