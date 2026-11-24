import crypto from "node:crypto";
import { Router } from "express";
import type {
  FutureInstallment,
  MonthlyClosing,
  PaidBy,
  RecurringCashflow,
  ReserveState,
  TransactionScope,
  UserProfile,
} from "@financas/shared";
import {
  calculateSafetyOverview,
  DEFAULT_RESERVE_STATE,
  DEFAULT_USER_PROFILE,
  simulatePurchaseImpact,
  type SafetyOverviewResult,
} from "../financeEngine.js";
import type { VaultClient } from "../vaultClient.js";

export async function loadFullSafetyContext(vaultClient: VaultClient): Promise<{
  recurring: RecurringCashflow[];
  reserve: ReserveState;
  profile: UserProfile;
  closings: MonthlyClosing[];
  futureInstallments: FutureInstallment[];
  overview: SafetyOverviewResult;
}> {
  const [recurring, reserves, profiles, closings, allFutures] = await Promise.all([
    vaultClient.listEntities<RecurringCashflow>("cashflow"),
    vaultClient.listEntities<ReserveState>("reserve"),
    vaultClient.listEntities<UserProfile>("profile"),
    vaultClient.listEntities<MonthlyClosing>("closing"),
    vaultClient.listEntities<FutureInstallment>("future_installment"),
  ]);

  const reserve = reserves[0] ?? DEFAULT_RESERVE_STATE;
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
    const existing = await vaultClient.getEntity<RecurringCashflow>(req.params.id);
    if (!existing) {
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

  router.put("/reserve", async (req, res) => {
    const body = req.body as Partial<ReserveState>;
    const reserve: ReserveState = {
      id: DEFAULT_RESERVE_STATE.id,
      liquidEmergencyReserve: Math.max(0, Number(body.liquidEmergencyReserve) || 0),
      coupleAccumulatedSavings: Math.max(0, Number(body.coupleAccumulatedSavings) || 0),
      otherInvestments: Math.max(0, Number(body.otherInvestments) || 0),
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
