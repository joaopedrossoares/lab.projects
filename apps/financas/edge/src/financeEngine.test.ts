import { describe, expect, it } from "vitest";
import { calculateCoupleSettlement } from "./financeEngine.js";

describe("financeEngine — calculateCoupleSettlement", () => {
  it("computes net settlement with expenses paid by me and partner plus custom shares", () => {
    const summary = calculateCoupleSettlement([
      // I paid 2400 couple (50/50) -> she owes me 1200
      { amount: 2400, scope: "couple", paidBy: "me", mySharePct: 50, category: "Casa & Contas" },
      // She paid 900 couple (50/50) -> I owe her 450 -> net +750 (she pays me 750)
      { amount: 900, scope: "couple", paidBy: "partner", mySharePct: 50, category: "Mercado" },
      // I paid 500 couple (60% mine, 40% hers) -> she owes me 200 -> net +950
      { amount: 500, scope: "couple", paidBy: "me", mySharePct: 60, category: "Viagem" },
      // My individual expense 300 -> doesn't affect settlement
      { amount: 300, scope: "individual", paidBy: "me", mySharePct: 100, category: "Lazer" },
      // Her individual expense 200 -> doesn't affect settlement or my expenses
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
    expect(summary.byCategory["Casa & Contas"]).toBe(1200);
    expect(summary.byCategory["Mercado"]).toBe(450);
    expect(summary.byCategory["Lazer"]).toBe(300);
  });

  it("returns negative netSettlementAmount when I owe partner", () => {
    const summary = calculateCoupleSettlement([
      { amount: 1000, scope: "couple", paidBy: "partner", mySharePct: 50, category: "Casa" },
    ]);

    expect(summary.netSettlementAmount).toBe(-500);
    expect(summary.totalMyExpenses).toBe(500);
  });
});
