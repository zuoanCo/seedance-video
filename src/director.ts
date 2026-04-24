import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";
import type { SeedanceDirectorPluginConfig, StoryVideoPlan, StoryVideoRequest } from "./types.js";
import { chunkByCount, estimateSentenceSplits } from "./utils.js";

function buildSystemPrompt(): string {
  return [
    "You are a world-class short film director and AI-video screenwriter.",
    "You are optimizing specifically for Seedance 2.0 text-to-video generation.",
    "Return JSON only.",
    "Create a filmable plan that preserves story continuity across many 4-15 second segments.",
    "Every segment must have a clear bridge_in or bridge_out idea when needed.",
    "Prompts must be visually concrete: subject, environment, motion, lens language, lighting, mood, continuity anchors, and what should stay consistent.",
    "Do not invent impossible continuity jumps unless the user asked for surrealism.",
    "Keep prompts compact but richly visual. Avoid markdown."
  ].join(" ");
}

function buildUserPrompt(request: StoryVideoRequest, segmentCount: number, clipDurationSeconds: number, aspectRatio: string): string {
  const baseText = request.mode === "single_clip" ? request.prompt || request.text || "" : request.text || request.prompt || "";
  const references = [
    ...(request.referenceImages || []).map((asset, index) => `Image ${index + 1}: ${asset.description || asset.url}`),
    ...(request.referenceVideos || []).map((asset, index) => `Video ${index + 1}: ${asset.description || asset.url}`),
    ...(request.referenceAudios || []).map((asset, index) => `Audio ${index + 1}: ${asset.description || asset.url}`),
  ];

  return JSON.stringify(
    {
      title: request.title,
      mode: request.mode,
      inputText: baseText,
      directorStyle: request.directorStyle || "cinematic realism, coherent narrative continuity, emotionally grounded performances",
      targetMinutes: request.targetMinutes,
      desiredSegmentCount: segmentCount,
      clipDurationSeconds,
      aspectRatio,
      generateAudio: request.generateAudio ?? false,
      references,
      responseShape: {
        title: "string",
        logline: "string",
        styleBible: ["string"],
        characterBible: ["string"],
        worldBible: ["string"],
        totalTargetSeconds: "number",
        voiceover: "string or omitted",
        musicBrief: "string or omitted",
        segments: [
          {
            index: "number",
            title: "string",
            summary: "string",
            durationSeconds: "number between 4 and 15",
            narrativePurpose: "string",
            bridgeIn: "string or omitted",
            bridgeOut: "string or omitted",
            location: "string",
            cameraLanguage: "string",
            visualStyle: "string",
            soundDesign: "string",
            continuityAnchors: ["string"],
            seedancePrompt: "string"
          }
        ]
      }
    },
    null,
    2
  );
}

function normalizePlan(raw: StoryVideoPlan, request: StoryVideoRequest, segmentCount: number, clipDurationSeconds: number): StoryVideoPlan {
  const segments = Array.isArray(raw.segments) ? raw.segments : [];

  return {
    title: raw.title || request.title || "Untitled Seedance Story",
    mode: request.mode,
    logline: raw.logline || "A short cinematic adaptation generated from the user's story.",
    styleBible: Array.isArray(raw.styleBible) && raw.styleBible.length > 0 ? raw.styleBible : ["cinematic realism", "clear visual continuity"],
    characterBible: Array.isArray(raw.characterBible) && raw.characterBible.length > 0 ? raw.characterBible : ["Keep protagonist identity, age impression, wardrobe silhouette, and emotional arc consistent."],
    worldBible: Array.isArray(raw.worldBible) && raw.worldBible.length > 0 ? raw.worldBible : ["Preserve the same world logic, time of day progression, and production design language."],
    totalTargetSeconds: Math.max(clipDurationSeconds * segmentCount, raw.totalTargetSeconds || 0),
    voiceover: raw.voiceover,
    musicBrief: raw.musicBrief,
    segments: segments.map((segment, index) => ({
      index: index + 1,
      title: segment.title || `Segment ${index + 1}`,
      summary: segment.summary || "",
      durationSeconds: Math.min(15, Math.max(4, Math.round(segment.durationSeconds || clipDurationSeconds))),
      narrativePurpose: segment.narrativePurpose || segment.summary || `Advance the story beat for segment ${index + 1}.`,
      bridgeIn: segment.bridgeIn,
      bridgeOut: segment.bridgeOut,
      location: segment.location || "story-driven cinematic environment",
      cameraLanguage: segment.cameraLanguage || "cinematic medium shot with motivated motion",
      visualStyle: segment.visualStyle || request.directorStyle || "cinematic realism",
      soundDesign: segment.soundDesign || "subtle ambient sound cues matching the location",
      continuityAnchors: Array.isArray(segment.continuityAnchors) && segment.continuityAnchors.length > 0
        ? segment.continuityAnchors
        : ["keep protagonist appearance consistent", "preserve wardrobe and lighting continuity"],
      seedancePrompt: segment.seedancePrompt || "",
    })),
  };
}

