import type {
  FutureInstallment,
  MonthlyClosing,
  RecurringCashflow,
  ReserveState,
  SafetyIndicators,
  Transaction,
  TransactionScope,
  UserProfile,
} from "@financas/shared";

export interface CoupleSettlementSummary {
  totalIndividualMine: number;
  totalIndividualPartner: number;
  totalCouple: number;
  couplePaidByMe: number;
  couplePaidByPartner: number;
  myCoupleShare: number;
  partnerCoupleShare: number;
  totalMyExpenses: number;
  /** Positive: partner owes me. Negative: I owe partner. */
  netSettlementAmount: number;
  byCategory: Record<string, number>;
}

export interface SafetyCalculationInput {
  recurring: RecurringCashflow[];
  reserve: ReserveState;
  profile: UserProfile;
  closings: MonthlyClosing[];
  futureInstallments: FutureInstallment[];
}

export interface SafetyBreakdown {
  monthlyIncome: number;
  myFixedMonthlyCost: number;
  committedInstallmentsNextMonth: number;
  avgCoupleSavingsShare: number;
  avgVariableExpenses: number;
  targetMonthlySavings: number;
}

export interface SafetyOverviewResult {
  indicators: SafetyIndicators;
  breakdown: SafetyBreakdown;
}

export interface PurchaseSimulationInput {
  title: string;
  price: number;
  installments: number;
  scope: TransactionScope;
  mySharePct?: number;
}

export interface PurchaseSimulationResult {
  myTotalCost: number;
  monthlyInstallmentImpact: number;
  cashPaymentRunwayMonths: number;
  installmentCommitmentPct: number;
  remainingSafeMarginAfterInstallment: number;
  monthsToSaveComfortably: number;
  verdict: "buy_now" | "installments" | "save_first" | "wait";
  reasons: string[];
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  id: "user-profile-default",
  interestsAndGoalsText: "",
  targetRunwayMonths: 6,
  maxCommitmentPct: 60,
  targetSavingsRatePct: 20,
  updatedAt: new Date(0).toISOString(),
};

