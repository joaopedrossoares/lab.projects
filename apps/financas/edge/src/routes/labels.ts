import crypto from "node:crypto";
import { Router } from "express";
import {
  extractInstallmentTag,
  normalizeMerchantKey,
  type LabelRule,
  type ParsedTransaction,
  type Transaction,
  type TransactionScope,
} from "@financas/shared";
import type { VaultClient } from "../vaultClient.js";

export interface InstallmentPair {
  current: number;
  total: number;
}

export function parseInstallmentPair(tag?: string): InstallmentPair | null {
  if (!tag) return null;
  const match = tag.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total)) return null;
  if (current < 1 || total < 2 || current > total) return null;
  return { current, total };
}

/**
 * Matches an incoming installment purchase (e.g. 02/10) against the most recent
 * prior installment (e.g. 01/10) from previous months with the same normalized
 * merchant, same total installments, and compatible amount (within R$ 0.05).
 */
export function matchPreviousInstallment(
  incoming: {
    normalizedMerchant: string;
    amount: number;
    installment?: string;
  },
  pastTransactions: Transaction[],
  currentMonth?: string
): Transaction | undefined {
  const incomingPair = parseInstallmentPair(incoming.installment);
  if (!incomingPair || incomingPair.current <= 1) return undefined;

  const candidates = pastTransactions
    .map((past) => ({
      past,
      pair: parseInstallmentPair(past.installment || extractInstallmentTag(past.rawDescription)),
    }))
    .filter(({ past, pair }) => {
      if (!pair) return false;
      if (currentMonth && past.month >= currentMonth) return false;
      const pastMerchant = past.normalizedMerchant || normalizeMerchantKey(past.rawDescription);
      if (pastMerchant !== incoming.normalizedMerchant) return false;
      if (pair.total !== incomingPair.total) return false;
      if (pair.current >= incomingPair.current) return false;
      // Disambiguate different installment purchases at the same store (5 cents tolerance for rounding)
      if (Math.abs(past.amount - incoming.amount) > 0.05) return false;
      return true;
    })
    .sort((a, b) => {
      // Prefer the closest preceding installment, then the most recent month
      if (b.pair!.current !== a.pair!.current) {
        return b.pair!.current - a.pair!.current;
      }
      return b.past.month.localeCompare(a.past.month);
    });

  return candidates[0]?.past;
}

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
    const currentMonth =
      typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month)
        ? req.body.month
        : undefined;

    if (!transactions) {
      res.status(400).json({ error: "Esperado array 'transactions'." });
      return;
    }

    try {
      const [rules, pastTransactions] = await Promise.all([
        vaultClient.listEntities<LabelRule>("label_rule"),
        vaultClient.listEntities<Transaction>("tx"),
      ]);

      const enriched = transactions.map((tx) => {
        const normalized = tx.normalizedMerchant || normalizeMerchantKey(tx.description);
        const installment = tx.installment || extractInstallmentTag(tx.description);

        // 1. Prioritize continuing installment classification from previous month(s)
        const prevInstallment = matchPreviousInstallment(
          { normalizedMerchant: normalized, amount: tx.amount, installment },
          pastTransactions,
          currentMonth
        );

        if (prevInstallment) {
          const prevTag =
            prevInstallment.installment || extractInstallmentTag(prevInstallment.rawDescription);
          return {
            ...tx,
            normalizedMerchant: normalized,
            installment,
            friendlyName: prevInstallment.friendlyName || tx.description,
            category: prevInstallment.category || tx.category || "",
            scope: prevInstallment.scope,
            mySharePct: prevInstallment.mySharePct,
            matchedRuleId: prevInstallment.matchedRuleId,
            matchSource: "installment_history" as const,
            matchedFromInstallment: prevTag,
          };
        }

        // 2. Fallback to saved label rule
        const matched = matchLabelRule(normalized, rules);
        return {
          ...tx,
          normalizedMerchant: normalized,
          installment,
          friendlyName: matched?.friendlyName ?? tx.description,
          category: matched?.category ?? tx.category ?? "",
          scope: matched?.defaultScope ?? ("individual" as TransactionScope),
          mySharePct: matched?.mySharePct ?? 50,
          matchedRuleId: matched?.id,
          matchSource: matched ? ("label_rule" as const) : undefined,
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
