import { describe, expect, it } from "vitest";
import { formatGeminiError, GeminiAIProvider, isVertexExpressApiKey } from "./provider.js";

describe("GeminiAIProvider Vertex Express detection & error formatting", () => {
  it("detects GCP Vertex AI Express Mode keys (AQ.*) vs AI Studio keys (AIza*)", () => {
    expect(isVertexExpressApiKey("AQ.Ab8RN6ExampleKey")).toBe(true);
    expect(isVertexExpressApiKey("AIzaSyExampleKey")).toBe(false);

    const vertexProvider = new GeminiAIProvider("AQ.Ab8RN6ExampleKey", "gemini-3.5-flash-lite");
    expect(vertexProvider.isVertexExpress).toBe(true);
    expect(vertexProvider.providerName).toBe("gemini-vertex-express");

    const studioProvider = new GeminiAIProvider("AIzaSyExampleKey", "gemini-4-hydrogen");
    expect(studioProvider.isVertexExpress).toBe(false);
    expect(studioProvider.providerName).toBe("gemini");
  });

  it("extracts readable Google API error messages and adds model hint on Vertex 404", () => {
    const err = new Error(
      '{"error":{"code":404,"message":"Publisher model not found"}}'
    );
    const formatted = formatGeminiError(err, true, "gemini-4-hydrogen");
    expect(formatted).toContain("HTTP 404 Publisher model not found");
    expect(formatted).toContain("gemini-3.5-flash-lite");
  });
});
