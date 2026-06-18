// Synthesizes WAV files used by the Civitas marketing video.
// Pure Node, no deps — writes 16-bit PCM stereo WAVs into public/audio/.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'audio');
mkdirSync(OUT_DIR, { recursive: true });

const SR = 48000;
const TAU = Math.PI * 2;

// ---------- WAV writer ----------
function writeWav(name, left, right) {
  const n = left.length;
  const bytesPerSample = 2;
  const channels = 2;
  const dataBytes = n * channels * bytesPerSample;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    buf.writeInt16LE((l * 32767) | 0, off);
    off += 2;
    buf.writeInt16LE((r * 32767) | 0, off);
    off += 2;
  }
  const path = resolve(OUT_DIR, name);
  writeFileSync(path, buf);
  console.log(`wrote ${name} (${(dataBytes / 1024).toFixed(1)} KB, ${(n / SR).toFixed(2)}s)`);
}

// ---------- helpers ----------
const empty = (sec) => new Float32Array(Math.round(sec * SR));
const sec2n = (s) => Math.round(s * SR);

function addInto(target, src, offsetSamples, gain = 1) {
  const n = Math.min(src.length, target.length - offsetSamples);
  for (let i = 0; i < n; i++) target[offsetSamples + i] += src[i] * gain;
}

function softClip(x) {
  // tanh-ish saturation, keeps peaks tame
  return Math.tanh(x * 0.9) * 0.95;
}

function masterPolish(buf) {
  // simple soft clip + DC removal
  let prevX = 0, prevY = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = x - prevX + 0.997 * prevY; // 1-pole HP @ ~25Hz
    prevX = x;
    prevY = y;
    buf[i] = softClip(y);
  }
}

// ADSR envelope sampled at i (in seconds)
function adsr(t, a, d, s, r, dur) {
  if (t < 0 || t > dur) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - ((t - a) / d) * (1 - s);
  if (t < dur - r) return s;
  return s * Math.max(0, 1 - (t - (dur - r)) / r);
}

// Exponential decay envelope
function expEnv(t, tau) {
  return t < 0 ? 0 : Math.exp(-t / tau);
}

// 1-pole low-pass; cutoff in Hz can vary per sample
function lp1(prev, x, cutoff) {
  const a = Math.exp(-TAU * cutoff / SR);
  return a * prev + (1 - a) * x;
}

// White noise
function noise() {
  return Math.random() * 2 - 1;
}

// Render a band-limited sine
function sine(freq, t, phase = 0) {
  return Math.sin(TAU * freq * t + phase);
}

// Render a soft saw (bandlimited via 8 harmonics)
function softSaw(freq, t) {
  let v = 0;
  const H = 8;
  for (let h = 1; h <= H; h++) {
    v += Math.sin(TAU * freq * h * t) / h;
  }
  return v * (2 / Math.PI) * 0.5;
}

// Simple plate-ish reverb: 4 parallel comb filters into 2 allpasses
function reverbStereo(inL, inR, mix = 0.25, decay = 0.78) {
  const combDelays = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]; // freeverb-ish
  const apDelays = [556, 441, 341, 225];
  const N = inL.length;
  const outL = new Float32Array(N);
  const outR = new Float32Array(N);

  // comb buffers
  const combs = combDelays.map((d) => ({
    buf: new Float32Array(d),
    idx: 0,
    d,
    state: 0,
  }));
  const aps = apDelays.map((d) => ({ buf: new Float32Array(d), idx: 0, d }));

  const damp = 0.4;
  const stereoSpread = 23;

  for (let i = 0; i < N; i++) {
    const xL = inL[i];
    const xR = inR[i];
    const x = (xL + xR) * 0.5;

    let yL = 0, yR = 0;
    for (let c = 0; c < combs.length; c++) {
      const comb = combs[c];
      const delayed = comb.buf[comb.idx];
      comb.state = delayed * (1 - damp) + comb.state * damp;
      const newVal = x + comb.state * decay;
      comb.buf[comb.idx] = newVal;
      comb.idx = (comb.idx + 1) % comb.d;
      if (c % 2 === 0) yL += delayed; else yR += delayed;
    }
    yL /= combs.length / 2;
    yR /= combs.length / 2;

    // allpass cascade
    for (const ap of aps) {
      const bufV = ap.buf[ap.idx];
      const sL = -yL + bufV;
      ap.buf[ap.idx] = yL + bufV * 0.5;
      ap.idx = (ap.idx + 1) % ap.d;
      yL = sL;

      const bufV2 = ap.buf[(ap.idx + stereoSpread) % ap.d];
      const sR = -yR + bufV2;
      yR = sR;
    }

    outL[i] = xL + yL * mix;
    outR[i] = xR + yR * mix;
  }
  return [outL, outR];
}

