// Synthesised sound: no audio files, no network. A tiny WebAudio kit — soft blips
// for loot, a low alarm swell as the meter climbs, a sting when caught.
export class SoundKit {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.alarmOsc = null;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute() { this.muted = !this.muted; return this.muted; }

  blip(freq, dur, type, gain) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    amp.gain.setValueAtTime(gain ?? 0.12, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(amp); amp.connect(this.ctx.destination);
    osc.start(t); osc.stop(t + dur);
  }

  loot() { this.blip(880, 0.12, 'triangle', 0.10); setTimeout(() => this.blip(1320, 0.16, 'triangle', 0.08), 70); }
  target() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, 'triangle', 0.10), i * 90)); }
  bust() { this.blip(160, 0.5, 'sawtooth', 0.12); setTimeout(() => this.blip(110, 0.6, 'sawtooth', 0.10), 120); }
  click() { this.blip(660, 0.05, 'square', 0.05); }
  wingClear() { [392, 523, 659, 784].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'sine', 0.10), i * 110)); }
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, 'triangle', 0.10), i * 130)); }
}
