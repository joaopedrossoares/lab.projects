import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CryptoVault } from "@financas/shared/crypto";
import { injectExpress } from "../../../shared/src/test/httpHelper.js";
import { LocalConfigStore } from "../localConfigStore.js";
import { SqliteLocalOpaqueTransport } from "../opaqueTransport.js";
import { createEdgeApp } from "../server.js";
import { VaultClient } from "../vaultClient.js";

describe("Monitoring API — Railway Usage & Local Token Storage (Fase 8)", () => {
  let tmpDir: string;
  let transport: SqliteLocalOpaqueTransport;
  let client: VaultClient;
  let configStore: LocalConfigStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "financas-monitoring-test-"));
    transport = new SqliteLocalOpaqueTransport(":memory:");
    const vault = new CryptoVault("chave-mestra-teste-monitoring-fase-8-2026");
    client = new VaultClient(vault, transport);
    await client.init();
    configStore = new LocalConfigStore(tmpDir, vault);
  });

  afterEach(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("saves Railway token strictly in encrypted local volume (never in opaque DB) and aggregates metrics + cost estimate", async () => {
    const fakeRailwayFetch = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as { query?: string };
      const q = body.query || "";

      if (q.includes("getProject")) {
        return new Response(
          JSON.stringify({
            data: {
              project: {
                id: "proj-123",
                name: "financas-backend",
                environments: { edges: [{ node: { id: "env-prod", name: "production" } }] },
                services: {
                  edges: [
                    { node: { id: "svc-api", name: "api" } },
                    { node: { id: "svc-pg", name: "Postgres" } },
                  ],
                },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (q.includes("getMetrics")) {
        return new Response(
          JSON.stringify({
            data: {
              metrics: [
                {
                  measurement: "MEMORY_USAGE_GB",
                  tags: { serviceId: "svc-api" },
                  values: [
                    { ts: 1, value: 0.04 },
                    { ts: 2, value: 0.05 },
                  ],
                },
                {
                  measurement: "CPU_USAGE",
                  tags: { serviceId: "svc-api" },
                  values: [{ ts: 1, value: 0.002 }],
                },
                {
                  measurement: "MEMORY_USAGE_GB",
                  tags: { serviceId: "svc-pg" },
                  values: [{ ts: 1, value: 0.06 }],
                },
                {
                  measurement: "DISK_USAGE_GB",
                  tags: { serviceId: "svc-pg" },
                  values: [{ ts: 1, value: 0.155 }],
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          data: {
            usage: [
              { measurement: "MEMORY_USAGE_GB", value: 1200 },
              { measurement: "CPU_USAGE", value: 200 },
            ],
            estimatedUsage: [
              { measurement: "MEMORY_USAGE_GB", estimatedValue: 3600 },
              { measurement: "CPU_USAGE", estimatedValue: 600 },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const app = createEdgeApp({
      vaultClient: client,
      localConfigStore: configStore,
      railwayFetch: fakeRailwayFetch,
    });

    // Unconfigured initially
    const initialRes = await injectExpress<{ configured: boolean }>(app, {
      url: "/api/monitoring/railway/usage",
    });
    expect(initialRes.status).toBe(200);
    expect(initialRes.body.configured).toBe(false);

    // Save token & projectId locally
    const saveRes = await injectExpress<{
      config: { hasToken: boolean; tokenPreview: string; projectId: string };
    }>(app, {
      method: "PUT",
      url: "/api/monitoring/railway/config",
      body: {
        apiToken: "rw_secret_token_9999",
        projectId: "proj-123",
      },
    });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.config.hasToken).toBe(true);
    expect(saveRes.body.config.tokenPreview).toBe("rw_s…9999");
    expect(JSON.stringify(saveRes.body)).not.toContain("rw_secret_token_9999");

    // Token must NOT exist in opaque DB or in plaintext on disk
    expect(JSON.stringify(transport.inspectRawRows())).not.toContain("rw_secret_token_9999");
    const rawDiskFile = fs.readFileSync(path.join(tmpDir, "railway-config.enc"), "utf8");
    expect(rawDiskFile).not.toContain("rw_secret_token_9999");

    // Fetch aggregated Railway usage report
    const usageRes = await injectExpress<{
      configured: boolean;
      projectName: string;
      services: Array<{ serviceName: string; memoryMbCurrent: number; diskGbCurrent: number }>;
      totals: { memoryMbCurrent: number; diskGbCurrent: number };
      billingEstimate: { available: boolean; monthToDateUsd: number; projectedMonthlyUsd: number };
      recommendation: { level: string; message: string };
    }>(app, { url: "/api/monitoring/railway/usage?hours=24" });

    expect(usageRes.status).toBe(200);
    expect(usageRes.body.configured).toBe(true);
    expect(usageRes.body.projectName).toBe("financas-backend");
    expect(usageRes.body.services).toHaveLength(2);
    expect(usageRes.body.totals.memoryMbCurrent).toBeGreaterThan(100);
    expect(usageRes.body.totals.diskGbCurrent).toBeCloseTo(0.155, 3);
    expect(usageRes.body.billingEstimate.available).toBe(true);
    expect(usageRes.body.billingEstimate.projectedMonthlyUsd).toBeGreaterThan(0);
    expect(usageRes.body.recommendation.level).toBe("ok");
  });
});
