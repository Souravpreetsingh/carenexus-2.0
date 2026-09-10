// CareNexus Web Audio AI Ambient Soundscapes Generator Engine
(function (global) {
  let audioCtx = null;
  let currentType = null;
  let isPlaying = false;
  let masterGain = null;
  let activeNodes = [];
  let intervalId = null;

  function initAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.5;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function stopAllNodes() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    activeNodes.forEach(n => {
      try {
        if (n.stop) n.stop();
        if (n.disconnect) n.disconnect();
      } catch (e) {}
    });
    activeNodes = [];
    isPlaying = false;
    currentType = null;
  }

  // 1. Calming Rain Synthesizer (Filtered Noise + Random Droplets)
  function createRain() {
    initAudioContext();
    stopAllNodes();

    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      output[i] *= 0.11;
      b6 = white * 0.115926;
    }

    const whiteNoise = audioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 850;

    whiteNoise.connect(filter);
    filter.connect(masterGain);
    whiteNoise.start();
    activeNodes.push(whiteNoise, filter);

    // Random soft droplets
    intervalId = setInterval(() => {
      if (!isPlaying || currentType !== 'rain') return;
      if (Math.random() < 0.6) {
        const drop = audioCtx.createOscillator();
        const dropGain = audioCtx.createGain();
        drop.type = 'sine';
        const freq = 1200 + Math.random() * 1400;
        drop.frequency.setValueAtTime(freq, audioCtx.currentTime);
        drop.frequency.exponentialRampToValueAtTime(freq * 0.4, audioCtx.currentTime + 0.08);

        dropGain.gain.setValueAtTime(0.04, audioCtx.currentTime);
        dropGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);

        drop.connect(dropGain);
        dropGain.connect(masterGain);

        drop.start();
        drop.stop(audioCtx.currentTime + 0.09);
      }
    }, 140);

    currentType = 'rain';
    isPlaying = true;
  }

  // 2. Ocean Waves Synthesizer (LFO Modulated Brownian Noise Swell)
  function createOceanWaves() {
    initAudioContext();
    stopAllNodes();

    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5;
    }

    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    noiseNode.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 350;

    // LFO for wave swells
    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.12;

    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 300;

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    noiseNode.connect(filter);
    filter.connect(masterGain);

    noiseNode.start();
    lfo.start();

    activeNodes.push(noiseNode, filter, lfo, lfoGain);
    currentType = 'waves';
    isPlaying = true;
  }

  // 3. Zen Forest Breeze & Chimes Synthesizer
  function createZenForest() {
    initAudioContext();
    stopAllNodes();

    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * 0.05;
    }

    const breeze = audioCtx.createBufferSource();
    breeze.buffer = noiseBuffer;
    breeze.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 450;
    filter.Q.value = 1.5;

    breeze.connect(filter);
    filter.connect(masterGain);
    breeze.start();
    activeNodes.push(breeze, filter);

    // Periodic Pentatonic Zen Chimes (528Hz, 639Hz, 741Hz, 852Hz)
    const chimeFreqs = [528, 639, 741, 852, 1056];
    intervalId = setInterval(() => {
      if (!isPlaying || currentType !== 'forest') return;
      if (Math.random() < 0.45) {
        const chime = audioCtx.createOscillator();
        const chimeGain = audioCtx.createGain();
        const f = chimeFreqs[Math.floor(Math.random() * chimeFreqs.length)];

        chime.type = 'sine';
        chime.frequency.setValueAtTime(f, audioCtx.currentTime);

        chimeGain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        chimeGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 2.5);

        chime.connect(chimeGain);
        chimeGain.connect(masterGain);

        chime.start();
        chime.stop(audioCtx.currentTime + 2.6);
      }
    }, 1200);

    currentType = 'forest';
    isPlaying = true;
  }

  // 4. Soft Alpha Waves Synthesizer (432Hz + 10Hz Binaural Beat)
  function createAlphaWaves() {
    initAudioContext();
    stopAllNodes();

    // Base 432 Hz Solfeggio Tone
    const osc1 = audioCtx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 432;

    // Offset 442 Hz Tone (Creates 10Hz Alpha Brainwave Beats)
    const osc2 = audioCtx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 442;

    // Soft Sub-Harmonic Warmth (216 Hz)
    const subOsc = audioCtx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.value = 216;

    const toneGain = audioCtx.createGain();
    toneGain.gain.value = 0.08;

    const subGain = audioCtx.createGain();
    subGain.gain.value = 0.04;

    osc1.connect(toneGain);
    osc2.connect(toneGain);
    subOsc.connect(subGain);

    toneGain.connect(masterGain);
    subGain.connect(masterGain);

    osc1.start();
    osc2.start();
    subOsc.start();

    activeNodes.push(osc1, osc2, subOsc, toneGain, subGain);
    currentType = 'alpha';
    isPlaying = true;
  }

  const Soundscapes = {
    play: function (type) {
      if (currentType === type && isPlaying) {
        this.stop();
        return false;
      }
      if (type === 'rain') createRain();
      else if (type === 'waves') createOceanWaves();
      else if (type === 'forest') createZenForest();
      else if (type === 'alpha') createAlphaWaves();
      return true;
    },
    stop: function () {
      stopAllNodes();
    },
    setVolume: function (vol) {
      if (masterGain) {
        masterGain.gain.value = Math.max(0, Math.min(1, vol));
      }
    },
    getCurrentType: function () {
      return currentType;
    },
    getIsPlaying: function () {
      return isPlaying;
    }
  };

  global.Soundscapes = Soundscapes;
})(window);
