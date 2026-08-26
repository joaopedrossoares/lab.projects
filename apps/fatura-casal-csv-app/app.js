const PDF_JS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const state = {
  transactions: [],
  filter: "",
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const elements = {
  fileInput:
    document.querySelector("#pdfInput") ||
    document.querySelector("#csvInput") ||
    document.querySelector('input[type="file"]'),

  transactionsList: document.querySelector("#transactionsList"),
  template: document.querySelector("#transactionTemplate"),
  message: document.querySelector("#message"),
  toolbar: document.querySelector("#toolbar"),
  searchInput: document.querySelector("#searchInput"),
  markAllCouple: document.querySelector("#markAllCouple"),
  markAllIndividual: document.querySelector("#markAllIndividual"),
  coupleTotal: document.querySelector("#coupleTotal"),
  eachPays: document.querySelector("#eachPays"),
  itemsCount: document.querySelector("#itemsCount"),
  fileName: document.querySelector("#fileName"),
};

setupUiForPdfMode();

if (!elements.fileInput) {
  throw new Error("Não encontrei nenhum input de arquivo no HTML.");
}

elements.fileInput.addEventListener("change", handlePdfSelection);

if (elements.searchInput) {
  elements.searchInput.addEventListener("input", (event) => {
    state.filter = event.target.value.trim().toLowerCase();
    render();
  });
}

if (elements.markAllCouple) {
  elements.markAllCouple.addEventListener("click", () => updateAll("casal"));
}

if (elements.markAllIndividual) {
  elements.markAllIndividual.addEventListener("click", () => updateAll("individual"));
}

function setupUiForPdfMode() {
  if (elements.fileInput) {
    elements.fileInput.id = "pdfInput";
    elements.fileInput.accept = ".pdf,application/pdf";
  }

  const uploadLabel = document.querySelector(".upload-box");

  if (uploadLabel) {
    uploadLabel.setAttribute("for", "pdfInput");
  }

  const uploadTitle = document.querySelector(".upload-box strong");

  if (uploadTitle) {
    uploadTitle.textContent = "Selecionar PDF";
  }

  const uploadDescription = document.querySelector(".upload-box small");

  if (uploadDescription) {
    uploadDescription.textContent = "A fatura será lida e convertida internamente no navegador";
  }

  const heroText = document.querySelector(".hero-text");

  if (heroText) {
    heroText.innerHTML =
      'Selecione o PDF da fatura, confira as compras e marque o que é <strong>Individual</strong> ou <strong>Casal</strong>.';
  }

  if (elements.fileName) {
    elements.fileName.textContent = "Aguardando PDF";
  }

  if (elements.message) {
    elements.message.textContent = "Selecione o PDF da fatura para começar.";
  }
}

async function handlePdfSelection(event) {
  const file = event.target.files?.[0];

  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    showMessage("Selecione um arquivo PDF.");
    return;
  }

  showMessage("Lendo PDF e extraindo compras...");

  try {
    const pdfText = await readPdfText(file);
    const transactions = parseCreditCardBill(pdfText);

    console.log("Texto extraído do PDF:", pdfText);
    console.log("Compras encontradas no PDF:", transactions);

    state.transactions = transactions.map((transaction, index) => ({
      id:
        transaction.id ||
        `${index}-${transaction.date}-${transaction.amount}-${transaction.description}`,
      date: transaction.date,
      description: transaction.description,
      category: transaction.category || transaction.section || "",
      amount: Number(transaction.amount),
      section: transaction.section || "",
      kind: "individual",
    }));

    if (elements.fileName) {
      elements.fileName.textContent = file.name;
    }

    if (elements.toolbar) {
      elements.toolbar.hidden = state.transactions.length === 0;
    }

    if (state.transactions.length === 0) {
      showMessage("Não encontrei compras nesse PDF. Abra o console para ver o texto extraído.");
    } else {
      hideMessage();
    }

    render();
  } catch (error) {
    console.error(error);
    state.transactions = [];
    render();
    showMessage("Não foi possível ler o PDF. Abra o console para ver o erro técnico.");
  }
}

async function readPdfText(file) {
  const pdfjsLib = await import(PDF_JS_URL);

  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

  const buffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: buffer,
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

    // Evita confundir parcela com data. Exemplo: "SousaParfumImp 08/10 89,90".
    if (/^-?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(firstTokenAfterDate)) {
      continue;
    }

    matches.push({ index, date });
  }

  return matches;
}

function parseTransactionSegment(segment, section) {
  const match = segment.match(/^(\d{2}\/\d{2})\s+(.+)$/);

  if (!match) return null;

  const [, date, rest] = match;
  const amountMatch = findTransactionAmount(rest);

  if (!amountMatch) return null;

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

  if (matches.length === 0) return null;

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

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function parseBrazilianMoney(value) {
  return Number(value.replace(/\./g, "").replace(",", "."));
}

function updateAll(kind) {
  state.transactions = state.transactions.map((transaction) => ({
    ...transaction,
    kind,
  }));

  render();
}

function updateTransactionKind(id, kind) {
  const transaction = state.transactions.find((item) => item.id === id);

  if (!transaction) return;

  transaction.kind = kind;
  render();
}

function render() {
  if (!elements.transactionsList || !elements.template) {
    console.error("Não encontrei #transactionsList ou #transactionTemplate no HTML.");
    return;
  }

  const filteredTransactions = state.transactions.filter((transaction) => {
    if (!state.filter) return true;

    return `${transaction.date} ${transaction.description} ${transaction.category} ${transaction.section}`
      .toLowerCase()
      .includes(state.filter);
  });

  elements.transactionsList.innerHTML = "";

  filteredTransactions.forEach((transaction) => {
    const node = elements.template.content.cloneNode(true);

    const card = node.querySelector(".transaction-card");
    const title = node.querySelector("h2");
    const date = node.querySelector(".date");
    const category = node.querySelector(".category");
    const amount = node.querySelector(".amount");
    const buttons = node.querySelectorAll(".toggle-group button");

    if (card) {
      card.dataset.id = transaction.id;
    }

    if (title) {
      title.textContent = transaction.description;
    }

    if (date) {
      date.textContent = transaction.date;
    }

    if (category) {
      category.textContent =
        transaction.category ||
        transaction.section ||
        "Sem categoria detectada";
    }

    if (amount) {
      amount.textContent = currency.format(transaction.amount);
    }

    buttons.forEach((button) => {
      const kind = button.dataset.kind;

      button.classList.toggle("active", kind === transaction.kind);

      button.addEventListener("click", () => {
        updateTransactionKind(transaction.id, kind);
      });
    });

    elements.transactionsList.appendChild(node);
  });

  updateSummary();
}

function updateSummary() {
  const coupleTotal = state.transactions
    .filter((transaction) => transaction.kind === "casal")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  if (elements.coupleTotal) {
    elements.coupleTotal.textContent = currency.format(coupleTotal);
  }

  if (elements.eachPays) {
    elements.eachPays.textContent = currency.format(coupleTotal / 2);
  }

  if (elements.itemsCount) {
    elements.itemsCount.textContent = state.transactions.length;
  }
}

function showMessage(text) {
  if (!elements.message) return;

  elements.message.hidden = false;
  elements.message.textContent = text;
}

function hideMessage() {
  if (!elements.message) return;

  elements.message.hidden = true;
}
