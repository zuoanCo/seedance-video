import { describe, expect, it } from "vitest";
import { createStoryPlan } from "../src/director.js";
import { resolveConfig } from "../src/config.js";
import type { StoryVideoRequest } from "../src/types.js";

describe("createStoryPlan", () => {
  it("falls back to heuristic planning without API key", async () => {
    const config = resolveConfig(
      {
        planning: { enableDirectorModel: true },
        ark: { apiKey: undefined, directorApiKey: undefined },
      },
      { rootDir: process.cwd() }
    );

    const request: StoryVideoRequest = {
      mode: "short_film",
      title: "night-train",
      text: "凌晨的列车驶入空城。女人拖着皮箱下车，走过潮湿站台，看见年轻时的自己在对面的窗中一闪而过。",
      clipDurationSeconds: 8,
    };

    const result = await createStoryPlan(request, config, {
      segmentCount: 4,
      clipDurationSeconds: 8,
      aspectRatio: "16:9",
    });

    expect(result.usedDirectorModel).toBe(false);
    expect(result.plan.segments.length).toBe(4);
    expect(result.plan.segments[0].seedancePrompt).toContain("16:9");
  });
});
