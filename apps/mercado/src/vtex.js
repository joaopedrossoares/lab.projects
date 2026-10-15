// Conector genérico para lojas na plataforma VTEX (Atacadão, Super Nosso e muitas outras).
// Usa só as APIs públicas que o próprio site da loja chama no navegador:
//   - regions: descobre qual loja/vendedor atende o CEP
//   - intelligent-search: busca produtos com preço e EAN
//   - simulation: calcula o carrinho (preço final + frete) para o CEP
// Nada aqui faz login nem fecha pedido: o carrinho é aberto por link e o pagamento fica com você.

const HEADERS = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

const TIMEOUT_MS = 15000;

async function getJson(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        // Origin/Referer da própria loja, como o navegador manda quando o site chama a API.
        headers: { ...HEADERS, Origin: new URL(url).origin, Referer: `${new URL(url).origin}/`, ...(options.headers || {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
        const err = new Error(`HTTP ${res.status} em ${url.split('?')[0]}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

// Escolhe a oferta do vendedor que atende o CEP; se a loja não regionaliza, usa a primeira disponível.
function pickOffer(sellers, regionSellerIds = []) {
    const available = (sellers || []).filter(s => s.commertialOffer && s.commertialOffer.AvailableQuantity > 0 && s.commertialOffer.Price > 0);
    const regional = available.find(s => regionSellerIds.includes(s.sellerId));
    return regional || available[0] || null;
}

// Converte um produto da VTEX (legacy search e intelligent search têm o mesmo formato) no formato do app.
function normalizeProduct(p, store, regionSellerIds = []) {
    const out = [];
    for (const item of p.items || []) {
        const offer = pickOffer(item.sellers, regionSellerIds);
        if (!offer) continue;
        const image = (item.images && item.images[0] && item.images[0].imageUrl) || null;
        out.push({
            store: store.id,
            skuId: String(item.itemId),
            sellerId: String(offer.sellerId),
            ean: item.ean || null,
            name: item.nameComplete || p.productName,
            brand: p.brand || null,
            price: offer.commertialOffer.Price,
            listPrice: offer.commertialOffer.ListPrice || offer.commertialOffer.Price,
            unit: item.measurementUnit || 'un',
            unitMultiplier: item.unitMultiplier || 1,
            url: p.link ? `${store.baseUrl}${p.link}` : `${store.baseUrl}/${p.linkText}/p`,
            image,
        });
    }
    return out;
}

function createVtexStore(config) {
    // checkoutUrl: lojas em FastStore (Next.js) servem o checkout em outro domínio, ex.: secure.atacadao.com.br.
    const store = { sc: 1, ...config };
    store.checkoutUrl = store.checkoutUrl || store.baseUrl;
    const regionCache = new Map();

    // Retorna { regionId, sellers: [{id, name}] } para o CEP.
    async function resolveRegion(cep) {
        const clean = String(cep).replace(/\D/g, '');
        if (regionCache.has(clean)) return regionCache.get(clean);
        const data = await getJson(`${store.baseUrl}/api/checkout/pub/regions?country=BRA&postalCode=${clean}&sc=${store.sc}`);
        const region = {
            regionId: (data[0] && data[0].id) || null,
            sellers: ((data[0] && data[0].sellers) || []).map(s => ({ id: s.id, name: s.name })),
        };
        regionCache.set(clean, region);
        return region;
    }

    async function search(query, { region, count = 6 } = {}) {
        const params = new URLSearchParams({
            query,
            count: String(count),
            page: '1',
            locale: 'pt-BR',
            hideUnavailableItems: 'true',
        });
        if (region && region.regionId) params.set('regionId', region.regionId);
        const data = await getJson(`${store.baseUrl}/api/io/_v/api/intelligent-search/product_search/?${params}`);
        const sellerIds = region ? region.sellers.map(s => s.id) : [];
        return (data.products || []).flatMap(p => normalizeProduct(p, store, sellerIds));
    }

    // Busca exata pelo código de barras, usada quando você já fixou um produto para o item.
    async function searchByEan(ean, { region } = {}) {
        const params = new URLSearchParams({ fq: `alternateIds_Ean:${ean}`, sc: String(store.sc) });
        const data = await getJson(`${store.baseUrl}/api/catalog_system/pub/products/search?${params}`);
        const sellerIds = region ? region.sellers.map(s => s.id) : [];
        return data.flatMap(p => normalizeProduct(p, store, sellerIds)).filter(x => x.ean === ean);
    }

    // Simula o carrinho no CEP: preço que a loja vai cobrar de fato, itens indisponíveis e o frete mais barato.
    async function simulate(items, cep) {
        const body = {
            items: items.map(i => ({ id: i.skuId, quantity: i.qty, seller: i.sellerId })),
            country: 'BRA',
            postalCode: String(cep).replace(/\D/g, ''),
        };
        const data = await getJson(`${store.baseUrl}/api/checkout/pub/orderForms/simulation?sc=${store.sc}`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
        return summarizeSimulation(data);
    }

    function cartUrl(items) {
        const params = items.map(i => `sku=${encodeURIComponent(i.skuId)}&qty=${i.qty}&seller=${encodeURIComponent(i.sellerId)}`);
        return `${store.checkoutUrl}/checkout/cart/add?${params.join('&')}&sc=${store.sc}&redirect=true`;
    }

    return { ...store, resolveRegion, search, searchByEan, simulate, cartUrl };
}

// Resume a resposta de orderForms/simulation. Valores da VTEX vêm em centavos.
function summarizeSimulation(data) {
    const items = (data.items || []).map(i => ({
        skuId: String(i.id),
        sellerId: String(i.seller),
        qty: i.quantity,
        available: i.availability === 'available',
        unitPrice: (i.sellingPrice != null ? i.sellingPrice : i.price) / 100,
    }));
    const subtotal = items.filter(i => i.available).reduce((sum, i) => sum + i.unitPrice * i.qty, 0);

    // O frete da VTEX vem rateado por item; somamos cada opção de entrega entre os itens que a oferecem.
    const slaTotals = new Map();
    for (const info of data.logisticsInfo || []) {
        for (const sla of info.slas || []) {
            if (sla.deliveryChannel && sla.deliveryChannel !== 'delivery') continue;
            const cur = slaTotals.get(sla.id) || { name: sla.name, price: 0, items: 0, estimate: sla.shippingEstimate };
            cur.price += sla.price / 100;
            cur.items += 1;
            slaTotals.set(sla.id, cur);
        }
    }
    const deliverable = items.filter(i => i.available).length;
    const options = [...slaTotals.values()].filter(s => s.items >= deliverable);
    options.sort((a, b) => a.price - b.price);
    const shipping = options[0] || null;

    return {
        items,
        subtotal: round2(subtotal),
        shipping: shipping ? { name: shipping.name, price: round2(shipping.price), estimate: shipping.estimate } : null,
        total: round2(subtotal + (shipping ? shipping.price : 0)),
        unavailable: items.filter(i => !i.available).map(i => i.skuId),
    };
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

module.exports = { createVtexStore, normalizeProduct, pickOffer, summarizeSimulation };
