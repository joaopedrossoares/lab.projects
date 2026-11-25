import crypto from "node:crypto";
import { Router } from "express";
import {
  isMonthlyExtraIncome,
  type CashflowEntity,
  type FutureInstallment,
  type MonthlyClosing,
  type MonthlyExtraIncome,
  type PaidBy,
  type RecurringCashflow,
  type ReserveState,
  type TransactionScope,
  type UserProfile,
} from "@financas/shared";
import {
  calculateSafetyOverview,
  DEFAULT_RESERVE_STATE,
  DEFAULT_USER_PROFILE,
  simulatePurchaseImpact,
  type SafetyOverviewResult,
} from "../financeEngine.js";
import type { VaultClient } from "../vaultClient.js";

const MONTH_REGEX = /^\d{4}-\d{2}$/;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeReserve(raw?: ReserveState | null): ReserveState {
  if (!raw) return { ...DEFAULT_RESERVE_STATE };
  return {
    ...DEFAULT_RESERVE_STATE,
    ...raw,
    checkingBalance: Math.max(0, Number(raw.checkingBalance) || 0),
    liquidEmergencyReserve: Math.max(0, Number(raw.liquidEmergencyReserve) || 0),
    coupleAccumulatedSavings: Math.max(0, Number(raw.coupleAccumulatedSavings) || 0),
    otherInvestments: Math.max(0, Number(raw.otherInvestments) || 0),
  };
}

export async function loadFullSafetyContext(vaultClient: VaultClient): Promise<{
  recurring: RecurringCashflow[];
  extraIncomes: MonthlyExtraIncome[];
  reserve: ReserveState;
  profile: UserProfile;
  closings: MonthlyClosing[];
  futureInstallments: FutureInstallment[];
  overview: SafetyOverviewResult;
}> {
  const [allCashflow, reserves, profiles, closings, allFutures] = await Promise.all([
    vaultClient.listEntities<CashflowEntity>("cashflow"),
    vaultClient.listEntities<ReserveState>("reserve"),
    vaultClient.listEntities<UserProfile>("profile"),
    vaultClient.listEntities<MonthlyClosing>("closing"),
    vaultClient.listEntities<FutureInstallment>("future_installment"),
  ]);

  const recurring = allCashflow.filter(
    (item): item is RecurringCashflow => !isMonthlyExtraIncome(item)
  );
  const extraIncomes = allCashflow
    .filter(isMonthlyExtraIncome)
    .sort((a, b) => b.month.localeCompare(a.month) || b.updatedAt.localeCompare(a.updatedAt));

  const reserve = normalizeReserve(reserves[0]);
  const profile = profiles[0] ?? DEFAULT_USER_PROFILE;

  // Use future installments from the latest month that recorded them
  const latestMonthPrefix = allFutures
    .map((item) => item.id.slice(0, 7))
    .filter((prefix) => /^\d{4}-\d{2}$/.test(prefix))
    .sort()
    .at(-1);

  const futureInstallments = latestMonthPrefix
    ? allFutures.filter((item) => item.id.startsWith(`${latestMonthPrefix}-`))
    : allFutures;

  const overview = calculateSafetyOverview({
    recurring,
    reserve,
    profile,
    closings,
    futureInstallments,
  });

  return {
    recurring,
    extraIncomes,
    reserve,
    profile,
    closings,
    futureInstallments,
    overview,
  };
}

