import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-runtime";
import { StoryVideoToolSchema, SingleVideoToolSchema } from "./tool-schema.js";
import { runStoryVideoPipeline } from "./service.js";
import type { StoryVideoRequest } from "./types.js";

type StoryVideoToolInput = Static<typeof StoryVideoToolSchema>;
type SingleVideoToolInput = Static<typeof SingleVideoToolSchema>;

function textResult<T>(text: string, details: T) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function toRequestFromStoryInput(params: StoryVideoToolInput): StoryVideoRequest {
  return {
    mode: "short_film",
    title: params.title,
    text: params.text,
    model: params.model,
    directorStyle: params.directorStyle,
    targetMinutes: params.targetMinutes,
    clipDurationSeconds: params.clipDurationSeconds,
    aspectRatio: params.aspectRatio,
    referenceImages: params.referenceImages as StoryVideoRequest["referenceImages"],
    referenceVideos: params.referenceVideos as StoryVideoRequest["referenceVideos"],
    referenceAudios: params.referenceAudios as StoryVideoRequest["referenceAudios"],
    generateAudio: params.generateAudio,
    watermark: params.watermark,
    outputDir: params.outputDir,
    dryRun: params.dryRun,
    useFastModel: params.useFastModel,
  };
}

function toRequestFromSingleInput(params: SingleVideoToolInput): StoryVideoRequest {
  return {
    mode: "single_clip",
    title: params.title,
    prompt: params.prompt,
    model: params.model,
    clipDurationSeconds: params.clipDurationSeconds,
    aspectRatio: params.aspectRatio,
    referenceImages: params.referenceImages as StoryVideoRequest["referenceImages"],
    referenceVideos: params.referenceVideos as StoryVideoRequest["referenceVideos"],
    referenceAudios: params.referenceAudios as StoryVideoRequest["referenceAudios"],
    generateAudio: params.generateAudio,
    watermark: params.watermark,
    outputDir: params.outputDir,
    dryRun: params.dryRun,
    useFastModel: params.useFastModel,
  };
}

function buildSummary(details: {
  runDir: string;
  finalVideoPath?: string;
  storyboardPath: string;
  planPath: string;
  segmentCount: number;
  usedDirectorModel: boolean;
  warnings: string[];
}): string {
  const lines = [
    `Story video run completed.`,
    `Run directory: ${details.runDir}`,
    `Plan: ${details.planPath}`,
    `Storyboard: ${details.storyboardPath}`,
    `Segments: ${details.segmentCount}`,
    `Director model used: ${details.usedDirectorModel ? "yes" : "no (heuristic fallback)"}`,
  ];

  if (details.finalVideoPath) {
    lines.push(`Final video: ${details.finalVideoPath}`);
  }

  if (details.warnings.length > 0) {
    lines.push(`Warnings: ${details.warnings.join(" | ")}`);
  }

  return lines.join("\n");
}

function createRuntimeMeta(ctx: OpenClawPluginToolContext) {
  return {
    workspaceDir: ctx.workspaceDir,
    agentDir: ctx.agentDir,
    agentId: ctx.agentId,
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
  };
}

export default definePluginEntry({
  id: "seedance-story-director",
  name: "Seedance Story Director",
  description: "Creates stitched Seedance 2.0 short films from long-form text with screenplay expansion and continuity control.",
  register(api) {
    api.registerTool(
      (ctx) => ({
        name: "seedance_story_video",
        label: "Seedance Story Video",
        description:
          "Turn a story text into a multi-segment Seedance 2.0 short film with expanded screenplay planning, continuity references, local downloads, and optional final stitching.",
        parameters: StoryVideoToolSchema,
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const manifest = await runStoryVideoPipeline({
            request: toRequestFromStoryInput(params as StoryVideoToolInput),
            rawConfig: api.pluginConfig,
            runtime: createRuntimeMeta(ctx),
          });

          return textResult(
            buildSummary({
              runDir: manifest.runDir,
              finalVideoPath: manifest.finalVideoPath,
              storyboardPath: manifest.storyboardPath,
              planPath: manifest.planPath,
              segmentCount: manifest.segmentCount,
              usedDirectorModel: manifest.usedDirectorModel,
              warnings: manifest.warnings,
            }),
            manifest
          );
        },
      }),
      { optional: true }
    );

    api.registerTool(
      (ctx) => ({
        name: "seedance_single_video_test",
        label: "Seedance Single Video Test",
        description:
          "Generate one Seedance 2.0 clip for account, model, and prompt smoke testing. It uses the same downloader and output pipeline as the full short-film workflow.",
        parameters: SingleVideoToolSchema,
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const manifest = await runStoryVideoPipeline({
            request: toRequestFromSingleInput(params as SingleVideoToolInput),
            rawConfig: api.pluginConfig,
            runtime: createRuntimeMeta(ctx),
          });

          return textResult(
            buildSummary({
              runDir: manifest.runDir,
              finalVideoPath: manifest.finalVideoPath || manifest.segments[0]?.localVideoPath,
              storyboardPath: manifest.storyboardPath,
              planPath: manifest.planPath,
              segmentCount: manifest.segmentCount,
              usedDirectorModel: manifest.usedDirectorModel,
              warnings: manifest.warnings,
            }),
            manifest
          );
        },
      }),
      { optional: true }
    );

    api.logger.info(`Loaded ${api.id} from ${path.resolve(api.rootDir || api.source)}`);
  },
});
