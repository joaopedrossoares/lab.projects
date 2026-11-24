import type {
  BillSection,
  FutureInstallment,
  ParsedBillResult,
  ParsedTransaction,
} from "../types/domain.js";
import {
  extractInstallmentTag,
  normalizeMerchantKey,
  simplifyText,
} from "./normalizeMerchant.js";
import type { BillParserAdapter, PdfTextItemLike } from "./types.js";

interface PositionedText {
  x: number;
  text: string;
}

export function groupTextItemsIntoLines(
  items: PdfTextItemLike[],
  splitX = 345
): string {
  const rows = new Map<number, PositionedText[]>();

  for (const item of items) {
    const text = String(item.str || "").trim();
    if (!text) continue;

    const [, , , , x, y] = item.transform;
    const key = Math.round(y / 3) * 3;

    if (!rows.has(key)) {
      rows.set(key, []);
    }

    rows.get(key)!.push({ x, text });
  }

  const leftLines: string[] = [];
  const rightLines: string[] = [];

  for (const [, rowItems] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
    const leftLine = buildLine(rowItems.filter((item) => item.x < splitX));
    const rightLine = buildLine(rowItems.filter((item) => item.x >= splitX));

    if (leftLine) leftLines.push(leftLine);
    if (rightLine) rightLines.push(rightLine);
  }

  return [...leftLines, ...rightLines].join("\n");
}

