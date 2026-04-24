import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { stitchVideoSegments } from "../src/stitcher.js";

describe("stitchVideoSegments", () => {
  it("copies a single segment into the final output path", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "seedance-stitcher-single-"));
    const inputFile = path.join(rootDir, "segment-01.mp4");
    const outputFile = path.join(rootDir, "final", "result.mp4");

    await writeFile(inputFile, "segment-one", "utf8");

    const result = await stitchVideoSegments({
      inputFiles: [inputFile],
      outputFile,
      hasAudio: false,
    });

    expect(result.stitched).toBe(true);
    expect(result.outputFile).toBe(outputFile);
    await expect(readFile(outputFile, "utf8")).resolves.toBe("segment-one");
  });

  it("exports a concat list instead of spawning local processes for multi-segment runs", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "seedance-stitcher-multi-"));
    const first = path.join(rootDir, "segment-01.mp4");
    const second = path.join(rootDir, "segment-02.mp4");
    const outputFile = path.join(rootDir, "final", "result.mp4");

    await writeFile(first, "one", "utf8");
    await writeFile(second, "two", "utf8");

    const result = await stitchVideoSegments({
      inputFiles: [first, second],
      outputFile,
      hasAudio: true,
    });

    expect(result.stitched).toBe(false);
    expect(result.outputFile).toBeUndefined();
    expect(result.concatListPath).toBe(path.join(path.dirname(outputFile), "concat-list.txt"));
    expect(result.reason).toContain("disabled");
    await expect(readFile(result.concatListPath!, "utf8")).resolves.toContain("segment-01.mp4");
  });
});
