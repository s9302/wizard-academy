// Synthesized sound effects: spells, whooshes and little jingles, built from
// oscillators and filtered noise with Web Audio. Each returns how long it
// rings, in seconds, so the caller knows when to clean up.
//
// The recipe for most of these: a sound source (a tone, or white noise),
// a filter that shapes its color, and a gain "envelope" (fast attack, a
// decay) so it starts and stops cleanly instead of clicking.

export type SynthId =
  | "bolt" | "frost" | "spark" | "fireball" | "explosion" | "fizzle" | "arrow" | "swing" | "heavySwing"
  | "blink" | "stealth" | "fortify" | "charge" | "rumble" | "jump" | "levelUp" | "victory" | "defeat"
  | "beep" | "go" | "checkpoint" | "finish" | "sting" | "portal" | "thunder" | "ward";

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBufferSourceNode {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

// A gain envelope: silent, up to `peak` in `attack` s, then down over `decay` s.
function env(ctx: BaseAudioContext, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

function tone(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, len: number, peak: number, attack = 0.005): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + len);
  o.connect(env(ctx, out, t, peak, attack, len));
  o.start(t);
  o.stop(t + attack + len + 0.05);
}

// Filtered noise; the filter's frequency sweeps f0 -> f1.
function hiss(ctx: BaseAudioContext, out: AudioNode, type: BiquadFilterType, f0: number, f1: number, q: number, t: number, len: number, peak: number, attack = 0.01): void {
  const n = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + attack + len);
  n.connect(f).connect(env(ctx, out, t, peak, attack, len));
  n.start(t, Math.random());
  n.stop(t + attack + len + 0.05);
}

function notes(ctx: BaseAudioContext, out: AudioNode, t: number, freqs: number[], step: number, len: number, type: OscillatorType = "triangle", peak = 0.25): number {
  freqs.forEach((f, i) => tone(ctx, out, type, f, f, t + i * step, len, peak));
  return freqs.length * step + len;
}

