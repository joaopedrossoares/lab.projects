// Converte a lista digitada (um item por linha) em itens buscáveis.
// Formato aceito: "Água c/ gás 2", "2x Requeijão", "Arroz", "Brócolis / couve flor".

// Normaliza o nome para usar como chave estável (escolhas salvas, cache).
function itemKey(name) {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Abreviações comuns em listas de mercado que atrapalham a busca das lojas.
const ABREVIACOES = [
    [/\bc\/\s*/gi, 'com '],
    [/\bs\/\s*/gi, 'sem '],
    [/\bcong\.?(?=\s|$)/gi, 'congelado'],
];

function searchQuery(name) {
    let q = name;
    for (const [re, sub] of ABREVIACOES) q = q.replace(re, sub);
    return q.replace(/\s{2,}/g, ' ').trim();
}

function parseLine(raw) {
    let line = raw.replace(/^[\s\-*•]+/, '').trim();
    if (!line) return null;

    let qty = 1;
    // Quantidade no começo: "2x Leite", "2 Leite"
    let m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (m) {
        qty = parseInt(m[1], 10);
        line = m[2];
    } else {
        // Quantidade no fim: "Leite 2", "Leite x2", "Leite 2x"
        m = line.match(/^(.+?)\s+x?(\d+)x?$/i);
        if (m) {
            qty = parseInt(m[2], 10);
            line = m[1];
        }
    }

    // "Brócolis / couve flor" vira alternativas; a primeira é a busca padrão.
    const alternatives = line.split(/\s+\/\s+/).map(s => s.trim()).filter(Boolean);
    const name = line.trim();

    return {
        name,
        key: itemKey(name),
        qty: Math.max(1, qty),
        queries: alternatives.map(searchQuery),
    };
}

function parseList(text) {
    const items = [];
    const seen = new Map();
    for (const raw of String(text || '').split(/\r?\n/)) {
        const item = parseLine(raw);
        if (!item) continue;
        // Linhas repetidas somam quantidade em vez de duplicar o item.
        if (seen.has(item.key)) {
            seen.get(item.key).qty += item.qty;
            continue;
        }
        seen.set(item.key, item);
        items.push(item);
    }
    return items;
}

module.exports = { parseList, parseLine, itemKey, searchQuery };
