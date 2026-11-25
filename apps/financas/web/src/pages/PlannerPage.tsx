import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import type {
  CouplePlanNote,
  PlannedPurchase,
  SafetyIndicators,
  TransactionScope,
} from "@financas/shared";
import { CurrencyInput } from "../components/CurrencyInput";
import {
  LoadingButtonContent,
  LoadingSpinner,
  SkeletonCardList,
  SkeletonFormGrid,
  SkeletonListLines,
  SkeletonSummaryGrid,
} from "../components/Loading";
import { formatBRL } from "../lib/format";

interface ViableOption {
  kind: "cash_checking" | "installments" | "save_first";
  recommended: boolean;
  title: string;
  detail: string;
}

interface SimulationOutput {
  myTotalCost: number;
  monthlyInstallmentImpact: number;
  checkingDrawdown: number;
  checkingRemainingAfterCash: number;
  reserveDrawdown: number;
  reserveGapToTarget: number;
  cashPaymentRunwayMonths: number;
  installmentCommitmentPct: number;
  remainingSafeMarginAfterInstallment: number;
  monthsToSaveComfortably: number;
  verdict: "buy_now" | "installments" | "save_first" | "wait";
  viableOptions?: ViableOption[];
  reasons: string[];
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

const VERDICT_LABELS: Record<SimulationOutput["verdict"], { label: string; cls: string }> = {
  buy_now: { label: "Pode comprar à vista", cls: "pill-success" },
  installments: { label: "Viável parcelado", cls: "pill-accent" },
  save_first: { label: "Juntar antes", cls: "pill-warn" },
  wait: { label: "Adiar por segurança", cls: "pill-danger" },
};

export function PlannerPage() {
  const [purchases, setPurchases] = useState<PlannedPurchase[]>([]);
  const [couplePlans, setCouplePlans] = useState<CouplePlanNote[]>([]);
  const [interestsText, setInterestsText] = useState("");
  const [indicators, setIndicators] = useState<SafetyIndicators | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // Mutation busy states
  const [savingInterests, setSavingInterests] = useState(false);
  const [addingCouplePlan, setAddingCouplePlan] = useState(false);
  const [addingPurchase, setAddingPurchase] = useState(false);
  const [simulatingId, setSimulatingId] = useState<string | null>(null);
  const [updatingPurchaseId, setUpdatingPurchaseId] = useState<string | null>(null);
  const [deletingPurchaseId, setDeletingPurchaseId] = useState<string | null>(null);

  // New purchase form
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState(0);
  const [installments, setInstallments] = useState(1);
  const [scope, setScope] = useState<TransactionScope>("individual");
  const [urgency, setUrgency] = useState(3);
  const [desireImpact, setDesireImpact] = useState(4);
  const [notes, setNotes] = useState("");

  // New couple plan
  const [newCouplePlan, setNewCouplePlan] = useState("");

  // Simulator
  const [selectedSimTitle, setSelectedSimTitle] = useState("");
  const [simulation, setSimulation] = useState<SimulationOutput | null>(null);

  // AI prioritization & chat
  const [aiSummary, setAiSummary] = useState("");
  const [prioritizing, setPrioritizing] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatting, setChatting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [purchasesRes, plansRes, safetyRes] = await Promise.all([
        fetch("/api/planner/purchases"),
        fetch("/api/couple-plans"),
        fetch("/api/safety/overview"),
      ]);

      if (purchasesRes.ok) {
        const d = (await purchasesRes.json()) as { purchases: PlannedPurchase[] };
        setPurchases(d.purchases);
      }
      if (plansRes.ok) {
        const d = (await plansRes.json()) as { plans: CouplePlanNote[] };
        setCouplePlans(d.plans);
      }
      if (safetyRes.ok) {
        const d = (await safetyRes.json()) as {
          indicators: SafetyIndicators;
          reserve?: { checkingBalance?: number };
          profile: { interestsAndGoalsText?: string };
        };
        setIndicators(d.indicators);
        setCheckingBalance(d.reserve?.checkingBalance ?? 0);
        setInterestsText(d.profile?.interestsAndGoalsText || "");
      }
    } catch {
      // Ignore offline test mode
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleSaveInterests(event: FormEvent) {
    event.preventDefault();
    if (savingInterests) return;
    setSavingInterests(true);
    setStatusMessage("");
    try {
      const res = await fetch("/api/safety/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interestsAndGoalsText: interestsText }),
      });
      if (res.ok) {
        setStatusMessage("Perfil de interesses e objetivos salvo (cifrado).");
      } else {
        setStatusMessage("Não foi possível salvar seu perfil de interesses.");
      }
    } catch {
      setStatusMessage("Falha ao salvar perfil de interesses.");
    } finally {
      setSavingInterests(false);
    }
  }

