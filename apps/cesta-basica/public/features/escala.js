import { pct } from '../series.js';

// Em "%", cada período vira variação acumulada desde o seu primeiro mês,
// o que compara a inflação dos dois períodos sem depender do nível de preço.
export default {
    id: 'escala',
    label: 'Escala',
    control: {
        type: 'select',
        default: 'reais',
        options: [
            { value: 'reais', label: 'Preço (R$)' },
            { value: 'pct', label: 'Variação desde o início (%)' },
        ],
    },
    transform(series, value) {
        if (value !== 'pct') return series;
        return series.map(s => {
            const base = s.points[0]?.y;
            return { ...s, points: s.points.map(p => ({ ...p, y: (p.y / base - 1) * 100 })) };
        });
    },
    chart(config, value) {
        if (value !== 'pct') return;
        config.options.scales.y.ticks.callback = v => pct(v);
        config.options.scales.y.title.text = 'Variação desde o início do período';
        config.options.plugins.tooltip.callbacks.label = c => `${c.dataset.label}: ${pct(c.parsed.y)}`;
    },
};
