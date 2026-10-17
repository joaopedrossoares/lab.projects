import { brl, pct, formatMonth } from '../series.js';
import { deflate, shareOfWage, baseMonth } from '../correcao.js';

const pctSM = v => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do SM`;

// Unidades do eixo Y. Cada uma transforma os pontos e diz como formatar e rotular.
// Para outra unidade, acrescente uma entrada aqui.
const UNITS = {
    reais: {
        label: 'Preço (R$)',
    },
    real: {
        label: 'R$ corrigidos pelo INPC',
        needs: 'inpc',
        apply: (series, ctx) => deflate(series, ctx.data, ctx.indices.inpc),
        title: ctx => `R$ de ${formatMonth(baseMonth(ctx.data, ctx.indices.inpc))} (INPC)`,
        fmt: brl,
        summary: true,
    },
    salario: {
        label: '% do salário mínimo',
        needs: 'salario',
        apply: (series, ctx) => shareOfWage(series, ctx.indices.salario),
        title: () => 'Parte do salário mínimo do mês',
        fmt: pctSM,
        summary: true,
    },
    pct: {
        label: 'Variação desde o início (%)',
        apply: series => series.map(s => {
            const base = s.points[0]?.y;
            return { ...s, points: s.points.map(p => ({ ...p, y: (p.y / base - 1) * 100 })) };
        }),
        title: () => 'Variação desde o início do período',
        fmt: pct,
    },
};

const available = (unit, ctx) => !unit.needs || ctx.indices?.[unit.needs];

// "R$ corrigidos" responde se a comida subiu mais que a inflação geral.
// "% do salário mínimo" é o poder de compra: quanto do salário a cesta consome.
export default {
    id: 'escala',
    label: 'Escala',
    control: {
        type: 'select',
        default: 'reais',
        options: Object.entries(UNITS).map(([value, u]) => ({ value, label: u.label })),
    },
    transform(series, value, ctx) {
        const unit = UNITS[value];
        if (!unit?.apply || !available(unit, ctx)) return series;
        const out = unit.apply(series, ctx);
        // O resumo mostra a mesma unidade, antes de qualquer suavização.
        if (unit.summary) ctx.summary = { series: unit.apply(ctx.raw, ctx), fmt: unit.fmt, title: unit.title(ctx) };
        return out;
    },
    chart(config, value, ctx) {
        const unit = UNITS[value];
        if (!unit?.apply) return;
        if (!available(unit, ctx)) {
            config.options.plugins.subtitle = { display: true, text: `Sem dados do Banco Central: mostrando preço em R$. ${ctx.indicesError || ''}` };
            return;
        }
        config.options.scales.y.ticks.callback = v => unit.fmt(v);
        config.options.scales.y.title.text = unit.title(ctx);
        config.options.plugins.tooltip.callbacks.label = c => `${c.dataset.label}: ${unit.fmt(c.parsed.y)}`;
    },
};
