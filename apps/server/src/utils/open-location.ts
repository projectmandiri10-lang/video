import { spawn } from "node:child_process";
import { access } from "node:fs/promises";

export async function openPathInExplorer(folderPath: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Fitur open file location hanya didukung di Windows.");
  }
  await access(folderPath);

  await new Promise<void>((resolve, reject) => {
    // Gunakan `start` via cmd agar kompatibel pada berbagai setup Windows.
    const child = spawn("cmd.exe", ["/c", "start", "", folderPath], {
      windowsHide: true,
      stdio: "ignore"
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Gagal membuka folder (exit code ${code}).`));
        return;
      }
      resolve();
    });
  });
}
