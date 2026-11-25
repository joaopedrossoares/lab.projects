import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CryptoVault } from "@financas/shared/crypto";
import type { PlannedPurchase } from "@financas/shared";
import { injectExpress } from "../../../shared/src/test/httpHelper.js";
import type { AIGenerateRequest, AIProvider } from "../ai/provider.js";
import { LocalConfigStore } from "../localConfigStore.js";
import { SqliteLocalOpaqueTransport } from "../opaqueTransport.js";
import { createEdgeApp } from "../server.js";
import { VaultClient } from "../vaultClient.js";

describe("AI Local Config, Internal Tools & Purchase Planner (Fase 5)", () => {
  let tmpDir: string;
  let transport: SqliteLocalOpaqueTransport;
  let client: VaultClient;
  let localConfig: LocalConfigStore;
  let lastPromptReceived = "";

  const mockProvider: AIProvider = {
    providerName: "mock-gemini",
    modelName: "gemini-4-hydrogen",
    async generateText(req: AIGenerateRequest) {
      lastPromptReceived = req.prompt;

      if (req.systemInstruction.includes("faturas de cartão")) {
        return {
          provider: "mock-gemini",
          model: "gemini-4-hydrogen",
          usage: { promptTokens: 200, outputTokens: 80, totalTokens: 280 },
          text: JSON.stringify([
            {
              id: "tx-unknown-1",
              friendlyName: "Cafeteria Especial",
              category: "Alimentação",
              defaultScope: "couple",
            },
          ]),
        };
      }

      if (req.systemInstruction.includes("recommendedRank")) {
        const ctx = JSON.parse(req.prompt) as {
          wishlistWithSimulations: Array<{ purchase: PlannedPurchase }>;
        };
        const firstId = ctx.wishlistWithSimulations[0]?.purchase.id;
        return {
          provider: "mock-gemini",
          model: "gemini-4-hydrogen",
          usage: { promptTokens: 600, outputTokens: 200, totalTokens: 800 },
          text: JSON.stringify({
            summary: "Priorize o item que cabe na margem sem afetar a viagem do casal.",
            items: [
              {
                id: firstId,
                recommendedRank: 1,
                verdict: "buy_now",
                suggestedMonth: "Agora",
                rationale: "Cabe na margem segura mantendo runway saudável e respeitando planos do casal.",
              },
            ],
          }),
        };
      }

      return {
        provider: "mock-gemini",
        model: "gemini-4-hydrogen",
        usage: { promptTokens: 400, outputTokens: 120, totalTokens: 520 },
        text: "Com base na sua margem segura e nos planos do casal, vale comprar à vista.",
      };
    },
    async testConnection() {
      return {
        ok: true,
        provider: "mock-gemini",
        model: "gemini-4-hydrogen",
        message: "Mock conectado.",
      };
    },
  };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "financas-ai-test-"));
    transport = new SqliteLocalOpaqueTransport(":memory:");
    const vault = new CryptoVault("chave-mestra-teste-ai-fase-5-2026");
    client = new VaultClient(vault, transport);
    await client.init();
    localConfig = new LocalConfigStore(tmpDir, vault);
    lastPromptReceived = "";
  });

  afterEach(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps AI API keys strictly in encrypted local volume (never in opaque backend)", async () => {
    const app = createEdgeApp({
      vaultClient: client,
      localConfigStore: localConfig,
      aiProviderFactory: () => mockProvider,
    });

    const saveCfg = await injectExpress<{ config: { hasApiKey: boolean; provider: string } }>(app, {
      method: "PUT",
      url: "/api/ai/config",
      body: {
        provider: "gemini",
        model: "gemini-4-hydrogen",
        apiKey: "AIzaSySUPER-SECRET-LOCAL-KEY-9999",
      },
    });
    expect(saveCfg.status).toBe(200);
    expect(saveCfg.body.config.hasApiKey).toBe(true);

    // Raw local file must be encrypted too
    const rawLocalFile = fs.readFileSync(path.join(tmpDir, "ai-config.enc"), "utf8");
    expect(rawLocalFile).not.toContain("AIzaSySUPER-SECRET-LOCAL-KEY-9999");

    // Backend DB must contain ZERO AI config records
    const rawBackendDb = JSON.stringify(transport.inspectRawRows());
    expect(rawBackendDb).not.toContain("AIzaSy");
    expect(transport.inspectRawRows()).toHaveLength(0);
  });

  it("suggests labels, prioritizes wishlist using couple plans + safety indicators, and supports contextual chat", async () => {
    const app = createEdgeApp({
      vaultClient: client,
      localConfigStore: localConfig,
      aiProviderFactory: () => mockProvider,
    });

    // Seed income, reserve, couple plan, and planned purchase
    await injectExpress(app, {
      method: "POST",
      url: "/api/safety/cashflow",
      body: { direction: "income", title: "Salário", expectedAmount: 10000 },
    });
    await injectExpress(app, {
      method: "PUT",
      url: "/api/safety/reserve",
      body: { liquidEmergencyReserve: 30000, coupleAccumulatedSavings: 10000, otherInvestments: 0 },
    });
    await injectExpress(app, {
      method: "POST",
      url: "/api/couple-plans",
      body: { text: "Viagem para o Chile em outubro" },
    });

    const buyRes = await injectExpress<{ purchase: PlannedPurchase }>(app, {
      method: "POST",
      url: "/api/planner/purchases",
      body: {
        title: "Monitor Ultrawide",
        estimatedPrice: 1800,
        defaultInstallments: 6,
        scope: "individual",
        urgency: 4,
        desireImpact: 5,
      },
    });
    expect(buyRes.status).toBe(200);

    // Suggest labels
    const suggestRes = await injectExpress<{ suggestions: Array<{ friendlyName: string }> }>(app, {
      method: "POST",
      url: "/api/ai/suggest-labels",
      body: { items: [{ id: "tx-unknown-1", description: "MP *CAFETERIA ESP", amount: 35 }] },
    });
    expect(suggestRes.status).toBe(200);
    expect(suggestRes.body.suggestions[0].friendlyName).toBe("Cafeteria Especial");

    // Prioritize list
    const prioRes = await injectExpress<{ summary: string; purchases: PlannedPurchase[] }>(app, {
      method: "POST",
      url: "/api/ai/prioritize",
    });
    expect(prioRes.status).toBe(200);
    expect(prioRes.body.purchases[0].aiAssessment?.recommendedRank).toBe(1);
    expect(lastPromptReceived).toContain("Viagem para o Chile");
    expect(lastPromptReceived).toContain("Monitor Ultrawide");

    // Chat
    const chatRes = await injectExpress<{ reply: string }>(app, {
      method: "POST",
      url: "/api/ai/chat",
      body: { message: "Posso comprar o monitor este mês?" },
    });
    expect(chatRes.status).toBe(200);
    expect(chatRes.body.reply).toContain("margem segura");

    // Verify local AI usage telemetry recorded all 3 calls (suggest_labels + prioritize + chat)
    const usageRes = await injectExpress<{
      usage: {
        currentMonth: {
          calls: number;
          totalTokens: number;
          estimatedCostUsd: number;
          byOperation: {
            suggest_labels: { calls: number };
            prioritize: { calls: number };
            chat: { calls: number };
          };
        };
      };
    }>(app, { url: "/api/ai/usage" });

    expect(usageRes.status).toBe(200);
    expect(usageRes.body.usage.currentMonth.calls).toBe(3);
    expect(usageRes.body.usage.currentMonth.totalTokens).toBe(1600);
    expect(usageRes.body.usage.currentMonth.estimatedCostUsd).toBeGreaterThan(0);
    expect(usageRes.body.usage.currentMonth.byOperation.suggest_labels.calls).toBe(1);
    expect(usageRes.body.usage.currentMonth.byOperation.prioritize.calls).toBe(1);
    expect(usageRes.body.usage.currentMonth.byOperation.chat.calls).toBe(1);

    // Clear usage works
    const clearRes = await injectExpress<{ usage: { allTime: { calls: number } } }>(app, {
      method: "DELETE",
      url: "/api/ai/usage",
    });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.usage.allTime.calls).toBe(0);

    // Zero-knowledge assertion: nothing legible in backend DB
    const rawBackend = JSON.stringify(transport.inspectRawRows());
    expect(rawBackend).not.toContain("Monitor Ultrawide");
    expect(rawBackend).not.toContain("Chile");
    expect(rawBackend).not.toContain("gemini-4-hydrogen");
  });
});