export const DEFAULT_RESERVE_STATE: ReserveState = {
  id: "reserve-state-default",
  liquidEmergencyReserve: 0,
  coupleAccumulatedSavings: 0,
  otherInvestments: 0,
  updatedAt: new Date(0).toISOString(),
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateCoupleSettlement(
  transactions: Pick<
    Transaction,
    "amount" | "scope" | "paidBy" | "mySharePct" | "category"
  >[]
): CoupleSettlementSummary {
  let totalIndividualMine = 0;
  let totalIndividualPartner = 0;
  let totalCouple = 0;
  let couplePaidByMe = 0;
  let couplePaidByPartner = 0;
  let myCoupleShare = 0;
  let partnerCoupleShare = 0;
  let netSettlementAmount = 0;
  const byCategory: Record<string, number> = {};

  for (const tx of transactions) {
    const amount = Number.isFinite(tx.amount) ? tx.amount : 0;
    const cat = (tx.category || "Outros").trim() || "Outros";

    if (tx.scope === "couple") {
      const pct = Math.min(100, Math.max(0, Number.isFinite(tx.mySharePct) ? tx.mySharePct : 50));
      const myPart = amount * (pct / 100);
      const partnerPart = amount - myPart;

      totalCouple += amount;
      myCoupleShare += myPart;
      partnerCoupleShare += partnerPart;

      if (tx.paidBy === "partner") {
        couplePaidByPartner += amount;
        netSettlementAmount -= myPart;
      } else {
        couplePaidByMe += amount;
        netSettlementAmount += partnerPart;
      }

      byCategory[cat] = round2((byCategory[cat] || 0) + myPart);
    } else if (tx.paidBy === "partner") {
      totalIndividualPartner += amount;
    } else {
      totalIndividualMine += amount;
      byCategory[cat] = round2((byCategory[cat] || 0) + amount);
    }
  }

  return {
    totalIndividualMine: round2(totalIndividualMine),
    totalIndividualPartner: round2(totalIndividualPartner),
    totalCouple: round2(totalCouple),
    couplePaidByMe: round2(couplePaidByMe),
    couplePaidByPartner: round2(couplePaidByPartner),
    myCoupleShare: round2(myCoupleShare),
    partnerCoupleShare: round2(partnerCoupleShare),
    totalMyExpenses: round2(totalIndividualMine + myCoupleShare),
    netSettlementAmount: round2(netSettlementAmount),
    byCategory,
  };
}

export function calculateSafetyOverview(input: SafetyCalculationInput): SafetyOverviewResult {
  const activeRecurring = input.recurring.filter((item) => item.active);

  let monthlyIncome = 0;
  let myFixedMonthlyCost = 0;

  for (const item of activeRecurring) {
    const amt = Number.isFinite(item.expectedAmount) ? Math.max(0, item.expectedAmount) : 0;
    if (item.direction === "income") {
      monthlyIncome += amt;
    } else if (item.scope === "couple") {
      const pct = Math.min(100, Math.max(0, Number.isFinite(item.mySharePct) ? item.mySharePct : 50));
      myFixedMonthlyCost += amt * (pct / 100);
    } else if (item.paidBy !== "partner") {
      myFixedMonthlyCost += amt;
    }
  }

  const committedInstallmentsNextMonth = input.futureInstallments.reduce(
    (sum, item) => sum + (Number.isFinite(item.nextBillAmount) ? Math.max(0, item.nextBillAmount) : 0),
    0
  );

  const recentClosed = input.closings
    .filter((c) => c.status === "closed")
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 3);

  const avgCoupleSavingsShare =
    recentClosed.length > 0
      ? recentClosed.reduce((sum, c) => sum + Math.max(0, c.coupleSavedThisMonth || 0) / 2, 0) /
        recentClosed.length
      : 0;

  const avgMyHistoricalExpenses =
    recentClosed.length > 0
      ? recentClosed.reduce((sum, c) => sum + Math.max(0, c.totalMyExpenses || 0), 0) /
        recentClosed.length
      : 0;

  const avgVariableExpenses = Math.max(0, avgMyHistoricalExpenses - myFixedMonthlyCost);

  // Monthly essential cost = my fixed obligations + committed installments (or historical fallback)
  const monthlyEssentialCost =
    myFixedMonthlyCost + committedInstallmentsNextMonth > 0
      ? myFixedMonthlyCost + committedInstallmentsNextMonth
      : avgMyHistoricalExpenses;

  const liquidReserve = Math.max(0, input.reserve.liquidEmergencyReserve || 0);
  const runwayMonths =
    monthlyEssentialCost > 0 ? round2(liquidReserve / monthlyEssentialCost) : 0;

  const incomeCommitmentPct =
    monthlyIncome > 0
      ? round2(((myFixedMonthlyCost + committedInstallmentsNextMonth) / monthlyIncome) * 100)
      : 0;

  const targetSavingsRatePct = Math.min(80, Math.max(0, input.profile.targetSavingsRatePct || 20));
  const targetMonthlySavings = monthlyIncome * (targetSavingsRatePct / 100);

  const projectedNetSurplus = Math.max(
    0,
    monthlyIncome - myFixedMonthlyCost - committedInstallmentsNextMonth - avgVariableExpenses
  );
  const savingsRatePct =
    monthlyIncome > 0
      ? round2(Math.min(100, ((projectedNetSurplus + avgCoupleSavingsShare) / monthlyIncome) * 100))
      : 0;

  const safeFreeMargin = round2(
    monthlyIncome -
      myFixedMonthlyCost -
      committedInstallmentsNextMonth -
      avgCoupleSavingsShare -
      targetMonthlySavings
  );

  const targetRunway = Math.max(1, input.profile.targetRunwayMonths || 6);
  const maxCommit = Math.min(95, Math.max(10, input.profile.maxCommitmentPct || 60));

  let healthStatus: SafetyIndicators["healthStatus"];
  if (monthlyIncome <= 0 || runwayMonths < 1 || safeFreeMargin < -500) {
    healthStatus = "critical";
  } else if (runwayMonths < targetRunway * 0.5 || incomeCommitmentPct > maxCommit + 10 || safeFreeMargin < 0) {
    healthStatus = "attention";
  } else if (runwayMonths < targetRunway || incomeCommitmentPct > maxCommit) {
    healthStatus = "stable";
  } else if (runwayMonths >= targetRunway * 1.5 && savingsRatePct >= targetSavingsRatePct) {
    healthStatus = "shielded";
  } else {
    healthStatus = "comfortable";
  }

  return {
    indicators: {
      monthlyEssentialCost: round2(monthlyEssentialCost),
      runwayMonths,
      savingsRatePct,
      incomeCommitmentPct,
      safeFreeMargin,
      healthStatus,
    },
    breakdown: {
      monthlyIncome: round2(monthlyIncome),
      myFixedMonthlyCost: round2(myFixedMonthlyCost),
      committedInstallmentsNextMonth: round2(committedInstallmentsNextMonth),
      avgCoupleSavingsShare: round2(avgCoupleSavingsShare),
      avgVariableExpenses: round2(avgVariableExpenses),
      targetMonthlySavings: round2(targetMonthlySavings),
    },
  };
}

