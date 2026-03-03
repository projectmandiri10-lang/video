import { DEFAULT_SETTINGS } from "../constants.js";
import { SETTINGS_FILE } from "../utils/paths.js";
import { JsonFile } from "../utils/json-file.js";
import type { AppSettings } from "../types.js";

export class SettingsStore {
  private readonly file = new JsonFile<AppSettings>(SETTINGS_FILE, DEFAULT_SETTINGS);

  public async get(): Promise<AppSettings> {
    const settings = await this.file.get();
    if (!settings.styles?.length) {
      await this.file.set(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }

    return settings;
  }

  public async set(next: AppSettings): Promise<AppSettings> {
    await this.file.set(next);
    return next;
  }
}
