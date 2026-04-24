import path from "node:path";
import { mkdirSync } from "node:fs";
import type { SeedanceDirectorPluginConfig } from "./types.js";

const DEFAULTS: SeedanceDirectorPluginConfig = {
  ark: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyEnv: "ARK_API_KEY",
    videoModel: "doubao-seedance-2-0-260128",
    fastVideoModel: "doubao-seedance-2-0-260128",
    directorModel: "MiniMax-M2.7",
    directorBaseUrl: "https://api.minimaxi.com/v1",
    directorApiKeyEnv: "DIRECTOR_OPENAI_API_KEY",
    pollIntervalMs: 15_000,
    taskTimeoutMs: 30 * 60 * 1000,
    maxRetries: 2,
  },
  planning: {
    preferredAspectRatio: "16:9",
    defaultClipDurationSeconds: 8,
    defaultTargetMinutes: 2.5,
    maxSegmentCount: 24,
    enableDirectorModel: true,
    continuityMode: "video_reference",
  },
  rendering: {
    outputDir: ".seedance-story-director",
    stitchSegments: false,
    keepIntermediateFiles: true,
    downloadRemoteOutputs: true,
  },
};

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function deepMerge<T>(base: T, input: unknown): T {
  const source = asRecord(input);
  const result = structuredClone(base) as Record<string, unknown>;

  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof result[key] === "object" && result[key] !== null && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value);
      continue;
    }
    result[key] = value;
  }

  return result as T;
}

function resolveEnv(config: SeedanceDirectorPluginConfig): SeedanceDirectorPluginConfig {
  const apiKeyEnv = config.ark.apiKeyEnv || "ARK_API_KEY";
  const directorApiKeyEnv = config.ark.directorApiKeyEnv || "DIRECTOR_OPENAI_API_KEY";
  const directorModelEnv =
    process.env.DIRECTOR_OPENAI_MODEL ||
    process.env.SEEDANCE_DIRECTOR_MODEL;
  const directorBaseUrlEnv =
    process.env.DIRECTOR_OPENAI_BASE_URL ||
    process.env.SEEDANCE_DIRECTOR_BASE_URL;
  const directorApiKeyEnvValue =
    process.env[directorApiKeyEnv] ||
    process.env.DIRECTOR_OPENAI_API_KEY ||
    process.env.MINIMAX_API_KEY;

  return {
    ...config,
    ark: {
      ...config.ark,
      baseUrl: process.env.ARK_BASE_URL || config.ark.baseUrl,
      apiKey: config.ark.apiKey || process.env[apiKeyEnv],
      videoModel: process.env.SEEDANCE_VIDEO_MODEL || config.ark.videoModel,
      fastVideoModel: process.env.SEEDANCE_VIDEO_MODEL_FAST || config.ark.fastVideoModel,
      directorModel: directorModelEnv || config.ark.directorModel,
      directorBaseUrl: directorBaseUrlEnv || config.ark.directorBaseUrl,
      directorApiKey: config.ark.directorApiKey || directorApiKeyEnvValue,
      directorApiKeyEnv,
    },
  };
}

export function resolveConfig(rawConfig: unknown, options?: { rootDir?: string }): SeedanceDirectorPluginConfig {
  const merged = deepMerge(DEFAULTS, rawConfig);
  const config = resolveEnv(merged);
  const rootDir = options?.rootDir || process.cwd();
  const outputDir = path.isAbsolute(config.rendering.outputDir)
    ? config.rendering.outputDir
    : path.resolve(rootDir, config.rendering.outputDir);

  mkdirSync(outputDir, { recursive: true });

  return {
    ...config,
    rendering: {
      ...config.rendering,
      outputDir,
    },
  };
}

export function requireArkApiKey(config: SeedanceDirectorPluginConfig): string {
  if (!config.ark.apiKey) {
    throw new Error(`Missing ARK API key. Set ${config.ark.apiKeyEnv} or plugins.entries.seedance-story-director.config.ark.apiKey.`);
  }
  return config.ark.apiKey;
}
