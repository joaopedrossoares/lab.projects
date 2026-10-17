// Comparações disponíveis no seletor "Comparar". Cada uma é uma lista de períodos;
// start/end no formato AAAA-MM, inclusive. Para outra comparação, acrescente uma entrada.
export const COMPARISONS = {
    mandatos: {
        label: '2018–2022 × 2022–2026',
        // O mês de virada (set/2022) entra nos dois períodos.
        periods: [
            { id: 'p1', label: 'set/2018 – set/2022', start: '2018-09', end: '2022-09', color: '#2a78d6' },
            { id: 'p2', label: 'set/2022 – set/2026', start: '2022-09', end: '2026-09', color: '#d9622b' },
        ],
    },
    pandemia: {
        label: 'Pré, durante e pós pandemia',
        // Início: decreto de calamidade (mar/2020). Fim: OMS encerra a emergência (mai/2023).
        periods: [
            { id: 'pre', label: 'Pré-pandemia (set/2018 – fev/2020)', start: '2018-09', end: '2020-02', color: '#2a78d6' },
            { id: 'dur', label: 'Pandemia (mar/2020 – mai/2023)', start: '2020-03', end: '2023-05', color: '#8a5cc2' },
            { id: 'pos', label: 'Pós-pandemia (jun/2023 – set/2026)', start: '2023-06', end: '2026-09', color: '#d9622b' },
        ],
    },
    prepos: {
        label: 'Pré × pós pandemia',
        periods: [
            { id: 'pre', label: 'Pré-pandemia (set/2018 – fev/2020)', start: '2018-09', end: '2020-02', color: '#2a78d6' },
            { id: 'pos', label: 'Pós-pandemia (jun/2023 – set/2026)', start: '2023-06', end: '2026-09', color: '#d9622b' },
        ],
    },
};

export const DEFAULT_COMPARISON = 'mandatos';
export const DEFAULT_ITEM = 'Total da Cesta';