function fallbackPlan(request: StoryVideoRequest, segmentCount: number, clipDurationSeconds: number, aspectRatio: string): StoryVideoPlan {
  const text = request.mode === "single_clip" ? request.prompt || request.text || "" : request.text || request.prompt || "";
  const sentences = estimateSentenceSplits(text);
  const source = sentences.length > 0 ? [...sentences] : [text];
  while (source.length < segmentCount) {
    source.push(source[source.length - 1] || text);
  }
  const groups = chunkByCount(source, segmentCount);
  const style = request.directorStyle || "cinematic realism, grounded acting, coherent production design";

  const segments = groups.map((group, index) => {
    const beat = group.join(" ").trim();
    const bridgeIn = index === 0 ? "Open on a clear establishing image." : "Continue directly from the previous segment without changing protagonist identity or wardrobe.";
    const bridgeOut = index === groups.length - 1 ? "Land on a visually resolved final image." : "End on a visual action that can flow into the next shot.";

    return {
      index: index + 1,
      title: `Segment ${index + 1}`,
      summary: beat,
      durationSeconds: clipDurationSeconds,
      narrativePurpose: beat || `Advance the story through segment ${index + 1}.`,
      bridgeIn,
      bridgeOut,
      location: "cinematic environment inferred from the story",
      cameraLanguage: index === 0 ? "strong establishing shot, then gentle push-in" : "motivated follow-through from the previous segment",
      visualStyle: style,
      soundDesign: request.generateAudio ? "natural ambience that matches the scene" : "designed for later post-produced soundscape",
      continuityAnchors: [
        "same protagonist face and body language",
        "same wardrobe silhouette and palette",
        `keep aspect ratio ${aspectRatio}`
      ],
      seedancePrompt: [
        `${style}.`,
        `Aspect ratio ${aspectRatio}.`,
        bridgeIn,
        beat || text,
        index > 0 ? "Continue seamlessly from the previous shot. Preserve character identity, costume, lens language, lighting direction, and motion rhythm." : "",
        bridgeOut,
        "No abrupt scene jump, no extra characters unless the story requires them, no text overlay, no broken anatomy."
      ]
        .filter(Boolean)
        .join(" "),
    };
  });

  return {
    title: request.title || "Untitled Seedance Story",
    mode: request.mode,
    logline: text.slice(0, 160),
    styleBible: [style, "consistent character continuity", "clean visual bridge between segments"],
    characterBible: ["Keep the main character's face, age impression, hairstyle, wardrobe, and emotional arc stable."],
    worldBible: ["Preserve the same location logic, weather logic, and light progression unless the story explicitly shifts."],
    totalTargetSeconds: segmentCount * clipDurationSeconds,
    voiceover: request.mode === "short_film" ? text : undefined,
    musicBrief: request.generateAudio ? "Use restrained cinematic ambience that does not fight the cut points." : "Silent assembly first; music can be added in post.",
    segments,
  };
}

export async function createStoryPlan(
  request: StoryVideoRequest,
  config: SeedanceDirectorPluginConfig,
  options: { segmentCount: number; clipDurationSeconds: number; aspectRatio: string }
): Promise<{ plan: StoryVideoPlan; usedDirectorModel: boolean }> {
  const fallback = fallbackPlan(request, options.segmentCount, options.clipDurationSeconds, options.aspectRatio);
  const shouldUseDirector = config.planning.enableDirectorModel && Boolean(config.ark.directorModel) && Boolean(config.ark.directorApiKey);

  if (!shouldUseDirector) {
    return { plan: fallback, usedDirectorModel: false };
  }

  try {
    const client = new OpenAI({
      apiKey: config.ark.directorApiKey,
      baseURL: config.ark.directorBaseUrl || config.ark.baseUrl,
    });

    const completion = await client.chat.completions.create({
      model: config.ark.directorModel!,
      temperature: 0.7,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(request, options.segmentCount, options.clipDurationSeconds, options.aspectRatio) },
      ],
    });

    const rawText = completion.choices[0]?.message?.content;
    if (!rawText) {
      return { plan: fallback, usedDirectorModel: false };
    }

    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(jsonrepair(cleaned)) as StoryVideoPlan;
    const plan = normalizePlan(parsed, request, options.segmentCount, options.clipDurationSeconds);

    if (plan.segments.length === 0) {
      return { plan: fallback, usedDirectorModel: false };
    }

    return { plan, usedDirectorModel: true };
  } catch {
    return { plan: fallback, usedDirectorModel: false };
  }
}
