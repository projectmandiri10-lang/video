import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DATA_DIR,
  JOBS_FILE,
  OUTPUTS_DIR,
  SETTINGS_FILE,
  UPLOADS_DIR
} from "../src/utils/paths.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";

export async function resetTestStorage(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(OUTPUTS_DIR, { recursive: true });
  await rm(path.join(UPLOADS_DIR), { recursive: true, force: true });
  await rm(path.join(OUTPUTS_DIR), { recursive: true, force: true });
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(OUTPUTS_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf8");
  await writeFile(JOBS_FILE, JSON.stringify([], null, 2), "utf8");
}
