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
});
