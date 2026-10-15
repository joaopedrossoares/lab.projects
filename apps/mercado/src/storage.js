// Estado persistido em data/state.json: a última lista e os produtos que você fixou para cada item.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'state.json');

function load() {
    try {
        return { list: '', choices: {}, ...JSON.parse(fs.readFileSync(FILE, 'utf-8')) };
    } catch {
        return { list: '', choices: {} };
    }
}

function save(state) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE);
}

function update(fn) {
    const state = load();
    fn(state);
    save(state);
    return state;
}

module.exports = { load, update };
