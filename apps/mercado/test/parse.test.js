const test = require('node:test');
const assert = require('node:assert');
const { parseList } = require('../src/parse');

test('lê quantidade no fim e no começo', () => {
    const items = parseList('Água c/ gás 2\n2x Requeijão\nArroz\n\n  - Leite x3');
    assert.deepStrictEqual(items.map(i => [i.name, i.qty]), [
        ['Água c/ gás', 2], ['Requeijão', 2], ['Arroz', 1], ['Leite', 3],
    ]);
    assert.deepStrictEqual(items[0].queries, ['Água com gás']);
});

test('alternativas com barra e abreviações', () => {
    const [a, b] = parseList('Brócolis / couve flor\nLegumes cong.');
    assert.deepStrictEqual(a.queries, ['Brócolis', 'couve flor']);
    assert.deepStrictEqual(b.queries, ['Legumes congelado']);
});

test('linhas repetidas somam quantidade', () => {
    const items = parseList('Requeijão 2\nrequeijao');
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].qty, 3);
});

test('itens distintos com nomes parecidos continuam separados', () => {
    const items = parseList('Requeijão\nRequeijão Light');
    assert.strictEqual(items.length, 2);
});
