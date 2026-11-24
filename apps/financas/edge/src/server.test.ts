import { describe, expect, it } from "vitest";
import { injectExpress } from "../../shared/src/test/httpHelper.js";
import { createEdgeApp } from "./server.js";

describe("Edge server health", () => {
  it("responds ok on GET /health", async () => {
    const app = createEdgeApp();
    const res = await injectExpress<{ status: string; service: string }>(app, {
      url: "/health",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      service: "financas-edge",
    });
  });
});
