import { readFile } from "node:fs/promises";
import path from "node:path";
import { runStoryVideoPipeline } from "../service.js";
import type { StoryVideoRequest } from "../types.js";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    i += 1;
  }

  return parsed;
}

async function loadRequest(inputPath?: string): Promise<StoryVideoRequest> {
  if (inputPath) {
    const content = await readFile(path.resolve(inputPath), "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.prompt === "string" && !parsed.mode) {
      return {
        mode: "single_clip",
        ...parsed,
      } as StoryVideoRequest;
    }
    if (typeof parsed.text === "string" && !parsed.mode) {
      return {
        mode: "short_film",
        ...parsed,
      } as StoryVideoRequest;
    }
    return parsed as StoryVideoRequest;
  }

  return {
    mode: "single_clip",
    prompt: "A cinematic realism shot of a lone traveler entering a rain-soaked railway station at dawn, soft handheld push-in, subtle atmospheric fog, wet reflections.",
    title: "cli-smoke-test",
    clipDurationSeconds: 8,
    aspectRatio: "16:9",
    generateAudio: false,
    watermark: true,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = typeof args.input === "string" ? args.input : undefined;
  const prompt = typeof args.prompt === "string" ? args.prompt : undefined;
  const outputDir = typeof args.outputDir === "string" ? args.outputDir : undefined;
  const dryRun = Boolean(args.dryRun);
  const request = await loadRequest(inputPath);

  if (prompt) {
    request.mode = "single_clip";
    request.prompt = prompt;
  }

  if (outputDir) {
    request.outputDir = outputDir;
  }

  if (dryRun) {
    request.dryRun = true;
  }

  const manifest = await runStoryVideoPipeline({
    request,
    rawConfig: {},
    runtime: {
      workspaceDir: process.cwd(),
    },
    progress(message, details) {
      const detailText = details ? ` ${JSON.stringify(details)}` : "";
      console.log(`[seedance-director] ${message}${detailText}`);
    },
  });

  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
