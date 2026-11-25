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

  it("supports checkingBalance and monthly extra incomes with 3-way allocation, reversible balance updates, and zero-knowledge storage (Fase 7)", async () => {
    const app = createEdgeApp({ vaultClient: client });

    // Recurring income = 8000, expense = 2000
    await injectExpress(app, {
      method: "POST",
      url: "/api/safety/cashflow",
      body: { direction: "income", title: "Salário", expectedAmount: 8000 },
    });
    await injectExpress(app, {
      method: "POST",
      url: "/api/safety/cashflow",
      body: { direction: "expense", title: "Aluguel", expectedAmount: 2000, scope: "individual" },
    });

    // Save initial balances including checkingBalance
    await injectExpress(app, {
      method: "PUT",
      url: "/api/safety/reserve",
      body: {
        checkingBalance: 1000,
        liquidEmergencyReserve: 10000,
        coupleAccumulatedSavings: 4000,
        otherInvestments: 2000,
      },
    });

    // Reject invalid allocation exceeding total amount
    const badRes = await injectExpress(app, {
      method: "POST",
      url: "/api/safety/extra-incomes",
      body: {
        month: "2026-11",
        title: "Bônus inválido",
        amount: 1000,
        toReserve: 700,
        toCouple: 500,
      },
    });
    expect(badRes.status).toBe(400);

    // Add extra income of R$ 3.000 split: 1000 reserve, 500 couple, 1500 checking (auto-applied)
    const addRes = await injectExpress<{
      item: { id: string; allocation: { toReserve: number; toCouple: number; toChecking: number } };
      reserve: {
        checkingBalance: number;
        liquidEmergencyReserve: number;
        coupleAccumulatedSavings: number;
      };
    }>(app, {
      method: "POST",
      url: "/api/safety/extra-incomes",
      body: {
        month: "2026-11",
        title: "13º Salário",
        amount: 3000,
        toReserve: 1000,
        toCouple: 500,
        applyToBalances: true,
      },
    });

    expect(addRes.status).toBe(200);
    expect(addRes.body.item.allocation).toEqual({
      toReserve: 1000,
      toCouple: 500,
      toChecking: 1500,
    });
    expect(addRes.body.reserve).toMatchObject({
      checkingBalance: 2500,
      liquidEmergencyReserve: 11000,
      coupleAccumulatedSavings: 4500,
    });

    // Verify recurring monthlyIncome is NOT inflated by extra income, and Runway uses only liquidEmergencyReserve
    const overviewRes = await injectExpress<{
      breakdown: { monthlyIncome: number };
      indicators: { runwayMonths: number };
      extraIncomes: unknown[];
    }>(app, { url: "/api/safety/overview" });
    expect(overviewRes.body.breakdown.monthlyIncome).toBe(8000);
    expect(overviewRes.body.indicators.runwayMonths).toBe(5.5); // 11000 / 2000 (checking 2500 excluded!)
    expect(overviewRes.body.extraIncomes).toHaveLength(1);

    // Add a historical extra income with applyToBalances = false (should NOT touch ReserveState)
    const histRes = await injectExpress<{
      item: { id: string };
      reserve: { checkingBalance: number; liquidEmergencyReserve: number };
    }>(app, {
      method: "POST",
      url: "/api/safety/extra-incomes",
      body: {
        month: "2026-10",
        title: "Reembolso antigo",
        amount: 400,
        toReserve: 0,
        toCouple: 0,
        applyToBalances: false,
      },
    });
    expect(histRes.status).toBe(200);
    expect(histRes.body.reserve.checkingBalance).toBe(2500);

    // Deleting the applied extra income reverts the exact deltas in ReserveState
    const delRes = await injectExpress<{
      deleted: boolean;
      revertedBalances: boolean;
      reserve: {
        checkingBalance: number;
        liquidEmergencyReserve: number;
        coupleAccumulatedSavings: number;
      };
    }>(app, {
      method: "DELETE",
      url: `/api/safety/extra-incomes/${addRes.body.item.id}`,
    });
    expect(delRes.status).toBe(200);
    expect(delRes.body.revertedBalances).toBe(true);
    expect(delRes.body.reserve).toMatchObject({
      checkingBalance: 1000,
      liquidEmergencyReserve: 10000,
      coupleAccumulatedSavings: 4000,
    });

    // Zero-Knowledge guarantee: no extra income titles or amounts in raw DB
    const rawDump = JSON.stringify(transport.inspectRawRows());
    expect(rawDump).not.toContain("13º Salário");
    expect(rawDump).not.toContain("Reembolso antigo");
  });
});
