// Music and sound effects.
//
// Game-dev notes:
// - Browsers only let a page make sound after the player has clicked or
//   pressed a key, so the AudioContext is created (or resumed) on the first
//   gesture. Before that, play() calls are simply dropped.
// - Sounds near you are "positional": a PannerNode places them in 3D around
//   the listener (the camera), so a bolt fired from your left is heard on the
//   left and quieter far away.
// - Recorded effects (swords, shields, footsteps) are small WAV files from
//   Kenney's CC0 packs. Magic is synthesized on the spot from oscillators and
//   filtered noise, so it costs no downloads and every cast sounds a little
//   different.
// - Music is a pair of <audio> elements that crossfade, so tracks without a
//   perfect loop point still flow into each other.

import { MUSIC, type MusicMood } from "./tracks.ts";
import { synth, type SynthId } from "./synth.ts";

export type SampleId =
  | "knifeSlice" | "knifeSlice2" | "drawKnife" | "chop" | "bookOpen" | "bookClose" | "coins" | "cloth"
  | "metalHeavy0" | "metalHeavy1" | "metalMed0" | "metalMed1" | "plateHeavy"
  | "punch0" | "punch1" | "punch2" | "punchHeavy0" | "punchHeavy1" | "wood0" | "wood1"
  | "mining0" | "mining1" | "softHeavy" | "bell" | "bell2" | "glass"
  | "stepGrass0" | "stepGrass1" | "stepGrass2" | "stepGrass3" | "stepStone0" | "stepStone1" | "stepStone2" | "stepStone3"
  | "click" | "select" | "confirm" | "pickup" | "error" | "tick" | "maximize";

const SAMPLES: SampleId[] = [
  "knifeSlice", "knifeSlice2", "drawKnife", "chop", "bookOpen", "bookClose", "coins", "cloth",
  "metalHeavy0", "metalHeavy1", "metalMed0", "metalMed1", "plateHeavy",
  "punch0", "punch1", "punch2", "punchHeavy0", "punchHeavy1", "wood0", "wood1",
  "mining0", "mining1", "softHeavy", "bell", "bell2", "glass",
  "stepGrass0", "stepGrass1", "stepGrass2", "stepGrass3", "stepStone0", "stepStone1", "stepStone2", "stepStone3",
  "click", "select", "confirm", "pickup", "error", "tick", "maximize",
];

export type Vec3 = readonly [number, number, number];
export type PlayOptions = { volume?: number; rate?: number; at?: Vec3 | null };

const CROSSFADE_S = 3;
const HEARING_RANGE = 45; // meters; positional sounds fade out by here

const loadVolume = (key: string, fallback: number): number => {
  try {
    const v = Number(localStorage.getItem(key));
    return localStorage.getItem(key) !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
  } catch {
    return fallback;
  }
};
const saveVolume = (key: string, v: number) => {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    // private window: the setting just lasts this visit
  }
};

class SoundSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private buffers = new Map<SampleId, AudioBuffer>();
  private loading: Promise<void> | null = null;
  musicVolume = loadVolume("wa.music", 0.45);
  sfxVolume = loadVolume("wa.sfx", 0.8);

  // Music state.
  private mood: MusicMood | null = null;
  private players: HTMLAudioElement[] = [];
  private active = -1; // index into players
  private trackIndex = new Map<MusicMood, number>();
  private fadeTimer: number | undefined;
  private loopWatch: number | undefined;

  // Call from a click / key handler.
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxVolume;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(this.master);
      this.loading = this.loadSamples();
      for (let i = 0; i < 2; i++) {
        const a = new Audio();
        a.preload = "auto";
        a.crossOrigin = "anonymous";
        this.ctx.createMediaElementSource(a).connect(this.musicBus);
        a.volume = 0;
        this.players.push(a);
      }
      if (this.mood) this.startMood(this.mood);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  private async loadSamples(): Promise<void> {
    const ctx = this.ctx!;
    await Promise.all(
      SAMPLES.map(async (id) => {
        try {
          const res = await fetch(`/audio/sfx/${id}.wav`);
          if (!res.ok) return;
          this.buffers.set(id, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          // a missing effect is silence, not an error
        }
      }),
    );
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    saveVolume("wa.music", v);
    if (this.ctx) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = v;
    saveVolume("wa.sfx", v);
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // Where the listener (camera) is and which way it faces.
  listen(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      // Older Safari.
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
      (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  // The node a sound should connect to: straight to the bus, or through a
  // panner at a spot in the world.
  private output(volume: number, at: Vec3 | null | undefined): { node: AudioNode; done: () => void } | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return null;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    if (at) {
      const p = ctx.createPanner();
      p.panningModel = "equalpower"; // HRTF sounds nicer but costs far more per voice
      p.distanceModel = "linear";
      p.refDistance = 2;
      p.maxDistance = HEARING_RANGE;
      p.rolloffFactor = 1;
      if (p.positionX) {
        p.positionX.value = at[0];
        p.positionY.value = at[1];
        p.positionZ.value = at[2];
      } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(at[0], at[1], at[2]);
      gain.connect(p).connect(this.sfxBus);
      return { node: gain, done: () => p.disconnect() };
    }
    gain.connect(this.sfxBus);
    return { node: gain, done: () => gain.disconnect() };
  }

  // A recorded effect. Pick one of several ids at random for variety.
  play(id: SampleId | SampleId[], opts: PlayOptions = {}): void {
    const pick = Array.isArray(id) ? id[Math.floor(Math.random() * id.length)] : id;
    const buffer = this.buffers.get(pick);
    if (!buffer) return;
    const out = this.output(opts.volume ?? 1, opts.at);
    if (!out) return;
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = (opts.rate ?? 1) * (0.94 + Math.random() * 0.12);
    src.connect(out.node);
    src.onended = out.done;
    src.start();
  }

  // A synthesized effect (spells, whooshes, jingles).
  fx(id: SynthId, opts: PlayOptions = {}): void {
    const out = this.output(opts.volume ?? 1, opts.at);
    if (!out) return;
    const seconds = synth(this.ctx!, id, out.node, opts.rate ?? 1);
    window.setTimeout(out.done, (seconds + 0.2) * 1000);
  }

  // ---- Music ----

  // Switch the background music to a mood (crossfades). null: silence.
  music(mood: MusicMood | null): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (!this.ctx) return; // starts on unlock()
    this.startMood(mood);
  }

  private startMood(mood: MusicMood | null): void {
    window.clearInterval(this.loopWatch);
    if (!mood) {
      this.fadeTo(null);
      return;
    }
    const tracks = MUSIC[mood];
    const i = this.trackIndex.get(mood) ?? Math.floor(Math.random() * tracks.length);
    this.trackIndex.set(mood, (i + 1) % tracks.length);
    this.fadeTo(tracks[i % tracks.length]);
    // Near the end of a track, crossfade into the next one of the same mood.
    this.loopWatch = window.setInterval(() => {
      const a = this.players[this.active];
      if (!a || !a.duration || this.mood !== mood) return;
      if (a.duration - a.currentTime < CROSSFADE_S + 0.3) this.startMood(mood);
    }, 500);
  }

  private fadeTo(src: string | null): void {
    window.clearInterval(this.fadeTimer);
    const old = this.players[this.active] ?? null;
    let next: HTMLAudioElement | null = null;
    if (src) {
      this.active = (this.active + 1) % this.players.length;
      next = this.players[this.active];
      next.src = src;
      next.currentTime = 0;
      next.volume = 0;
      void next.play().catch(() => {});
    }
    const start = performance.now();
    const oldVolume = old?.volume ?? 0;
    this.fadeTimer = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - start) / (CROSSFADE_S * 1000));
      if (next) next.volume = k;
      if (old && old !== next) old.volume = oldVolume * (1 - k);
      if (k >= 1) {
        window.clearInterval(this.fadeTimer);
        if (old && old !== next) old.pause();
      }
    }, 50);
  }
}

export const sound = new SoundSystem();