// ---------- BACKGROUND DRONE (30s) ----------
function makeBg() {
  const dur = 30.0;
  const N = sec2n(dur);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  // Layer 1: sub drone — A1 + slight beating partner
  // Layer 2: octave A2
  // Layer 3: 5th E3
  // Layer 4: pad chord Am — A3, C4, E4 (sines, slightly detuned per channel for width)
  // Layer 5: high shimmer — slow tremolo'd sines at A5/E6
  // Layer 6: filtered noise wash

  let noiseLp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;

    // very slow LFOs for life
    const lfoSlow = 0.5 + 0.5 * Math.sin(TAU * 0.06 * t);          // ~16s period
    const lfoMid = 0.5 + 0.5 * Math.sin(TAU * 0.17 * t + 0.5);     // ~6s period
    const tremolo = 0.85 + 0.15 * Math.sin(TAU * 0.25 * t);        // 4s tremolo

    // global swell: in over first 4s, out over last 2s
    let swell = 1;
    if (t < 4) swell = t / 4;
    else if (t > dur - 2) swell = Math.max(0, (dur - t) / 2);

    // sub layers
    const subA1 = sine(55, t) * 0.32;
    const subA1b = sine(55.4, t) * 0.18; // beats slowly
    const subA2 = sine(110, t) * 0.16;
    const sub5th = sine(164.81, t) * 0.08 * lfoSlow;

    // pad chord — slightly detuned L/R for width
    const padL =
      sine(220.0, t) * 0.10 +
      sine(261.63, t) * 0.08 +
      sine(329.63, t) * 0.07;
    const padR =
      sine(220.6, t) * 0.10 +
      sine(262.20, t) * 0.08 +
      sine(330.20, t) * 0.07;

    // shimmer
    const shimmer =
      sine(880, t) * 0.04 * lfoMid +
      sine(1318.51, t) * 0.025 * lfoSlow;

    // textured noise wash (low-passed) — very subtle
    noiseLp = lp1(noiseLp, noise(), 800 + 200 * lfoSlow);
    const wash = noiseLp * 0.04 * tremolo;

    const subAll = subA1 + subA1b + subA2 + sub5th;

    const left = (subAll + padL + shimmer + wash) * swell * tremolo;
    const right = (subAll + padR + shimmer * 0.9 + wash * 0.8) * swell * tremolo;

    L[i] = left * 0.55;
    R[i] = right * 0.55;
  }

  // light reverb for depth
  const [rL, rR] = reverbStereo(L, R, 0.18, 0.7);
  masterPolish(rL);
  masterPolish(rR);
  writeWav('bg-tone.wav', rL, rR);
}

// ---------- OPENER RISE (8s) ----------
function makeOpenerRise() {
  const dur = 8.0;
  const N = sec2n(dur);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  let nLpL = 0, nLpR = 0;

  for (let i = 0; i < N; i++) {
    const t = i / SR;
    // rise curve: ease-in-quad over 6.5s, then hold/decay
    const rise = t < 6.5 ? Math.pow(t / 6.5, 1.6) : 1;

    // noise sweep: cutoff 200 → 5000 Hz
    const cutoff = 200 + 4800 * rise;
    const n = noise();
    nLpL = lp1(nLpL, n, cutoff);
    nLpR = lp1(nLpR, noise(), cutoff * 1.05);

    // sub sweep: 40 → 110 Hz
    const subF = 40 + 70 * rise;
    const sub = sine(subF, t) * 0.5 * rise;

    // pitched tone rising — adds tonal lift
    const toneF = 110 + 220 * rise;
    const tone = (sine(toneF, t) * 0.5 + sine(toneF * 2, t) * 0.2) * rise * 0.5;

    // resolve impact at t=6.8s
    const hitT = t - 6.8;
    let hit = 0;
    if (hitT >= 0 && hitT < 1.2) {
      const env = expEnv(hitT, 0.35);
      // kick: pitch envelope 200 → 45
      const pf = 45 + 155 * Math.exp(-hitT / 0.06);
      hit = sine(pf, t) * env * 1.0;
      // mid body
      hit += sine(110, t) * env * 0.4;
    }

    const swell = rise * 0.55;
    L[i] = nLpL * swell + sub + tone + hit;
    R[i] = nLpR * swell + sub + tone * 0.95 + hit;
  }

  const [rL, rR] = reverbStereo(L, R, 0.2, 0.75);
  masterPolish(rL);
  masterPolish(rR);
  writeWav('opener-rise.wav', rL, rR);
}

