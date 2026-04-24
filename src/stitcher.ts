import path from "node:path";
import { copyFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { ensureDir } from "./utils.js";

function resolveFfmpeg(ffmpegPath?: string): string | undefined {
  return ffmpegPath || (typeof ffmpegStatic === "string" ? ffmpegStatic : undefined);
}

export async function stitchVideoSegments(params: {
  inputFiles: string[];
  outputFile: string;
  ffmpegPath?: string;
  hasAudio: boolean;
}): Promise<{ stitched: boolean; reason?: string; outputFile?: string }> {
  const { inputFiles, outputFile, hasAudio } = params;

  if (inputFiles.length === 0) {
    return { stitched: false, reason: "No input files were generated." };
  }

  await ensureDir(path.dirname(outputFile));

  if (inputFiles.length === 1) {
    await copyFile(inputFiles[0], outputFile);
    return { stitched: true, outputFile };
  }

  const ffmpegPath = resolveFfmpeg(params.ffmpegPath);
  if (!ffmpegPath) {
    return { stitched: false, reason: "ffmpeg binary not available. Install ffmpeg or set rendering.ffmpegPath." };
  }

  const listFile = path.join(path.dirname(outputFile), "concat-list.txt");
  const listContent = inputFiles.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listFile, `${listContent}\n`, "utf8");

  const args = hasAudio
    ? ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", outputFile]
    : ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", outputFile];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });

  return { stitched: true, outputFile };
}