export function simulatePurchaseImpact(
  overview: SafetyOverviewResult,
  reserve: ReserveState,
  profile: UserProfile,
  purchase: PurchaseSimulationInput
): PurchaseSimulationResult {
  const price = Math.max(0, purchase.price);
  const shareFactor =
    purchase.scope === "couple"
      ? Math.min(100, Math.max(0, purchase.mySharePct ?? 50)) / 100
      : 1;

  const myTotalCost = round2(price * shareFactor);
  const installments = Math.max(1, Math.round(purchase.installments || 1));
  const monthlyInstallmentImpact = round2(myTotalCost / installments);

  const essential = overview.indicators.monthlyEssentialCost;
  const reserveAfterCash = Math.max(0, (reserve.liquidEmergencyReserve || 0) - myTotalCost);
  const cashPaymentRunwayMonths = essential > 0 ? round2(reserveAfterCash / essential) : 0;

  const income = overview.breakdown.monthlyIncome;
  const newCommitted =
    overview.breakdown.myFixedMonthlyCost +
    overview.breakdown.committedInstallmentsNextMonth +
    monthlyInstallmentImpact;
  const installmentCommitmentPct = income > 0 ? round2((newCommitted / income) * 100) : 100;

  const remainingSafeMarginAfterInstallment = round2(
    overview.indicators.safeFreeMargin - monthlyInstallmentImpact
  );

  const monthsToSaveComfortably =
    overview.indicators.safeFreeMargin > 0
      ? Math.max(1, Math.ceil(myTotalCost / overview.indicators.safeFreeMargin))
      : 99;

  const targetRunway = Math.max(1, profile.targetRunwayMonths || 6);
  const maxCommit = Math.min(95, Math.max(10, profile.maxCommitmentPct || 60));
  const reasons: string[] = [];

  let verdict: PurchaseSimulationResult["verdict"];

  if (
    myTotalCost <= overview.indicators.safeFreeMargin &&
    cashPaymentRunwayMonths >= targetRunway
  ) {
    verdict = "buy_now";
    reasons.push("Cabe integralmente na sua margem segura deste mês sem afetar sua reserva.");
  } else if (
    installments > 1 &&
    remainingSafeMarginAfterInstallment >= 0 &&
    installmentCommitmentPct <= maxCommit &&
    overview.indicators.runwayMonths >= targetRunway * 0.75
  ) {
    verdict = "installments";
    reasons.push(
      `A parcela de R$ ${monthlyInstallmentImpact.toFixed(2)} cabe na margem segura e mantém o comprometimento em ${installmentCommitmentPct}% (limite ${maxCommit}%).`
    );
  } else if (overview.indicators.safeFreeMargin > 0 && monthsToSaveComfortably <= 12) {
    verdict = "save_first";
    reasons.push(
      `Comprando à vista agora seu runway cairia para ${cashPaymentRunwayMonths} meses (meta ${targetRunway} meses).`
    );
    reasons.push(
      `Guardando sua margem livre, você junta o valor em ~${monthsToSaveComfortably} mês(es) sem risco.`
    );
  } else {
    verdict = "wait";
    reasons.push(
      "Sua margem segura atual está apertada ou comprometimento acima do limite; priorize reforçar a reserva e os compromissos do casal antes."
    );
  }

  return {
    myTotalCost,
    monthlyInstallmentImpact,
    cashPaymentRunwayMonths,
    installmentCommitmentPct,
    remainingSafeMarginAfterInstallment,
    monthsToSaveComfortably,
    verdict,
    reasons,
  };
}
