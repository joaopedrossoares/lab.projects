import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CryptoVault } from "@financas/shared/crypto";
import type { CouplePlanNote, MonthlyClosing } from "@financas/shared";
import { injectExpress } from "../../../shared/src/test/httpHelper.js";
import { SqliteLocalOpaqueTransport } from "../opaqueTransport.js";
import { createEdgeApp } from "../server.js";
import { VaultClient } from "../vaultClient.js";

describe("Monthly Closings & Couple Plans API (Fase 3)", () => {
  let transport: SqliteLocalOpaqueTransport;
  let client: VaultClient;

  beforeEach(async () => {
    transport = new SqliteLocalOpaqueTransport(":memory:");
    const vault = new CryptoVault("chave-mestra-teste-closings-fase-3-2026");
    client = new VaultClient(vault, transport);
    await client.init();
  });

  afterEach(async () => {
    await client.close();
  });

  it("closes a month with couple settlement, joint savings, free-text plans, and zero plaintext leaks", async () => {
    const app = createEdgeApp({ vaultClient: client });

    // Create free-text couple plan
    const planRes = await injectExpress<{ plan: CouplePlanNote }>(app, {
      method: "POST",
      url: "/api/couple-plans",
      body: { text: "Trocar o sofá da sala e guardar para viagem de fim de ano" },
    });
    expect(planRes.status).toBe(200);

    // Close month 2026-11 with transactions paid by me and partner
    const closeRes = await injectExpress<{ closing: MonthlyClosing }>(app, {
      method: "POST",
      url: "/api/closings/2026-11/close",
      body: {
        status: "closed",
        coupleSavedThisMonth: 1800,
        coupleCheckinNotes: "Mês equilibrado, sem extras grandes.",
        transactions: [
          {
            id: "tx-1",
            month: "2026-11",
            source: "pdf_itau",
            paidBy: "me",
            date: "02/11",
            rawDescription: "SUPERMERCADO EXEMPLO",
            normalizedMerchant: "supermercado exemplo",
            friendlyName: "Supermercado",
            category: "Mercado",
            amount: 1200,
            scope: "couple",
            mySharePct: 50,
          },
          {
            id: "tx-2",
            month: "2026-11",
            source: "manual",
            paidBy: "partner",
            date: "05/11",
            rawDescription: "CONDOMINIO CASA",
            normalizedMerchant: "condominio casa",
            friendlyName: "Condomínio",
            category: "Casa & Contas",
            amount: 600,
            scope: "couple",
            mySharePct: 50,
          },
        ],
      },
    });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.closing).toMatchObject({
      month: "2026-11",
      status: "closed",
      totalCoupleExpenses: 1800,
      netSettlementAmount: 300, // I paid 1200 (+600), she paid 600 (-300) => +300
      coupleSavedThisMonth: 1800,
    });

    // History list returns the closed month
    const listRes = await injectExpress<{ closings: MonthlyClosing[] }>(app, {
      url: "/api/closings",
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body.closings).toHaveLength(1);
    expect(listRes.body.closings[0].month).toBe("2026-11");

    // Reloading the month restores transactions and plans
    const detailRes = await injectExpress<{
      transactions: unknown[];
      couplePlans: CouplePlanNote[];
    }>(app, {
      url: "/api/closings/2026-11",
    });
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.transactions).toHaveLength(2);
    expect(detailRes.body.couplePlans).toHaveLength(1);

    // Zero-Knowledge guarantee: none of the notes, plans, or values appear in raw DB
    const rawDump = JSON.stringify(transport.inspectRawRows());
    expect(rawDump).not.toContain("sofá");
    expect(rawDump).not.toContain("1800");
    expect(rawDump).not.toContain("CONDOMINIO");
  });

  it("auto-preloads recurring fixed expenses (rent, internet) on a fresh month and offers missing ones on existing months", async () => {
    const app = createEdgeApp({ vaultClient: client });

    // Register recurring rent & internet once in cashflow
    await injectExpress(app, {
      method: "POST",
      url: "/api/safety/cashflow",
      body: {
        direction: "expense",
        title: "Aluguel Apartamento",
        expectedAmount: 2800,
        scope: "couple",
        paidBy: "me",
        mySharePct: 50,
      },
    });
    await injectExpress(app, {
      method: "POST",
      url: "/api/safety/cashflow",
      body: {
        direction: "expense",
        title: "Internet Fibra",
        expectedAmount: 140,
        scope: "couple",
        paidBy: "partner",
        mySharePct: 50,
      },
    });

    // Opening a brand-new month (2026-12) preloads both fixed expenses automatically!
    const freshRes = await injectExpress<{
      transactions: Array<{ source: string; friendlyName: string; amount: number }>;
      preloadedFixedCount: number;
      settlement: { netSettlementAmount: number };
    }>(app, {
      url: "/api/closings/2026-12",
    });

    expect(freshRes.status).toBe(200);
    expect(freshRes.body.preloadedFixedCount).toBe(2);
    expect(freshRes.body.transactions).toHaveLength(2);
    expect(freshRes.body.transactions[0].source).toBe("fixed_copy");
    // I paid 2800 (+1400), she paid 140 (-70) => net +1330
    expect(freshRes.body.settlement.netSettlementAmount).toBe(1330);

    // On a month that already has saved transactions without fixed copies, returns missingRecurringExpenses without touching saved data
    await injectExpress(app, {
      method: "POST",
      url: "/api/closings/2026-11/close",
      body: {
        status: "draft",
        transactions: [
          {
            id: "existing-card-tx",
            month: "2026-11",
            source: "pdf_itau",
            paidBy: "me",
            date: "05/11",
            rawDescription: "MERCADO",
            normalizedMerchant: "mercado",
            friendlyName: "Mercado",
            category: "Mercado",
            amount: 300,
            scope: "couple",
            mySharePct: 50,
          },
        ],
      },
    });

    const existingRes = await injectExpress<{
      transactions: Array<{ id: string }>;
      missingRecurringExpenses: Array<{ friendlyName: string }>;
    }>(app, {
      url: "/api/closings/2026-11",
    });

    expect(existingRes.status).toBe(200);
    expect(existingRes.body.transactions).toHaveLength(1);
    expect(existingRes.body.transactions[0].id).toBe("existing-card-tx");
    expect(existingRes.body.missingRecurringExpenses).toHaveLength(2);
  });

  it("includes monthly extra incomes in conference GET and sums them into closing totalIncome without treating them as fixed expenses", async () => {
    const app = createEdgeApp({ vaultClient: client });

    await injectExpress(app, {
      method: "POST",
      url: "/api/safety/cashflow",
      body: { direction: "income", title: "Salário", expectedAmount: 7000 },
    });

    await injectExpress(app, {
      method: "POST",
      url: "/api/safety/extra-incomes",
      body: {
        month: "2026-11",
        title: "PLR Semestral",
        amount: 2500,
        toReserve: 1000,
        toCouple: 500,
        applyToBalances: true,
      },
    });

    const getRes = await injectExpress<{
      transactions: unknown[];
      extraIncomes: Array<{ title: string; amount: number }>;
      extraIncomeTotal: number;
      extraToCoupleTotal: number;
    }>(app, { url: "/api/closings/2026-11" });

    expect(getRes.status).toBe(200);
    expect(getRes.body.transactions).toHaveLength(0);
    expect(getRes.body.extraIncomes).toHaveLength(1);
    expect(getRes.body.extraIncomeTotal).toBe(2500);
    expect(getRes.body.extraToCoupleTotal).toBe(500);

    const closeRes = await injectExpress<{ closing: MonthlyClosing }>(app, {
      method: "POST",
      url: "/api/closings/2026-11/close",
      body: { status: "closed", transactions: [] },
    });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.closing.totalIncome).toBe(9500); // 7000 recurring + 2500 extra
    expect(closeRes.body.closing.extraIncomeTotal).toBe(2500);
    expect(closeRes.body.closing.extraToCoupleTotal).toBe(500);
  });
});
