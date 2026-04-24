import type { CreateTaskPayload, SeedanceDirectorPluginConfig, SeedanceTaskResult } from "./types.js";
import { collectUrls, sleep } from "./utils.js";

function makeHeaders(apiKey: string): HeadersInit {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
}

async function requestJson(url: string, init: RequestInit, config: SeedanceDirectorPluginConfig, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let attempt = 0;

  while (true) {
    attempt += 1;
    const response = await fetch(url, { ...init, signal });
    if (response.ok) {
      return (await response.json()) as Record<string, unknown>;
    }

    const bodyText = await response.text();
    const retryable = response.status >= 500 || response.status === 429;
    if (!retryable || attempt > config.ark.maxRetries + 1) {
      throw new Error(`Seedance request failed: ${response.status} ${response.statusText} - ${bodyText}`);
    }
    await sleep(1000 * attempt, signal);
  }
}

function buildTaskPath(baseUrl: string, taskId?: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return taskId ? `${normalized}/contents/generations/tasks/${taskId}` : `${normalized}/contents/generations/tasks`;
}

export class SeedanceClient {
  constructor(private readonly config: SeedanceDirectorPluginConfig, private readonly apiKey: string) {}

  async createTask(payload: CreateTaskPayload, signal?: AbortSignal): Promise<{ id: string; raw: Record<string, unknown> }> {
    const raw = await requestJson(
      buildTaskPath(this.config.ark.baseUrl),
      {
        method: "POST",
        headers: makeHeaders(this.apiKey),
        body: JSON.stringify(payload),
      },
      this.config,
      signal
    );

    const id = typeof raw.id === "string" ? raw.id : undefined;
    if (!id) {
      throw new Error(`Seedance createTask did not return an id: ${JSON.stringify(raw)}`);
    }
    return { id, raw };
  }

  async getTask(taskId: string, signal?: AbortSignal): Promise<SeedanceTaskResult> {
    const raw = await requestJson(
      buildTaskPath(this.config.ark.baseUrl, taskId),
      {
        method: "GET",
        headers: makeHeaders(this.apiKey),
      },
      this.config,
      signal
    );

    const status = typeof raw.status === "string" ? raw.status : "unknown";
    const error =
      (typeof raw.error === "string" && raw.error) ||
      (raw.error && typeof raw.error === "object" && typeof (raw.error as Record<string, unknown>).message === "string"
        ? ((raw.error as Record<string, unknown>).message as string)
        : undefined);

    return {
      id: taskId,
      status,
      raw,
      error,
      ...collectUrls(raw),
    };
  }

  async waitForTask(taskId: string, signal?: AbortSignal): Promise<SeedanceTaskResult> {
    const startedAt = Date.now();

    while (true) {
      const result = await this.getTask(taskId, signal);
      if (result.status === "succeeded") {
        return result;
      }
      if (result.status === "failed" || result.status === "cancelled" || result.status === "deleted") {
        throw new Error(result.error || `Seedance task ${taskId} failed with status ${result.status}.`);
      }
      if (Date.now() - startedAt > this.config.ark.taskTimeoutMs) {
        throw new Error(`Seedance task ${taskId} timed out after ${this.config.ark.taskTimeoutMs}ms.`);
      }
      await sleep(this.config.ark.pollIntervalMs, signal);
    }
  }
}