// ---------- PIVOT IMPACT (3s) ----------
function makePivotImpact() {
  const dur = 3.0;
  const N = sec2n(dur);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  // reverse cymbal lead-in (0–0.5s)
  let nL = 0, nR = 0;
  for (let i = 0; i < sec2n(0.5); i++) {
    const t = i / SR;
    const env = t / 0.5; // 0 → 1
    const cutoff = 1500 + 6500 * env;
    nL = lp1(nL, noise(), cutoff);
    nR = lp1(nR, noise(), cutoff);
    L[i] = nL * env * 0.4;
    R[i] = nR * env * 0.4;
  }

  // main hit at t=0.5s
  const hitStart = sec2n(0.5);
  for (let i = hitStart; i < N; i++) {
    const t = (i - hitStart) / SR;
    const env = expEnv(t, 0.7);

    // kick
    const pf = 50 + 200 * Math.exp(-t / 0.04);
    const kick = sine(pf, t) * Math.exp(-t / 0.3) * 1.0;

    // brassy stab — square-ish (sine + 3rd harmonic + 5th)
    const stab =
      (sine(146.83, t) + sine(146.83 * 3, t) * 0.35 + sine(146.83 * 5, t) * 0.15) *
      Math.exp(-t / 0.35) *
      0.4;

    // high crash noise
    const crashEnv = Math.exp(-t / 0.6);
    const cn = noise();
    const crashL = lp1(L[i], cn, 4000) * crashEnv * 0.5;
    const crashR = lp1(R[i], noise(), 4200) * crashEnv * 0.5;

    L[i] += kick + stab + crashL * 0.6;
    R[i] += kick + stab + crashR * 0.6;
  }

  const [rL, rR] = reverbStereo(L, R, 0.3, 0.82);
  masterPolish(rL);
  masterPolish(rR);
  writeWav('pivot-impact.wav', rL, rR);
}

// ---------- PROOF CLICKS (3 variants, ~1.5s each) ----------
function makeProofA() {
  // descending digital chirp + ring
  const dur = 1.5;
  const N = sec2n(dur);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  // chirp: 1500 → 400 over 80ms
  const chirpDur = 0.08;
  for (let i = 0; i < sec2n(chirpDur); i++) {
    const t = i / SR;
    const f = 1500 - (1500 - 400) * (t / chirpDur);
    const env = Math.exp(-t / 0.03);
    const s = sine(f, t) * env * 0.5;
    L[i] += s;
    R[i] += s * 0.95;
  }
  // ring tail at 880Hz
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const env = Math.exp(-t / 0.4) * (1 - Math.exp(-t / 0.005));
    const ring = sine(880, t) * env * 0.25;
    L[i] += ring;
    R[i] += ring * 0.9;
  }
  // tiny noise click at 0
  for (let i = 0; i < sec2n(0.008); i++) {
    L[i] += noise() * 0.5;
    R[i] += noise() * 0.5;
  }
  const [rL, rR] = reverbStereo(L, R, 0.2, 0.7);
  masterPolish(rL);
  masterPolish(rR);
  writeWav('proof-a.wav', rL, rR);
}

function makeProofB() {
  // 3-note arpeggio C5-E5-G5 in 240ms total + sub thump
  const dur = 1.5;
  const N = sec2n(dur);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  const notes = [523.25, 659.25, 783.99];
  const step = 0.08;
  for (let n = 0; n < notes.length; n++) {
    const start = sec2n(n * step);
    const noteDur = 0.5;
    for (let i = 0; i < sec2n(noteDur); i++) {
      const t = i / SR;
      const env = Math.exp(-t / 0.18) * (1 - Math.exp(-t / 0.003));
      // triangle-ish (sine + small 3rd harmonic)
      const v = (sine(notes[n], t) + sine(notes[n] * 3, t) * 0.12) * env * 0.35;
      const idx = start + i;
      if (idx < N) {
        L[idx] += v;
        R[idx] += v * 0.92;
      }
    }
  }
  // sub thump on first note
  for (let i = 0; i < sec2n(0.4); i++) {
    const t = i / SR;
    const env = Math.exp(-t / 0.18);
    const pf = 60 + 140 * Math.exp(-t / 0.04);
    const s = sine(pf, t) * env * 0.6;
    L[i] += s;
    R[i] += s;
  }
  const [rL, rR] = reverbStereo(L, R, 0.22, 0.72);
  masterPolish(rL);
  masterPolish(rR);
  writeWav('proof-b.wav', rL, rR);
}

