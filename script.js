// Dizionario Morse
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

// Elementi DOM
const inputText = document.getElementById('inputText');
const outputMorse = document.getElementById('outputMorse');
const inputMorseManual = document.getElementById('inputMorseManual');
const outputTranslatedText = document.getElementById('outputTranslatedText');
const btnConvert = document.getElementById('btnConvert');
const btnCopy = document.getElementById('btnCopy');

// Variabili stato trasmissione
let isLooping = false;
let shouldStop = false;
let audioCtx = null;
let track = null; // Per la torcia (Android)

// --- NAVIGAZIONE ---
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    stopTransmission(); // Ferma tutto se si cambia pagina
    stopReception();
}

// --- CONVERSIONE ---
function textToMorse(text) {
    return text.toUpperCase().split('').map(char => MORSE_CODE[char] || '').join(' ');
}

function morseToText(morse) {
    return morse.split(' ').map(code => REVERSE_MORSE[code] || '').join('');
}

btnConvert.addEventListener('click', () => {
    const morse = textToMorse(inputText.value);
    outputMorse.value = morse;
});

// Ascolto per conversione inversa automatica
inputMorseManual.addEventListener('input', () => {
    outputTranslatedText.value = morseToText(inputMorseManual.value);
});

btnCopy.addEventListener('click', () => {
    outputMorse.select();
    document.execCommand('copy');
    alert("Copiato!");
});

// --- TRASMISSIONE ---

// Helper per Audio
function playTone(duration) {
    return new Promise(resolve => {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 600; // Hz consigliato
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        setTimeout(() => {
            osc.stop();
            resolve();
        }, duration);
    });
}

// Helper per Torcia
async function toggleTorch(state) {
    // Metodo 1: ImageCapture (Android/Chrome)
    if (track) {
        try {
            await track.applyConstraints({ advanced: [{ torch: state }] });
        } catch (e) { console.log("Torch API non supportata, uso fallback"); }
    }
    
    // Metodo 2: Fallback visivo (iOS/Safari)
    const overlay = document.getElementById('flashOverlay');
    if (state) {
        overlay.style.display = 'block';
        overlay.style.backgroundColor = 'white';
    } else {
        overlay.style.display = 'none';
        overlay.style.backgroundColor = 'black';
    }
}

// Inizializza stream fotocamera per usare la torcia su Android
async function initTorch() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        track = stream.getVideoTracks()[0];
    } catch (err) {
        console.warn("Impossibile accedere alla torcia hardware");
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function transmitMessage(mode) {
    if (!outputMorse.value) return;
    shouldStop = false;
    
    // Se torcia, prova ad inizializzarla
    if (mode === 'torch' && !track) await initTorch();

    const codes = outputMorse.value.split('');
    const DOT_TIME = 200; // ms

    do {
        for (let char of codes) {
            if (shouldStop) break;

            if (char === '.') {
                if (mode === 'sound') await playTone(DOT_TIME);
                if (mode === 'torch') await toggleTorch(true);
                await sleep(DOT_TIME);
            } else if (char === '-') {
                if (mode === 'sound') await playTone(DOT_TIME * 3);
                if (mode === 'torch') await toggleTorch(true);
                await sleep(DOT_TIME * 3);
            } else if (char === ' ') {
                await sleep(DOT_TIME * 3); // Spazio tra lettere
            } else if (char === '/') {
                await sleep(DOT_TIME * 7); // Spazio tra parole
            }

            // Spegni dopo ogni segnale
            if (mode === 'torch') await toggleTorch(false);
            await sleep(DOT_TIME); // Pausa intra-simbolo
        }
        
        await sleep(DOT_TIME * 7); // Pausa fine messaggio
    } while (isLooping && !shouldStop);

    toggleTorch(false);
}

function stopTransmission() {
    shouldStop = true;
    isLooping = false;
    toggleTorch(false);
}

document.getElementById('btnSound').addEventListener('click', () => { isLooping = false; transmitMessage('sound'); });
document.getElementById('btnTorch').addEventListener('click', () => { isLooping = false; transmitMessage('torch'); });
document.getElementById('btnLoop').addEventListener('click', () => {
    isLooping = !isLooping;
    alert("Loop attivato: " + isLooping);
});
document.getElementById('btnStop').addEventListener('click', stopTransmission);

// --- RICEZIONE (Base Logica) ---
let rxStream = null;
let rxInterval = null;

const btnRxCamera = document.getElementById('btnRxCamera');
const btnRxAudio = document.getElementById('btnRxAudio');
const btnRxStop = document.getElementById('btnRxStop');
const videoElement = document.getElementById('videoElement');
const canvasElement = document.getElementById('canvasElement');
const rxMorse = document.getElementById('rxMorse');
const rxText = document.getElementById('rxText');

async function startCameraRx() {
    try {
        rxStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        videoElement.srcObject = rxStream;
        videoElement.classList.add('active');
        document.querySelector('.red-box').style.display = 'block';
        document.querySelector('#cameraOverlay span').style.display = 'none';
        
        // Logica dummy di ricezione per dimostrazione
        // Una vera decodifica visiva richiede analisi complessa di luminosità frame-by-frame
        rxMorse.value = "In ascolto (Simulazione)..."; 
        
        // Simulo analisi (In una app reale qui si analizza il canvas)
        const ctx = canvasElement.getContext('2d');
        rxInterval = setInterval(() => {
            ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
            // Qui andrebbe il codice per calcolare la luminosità media al centro
        }, 100);

    } catch (err) {
        alert("Errore accesso fotocamera: " + err);
    }
}

async function startAudioRx() {
    rxMorse.value = "Ascolto audio attivato...";
    alert("Ricezione Audio attivata (Richiede ambiente silenzioso)");
    // Qui andrebbe Web Audio API AnalyserNode per rilevare picchi di volume
}

function stopReception() {
    if (rxStream) {
        rxStream.getTracks().forEach(t => t.stop());
        rxStream = null;
    }
    if (rxInterval) clearInterval(rxInterval);
    videoElement.classList.remove('active');
    document.querySelector('.red-box').style.display = 'none';
    document.querySelector('#cameraOverlay span').style.display = 'block';
}

btnRxCamera.addEventListener('click', startCameraRx);
btnRxAudio.addEventListener('click', startAudioRx);
btnRxStop.addEventListener('click', stopReception);