const test = require('node:test');
const assert = require('node:assert');
const { pickForItem, summarize } = require('../public/compare');

const p = (skuId, ean, price) => ({ skuId, ean, price, name: skuId });

test('casa o mesmo EAN entre lojas mesmo que não seja o primeiro resultado', () => {
    const r = pickForItem({}, {
        a: [p('a1', 'X', 10), p('a2', 'Y', 8)],
        b: [p('b1', 'Z', 5), p('b2', 'Y', 7)],
    });
    assert.strictEqual(r.picks.a.skuId, 'a2');
    assert.strictEqual(r.picks.b.skuId, 'b2');
    assert.strictEqual(r.exact, true);
});

test('EAN fixado tem prioridade; sem ele em uma loja cai no primeiro resultado', () => {
    const r = pickForItem({}, { a: [p('a1', 'X', 10), p('a2', 'Y', 8)], b: [p('b1', 'Z', 5)] }, 'Y');
    assert.strictEqual(r.picks.a.skuId, 'a2');
    assert.strictEqual(r.picks.b.skuId, 'b1');
    assert.strictEqual(r.exact, false);
});

test('totais por loja, em comum e divisão', () => {
    const items = [{ key: 'arroz', name: 'Arroz', qty: 2 }, { key: 'cafe', name: 'Café', qty: 1 }];
    const picks = { arroz: { a: p('1', 'A', 10), b: p('2', 'A', 9) }, cafe: { a: p('3', 'C', 20), b: null } };
    const s = summarize(items, ['a', 'b'], picks);
    assert.strictEqual(s.perStore.a.total, 40);
    assert.strictEqual(s.perStore.b.total, 18);
    assert.deepStrictEqual(s.perStore.b.missing, ['Café']);
    assert.strictEqual(s.commonCount, 1);
    assert.deepStrictEqual(s.commonTotals, { a: 20, b: 18 });
    assert.strictEqual(s.split.total, 38);
    assert.deepStrictEqual(s.split.stores.b.items, ['arroz']);
    assert.deepStrictEqual(s.split.stores.a.items, ['cafe']);
});

test('no empate de EAN entre lojas escolhe o mais barato', () => {
    const r = pickForItem({}, {
        a: [p('a1', 'X', 27.9), p('a2', 'Y', 24.5)],
        b: [p('b1', 'Y', 26.9), p('b2', 'X', 29.9)],
    });
    assert.strictEqual(r.picks.a.skuId, 'a2');
    assert.strictEqual(r.picks.b.skuId, 'b1');
});
