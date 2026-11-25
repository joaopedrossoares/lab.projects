import type { CouplePlanNote, MonthlyExtraIncome, PlannedPurchase } from "@financas/shared";
import { simulatePurchaseImpact, type PurchaseSimulationResult } from "../financeEngine.js";
import { loadFullSafetyContext } from "../routes/safety.js";
import type { VaultClient } from "../vaultClient.js";

export interface InternalFinancialContext {
  safetyIndicators: Awaited<ReturnType<typeof loadFullSafetyContext>>["overview"]["indicators"];
  breakdown: Awaited<ReturnType<typeof loadFullSafetyContext>>["overview"]["breakdown"];
  reserve: Awaited<ReturnType<typeof loadFullSafetyContext>>["reserve"];
  recentExtraIncomes: Array<
    Pick<MonthlyExtraIncome, "month" | "title" | "amount" | "allocation" | "appliedToBalances">
  >;
  userInterestsAndGoals: string;
  activeCouplePlans: string[];
  recentClosingsSummary: Array<{
    month: string;
    totalIncome: number;
    extraIncomeTotal: number;
    totalMyExpenses: number;
    totalCoupleExpenses: number;
    coupleSavedThisMonth: number;
  }>;
  futureInstallmentsCount: number;
  futureNextMonthTotal: number;
  wishlistWithSimulations: Array<{
    purchase: PlannedPurchase;
    simulation: PurchaseSimulationResult;
  }>;
}

/**
 * Internal local-only toolset built directly over the re-hydrated Edge data.
 * Zero third-party SaaS integrations; sensitive context stays strictly in local memory.
 */
export async function buildInternalFinancialContext(
  vaultClient: VaultClient
): Promise<InternalFinancialContext> {
  const [safetyCtx, couplePlans, purchases] = await Promise.all([
    loadFullSafetyContext(vaultClient),
    vaultClient.listEntities<CouplePlanNote>("couple_plan"),
    vaultClient.listEntities<PlannedPurchase>("purchase"),
  ]);

  const activeCouplePlans = couplePlans
    .filter((p) => p.status === "active" && !p.id.startsWith("audit-test-"))
    .map((p) => p.text);

  const activeWishlist = purchases.filter(
    (p) => p.status !== "bought" && p.status !== "dropped"
  );

  const wishlistWithSimulations = activeWishlist.map((purchase) => ({
    purchase,
    simulation: simulatePurchaseImpact(
      safetyCtx.overview,
      safetyCtx.reserve,
      safetyCtx.profile,
      {
        title: purchase.title,
        price: purchase.estimatedPrice,
        installments: purchase.defaultInstallments,
        scope: purchase.scope,
      }
    ),
  }));

  const recentClosingsSummary = safetyCtx.closings
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 6)
    .map((c) => ({
      month: c.month,
      totalIncome: c.totalIncome,
      extraIncomeTotal: c.extraIncomeTotal ?? 0,
      totalMyExpenses: c.totalMyExpenses,
      totalCoupleExpenses: c.totalCoupleExpenses,
      coupleSavedThisMonth: c.coupleSavedThisMonth,
    }));

  const recentExtraIncomes = safetyCtx.extraIncomes.slice(0, 10).map((item) => ({
    month: item.month,
    title: item.title,
    amount: item.amount,
    allocation: item.allocation,
    appliedToBalances: item.appliedToBalances,
  }));

  return {
    safetyIndicators: safetyCtx.overview.indicators,
    breakdown: safetyCtx.overview.breakdown,
    reserve: safetyCtx.reserve,
    recentExtraIncomes,
    userInterestsAndGoals: safetyCtx.profile.interestsAndGoalsText || "",
    activeCouplePlans,
    recentClosingsSummary,
    futureInstallmentsCount: safetyCtx.futureInstallments.length,
    futureNextMonthTotal: safetyCtx.overview.breakdown.committedInstallmentsNextMonth,
    wishlistWithSimulations,
  };
}
