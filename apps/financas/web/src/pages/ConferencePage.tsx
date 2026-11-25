import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  normalizeMerchantKey,
  type CouplePlanNote,
  type FutureInstallment,
  type LabelRule,
  type MonthlyClosing,
  type PaidBy,
  type ParsedBillResult,
  type ParsedTransaction,
  type Transaction,
  type TransactionScope,
} from "@financas/shared";
import { CurrencyInput } from "../components/CurrencyInput";
import {
  LoadingButtonContent,
  LoadingSpinner,
  SkeletonCardList,
  SkeletonSummaryGrid,
} from "../components/Loading";
import { DEFAULT_CATEGORIES } from "../lib/categories";
import { formatBRL } from "../lib/format";
import { readAndParseItauPdf } from "../lib/pdfReader";

type ReviewFilter = "all" | "unmatched" | "matched";

interface ConferencePageProps {
  month: string;
  onMonthChange: (month: string) => void;
  pdfParser?: (file: File) => Promise<ParsedBillResult>;
}

function formatSettlementLabel(net: number): { headline: string; detail: string } {
  if (Math.abs(net) < 0.01) {
    return { headline: formatBRL(0), detail: "Contas do casal quitadas (sem transferência)" };
  }
  if (net > 0) {
    return { headline: formatBRL(net), detail: "Ela transfere para você" };
  }
  return { headline: formatBRL(Math.abs(net)), detail: "Você transfere para ela" };
}

