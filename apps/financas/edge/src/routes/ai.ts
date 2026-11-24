import { Router } from "express";
import type { AIProviderConfig, PlannedPurchase, PurchaseAIAssessment } from "@financas/shared";
import {
  createAIProvider,
  parseJsonFromAIResponse,
  type AIProvider,
} from "../ai/provider.js";
import { buildInternalFinancialContext } from "../ai/tools.js";
import type { LocalConfigStore } from "../localConfigStore.js";
import type { VaultClient } from "../vaultClient.js";

export interface AIRouterOptions {
  vaultClient: VaultClient;
  localConfigStore: LocalConfigStore;
  providerFactory?: (config: AIProviderConfig) => AIProvider;
}

export function createAIRouter(options: AIRouterOptions): Router {
  const { vaultClient, localConfigStore, providerFactory = createAIProvider } = options;
  const router = Router();

  function getProvider(): AIProvider {
    const resolved = localConfigStore.getResolvedConfig();
    return providerFactory(resolved);
  }

  router.get("/config", (_req, res) => {
    res.json({ config: localConfigStore.getSafeConfig() });
  });

  router.put("/config", (req, res) => {
    const body = req.body as Partial<AIProviderConfig> & { clearApiKey?: boolean };
    const safe = localConfigStore.saveConfig(body);
    res.json({ config: safe });
  });

  router.post("/test", async (_req, res) => {
    try {
      const provider = getProvider();
      const result = await provider.testConnection();
      res.json(result);
    } catch (err) {
      res.status(400).json({
        ok: false,
        message: err instanceof Error ? err.message : "Configuração de IA incompleta.",
      });
    }
  });

  router.post("/suggest-labels", async (req, res) => {
    const items = Array.isArray(req.body?.items)
      ? (req.body.items as Array<{ id: string; description: string; amount: number }>)
      : null;

    if (!items || items.length === 0) {
      res.status(400).json({ error: "Envie ao menos 1 compra desconhecida para sugestão." });
      return;
    }

    try {
      const provider = getProvider();
      const systemInstruction = `Você organiza faturas de cartão brasileiras para um casal que mora junto.
Para cada item, devolva APENAS um JSON válido (array de objetos) com os campos:
- id (mesmo id recebido)
- friendlyName (nome curto e legível do estabelecimento, sem códigos MP*/PG*/parcela)
- category (uma entre: Alimentação, Mercado, Casa & Contas, Transporte, Saúde, Lazer, Assinaturas, Compras, Viagem, Educação, Outros)
- defaultScope ("couple" se costuma ser gasto de casa/mercado/restaurante do casal, senão "individual")`;

      const prompt = JSON.stringify(items.slice(0, 30));
      const response = await provider.generateText({
        systemInstruction,
        prompt,
        expectJson: true,
      });

      const suggestions = parseJsonFromAIResponse<
        Array<{
          id: string;
          friendlyName: string;
          category: string;
          defaultScope: "individual" | "couple";
        }>
      >(response.text);

      res.json({ suggestions, provider: response.provider, model: response.model });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao gerar sugestões de labels com IA.",
      });
    }
  });

  router.post("/prioritize", async (_req, res) => {
    try {
      const context = await buildInternalFinancialContext(vaultClient);
      if (context.wishlistWithSimulations.length === 0) {
        res.status(400).json({ error: "Cadastre ao menos 1 compra desejada antes de priorizar." });
        return;
      }

      const provider = getProvider();
      const systemInstruction = `Você é um assistente pessoal de planejamento financeiro objetivo e cauteloso.
Considere SEMPRE:
1. Os 4 indicadores de segurança financeira já calculados (não invente matemática diferente das simulações fornecidas).
2. Os planos ativos do casal (compromissos do casal têm alta prioridade antes de desejos individuais).
3. Os interesses pessoais do usuário e a urgência/impacto de cada item.

Responda APENAS um JSON válido com o formato:
{
  "summary": "Resumo executivo em 2-3 frases diretas em português",
  "items": [
    {
      "id": "id da compra",
      "recommendedRank": 1,
      "verdict": "buy_now" | "installments" | "save_first" | "wait",
      "suggestedMonth": "YYYY-MM ou 'Agora'",
      "rationale": "Justificativa curta e concreta citando impacto na margem/reserva/planos do casal"
    }
  ]
}`;

      const response = await provider.generateText({
        systemInstruction,
        prompt: JSON.stringify(context),
        expectJson: true,
      });

      const parsed = parseJsonFromAIResponse<{
        summary: string;
        items: Array<{
          id: string;
          recommendedRank: number;
          verdict: PurchaseAIAssessment["verdict"];
          suggestedMonth?: string;
          rationale: string;
        }>;
      }>(response.text);

      const now = new Date().toISOString();
      const updatedPurchases: PlannedPurchase[] = [];

      for (const entry of context.wishlistWithSimulations) {
        const aiItem = parsed.items.find((i) => i.id === entry.purchase.id);
        if (aiItem) {
          const updated: PlannedPurchase = {
            ...entry.purchase,
            aiAssessment: {
              recommendedRank: Number(aiItem.recommendedRank) || 99,
              verdict: aiItem.verdict || entry.simulation.verdict,
              suggestedMonth: aiItem.suggestedMonth,
              rationale: aiItem.rationale,
              updatedAt: now,
            },
            updatedAt: now,
          };
          await vaultClient.saveEntity("purchase", updated.id, updated);
          updatedPurchases.push(updated);
        } else {
          updatedPurchases.push(entry.purchase);
        }
      }

      updatedPurchases.sort(
        (a, b) =>
          (a.aiAssessment?.recommendedRank ?? 999) - (b.aiAssessment?.recommendedRank ?? 999)
      );

      res.json({
        summary: parsed.summary,
        purchases: updatedPurchases,
        provider: response.provider,
        model: response.model,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao priorizar compras com IA.",
      });
    }
  });

  router.post("/chat", async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const history = Array.isArray(req.body?.history)
      ? (req.body.history as Array<{ role: "user" | "assistant"; text: string }>).slice(-8)
      : [];

    if (!message) {
      res.status(400).json({ error: "Mensagem vazia." });
      return;
    }

    try {
      const context = await buildInternalFinancialContext(vaultClient);
      const provider = getProvider();

      const systemInstruction = `Você é o assistente financeiro pessoal do usuário (mora com a namorada).
Baseie TODAS as respostas exclusivamente nos dados financeiros reais fornecidos abaixo (já calculados pelo motor local).
Nunca invente valores. Seja direto, prático e sempre leve em conta os planos do casal e a segurança financeira (runway, comprometimento e margem segura).
Responda em português do Brasil.`;

      const conversationText = history
        .map((turn) => `${turn.role === "user" ? "Usuário" : "Assistente"}: ${turn.text}`)
        .join("\n");

      const prompt = `CONTEXTO FINANCEIRO ATUAL (TOOLS INTERNAS):
${JSON.stringify(context, null, 2)}

${conversationText ? `HISTÓRICO RECENTE:\n${conversationText}\n\n` : ""}PERGUNTA DO USUÁRIO:
${message}`;

      const response = await provider.generateText({
        systemInstruction,
        prompt,
      });

      res.json({
        reply: response.text,
        provider: response.provider,
        model: response.model,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao consultar assistente de IA.",
      });
    }
  });

  return router;
}
