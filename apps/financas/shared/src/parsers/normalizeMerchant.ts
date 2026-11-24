export function simplifyText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function extractInstallmentTag(description: string): string | undefined {
  const match = description.match(/\b(\d{2}\/\d{2})\b/);
  if (!match) return undefined;

  const [currentStr, totalStr] = match[1].split("/");
  const current = Number(currentStr);
  const total = Number(totalStr);

  if (!Number.isFinite(current) || !Number.isFinite(total)) return undefined;
  if (current < 1 || total < 2 || current > total || total > 48) return undefined;

  return match[1];
}

/**
 * Normalizes noisy credit-card merchant descriptors into a stable matching key.
 * Example: "MP *RESTAURANTE DA ESQUINA 03/10" -> "restaurante da esquina"
 */
export function normalizeMerchantKey(rawDescription: string): string {
  let cleaned = simplifyText(rawDescription);

  // Strip common payment gateway / aggregator prefixes
  cleaned = cleaned.replace(
    /^(mp\s*\*|pg\s*\*|pag\s*\*|pagseguro\s*\*|mercpago\s*\*|ifood\s*\*|uber\s*\*|ec\s*\*|ebw\s*\*|jim\.com\s*\*|sumup\s*\*|stone\s*\*|cielo\s*\*|rede\s*\*)\s*/i,
    ""
  );

  // Strip installment markers like 02/10 or 1/6
  cleaned = cleaned.replace(/\b\d{1,2}\/\d{1,2}\b/g, " ");

  // Strip trailing asterisk codes or long transaction numeric ids
  cleaned = cleaned.replace(/\*\s*[a-z0-9]{4,}$/i, " ");
  cleaned = cleaned.replace(/\b\d{5,}\b/g, " ");

  // Normalize punctuation to spaces
  cleaned = cleaned.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

  return cleaned || simplifyText(rawDescription);
}
