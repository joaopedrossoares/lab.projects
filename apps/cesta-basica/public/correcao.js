// Conversões que dependem das séries do Banco Central (ctx.indices = { inpc, salario }).
// Cada função recebe e devolve séries no formato de buildSeries.

// Último mês que existe nas planilhas e no índice: é a data-base dos valores corrigidos.
export function baseMonth(data, inpc) {
    const months = data.months.map(r => r.month).filter(m => inpc[m] != null);
    return months[months.length - 1];
}

// Número-índice acumulado do INPC a partir do primeiro mês das planilhas.
function indexLevels(data, inpc) {
    const levels = {};
    let level = 1;
    for (const { month } of data.months) {
        level *= 1 + (inpc[month] ?? 0) / 100;
        levels[month] = level;
    }
    return levels;
}

// Valores em R$ da data-base: preço × (índice na base / índice no mês).
export function deflate(series, data, inpc) {
    const levels = indexLevels(data, inpc);
    const base = levels[baseMonth(data, inpc)];
    return series.map(s => ({ ...s, points: s.points.map(p => ({ ...p, y: p.y * base / levels[p.month] })) }));
}

// Quanto do salário mínimo do mês a cesta consome, em %. Meses sem valor usam o último conhecido.
export function shareOfWage(series, salario) {
    const known = Object.keys(salario).sort();
    const wageAt = month => {
        let v;
        for (const m of known) { if (m > month) break; v = salario[m]; }
        return v;
    };
    return series.map(s => ({ ...s, points: s.points.map(p => ({ ...p, y: p.y / wageAt(p.month) * 100 })) }));
}
