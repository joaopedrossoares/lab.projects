const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mercado-'));
const { createApp } = require('../server');

function fakeStore(id, prices) {
    return {
        id, name: id.toUpperCase(),
        resolveRegion: async () => ({ regionId: 'r', sellers: [{ id: 's', name: 'Loja' }] }),
        search: async q => (prices[q] || []).map(([sku, ean, price]) => ({ store: id, skuId: sku, sellerId: '1', ean, name: `${q} ${sku}`, price, listPrice: price, unit: 'un', unitMultiplier: 1, url: '#' })),
        searchByEan: async () => [],
        simulate: async items => ({ subtotal: items.length, shipping: null, total: items.length, unavailable: [], items: [] }),
        cartUrl: items => `https://${id}/cart?n=${items.length}`,
    };
}

test('busca, fixa produto e monta carrinho', async () => {
    const stores = [
        fakeStore('a', { Arroz: [['a1', 'E1', 20]] }),
        { ...fakeStore('b', {}), resolveRegion: async () => { throw new Error('HTTP 403'); } },
    ];
    const server = createApp({ stores, cep: '30520520' }).listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    try {
        const r = await post('/api/search', { text: 'Arroz 2\nFeijão' });
        assert.strictEqual(r.items.length, 2);
        assert.strictEqual(r.options.arroz.a[0].skuId, 'a1');
        assert.deepStrictEqual(r.options.feijao.a, []);
        assert.match(r.stores.find(s => s.id === 'b').error, /403/);

        const c = await post('/api/choices', { key: 'arroz', ean: 'E1', name: 'Arroz a1' });
        assert.strictEqual(c.choices.arroz.ean, 'E1');

        const cart = await post('/api/cart', { store: 'a', items: [{ skuId: 'a1', sellerId: '1', qty: 2 }] });
        assert.strictEqual(cart.cartUrl, 'https://a/cart?n=1');

        const state = await fetch(base + '/api/state').then(r => r.json());
        assert.strictEqual(state.list, 'Arroz 2\nFeijão');
    } finally {
        server.close();
    }
});
