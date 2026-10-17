// Suaviza a série com a média dos últimos N meses (o mês atual incluso).
const N = 3;

export default {
    id: 'mm',
    label: `Média móvel ${N} meses`,
    control: { type: 'toggle', default: false },
    transform(series, on) {
        if (!on) return series;
        return series.map(s => ({
            ...s,
            points: s.points.map((p, k) => {
                const win = s.points.slice(Math.max(0, k - N + 1), k + 1);
                return { ...p, y: win.reduce((a, q) => a + q.y, 0) / win.length };
            }),
        }));
    },
};
