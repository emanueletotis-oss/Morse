// --- CONFIGURAZIONE E DIZIONARIO ---
const MORSE_CODE = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..', '1': '.----', '2': '..---', '3': '...--',
    '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
    '9': '----.', '0': '-----', ' ': '/'
};
const REVERSE_MORSE = Object.fromEntries(Object.entries(MORSE_CODE).map(([k, v]) => [v, k]));

// Costanti di Tempo (Standard Morse: Punto = T, Linea = 3T)
const UNIT_TIME = 200; // ms (velocità base)
const DOT_MIN = 50;
const DOT_MAX = 400; // Accetta punti tra 50ms e 400ms
const DASH_MIN = 401; // Accetta linee > 400ms

// --- ELEMENTI DOM ---
const outputMorse = document.getElementById('outputMorse');
const rxMorse = document.getElementById('rxMorse');
const rxText = document.getElementById('rxText');
const btnLoop = document.getElementById('btnLoop');
const loopIcon = document.getElementById('loopIcon');
const signalIndicator = document.getElementById('signalIndicator');

// --- STATO ---
let isLooping = false;
let isTransmitting = false;
let stopSignal = false;
let audioCtx = null;
let stream = null; // Stream fotocamera/audio
let analyzer = null;
let rxInterval = null;
let torchTrack = null;

// --- NAVIGAZIONE ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active-screen');
    document.getElementById(id === 'screen1' ? 'nav1' : 'nav2').classList.add('active');
    
    // Stop totale se cambio pagina
    stopTransmission();
    stopReception();
}

// --- CONVERSIONE ---
document.getElementById('btnConvert').addEventListener('click', () => {
    const text = document.getElementById('inputText').value.trim();
    if(!text) return;
    outputMorse.value = text.toUpperCase().split('').map(c => MORSE_CODE[c] || '').join(' ');
});

document.getElementById('inputMorseManual').addEventListener('input', (e) => {
    const morse = e.target.value.trim();
    document.getElementById('outputTranslatedText').value = morse.split(' ').map(c => REVERSE_MORSE[c] || '').join('');
});

document.getElementById('btnCopy').addEventListener('click', () => {
    outputMorse.select();
    document.execCommand('copy');
    // Nessun alert, feedback visivo opzionale
});

// --- TRASMISSIONE ---
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

async function playBeep(duration) {
    initAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 600;
    osc.start();
    return new Promise(r => setTimeout(() => { osc.stop(); r(); }, duration));
}

async function setTorch(on) {
    // 1. Prova Torcia Hardware (Android)
    if (torchTrack) {
        try { await torchTrack.applyConstraints({ advanced: [{ torch: on }] }); } catch(e){}
    }
    // 2. Fallback Schermo (iOS)
    const overlay = document.getElementById('flashOverlay');
    overlay.style.display = on ? 'block' : 'none';
}

async function transmit(type) {
    if (isTransmitting) return;
    const code = outputMorse.value;
    if (!code) return;

    isTransmitting = true;
    stopSignal = false;
    
    // Setup Torcia se necessario
    if (type === 'torch' && !torchTrack) {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            torchTrack = s.getVideoTracks()[0];
        } catch(e) { console.log("Torcia HW non disponibile"); }
    }

    do {
        for (let char of code) {
            if (stopSignal) break;
            
            let dur = 0;
            if (char === '.') dur = UNIT_TIME;
            else if (char === '-') dur = UNIT_TIME * 3;
            else if (char === ' ') { await sleep(UNIT_TIME * 3); continue; }
            else if (char === '/') { await sleep(UNIT_TIME * 7); continue; }
            
            if (dur > 0) {
                if (type === 'sound') playBeep(dur); // Non await qui per sincronia perfetta, ma il beep è async
                if (type === 'sound') await sleep(dur); // Aspetta la durata del suono
                
                if (type === 'torch') {
                    setTorch(true);
                    await sleep(dur);
                    setTorch(false);
                }
                
                await sleep(UNIT_TIME); // Pausa tra simboli
            }
        }
        await sleep(UNIT_TIME * 7); // Pausa fine messaggio
    } while (isLooping && !stopSignal);

    isTransmitting = false;
    setTorch(false);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function stopTransmission() {
    stopSignal = true;
    isTransmitting = false;
    setTorch(false);
    // Reset Loop UI
    isLooping = false;
    updateLoopUI();
}

// LOGICA LOOP
btnLoop.addEventListener('click', () => {
    isLooping = !isLooping;
    updateLoopUI();
});

function updateLoopUI() {
    if (isLooping) {
        btnLoop.classList.remove('loop-off');
        btnLoop.classList.add('loop-on');
        btnLoop.innerHTML = "Loop ON &#10004;";
    } else {
        btnLoop.classList.remove('loop-on');
        btnLoop.classList.add('loop-off');
        btnLoop.innerHTML = "Loop &#8635;";
    }
}

