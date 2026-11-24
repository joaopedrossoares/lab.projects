import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CryptoVault } from "@financas/shared/crypto";
import { injectExpress } from "../../shared/src/test/httpHelper.js";
import { SqliteOpaqueRepository } from "./db/sqliteRepository.js";
import { createBackendApp } from "./server.js";

describe("Opaque Backend API (Auth + CRUD + Snapshot)", () => {
  let repo: SqliteOpaqueRepository;
  const token = "sync-token-super-seguro-123";
  const vault = new CryptoVault("chave-mestra-para-teste-backend-2026");

  beforeEach(async () => {
    repo = new SqliteOpaqueRepository(":memory:");
    await repo.init();
  });

  afterEach(async () => {
    await repo.close();
  });

  it("rejects unauthenticated requests with 401 when SYNC_API_TOKEN is set", async () => {
    const app = createBackendApp({ repository: repo, syncApiToken: token });

    const health = await injectExpress<{ status: string }>(app, { url: "/health" });
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");

    const noAuth = await injectExpress(app, { url: "/api/v1/records" });
    expect(noAuth.status).toBe(401);

    const wrongAuth = await injectExpress(app, {
      url: "/api/v1/records",
      headers: { Authorization: "Bearer errado" },
    });
    expect(wrongAuth.status).toBe(401);

    const okAuth = await injectExpress<{ records: unknown[] }>(app, {
      url: "/api/v1/records",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(okAuth.status).toBe(200);
    expect(okAuth.body.records).toEqual([]);
  });

  it("stores only v1 encrypted envelopes, filters by blindIndex, and supports snapshot export/import", async () => {
    const app = createBackendApp({ repository: repo, syncApiToken: token });
    const authHeader = { Authorization: `Bearer ${token}` };

    // Rejects non-encrypted plaintext payload
    const bad = await injectExpress(app, {
      method: "PUT",
      url: "/api/v1/records/rec-bad",
      headers: authHeader,
      body: {
        entityType: "label_rule",
        encryptedPayload: '{"friendlyName":"Plaintext vazado"}',
      },
    });
    expect(bad.status).toBe(400);

    const encryptedPayload = vault.encryptJson({
      friendlyName: "Padaria do Bairro",
      category: "Alimentação",
      amount: 42.5,
    });
    const blindIndex = vault.blindIndex("merchant", "padaria do bairro");

    const put = await injectExpress(app, {
      method: "PUT",
      url: "/api/v1/records/rule-1",
      headers: authHeader,
      body: {
        entityType: "label_rule",
        periodKey: null,
        blindIndex,
        encryptedPayload,
      },
    });
    expect(put.status).toBe(200);

    const found = await injectExpress<{ records: Array<{ id: string; encryptedPayload: string }> }>(
      app,
      {
        url: `/api/v1/records?entityType=label_rule&blindIndex=${blindIndex}`,
        headers: authHeader,
      }
    );
    expect(found.status).toBe(200);
    expect(found.body.records).toHaveLength(1);
    expect(found.body.records[0].id).toBe("rule-1");

    // Snapshot roundtrip into a fresh repository
    const snap = await injectExpress<{ records: unknown[] }>(app, {
      url: "/api/v1/snapshot",
      headers: authHeader,
    });
    expect(snap.status).toBe(200);
    expect(snap.body.records).toHaveLength(1);

    const repo2 = new SqliteOpaqueRepository(":memory:");
    await repo2.init();
    const app2 = createBackendApp({ repository: repo2, syncApiToken: token });

    const imp = await injectExpress<{ imported: number }>(app2, {
      method: "POST",
      url: "/api/v1/snapshot",
      headers: authHeader,
      body: { records: snap.body.records },
    });
    expect(imp.status).toBe(200);
    expect(imp.body.imported).toBe(1);

    await repo2.close();
  });
});