export function synth(ctx: BaseAudioContext, id: SynthId, out: AudioNode, rate = 1): number {
  const t = ctx.currentTime + 0.005;
  const r = rate * (0.95 + Math.random() * 0.1); // a little variety per play
  switch (id) {
    case "bolt": // arcane zap
      tone(ctx, out, "sawtooth", 1400 * r, 260 * r, t, 0.22, 0.12);
      tone(ctx, out, "sine", 900 * r, 420 * r, t, 0.28, 0.3);
      hiss(ctx, out, "bandpass", 6000, 2500, 2, t, 0.2, 0.25);
      return 0.35;
    case "frost": // crystal chimes and a cold hiss
      for (const [f, d] of [[2093, 0], [2637, 0.03], [3136, 0.06], [4186, 0.09]] as const) tone(ctx, out, "sine", f * r, f * r, t + d, 0.35, 0.12);
      hiss(ctx, out, "highpass", 5000, 8000, 0.7, t, 0.3, 0.2);
      return 0.5;
    case "spark": // crackling burst
      for (let i = 0; i < 5; i++) hiss(ctx, out, "bandpass", 3000 + Math.random() * 3000, 1500, 6, t + i * 0.035 + Math.random() * 0.01, 0.04, 0.5, 0.002);
      tone(ctx, out, "square", 180 * r, 90 * r, t, 0.18, 0.06);
      return 0.3;
    case "fireball": // a roaring whoosh
      hiss(ctx, out, "lowpass", 300, 2200, 1.5, t, 0.45, 0.7, 0.06);
      tone(ctx, out, "sawtooth", 70 * r, 140 * r, t, 0.4, 0.12, 0.05);
      return 0.55;
    case "explosion":
      hiss(ctx, out, "lowpass", 2400, 90, 0.8, t, 0.9, 1.0, 0.004);
      tone(ctx, out, "sine", 110 * r, 38, t, 0.6, 0.8, 0.004);
      return 1.0;
    case "fizzle": // a small spell hitting a wall
      hiss(ctx, out, "bandpass", 2600 * r, 900, 3, t, 0.14, 0.45, 0.003);
      return 0.2;
    case "arrow": // bowstring twang, then the arrow's whistle
      tone(ctx, out, "triangle", 220 * r, 150 * r, t, 0.12, 0.35, 0.002);
      hiss(ctx, out, "bandpass", 1800, 3500, 8, t + 0.02, 0.22, 0.25, 0.03);
      return 0.3;
    case "swing": // blade through air
      hiss(ctx, out, "bandpass", 500 * r, 2400 * r, 3, t, 0.18, 0.55, 0.05);
      return 0.25;
    case "heavySwing":
      hiss(ctx, out, "bandpass", 250 * r, 1100 * r, 2.5, t, 0.26, 0.7, 0.07);
      return 0.35;
    case "blink": // reversed whoosh and a rising chirp
      hiss(ctx, out, "bandpass", 400, 5000, 2, t, 0.25, 0.45, 0.15);
      tone(ctx, out, "sine", 400 * r, 1800 * r, t, 0.3, 0.2, 0.05);
      return 0.45;
    case "stealth": // shimmer falling away
      for (let i = 0; i < 6; i++) tone(ctx, out, "sine", (2400 - i * 260) * r, (2400 - i * 260) * r, t + i * 0.05, 0.25, 0.08);
      hiss(ctx, out, "highpass", 6000, 2000, 0.7, t, 0.5, 0.15, 0.05);
      return 0.65;
    case "fortify": // a deep, armored swell
      tone(ctx, out, "square", 110 * r, 110 * r, t, 0.6, 0.08, 0.12);
      tone(ctx, out, "sawtooth", 165 * r, 165 * r, t, 0.6, 0.06, 0.12);
      tone(ctx, out, "sine", 880 * r, 880 * r, t + 0.1, 0.5, 0.12);
      return 0.8;
    case "charge": // a rising roar
      hiss(ctx, out, "lowpass", 200, 1800, 1.2, t, 0.5, 0.7, 0.15);
      tone(ctx, out, "sawtooth", 80 * r, 170 * r, t, 0.5, 0.15, 0.1);
      return 0.7;
    case "rumble": // stone rising from the ground
      hiss(ctx, out, "lowpass", 160, 70, 1, t, 0.7, 0.9, 0.05);
      tone(ctx, out, "sine", 55, 45, t, 0.6, 0.5, 0.05);
      return 0.8;
    case "jump":
      hiss(ctx, out, "bandpass", 700, 1500, 1, t, 0.1, 0.12, 0.02);
      return 0.15;
    case "levelUp": // C E G C, and a sparkle
      notes(ctx, out, t, [523, 659, 784, 1047], 0.09, 0.4, "triangle", 0.3);
      tone(ctx, out, "sine", 2093, 2093, t + 0.36, 0.6, 0.12);
      return 1.0;
    case "victory": // a small fanfare
      notes(ctx, out, t, [392, 523, 659, 784], 0.12, 0.3, "sawtooth", 0.08);
      notes(ctx, out, t, [392, 523, 659, 784], 0.12, 0.3, "triangle", 0.2);
      for (const f of [523, 659, 784, 1047]) tone(ctx, out, "triangle", f, f, t + 0.5, 1.2, 0.12, 0.03);
      return 1.8;
    case "defeat":
      notes(ctx, out, t, [392, 349, 311, 262], 0.22, 0.5, "triangle", 0.22);
      return 1.4;
    case "beep":
      tone(ctx, out, "square", 660, 660, t, 0.12, 0.12);
      return 0.2;
    case "go":
      tone(ctx, out, "square", 990, 990, t, 0.4, 0.14);
      tone(ctx, out, "triangle", 1320, 1320, t, 0.4, 0.14);
      return 0.5;
    case "checkpoint":
      notes(ctx, out, t, [880, 1319], 0.08, 0.3, "sine", 0.3);
      return 0.5;
    case "finish":
      notes(ctx, out, t, [659, 784, 988, 1319, 1568], 0.08, 0.5, "triangle", 0.25);
      return 1.0;
    case "sting": // you're It / cursed
      tone(ctx, out, "sawtooth", 233, 220, t, 0.5, 0.12, 0.01);
      tone(ctx, out, "sawtooth", 247, 233, t, 0.5, 0.12, 0.01);
      hiss(ctx, out, "lowpass", 1200, 200, 1, t, 0.4, 0.3, 0.005);
      return 0.6;
    case "portal": // a swirl up through the arch
      hiss(ctx, out, "bandpass", 300, 4000, 4, t, 0.7, 0.5, 0.2);
      tone(ctx, out, "sine", 300, 1200, t, 0.8, 0.15, 0.2);
      tone(ctx, out, "sine", 450, 1800, t, 0.8, 0.1, 0.2);
      return 1.0;
    case "thunder": // storm damage
      hiss(ctx, out, "lowpass", 900, 120, 1, t, 0.5, 0.5, 0.01);
      return 0.6;
    case "ward": // picked up a shield
      notes(ctx, out, t, [784, 1175, 1568], 0.05, 0.35, "sine", 0.22);
      return 0.5;
  }
}
