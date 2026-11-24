import { useEffect, useState } from "react";
import type { ParsedBillResult } from "@financas/shared";
import { CashflowSafetyPage } from "./pages/CashflowSafetyPage";
import { ConferencePage } from "./pages/ConferencePage";
import { HistoryPage } from "./pages/HistoryPage";
import { LabelsPage } from "./pages/LabelsPage";
import { PlannerPage } from "./pages/PlannerPage";
import { SettingsPage } from "./pages/SettingsPage";

type PageKey = "conference" | "labels" | "safety" | "planner" | "history" | "settings";

interface NavItem {
  key: PageKey;
  label: string;
  title: string;
  phaseHint: string;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    key: "conference",
    label: "Conferência",
    title: "Conferência Mensal",
    phaseHint: "Ativa na Fase 0",
    description: "Leitura de fatura PDF e divisão Individual / Casal.",
  },
  {
    key: "labels",
    label: "Labels",
    title: "Labels & Regras Salvas",
    phaseHint: "Previsto na Fase 2",
    description:
      "Renomeie estabelecimentos, atribua categorias e memorize regras automáticas para faturas futuras.",
  },
  {
    key: "safety",
    label: "Fluxo & Segurança",
    title: "Fluxo de Caixa e Segurança Financeira",
    phaseHint: "Previsto na Fase 4",
    description:
      "Receitas/fixos recorrentes, avulsos, reservas e os 4 indicadores configuráveis (Runway, Poupança, Comprometimento e Margem Segura).",
  },
  {
    key: "planner",
    label: "Planejador IA",
    title: "Planejador de Próximas Compras",
    phaseHint: "Previsto na Fase 5",
    description:
      "Backlog de compras desejadas, interesses pessoais, planos do casal, simulador de impacto e assistente com IA via tools internas.",
  },
  {
    key: "history",
    label: "Histórico",
    title: "Histórico de Fechamentos",
    phaseHint: "Previsto na Fase 3",
    description:
      "Snapshot mensal salvo com acerto líquido do casal, economias conjuntas e evolução mês a mês.",
  },
  {
    key: "settings",
    label: "Configurações",
    title: "Configurações, Privacidade & IA",
    phaseHint: "Fases 1 e 5",
    description:
      "Conexão Zero-Knowledge com o backend na Railway, auditoria de dados cifrados, backup local e seleção de provedor/chave de IA.",
  },
];

interface AppProps {
  pdfParser?: (file: File) => Promise<ParsedBillResult>;
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function App({ pdfParser }: AppProps) {
  const [activePage, setActivePage] = useState<PageKey>("conference");
  const [selectedMonth, setSelectedMonth] = useState<string>(currentYearMonth);

  const currentNav = NAV_ITEMS.find((item) => item.key === activePage) ?? NAV_ITEMS[0];

  useEffect(() => {
    document.title = `${currentNav.label} | Finanças Casal`;
  }, [currentNav.label]);

  function handleOpenMonthFromHistory(month: string) {
    setSelectedMonth(month);
    setActivePage("conference");
  }

  return (
    <>
      <a href="#conteudo-principal" className="skip-link visually-hidden">
        Pular para o conteúdo principal
      </a>

      <header className="site-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-badge" aria-hidden="true">
              R$
            </span>
            <span>Finanças Casal</span>
          </div>

          <nav className="site-nav" aria-label="Principal">
            <ul>
              {NAV_ITEMS.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className="nav-button"
                    aria-current={activePage === item.key ? "page" : undefined}
                    onClick={() => setActivePage(item.key)}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main className="app-shell">
        {activePage === "conference" ? (
          <ConferencePage
            month={selectedMonth}
            onMonthChange={setSelectedMonth}
            pdfParser={pdfParser}
          />
        ) : activePage === "labels" ? (
          <LabelsPage />
        ) : activePage === "safety" ? (
          <CashflowSafetyPage />
        ) : activePage === "planner" ? (
          <PlannerPage />
        ) : activePage === "history" ? (
          <HistoryPage onOpenMonth={handleOpenMonthFromHistory} />
        ) : (
          <SettingsPage />
        )}
      </main>
    </>
  );
}
