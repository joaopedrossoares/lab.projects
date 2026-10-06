// Lógica de comparação, compartilhada entre o navegador e os testes (node --test).
// Entrada: itens da lista + opções encontradas em cada loja. Saída: produto escolhido por loja,
// total por loja e a melhor divisão entre lojas.
(function (root) {
    // Escolhe o produto de cada loja para um item.
    // Prioridade: EAN fixado por você > mesmo EAN do produto escolhido em outra loja > primeiro resultado da busca.
    function pickForItem(item, optionsByStore, savedEan) {
        const stores = Object.keys(optionsByStore);
        const picks = {};

        let anchorEan = savedEan || null;
        if (!anchorEan) {
            // Âncora: o EAN que aparece em mais lojas; no empate, o que sai mais barato somando as lojas.
            const stats = new Map();
            for (const s of stores) {
                const seen = new Set();
                for (const opt of optionsByStore[s] || []) {
                    if (!opt.ean || seen.has(opt.ean)) continue;
                    seen.add(opt.ean);
                    const st = stats.get(opt.ean) || { n: 0, sum: 0 };
                    st.n += 1;
                    st.sum += opt.price;
                    stats.set(opt.ean, st);
                }
            }
            let best = null;
            for (const [ean, st] of stats) {
                if (st.n < 2) continue;
                if (!best || st.n > best.n || (st.n === best.n && st.sum < best.sum)) best = { ean, ...st };
            }
            if (best) anchorEan = best.ean;
        }

        for (const s of stores) {
            const opts = optionsByStore[s] || [];
            const same = anchorEan ? opts.find(o => o.ean === anchorEan) : null;
            picks[s] = same || opts[0] || null;
        }

        const eans = stores.map(s => picks[s] && picks[s].ean).filter(Boolean);
        const exact = eans.length > 1 && eans.length === stores.length && eans.every(e => e === eans[0]);
        return { picks, exact };
    }

    function lineTotal(product, qty) {
        return product ? round2(product.price * qty) : null;
    }

    // picksByItem: { [itemKey]: { [storeId]: product|null } }
    function summarize(items, storeIds, picksByItem) {
        const perStore = {};
        for (const s of storeIds) perStore[s] = { total: 0, found: 0, missing: [] };

        const split = {};
        for (const s of storeIds) split[s] = { total: 0, items: [] };
        const splitMissing = [];

        for (const item of items) {
            const picks = picksByItem[item.key] || {};
            let cheapest = null;
            for (const s of storeIds) {
                const p = picks[s];
                if (p) {
                    perStore[s].total += p.price * item.qty;
                    perStore[s].found += 1;
                    if (!cheapest || p.price < cheapest.product.price) cheapest = { store: s, product: p };
                } else {
                    perStore[s].missing.push(item.name);
                }
            }
            if (cheapest) {
                split[cheapest.store].total += cheapest.product.price * item.qty;
                split[cheapest.store].items.push(item.key);
            } else {
                splitMissing.push(item.name);
            }
        }

        for (const s of storeIds) {
            perStore[s].total = round2(perStore[s].total);
            split[s].total = round2(split[s].total);
        }

        // Comparação justa entre lojas: só itens que todas têm.
        const common = items.filter(item => storeIds.every(s => (picksByItem[item.key] || {})[s]));
        const commonTotals = {};
        for (const s of storeIds) {
            commonTotals[s] = round2(common.reduce((sum, item) => sum + picksByItem[item.key][s].price * item.qty, 0));
        }

        return {
            perStore,
            commonCount: common.length,
            commonTotals,
            split: {
                stores: split,
                missing: splitMissing,
                total: round2(storeIds.reduce((sum, s) => sum + split[s].total, 0)),
            },
        };
    }

    function round2(n) {
        return Math.round(n * 100) / 100;
    }

    const api = { pickForItem, summarize, lineTotal };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Compare = api;
})(typeof window !== 'undefined' ? window : globalThis);
