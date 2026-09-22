const startBtn = document.getElementById('start-btn');
const tunerDisplay = document.getElementById('tuner-display');
const noteElem = document.getElementById('note');
const detuneElem = document.getElementById('detune');
const pointerElem = document.getElementById('pointer');

const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
let audioContext;
let analyser;

startBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        
        audioContext.createMediaStreamSource(stream).connect(analyser);
        
        startBtn.style.display = 'none';
        tunerDisplay.style.display = 'block';
        
        updatePitch();
    } catch (err) {
        console.error(err);
        alert("Erro ao acessar o microfone. Verifique as permissões do navegador.");
    }
});

function updatePitch() {
    requestAnimationFrame(updatePitch);
    
    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    
    const frequency = autoCorrelate(buffer, audioContext.sampleRate);
    if (frequency === -1) return; // Silêncio
    
    // Calcula a nota musical mais próxima
    const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    const noteIndex = Math.round(noteNum) + 69;
    const detune = Math.round((noteNum - Math.round(noteNum)) * 100);
    
    noteElem.textContent = noteStrings[noteIndex % 12];
    detuneElem.textContent = `${detune > 0 ? '+' : ''}${detune} cents`;
    
    // Move o ponteiro vermelho (-50 cents a +50 cents)
    const pointerPosition = Math.max(-50, Math.min(50, detune));
    pointerElem.style.left = `${50 + pointerPosition}%`;
}

// Algoritmo matemático para extrair a frequência (Autocorrelação)
function autoCorrelate(buf, sampleRate) {
    let size = buf.length, rms = 0;
    for (let i = 0; i < size; i++) rms += buf[i] * buf[i];
    if (Math.sqrt(rms / size) < 0.01) return -1; 
    
    let r1 = 0, r2 = size - 1, thres = 0.2;
    for (let i = 0; i < size / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    for (let i = 1; i < size / 2; i++) if (Math.abs(buf[size - i]) < thres) { r2 = size - i; break; }
    
    buf = buf.slice(r1, r2); size = buf.length;
    let c = new Array(size).fill(0);
    for (let i = 0; i < size; i++) for (let j = 0; j < size - i; j++) c[i] += buf[j] * buf[j + i];
    
    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < size; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    
    return sampleRate / maxpos;
}