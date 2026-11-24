import { describe, expect, it } from "vitest";
import {
  calculateCoupleSettlement,
  calculateSafetyOverview,
  DEFAULT_RESERVE_STATE,
  DEFAULT_USER_PROFILE,
  simulatePurchaseImpact,
} from "./financeEngine.js";

describe("financeEngine — calculateCoupleSettlement", () => {
  it("computes net settlement with expenses paid by me and partner plus custom shares", () => {
    const summary = calculateCoupleSettlement([
      { amount: 2400, scope: "couple", paidBy: "me", mySharePct: 50, category: "Casa & Contas" },
      { amount: 900, scope: "couple", paidBy: "partner", mySharePct: 50, category: "Mercado" },
      { amount: 500, scope: "couple", paidBy: "me", mySharePct: 60, category: "Viagem" },
      { amount: 300, scope: "individual", paidBy: "me", mySharePct: 100, category: "Lazer" },
      { amount: 200, scope: "individual", paidBy: "partner", mySharePct: 0, category: "Compras" },
    ]);

    expect(summary.totalCouple).toBe(3800);
    expect(summary.couplePaidByMe).toBe(2900);
    expect(summary.couplePaidByPartner).toBe(900);
    expect(summary.myCoupleShare).toBe(1950);
    expect(summary.partnerCoupleShare).toBe(1850);
    expect(summary.netSettlementAmount).toBe(950);
    expect(summary.totalIndividualMine).toBe(300);
    expect(summary.totalMyExpenses).toBe(2250);
  });

  it("returns negative netSettlementAmount when I owe partner", () => {
    const summary = calculateCoupleSettlement([
      { amount: 1000, scope: "couple", paidBy: "partner", mySharePct: 50, category: "Casa" },
    ]);

    expect(summary.netSettlementAmount).toBe(-500);
    expect(summary.totalMyExpenses).toBe(500);
  });
});

