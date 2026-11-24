import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CryptoVault } from "@financas/shared/crypto";
import { injectExpress } from "../../shared/src/test/httpHelper.js";
import { SqliteLocalOpaqueTransport } from "./opaqueTransport.js";
import { createEdgeApp } from "./server.js";
import { VaultClient } from "./vaultClient.js";

describe("Zero-Knowledge VaultClient & Privacy Audit", () => {
  let transport: SqliteLocalOpaqueTransport;
  let client: VaultClient;

  beforeEach(async () => {
    transport = new SqliteLocalOpaqueTransport(":memory:");
    const vault = new CryptoVault("chave-local-super-secreta-zero-knowledge-2026");
    client = new VaultClient(vault, transport);
    await client.init();
  });

  afterEach(async () => {
    await client.close();
  });

  it("ensures ZERO sensitive text or amounts exist in raw storage rows", async () => {
    await client.saveEntity(
      "tx",
      "tx-1",
      {
        id: "tx-1",
        rawDescription: "SUPERMERCADO CARREFOUR EXPRESS",
        friendlyName: "Mercado do Mês",
        category: "Alimentação",
        amount: 1489.75,
        scope: "couple",
      },
      {
        periodKey: "2026-11",
        blindKey: { namespace: "merchant", value: "supermercado carrefour express" },
      }
    );

    await client.saveEntity("couple_plan", "plan-1", {
      id: "plan-1",
      text: "Viagem Japão Casal em 2027 com reserva de 25000",
      status: "active",
    });

    // Inspect raw SQLite rows directly to prove zero-knowledge opacity
    const rawRows = transport.inspectRawRows();
    expect(rawRows).toHaveLength(2);

    const serializedDb = JSON.stringify(rawRows);
    const forbiddenPlaintexts = [
      "CARREFOUR",
      "carrefour",
      "Mercado",
      "Alimentação",
      "1489.75",
      "Japão",
      "25000",
      "Viagem",
    ];

    for (const secret of forbiddenPlaintexts) {
      expect(serializedDb).not.toContain(secret);
    }

    // Locally, VaultClient re-hydrates everything accurately
    const txs = await client.listEntities<{ friendlyName: string; amount: number }>("tx", {
      periodKey: "2026-11",
    });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      friendlyName: "Mercado do Mês",
      amount: 1489.75,
    });
  });

  it("exposes Privacy Status, Audit Comparison, and Roundtrip verification over HTTP", async () => {
    const app = createEdgeApp({ vaultClient: client, keySource: "env" });

    const statusRes = await injectExpress<{ mode: string; keyFingerprint: string }>(app, {
      url: "/api/privacy/status",
    });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.mode).toBe("local-sqlite");
    expect(statusRes.body.keyFingerprint).toHaveLength(12);

    const roundtripRes = await injectExpress<{ ok: boolean; verifiedZeroKnowledge: boolean }>(app, {
      method: "POST",
      url: "/api/privacy/test-roundtrip",
    });
    expect(roundtripRes.status).toBe(200);
    expect(roundtripRes.body.ok).toBe(true);
    expect(roundtripRes.body.verifiedZeroKnowledge).toBe(true);
  });
});
