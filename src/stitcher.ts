import path from "node:path";
import { copyFile, writeFile } from "node:fs/promises";
import { ensureDir } from "./utils.js";

type StitchVideoSegmentsResult = {
  stitched: boolean;
  reason?: string;
  outputFile?: string;
  concatListPath?: string;
};

export async function stitchVideoSegments(params: {
  inputFiles: string[];
  outputFile: string;
  hasAudio: boolean;
}): Promise<StitchVideoSegmentsResult> {
  const { inputFiles, outputFile, hasAudio } = params;

  if (inputFiles.length === 0) {
    return { stitched: false, reason: "No input files were generated." };
  }

  await ensureDir(path.dirname(outputFile));

  if (inputFiles.length === 1) {
    await copyFile(inputFiles[0], outputFile);
    return { stitched: true, outputFile };
  }

  const listFile = path.join(path.dirname(outputFile), "concat-list.txt");
  const listContent = inputFiles.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listFile, `${listContent}\n`, "utf8");
  const audioHint = hasAudio ? "Use AAC audio settings when assembling." : "Assemble without audio tracks.";

  return {
    stitched: false,
    concatListPath: listFile,
    reason: `Local segment stitching is disabled in the community plugin build to satisfy OpenClaw safety checks. Use concat list ${listFile} and assemble ${outputFile} in a trusted external media pipeline. ${audioHint}`,
  };
}
