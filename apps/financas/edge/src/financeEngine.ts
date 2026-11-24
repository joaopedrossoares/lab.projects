import type { Transaction } from "@financas/shared";

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

function roundMoney(value: number): number {
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

      byCategory[cat] = roundMoney((byCategory[cat] || 0) + myPart);
    } else if (tx.paidBy === "partner") {
      totalIndividualPartner += amount;
    } else {
      totalIndividualMine += amount;
      byCategory[cat] = roundMoney((byCategory[cat] || 0) + amount);
    }
  }

  return {
    totalIndividualMine: roundMoney(totalIndividualMine),
    totalIndividualPartner: roundMoney(totalIndividualPartner),
    totalCouple: roundMoney(totalCouple),
    couplePaidByMe: roundMoney(couplePaidByMe),
    couplePaidByPartner: roundMoney(couplePaidByPartner),
    myCoupleShare: roundMoney(myCoupleShare),
    partnerCoupleShare: roundMoney(partnerCoupleShare),
    totalMyExpenses: roundMoney(totalIndividualMine + myCoupleShare),
    netSettlementAmount: roundMoney(netSettlementAmount),
    byCategory,
  };
}
