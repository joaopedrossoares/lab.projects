const express = require('express');
const path = require('path');
const { parseList } = require('./src/parse');
const { createLimiter } = require('./src/limit');
const storage = require('./src/storage');

const PORT = process.env.PORT || 3000;
const CACHE_MS = 30 * 60 * 1000;

function createApp({ stores, cep }) {
    const app = express();
    app.use(express.json({ limit: '200kb' }));
    app.use(express.static(path.join(__dirname, 'public')));

    const limit = createLimiter(4);
    const cache = new Map();
    const storeById = Object.fromEntries(stores.map(s => [s.id, s]));

    async function cached(key, fn) {
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
        const value = await limit(fn);
        cache.set(key, { at: Date.now(), value });
        return value;
    }

    // Opções de um item numa loja: o produto fixado (por EAN) primeiro, depois os resultados da busca.
    async function optionsFor(store, region, item, savedEan) {
        const lists = [];
        if (savedEan) {
            lists.push(await cached(`${store.id}|ean|${savedEan}`, () => store.searchByEan(savedEan, { region })).catch(() => []));
        }
        for (const q of item.queries) {
            lists.push(await cached(`${store.id}|q|${q.toLowerCase()}`, () => store.search(q, { region })));
        }
        const seen = new Set();
        return lists.flat().filter(o => !seen.has(o.skuId) && seen.add(o.skuId));
    }

    app.get('/api/state', (req, res) => {
        const state = storage.load();
        res.json({ cep, stores: stores.map(s => ({ id: s.id, name: s.name })), list: state.list, choices: state.choices });
    });

    app.put('/api/list', (req, res) => {
        storage.update(s => { s.list = String(req.body.text || ''); });
        res.json({ ok: true });
    });

    app.post('/api/search', async (req, res) => {
        const items = parseList(req.body.text);
        if (items.length === 0) return res.status(400).json({ error: 'Lista vazia' });
        storage.update(s => { s.list = String(req.body.text); });
        const { choices } = storage.load();

        const storeInfo = [];
        const options = {};
        const errors = {};
        for (const item of items) {
            options[item.key] = {};
            errors[item.key] = {};
        }

        await Promise.all(stores.map(async store => {
            const info = { id: store.id, name: store.name, sellers: [], error: null };
            storeInfo.push(info);
            let region = null;
            try {
                region = await store.resolveRegion(cep);
                info.sellers = region.sellers;
                if (region.sellers.length === 0) info.error = `Não encontrei entrega para o CEP ${cep}`;
            } catch (e) {
                // Sem a região ainda tentamos a busca, com o preço padrão do site.
                info.error = `Não consegui ver qual loja entrega no CEP (${e.message})`;
            }
            await Promise.all(items.map(async item => {
                try {
                    const saved = choices[item.key] && choices[item.key].ean;
                    options[item.key][store.id] = await optionsFor(store, region, item, saved);
                } catch (e) {
                    options[item.key][store.id] = [];
                    errors[item.key][store.id] = e.message;
                }
            }));
        }));

        storeInfo.sort((a, b) => stores.findIndex(s => s.id === a.id) - stores.findIndex(s => s.id === b.id));
        res.json({ cep, items, stores: storeInfo, options, errors, choices });
    });

    // Fixa um produto (por EAN) para um item da lista; vale para as próximas compras em todas as lojas.
    app.post('/api/choices', (req, res) => {
        const { key, ean, name } = req.body || {};
        if (!key || !ean) return res.status(400).json({ error: 'key e ean são obrigatórios' });
        const state = storage.update(s => { s.choices[key] = { ean: String(ean), name: String(name || '') }; });
        res.json({ choices: state.choices });
    });

    app.delete('/api/choices/:key', (req, res) => {
        const state = storage.update(s => { delete s.choices[req.params.key]; });
        res.json({ choices: state.choices });
    });

    // Preço final e frete no seu CEP + link do carrinho pronto na loja.
    app.post('/api/cart', async (req, res) => {
        const store = storeById[req.body.store];
        const items = (req.body.items || []).filter(i => i.skuId && i.sellerId && i.qty > 0);
        if (!store || items.length === 0) return res.status(400).json({ error: 'Loja ou itens inválidos' });
        const cartUrl = store.cartUrl(items);
        try {
            const simulation = await store.simulate(items, cep);
            res.json({ cartUrl, simulation });
        } catch (e) {
            res.json({ cartUrl, simulation: null, error: `Não consegui simular o frete (${e.message})` });
        }
    });

    return app;
}

if (require.main === module) {
    const { STORES } = require('./src/stores');
    const cep = (process.env.CEP || '').replace(/\D/g, '');
    if (cep.length !== 8) {
        console.error('Defina a variável CEP com 8 dígitos (ex.: CEP=30520520).');
        process.exit(1);
    }
    createApp({ stores: STORES, cep }).listen(PORT, () => {
        console.log(`Mercado rodando na porta ${PORT} para o CEP ${cep}`);
    });
}

module.exports = { createApp };