  async function handleAddCouplePlan(event: FormEvent) {
    event.preventDefault();
    if (!newCouplePlan.trim() || addingCouplePlan) return;
    setAddingCouplePlan(true);
    try {
      const res = await fetch("/api/couple-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newCouplePlan.trim() }),
      });
      if (res.ok) {
        setNewCouplePlan("");
        await loadAll();
      }
    } catch {
      setStatusMessage("Falha ao adicionar plano do casal.");
    } finally {
      setAddingCouplePlan(false);
    }
  }

  async function handleAddPurchase(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !Number.isFinite(price) || price <= 0 || addingPurchase) return;

    setAddingPurchase(true);
    setStatusMessage("");
    try {
      const res = await fetch("/api/planner/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          estimatedPrice: price,
          defaultInstallments: installments,
          scope,
          urgency,
          desireImpact,
          notes: notes.trim(),
        }),
      });

      if (res.ok) {
        setTitle("");
        setPrice(0);
        setInstallments(1);
        setNotes("");
        setStatusMessage("Compra adicionada ao backlog de planejamento.");
        await loadAll();
      } else {
        setStatusMessage("Não foi possível adicionar a compra.");
      }
    } catch {
      setStatusMessage("Falha ao adicionar compra ao planejamento.");
    } finally {
      setAddingPurchase(false);
    }
  }

  async function handleSimulateItem(item: PlannedPurchase) {
    setSimulatingId(item.id);
    setSelectedSimTitle(item.title);
    try {
      const res = await fetch("/api/safety/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title,
          price: item.estimatedPrice,
          installments: item.defaultInstallments,
          scope: item.scope,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { simulation: SimulationOutput };
        setSimulation(data.simulation);
      } else {
        setStatusMessage("Não foi possível simular esta compra.");
      }
    } catch {
      setStatusMessage("Falha ao simular impacto da compra.");
    } finally {
      setSimulatingId(null);
    }
  }

  async function handleMarkStatus(item: PlannedPurchase, status: PlannedPurchase["status"]) {
    setUpdatingPurchaseId(item.id);
    try {
      const res = await fetch(`/api/planner/purchases/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) await loadAll();
    } catch {
      setStatusMessage("Falha ao atualizar status da compra.");
    } finally {
      setUpdatingPurchaseId(null);
    }
  }

  async function handleDeletePurchase(id: string) {
    setDeletingPurchaseId(id);
    try {
      const res = await fetch(`/api/planner/purchases/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) await loadAll();
    } catch {
      setStatusMessage("Falha ao remover compra.");
    } finally {
      setDeletingPurchaseId(null);
    }
  }

  async function handlePrioritizeWithAI() {
    setPrioritizing(true);
    setStatusMessage("");
    try {
      const res = await fetch("/api/ai/prioritize", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatusMessage(data.error || "Não foi possível priorizar com IA. Verifique a chave em Configurações.");
        return;
      }
      setAiSummary(data.summary || "");
      if (Array.isArray(data.purchases)) {
        setPurchases(data.purchases);
      }
      setStatusMessage(`Priorização atualizada via ${data.provider} (${data.model}).`);
    } catch {
      setStatusMessage("Falha de comunicação com o Gateway de IA local.");
    } finally {
      setPrioritizing(false);
    }
  }

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || chatting) return;

    const nextHistory: ChatMessage[] = [...chatHistory, { role: "user", text }];
    setChatHistory(nextHistory);
    setChatInput("");
    setChatting(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: chatHistory }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatHistory((prev) => [
          ...prev,
          { role: "assistant", text: `Erro: ${data.error || "Configure seu provedor de IA em Configurações."}` },
        ]);
      } else {
        setChatHistory((prev) => [...prev, { role: "assistant", text: data.reply }]);
      }
    } catch {
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", text: "Não foi possível falar com o Gateway de IA local." },
      ]);
    } finally {
      setChatting(false);
    }
  }

  function handleChatKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendChatMessage();
    }
  }

  const initialLoading = loading && !hasLoaded;

  return (
    <div className="stack-lg">
      <section className="card section-card">
        <div className="section-header-row">
          <div>
            <p className="eyebrow">Assistente Pessoal • Finanças + Interesses + Planos do Casal</p>
            <h1 id="conteudo-principal" tabIndex={-1}>
              Planejador de Próximas Compras
            </h1>
            <p className="hero-text">
              Cadastre seus desejos, simule o impacto matemático real nos 4 indicadores de segurança
              e peça à IA para priorizar considerando seus interesses e os planos do casal.
            </p>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={prioritizing || initialLoading}
            onClick={() => void handlePrioritizeWithAI()}
          >
            <LoadingButtonContent
              loading={prioritizing}
              loadingLabel="Analisando com IA..."
              idleLabel="Priorizar lista com IA"
            />
          </button>
        </div>

        {initialLoading ? (
          <SkeletonSummaryGrid
            highlightIndex={1}
            label="Carregando indicadores e backlog de compras..."
          />
        ) : indicators ? (
          <div className="summary-grid">
            <article className="result-card card">
              <span className="label">Runway atual</span>
              <strong>{indicators.runwayMonths.toFixed(1)} meses</strong>
              <small>Reserva líquida de segurança</small>
            </article>
            <article className="result-card highlight card">
              <span className="label">Margem Segura Livre</span>
              <strong>{formatBRL(indicators.safeFreeMargin)}</strong>
              <small>
                Saldo em conta: {formatBRL(checkingBalance)} • Disponível/mês para compras
              </small>
            </article>
            <article className="result-card card">
              <span className="label">Comprometimento</span>
              <strong>{indicators.incomeCommitmentPct.toFixed(0)}%</strong>
              <small>Fixos + parcelas comprometidas</small>
            </article>
            <article className="result-card card">
              <span className="label">Planos ativos do casal</span>
              <strong>{couplePlans.filter((p) => p.status === "active").length}</strong>
              <small>Sempre respeitados nas decisões</small>
            </article>
          </div>
        ) : null}

        {aiSummary && (
          <div className="audit-banner" role="status" aria-live="polite">
            <strong>Parecer da IA:</strong> {aiSummary}
          </div>
        )}

        {statusMessage && (
          <p className="status-inline" role="status" aria-live="polite">
            {statusMessage}
          </p>
        )}
      </section>

      <div className="two-col-grid">
        <section className="card section-card">
          <h2>Meus interesses e prioridades pessoais</h2>
          {initialLoading ? (
            <SkeletonFormGrid fields={1} tallField />
          ) : (
            <form className="stack-md" onSubmit={handleSaveInterests}>
              <div className="field">
                <label htmlFor="interests-text">
                  O que importa para você agora? (hobbies, setup, qualidade de vida, objetivos)
                </label>
                <textarea
                  id="interests-text"
                  rows={4}
                  value={interestsText}
                  onChange={(e) => setInterestsText(e.target.value)}
                  placeholder="Ex.: Melhorar ergonomia do home office, praticar música, montar meu servidor local (homelab), evitar dívidas longas..."
                />
              </div>
              <button type="submit" className="secondary-button" disabled={savingInterests}>
                <LoadingButtonContent
                  loading={savingInterests}
                  loadingLabel="Salvando perfil..."
                  idleLabel="Salvar perfil de interesses"
                />
              </button>
            </form>
          )}
        </section>

        <section className="card section-card">
          <h2>Planos ativos do casal (texto livre)</h2>
          <form className="inline-form" onSubmit={handleAddCouplePlan}>
            <div className="field">
              <label htmlFor="planner-couple-plan">Adicionar plano do casal</label>
              <input
                id="planner-couple-plan"
                type="text"
                value={newCouplePlan}
                onChange={(e) => setNewCouplePlan(e.target.value)}
                placeholder="Ex.: Viagem em outubro, trocar sofá..."
              />
            </div>
            <button type="submit" className="secondary-button" disabled={addingCouplePlan}>
              <LoadingButtonContent
                loading={addingCouplePlan}
                loadingLabel="Adicionando..."
                idleLabel="Adicionar"
              />
            </button>
          </form>

          {initialLoading ? (
            <SkeletonListLines count={2} />
          ) : couplePlans.length > 0 ? (
            <ul className="plan-list" role="list">
              {couplePlans
                .filter((p) => p.status === "active")
                .map((plan) => (
                  <li key={plan.id} className="plan-item">
                    <span className="pill pill-accent">Casal</span>
                    <span>{plan.text}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="category">Nenhum plano do casal cadastrado ainda.</p>
          )}
        </section>
      </div>

      <section className="card section-card">
        <h2>Adicionar próxima compra desejada</h2>
        <form className="inline-form" onSubmit={handleAddPurchase}>
          <div className="field">
            <label htmlFor="buy-title">Item desejado</label>
            <input
              id="buy-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Mini PC para servidor local, Cadeira ergonômica..."
            />
          </div>
          <div className="field field-compact">
            <label htmlFor="buy-price">Preço estimado</label>
            <CurrencyInput
              id="buy-price"
              required
              emptyWhenZero
              value={price}
              onChange={setPrice}
            />
          </div>
          <div className="field field-compact">
            <label htmlFor="buy-inst">Parcelas (x)</label>
            <input
              id="buy-inst"
              type="number"
              min={1}
              max={24}
              value={installments}
              onChange={(e) => setInstallments(Number(e.target.value))}
            />
          </div>
          <div className="field field-compact">
            <label htmlFor="buy-scope">Escopo</label>
            <select
              id="buy-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as TransactionScope)}
            >
              <option value="individual">Individual</option>
              <option value="couple">Casal (50/50)</option>
            </select>
          </div>
          <div className="field field-compact">
            <label htmlFor="buy-urg">Urgência (1-5)</label>
            <input
              id="buy-urg"
              type="number"
              min={1}
              max={5}
              value={urgency}
              onChange={(e) => setUrgency(Number(e.target.value))}
            />
          </div>
          <div className="field field-compact">
            <label htmlFor="buy-des">Impacto/Desejo (1-5)</label>
            <input
              id="buy-des"
              type="number"
              min={1}
              max={5}
              value={desireImpact}
              onChange={(e) => setDesireImpact(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="buy-notes">Notas (opcional)</label>
            <input
              id="buy-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Motivo ou observação..."
            />
          </div>
          <button type="submit" className="primary-button" disabled={addingPurchase}>
            <LoadingButtonContent
              loading={addingPurchase}
              loadingLabel="Adicionando..."
              idleLabel="Adicionar à lista"
            />
          </button>
        </form>
      </section>

      {simulation && (
        <section className="card section-card audit-banner" aria-live="polite">
          <div className="section-header-row">
            <h2>Simulação matemática: {selectedSimTitle}</h2>
            <span className={`pill ${VERDICT_LABELS[simulation.verdict].cls}`}>
              {VERDICT_LABELS[simulation.verdict].label}
            </span>
          </div>
          <p className="category">
            Meu custo total: <strong>{formatBRL(simulation.myTotalCost)}</strong> • Parcela mensal:{" "}
            <strong>{formatBRL(simulation.monthlyInstallmentImpact)}</strong> • Uso da conta
            corrente se à vista: <strong>{formatBRL(simulation.checkingDrawdown ?? 0)}</strong> •
            Uso da reserva se à vista: <strong>{formatBRL(simulation.reserveDrawdown)}</strong> •
            Runway se à vista: <strong>{simulation.cashPaymentRunwayMonths.toFixed(1)} meses</strong>{" "}
            • Comprometimento se parcelado:{" "}
            <strong>{simulation.installmentCommitmentPct.toFixed(0)}%</strong>
            {simulation.reserveGapToTarget > 0 ? (
              <>
                {" "}
                • Falta p/ meta de reserva:{" "}
                <strong>{formatBRL(simulation.reserveGapToTarget)}</strong>
              </>
            ) : null}
          </p>
          {simulation.viableOptions && simulation.viableOptions.length > 0 && (
            <ul className="viable-options-list" role="list">
              {simulation.viableOptions.map((opt) => (
                <li
                  key={opt.kind}
                  className={`viable-option-item ${opt.recommended ? "is-primary" : ""}`.trim()}
                >
                  <span className={`pill ${opt.recommended ? "pill-success" : "pill-accent"}`}>
                    {opt.recommended ? "Opção principal" : "Opção viável"}
                  </span>
                  <strong>{opt.title}:</strong>
                  <span>{opt.detail}</span>
                </li>
              ))}
            </ul>
          )}
          <ul>
            {simulation.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="card section-card">
        <div className="button-content">
          <h2>Backlog de compras ({purchases.length})</h2>
          {loading && hasLoaded && <LoadingSpinner size="sm" label="Atualizando backlog" />}
        </div>
        {initialLoading ? (
          <SkeletonCardList count={3} />
        ) : purchases.length === 0 ? (
          <p className="category">Cadastre suas próximas compras acima para simular e priorizar.</p>
        ) : (
          <ul className="transactions-list" role="list">
            {purchases.map((item) => (
              <li key={item.id}>
                <article className="transaction-card card">
                  <div className="transaction-main">
                    <div className="transaction-meta">
                      {item.aiAssessment && (
                        <span className="pill pill-accent">
                          #{item.aiAssessment.recommendedRank} Prioridade IA
                        </span>
                      )}
                      {item.aiAssessment && (
                        <span className={`pill ${VERDICT_LABELS[item.aiAssessment.verdict].cls}`}>
                          {VERDICT_LABELS[item.aiAssessment.verdict].label}
                        </span>
                      )}
                      <span className="pill">
                        {item.scope === "couple" ? "Casal" : "Individual"}
                      </span>
                      <span className="pill">
                        Urgência {item.urgency}/5 • Impacto {item.desireImpact}/5
                      </span>
                      {item.status === "bought" && <span className="pill pill-success">Comprado</span>}
                    </div>
                    <h2>{item.title}</h2>
                    {item.notes && <p className="category">{item.notes}</p>}
                    {item.aiAssessment && (
                      <p className="category">
                        <strong>IA ({item.aiAssessment.suggestedMonth || "Recomendação"}):</strong>{" "}
                        {item.aiAssessment.rationale}
                      </p>
                    )}
                  </div>

                  <div className="transaction-side">
                    <strong className="amount">{formatBRL(item.estimatedPrice)}</strong>
                    <small className="category">
                      {item.defaultInstallments > 1
                        ? `em ${item.defaultInstallments}x de ${formatBRL(item.estimatedPrice / item.defaultInstallments)}`
                        : "à vista"}
                    </small>
                    <div className="side-controls">
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        disabled={simulatingId === item.id}
                        onClick={() => void handleSimulateItem(item)}
                      >
                        <LoadingButtonContent
                          loading={simulatingId === item.id}
                          loadingLabel="Simulando..."
                          idleLabel="Simular impacto"
                        />
                      </button>
                      {item.status !== "bought" && (
                        <button
                          type="button"
                          className="secondary-button compact-button"
                          disabled={updatingPurchaseId === item.id || deletingPurchaseId === item.id}
                          onClick={() => void handleMarkStatus(item, "bought")}
                        >
                          <LoadingButtonContent
                            loading={updatingPurchaseId === item.id}
                            loadingLabel="Atualizando..."
                            idleLabel="Marcar comprado"
                          />
                        </button>
                      )}
                      <button
                        type="button"
                        className="danger-button compact-button"
                        disabled={deletingPurchaseId === item.id || updatingPurchaseId === item.id}
                        onClick={() => void handleDeletePurchase(item.id)}
                      >
                        <LoadingButtonContent
                          loading={deletingPurchaseId === item.id}
                          loadingLabel="Removendo..."
                          idleLabel="Remover"
                        />
                      </button>
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card section-card">
        <h2>Assistente de Planejamento (Chat Local)</h2>
        <p className="category">
          Pergunte qualquer coisa sobre suas compras, parcelas, reserva ou equilíbrio com os planos
          do casal.
        </p>

        <div className="chat-log" aria-live="polite">
          {chatHistory.length === 0 ? (
            <p className="category">
              Exemplos: &ldquo;Posso comprar o mini PC este mês sem atrapalhar os planos do
              casal?&rdquo; ou &ldquo;Qual a melhor ordem para os itens da minha lista?&rdquo;
            </p>
          ) : (
            chatHistory.map((msg, idx) => (
              <div key={idx} className={`chat-bubble chat-${msg.role}`}>
                <strong>{msg.role === "user" ? "Você" : "Assistente IA"}</strong>
                <p>{msg.text}</p>
              </div>
            ))
          )}
          {chatting && (
            <div className="chat-bubble chat-assistant">
              <strong>Assistente IA</strong>
              <div className="loading-indicator-row">
                <LoadingSpinner size="sm" label="Assistente IA formulando resposta" />
                <span>Analisando seus números e planos...</span>
              </div>
            </div>
          )}
        </div>

        <div className="inline-edit-row">
          <input
            aria-label="Pergunta para o assistente financeiro"
            className="tx-title-input"
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleChatKeyDown}
            placeholder="Digite sua dúvida de planejamento..."
          />
          <button
            type="button"
            className="primary-button"
            disabled={chatting}
            onClick={() => void sendChatMessage()}
          >
            <LoadingButtonContent
              loading={chatting}
              loadingLabel="Pensando..."
              idleLabel="Enviar"
            />
          </button>
        </div>
      </section>
    </div>
  );
}
