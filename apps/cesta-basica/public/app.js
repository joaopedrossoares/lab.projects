import { PERIODS, DEFAULT_ITEM } from './config.js';
import { buildSeries, brl, formatMonth } from './series.js';
import { FEATURES } from './features/index.js';

const $ = sel => document.querySelector(sel);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Estado: item escolhido + o valor de cada recurso. Fica na URL para dar para compartilhar a visão.
const params = new URLSearchParams(location.search);
const state = { item: params.get('item') || DEFAULT_ITEM };
for (const f of FEATURES) {
    if (!f.control) continue;
    const raw = params.get(f.id);
    state[f.id] = raw == null ? f.control.default : f.control.type === 'toggle' ? raw === '1' : raw;
}

let data;
let chart;

function saveState() {
    const p = new URLSearchParams();
    p.set('item', state.item);
    for (const f of FEATURES) {
        if (!f.control || state[f.id] === f.control.default) continue;
        p.set(f.id, f.control.type === 'toggle' ? (state[f.id] ? '1' : '0') : state[f.id]);
    }
    history.replaceState(null, '', `?${p}`);
}

function renderControls() {
    const box = $('#controls');
    const itemSel = document.createElement('select');
    itemSel.innerHTML = data.items.map(i => `<option${i === state.item ? ' selected' : ''}>${i}</option>`).join('');
    itemSel.onchange = () => { state.item = itemSel.value; render(); };
    box.append(labelled('Item', itemSel));

    for (const f of FEATURES) {
        if (!f.control) continue;
        let input;
        if (f.control.type === 'toggle') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = state[f.id];
            input.onchange = () => { state[f.id] = input.checked; render(); };
            const l = document.createElement('label');
            l.className = 'toggle';
            l.append(input, f.label);
            box.append(l);
            continue;
        }
        input = document.createElement('select');
        input.innerHTML = f.control.options
            .map(o => `<option value="${o.value}"${o.value === state[f.id] ? ' selected' : ''}>${o.label}</option>`).join('');
        input.onchange = () => { state[f.id] = input.value; render(); };
        box.append(labelled(f.label, input));
    }
}

function labelled(text, el) {
    const l = document.createElement('label');
    l.append(text, el);
    return l;
}

// Configuração base: eixo X sobreposto (meses desde o início) e preço em R$.
// Os recursos ajustam esta configuração em seguida.
function baseConfig(series) {
    return {
        type: 'line',
        data: {
            datasets: series.map(({ period, points }) => ({
                label: period.label,
                data: points.map(p => ({ x: p.i, y: p.y, month: p.month })),
                borderColor: period.color,
                backgroundColor: period.color,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.25,
            })),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Meses desde o início do período' },
                    ticks: { stepSize: 6 },
                    grid: { color: css('--grid') },
                },
                y: {
                    title: { display: true, text: 'Gasto mensal' },
                    ticks: { callback: v => brl(v) },
                    grid: { color: css('--grid') },
                },
            },
            plugins: {
                legend: { position: 'top', align: 'start' },
                tooltip: {
                    callbacks: {
                        title: items => items.map(c => c.raw.month && formatMonth(c.raw.month)).filter(Boolean).join(' · ') || items[0]?.label,
                        label: c => `${c.dataset.label}: ${brl(c.parsed.y)}`,
                    },
                },
            },
        },
    };
}

function render() {
    saveState();
    const raw = buildSeries(data, state.item, PERIODS);
    const ctx = { data, item: state.item, periods: PERIODS, raw, series: raw };

    for (const f of FEATURES) if (f.transform) ctx.series = f.transform(ctx.series, state[f.id], ctx);

    const config = baseConfig(ctx.series);
    for (const f of FEATURES) f.chart?.(config, state[f.id], ctx);

    chart?.destroy();
    chart = new Chart($('#chart'), config);

    const panels = $('#panels');
    panels.innerHTML = '';
    for (const f of FEATURES) {
        if (!f.panel) continue;
        const el = document.createElement('section');
        el.className = `panel panel-${f.id}`;
        panels.append(el);
        f.panel(el, state[f.id], ctx);
    }
}

async function main() {
    Chart.defaults.color = css('--muted');
    Chart.defaults.font.family = css('--font');
    try {
        const res = await fetch('/api/series');
        data = await res.json();
        if (!res.ok) throw new Error(data.error);
    } catch (err) {
        $('#status').textContent = `Não consegui ler os dados: ${err.message}`;
        return;
    }
    if (!data.months.length) {
        $('#status').textContent = 'Nenhuma planilha .xls encontrada na pasta de dados.';
        return;
    }
    if (!data.items.includes(state.item)) state.item = data.items[0];
    const first = data.months[0].month, last = data.months[data.months.length - 1].month;
    $('#status').textContent = `${data.cities.join(', ')} · ${data.months.length} meses (${formatMonth(first)} a ${formatMonth(last)}) · Fonte: DIEESE`
        + (data.errors.length ? ` · ${data.errors.length} planilha(s) ignorada(s)` : '');
    renderControls();
    render();
}

main();
