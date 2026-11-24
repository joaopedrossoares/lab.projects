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
});
