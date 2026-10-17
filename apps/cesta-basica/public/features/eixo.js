import { formatMonth } from '../series.js';

// Sobreposto: os dois períodos começam no mesmo ponto (mês 0), facilitando a comparação.
// Linha do tempo: cada período no seu lugar no calendário.
export default {
    id: 'eixo',
    label: 'Eixo X',
    control: {
        type: 'select',
        default: 'sobreposto',
        options: [
            { value: 'sobreposto', label: 'Períodos sobrepostos' },
            { value: 'tempo', label: 'Linha do tempo' },
        ],
    },
    chart(config, value, ctx) {
        if (value !== 'tempo') return;
        const months = [...new Set(ctx.series.flatMap(s => s.points.map(p => p.month)))].sort();
        config.data.labels = months.map(formatMonth);
        config.data.datasets.forEach((ds, k) => {
            ds.data = ctx.series[k].points.map(p => ({ x: formatMonth(p.month), y: p.y }));
        });
        config.options.scales.x = { type: 'category', ticks: { maxTicksLimit: 18 } };
    },
};
