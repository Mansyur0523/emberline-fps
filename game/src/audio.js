// Synthesised sound effects: every sound is built from oscillators and filtered
// noise in a WebAudio graph, so the game ships no audio files at all. All calls
// are safe before any user gesture: the context is created lazily and every
// play is guarded, so a headless capture (no gesture, no audio device) never
// throws and never blocks the frame loop.
let context = null;
let master = null;
let muted = false;

function ensure() {
  if (context || muted) return context;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      muted = true;
      return null;
    }
    context = new AC();
    master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);
  } catch {
    muted = true;
    context = null;
  }
  return context;
}

export function resumeAudio() {
  const ctx = ensure();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function noiseBuffer(seconds) {
  const ctx = ensure();
  if (!ctx) return null;
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function burst({ duration = 0.1, frequency = 1200, type = 'lowpass', gain = 0.5, when = 0 }) {
  const ctx = ensure();
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + when;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(duration + 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(gain, t0);
  envelope.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(master);
  source.start(t0);
  source.stop(t0 + duration + 0.05);
}

function tone({ frequency = 440, end = null, duration = 0.12, type = 'sine', gain = 0.25, when = 0 }) {
  const ctx = ensure();
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, t0);
  if (end !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), t0 + duration);
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(gain, t0);
  envelope.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(envelope);
  envelope.connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export const sfx = {
  shot(kind = 'rifle') {
    if (kind === 'dmr') {
      burst({ duration: 0.22, frequency: 700, gain: 0.7 });
      tone({ frequency: 140, end: 45, duration: 0.2, type: 'triangle', gain: 0.5 });
    } else if (kind === 'smg') {
      burst({ duration: 0.06, frequency: 1800, gain: 0.35 });
      tone({ frequency: 190, end: 70, duration: 0.08, type: 'triangle', gain: 0.3 });
    } else if (kind === 'pistol') {
      burst({ duration: 0.09, frequency: 1500, gain: 0.45 });
      tone({ frequency: 170, end: 60, duration: 0.1, type: 'triangle', gain: 0.35 });
    } else {
      burst({ duration: 0.11, frequency: 1100, gain: 0.55 });
      tone({ frequency: 150, end: 55, duration: 0.14, type: 'triangle', gain: 0.4 });
    }
  },
  dryFire() {
    tone({ frequency: 1400, duration: 0.03, type: 'square', gain: 0.12 });
  },
  reload() {
    tone({ frequency: 900, duration: 0.04, type: 'square', gain: 0.12 });
    tone({ frequency: 600, duration: 0.04, type: 'square', gain: 0.12, when: 0.28 });
    tone({ frequency: 1100, duration: 0.05, type: 'square', gain: 0.14, when: 0.55 });
  },
  hit() {
    tone({ frequency: 880, duration: 0.05, type: 'sine', gain: 0.2 });
  },
  kill() {
    tone({ frequency: 660, duration: 0.07, type: 'sine', gain: 0.22 });
    tone({ frequency: 990, duration: 0.1, type: 'sine', gain: 0.22, when: 0.07 });
  },
  hurt() {
    tone({ frequency: 220, end: 110, duration: 0.12, type: 'sawtooth', gain: 0.18 });
  },
  beep() {
    tone({ frequency: 1250, duration: 0.06, type: 'square', gain: 0.12 });
  },
  plantDone() {
    tone({ frequency: 520, duration: 0.1, type: 'sine', gain: 0.22 });
    tone({ frequency: 780, duration: 0.14, type: 'sine', gain: 0.22, when: 0.1 });
  },
  explosion() {
    burst({ duration: 0.9, frequency: 320, gain: 0.9 });
    tone({ frequency: 90, end: 28, duration: 0.8, type: 'sine', gain: 0.7 });
  },
  roundWin() {
    tone({ frequency: 523, duration: 0.12, type: 'triangle', gain: 0.22 });
    tone({ frequency: 659, duration: 0.12, type: 'triangle', gain: 0.22, when: 0.12 });
    tone({ frequency: 784, duration: 0.2, type: 'triangle', gain: 0.24, when: 0.24 });
  },
  roundLose() {
    tone({ frequency: 392, duration: 0.16, type: 'triangle', gain: 0.2 });
    tone({ frequency: 311, duration: 0.26, type: 'triangle', gain: 0.2, when: 0.16 });
  },
  buy() {
    tone({ frequency: 980, duration: 0.06, type: 'sine', gain: 0.18 });
    tone({ frequency: 1318, duration: 0.09, type: 'sine', gain: 0.18, when: 0.06 });
  },
  deny() {
    tone({ frequency: 180, duration: 0.12, type: 'square', gain: 0.14 });
  },
  bounce() {
    tone({ frequency: 320, end: 180, duration: 0.05, type: 'triangle', gain: 0.1 });
  },
};