document.getElementById('btnSound').addEventListener('click', () => { 
    stopSignal = true; setTimeout(() => transmit('sound'), 200); 
});
document.getElementById('btnTorch').addEventListener('click', () => { 
    stopSignal = true; setTimeout(() => transmit('torch'), 200); 
});
document.getElementById('btnStop').addEventListener('click', stopTransmission);

// --- RICEZIONE AVANZATA ---

let lastChangeTime = 0;
let signalState = false; // true = ON, false = OFF
let currentSymbol = ""; // ".-"
let lastLevel = 0;

// Logica di decodifica basata sui tempi
function processSignal(isSignalHigh) {
    const now = Date.now();
    const delta = now - lastChangeTime;

    if (isSignalHigh && !signalState) {
        // Segnale appena INIZIATO (era spento, ora acceso)
        // Analizziamo il silenzio precedente
        if (delta > UNIT_TIME * 6) { // Pausa lunga -> Spazio parola
             rxMorse.value += " / ";
             rxText.value += " ";
        } else if (delta > UNIT_TIME * 2.5) { // Pausa media -> Fine lettera
             if (currentSymbol) {
                 const letter = REVERSE_MORSE[currentSymbol] || '?';
                 rxText.value += letter;
                 rxMorse.value += " ";
                 currentSymbol = "";
             }
        }
        
        signalState = true;
        lastChangeTime = now;
        signalIndicator.classList.add('signal-active');

    } else if (!isSignalHigh && signalState) {
        // Segnale appena FINITO (era acceso, ora spento)
        // Determiniamo se era Punto o Linea
        if (delta > 50 && delta < 350) { // Punto (tolleranza)
            currentSymbol += ".";
            rxMorse.value += ".";
        } else if (delta >= 350) { // Linea
            currentSymbol += "-";
            rxMorse.value += "-";
        }

        signalState = false;
        lastChangeTime = now;
        signalIndicator.classList.remove('signal-active');
    }
}

// 1. RICEZIONE VIDEO (LUMINOSITÀ)
async function startVideoRx() {
    stopReception();
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const vid = document.getElementById('videoElement');
        vid.srcObject = stream;
        vid.classList.add('active');
        document.querySelector('.target-box').style.display = 'block';
        document.getElementById('camPlaceholder').style.display = 'none';

        const canvas = document.getElementById('canvasElement');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        rxMorse.value = "";
        rxText.value = "";
        lastChangeTime = Date.now();

        rxInterval = setInterval(() => {
            if (vid.readyState === vid.HAVE_ENOUGH_DATA) {
                canvas.width = 100; // Ridotto per performance
                canvas.height = 100;
                ctx.drawImage(vid, 0, 0, 100, 100);
                
                // Analizza centro (pixel 40,40 a 60,60)
                const frame = ctx.getImageData(40, 40, 20, 20);
                let totalBrit = 0;
                for(let i=0; i<frame.data.length; i+=4) {
                    totalBrit += (frame.data[i] + frame.data[i+1] + frame.data[i+2]) / 3;
                }
                const avgBrit = totalBrit / (frame.data.length / 4);

                // Soglia dinamica semplice
                // Se la luminosità aumenta improvvisamente > 50 rispetto alla media base (semplificato)
                // In un app reale si usa una media mobile. Qui uso una soglia fissa "alta" per la torcia
                
                // Algoritmo adattivo semplice
                const threshold = 200; // Torcia diretta è molto luminosa (255)
                const isBright = avgBrit > threshold;
                
                processSignal(isBright);
            }
        }, 50); // check ogni 50ms

    } catch (e) {
        alert("Errore fotocamera: " + e);
    }
}

// 2. RICEZIONE AUDIO (VOLUME)
async function startAudioRx() {
    stopReception();
    try {
        initAudio();
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioCtx.createMediaStreamSource(stream);
        analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 256;
        source.connect(analyzer);

        const dataArray = new Uint8Array(analyzer.frequencyBinCount);
        
        rxMorse.value = "";
        rxText.value = "";
        lastChangeTime = Date.now();

        rxInterval = setInterval(() => {
            analyzer.getByteFrequencyData(dataArray);
            
            // Calcola volume medio
            let sum = 0;
            for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
            const average = sum / dataArray.length;

            // Soglia volume (aggiustabile)
            const threshold = 30; // Se c'è silenzio è < 10, se parli o beep è > 50
            const isLoud = average > threshold;
            
            processSignal(isLoud);

        }, 50);

    } catch (e) {
        alert("Errore microfono: " + e.message);
    }
}

function stopReception() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (rxInterval) clearInterval(rxInterval);
    document.getElementById('videoElement').classList.remove('active');
    document.querySelector('.target-box').style.display = 'none';
    document.getElementById('camPlaceholder').style.display = 'block';
    signalIndicator.classList.remove('signal-active');
}

document.getElementById('btnRxCamera').addEventListener('click', startVideoRx);
document.getElementById('btnRxAudio').addEventListener('click', startAudioRx);
document.getElementById('btnRxStop').addEventListener('click', stopReception);