// Limita quantas requisições rodam ao mesmo tempo, para não sobrecarregar os sites das lojas.
function createLimiter(max) {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= max || queue.length === 0) return;
        active++;
        const { fn, resolve, reject } = queue.shift();
        fn().then(resolve, reject).finally(() => {
            active--;
            next();
        });
    };
    return fn => new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
    });
}

module.exports = { createLimiter };
