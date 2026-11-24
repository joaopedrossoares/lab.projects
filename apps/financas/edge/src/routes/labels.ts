import crypto from "node:crypto";
import { Router } from "express";
import {
  normalizeMerchantKey,
  type LabelRule,
  type ParsedTransaction,
  type TransactionScope,
} from "@financas/shared";
import type { VaultClient } from "../vaultClient.js";

export function matchLabelRule(
  normalizedMerchant: string,
  rules: LabelRule[]
): LabelRule | undefined {
  const exact = rules.find((r) => r.normalizedPattern === normalizedMerchant);
  if (exact) return exact;

  // Fallback: longest pattern contained inside the normalized merchant name
  const candidates = rules
    .filter(
      (r) =>
        r.normalizedPattern.length >= 4 &&
        normalizedMerchant.includes(r.normalizedPattern)
    )
    .sort((a, b) => b.normalizedPattern.length - a.normalizedPattern.length);

  return candidates[0];
}

export function createLabelsRouter(vaultClient: VaultClient): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const rules = await vaultClient.listEntities<LabelRule>("label_rule");
      rules.sort((a, b) => a.friendlyName.localeCompare(b.friendlyName, "pt-BR"));
      res.json({ rules });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao listar labels salvos.",
      });
    }
  });

  router.put("/", async (req, res) => {
    const body = req.body as Partial<LabelRule> & { rawPattern?: string };
    const rawPattern = (body.normalizedPattern || body.rawPattern || "").trim();
    const friendlyName = (body.friendlyName || "").trim();

    if (!rawPattern || !friendlyName) {
      res.status(400).json({ error: "Padrão do estabelecimento e nome amigável são obrigatórios." });
      return;
    }

    const normalizedPattern = normalizeMerchantKey(rawPattern);
    const defaultScope: TransactionScope = body.defaultScope === "couple" ? "couple" : "individual";
    const mySharePct =
      typeof body.mySharePct === "number" && Number.isFinite(body.mySharePct)
        ? Math.min(100, Math.max(0, body.mySharePct))
        : 50;

    try {
      // Check if rule already exists for this normalizedPattern via blind index
      const existingByBlind = await vaultClient.listEntities<LabelRule>("label_rule", {
        blindKey: { namespace: "merchant", value: normalizedPattern },
      });

      const id =
        (typeof body.id === "string" && body.id.trim()) ||
        existingByBlind[0]?.id ||
        `lbl-${crypto.randomUUID()}`;

      const rule: LabelRule = {
        id,
        normalizedPattern,
        friendlyName,
        category: (body.category || "").trim() || "Outros",
        defaultScope,
        mySharePct,
        updatedAt: new Date().toISOString(),
      };

      await vaultClient.saveEntity("label_rule", rule.id, rule, {
        blindKey: { namespace: "merchant", value: normalizedPattern },
      });

      res.json({ rule });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao salvar label.",
      });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const deleted = await vaultClient.deleteEntity(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: "Regra não encontrada." });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao excluir label.",
      });
    }
  });

  router.post("/apply", async (req, res) => {
    const transactions = Array.isArray(req.body?.transactions)
      ? (req.body.transactions as ParsedTransaction[])
      : null;

    if (!transactions) {
      res.status(400).json({ error: "Esperado array 'transactions'." });
      return;
    }

    try {
      const rules = await vaultClient.listEntities<LabelRule>("label_rule");
      const enriched = transactions.map((tx) => {
        const normalized = tx.normalizedMerchant || normalizeMerchantKey(tx.description);
        const matched = matchLabelRule(normalized, rules);
        return {
          ...tx,
          normalizedMerchant: normalized,
          friendlyName: matched?.friendlyName ?? tx.description,
          category: matched?.category ?? tx.category ?? "",
          scope: matched?.defaultScope ?? ("individual" as TransactionScope),
          mySharePct: matched?.mySharePct ?? 50,
          matchedRuleId: matched?.id,
        };
      });

      res.json({ transactions: enriched });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao aplicar regras de labels.",
      });
    }
  });

  return router;
}