function makeProofC() {
  // sweep up + noise pop + bright tail
  const dur = 1.5;
  const N = sec2n(dur);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  // sweep 300 → 2000 over 150ms
  const sweepDur = 0.15;
  for (let i = 0; i < sec2n(sweepDur); i++) {
    const t = i / SR;
    const f = 300 + (2000 - 300) * (t / sweepDur);
    const env = (t / sweepDur) * Math.exp(-t / 0.1);
    const s = (sine(f, t) + sine(f * 1.5, t) * 0.2) * env * 0.4;
    L[i] += s;
    R[i] += s * 0.9;
  }
  // pop
  const popAt = sec2n(0.15);
  for (let i = 0; i < sec2n(0.05); i++) {
    const t = i / SR;
    const env = Math.exp(-t / 0.015);
    L[popAt + i] += noise() * env * 0.6;
    R[popAt + i] += noise() * env * 0.6;
  }
  // bright tail at 1175Hz (D6)
  for (let i = popAt; i < N; i++) {
    const t = (i - popAt) / SR;
    const env = Math.exp(-t / 0.45) * (1 - Math.exp(-t / 0.005));
    const s = sine(1174.66, t) * env * 0.22;
    L[i] += s;
    R[i] += s * 0.85;
  }
  const [rL, rR] = reverbStereo(L, R, 0.25, 0.74);
  masterPolish(rL);
  masterPolish(rR);
  writeWav('proof-c.wav', rL, rR);
}

// ---------- METRICS PING (3s) ----------
function makeMetricsPing() {
  const dur = 3.0;
  const N = sec2n(dur);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  // Rising arpeggio: C5, E5, G5, B5, D6 every 0.22s
  const notes = [523.25, 659.25, 783.99, 987.77, 1174.66];
  const step = 0.22;
  for (let n = 0; n < notes.length; n++) {
    const start = sec2n(n * step);
    for (let i = 0; i < sec2n(0.7); i++) {
      const t = i / SR;
      const env = Math.exp(-t / 0.25) * (1 - Math.exp(-t / 0.004));
      const v = (sine(notes[n], t) + sine(notes[n] * 2, t) * 0.15) * env * 0.32;
      const idx = start + i;
      if (idx < N) {
        L[idx] += v;
        R[idx] += v * (0.85 + 0.15 * (n / notes.length));
      }
    }
  }
  // sub thump on first note
  for (let i = 0; i < sec2n(0.5); i++) {
    const t = i / SR;
    const env = Math.exp(-t / 0.2);
    const pf = 55 + 100 * Math.exp(-t / 0.05);
    const s = sine(pf, t) * env * 0.5;
    L[i] += s;
    R[i] += s;
  }
  // gentle high shimmer through the whole thing
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.5) * Math.max(0, 1 - (t - 1.5) / 1.5);
    const s = sine(2349.32, t) * 0.04 * env; // D7
    L[i] += s;
    R[i] += s * 0.9;
  }

  const [rL, rR] = reverbStereo(L, R, 0.28, 0.78);
  masterPolish(rL);
  masterPolish(rR);
  writeWav('metrics-ping.wav', rL, rR);
}

// ---------- CTA IMPACT (2s) ----------
function makeCtaImpact() {
  const dur = 2.0;
  const N = sec2n(dur);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  // Riser noise sweep 0 → 0.7s
  let nLpL = 0, nLpR = 0;
  for (let i = 0; i < sec2n(0.7); i++) {
    const t = i / SR;
    const k = t / 0.7;
    const cutoff = 300 + 7000 * Math.pow(k, 1.4);
    nLpL = lp1(nLpL, noise(), cutoff);
    nLpR = lp1(nLpR, noise(), cutoff * 1.07);
    const env = k * k;
    L[i] += nLpL * env * 0.6;
    R[i] += nLpR * env * 0.6;
  }

  // Big hit at 0.7s
  const hitAt = sec2n(0.7);
  for (let i = hitAt; i < N; i++) {
    const t = (i - hitAt) / SR;
    // sub
    const pf = 45 + 180 * Math.exp(-t / 0.04);
    const sub = sine(pf, t) * Math.exp(-t / 0.45) * 1.0;
    // mid body — A3 + C#4 (major-third lift)
    const mid =
      (sine(220, t) + sine(277.18, t) * 0.7) * Math.exp(-t / 0.5) * 0.45;
    // high sparkle: A5 + E6
    const high = (sine(880, t) + sine(1318.51, t) * 0.5) * Math.exp(-t / 0.7) * 0.2;

    L[i] += sub + mid + high;
    R[i] += sub + mid * 0.95 + high * 0.9;
  }

  // tail noise wash dying out
  let tLp = 0;
  for (let i = hitAt; i < N; i++) {
    const t = (i - hitAt) / SR;
    tLp = lp1(tLp, noise(), 2500);
    const env = Math.exp(-t / 0.5);
    L[i] += tLp * env * 0.12;
    R[i] += tLp * env * 0.12;
  }

  const [rL, rR] = reverbStereo(L, R, 0.32, 0.84);
  masterPolish(rL);
  masterPolish(rR);
  writeWav('cta-impact.wav', rL, rR);
}

console.log('Generating audio assets...');
makeBg();
makeOpenerRise();
makePivotImpact();
makeProofA();
makeProofB();
makeProofC();
makeMetricsPing();
makeCtaImpact();
console.log('Done.');
