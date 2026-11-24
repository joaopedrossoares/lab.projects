export type BillSection = "national" | "international" | "unknown";

export type TransactionScope = "individual" | "couple";

export type PaidBy = "me" | "partner";

export type TransactionSource = "pdf_itau" | "manual" | "fixed_copy";

export interface ParsedTransaction {
  id: string;
  date: string;
  description: string;
  normalizedMerchant: string;
  category: string;
  amount: number;
  section: BillSection;
  installment?: string;
}

export interface FutureInstallment {
  id: string;
  date: string;
  description: string;
  normalizedMerchant: string;
  installment?: string;
  nextBillAmount: number;
  remainingAmount: number;
}

export interface ParsedBillResult {
  adapterId: string;
  transactions: ParsedTransaction[];
  futureInstallments: FutureInstallment[];
}

export interface LabelRule {
  id: string;
  normalizedPattern: string;
  friendlyName: string;
  category: string;
  defaultScope: TransactionScope;
  mySharePct: number;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  month: string; // YYYY-MM
  source: TransactionSource;
  paidBy: PaidBy;
  date: string;
  rawDescription: string;
  normalizedMerchant: string;
  friendlyName: string;
  category: string;
  amount: number;
  scope: TransactionScope;
  mySharePct: number;
  section?: BillSection;
  installment?: string;
  matchedRuleId?: string;
  matchSource?: "label_rule" | "installment_history";
  matchedFromInstallment?: string;
}

export interface SafetyIndicators {
  monthlyEssentialCost: number;
  runwayMonths: number;
  savingsRatePct: number;
  incomeCommitmentPct: number;
  safeFreeMargin: number;
  healthStatus: "critical" | "attention" | "stable" | "comfortable" | "shielded";
}

export interface MonthlyClosing {
  id: string;
  month: string; // YYYY-MM
  status: "draft" | "closed";
  totalIncome: number;
  totalMyExpenses: number;
  totalCoupleExpenses: number;
  netSettlementAmount: number; // positive: partner pays me; negative: I pay partner
  coupleSavedThisMonth: number;
  coupleCheckinNotes: string;
  safetySnapshot?: SafetyIndicators;
  closedAt?: string;
  updatedAt: string;
}

export interface RecurringCashflow {
  id: string;
  direction: "income" | "expense";
  title: string;
  expectedAmount: number;
  paidBy: PaidBy;
  scope: TransactionScope;
  mySharePct: number;
  active: boolean;
  updatedAt: string;
}

export interface ReserveState {
  id: string;
  liquidEmergencyReserve: number;
  coupleAccumulatedSavings: number;
  otherInvestments: number;
  updatedAt: string;
}

export interface CouplePlanNote {
  id: string;
  text: string;
  status: "active" | "done";
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  interestsAndGoalsText: string;
  targetRunwayMonths: number;
  maxCommitmentPct: number;
  targetSavingsRatePct: number;
  updatedAt: string;
}

export type PlannedPurchaseStatus = "wishlist" | "evaluating" | "approved" | "bought" | "dropped";

export interface PurchaseAIAssessment {
  recommendedRank: number;
  verdict: "buy_now" | "installments" | "save_first" | "wait";
  rationale: string;
  suggestedMonth?: string;
  updatedAt: string;
}

export interface PlannedPurchase {
  id: string;
  title: string;
  estimatedPrice: number;
  defaultInstallments: number;
  scope: TransactionScope;
  urgency: number; // 1-5
  desireImpact: number; // 1-5
  notes: string;
  status: PlannedPurchaseStatus;
  aiAssessment?: PurchaseAIAssessment;
  updatedAt: string;
}

export type OpaqueEntityType =
  | "label_rule"
  | "closing"
  | "tx"
  | "future_installment"
  | "cashflow"
  | "reserve"
  | "couple_plan"
  | "profile"
  | "purchase"
  | "ai_chat";

export interface OpaqueRecord {
  id: string;
  entityType: OpaqueEntityType;
  periodKey: string | null;
  blindIndex: string | null;
  encryptedPayload: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type AIProviderType = "gemini" | "openai_compatible" | "ollama";

export interface AIProviderConfig {
  provider: AIProviderType;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  updatedAt?: string;
}
