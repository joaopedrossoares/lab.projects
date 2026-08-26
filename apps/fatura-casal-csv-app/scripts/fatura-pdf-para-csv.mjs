import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

const [, , inputPdfPath, outputCsvPath = "compras.csv"] = process.argv;

if (!inputPdfPath) {
  console.error("Uso: node scripts/fatura-pdf-para-csv.mjs caminho/da/fatura.pdf compras.csv");
  process.exit(1);
}

const absoluteInputPath = path.resolve(inputPdfPath);
const absoluteOutputPath = path.resolve(outputCsvPath);

const pdfText = await readPdfText(absoluteInputPath);
const transactions = parseCreditCardBill(pdfText);
const csv = transactionsToCsv(transactions);

await fs.writeFile(absoluteOutputPath, csv, "utf8");
await fs.writeFile(absoluteOutputPath.replace(/\.csv$/i, ".debug.txt"), pdfText, "utf8");

console.log(`CSV gerado em: ${absoluteOutputPath}`);
console.log(`Compras encontradas: ${transactions.length}`);
console.log(`Debug gerado em: ${absoluteOutputPath.replace(/\.csv$/i, ".debug.txt")}`);

async function readPdfText(filePath) {
  const data = await fs.readFile(filePath);

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    pages.push(groupTextItemsIntoLines(content.items));
  }

  return pages.join("\n");
}

function groupTextItemsIntoLines(items) {
  const rows = new Map();

  for (const item of items) {
    const text = String(item.str || "").trim();

    if (!text) continue;

    const [, , , , x, y] = item.transform;
    const key = Math.round(y / 3) * 3;

    if (!rows.has(key)) {
      rows.set(key, []);
    }

    rows.get(key).push({ x, text });
  }

  const leftLines = [];
  const rightLines = [];

  for (const [, rowItems] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
    const splitX = 345;

    const leftLine = buildLine(rowItems.filter((item) => item.x < splitX));
    const rightLine = buildLine(rowItems.filter((item) => item.x >= splitX));

    if (leftLine) leftLines.push(leftLine);
    if (rightLine) rightLines.push(rightLine);
  }

  return [...leftLines, ...rightLines].join("\n");
}

function buildLine(items) {
  return items
    .sort((a, b) => a.x - b.x)
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCreditCardBill(text) {
  const lines = normalizePdfText(text);
  const transactions = [];

  let section = "unknown";
  let stopParsingThisColumn = false;

  for (const line of lines) {
    const simplified = simplify(line);

    if (isInstallmentsStart(simplified)) {
      stopParsingThisColumn = true;
      section = "unknown";
      continue;
    }

    if (simplified.includes("lancamentos internacionais")) {
      section = "international";
      stopParsingThisColumn = false;
      continue;
    }

    if (simplified.includes("lancamentos compras e saques")) {
      section = "national";
      stopParsingThisColumn = false;
      continue;
    }

    if (isEndOfTransactionsSection(simplified)) {
      section = "unknown";
      continue;
    }

    if (stopParsingThisColumn || isHeaderOrTotal(simplified)) {
      continue;
    }

    const foundTransactions = extractTransactionsFromLine(line, section);
    transactions.push(...foundTransactions);
  }

  return dedupeTransactions(transactions).map((transaction, index) => ({
    id: String(index + 1).padStart(3, "0"),
    ...transaction,
  }));
}

function normalizePdfText(text) {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function simplify(line) {
  return line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isInstallmentsStart(simplifiedLine) {
  return (
    simplifiedLine.includes("compras parceladas") &&
    /pr\s*o\s*ximas/.test(simplifiedLine)
  );
}

function extractTransactionsFromLine(line, section) {
  const transactions = [];
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

function findTransactionDatePositions(line) {
  const matches = [];

  const regex = /(^|\s)(\d{2}\/\d{2})\s+/g;
  let match;

  while ((match = regex.exec(line)) !== null) {
    const index = match.index + match[1].length;
    const date = match[2];

    const afterDate = line.slice(regex.lastIndex).trim();
    const firstTokenAfterDate = afterDate.split(" ")[0] || "";

    // Evita confundir parcela com data.
    // Exemplo: "SousaParfumImp 08/10 89,90"
    if (/^-?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(firstTokenAfterDate)) {
      continue;
    }

    matches.push({ index, date });
  }

  return matches;
}

function parseTransactionSegment(segment, section) {
  const match = segment.match(/^(\d{2}\/\d{2})\s+(.+)$/);

  if (!match) {
    return null;
  }

  const [, date, rest] = match;

  const amountMatch = findTransactionAmount(rest);

  if (!amountMatch) {
    return null;
  }

  const rawDescription = rest.slice(0, amountMatch.index);
  const description = cleanDescription(rawDescription);
  const amount = parseBrazilianMoney(amountMatch.value);

  if (!description || amount <= 0 || shouldIgnoreTransaction(description)) {
    return null;
  }

  return {
    date,
    description,
    category: "",
    amount,
    section,
  };
}

function findTransactionAmount(text) {
  const moneyRegex = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
  const matches = [...text.matchAll(moneyRegex)];

  if (matches.length === 0) {
    return null;
  }

  const chosen = matches.at(-1);

  return {
    value: chosen[0],
    index: chosen.index,
  };
}

function cleanDescription(value) {
  return value
    .replace(/\b(DATA|ESTABELECIMENTO|VALOR|EM|R\$|US\$)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isEndOfTransactionsSection(simplifiedLine) {
  return (
    simplifiedLine.includes("total dos lancamentos atuais") ||
    simplifiedLine.includes("limites de credito") ||
    simplifiedLine.includes("encargos cobrados") ||
    simplifiedLine.includes("novo teto de juros") ||
    simplifiedLine.includes("fique atento")
  );
}

function isHeaderOrTotal(simplifiedLine) {
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

function shouldIgnoreTransaction(description) {
  const normalized = simplify(description);

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

function dedupeTransactions(transactions) {
  const seen = new Set();

  return transactions.filter((transaction) => {
    const key = [
      transaction.date,
      simplify(transaction.description),
      transaction.amount,
    ].join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function parseBrazilianMoney(value) {
  return Number(value.replace(/\./g, "").replace(",", "."));
}

function transactionsToCsv(transactions) {
  const headers = ["id", "date", "description", "category", "amount", "section"];

  const rows = transactions.map((transaction) => {
    return headers
      .map((header) => escapeCsv(transaction[header] ?? ""))
      .join(",");
  });

  return `${headers.join(",")}\n${rows.join("\n")}\n`;
}

function escapeCsv(value) {
  const text = String(value);

  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}