export function ConferencePage({
  month,
  onMonthChange,
  pdfParser = readAndParseItauPdf,
}: ConferencePageProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [missingFixedExpenses, setMissingFixedExpenses] = useState<Transaction[]>([]);
  const [futureInstallments, setFutureInstallments] = useState<FutureInstallment[]>([]);
  const [closing, setClosing] = useState<MonthlyClosing | null>(null);
  const [couplePlans, setCouplePlans] = useState<CouplePlanNote[]>([]);

  const [uploadPaidBy, setUploadPaidBy] = useState<PaidBy>("me");
  const [filter, setFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [fileName, setFileName] = useState("Aguardando PDF");
  const [statusMessage, setStatusMessage] = useState("Selecione o PDF da fatura ou adicione gastos do mês.");
  const [loadingMonth, setLoadingMonth] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState<"draft" | "closed" | null>(null);
  const [suggestingAI, setSuggestingAI] = useState(false);
  const [addingCouplePlan, setAddingCouplePlan] = useState(false);
  const [togglingPlanId, setTogglingPlanId] = useState<string | null>(null);
  const savingMonth = savingAction !== null;

  // Manual entry quick form
  const [manualDesc, setManualDesc] = useState("");
  const [manualAmount, setManualAmount] = useState(0);
  const [manualPaidBy, setManualPaidBy] = useState<PaidBy>("partner");
  const [manualScope, setManualScope] = useState<TransactionScope>("couple");
  const [manualCategory, setManualCategory] = useState("Casa & Contas");

  // Check-in dialog state
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [coupleSavedInput, setCoupleSavedInput] = useState(0);
  const [checkinNotesInput, setCheckinNotesInput] = useState("");
  const [newPlanText, setNewPlanText] = useState("");

  const fileInputId = useId();
  const monthInputId = useId();
  const searchInputId = useId();
  const catListId = useId();
  const checkinTitleId = useId();
  const savedInputId = useId();
  const notesInputId = useId();
  const newPlanId = useId();

  const loadMonthData = useCallback(async (targetMonth: string, signal?: AbortSignal) => {
    setLoadingMonth(true);
    setClosing(null);
    setTransactions([]);
    setMissingFixedExpenses([]);
    setFutureInstallments([]);
    try {
      const res = await fetch(`/api/closings/${encodeURIComponent(targetMonth)}`, { signal });
      if (!res.ok || signal?.aborted) return;
      const data = (await res.json()) as {
        closing: MonthlyClosing | null;
        transactions: Transaction[];
        futureInstallments: FutureInstallment[];
        couplePlans: CouplePlanNote[];
        preloadedFixedCount?: number;
        missingRecurringExpenses?: Transaction[];
      };
      if (signal?.aborted) return;
      setClosing(data.closing);
      setTransactions(data.transactions || []);
      setMissingFixedExpenses(data.missingRecurringExpenses || []);
      setFutureInstallments(data.futureInstallments || []);
      setCouplePlans(data.couplePlans || []);
      setCoupleSavedInput(data.closing?.coupleSavedThisMonth ?? 0);
      setCheckinNotesInput(data.closing?.coupleCheckinNotes ?? "");
      if ((data.preloadedFixedCount || 0) > 0) {
        setFileName(`Contas fixas (${targetMonth})`);
        setStatusMessage(
          `${data.preloadedFixedCount} conta(s) fixa(s) recorrente(s) pré-carregada(s) automaticamente para ${targetMonth}. Você pode ajustar valores variáveis (como luz/água) antes de salvar.`
        );
      } else if ((data.transactions || []).length > 0) {
        setFileName(`Salvo (${targetMonth})`);
        setStatusMessage("");
      } else {
        setFileName("Aguardando PDF");
        setStatusMessage("Selecione o PDF da fatura ou adicione gastos do mês.");
      }
    } catch {
      // Offline/test mode without Edge API or aborted on month switch
    } finally {
      if (!signal?.aborted) {
        setLoadingMonth(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadMonthData(month, controller.signal);
    return () => controller.abort();
  }, [month, loadMonthData]);

  async function applySavedRules(
    parsedTxs: ParsedTransaction[],
    paidBy: PaidBy
  ): Promise<Transaction[]> {
    try {
      const res = await fetch("/api/labels/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, transactions: parsedTxs }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          transactions: Array<
            ParsedTransaction & {
              friendlyName: string;
              scope: TransactionScope;
              mySharePct: number;
              matchedRuleId?: string;
              matchSource?: "label_rule" | "installment_history";
              matchedFromInstallment?: string;
            }
          >;
        };
        return data.transactions.map((tx) => ({
          id: `${month}-${paidBy}-${tx.id}-${Date.now().toString(36)}`,
          month,
          source: "pdf_itau",
          paidBy,
          date: tx.date,
          rawDescription: tx.description,
          normalizedMerchant: tx.normalizedMerchant,
          friendlyName: tx.friendlyName,
          category: tx.category,
          amount: tx.amount,
          scope: tx.scope,
          mySharePct: tx.mySharePct,
          section: tx.section,
          installment: tx.installment,
          matchedRuleId: tx.matchedRuleId,
          matchSource: tx.matchSource,
          matchedFromInstallment: tx.matchedFromInstallment,
        }));
      }
    } catch {
      // Fallback when running without Edge API
    }

    return parsedTxs.map((tx) => ({
      id: `${month}-${paidBy}-${tx.id}-${Date.now().toString(36)}`,
      month,
      source: "pdf_itau",
      paidBy,
      date: tx.date,
      rawDescription: tx.description,
      normalizedMerchant: tx.normalizedMerchant,
      friendlyName: tx.description,
      category: tx.category,
      amount: tx.amount,
      scope: "individual",
      mySharePct: 50,
      section: tx.section,
      installment: tx.installment,
    }));
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setStatusMessage("Selecione um arquivo PDF válido.");
      return;
    }

    setIsLoading(true);
    setStatusMessage("Lendo PDF localmente e aplicando seus labels salvos...");

    try {
      const parsed = await pdfParser(file);
      const enriched = await applySavedRules(parsed.transactions, uploadPaidBy);

      setTransactions((prev) => [...prev, ...enriched]);
      if (parsed.futureInstallments.length > 0) {
        setFutureInstallments(parsed.futureInstallments);
      }
      setFileName(file.name);

      if (enriched.length === 0) {
        setStatusMessage("Não encontrei compras nesse PDF. Confira se é uma fatura Itaú em texto.");
      } else {
        const inheritedCount = enriched.filter(
          (tx) => tx.matchSource === "installment_history"
        ).length;
        const ruleCount = enriched.filter((tx) => tx.matchSource === "label_rule").length;
        const matchedCount = inheritedCount + ruleCount;

        if (matchedCount > 0) {
          const details: string[] = [];
          if (inheritedCount > 0) details.push(`${inheritedCount} herdada(s) de parcela anterior`);
          if (ruleCount > 0) details.push(`${ruleCount} por label salvo`);
          setStatusMessage(`${enriched.length} compras importadas (${details.join(", ")}).`);
        } else {
          setStatusMessage(`${enriched.length} compras importadas da fatura.`);
        }
      }
    } catch {
      setStatusMessage("Não foi possível ler o PDF selecionado.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleAddManualTransaction(event: FormEvent) {
    event.preventDefault();
    if (!manualDesc.trim() || !Number.isFinite(manualAmount) || manualAmount <= 0) return;

    const tx: Transaction = {
      id: `${month}-manual-${Date.now().toString(36)}`,
      month,
      source: "manual",
      paidBy: manualPaidBy,
      date: `${month.slice(5, 7)}/${month.slice(0, 4)}`,
      rawDescription: manualDesc.trim(),
      normalizedMerchant: normalizeMerchantKey(manualDesc.trim()),
      friendlyName: manualDesc.trim(),
      category: manualCategory.trim() || "Casa & Contas",
      amount: manualAmount,
      scope: manualScope,
      mySharePct: 50,
    };

    setTransactions((prev) => [tx, ...prev]);
    setManualDesc("");
    setManualAmount(0);
    setStatusMessage(`Gasto "${tx.friendlyName}" adicionado à competência ${month}.`);
  }

  function updateTx(id: string, patch: Partial<Transaction>) {
    setTransactions((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function removeTx(id: string) {
    setTransactions((prev) => prev.filter((item) => item.id !== id));
  }

  function handleImportMissingFixed() {
    if (missingFixedExpenses.length === 0) return;
    setTransactions((prev) => {
      const existing = new Set(prev.map((t) => t.id));
      const toAdd = missingFixedExpenses.filter((item) => !existing.has(item.id));
      return [...toAdd, ...prev];
    });
    setStatusMessage(
      `${missingFixedExpenses.length} conta(s) fixa(s) importada(s) para ${month}. Ajuste valores variáveis se precisar e salve.`
    );
    setMissingFixedExpenses([]);
  }

  function updateAllScopes(scope: TransactionScope) {
    setTransactions((prev) => prev.map((item) => ({ ...item, scope })));
  }

  function isTxRecognized(tx: Transaction): boolean {
    return Boolean(tx.matchedRuleId || tx.matchSource);
  }

  async function handleSuggestLabelsWithAI() {
    const unknown = transactions.filter((tx) => !isTxRecognized(tx));
    if (unknown.length === 0) {
      setStatusMessage("Todas as compras já foram reconhecidas por regras salvas.");
      return;
    }

    setSuggestingAI(true);
    setStatusMessage("Consultando IA local para sugerir apelidos e categorias...");
    try {
      const res = await fetch("/api/ai/suggest-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: unknown.map((tx) => ({
            id: tx.id,
            description: tx.rawDescription,
            amount: tx.amount,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMessage(data.error || "Configure sua chave de IA na aba Configurações.");
        return;
      }

      const byId = new Map<
        string,
        { friendlyName: string; category: string; defaultScope: TransactionScope }
      >();
      for (const s of data.suggestions || []) {
        byId.set(s.id, s);
      }

      setTransactions((prev) =>
        prev.map((tx) => {
          const suggestion = byId.get(tx.id);
          if (!suggestion) return tx;
          return {
            ...tx,
            friendlyName: suggestion.friendlyName || tx.friendlyName,
            category: suggestion.category || tx.category,
            scope: suggestion.defaultScope || tx.scope,
          };
        })
      );

      setStatusMessage(
        `IA sugeriu labels para ${byId.size} compra(s). Revise e clique em "Lembrar regra" nas que quiser memorizar.`
      );
    } catch {
      setStatusMessage("Erro ao consultar sugestões de IA.");
    } finally {
      setSuggestingAI(false);
    }
  }

  async function handleRememberRule(tx: Transaction) {
    setSavingRuleId(tx.id);
    try {
      const res = await fetch("/api/labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawPattern: tx.normalizedMerchant || tx.rawDescription,
          friendlyName: tx.friendlyName.trim() || tx.rawDescription,
          category: tx.category.trim() || "Outros",
          defaultScope: tx.scope,
          mySharePct: tx.mySharePct,
        }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { rule: LabelRule };

      setTransactions((prev) =>
        prev.map((item) =>
          item.normalizedMerchant === data.rule.normalizedPattern
            ? {
                ...item,
                friendlyName: data.rule.friendlyName,
                category: data.rule.category,
                scope: data.rule.defaultScope,
                mySharePct: data.rule.mySharePct,
                matchedRuleId: data.rule.id,
              }
            : item
        )
      );
      setStatusMessage(`Regra "${data.rule.friendlyName}" salva para futuras faturas.`);
    } catch {
      setStatusMessage("Não foi possível salvar a regra no Edge Local.");
    } finally {
      setSavingRuleId(null);
    }
  }

  async function persistMonth(status: "draft" | "closed") {
    setSavingAction(status);
    try {
      const res = await fetch(`/api/closings/${encodeURIComponent(month)}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          coupleSavedThisMonth: coupleSavedInput,
          coupleCheckinNotes: checkinNotesInput,
          transactions,
          futureInstallments,
        }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { closing: MonthlyClosing };
      setClosing(data.closing);
      dialogRef.current?.close();
      setStatusMessage(
        status === "closed"
          ? `Mês ${month} fechado e salvo no histórico (cifrado Zero-Knowledge).`
          : `Rascunho de ${month} salvo com sucesso.`
      );
    } catch {
      setStatusMessage("Não foi possível salvar a competência no Edge Local.");
    } finally {
      setSavingAction(null);
    }
  }

  async function handleAddCouplePlan() {
    if (!newPlanText.trim() || addingCouplePlan) return;
    setAddingCouplePlan(true);
    try {
      const res = await fetch("/api/couple-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newPlanText.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as { plan: CouplePlanNote };
        setCouplePlans((prev) => [data.plan, ...prev]);
        setNewPlanText("");
      }
    } catch {
      // Ignore offline error
    } finally {
      setAddingCouplePlan(false);
    }
  }

  async function handleTogglePlanDone(plan: CouplePlanNote) {
    if (togglingPlanId) return;
    const nextStatus = plan.status === "done" ? "active" : "done";
    setTogglingPlanId(plan.id);
    try {
      const res = await fetch(`/api/couple-plans/${encodeURIComponent(plan.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        setCouplePlans((prev) =>
          prev.map((p) => (p.id === plan.id ? { ...p, status: nextStatus } : p))
        );
      }
    } catch {
      // Ignore offline error
    } finally {
      setTogglingPlanId(null);
    }
  }

  const filteredTransactions = useMemo(() => {
    const term = filter.trim().toLowerCase();

    return transactions.filter((item) => {
      if (reviewFilter === "matched" && !isTxRecognized(item)) return false;
      if (reviewFilter === "unmatched" && isTxRecognized(item)) return false;
      if (!term) return true;

      return `${item.date} ${item.friendlyName} ${item.rawDescription} ${item.normalizedMerchant} ${item.category}`
        .toLowerCase()
        .includes(term);
    });
  }, [transactions, filter, reviewFilter]);

  const settlement = useMemo(() => {
    let totalCouple = 0;
    let netSettlement = 0;

    for (const tx of transactions) {
      if (tx.scope !== "couple") continue;
      totalCouple += tx.amount;
      const myPart = tx.amount * (tx.mySharePct / 100);
      const partnerPart = tx.amount - myPart;
      if (tx.paidBy === "partner") {
        netSettlement -= myPart;
      } else {
        netSettlement += partnerPart;
      }
    }

    return { totalCouple, netSettlement };
  }, [transactions]);

  const settlementText = formatSettlementLabel(settlement.netSettlement);

  const futureNextMonthTotal = useMemo(
    () => futureInstallments.reduce((sum, item) => sum + item.nextBillAmount, 0),
    [futureInstallments]
  );

  const unmatchedCount = useMemo(
    () => transactions.filter((tx) => !isTxRecognized(tx)).length,
    [transactions]
  );

  return (
    <>
      <section className="hero card">
        <div>
          <div className="transaction-meta">
            <p className="eyebrow">Competência mensal • Casal & Individual</p>
            {loadingMonth ? (
              <span className="pill">Carregando...</span>
            ) : (
              <span className={`pill ${closing?.status === "closed" ? "pill-success" : "pill-accent"}`}>
                {closing?.status === "closed" ? "Mês fechado" : "Em aberto"}
              </span>
            )}
          </div>
          <h1 id="conteudo-principal" tabIndex={-1}>
            Conferência mensal
          </h1>
          <p className="hero-text">
            Importe faturas (suas ou dela), registre contas da casa e feche o mês com o check-in de
            economias e planos do casal.
          </p>

          <div className="month-bar">
            <div className="field field-compact">
              <label htmlFor={monthInputId}>Mês de referência</label>
              <input
                id={monthInputId}
                type="month"
                value={month}
                onChange={(e) => onMonthChange(e.target.value)}
              />
            </div>

            <div className="toolbar-actions">
              {missingFixedExpenses.length > 0 && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleImportMissingFixed}
                >
                  Importar contas fixas (+{missingFixedExpenses.length})
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={savingMonth || loadingMonth}
                onClick={() => void persistMonth("draft")}
              >
                <LoadingButtonContent
                  loading={savingAction === "draft"}
                  loadingLabel="Salvando rascunho..."
                  idleLabel="Salvar rascunho"
                />
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={savingMonth || loadingMonth}
                onClick={() => dialogRef.current?.showModal()}
              >
                Fechar mês (Check-in)
              </button>
            </div>
          </div>
        </div>

        <div className="upload-column">
          <div className="toggle-group" role="group" aria-label="Quem pagou a fatura importada">
            <button
              type="button"
              aria-pressed={uploadPaidBy === "me"}
              onClick={() => setUploadPaidBy("me")}
            >
              Fatura: Eu paguei
            </button>
            <button
              type="button"
              aria-pressed={uploadPaidBy === "partner"}
              onClick={() => setUploadPaidBy("partner")}
            >
              Fatura: Ela pagou
            </button>
          </div>

          <label
            className={`upload-box ${isLoading ? "is-loading" : ""}`}
            htmlFor={fileInputId}
          >
            <span className="upload-icon" aria-hidden="true">
              {isLoading ? <LoadingSpinner size="md" decorative /> : "＋"}
            </span>
            <span>
              <strong>{isLoading ? "Processando PDF..." : "Selecionar PDF"}</strong>
              <small>Adiciona compras à competência {month} aplicando labels salvos</small>
            </span>
            <input
              id={fileInputId}
              className="visually-hidden"
              type="file"
              accept=".pdf,application/pdf"
              disabled={isLoading}
              onChange={handleFileChange}
            />
          </label>
        </div>
      </section>

      {loadingMonth && transactions.length === 0 ? (
        <SkeletonSummaryGrid
          highlightIndex={1}
          label={`Carregando competência ${month}...`}
        />
      ) : (
        <section className="summary-grid" aria-label="Resumo da conferência">
          <article className="result-card card">
            <span className="label">Total do Casal</span>
            <strong data-testid="couple-total">{formatBRL(settlement.totalCouple)}</strong>
            <small>Soma de todas as contas compartilhadas</small>
          </article>

          <article className="result-card highlight card">
            <span className="label">Acerto Líquido Final</span>
            <strong data-testid="each-pays">{settlementText.headline}</strong>
            <small>{settlementText.detail}</small>
          </article>

          <article className="result-card card">
            <span className="label">Lançamentos no mês</span>
            <strong data-testid="items-count">{transactions.length}</strong>
            <small>
              {fileName} {transactions.length > 0 ? `• ${unmatchedCount} nova(s)` : ""}
            </small>
          </article>

          <article className="result-card card">
            <span className="label">Parcelas próximas faturas</span>
            <strong data-testid="future-total">{formatBRL(futureNextMonthTotal)}</strong>
            <small>{futureInstallments.length} parcelamento(s) detectado(s)</small>
          </article>
        </section>
      )}

      <section className="card section-card compact-card">
        <h2>Adicionar conta da casa ou gasto manual (meu ou dela)</h2>
        <form className="inline-form" onSubmit={handleAddManualTransaction}>
          <div className="field">
            <label htmlFor="manual-desc">Descrição</label>
            <input
              id="manual-desc"
              type="text"
              required
              value={manualDesc}
              onChange={(e) => setManualDesc(e.target.value)}
              placeholder="Ex.: Aluguel, Internet, Mercado Pix..."
            />
          </div>
          <div className="field field-compact">
            <label htmlFor="manual-amount">Valor</label>
            <CurrencyInput
              id="manual-amount"
              required
              emptyWhenZero
              value={manualAmount}
              onChange={setManualAmount}
            />
          </div>
          <div className="field field-compact">
            <label htmlFor="manual-category">Categoria</label>
            <input
              id="manual-category"
              type="text"
              list={catListId}
              value={manualCategory}
              onChange={(e) => setManualCategory(e.target.value)}
            />
          </div>
          <div className="field field-compact">
            <label htmlFor="manual-paidby">Quem pagou</label>
            <select
              id="manual-paidby"
              value={manualPaidBy}
              onChange={(e) => setManualPaidBy(e.target.value as PaidBy)}
            >
              <option value="me">Eu paguei</option>
              <option value="partner">Ela pagou</option>
            </select>
          </div>
          <div className="field field-compact">
            <label htmlFor="manual-scope">Escopo</label>
            <select
              id="manual-scope"
              value={manualScope}
              onChange={(e) => setManualScope(e.target.value as TransactionScope)}
            >
              <option value="couple">Casal</option>
              <option value="individual">Individual</option>
            </select>
          </div>
          <button type="submit" className="secondary-button">
            Adicionar
          </button>
        </form>
      </section>

      {transactions.length > 0 && (
        <section className="toolbar card">
          <search className="search-field">
            <label htmlFor={searchInputId}>Filtrar compras</label>
            <input
              id={searchInputId}
              type="search"
              name="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Buscar por label, estabelecimento, categoria ou data..."
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </search>

          <div className="toolbar-actions">
            <div className="toggle-group" role="group" aria-label="Filtro de reconhecimento">
              <button
                type="button"
                aria-pressed={reviewFilter === "all"}
                onClick={() => setReviewFilter("all")}
              >
                Todas
              </button>
              <button
                type="button"
                aria-pressed={reviewFilter === "unmatched"}
                onClick={() => setReviewFilter("unmatched")}
              >
                Novas ({unmatchedCount})
              </button>
            </div>
            {unmatchedCount > 0 && (
              <button
                type="button"
                className="primary-button compact-button"
                disabled={suggestingAI}
                onClick={() => void handleSuggestLabelsWithAI()}
              >
                <LoadingButtonContent
                  loading={suggestingAI}
                  loadingLabel="Sugerindo..."
                  idleLabel="Sugerir labels com IA"
                />
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => updateAllScopes("couple")}
            >
              Tudo Casal
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => updateAllScopes("individual")}
            >
              Tudo Individual
            </button>
          </div>
        </section>
      )}

      {!loadingMonth && statusMessage && (
        <section className="message card" role="status" aria-live="polite">
          {statusMessage}
        </section>
      )}

      <datalist id={catListId}>
        {DEFAULT_CATEGORIES.map((cat) => (
          <option key={cat} value={cat} />
        ))}
      </datalist>

      {(loadingMonth || isLoading) && transactions.length === 0 ? (
        <SkeletonCardList
          count={3}
          label={isLoading ? "Lendo PDF e aplicando labels salvos..." : undefined}
        />
      ) : filteredTransactions.length > 0 ? (
        <ul className="transactions-list" role="list">
          {filteredTransactions.map((tx) => (
            <li key={tx.id}>
              <article className="transaction-card card">
                <div className="transaction-main">
                  <div className="transaction-meta">
                    <span className="pill">{tx.date}</span>
                    {tx.source === "fixed_copy" && (
                      <span className="pill pill-accent">Conta fixa</span>
                    )}
                    {tx.source === "fixed_copy" || tx.source === "manual" ? (
                      <button
                        type="button"
                        className="pill pill-button"
                        onClick={() =>
                          updateTx(tx.id, {
                            paidBy: tx.paidBy === "partner" ? "me" : "partner",
                          })
                        }
                      >
                        {tx.paidBy === "partner" ? "Pago por ela (trocar)" : "Pago por mim (trocar)"}
                      </button>
                    ) : (
                      <span className="pill">
                        {tx.paidBy === "partner" ? "Pago por ela" : "Pago por mim"}
                      </span>
                    )}
                    {tx.matchSource === "installment_history" ? (
                      <span className="pill pill-success">
                        Herdado da parcela {tx.matchedFromInstallment || "anterior"}
                      </span>
                    ) : (
                      tx.matchedRuleId && (
                        <span className="pill pill-success">Reconhecido automaticamente</span>
                      )
                    )}
                    {tx.installment && (
                      <span className="pill pill-accent">Parcela {tx.installment}</span>
                    )}
                    {tx.section === "international" && <span className="pill">Internacional</span>}
                  </div>

                  <div className="inline-edit-row">
                    <input
                      aria-label={`Nome amigável para ${tx.rawDescription}`}
                      className="tx-title-input"
                      type="text"
                      value={tx.friendlyName}
                      onChange={(e) => updateTx(tx.id, { friendlyName: e.target.value })}
                    />
                    <input
                      aria-label={`Categoria para ${tx.rawDescription}`}
                      className="tx-category-input"
                      type="text"
                      list={catListId}
                      placeholder="Categoria..."
                      value={tx.category}
                      onChange={(e) => updateTx(tx.id, { category: e.target.value })}
                    />
                  </div>

                  <p className="category">Original: {tx.rawDescription}</p>
                </div>

                <div className="transaction-side">
                  {tx.source === "fixed_copy" || tx.source === "manual" ? (
                    <div className="inline-amount-edit">
                      <CurrencyInput
                        ariaLabel={`Valor de ${tx.friendlyName}`}
                        value={tx.amount}
                        onChange={(val) => updateTx(tx.id, { amount: val })}
                      />
                    </div>
                  ) : (
                    <strong className="amount">{formatBRL(tx.amount)}</strong>
                  )}

                  <div className="side-controls">
                    <div
                      className="toggle-group"
                      role="group"
                      aria-label={`Classificação de ${tx.rawDescription}`}
                    >
                      <button
                        type="button"
                        aria-pressed={tx.scope === "individual"}
                        onClick={() => updateTx(tx.id, { scope: "individual" })}
                      >
                        Individual
                      </button>
                      <button
                        type="button"
                        aria-pressed={tx.scope === "couple"}
                        onClick={() => updateTx(tx.id, { scope: "couple" })}
                      >
                        Casal
                      </button>
                    </div>

                    {tx.scope === "couple" && (
                      <label className="share-pill">
                        <span>Meu %</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={tx.mySharePct}
                          onChange={(e) =>
                            updateTx(tx.id, {
                              mySharePct: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                            })
                          }
                        />
                      </label>
                    )}

                    <button
                      type="button"
                      className="secondary-button compact-button"
                      disabled={savingRuleId === tx.id}
                      onClick={() => void handleRememberRule(tx)}
                    >
                      <LoadingButtonContent
                        loading={savingRuleId === tx.id}
                        loadingLabel="Salvando..."
                        idleLabel={tx.matchedRuleId ? "Atualizar regra" : "Lembrar regra"}
                      />
                    </button>

                    <button
                      type="button"
                      className="danger-button compact-button"
                      onClick={() => removeTx(tx.id)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : null}

      {futureInstallments.length > 0 && (
        <section className="future-section card">
          <h2>Compras parceladas detectadas para próximas faturas</h2>
          <p className="category">
            Estes compromissos futuros alimentam o cálculo de comprometimento de renda.
          </p>
          <table className="data-table">
            <caption className="visually-hidden">
              Lista de compras parceladas para próximas faturas
            </caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Estabelecimento</th>
                <th scope="col">Parcela</th>
                <th scope="col">Próxima fatura</th>
                <th scope="col">Demais faturas</th>
              </tr>
            </thead>
            <tbody>
              {futureInstallments.map((item) => (
                <tr key={item.id}>
                  <td>{item.date}</td>
                  <td>{item.description}</td>
                  <td>{item.installment ?? "—"}</td>
                  <td>{formatBRL(item.nextBillAmount)}</td>
                  <td>{formatBRL(item.remainingAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <dialog ref={dialogRef} className="native-dialog" aria-labelledby={checkinTitleId}>
        <div className="dialog-content">
          <div className="section-header-row">
            <h2 id={checkinTitleId}>Check-in do Casal — Fechamento {month}</h2>
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => dialogRef.current?.close()}
            >
              Fechar
            </button>
          </div>

          <p className="category">
            Resumo do acerto: <strong>{settlementText.headline}</strong> ({settlementText.detail}).
          </p>

          <div className="stack-md">
            <div className="field">
              <label htmlFor={savedInputId}>
                Quanto vocês conseguiram guardar juntos nas economias em conjunto este mês?
              </label>
              <CurrencyInput
                id={savedInputId}
                value={coupleSavedInput}
                onChange={setCoupleSavedInput}
              />
            </div>

            <div className="field">
              <label htmlFor={newPlanId}>
                Planos do casal (texto livre para o assistente considerar no seu planejamento)
              </label>
              <div className="inline-edit-row">
                <input
                  id={newPlanId}
                  className="tx-title-input"
                  type="text"
                  value={newPlanText}
                  onChange={(e) => setNewPlanText(e.target.value)}
                  placeholder="Ex.: Viagem em julho, trocar geladeira, reserva mudança..."
                />
                <button
                  type="button"
                  className="secondary-button compact-button"
                  disabled={addingCouplePlan}
                  onClick={() => void handleAddCouplePlan()}
                >
                  <LoadingButtonContent
                    loading={addingCouplePlan}
                    loadingLabel="Adicionando..."
                    idleLabel="Adicionar plano"
                  />
                </button>
              </div>

              {couplePlans.length > 0 && (
                <ul className="plan-list" role="list">
                  {couplePlans.map((plan) => (
                    <li key={plan.id} className="plan-item">
                      <label className="plan-checkbox">
                        <input
                          type="checkbox"
                          disabled={togglingPlanId === plan.id}
                          checked={plan.status === "done"}
                          onChange={() => void handleTogglePlanDone(plan)}
                        />
                        <span className={plan.status === "done" ? "line-through" : ""}>
                          {plan.text}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="field">
              <label htmlFor={notesInputId}>Anotações da conferência (opcional)</label>
              <textarea
                id={notesInputId}
                rows={3}
                value={checkinNotesInput}
                onChange={(e) => setCheckinNotesInput(e.target.value)}
                placeholder="Combinados do mês, gastos fora do padrão..."
              />
            </div>

            <div className="toolbar-actions">
              <button
                type="button"
                className="primary-button"
                disabled={savingMonth}
                onClick={() => void persistMonth("closed")}
              >
                <LoadingButtonContent
                  loading={savingAction === "closed"}
                  loadingLabel="Fechando mês..."
                  idleLabel="Confirmar fechamento do mês"
                />
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => dialogRef.current?.close()}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