describe("financeEngine — calculateSafetyOverview & simulatePurchaseImpact", () => {
  const now = new Date().toISOString();

  it("calculates all 4 safety indicators deterministically including couple share and installments", () => {
    const overview = calculateSafetyOverview({
      recurring: [
        {
          id: "inc-1",
          direction: "income",
          title: "Salário",
          expectedAmount: 10000,
          paidBy: "me",
          scope: "individual",
          mySharePct: 100,
          active: true,
          updatedAt: now,
        },
        {
          id: "exp-1",
          direction: "expense",
          title: "Aluguel Casal",
          expectedAmount: 3000,
          paidBy: "me",
          scope: "couple",
          mySharePct: 50, // My share = 1500
          active: true,
          updatedAt: now,
        },
        {
          id: "exp-2",
          direction: "expense",
          title: "Academia",
          expectedAmount: 200,
          paidBy: "me",
          scope: "individual",
          mySharePct: 100,
          active: true,
          updatedAt: now,
        },
      ],
      reserve: {
        ...DEFAULT_RESERVE_STATE,
        liquidEmergencyReserve: 25000,
      },
      profile: {
        ...DEFAULT_USER_PROFILE,
        targetRunwayMonths: 6,
        maxCommitmentPct: 60,
        targetSavingsRatePct: 20, // 2000/month target
      },
      closings: [
        {
          id: "closing-2026-10",
          month: "2026-10",
          status: "closed",
          totalIncome: 10000,
          totalMyExpenses: 3200,
          totalCoupleExpenses: 3000,
          netSettlementAmount: 500,
          coupleSavedThisMonth: 1000, // my share = 500
          coupleCheckinNotes: "",
          updatedAt: now,
        },
      ],
      futureInstallments: [
        {
          id: "fut-1",
          date: "05/09",
          description: "NOTEBOOK 04/10",
          normalizedMerchant: "notebook",
          installment: "04/10",
          nextBillAmount: 800,
          remainingAmount: 4800,
        },
      ],
    });

    // Essential = 1500 (rent share) + 200 (gym) + 800 (installments) = 2500
    expect(overview.indicators.monthlyEssentialCost).toBe(2500);
    // Runway = 25000 / 2500 = 10 months
    expect(overview.indicators.runwayMonths).toBe(10);
    // Income commitment = 2500 / 10000 = 25%
    expect(overview.indicators.incomeCommitmentPct).toBe(25);
    // Safe free margin = 10000 - 1700 - 800 - 500 (couple savings share) - 2000 (target savings) = 5000
    expect(overview.indicators.safeFreeMargin).toBe(5000);
    expect(overview.indicators.healthStatus).toBe("shielded");

    // Simulate a R$ 1.200 individual purchase -> fits in margin -> buy_now
    const simOk = simulatePurchaseImpact(
      overview,
      { ...DEFAULT_RESERVE_STATE, liquidEmergencyReserve: 25000 },
      DEFAULT_USER_PROFILE,
      { title: "Monitor 4K", price: 1200, installments: 1, scope: "individual" }
    );
    expect(simOk.verdict).toBe("buy_now");
    expect(simOk.myTotalCost).toBe(1200);

    // Simulate a R$ 18.000 purchase in 10x -> 1800/m fits margin -> installments
    const simInst = simulatePurchaseImpact(
      overview,
      { ...DEFAULT_RESERVE_STATE, liquidEmergencyReserve: 25000 },
      DEFAULT_USER_PROFILE,
      { title: "Ar Condicionado", price: 18000, installments: 10, scope: "individual" }
    );
    expect(simInst.verdict).toBe("installments");
    expect(simInst.monthlyInstallmentImpact).toBe(1800);
    // 18000 - 5000 (free margin) = 13000 drawdown if paid in cash
    expect(simInst.reserveDrawdown).toBe(13000);
  });

  it("does not subtract from emergency reserve when cash purchase fits inside monthly free margin, and reports reserveGapToTarget", () => {
    const overview = calculateSafetyOverview({
      recurring: [
        {
          id: "inc-1",
          direction: "income",
          title: "Salário",
          expectedAmount: 10000,
          paidBy: "me",
          scope: "individual",
          mySharePct: 100,
          active: true,
          updatedAt: now,
        },
        {
          id: "exp-1",
          direction: "expense",
          title: "Aluguel",
          expectedAmount: 3000,
          paidBy: "me",
          scope: "individual",
          mySharePct: 100,
          active: true,
          updatedAt: now,
        },
      ],
      reserve: { ...DEFAULT_RESERVE_STATE, liquidEmergencyReserve: 6000 }, // 2 months runway (< 6m target)
      profile: { ...DEFAULT_USER_PROFILE, targetRunwayMonths: 6, targetSavingsRatePct: 20 },
      closings: [],
      futureInstallments: [],
    });

    // Safe free margin = 10000 - 3000 - 2000 = 5000. Item = 2000 fits inside margin!
    const sim = simulatePurchaseImpact(
      overview,
      { ...DEFAULT_RESERVE_STATE, liquidEmergencyReserve: 6000 },
      DEFAULT_USER_PROFILE,
      { title: "Mini PC", price: 2000, installments: 1, scope: "individual" }
    );

    expect(sim.reserveDrawdown).toBe(0);
    expect(sim.cashPaymentRunwayMonths).toBe(2); // Reserve intact!
    expect(sim.reserveGapToTarget).toBe(12000); // 6*3000 - 6000 = 12000
    expect(sim.verdict).toBe("save_first");
    expect(sim.reasons.join(" ")).toContain("12000.00");
  });

  it("handles zero income and zero reserve gracefully without NaN", () => {
    const overview = calculateSafetyOverview({
      recurring: [],
      reserve: DEFAULT_RESERVE_STATE,
      profile: DEFAULT_USER_PROFILE,
      closings: [],
      futureInstallments: [],
    });

    expect(overview.indicators.runwayMonths).toBe(0);
    expect(overview.indicators.incomeCommitmentPct).toBe(0);
    expect(overview.indicators.savingsRatePct).toBe(0);
    expect(overview.indicators.healthStatus).toBe("critical");
  });
});
