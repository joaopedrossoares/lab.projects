const test = require('node:test');
const assert = require('node:assert');
const { createVtexStore, normalizeProduct, summarizeSimulation } = require('../src/vtex');

const store = { id: 'atacadao', baseUrl: 'https://www.atacadao.com.br' };

// Formato copiado de uma resposta real do intelligent-search do Atacadão (2026-10-06), reduzido.
const product = {
    productName: 'Leite Condensado Moça Integral 395g',
    brand: 'Moça',
    link: '/leite-condensado-moca-integral-18842/p',
    linkText: 'leite-condensado-moca-integral-18842',
    items: [{
        itemId: '30600', ean: '7891000100103', measurementUnit: 'un', unitMultiplier: 1,
        images: [{ imageUrl: 'https://x/img.jpg' }],
        sellers: [
            { sellerId: '1', sellerName: 'ATACADAO SA', commertialOffer: { Price: 9.48, ListPrice: 9.48, AvailableQuantity: 10000 } },
            { sellerId: 'atacadaobr180', sellerName: 'Contagem', commertialOffer: { Price: 9.1, ListPrice: 9.48, AvailableQuantity: 5 } },
        ],
    }],
};

test('normaliza produto e prefere o vendedor da região', () => {
    const [p] = normalizeProduct(product, store, ['atacadaobr180']);
    assert.strictEqual(p.skuId, '30600');
    assert.strictEqual(p.sellerId, 'atacadaobr180');
    assert.strictEqual(p.price, 9.1);
    assert.strictEqual(p.ean, '7891000100103');
    assert.strictEqual(p.url, 'https://www.atacadao.com.br/leite-condensado-moca-integral-18842/p');
});

test('sem vendedor regional usa o primeiro disponível e ignora sem estoque', () => {
    const p2 = JSON.parse(JSON.stringify(product));
    p2.items[0].sellers[0].commertialOffer.AvailableQuantity = 0;
    const [p] = normalizeProduct(p2, store, []);
    assert.strictEqual(p.sellerId, 'atacadaobr180');
});

test('link de carrinho com vários itens', () => {
    const s = createVtexStore({ id: 'a', name: 'A', baseUrl: 'https://loja.com.br' });
    assert.strictEqual(
        s.cartUrl([{ skuId: '1', sellerId: '1', qty: 2 }, { skuId: '9', sellerId: 'x y', qty: 1 }]),
        'https://loja.com.br/checkout/cart/add?sku=1&qty=2&seller=1&sku=9&qty=1&seller=x%20y&sc=1&redirect=true',
    );
});

test('resume simulação com frete rateado entre itens', () => {
    const sim = summarizeSimulation({
        items: [
            { id: '1', seller: '1', quantity: 2, price: 500, sellingPrice: 450, availability: 'available' },
            { id: '2', seller: '1', quantity: 1, price: 1000, sellingPrice: 1000, availability: 'withoutStock' },
        ],
        logisticsInfo: [
            { itemIndex: 0, slas: [
                { id: 'Normal', name: 'Normal', price: 700, deliveryChannel: 'delivery', shippingEstimate: '1d' },
                { id: 'Retira', name: 'Retira', price: 0, deliveryChannel: 'pickup-in-point' },
            ] },
            { itemIndex: 1, slas: [] },
        ],
    });
    assert.strictEqual(sim.subtotal, 9);
    assert.deepStrictEqual(sim.shipping, { name: 'Normal', price: 7, estimate: '1d' });
    assert.strictEqual(sim.total, 16);
    assert.deepStrictEqual(sim.unavailable, ['2']);
});
