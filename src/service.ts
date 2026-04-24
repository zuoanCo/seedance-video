import path from "node:path";
import { mkdir } from "node:fs/promises";
import type {
  CreateTaskPayload,
  ProgressReporter,
  ReferenceAsset,
  ResolvedRuntimeContext,
  SeedanceDirectorPluginConfig,
  SegmentExecutionResult,
  SegmentPlan,
  StoryVideoPlan,
  StoryVideoRequest,
  StoryVideoRunManifest,
} from "./types.js";
import { resolveConfig, requireArkApiKey } from "./config.js";
import { createStoryPlan } from "./director.js";
import { SeedanceClient } from "./seedance-client.js";
import { stitchVideoSegments } from "./stitcher.js";
import { downloadToFile, ensureDir, isHttpsUrl, nowStamp, slugify, writeJson, writeText } from "./utils.js";

function normalizeReferenceAssets(items: string[] | ReferenceAsset[] | undefined, defaultRole: ReferenceAsset["role"]): ReferenceAsset[] {
  if (!items || items.length === 0) {
    return [];
  }

  return items.map((item) =>
    typeof item === "string"
      ? { url: item, role: defaultRole }
      : {
          ...item,
          role: item.role || defaultRole,
        }
  );
}

function estimateSegmentCount(request: StoryVideoRequest, config: SeedanceDirectorPluginConfig, clipDurationSeconds: number): number {
  if (request.mode === "single_clip") {
    return 1;
  }

  if (request.targetMinutes && request.targetMinutes > 0) {
    return Math.min(config.planning.maxSegmentCount, Math.max(2, Math.ceil((request.targetMinutes * 60) / clipDurationSeconds)));
  }

  const text = request.text || request.prompt || "";
  const rough = Math.ceil(Math.max(1, text.length) / 80);
  return Math.min(config.planning.maxSegmentCount, Math.max(4, rough));
}

function buildContentForSegment(
  request: StoryVideoRequest,
  segment: SegmentPlan,
  previousRemoteVideoUrl?: string
): CreateTaskPayload["content"] {
  const content: CreateTaskPayload["content"] = [{ type: "text", text: segment.seedancePrompt }];

  if (previousRemoteVideoUrl && isHttpsUrl(previousRemoteVideoUrl)) {
    content.push({
      type: "video_url",
      video_url: { url: previousRemoteVideoUrl },
      role: "reference_video",
    });
  }

  for (const asset of normalizeReferenceAssets(request.referenceImages, "reference_image")) {
    if (!isHttpsUrl(asset.url)) {
      continue;
    }
    content.push({
      type: "image_url",
      image_url: { url: asset.url },
      role: asset.role || "reference_image",
    });
  }

  for (const asset of normalizeReferenceAssets(request.referenceVideos, "reference_video")) {
    if (!isHttpsUrl(asset.url)) {
      continue;
    }
    content.push({
      type: "video_url",
      video_url: { url: asset.url },
      role: asset.role || "reference_video",
    });
  }

  for (const asset of normalizeReferenceAssets(request.referenceAudios, "reference_audio")) {
    if (!isHttpsUrl(asset.url)) {
      continue;
    }
    content.push({
      type: "audio_url",
      audio_url: { url: asset.url },
      role: asset.role || "reference_audio",
    });
  }

  return content;
}

function createStoryboard(plan: StoryVideoPlan): string {
  const lines: string[] = [
    `# ${plan.title}`,
    "",
    `Logline: ${plan.logline}`,
    "",
    "## Style Bible",
    ...plan.styleBible.map((item) => `- ${item}`),
    "",
    "## Character Bible",
    ...plan.characterBible.map((item) => `- ${item}`),
    "",
    "## World Bible",
    ...plan.worldBible.map((item) => `- ${item}`),
    "",
    "## Segments",
  ];

  for (const segment of plan.segments) {
    lines.push("");
    lines.push(`### ${segment.index}. ${segment.title}`);
    lines.push(`- Duration: ${segment.durationSeconds}s`);
    lines.push(`- Purpose: ${segment.narrativePurpose}`);
    lines.push(`- Summary: ${segment.summary}`);
    lines.push(`- Location: ${segment.location}`);
    lines.push(`- Camera: ${segment.cameraLanguage}`);
    lines.push(`- Style: ${segment.visualStyle}`);
    lines.push(`- Sound: ${segment.soundDesign}`);
    if (segment.bridgeIn) {
      lines.push(`- Bridge In: ${segment.bridgeIn}`);
    }
    if (segment.bridgeOut) {
      lines.push(`- Bridge Out: ${segment.bridgeOut}`);
    }
    lines.push(`- Continuity: ${segment.continuityAnchors.join("; ")}`);
    lines.push("");
    lines.push(segment.seedancePrompt);
  }

  if (plan.voiceover) {
    lines.push("");
    lines.push("## Voiceover");
    lines.push(plan.voiceover);
  }

  if (plan.musicBrief) {
    lines.push("");
    lines.push("## Music Brief");
    lines.push(plan.musicBrief);
  }

  return `${lines.join("\n")}\n`;
}

