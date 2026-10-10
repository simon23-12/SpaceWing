// Procedural audio: SFX synthesis, ambient score and a live jazz trio for the bar. No samples.

const MOON_PROGS = {
  rhea: { prog: [[50, 57, 62, 65, 69], [46, 53, 58, 62, 65], [48, 55, 60, 64, 67], [45, 52, 57, 60, 64]], bells: 0.22, bellOct: 24, pad: 1 },          // D dorian
  enceladus: { prog: [[52, 59, 64, 68, 71], [54, 61, 66, 70, 73], [52, 59, 63, 68, 71], [49, 56, 61, 64, 68]], bells: 0.4, bellOct: 24, pad: 0.8 },  // E lydian, glassy
  mimas: { prog: [[45, 52, 55, 58], [46, 53, 58, 61], [43, 50, 55, 58], [46, 49, 53, 58]], bells: 0.08, bellOct: 12, pad: 1.2 },                    // A phrygian, dark
  titan: { prog: [[48, 55, 60, 64, 67], [46, 53, 58, 62, 65], [53, 60, 65, 69, 72], [51, 58, 63, 67, 70]], bells: 0.16, bellOct: 24, pad: 1.1 },     // C mixolydian, warm
  iapetus: { prog: [[49, 55, 61, 65], [51, 57, 63, 67], [47, 53, 59, 63], [49, 53, 57, 63]], bells: 0.3, bellOct: 19, pad: 0.9 },                     // whole-tone, eerie
};
const NOTE = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.musicMode = null;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = 0.8;
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(C.destination);
    this.sfx = C.createGain(); this.sfx.gain.value = 0.7; this.sfx.connect(this.master);
    this.music = C.createGain(); this.music.gain.value = 0.5; this.music.connect(this.master);
    // shared reverb
    this.verb = C.createConvolver(); this.verb.buffer = this.impulse(2.8, 2.5);
    this.verbGain = C.createGain(); this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain).connect(this.master);
    this.noiseBuf = this.makeNoise(2);
    // engine loop
    this.eng = C.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 42;
    this.engF = C.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 180;
    this.engN = this.noiseSource(true); this.engNF = C.createBiquadFilter(); this.engNF.type = 'bandpass'; this.engNF.frequency.value = 300; this.engNF.Q.value = 0.6;
    this.engG = C.createGain(); this.engG.gain.value = 0;
    this.eng.connect(this.engF).connect(this.engG); this.engN.connect(this.engNF).connect(this.engG);
    this.engG.connect(this.sfx);
    this.eng.start(); this.engN.start();
    this.scheduler = setInterval(() => this.tick(), 50);
  }

  impulse(sec, decay) {
    const C = this.ctx, len = C.sampleRate * sec, b = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  makeNoise(sec) {
    const C = this.ctx, b = C.createBuffer(1, C.sampleRate * sec, C.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  noiseSource(loop = false) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = loop; return s; }

  env(g, t, a, peak, d, sustain = 0) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  }

  // ---------------------------------------------------------------- SFX
  laser(vol = 1, player = false) {
    if (!this.ctx || vol <= 0.02) return;
    const C = this.ctx, t = C.currentTime;
    const o = C.createOscillator(); o.type = player ? 'sawtooth' : 'square';
    const f0 = player ? 1500 : 1100 + Math.random() * 300;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.18, t + 0.16);
    const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200;
    const g = C.createGain(); this.env(g, t, 0.004, 0.14 * vol, 0.17);
    o.connect(f).connect(g).connect(this.sfx); g.connect(this.verb);
    o.start(t); o.stop(t + 0.2);
  }
  hit(shield) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const n = this.noiseSource(); const f = C.createBiquadFilter(); f.type = shield ? 'highpass' : 'lowpass'; f.frequency.value = shield ? 2200 : 700;
    const g = C.createGain(); this.env(g, t, 0.003, shield ? 0.25 : 0.5, shield ? 0.25 : 0.35);
    n.connect(f).connect(g).connect(this.sfx); n.start(t); n.stop(t + 0.4);
    if (shield) { const o = C.createOscillator(); o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.25); const g2 = C.createGain(); this.env(g2, t, 0.005, 0.08, 0.25); o.connect(g2).connect(this.sfx); o.start(t); o.stop(t + 0.3); }
  }
  hitConfirm() {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const n = this.noiseSource(); const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 2;
    const g = C.createGain(); this.env(g, t, 0.002, 0.08, 0.08);
    n.connect(f).connect(g).connect(this.sfx); n.start(t); n.stop(t + 0.1);
  }
  explosion(vol = 1, size = 10) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const n = this.noiseSource(); const f = C.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(90, t + 1.6);
    const g = C.createGain(); this.env(g, t, 0.01, 0.9 * vol, 1.8 + size * 0.03);
    n.connect(f).connect(g).connect(this.sfx); g.connect(this.verb); n.start(t); n.stop(t + 2.5);
    const o = C.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const g2 = C.createGain(); this.env(g2, t, 0.01, 0.8 * vol, 1.0);
    o.connect(g2).connect(this.sfx); o.start(t); o.stop(t + 1.2);
  }
  missile() {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const n = this.noiseSource(); const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2500, t + 0.8); f.Q.value = 1.5;
    const g = C.createGain(); this.env(g, t, 0.05, 0.35, 0.9);
    n.connect(f).connect(g).connect(this.sfx); n.start(t); n.stop(t + 1);
  }
  lockTone() { this.beep(1320, 0.12, 0.08); setTimeout(() => this.beep(1320, 0.12, 0.08), 140); }
  blip() { this.beep(880, 0.05, 0.04); }
  click() { this.beep(1400, 0.03, 0.03, 'triangle'); }
  error() { this.beep(220, 0.15, 0.08, 'square'); }
  coins() { [1046, 1318, 1568].forEach((f, i) => setTimeout(() => this.beep(f, 0.12, 0.06, 'triangle'), i * 70)); }
  beep(freq, dur, vol, type = 'sine') {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const o = C.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = C.createGain(); this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  burn() {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const n = this.noiseSource(); const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(200, t); f.frequency.linearRampToValueAtTime(1200, t + 3); f.frequency.linearRampToValueAtTime(150, t + 7);
    const g = C.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.7, t + 2); g.gain.linearRampToValueAtTime(0.001, t + 7.5);
    n.connect(f).connect(g).connect(this.sfx); g.connect(this.verb); n.start(t); n.stop(t + 8);
  }
  engine(throttle, boost) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = this.engineOn ? 0.05 + throttle * 0.12 + (boost ? 0.12 : 0) : 0;
    this.engG.gain.setTargetAtTime(target, t, 0.15);
    this.eng.frequency.setTargetAtTime(38 + throttle * 30 + (boost ? 25 : 0), t, 0.2);
    this.engNF.frequency.setTargetAtTime(250 + throttle * 500 + (boost ? 900 : 0), t, 0.2);
  }
  setEngine(on) { this.engineOn = on; if (!on && this.ctx) this.engG.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); }

  // ---------------------------------------------------------------- music
  setMusic(mode, opts = {}) {
    if (!this.ctx || this.musicMode === mode) return;
    this.musicMode = mode;
    this.music.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    setTimeout(() => {
      if (this.musicMode !== mode) return;
      this.stopMusicNodes();
      this.music.gain.setTargetAtTime(mode === 'jazz' ? 0.9 : 0.42, this.ctx.currentTime, 0.8);
      this.seq = { mode, beat: 0, next: this.ctx.currentTime + 0.1, bar: 0, combat: 0 };
      if (mode === 'jazz') this.setupBand(opts);
      if (mode === 'station') this.setupHum();
    }, 900);
  }
  stopMusicNodes() {
    if (this.band) { this.band.out.disconnect(); this.band = null; }
    if (this.hum) { this.hum.forEach(n => { try { n.stop(); } catch { } }); this.humG && this.humG.disconnect(); this.hum = null; }
  }
  setCombat(v) { if (this.seq) this.seq.combat = v; }

  setupHum() {
    const C = this.ctx;
    this.humG = C.createGain(); this.humG.gain.value = 0.05; this.humG.connect(this.music);
    const o1 = C.createOscillator(); o1.frequency.value = 55; const o2 = C.createOscillator(); o2.frequency.value = 110.3;
    const n = this.noiseSource(true); const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    o1.connect(this.humG); o2.connect(this.humG); n.connect(f).connect(this.humG);
    o1.start(); o2.start(); n.start();
    this.hum = [o1, o2, n];
  }

  /** Spatial band output: position the PannerNode at the stage. */
  setupBand({ pos = [0, 1.5, 0] } = {}) {
    const C = this.ctx;
    const out = C.createGain(); out.gain.value = 1;
    const pan = C.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 3; pan.rolloffFactor = 0.9;
    pan.positionX.value = pos[0]; pan.positionY.value = pos[1]; pan.positionZ.value = pos[2];
    out.connect(pan).connect(this.music);
    out.connect(this.verb);
    this.band = { out, pan, lastLead: 72 };
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.05); L.positionY.setTargetAtTime(pos.y, t, 0.05); L.positionZ.setTargetAtTime(pos.z, t, 0.05);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.05); L.forwardY.setTargetAtTime(fwd.y, t, 0.05); L.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    }
  }

  tick() {
    const s = this.seq;
    if (!s || !this.ctx) return;
    const C = this.ctx;
    const bpm = s.mode === 'jazz' ? 132 : s.mode === 'space' ? 66 : 60;
    const spb = 60 / bpm;
    while (s.next < C.currentTime + 0.25) {
      if (s.mode === 'jazz') this.jazzBeat(s, s.next, spb);
      else if (s.mode === 'space' || s.mode === 'menu') this.ambientBeat(s, s.next, spb);
      s.next += spb; s.beat++;
      if (s.beat % 4 === 0) s.bar++;
    }
  }

  /** Each moon has its own harmonic colour for the flight score. */
  setMoon(id) { this.moon = id; }

  // ambient: slow evolving pads + sparse bells, pulse when in combat. Harmony depends on the moon.
  ambientBeat(s, t, spb) {
    const P = MOON_PROGS[s.mode === 'space' ? (this.moon || 'rhea') : 'rhea'];
    const chord = P.prog[Math.floor(s.bar / 2) % P.prog.length];
    if (s.beat % 8 === 0) for (const m of chord) this.pad(NOTE(m), t, spb * 8.5, 0.035 * P.pad);
    if (Math.random() < P.bells) this.bell(NOTE(chord[Math.floor(Math.random() * chord.length)] + P.bellOct), t, 0.03);
    if (s.combat > 0.2) {
      this.pluck(NOTE(chord[0] - 12), t, 0.12 * s.combat, 0.25);
      if (s.beat % 2 === 0) this.kick(t, 0.25 * s.combat);
      this.hat(t + spb / 2, 0.05 * s.combat);
    }
  }
  pad(freq, t, dur, vol) {
    const C = this.ctx;
    const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(1400, t + dur * 0.5); f.frequency.linearRampToValueAtTime(500, t + dur);
    for (const det of [-7, 6]) { const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.1); }
    f.connect(g).connect(this.music); g.connect(this.verb);
  }
  bell(freq, t, vol) {
    const C = this.ctx;
    const o = C.createOscillator(); o.frequency.value = freq;
    const m = C.createOscillator(); m.frequency.value = freq * 3.5; const mg = C.createGain(); mg.gain.value = freq * 0.8;
    m.connect(mg).connect(o.frequency);
    const g = C.createGain(); this.env(g, t, 0.005, vol, 2.5);
    o.connect(g).connect(this.music); g.connect(this.verb);
    o.start(t); m.start(t); o.stop(t + 2.6); m.stop(t + 2.6);
  }
  pluck(freq, t, vol, dur) {
    const C = this.ctx;
    const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(200, t + dur);
    const g = C.createGain(); this.env(g, t, 0.005, vol, dur);
    o.connect(f).connect(g).connect(this.music); o.start(t); o.stop(t + dur + 0.05);
  }
  kick(t, vol, dest) {
    const C = this.ctx;
    const o = C.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = C.createGain(); this.env(g, t, 0.003, vol, 0.25);
    o.connect(g).connect(dest || this.music); o.start(t); o.stop(t + 0.3);
  }
  hat(t, vol, dest, dur = 0.05, freq = 7000) {
    const C = this.ctx;
    const n = this.noiseSource(); const f = C.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = C.createGain(); this.env(g, t, 0.002, vol, dur);
    n.connect(f).connect(g).connect(dest || this.music); n.start(t, Math.random()); n.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- the band: "Roche-Grenze" trio + sax
  jazzBeat(s, t, spb) {
    const B = this.band; if (!B) return;
    const out = B.out;
    // 8-bar form: | Dm7 | G7 | Cmaj7 | Fmaj7 | Bm7b5 | E7 | Am7 | A7 |  (minor ii-V cycle, original tune "Cassini-Spalt")
    const form = [
      { root: 50, tones: [50, 53, 57, 60], scale: [50, 52, 53, 55, 57, 59, 60] },
      { root: 43, tones: [43, 47, 50, 53], scale: [43, 45, 47, 48, 50, 52, 53] },
      { root: 48, tones: [48, 52, 55, 59], scale: [48, 50, 52, 55, 57, 59] },
      { root: 41, tones: [41, 45, 48, 52], scale: [41, 43, 45, 48, 50, 52] },
      { root: 47, tones: [47, 50, 53, 57], scale: [47, 48, 50, 52, 53, 55, 57] },
      { root: 40, tones: [40, 44, 47, 50], scale: [40, 41, 44, 45, 47, 48, 50] },
      { root: 45, tones: [45, 48, 52, 55], scale: [45, 47, 48, 50, 52, 53, 55] },
      { root: 45, tones: [45, 49, 52, 55], scale: [45, 46, 49, 50, 52, 53, 55] },
    ];
    const ch = form[s.bar % 8], nextCh = form[(s.bar + 1) % 8];
    const b = s.beat % 4;
    const swing = spb * 0.66;
    // walking bass
    let bn;
    if (b === 0) bn = ch.root;
    else if (b === 3) bn = nextCh.root + (Math.random() < 0.5 ? 1 : -1);
    else bn = ch.tones[1 + Math.floor(Math.random() * 3)] - 12 * (Math.random() < 0.6 ? 1 : 0);
    while (bn > 52) bn -= 12; while (bn < 36) bn += 12;
    this.bass(NOTE(bn), t, spb * 0.9, out);
    // ride: ding, ding-a ding
    this.hat(t, 0.06, out, 0.35, 5200);
    if (b === 1 || b === 3) { this.hat(t + swing, 0.035, out, 0.2, 5600); this.hat(t, 0.05, out, 0.06, 8000); }
    // brushes swish on 2 & 4
    if (b === 1 || b === 3) this.hat(t, 0.04, out, 0.18, 2500);
    if (b === 0 && Math.random() < 0.3) this.kick(t, 0.12, out);
    // rhodes comping (Charleston-ish)
    if ((b === 0 && Math.random() < 0.7) || (b === 1 && Math.random() < 0.35) || (b === 2 && Math.random() < 0.25)) {
      const at = t + (Math.random() < 0.5 ? swing : 0);
      for (const n of ch.tones.slice(1)) this.rhodes(NOTE(n + 12), at, spb * (0.6 + Math.random()), 0.045, out);
    }
    // sax: phrases of swung eighths with rests
    if (!B.phrase || B.phrase <= 0) { B.phrase = Math.random() < 0.55 ? 4 + Math.floor(Math.random() * 8) : -(2 + Math.floor(Math.random() * 4)); }
    if (B.phrase > 0) {
      for (const off of [0, swing]) {
        if (Math.random() < 0.18) continue;
        const scale = ch.scale.map(n => n + 12);
        let cur = B.lastLead;
        const cands = scale.flatMap(n => [n, n + 12]).filter(n => Math.abs(n - cur) <= 4 && n >= 62 && n <= 84);
        let note = cands.length ? cands[Math.floor(Math.random() * cands.length)] : scale[0] + 12;
        if (off === 0 && Math.random() < 0.5) note = ch.tones[Math.floor(Math.random() * 4)] + 24;
        B.lastLead = note;
        this.sax(NOTE(note), t + off, (off === 0 ? swing : spb - swing) * (Math.random() < 0.3 ? 1.8 : 0.95), 0.09, out);
      }
      B.phrase--;
    } else B.phrase++;
  }
  bass(freq, t, dur, out) {
    const C = this.ctx;
    const o = C.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = C.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq / 2;
    const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(250, t + dur);
    const g = C.createGain(); this.env(g, t, 0.01, 0.32, dur);
    o.connect(f); o2.connect(f); f.connect(g).connect(out);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  rhodes(freq, t, dur, vol, out) {
    const C = this.ctx;
    const o = C.createOscillator(); o.frequency.value = freq;
    const m = C.createOscillator(); m.frequency.value = freq; const mg = C.createGain();
    mg.gain.setValueAtTime(freq * 1.2, t); mg.gain.exponentialRampToValueAtTime(freq * 0.05, t + 0.4);
    m.connect(mg).connect(o.frequency);
    const trem = C.createOscillator(); trem.frequency.value = 5; const tg = C.createGain(); tg.gain.value = vol * 0.3;
    const g = C.createGain(); this.env(g, t, 0.004, vol, dur + 0.6);
    trem.connect(tg).connect(g.gain);
    o.connect(g).connect(out);
    o.start(t); m.start(t); trem.start(t); const e = t + dur + 0.7; o.stop(e); m.stop(e); trem.stop(e);
  }
  sax(freq, t, dur, vol, out) {
    const C = this.ctx;
    const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(freq * 0.985, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
    const vib = C.createOscillator(); vib.frequency.value = 5.5; const vg = C.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(freq * 0.012, t + dur);
    vib.connect(vg).connect(o.frequency);
    const f1 = C.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 1100; f1.Q.value = 1.1;
    const f2 = C.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.setValueAtTime(1800, t); f2.frequency.linearRampToValueAtTime(3200, t + 0.05); f2.frequency.linearRampToValueAtTime(1500, t + dur);
    const br = this.noiseSource(); const bf = C.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = freq * 2; bf.Q.value = 3; const bg = C.createGain(); this.env(bg, t, 0.01, vol * 0.25, dur);
    br.connect(bf).connect(bg).connect(out);
    const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.03); g.gain.setValueAtTime(vol * 0.8, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    o.connect(f1).connect(f2).connect(g).connect(out);
    o.start(t); vib.start(t); br.start(t, Math.random()); const e = t + dur + 0.1; o.stop(e); vib.stop(e); br.stop(e);
  }
}
