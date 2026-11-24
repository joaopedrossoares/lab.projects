import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CryptoVault } from "@financas/shared/crypto";
import type { SafetyIndicators } from "@financas/shared";
import { injectExpress } from "../../../shared/src/test/httpHelper.js";
import { SqliteLocalOpaqueTransport } from "../opaqueTransport.js";
import { createEdgeApp } from "../server.js";
import { VaultClient } from "../vaultClient.js";

describe("Cashflow & Financial Safety API (Fase 4)", () => {
  let transport: SqliteLocalOpaqueTransport;
  let client: VaultClient;

  beforeEach(async () => {
    transport = new SqliteLocalOpaqueTransport(":memory:");
    const vault = new CryptoVault("chave-mestra-teste-safety-fase-4-2026");
    client = new VaultClient(vault, transport);
    await client.init();
  });

  afterEach(async () => {
    await client.close();
  });

  it("persists cashflow, reserves, profile, computes 4 safety indicators, and keeps raw DB zero-knowledge", async () => {
    const app = createEdgeApp({ vaultClient: client });

    await injectExpress(app, {
      method: "POST",
      url: "/api/safety/cashflow",
      body: {
        direction: "income",
        title: "Salário Mensal CLT",
        expectedAmount: 9000,
      },
    });

    await injectExpress(app, {
      method: "POST",
      url: "/api/safety/cashflow",
      body: {
        direction: "expense",
        title: "Aluguel Apartamento Casal",
        expectedAmount: 3600,
        scope: "couple",
        paidBy: "me",
        mySharePct: 50,
      },
    });

    await injectExpress(app, {
      method: "PUT",
      url: "/api/safety/reserve",
      body: {
        liquidEmergencyReserve: 18000,
        coupleAccumulatedSavings: 12000,
        otherInvestments: 5000,
      },
    });

    await injectExpress(app, {
      method: "PUT",
      url: "/api/safety/profile",
      body: {
        targetRunwayMonths: 6,
        maxCommitmentPct: 55,
        targetSavingsRatePct: 20,
      },
    });

    const overviewRes = await injectExpress<{ indicators: SafetyIndicators }>(app, {
      url: "/api/safety/overview",
    });

    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.indicators).toMatchObject({
      monthlyEssentialCost: 1800,
      runwayMonths: 10,
      incomeCommitmentPct: 20,
      safeFreeMargin: 5400, // 9000 - 1800 - 1800 (20% target savings)
    });

    // Simulation endpoint
    const simRes = await injectExpress<{ simulation: { verdict: string; myTotalCost: number } }>(
      app,
      {
        method: "POST",
        url: "/api/safety/simulate",
        body: { title: "Cadeira Ergonômica", price: 2400, installments: 1, scope: "individual" },
      }
    );
    expect(simRes.status).toBe(200);
    expect(simRes.body.simulation.verdict).toBe("buy_now");

    // Zero-Knowledge guarantee on raw SQLite
    const rawDump = JSON.stringify(transport.inspectRawRows());
    expect(rawDump).not.toContain("Salário");
    expect(rawDump).not.toContain("Aluguel");
    expect(rawDump).not.toContain("9000");
    expect(rawDump).not.toContain("18000");
  });
});