export async function runStoryVideoPipeline(params: {
  request: StoryVideoRequest;
  rawConfig: unknown;
  runtime?: ResolvedRuntimeContext;
  progress?: ProgressReporter;
}): Promise<StoryVideoRunManifest> {
  const rootDir = params.request.outputDir || params.runtime?.workspaceDir || process.cwd();
  const config = resolveConfig(params.rawConfig, { rootDir });
  const request = {
    ...params.request,
    generateAudio: params.request.generateAudio ?? false,
    watermark: params.request.watermark ?? true,
  };
  const clipDurationSeconds = Math.min(15, Math.max(4, Math.round(request.clipDurationSeconds || config.planning.defaultClipDurationSeconds)));
  const aspectRatio = request.aspectRatio || config.planning.preferredAspectRatio;
  const segmentCount = estimateSegmentCount(request, config, clipDurationSeconds);
  const title = request.title || (request.mode === "single_clip" ? "single-video-test" : "seedance-story-video");
  const runDir = path.join(config.rendering.outputDir, `${slugify(title)}-${nowStamp()}`);
  const planPath = path.join(runDir, "plan.json");
  const storyboardPath = path.join(runDir, "storyboard.md");
  const manifestPath = path.join(runDir, "manifest.json");
  const segmentsDir = path.join(runDir, "segments");
  const finalDir = path.join(runDir, "final");

  await ensureDir(runDir);
  await mkdir(segmentsDir, { recursive: true });
  await mkdir(finalDir, { recursive: true });

  params.progress?.("planning_story_video", {
    title,
    segmentCount,
    clipDurationSeconds,
    aspectRatio,
  });

  const { plan, usedDirectorModel } = await createStoryPlan(request, config, {
    segmentCount,
    clipDurationSeconds,
    aspectRatio,
  });

  await writeJson(planPath, plan);
  await writeText(storyboardPath, createStoryboard(plan));

  const warnings: string[] = [];
  const manifest: StoryVideoRunManifest = {
    request,
    configSnapshot: config,
    plan,
    runDir,
    planPath,
    storyboardPath,
    manifestPath,
    usedDirectorModel,
    segmentCount: plan.segments.length,
    segments: [],
    warnings,
  };

  if (request.dryRun) {
    await writeJson(manifestPath, manifest);
    return manifest;
  }

  const apiKey = requireArkApiKey(config);
  const client = new SeedanceClient(config, apiKey);
  let previousRemoteVideoUrl: string | undefined;

  for (const segment of plan.segments) {
    params.progress?.("creating_segment", {
      segment: segment.index,
      title: segment.title,
    });

    const payload: CreateTaskPayload = {
      model: request.model || (request.useFastModel ? config.ark.fastVideoModel : config.ark.videoModel),
      content: buildContentForSegment(request, segment, config.planning.continuityMode === "video_reference" ? previousRemoteVideoUrl : undefined),
      duration: segment.durationSeconds,
      ratio: aspectRatio,
      generate_audio: Boolean(request.generateAudio),
      watermark: Boolean(request.watermark),
    };

    const created = await client.createTask(payload);
    params.progress?.("polling_segment", {
      segment: segment.index,
      taskId: created.id,
    });
    const result = await client.waitForTask(created.id);
    const metadataPath = path.join(segmentsDir, `segment-${String(segment.index).padStart(2, "0")}.json`);
    let localVideoPath: string | undefined;

    if (result.videoUrl && config.rendering.downloadRemoteOutputs) {
      localVideoPath = path.join(segmentsDir, `segment-${String(segment.index).padStart(2, "0")}.mp4`);
      await downloadToFile(result.videoUrl, localVideoPath);
    }

    previousRemoteVideoUrl = result.videoUrl || previousRemoteVideoUrl;

    const segmentResult: SegmentExecutionResult = {
      plan: segment,
      taskId: created.id,
      status: result.status,
      remoteVideoUrl: result.videoUrl,
      previewImageUrl: result.previewImageUrl,
      lastFrameUrl: result.lastFrameUrl,
      localVideoPath,
      metadataPath,
    };

    await writeJson(metadataPath, {
      requestPayload: payload,
      created,
      result,
      segment,
    });
    manifest.segments.push(segmentResult);
  }

  const localSegmentFiles = manifest.segments
    .map((item) => item.localVideoPath)
    .filter((item): item is string => Boolean(item));

  if (config.rendering.stitchSegments && localSegmentFiles.length > 0) {
    const finalVideoPath = path.join(finalDir, `${slugify(plan.title)}.mp4`);
    try {
      const stitched = await stitchVideoSegments({
        inputFiles: localSegmentFiles,
        outputFile: finalVideoPath,
        ffmpegPath: config.rendering.ffmpegPath,
        hasAudio: Boolean(request.generateAudio),
      });
      if (stitched.stitched) {
        manifest.finalVideoPath = stitched.outputFile;
      } else if (stitched.reason) {
        warnings.push(stitched.reason);
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  await writeJson(manifestPath, manifest);
  return manifest;
}
