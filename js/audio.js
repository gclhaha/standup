/**
 * 极简音效合成，不依赖任何音频文件。
 */

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ok = false;
  }

  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (_) {}
    }
    this.ok = true;
  }

  tone(freq, dur = 0.1, type = 'sine', vol = 0.06, delay = 0) {
    if (!this.ok || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.92), t0 + dur);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  tick(pitch = 1) {
    this.tone(760 * pitch, 0.05, 'sine', 0.028);
  }

  step() {
    this.tone(150, 0.09, 'sine', 0.05);
  }

  warn() {
    this.tone(196, 0.22, 'sawtooth', 0.055);
    this.tone(146, 0.28, 'sawtooth', 0.04, 0.1);
  }

  denied() {
    this.tone(120, 0.3, 'square', 0.05);
  }

  go() {
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.055, i * 0.1));
  }

  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this.tone(f, 0.34, 'triangle', 0.06, i * 0.13)
    );
    this.tone(1567.98, 0.5, 'sine', 0.035, 0.52);
  }
}
