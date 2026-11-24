import crypto from "node:crypto";
import { Router } from "express";
import type {
  CouplePlanNote,
  FutureInstallment,
  MonthlyClosing,
  Transaction,
} from "@financas/shared";
import { calculateCoupleSettlement } from "../financeEngine.js";
import type { VaultClient } from "../vaultClient.js";

const MONTH_REGEX = /^\d{4}-\d{2}$/;

function closingRecordId(month: string): string {
  return `closing-${month}`;
}

export function createClosingsRouter(vaultClient: VaultClient): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const closings = await vaultClient.listEntities<MonthlyClosing>("closing");
      closings.sort((a, b) => b.month.localeCompare(a.month));
      res.json({ closings });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao listar histórico de fechamentos.",
      });
    }
  });

  router.get("/:month", async (req, res) => {
    const { month } = req.params;
    if (!MONTH_REGEX.test(month)) {
      res.status(400).json({ error: "Competência inválida. Use o formato YYYY-MM." });
      return;
    }

    try {
      const [closing, transactions, futureInstallments, couplePlans] = await Promise.all([
        vaultClient.getEntity<MonthlyClosing>(closingRecordId(month)),
        vaultClient.listEntities<Transaction>("tx", { periodKey: month }),
        vaultClient.listEntities<FutureInstallment>("future_installment", { periodKey: month }),
        vaultClient.listEntities<CouplePlanNote>("couple_plan"),
      ]);

      transactions.sort((a, b) => a.date.localeCompare(b.date));
      const settlement = calculateCoupleSettlement(transactions);

      res.json({
        month,
        closing,
        transactions,
        futureInstallments,
        couplePlans: couplePlans.filter((p) => !p.id.startsWith("audit-test-")),
        settlement,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao carregar competência mensal.",
      });
    }
  });

  router.put("/:month/transactions", async (req, res) => {
    const { month } = req.params;
    if (!MONTH_REGEX.test(month)) {
      res.status(400).json({ error: "Competência inválida. Use o formato YYYY-MM." });
      return;
    }

    const incomingTxs = Array.isArray(req.body?.transactions)
      ? (req.body.transactions as Transaction[])
      : null;
    const incomingFutures = Array.isArray(req.body?.futureInstallments)
      ? (req.body.futureInstallments as FutureInstallment[])
      : undefined;

    if (!incomingTxs) {
      res.status(400).json({ error: "Esperado array 'transactions'." });
      return;
    }

    try {
      // Soft-delete removed transactions from this month so edits stay clean
      const existingTxs = await vaultClient.listEntities<Transaction>("tx", { periodKey: month });
      const nextIds = new Set(incomingTxs.map((t) => t.id));
      for (const old of existingTxs) {
        if (!nextIds.has(old.id)) {
          await vaultClient.deleteEntity(old.id);
        }
      }

      if (incomingTxs.length > 0) {
        await vaultClient.saveManyEntities(
          incomingTxs.map((tx) => ({
            entityType: "tx" as const,
            id: tx.id,
            data: { ...tx, month },
            meta: {
              periodKey: month,
              blindKey: { namespace: "merchant", value: tx.normalizedMerchant || tx.rawDescription },
            },
          }))
        );
      }

      if (incomingFutures !== undefined) {
        const existingFutures = await vaultClient.listEntities<FutureInstallment>(
          "future_installment",
          { periodKey: month }
        );
        const nextFutureIds = new Set(incomingFutures.map((f) => `${month}-${f.id}`));
        for (const old of existingFutures) {
          if (!nextFutureIds.has(old.id)) {
            await vaultClient.deleteEntity(old.id);
          }
        }
        if (incomingFutures.length > 0) {
          await vaultClient.saveManyEntities(
            incomingFutures.map((item) => {
              const scopedId = item.id.startsWith(`${month}-`) ? item.id : `${month}-${item.id}`;
              return {
                entityType: "future_installment" as const,
                id: scopedId,
                data: { ...item, id: scopedId },
                meta: { periodKey: month },
              };
            })
          );
        }
      }

      const settlement = calculateCoupleSettlement(incomingTxs);
      res.json({ saved: incomingTxs.length, settlement });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao salvar transações do mês.",
      });
    }
  });

  router.post("/:month/close", async (req, res) => {
    const { month } = req.params;
    if (!MONTH_REGEX.test(month)) {
      res.status(400).json({ error: "Competência inválida. Use o formato YYYY-MM." });
      return;
    }

    const body = (req.body || {}) as {
      status?: "draft" | "closed";
      totalIncome?: number;
      coupleSavedThisMonth?: number;
      coupleCheckinNotes?: string;
      transactions?: Transaction[];
      futureInstallments?: FutureInstallment[];
    };

    try {
      let transactions: Transaction[];
      if (Array.isArray(body.transactions)) {
        // Persist latest transactions together with the closing
        const existingTxs = await vaultClient.listEntities<Transaction>("tx", { periodKey: month });
        const nextIds = new Set(body.transactions.map((t) => t.id));
        for (const old of existingTxs) {
          if (!nextIds.has(old.id)) {
            await vaultClient.deleteEntity(old.id);
          }
        }
        if (body.transactions.length > 0) {
          await vaultClient.saveManyEntities(
            body.transactions.map((tx) => ({
              entityType: "tx" as const,
              id: tx.id,
              data: { ...tx, month },
              meta: {
                periodKey: month,
                blindKey: {
                  namespace: "merchant",
                  value: tx.normalizedMerchant || tx.rawDescription,
                },
              },
            }))
          );
        }
        transactions = body.transactions;
      } else {
        transactions = await vaultClient.listEntities<Transaction>("tx", { periodKey: month });
      }

      if (Array.isArray(body.futureInstallments) && body.futureInstallments.length > 0) {
        await vaultClient.saveManyEntities(
          body.futureInstallments.map((item) => {
            const scopedId = item.id.startsWith(`${month}-`) ? item.id : `${month}-${item.id}`;
            return {
              entityType: "future_installment" as const,
              id: scopedId,
              data: { ...item, id: scopedId },
              meta: { periodKey: month },
            };
          })
        );
      }

      const settlement = calculateCoupleSettlement(transactions);
      const existing = await vaultClient.getEntity<MonthlyClosing>(closingRecordId(month));
      const now = new Date().toISOString();
      const status = body.status === "draft" ? "draft" : "closed";

      const closing: MonthlyClosing = {
        id: closingRecordId(month),
        month,
        status,
        totalIncome:
          typeof body.totalIncome === "number" && Number.isFinite(body.totalIncome)
            ? body.totalIncome
            : existing?.totalIncome ?? 0,
        totalMyExpenses: settlement.totalMyExpenses,
        totalCoupleExpenses: settlement.totalCouple,
        netSettlementAmount: settlement.netSettlementAmount,
        coupleSavedThisMonth:
          typeof body.coupleSavedThisMonth === "number" &&
          Number.isFinite(body.coupleSavedThisMonth)
            ? body.coupleSavedThisMonth
            : existing?.coupleSavedThisMonth ?? 0,
        coupleCheckinNotes:
          typeof body.coupleCheckinNotes === "string"
            ? body.coupleCheckinNotes.trim()
            : existing?.coupleCheckinNotes ?? "",
        safetySnapshot: existing?.safetySnapshot,
        closedAt: status === "closed" ? now : existing?.closedAt,
        updatedAt: now,
      };

      await vaultClient.saveEntity("closing", closing.id, closing, { periodKey: month });
      res.json({ closing, settlement });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao fechar competência mensal.",
      });
    }
  });

  return router;
}

