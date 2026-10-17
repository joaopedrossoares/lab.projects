import { brl, pct, formatMonth } from '../series.js';

// Tabela com início, fim, variação, mínimo e máximo de cada período (sempre em R$,
// usando os dados originais, sem média móvel nem escala %).
export default {
    id: 'resumo',
    panel(el, _value, ctx) {
        const rows = ctx.raw.map(({ period, points }) => {
            if (!points.length) return `<tr><th>${period.label}</th><td colspan="5">sem dados</td></tr>`;
            const first = points[0], last = points[points.length - 1];
            const min = points.reduce((a, p) => (p.y < a.y ? p : a));
            const max = points.reduce((a, p) => (p.y > a.y ? p : a));
            const change = (last.y / first.y - 1) * 100;
            return `<tr>
                <th><span class="dot" style="background:${period.color}"></span>${period.label}</th>
                <td>${brl(first.y)}</td><td>${brl(last.y)}</td>
                <td class="${change >= 0 ? 'up' : 'down'}">${pct(change)}</td>
                <td>${brl(min.y)} <small>${formatMonth(min.month)}</small></td>
                <td>${brl(max.y)} <small>${formatMonth(max.month)}</small></td>
            </tr>`;
        }).join('');
        el.innerHTML = `<table class="resumo">
            <thead><tr><th>${ctx.item}</th><th>Início</th><th>Fim</th><th>Variação</th><th>Mínimo</th><th>Máximo</th></tr></thead>
            <tbody>${rows}</tbody></table>`;
    },
};