export function createSafetyRouter(vaultClient: VaultClient): Router {
  const router = Router();

  router.get("/overview", async (_req, res) => {
    try {
      const ctx = await loadFullSafetyContext(vaultClient);
      res.json({
        indicators: ctx.overview.indicators,
        breakdown: ctx.overview.breakdown,
        recurring: ctx.recurring,
        extraIncomes: ctx.extraIncomes,
        reserve: ctx.reserve,
        profile: ctx.profile,
        futureInstallments: ctx.futureInstallments,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao calcular segurança financeira.",
      });
    }
  });

  router.post("/cashflow", async (req, res) => {
    const body = req.body as Partial<RecurringCashflow>;
    const title = (body.title || "").trim();
    const expectedAmount = Number(body.expectedAmount);

    if (!title || !Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      res.status(400).json({ error: "Título e valor positivo são obrigatórios." });
      return;
    }

    const direction = body.direction === "income" ? "income" : "expense";
    const scope: TransactionScope =
      direction === "income" ? "individual" : body.scope === "couple" ? "couple" : "individual";
    const paidBy: PaidBy = body.paidBy === "partner" ? "partner" : "me";
    const mySharePct =
      scope === "couple" && typeof body.mySharePct === "number" && Number.isFinite(body.mySharePct)
        ? Math.min(100, Math.max(0, body.mySharePct))
        : scope === "couple"
          ? 50
          : 100;

    const item: RecurringCashflow = {
      id: `cf-${crypto.randomUUID()}`,
      direction,
      title,
      expectedAmount,
      paidBy,
      scope,
      mySharePct,
      active: body.active !== false,
      updatedAt: new Date().toISOString(),
    };

    try {
      await vaultClient.saveEntity("cashflow", item.id, item);
      res.json({ item });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao salvar item de fluxo de caixa.",
      });
    }
  });

  router.put("/cashflow/:id", async (req, res) => {
    const existing = await vaultClient.getEntity<CashflowEntity>(req.params.id);
    if (!existing || isMonthlyExtraIncome(existing)) {
      res.status(404).json({ error: "Item não encontrado." });
      return;
    }

    const body = req.body as Partial<RecurringCashflow>;
    const updated: RecurringCashflow = {
      ...existing,
      title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : existing.title,
      expectedAmount:
        typeof body.expectedAmount === "number" && Number.isFinite(body.expectedAmount) && body.expectedAmount > 0
          ? body.expectedAmount
          : existing.expectedAmount,
      active: typeof body.active === "boolean" ? body.active : existing.active,
      scope: body.scope === "couple" || body.scope === "individual" ? body.scope : existing.scope,
      paidBy: body.paidBy === "partner" || body.paidBy === "me" ? body.paidBy : existing.paidBy,
      mySharePct:
        typeof body.mySharePct === "number" && Number.isFinite(body.mySharePct)
          ? Math.min(100, Math.max(0, body.mySharePct))
          : existing.mySharePct,
      updatedAt: new Date().toISOString(),
    };

    await vaultClient.saveEntity("cashflow", updated.id, updated);
    res.json({ item: updated });
  });

  router.delete("/cashflow/:id", async (req, res) => {
    const deleted = await vaultClient.deleteEntity(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Item não encontrado." });
      return;
    }
    res.json({ deleted: true });
  });

  router.get("/extra-incomes", async (req, res) => {
    const monthParam = typeof req.query.month === "string" ? req.query.month.trim() : "";
    if (monthParam && !MONTH_REGEX.test(monthParam)) {
      res.status(400).json({ error: "Competência inválida. Use o formato YYYY-MM." });
      return;
    }

    try {
      const list = await vaultClient.listEntities<CashflowEntity>(
        "cashflow",
        monthParam ? { periodKey: monthParam } : undefined
      );
      const extraIncomes = list
        .filter(isMonthlyExtraIncome)
        .filter((item) => (!monthParam ? true : item.month === monthParam))
        .sort((a, b) => b.month.localeCompare(a.month) || b.updatedAt.localeCompare(a.updatedAt));

      res.json({ extraIncomes });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao listar entradas extras.",
      });
    }
  });

  router.post("/extra-incomes", async (req, res) => {
    const body = (req.body || {}) as {
      month?: string;
      title?: string;
      amount?: number;
      toReserve?: number;
      toCouple?: number;
      applyToBalances?: boolean;
      notes?: string;
    };

    const month = typeof body.month === "string" ? body.month.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const amount = round2(Number(body.amount));
    const toReserve = round2(Math.max(0, Number(body.toReserve) || 0));
    const toCouple = round2(Math.max(0, Number(body.toCouple) || 0));

    if (!MONTH_REGEX.test(month)) {
      res.status(400).json({ error: "Mês de referência inválido (use YYYY-MM)." });
      return;
    }
    if (!title || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "Descrição e valor positivo são obrigatórios." });
      return;
    }
    if (round2(toReserve + toCouple) > amount) {
      res.status(400).json({
        error: "A soma destinada para Reserva e Casal não pode ultrapassar o valor total da entrada.",
      });
      return;
    }

    const toChecking = round2(Math.max(0, amount - toReserve - toCouple));
    const appliedToBalances = body.applyToBalances !== false;
    const now = new Date().toISOString();

    const item: MonthlyExtraIncome = {
      id: `extra-${month}-${crypto.randomUUID()}`,
      kind: "extra",
      month,
      title,
      amount,
      allocation: {
        toReserve,
        toCouple,
        toChecking,
      },
      appliedToBalances,
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : undefined,
      updatedAt: now,
    };

    try {
      await vaultClient.saveEntity("cashflow", item.id, item, { periodKey: month });

      let reserve = normalizeReserve(
        await vaultClient.getEntity<ReserveState>(DEFAULT_RESERVE_STATE.id)
      );

      if (appliedToBalances) {
        reserve = {
          ...reserve,
          checkingBalance: round2((reserve.checkingBalance || 0) + toChecking),
          liquidEmergencyReserve: round2(reserve.liquidEmergencyReserve + toReserve),
          coupleAccumulatedSavings: round2(reserve.coupleAccumulatedSavings + toCouple),
          updatedAt: now,
        };
        await vaultClient.saveEntity("reserve", reserve.id, reserve);
      }

      res.json({ item, reserve });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao salvar entrada extra.",
      });
    }
  });

  router.delete("/extra-incomes/:id", async (req, res) => {
    try {
      const existing = await vaultClient.getEntity<CashflowEntity>(req.params.id);
      if (!existing || !isMonthlyExtraIncome(existing)) {
        res.status(404).json({ error: "Entrada extra não encontrada." });
        return;
      }

      const deleted = await vaultClient.deleteEntity(existing.id);
      if (!deleted) {
        res.status(404).json({ error: "Entrada extra não encontrada." });
        return;
      }

      let reserve = normalizeReserve(
        await vaultClient.getEntity<ReserveState>(DEFAULT_RESERVE_STATE.id)
      );

      if (existing.appliedToBalances) {
        reserve = {
          ...reserve,
          checkingBalance: Math.max(
            0,
            round2((reserve.checkingBalance || 0) - existing.allocation.toChecking)
          ),
          liquidEmergencyReserve: Math.max(
            0,
            round2(reserve.liquidEmergencyReserve - existing.allocation.toReserve)
          ),
          coupleAccumulatedSavings: Math.max(
            0,
            round2(reserve.coupleAccumulatedSavings - existing.allocation.toCouple)
          ),
          updatedAt: new Date().toISOString(),
        };
        await vaultClient.saveEntity("reserve", reserve.id, reserve);
      }

      res.json({
        deleted: true,
        revertedBalances: existing.appliedToBalances,
        reserve,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao remover entrada extra.",
      });
    }
  });

  router.put("/reserve", async (req, res) => {
    const body = req.body as Partial<ReserveState>;
    const existing = normalizeReserve(
      await vaultClient.getEntity<ReserveState>(DEFAULT_RESERVE_STATE.id)
    );
    const reserve: ReserveState = {
      id: DEFAULT_RESERVE_STATE.id,
      checkingBalance:
        typeof body.checkingBalance === "number" && Number.isFinite(body.checkingBalance)
          ? Math.max(0, round2(body.checkingBalance))
          : existing.checkingBalance ?? 0,
      liquidEmergencyReserve:
        typeof body.liquidEmergencyReserve === "number" &&
        Number.isFinite(body.liquidEmergencyReserve)
          ? Math.max(0, round2(body.liquidEmergencyReserve))
          : existing.liquidEmergencyReserve,
      coupleAccumulatedSavings:
        typeof body.coupleAccumulatedSavings === "number" &&
        Number.isFinite(body.coupleAccumulatedSavings)
          ? Math.max(0, round2(body.coupleAccumulatedSavings))
          : existing.coupleAccumulatedSavings,
      otherInvestments:
        typeof body.otherInvestments === "number" && Number.isFinite(body.otherInvestments)
          ? Math.max(0, round2(body.otherInvestments))
          : existing.otherInvestments,
      updatedAt: new Date().toISOString(),
    };

    try {
      await vaultClient.saveEntity("reserve", reserve.id, reserve);
      res.json({ reserve });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao salvar reservas.",
      });
    }
  });

  router.put("/profile", async (req, res) => {
    const existing =
      (await vaultClient.getEntity<UserProfile>(DEFAULT_USER_PROFILE.id)) ?? DEFAULT_USER_PROFILE;
    const body = req.body as Partial<UserProfile>;

    const profile: UserProfile = {
      id: DEFAULT_USER_PROFILE.id,
      interestsAndGoalsText:
        typeof body.interestsAndGoalsText === "string"
          ? body.interestsAndGoalsText
          : existing.interestsAndGoalsText,
      targetRunwayMonths:
        typeof body.targetRunwayMonths === "number" && Number.isFinite(body.targetRunwayMonths)
          ? Math.min(36, Math.max(1, body.targetRunwayMonths))
          : existing.targetRunwayMonths,
      maxCommitmentPct:
        typeof body.maxCommitmentPct === "number" && Number.isFinite(body.maxCommitmentPct)
          ? Math.min(95, Math.max(10, body.maxCommitmentPct))
          : existing.maxCommitmentPct,
      targetSavingsRatePct:
        typeof body.targetSavingsRatePct === "number" && Number.isFinite(body.targetSavingsRatePct)
          ? Math.min(80, Math.max(0, body.targetSavingsRatePct))
          : existing.targetSavingsRatePct,
      updatedAt: new Date().toISOString(),
    };

    try {
      await vaultClient.saveEntity("profile", profile.id, profile);
      res.json({ profile });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao salvar perfil financeiro.",
      });
    }
  });

  router.post("/simulate", async (req, res) => {
    const body = req.body as {
      title?: string;
      price?: number;
      installments?: number;
      scope?: TransactionScope;
      mySharePct?: number;
    };

    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) {
      res.status(400).json({ error: "Preço da compra deve ser positivo." });
      return;
    }

    try {
      const ctx = await loadFullSafetyContext(vaultClient);
      const simulation = simulatePurchaseImpact(ctx.overview, ctx.reserve, ctx.profile, {
        title: (body.title || "Compra simulada").trim(),
        price,
        installments: Number(body.installments) || 1,
        scope: body.scope === "couple" ? "couple" : "individual",
        mySharePct: body.mySharePct,
      });

      res.json({ simulation, currentIndicators: ctx.overview.indicators });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao simular compra.",
      });
    }
  });

  return router;
}
