import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CryptoVault } from "@financas/shared/crypto";
import type { LabelRule } from "@financas/shared";
import { injectExpress } from "../../../shared/src/test/httpHelper.js";
import { SqliteLocalOpaqueTransport } from "../opaqueTransport.js";
import { createEdgeApp } from "../server.js";
import { VaultClient } from "../vaultClient.js";

describe("Labels Memory API (Fase 2)", () => {
  let transport: SqliteLocalOpaqueTransport;
  let client: VaultClient;

  beforeEach(async () => {
    transport = new SqliteLocalOpaqueTransport(":memory:");
    const vault = new CryptoVault("chave-mestra-teste-labels-fase-2-2026");
    client = new VaultClient(vault, transport);
    await client.init();
  });

  afterEach(async () => {
    await client.close();
  });

  it("saves normalized label rules, auto-matches future bills, and leaks zero plaintext", async () => {
    const app = createEdgeApp({ vaultClient: client });

    const createRes = await injectExpress<{ rule: LabelRule }>(app, {
      method: "PUT",
      url: "/api/labels",
      body: {
        rawPattern: "MP *PADARIA CENTRAL 02/10",
        friendlyName: "Padaria Central",
        category: "Alimentação",
        defaultScope: "couple",
        mySharePct: 60,
      },
    });

    expect(createRes.status).toBe(200);
    expect(createRes.body.rule).toMatchObject({
      normalizedPattern: "padaria central",
      friendlyName: "Padaria Central",
      category: "Alimentação",
      defaultScope: "couple",
      mySharePct: 60,
    });

    // Updating the same merchant upserts instead of duplicating
    const updateRes = await injectExpress<{ rule: LabelRule }>(app, {
      method: "PUT",
      url: "/api/labels",
      body: {
        rawPattern: "PADARIA CENTRAL 03/10",
        friendlyName: "Padaria do Bairro",
        category: "Alimentação",
        defaultScope: "couple",
        mySharePct: 50,
      },
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.rule.id).toBe(createRes.body.rule.id);

    // Apply rules to a newly imported bill
    const applyRes = await injectExpress<{
      transactions: Array<{
        friendlyName: string;
        category: string;
        scope: string;
        mySharePct: number;
        matchedRuleId?: string;
      }>;
    }>(app, {
      method: "POST",
      url: "/api/labels/apply",
      body: {
        transactions: [
          {
            id: "001",
            date: "12/11",
            description: "MP *PADARIA CENTRAL 04/10",
            normalizedMerchant: "padaria central",
            category: "",
            amount: 42.5,
            section: "national",
          },
          {
            id: "002",
            date: "13/11",
            description: "LOJA DESCONHECIDA",
            normalizedMerchant: "loja desconhecida",
            category: "",
            amount: 99,
            section: "national",
          },
        ],
      },
    });

    expect(applyRes.status).toBe(200);
    expect(applyRes.body.transactions[0]).toMatchObject({
      friendlyName: "Padaria do Bairro",
      category: "Alimentação",
      scope: "couple",
      mySharePct: 50,
      matchedRuleId: createRes.body.rule.id,
    });
    expect(applyRes.body.transactions[1].matchedRuleId).toBeUndefined();

    // Zero-knowledge assertion on raw storage
    const rawDump = JSON.stringify(transport.inspectRawRows());
    expect(rawDump).not.toContain("Padaria");
    expect(rawDump).not.toContain("Alimentação");
    expect(rawDump).not.toContain("padaria central");

    // Delete rule
    const delRes = await injectExpress<{ deleted: boolean }>(app, {
      method: "DELETE",
      url: `/api/labels/${createRes.body.rule.id}`,
    });
    expect(delRes.status).toBe(200);
    expect(delRes.body.deleted).toBe(true);
  });

  it("inherits couple/individual classification from previous month installment (01/10 -> 02/10) even over generic store rules", async () => {
    const app = createEdgeApp({ vaultClient: client });

    // Generic store rule says Amazon is Individual
    await injectExpress(app, {
      method: "PUT",
      url: "/api/labels",
      body: {
        rawPattern: "AMAZON MARKETPLACE",
        friendlyName: "Amazon",
        category: "Compras",
        defaultScope: "individual",
        mySharePct: 100,
      },
    });

    // Previous month (2026-10) had TWO installment purchases at Amazon:
    // 1) Sofa 01/10 (R$ 250.00) marked as COUPLE (60% mine)
    // 2) Headset 01/10 (R$ 89.90) marked as INDIVIDUAL
    await injectExpress(app, {
      method: "POST",
      url: "/api/closings/2026-10/close",
      body: {
        status: "closed",
        transactions: [
          {
            id: "oct-sofa",
            month: "2026-10",
            source: "pdf_itau",
            paidBy: "me",
            date: "10/10",
            rawDescription: "AMAZON MARKETPLACE 01/10",
            normalizedMerchant: "amazon marketplace",
            friendlyName: "Sofá da Sala",
            category: "Casa & Contas",
            amount: 250,
            scope: "couple",
            mySharePct: 60,
            installment: "01/10",
          },
          {
            id: "oct-headset",
            month: "2026-10",
            source: "pdf_itau",
            paidBy: "me",
            date: "12/10",
            rawDescription: "AMAZON MARKETPLACE 01/10",
            normalizedMerchant: "amazon marketplace",
            friendlyName: "Headset Escritório",
            category: "Compras",
            amount: 89.9,
            scope: "individual",
            mySharePct: 100,
            installment: "01/10",
          },
        ],
      },
    });

    // Next month (2026-11): 02/10 arrives for both purchases + a new one-off Amazon purchase
    const applyRes = await injectExpress<{
      transactions: Array<{
        id: string;
        friendlyName: string;
        category: string;
        scope: string;
        mySharePct: number;
        matchSource?: string;
        matchedFromInstallment?: string;
      }>;
    }>(app, {
      method: "POST",
      url: "/api/labels/apply",
      body: {
        month: "2026-11",
        transactions: [
          {
            id: "nov-1",
            date: "10/10",
            description: "AMAZON MARKETPLACE 02/10",
            normalizedMerchant: "amazon marketplace",
            category: "",
            amount: 250,
            section: "national",
            installment: "02/10",
          },
          {
            id: "nov-2",
            date: "12/10",
            description: "AMAZON MARKETPLACE 02/10",
            normalizedMerchant: "amazon marketplace",
            category: "",
            amount: 89.9,
            section: "national",
            installment: "02/10",
          },
          {
            id: "nov-3",
            date: "18/11",
            description: "AMAZON MARKETPLACE",
            normalizedMerchant: "amazon marketplace",
            category: "",
            amount: 45,
            section: "national",
          },
        ],
      },
    });

    expect(applyRes.status).toBe(200);

    // Sofa 02/10 inherited couple + 60% + friendlyName from 01/10!
    expect(applyRes.body.transactions[0]).toMatchObject({
      friendlyName: "Sofá da Sala",
      category: "Casa & Contas",
      scope: "couple",
      mySharePct: 60,
      matchSource: "installment_history",
      matchedFromInstallment: "01/10",
    });

    // Headset 02/10 inherited individual from its own 01/10 (matched by amount)
    expect(applyRes.body.transactions[1]).toMatchObject({
      friendlyName: "Headset Escritório",
      scope: "individual",
      matchSource: "installment_history",
      matchedFromInstallment: "01/10",
    });

    // New one-off Amazon purchase still uses generic label_rule (Individual)
    expect(applyRes.body.transactions[2]).toMatchObject({
      friendlyName: "Amazon",
      scope: "individual",
      matchSource: "label_rule",
    });
  });
});
