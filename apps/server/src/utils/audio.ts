import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { probeVideoDuration } from "./video.js";

function resolveFfmpegExecutable(): string {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const fromPackage = (ffmpegPath as unknown as string | null) ?? null;
  if (fromPackage && existsSync(fromPackage)) {
    return fromPackage;
  }

  // Fallback ke PATH sistem jika ffmpeg-static tidak berhasil mengunduh binary.
  return "ffmpeg";
}

const FFMPEG_EXEC = resolveFfmpegExecutable();

function createWavHeader(
  dataLength: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

function toWavIfPcm(data: Buffer, mimeType: string): Buffer {
  const normalized = mimeType.toLowerCase();
  const pcmMime =
    normalized.includes("l16") ||
    normalized.includes("raw") ||
    normalized.includes("pcm");
  if (!pcmMime) {
    return data;
  }
  const header = createWavHeader(data.length, 24000, 1, 16);
  return Buffer.concat([header, data]);
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_EXEC, args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += String(chunk);
    });
    proc.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `ffmpeg tidak ditemukan (${FFMPEG_EXEC}). Jalankan 'npm rebuild ffmpeg-static' atau set env FFMPEG_PATH ke lokasi ffmpeg.exe.`
          )
        );
        return;
      }
      reject(error);
    });
    proc.once("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg gagal: ${stderr || code}`));
        return;
      }
      resolve();
    });
  });
}

function buildAtempoFilter(targetFactor: number): string {
  let factor = Math.max(0.25, Math.min(4, targetFactor));
  const filters: string[] = [];

  while (factor > 2) {
    filters.push("atempo=2");
    factor /= 2;
  }
  while (factor < 0.5) {
    filters.push("atempo=0.5");
    factor /= 0.5;
  }
  filters.push(`atempo=${factor.toFixed(6)}`);
  return filters.join(",");
}

export async function writeWav24kMono(
  audioData: Buffer,
  mimeType: string,
  outputPath: string,
  speechRate = 1
): Promise<void> {
  const workingDir = path.join(path.dirname(outputPath), `.tmp-${randomUUID()}`);
  await mkdir(workingDir, { recursive: true });
  const tempIn = path.join(workingDir, "input.wav");
  try {
    const safeBuffer = toWavIfPcm(audioData, mimeType);
    await writeFile(tempIn, safeBuffer);
    const normalizedSpeechRate = Math.max(0.7, Math.min(1.3, speechRate));
    const audioArgs =
      normalizedSpeechRate === 1 ? [] : ["-filter:a", `atempo=${normalizedSpeechRate}`];
    await runFfmpeg([
      "-y",
      "-i",
      tempIn,
      ...audioArgs,
      "-ac",
      "1",
      "-ar",
      "24000",
      "-sample_fmt",
      "s16",
      outputPath
    ]);
  } finally {
    await rm(workingDir, { recursive: true, force: true });
  }
}

export async function combineVideoWithVoiceOver(
  sourceVideoPath: string,
  voiceWavPath: string,
  outputVideoPath: string,
  targetDurationSec: number
): Promise<void> {
  const safeTargetDurationSec = Math.max(1, targetDurationSec);
  const voiceDurationSec = await probeVideoDuration(voiceWavPath);
  const durationDiff = Math.abs(voiceDurationSec - safeTargetDurationSec);
  const tempoFactor = voiceDurationSec / safeTargetDurationSec;
  const tempoFilter =
    durationDiff > 0.12 ? `${buildAtempoFilter(tempoFactor)},` : "";
  const targetDurationText = safeTargetDurationSec.toFixed(3);
  const audioFilter = `${tempoFilter}atrim=0:${targetDurationText},apad=pad_dur=${targetDurationText}`;

  await runFfmpeg([
    "-y",
    "-i",
    sourceVideoPath,
    "-i",
    voiceWavPath,
    "-filter_complex",
    `[1:a]${audioFilter}[aout]`,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "24000",
    "-ac",
    "1",
    "-t",
    targetDurationText,
    outputVideoPath
  ]);
}
