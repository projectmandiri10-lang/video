import { spawn } from "node:child_process";
import ffprobeStatic from "ffprobe-static";

export async function probeVideoDuration(filePath: string): Promise<number> {
  const ffprobePath = (ffprobeStatic as { path?: string }).path;
  if (!ffprobePath) {
    throw new Error("ffprobe-static tidak tersedia.");
  }

  return new Promise<number>((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ];
    const process = spawn(ffprobePath, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    process.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    process.once("error", (error) => reject(error));
    process.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Gagal membaca durasi video: ${stderr || code}`));
        return;
      }
      const duration = Number(stdout.trim());
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("Durasi video tidak valid."));
        return;
      }
      resolve(duration);
    });
  });
}
