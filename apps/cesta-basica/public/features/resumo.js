import { brl, pct, formatMonth } from '../series.js';

// Tabela com início, fim, variação, mínimo e máximo de cada período, sem média móvel.
// Usa a unidade da escala quando ela pede (ctx.summary); senão, preço em R$.
export default {
    id: 'resumo',
    panel(el, _value, ctx) {
        const { series, fmt, title } = ctx.summary ?? { series: ctx.raw, fmt: brl, title: ctx.item };
        const rows = series.map(({ period, points }) => {
            if (!points.length) return `<tr><th>${period.label}</th><td colspan="5">sem dados</td></tr>`;
            const first = points[0], last = points[points.length - 1];
            const min = points.reduce((a, p) => (p.y < a.y ? p : a));
            const max = points.reduce((a, p) => (p.y > a.y ? p : a));
            const change = (last.y / first.y - 1) * 100;
            return `<tr>
                <th><span class="dot" style="background:${period.color}"></span>${period.label}</th>
                <td>${fmt(first.y)}</td><td>${fmt(last.y)}</td>
                <td class="${change >= 0 ? 'up' : 'down'}">${pct(change)}</td>
                <td>${fmt(min.y)} <small>${formatMonth(min.month)}</small></td>
                <td>${fmt(max.y)} <small>${formatMonth(max.month)}</small></td>
            </tr>`;
        }).join('');
        el.innerHTML = `<table class="resumo">
            <thead><tr><th>${ctx.item} · ${title === ctx.item ? 'R$' : title}</th><th>Início</th><th>Fim</th><th>Variação</th><th>Mínimo</th><th>Máximo</th></tr></thead>
            <tbody>${rows}</tbody></table>`;
    },
};
