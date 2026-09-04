const boardElement = document.getElementById('puzzle-board');
const moveCounterElement = document.getElementById('moves');
const timerElement = document.getElementById('timer');
const sizeSelect = document.getElementById('grid-size');
const restartBtn = document.getElementById('btn-restart');
const winMessage = document.getElementById('win-message');

let size = 4;
let tiles = [];
let emptyIndex = 0;
let moves = 0;
let timer = null;
let seconds = 0;
let isPlaying = false;
let isWon = false;

function initGame() {
    size = parseInt(sizeSelect.value);
    boardElement.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    boardElement.style.gridTemplateRows = `repeat(${size}, 1fr)`;
    
    resetStats();
    generateSolvableBoard();
    render();
}

function resetStats() {
    clearInterval(timer);
    seconds = 0;
    moves = 0;
    isPlaying = false;
    isWon = false;
    moveCounterElement.textContent = moves;
    timerElement.textContent = "00:00";
    winMessage.classList.add('hidden');
}

function startTimer() {
    if (isPlaying) return;
    isPlaying = true;
    timer = setInterval(() => {
        seconds++;
        let m = Math.floor(seconds / 60).toString().padStart(2, '0');
        let s = (seconds % 60).toString().padStart(2, '0');
        timerElement.textContent = `${m}:${s}`;
    }, 1000);
}

function generateSolvableBoard() {
    const totalTiles = size * size;
    tiles = Array.from({ length: totalTiles }, (_, i) => (i + 1) % totalTiles);
    
    // Embaralha fazendo movimentos válidos para garantir que sempre seja solucionável
    do {
        shuffleArray(tiles);
    } while (!isSolvable() || isWonState());

    emptyIndex = tiles.indexOf(0);
}

function shuffleArray(arr) {
    for (let i = arr.length - 2; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

// Regra matemática de solubilidade do Puzzle N
function isSolvable() {
    let inversions = 0;
    const flat = tiles.filter(t => t !== 0);
    for (let i = 0; i < flat.length; i++) {
        for (let j = i + 1; j < flat.length; j++) {
            if (flat[i] > flat[j]) inversions++;
        }
    }
    
    const emptyRowFromBottom = size - Math.floor(tiles.indexOf(0) / size);
    
    if (size % 2 !== 0) {
        return inversions % 2 === 0;
    } else {
        if (emptyRowFromBottom % 2 !== 0) {
            return inversions % 2 === 0;
        } else {
            return inversions % 2 !== 0;
        }
    }
}

function isWonState() {
    for (let i = 0; i < tiles.length - 1; i++) {
        if (tiles[i] !== i + 1) return false;
    }
    return tiles[tiles.length - 1] === 0;
}

function moveTile(index) {
    if (isWon) return;

    const row = Math.floor(index / size);
    const col = index % size;
    const emptyRow = Math.floor(emptyIndex / size);
    const emptyCol = emptyIndex % size;

    const isAdjacent = (Math.abs(row - emptyRow) + Math.abs(col - emptyCol)) === 1;

    if (isAdjacent) {
        startTimer();
        [tiles[emptyIndex], tiles[index]] = [tiles[index], tiles[emptyIndex]];
        emptyIndex = index;
        moves++;
        moveCounterElement.textContent = moves;
        
        render();

        if (isWonState()) {
            clearInterval(timer);
            isWon = true;
            winMessage.classList.remove('hidden');
        }
    }
}

function render() {
    boardElement.innerHTML = '';
    tiles.forEach((value, index) => {
        const tile = document.createElement('div');
        tile.classList.add('tile');
        if (value === 0) {
            tile.classList.add('empty');
        } else {
            tile.textContent = value;
            tile.addEventListener('click', () => moveTile(index));
        }
        boardElement.appendChild(tile);
    });
}

// Suporte a controle por teclado (Setas e WASD)
document.addEventListener('keydown', (e) => {
    if (isWon) return;
    const emptyRow = Math.floor(emptyIndex / size);
    const emptyCol = emptyIndex % size;
    let targetRow = emptyRow;
    let targetCol = emptyCol;

    switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
            targetRow = emptyRow + 1; // Move a peça de baixo para cima
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            targetRow = emptyRow - 1; // Move a peça de cima para baixo
            break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
            targetCol = emptyCol + 1; // Move a peça da direita para a esquerda
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
            targetCol = emptyCol - 1; // Move a peça da esquerda para a direita
            break;
        default:
            return;
    }

    if (targetRow >= 0 && targetRow < size && targetCol >= 0 && targetCol < size) {
        const targetIndex = targetRow * size + targetCol;
        moveTile(targetIndex);
    }
});

sizeSelect.addEventListener('change', initGame);
restartBtn.addEventListener('click', initGame);

// Inicia o jogo ao carregar
initGame();