export function createCouplePlansRouter(vaultClient: VaultClient): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const plans = await vaultClient.listEntities<CouplePlanNote>("couple_plan");
      res.json({ plans: plans.filter((p) => !p.id.startsWith("audit-test-")) });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao listar planos do casal.",
      });
    }
  });

  router.post("/", async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "Texto do plano do casal é obrigatório." });
      return;
    }

    const plan: CouplePlanNote = {
      id: `plan-${crypto.randomUUID()}`,
      text,
      status: "active",
      updatedAt: new Date().toISOString(),
    };

    try {
      await vaultClient.saveEntity("couple_plan", plan.id, plan);
      res.json({ plan });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao salvar plano do casal.",
      });
    }
  });

  router.put("/:id", async (req, res) => {
    const existing = await vaultClient.getEntity<CouplePlanNote>(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Plano não encontrado." });
      return;
    }

    const updated: CouplePlanNote = {
      ...existing,
      text: typeof req.body?.text === "string" && req.body.text.trim() ? req.body.text.trim() : existing.text,
      status: req.body?.status === "done" ? "done" : "active",
      updatedAt: new Date().toISOString(),
    };

    await vaultClient.saveEntity("couple_plan", updated.id, updated);
    res.json({ plan: updated });
  });

  router.delete("/:id", async (req, res) => {
    const deleted = await vaultClient.deleteEntity(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Plano não encontrado." });
      return;
    }
    res.json({ deleted: true });
  });

  return router;
}