function buildLine(items: PositionedText[]): string {
  return items
    .sort((a, b) => a.x - b.x)
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBrazilianMoney(value: string): number {
  return Number(value.replace(/\./g, "").replace(",", "."));
}

function normalizePdfText(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isInstallmentsStart(simplifiedLine: string): boolean {
  return (
    simplifiedLine.includes("compras parceladas") &&
    /pr\s*o\s*ximas/.test(simplifiedLine)
  );
}

function isEndOfTransactionsSection(simplifiedLine: string): boolean {
  return (
    simplifiedLine.includes("total dos lancamentos atuais") ||
    simplifiedLine.includes("limites de credito") ||
    simplifiedLine.includes("encargos cobrados") ||
    simplifiedLine.includes("novo teto de juros") ||
    simplifiedLine.includes("fique atento")
  );
}

function isEndOfInstallmentsSection(simplifiedLine: string): boolean {
  return (
    simplifiedLine.includes("total para proximas faturas") ||
    simplifiedLine.includes("limites de credito") ||
    simplifiedLine.includes("encargos cobrados") ||
    simplifiedLine.includes("novo teto de juros") ||
    simplifiedLine.includes("fique atento")
  );
}

function isHeaderOrTotal(simplifiedLine: string): boolean {
  return (
    simplifiedLine === "p" ||
    simplifiedLine === "l" ||
    simplifiedLine.startsWith("data ") ||
    simplifiedLine.startsWith("joao ") ||
    simplifiedLine.startsWith("continua") ||
    simplifiedLine.includes("dolar de convers") ||
    simplifiedLine.includes("total transacoes") ||
    simplifiedLine.includes("repasse de iof") ||
    simplifiedLine.includes("total lancamentos") ||
    simplifiedLine.includes("lancamentos no cartao") ||
    simplifiedLine.includes("total dos pagamentos") ||
    simplifiedLine.includes("proxima fatura") ||
    simplifiedLine.includes("demais faturas") ||
    simplifiedLine.includes("total para proximas faturas") ||
    simplifiedLine.includes("valor em r$") ||
    simplifiedLine.includes("us$ r$")
  );
}

function shouldIgnoreTransaction(description: string): boolean {
  const normalized = simplifyText(description);

  return (
    normalized.includes("pagamento") ||
    normalized.includes("total") ||
    normalized.includes("lancamentos") ||
    normalized.includes("limite") ||
    normalized.includes("juros") ||
    normalized.includes("iof") ||
    normalized.includes("cartao") ||
    normalized.includes("saldo financiado") ||
    normalized.includes("valor total financiado") ||
    normalized.includes("pagamento minimo")
  );
}

function cleanDescription(value: string): string {
  return value
    .replace(/\b(DATA|ESTABELECIMENTO|VALOR|EM|R\$|US\$)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findTransactionDatePositions(line: string): Array<{ index: number; date: string }> {
  const matches: Array<{ index: number; date: string }> = [];
  const regex = /(^|\s)(\d{2}\/\d{2})\s+/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    const index = match.index + match[1].length;
    const date = match[2];

    const afterDate = line.slice(regex.lastIndex).trim();
    const firstTokenAfterDate = afterDate.split(" ")[0] || "";

    // Avoid mistaking an installment marker for a date (e.g. "SousaParfumImp 08/10 89,90")
    if (/^-?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(firstTokenAfterDate)) {
      continue;
    }

    matches.push({ index, date });
  }

  return matches;
}

function findTransactionAmount(
  text: string,
  section: BillSection
): { value: string; descriptionEndIndex: number } | null {
  const moneyRegex = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
  const matches = [...text.matchAll(moneyRegex)];

  if (matches.length === 0) return null;

  const chosen = matches[matches.length - 1];
  const descriptionEndIndex =
    section === "international" && matches.length >= 2
      ? (matches[0].index ?? 0)
      : (chosen.index ?? 0);

  return {
    value: chosen[0],
    descriptionEndIndex,
  };
}

function parseTransactionSegment(
  segment: string,
  section: BillSection
): Omit<ParsedTransaction, "id"> | null {
  const match = segment.match(/^(\d{2}\/\d{2})\s+(.+)$/);
  if (!match) return null;

  const [, date, rest] = match;
  const amountMatch = findTransactionAmount(rest, section);
  if (!amountMatch) return null;

  const rawDescription = rest.slice(0, amountMatch.descriptionEndIndex);
  const description = cleanDescription(rawDescription);
  const amount = parseBrazilianMoney(amountMatch.value);

  if (!description || !Number.isFinite(amount) || amount <= 0 || shouldIgnoreTransaction(description)) {
    return null;
  }

  return {
    date,
    description,
    normalizedMerchant: normalizeMerchantKey(description),
    category: "",
    amount,
    section,
    installment: extractInstallmentTag(description),
  };
}

function extractTransactionsFromLine(
  line: string,
  section: BillSection
): Array<Omit<ParsedTransaction, "id">> {
  const transactions: Array<Omit<ParsedTransaction, "id">> = [];
  const datePositions = findTransactionDatePositions(line);

  for (let index = 0; index < datePositions.length; index++) {
    const currentDate = datePositions[index];
    const nextDate = datePositions[index + 1];

    const segment = line.slice(currentDate.index, nextDate?.index).trim();
    const transaction = parseTransactionSegment(segment, section);

    if (transaction) {
      transactions.push(transaction);
    }
  }

  return transactions;
}

function parseFutureInstallmentLine(line: string): Omit<FutureInstallment, "id"> | null {
  const match = line.match(/^(\d{2}\/\d{2})\s+(.+)$/);
  if (!match) return null;

  const [, date, rest] = match;
  const moneyRegex = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
  const amounts = [...rest.matchAll(moneyRegex)];
  if (amounts.length === 0) return null;

  const firstMoney = amounts[0];
  const rawDescription = rest.slice(0, firstMoney.index ?? 0);
  const description = cleanDescription(rawDescription);
  if (!description || shouldIgnoreTransaction(description)) return null;

  const nextBillAmount = parseBrazilianMoney(firstMoney[0]);
  const remainingAmount =
    amounts.length >= 2
      ? parseBrazilianMoney(amounts[amounts.length - 1][0])
      : nextBillAmount;

  if (!Number.isFinite(nextBillAmount) || nextBillAmount <= 0) return null;

  return {
    date,
    description,
    normalizedMerchant: normalizeMerchantKey(description),
    installment: extractInstallmentTag(description),
    nextBillAmount,
    remainingAmount: Number.isFinite(remainingAmount) && remainingAmount >= 0 ? remainingAmount : nextBillAmount,
  };
}

function dedupeTransactions(
  transactions: Array<Omit<ParsedTransaction, "id">>
): Array<Omit<ParsedTransaction, "id">> {
  const seen = new Set<string>();

  return transactions.filter((transaction) => {
    const key = [
      transaction.date,
      simplifyText(transaction.description),
      transaction.amount,
    ].join("|");

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function dedupeFutureInstallments(
  items: Array<Omit<FutureInstallment, "id">>
): Array<Omit<FutureInstallment, "id">> {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = [
      item.date,
      simplifyText(item.description),
      item.nextBillAmount,
      item.remainingAmount,
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseItauCreditCardBill(text: string): ParsedBillResult {
  const lines = normalizePdfText(text);
  const transactions: Array<Omit<ParsedTransaction, "id">> = [];
  const futureInstallments: Array<Omit<FutureInstallment, "id">> = [];

  let section: BillSection = "unknown";
  let inFutureInstallments = false;

  for (const line of lines) {
    const simplified = simplifyText(line);

    if (isInstallmentsStart(simplified)) {
      inFutureInstallments = true;
      section = "unknown";
      continue;
    }

    if (/lancamentos\s*:?\s*internacionais/.test(simplified)) {
      section = "international";
      inFutureInstallments = false;
      continue;
    }

    if (/lancamentos\s*:?\s*compras e saques/.test(simplified)) {
      section = "national";
      inFutureInstallments = false;
      continue;
    }

    if (inFutureInstallments) {
      if (isEndOfInstallmentsSection(simplified)) {
        inFutureInstallments = false;
        continue;
      }
      if (isHeaderOrTotal(simplified)) {
        continue;
      }
      const futureItem = parseFutureInstallmentLine(line);
      if (futureItem) {
        futureInstallments.push(futureItem);
      }
      continue;
    }

    if (isEndOfTransactionsSection(simplified)) {
      section = "unknown";
      continue;
    }

    if (isHeaderOrTotal(simplified)) {
      continue;
    }

    const foundTransactions = extractTransactionsFromLine(line, section);
    transactions.push(...foundTransactions);
  }

  return {
    adapterId: "itau-pdf",
    transactions: dedupeTransactions(transactions).map((transaction, index) => ({
      id: String(index + 1).padStart(3, "0"),
      ...transaction,
    })),
    futureInstallments: dedupeFutureInstallments(futureInstallments).map((item, index) => ({
      id: `fut-${String(index + 1).padStart(3, "0")}`,
      ...item,
    })),
  };
}

export const itauPdfParser: BillParserAdapter = {
  id: "itau-pdf",
  name: "Fatura Itaú (PDF)",
  parseText: parseItauCreditCardBill,
};
