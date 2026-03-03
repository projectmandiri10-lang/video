import { rm } from "node:fs/promises";
import { MAX_HISTORY } from "../constants.js";
import type { JobRecord, JobOverallStatus, StyleRun, StyleStatus } from "../types.js";
import { JsonFile } from "../utils/json-file.js";
import { JOBS_FILE, OUTPUTS_DIR, UPLOADS_DIR } from "../utils/paths.js";
import path from "node:path";

function nowIso(): string {
  return new Date().toISOString();
}

export class JobsStore {
  private readonly file = new JsonFile<JobRecord[]>(JOBS_FILE, []);

  public async list(): Promise<JobRecord[]> {
    const jobs = await this.file.get();
    return jobs;
  }

  public async getById(jobId: string): Promise<JobRecord | undefined> {
    const jobs = await this.file.get();
    return jobs.find((job) => job.jobId === jobId);
  }

  public async create(job: JobRecord): Promise<JobRecord> {
    await this.file.update(async (jobs) => {
      const next = [job, ...jobs];
      const removed = next.slice(MAX_HISTORY);
      const kept = next.slice(0, MAX_HISTORY);
      await Promise.all(removed.map((item) => this.cleanupJobArtifacts(item.jobId)));
      return kept;
    });
    return job;
  }

  public async delete(jobId: string): Promise<boolean> {
    let found = false;
    await this.file.update(async (jobs) => {
      const next = jobs.filter((job) => {
        if (job.jobId === jobId) {
          found = true;
          return false;
        }
        return true;
      });
      if (found) {
        await this.cleanupJobArtifacts(jobId);
      }
      return next;
    });
    return found;
  }

  public async update(
    jobId: string,
    updater: (job: JobRecord) => JobRecord
  ): Promise<JobRecord | undefined> {
    let updated: JobRecord | undefined;
    await this.file.update((jobs) => {
      const next = [...jobs];
      const index = next.findIndex((job) => job.jobId === jobId);
      if (index < 0) {
        return jobs;
      }
      const current = next[index];
      if (!current) {
        return jobs;
      }
      updated = updater({
        ...current,
        styles: current.styles.map((style) => ({ ...style }))
      });
      if (updated) {
        next[index] = updated;
      }
      return next;
    });
    return updated;
  }

  public async markRunningAsInterrupted(): Promise<void> {
    await this.file.update((jobs) =>
      jobs.map((job) => {
        if (job.overallStatus !== "running") {
          return job;
        }
        return {
          ...job,
          updatedAt: nowIso(),
          overallStatus: "interrupted",
          styles: job.styles.map((style) =>
            style.status === "running"
              ? {
                  ...style,
                  status: "interrupted",
                  updatedAt: nowIso(),
                  errorMessage: "Server restart saat job berjalan."
                }
              : style
          )
        };
      })
    );
  }

  public static computeOverallStatus(styles: StyleRun[]): JobOverallStatus {
    const done = styles.filter((style) => style.status === "done").length;
    const failed = styles.filter((style) => style.status === "failed").length;
    const interrupted = styles.filter((style) => style.status === "interrupted").length;
    const running = styles.filter((style) => style.status === "running").length;
    const pending = styles.filter((style) => style.status === "pending").length;

    if (running > 0) {
      return "running";
    }
    if (pending > 0) {
      return "queued";
    }
    if (done > 0 && failed === 0 && interrupted === 0) {
      return "success";
    }
    if (done > 0 && (failed > 0 || interrupted > 0)) {
      return "partial_success";
    }
    if (done === 0 && interrupted > 0 && failed === 0) {
      return "interrupted";
    }
    return "failed";
  }

  public static setStyleStatus(
    styles: StyleRun[],
    styleId: StyleRun["styleId"],
    status: StyleStatus,
    message?: string
  ): StyleRun[] {
    return styles.map((style) => {
      if (style.styleId !== styleId) {
        return style;
      }
      return {
        ...style,
        status,
        updatedAt: nowIso(),
        errorMessage: message
      };
    });
  }

  private async cleanupJobArtifacts(jobId: string): Promise<void> {
    await Promise.all([
      rm(path.join(OUTPUTS_DIR, jobId), { recursive: true, force: true }),
      rm(path.join(UPLOADS_DIR, jobId), { recursive: true, force: true })
    ]);
  }
}
