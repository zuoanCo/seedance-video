import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
  it("resolves relative output directories", () => {
    const config = resolveConfig(
      {
        rendering: {
          outputDir: ".custom-seedance-output",
        },
      },
      { rootDir: "C:/workspace/demo" }
    );

    expect(config.rendering.outputDir).toContain(".custom-seedance-output");
  });
});
