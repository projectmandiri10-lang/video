import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { JobProcessor } from "../src/services/job-processor.js";
import { JobsStore } from "../src/stores/jobs-store.js";
import { SettingsStore } from "../src/stores/settings-store.js";
import type { JobRecord } from "../src/types.js";
import { resetTestStorage } from "./helpers.js";

function createPendingRetryJob(nextRetryAt: string): JobRecord {
  const now = new Date().toISOString();
  return {
    jobId: "job-retry-recovery",
    createdAt: now,
    updatedAt: now,
    title: "Produk Tes",
    description: "Deskripsi tes",
    affiliateLink: "https://contoh.test/abc",
    sourceType: "upload",
    sourceVideoLabel: "uploaded",
    voiceName: "Aoede",
    voiceGender: "female",
    speechRate: 1,
    videoPath: "uploads/job-retry-recovery/source.mp4",
    videoMimeType: "video/mp4",
    videoDurationSec: 10,
    overallStatus: "queued",
    styles: [
      {
        styleId: "evergreen",
        status: "pending",
        retryCount: 1,
        nextRetryAt,
        lastErrorCode: "UNAVAILABLE",
        errorMessage: "Model high demand",
        updatedAt: now
      }
    ]
  };
}

describe("job processor retry recovery", () => {
  const logger = pino({ level: "silent" });
  const jobsStore = new JobsStore();
  const settingsStore = new SettingsStore();

  beforeEach(async () => {
    await resetTestStorage();
    await settingsStore.set(DEFAULT_SETTINGS);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("re-enqueues pending style immediately when nextRetryAt already passed", async () => {
    await jobsStore.create(createPendingRetryJob(new Date(Date.now() - 1_000).toISOString()));

    const processor = new JobProcessor(
      jobsStore,
      settingsStore,
      {} as any,
      logger
    );
    const enqueueSpy = vi.spyOn(processor, "enqueue").mockImplementation(() => {});

    await processor.restoreScheduledRetries();

    expect(enqueueSpy).toHaveBeenCalledWith("job-retry-recovery", ["evergreen"]);
  });

  it("schedules pending style retry based on nextRetryAt", async () => {
    vi.useFakeTimers();
    await jobsStore.create(createPendingRetryJob(new Date(Date.now() + 5_000).toISOString()));

    const processor = new JobProcessor(
      jobsStore,
      settingsStore,
      {} as any,
      logger
    );
    const enqueueSpy = vi.spyOn(processor, "enqueue").mockImplementation(() => {});

    await processor.restoreScheduledRetries();
    expect(enqueueSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_100);
    expect(enqueueSpy).toHaveBeenCalledWith("job-retry-recovery", ["evergreen"]);
  });
});
