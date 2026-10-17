// Monta uma série por período: [{ period, points: [{ i, month, y }] }]
// i = meses desde o início do período (eixo sobreposto); month = AAAA-MM (linha do tempo).

export function monthIndex(month) {
    const [y, m] = month.split('-').map(Number);
    return y * 12 + (m - 1);
}

export function buildSeries(data, item, periods) {
    return periods.map(period => {
        const start = monthIndex(period.start);
        const points = data.months
            .filter(r => r.month >= period.start && r.month <= period.end && r.values[item] != null)
            .map(r => ({ i: monthIndex(r.month) - start, month: r.month, y: r.values[item] }));
        return { period, points };
    });
}

const NOMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function formatMonth(month) {
    const [y, m] = month.split('-');
    return `${NOMES[Number(m) - 1]}/${y}`;
}

export const brl = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pct = v => `${v >= 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
