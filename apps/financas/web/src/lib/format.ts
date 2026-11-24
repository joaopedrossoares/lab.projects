const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(value: number): string {
  return brlFormatter.format(Number.isFinite(value) ? value : 0);
}

/**
 * Parses Brazilian or US numeric money input safely.
 * Examples:
 *  - "15.000,50" -> 15000.5
 *  - "R$ 1.250,00" -> 1250
 *  - "15000,5" -> 15000.5
 *  - "15.000" -> 15000
 *  - "1500.50" -> 1500.5
 */
export function parseMoneyInput(raw: string): number {
  const cleaned = raw.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return 0;

  if (cleaned.includes(",")) {
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : 0;
  }

  // Thousands-separated integer like "15.000" or "1.200.000"
  if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    const value = Number(cleaned.replace(/\./g, ""));
    return Number.isFinite(value) ? value : 0;
  }

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}
