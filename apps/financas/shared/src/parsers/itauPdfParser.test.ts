import { describe, expect, it } from "vitest";
import {
  extractInstallmentTag,
  groupTextItemsIntoLines,
  itauPdfParser,
  normalizeMerchantKey,
  parseItauCreditCardBill,
} from "../index.js";

const SYNTHETIC_ITAU_BILL = `
Lançamentos: compras e saques
DATA ESTABELECIMENTO VALOR EM R$
02/11 MP *PADARIA CENTRAL 45,90
03/11 SUPERMERCADO EXEMPLO 312,50
04/11 LOJA PERFUMES 08/10 89,90
04/11 LOJA PERFUMES 08/10 89,90
05/11 PAGAMENTO EFETUADO 1.500,00
06/11 RESTAURANTE BISTRO 140,00 07/11 FARMACIA SAUDE 52,30
Total dos lançamentos atuais 640,60

Lançamentos internacionais
DATA ESTABELECIMENTO US$ R$
10/11 CLOUD SERVICE INC 10,00 58,40
Repasse de IOF 2,56
Total transações internacionais 60,96

Compras parceladas - próximas faturas
DATA ESTABELECIMENTO PRÓXIMA FATURA DEMAIS FATURAS
04/03 LOJA PERFUMES 09/10 89,90 89,90
12/08 MOVEIS CASA NOVA 04/12 250,00 2.000,00
Total para próximas faturas 339,90 2.089,90
`;

describe("normalizeMerchantKey & extractInstallmentTag", () => {
  it("strips aggregator prefixes and installment tags", () => {
    expect(normalizeMerchantKey("MP *PADARIA CENTRAL 02/10")).toBe("padaria central");
    expect(normalizeMerchantKey("PG *Restaurante Café")).toBe("restaurante cafe");
  });

  it("extracts valid installment tags and ignores invalid ones", () => {
    expect(extractInstallmentTag("LOJA PERFUMES 08/10")).toBe("08/10");
    expect(extractInstallmentTag("COMPRA SIMPLES 15/11")).toBeUndefined();
    expect(extractInstallmentTag("SEM PARCELA")).toBeUndefined();
  });
});

describe("parseItauCreditCardBill", () => {
  it("parses national, international, inline multiple dates, dedupes, and ignores payments/IOF", () => {
    const result = parseItauCreditCardBill(SYNTHETIC_ITAU_BILL);

    expect(result.adapterId).toBe("itau-pdf");
    expect(result.transactions).toHaveLength(6);

    expect(result.transactions[0]).toMatchObject({
      date: "02/11",
      description: "MP *PADARIA CENTRAL",
      normalizedMerchant: "padaria central",
      amount: 45.9,
      section: "national",
    });

    expect(result.transactions[2]).toMatchObject({
      date: "04/11",
      description: "LOJA PERFUMES 08/10",
      normalizedMerchant: "loja perfumes",
      amount: 89.9,
      installment: "08/10",
      section: "national",
    });

    // Two transactions on the same line
    expect(result.transactions[3]).toMatchObject({
      date: "06/11",
      description: "RESTAURANTE BISTRO",
      amount: 140,
    });
    expect(result.transactions[4]).toMatchObject({
      date: "07/11",
      description: "FARMACIA SAUDE",
      amount: 52.3,
    });

    // International section
    expect(result.transactions[5]).toMatchObject({
      date: "10/11",
      description: "CLOUD SERVICE INC",
      amount: 58.4,
      section: "international",
    });
  });

  it("extracts future installments from 'Compras parceladas - próximas faturas'", () => {
    const result = itauPdfParser.parseText(SYNTHETIC_ITAU_BILL);

    expect(result.futureInstallments).toHaveLength(2);
    expect(result.futureInstallments[0]).toMatchObject({
      date: "04/03",
      description: "LOJA PERFUMES 09/10",
      normalizedMerchant: "loja perfumes",
      installment: "09/10",
      nextBillAmount: 89.9,
      remainingAmount: 89.9,
    });
    expect(result.futureInstallments[1]).toMatchObject({
      date: "12/08",
      description: "MOVEIS CASA NOVA 04/12",
      normalizedMerchant: "moveis casa nova",
      installment: "04/12",
      nextBillAmount: 250,
      remainingAmount: 2000,
    });
  });

  it("groups two-column PDF text items into ordered lines", () => {
    const text = groupTextItemsIntoLines([
      { str: "02/11", transform: [1, 0, 0, 1, 40, 700] },
      { str: "PADARIA", transform: [1, 0, 0, 1, 90, 700] },
      { str: "45,90", transform: [1, 0, 0, 1, 220, 700] },
      { str: "03/11", transform: [1, 0, 0, 1, 360, 700] },
      { str: "MERCADO", transform: [1, 0, 0, 1, 410, 700] },
      { str: "120,00", transform: [1, 0, 0, 1, 520, 700] },
    ]);

    expect(text).toBe("02/11 PADARIA 45,90\n03/11 MERCADO 120,00");
  });
});
