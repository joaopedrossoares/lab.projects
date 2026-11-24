import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CryptoVault } from "@financas/shared/crypto";
import type { CouplePlanNote, LabelRule, MonthlyClosing, PlannedPurchase } from "@financas/shared";
import { injectExpress } from "../../shared/src/test/httpHelper.js";
import { SqliteLocalOpaqueTransport } from "./opaqueTransport.js";
import { createEdgeApp } from "./server.js";
import { VaultClient } from "./vaultClient.js";

describe("Encrypted Snapshot Migration (Railway -> Homelab LAN, Fase 6)", () => {
  const sharedMasterKey = "chave-mestra-migracao-homelab-2026-segura";
  let sourceTransport: SqliteLocalOpaqueTransport;
  let targetTransport: SqliteLocalOpaqueTransport;
  let sourceClient: VaultClient;
  let targetClient: VaultClient;

  beforeEach(async () => {
    sourceTransport = new SqliteLocalOpaqueTransport(":memory:");
    targetTransport = new SqliteLocalOpaqueTransport(":memory:");

    sourceClient = new VaultClient(new CryptoVault(sharedMasterKey), sourceTransport);
    targetClient = new VaultClient(new CryptoVault(sharedMasterKey), targetTransport);

    await sourceClient.init();
    await targetClient.init();
  });

  afterEach(async () => {
    await sourceClient.close();
    await targetClient.close();
  });

  it("exports an opaque snapshot from source and restores 100% of entities on homelab target", async () => {
    const sourceApp = createEdgeApp({ vaultClient: sourceClient });
    const targetApp = createEdgeApp({ vaultClient: targetClient });

    // Populate source instance (simulating Railway production)
    await injectExpress(sourceApp, {
      method: "PUT",
      url: "/api/labels",
      body: {
        rawPattern: "SUPERMERCADO VERDEMAR",
        friendlyName: "Verdemar",
        category: "Mercado",
        defaultScope: "couple",
        mySharePct: 50,
      },
    });
    await injectExpress(sourceApp, {
      method: "POST",
      url: "/api/couple-plans",
      body: { text: "Montar servidor local na rede de casa" },
    });
    await injectExpress(sourceApp, {
      method: "POST",
      url: "/api/planner/purchases",
      body: {
        title: "Mini PC N100 Homelab",
        estimatedPrice: 1450,
        defaultInstallments: 6,
        scope: "individual",
        urgency: 4,
        desireImpact: 5,
      },
    });
    await injectExpress(sourceApp, {
      method: "POST",
      url: "/api/closings/2026-11/close",
      body: {
        status: "closed",
        coupleSavedThisMonth: 2200,
        transactions: [],
      },
    });

    // Export opaque snapshot
    const exportRes = await injectExpress<{ count: number; records: unknown[] }>(sourceApp, {
      url: "/api/privacy/snapshot",
    });
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.count).toBe(4);

    // Ensure snapshot file itself contains ZERO plaintext
    const snapshotJson = JSON.stringify(exportRes.body);
    expect(snapshotJson).not.toContain("Verdemar");
    expect(snapshotJson).not.toContain("Mini PC");
    expect(snapshotJson).not.toContain("2200");

    // Restore onto fresh homelab target
    const importRes = await injectExpress<{ imported: number }>(targetApp, {
      method: "POST",
      url: "/api/privacy/snapshot",
      body: { records: exportRes.body.records },
    });
    expect(importRes.status).toBe(200);
    expect(importRes.body.imported).toBe(4);

    // Verify all entities are readable on homelab target
    const [labels, plans, purchases, closings] = await Promise.all([
      injectExpress<{ rules: LabelRule[] }>(targetApp, { url: "/api/labels" }),
      injectExpress<{ plans: CouplePlanNote[] }>(targetApp, { url: "/api/couple-plans" }),
      injectExpress<{ purchases: PlannedPurchase[] }>(targetApp, { url: "/api/planner/purchases" }),
      injectExpress<{ closings: MonthlyClosing[] }>(targetApp, { url: "/api/closings" }),
    ]);

    expect(labels.body.rules[0].friendlyName).toBe("Verdemar");
    expect(plans.body.plans[0].text).toContain("servidor local");
    expect(purchases.body.purchases[0].title).toBe("Mini PC N100 Homelab");
    expect(closings.body.closings[0].coupleSavedThisMonth).toBe(2200);
  });
});
