// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ParsedBillResult } from "@financas/shared";
import { App } from "./App";

const MOCK_BILL: ParsedBillResult = {
  adapterId: "itau-pdf",
  transactions: [
    {
      id: "001",
      date: "02/11",
      description: "SUPERMERCADO EXEMPLO",
      normalizedMerchant: "supermercado exemplo",
      category: "",
      amount: 300,
      section: "national",
    },
    {
      id: "002",
      date: "05/11",
      description: "CAFE INDIVIDUAL",
      normalizedMerchant: "cafe individual",
      category: "",
      amount: 50,
      section: "national",
    },
  ],
  futureInstallments: [
    {
      id: "fut-001",
      date: "10/09",
      description: "SOFA SALA 03/10",
      normalizedMerchant: "sofa sala",
      installment: "03/10",
      nextBillAmount: 200,
      remainingAmount: 1400,
    },
  ],
};

describe("Finanças Web App (Fase 0)", () => {
  it("renders navigation with aria-current and lets user upload PDF and split couple expenses", async () => {
    const parser = vi.fn().mockResolvedValue(MOCK_BILL);
    render(<App pdfParser={parser} />);

    expect(screen.getByRole("button", { name: "Conferência" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    const fileInput = screen.getByLabelText(/Selecionar PDF/i);
    const pdfFile = new File(["%PDF-1.4"], "fatura-nov.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(fileInput, { target: { files: [pdfFile] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("SUPERMERCADO EXEMPLO")).toBeInTheDocument();
    });

    // Inline rename works
    const renameInput = screen.getByDisplayValue("SUPERMERCADO EXEMPLO");
    fireEvent.change(renameInput, { target: { value: "Supermercado do Mês" } });
    expect(screen.getByDisplayValue("Supermercado do Mês")).toBeInTheDocument();

    expect(screen.getByTestId("items-count")).toHaveTextContent("2");
    expect(screen.getByTestId("future-total").textContent).toContain("200,00");

    // Mark first transaction as Casal
    const coupleButtons = screen.getAllByRole("button", { name: "Casal" });
    fireEvent.click(coupleButtons[0]);

    expect(screen.getByTestId("couple-total").textContent).toContain("300,00");
    expect(screen.getByTestId("each-pays").textContent).toContain("150,00");

    // Switch tab updates aria-current and heading
    fireEvent.click(screen.getByRole("button", { name: "Planejador IA" }));
    expect(screen.getByRole("button", { name: "Planejador IA" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Planejador de Próximas Compras"
    );
  });
});
