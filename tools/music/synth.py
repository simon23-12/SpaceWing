"""Small offline synthesizer for the SpaceWing soundtrack (numpy/scipy, no samples).

Voices: band-limited detuned saws/squares (CS-80 style brass and pads), FM bells and electric piano,
sub bass, plucks, drums (kick, clap, snare, hats, toms, deep hits), noise beds (rain, risers).
Effects: block-wise resonant low-pass with moving cutoff, feedback delay, stereo convolution reverb
with a synthetic hall, kick side-chain, soft-clip mastering. Everything renders into stereo float buffers.
"""
import numpy as np
from scipy import signal

SR = 44100
RNG = np.random.default_rng(7)


def midi(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12)


class Track:
    """A stereo buffer with a tempo grid; voices are mixed in at beat positions."""

    def __init__(self, bpm, bars, beats_per_bar=4, tail=6.0):
        self.bpm, self.bpb = bpm, beats_per_bar
        self.spb = 60.0 / bpm
        self.length = bars * beats_per_bar * self.spb
        self.n = int((self.length + tail) * SR)
        self.buses = {}

    def bus(self, name):
        if name not in self.buses:
            self.buses[name] = np.zeros((2, self.n))
        return self.buses[name]

    def t(self, bar, beat=0.0):
        return (bar * self.bpb + beat) * self.spb

    def add(self, busname, x, at, pan=0.0, gain=1.0):
        """Mix mono or stereo x into a bus at time `at` (s)."""
        b = self.bus(busname)
        i0 = int(at * SR)
        if i0 >= self.n:
            return
        if x.ndim == 1:
            l = np.sqrt(0.5 * (1 - pan)) * 1.414
            r = np.sqrt(0.5 * (1 + pan)) * 1.414
            x = np.vstack([x * l, x * r])
        m = min(x.shape[1], self.n - i0)
        b[:, i0:i0 + m] += x[:, :m] * gain


# ------------------------------------------------------------------ envelopes

def adsr(n, a, d, s, r, hold=None):
    """n samples total; a/d/r in seconds; hold = seconds at sustain before release (default: fill)."""
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    env = np.zeros(n)
    k = 0
    if a_n:
        m = min(a_n, n); env[:m] = np.linspace(0, 1, a_n, endpoint=False)[:m]; k = m
    if k < n and d_n:
        m = min(d_n, n - k); env[k:k + m] = np.linspace(1, s, d_n, endpoint=False)[:m]; k += m
    rel_start = n - r_n if hold is None else min(n, k + int(hold * SR))
    if k < rel_start:
        env[k:rel_start] = s; k = rel_start
    if k < n:
        level = env[k - 1] if k > 0 else s
        env[k:] = level * np.exp(-np.arange(n - k) / max(1, r_n) * 4.5)
    return env


def expdecay(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


# ------------------------------------------------------------------ oscillators

def _phase(freq, n, vib=0.0, vib_rate=5.0, vib_delay=0.0, glide=None):
    t = np.arange(n) / SR
    f = np.full(n, float(freq))
    if glide is not None:
        f0, gt = glide
        k = np.clip(t / gt, 0, 1)
        f = f0 + (f - f0) * (1 - (1 - k) ** 3)
    if vib:
        depth = vib * np.clip((t - vib_delay) / 1.0, 0, 1)
        f = f * (1 + depth * np.sin(2 * np.pi * vib_rate * t + RNG.uniform(0, 6.28)))
    return 2 * np.pi * np.cumsum(f) / SR, f


def _blep(p, dt):
    """PolyBLEP correction for a naive ramp at phase p (0..1) with increment dt."""
    y = np.zeros_like(p)
    m = p < dt
    t = p[m] / dt[m]; y[m] = t + t - t * t - 1
    m = p > 1 - dt
    t = (p[m] - 1) / dt[m]; y[m] = t * t + t + t + 1
    return y


def saw(freq, n, **kw):
    """Band-limited sawtooth (polyBLEP)."""
    ph, f = _phase(freq, n, **kw)
    p = (ph / (2 * np.pi) + RNG.uniform(0, 1)) % 1.0
    dt = np.clip(f / SR, 1e-6, 0.5)
    return (2 * p - 1 - _blep(p, dt)) * 0.6


def square(freq, n, **kw):
    ph, f = _phase(freq, n, **kw)
    p = (ph / (2 * np.pi)) % 1.0
    dt = np.clip(f / SR, 1e-6, 0.5)
    a = 2 * p - 1 - _blep(p, dt)
    p2 = (p + 0.5) % 1.0
    b = 2 * p2 - 1 - _blep(p2, dt)
    return (a - b) * 0.5


def sine(freq, n, **kw):
    ph, _ = _phase(freq, n, **kw)
    return np.sin(ph)


def supersaw(freq, n, voices=5, detune=0.012, **kw):
    out = np.zeros(n)
    for v in range(voices):
        d = 1 + detune * (v - (voices - 1) / 2) / max(1, (voices - 1) / 2)
        out += saw(freq * d, n, **kw)
    return out / np.sqrt(voices)


def fm(freq, n, ratio, index, idx_decay=1.0):
    t = np.arange(n) / SR
    mod = index * np.exp(-t / idx_decay) * np.sin(2 * np.pi * freq * ratio * t)
    return np.sin(2 * np.pi * freq * t + mod)


def noise(n):
    return RNG.standard_normal(n)


# ------------------------------------------------------------------ filters

def lowpass(x, cutoff, q=0.7, block=256):
    """Resonant low-pass; cutoff may be a scalar or an array (per sample, sampled per block)."""
    if np.isscalar(cutoff):
        b, a = _lp_coef(cutoff, q)
        return signal.lfilter(b, a, x)
    y = np.zeros_like(x)
    zi = np.zeros(2)
    for i in range(0, len(x), block):
        c = float(np.clip(cutoff[min(i, len(cutoff) - 1)], 30, SR * 0.45))
        b, a = _lp_coef(c, q)
        y[i:i + block], zi = signal.lfilter(b, a, x[i:i + block], zi=zi)
    return y


def _lp_coef(fc, q):
    w0 = 2 * np.pi * fc / SR
    al = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    b = np.array([(1 - c) / 2, 1 - c, (1 - c) / 2])
    a = np.array([1 + al, -2 * c, 1 - al])
    return b / a[0], a / a[0]


def highpass(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), 'high')
    return signal.lfilter(b, a, x)


def bandpass(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band')
    return signal.lfilter(b, a, x)


# ------------------------------------------------------------------ instruments

def brass(freq, dur, rel=1.5, bright=1.0, attack=0.25, vib=0.006):
    """CS-80 style brass: detuned saws through a filter that swells open with the envelope."""
    n = int((dur + rel) * SR)
    x = supersaw(freq, n, voices=3, detune=0.006, vib=vib, vib_rate=5.2, vib_delay=0.5)
    env = adsr(n, attack, 0.6, 0.75, rel, hold=dur - attack - 0.6)
    fenv = 300 + bright * (freq * 3 + 1800) * adsr(n, attack * 1.6, 1.0, 0.55, rel, hold=dur)
    return lowpass(x, fenv, q=1.1) * env


def pad(freq, dur, rel=3.0, cutoff=1400, attack=1.5, voices=5, detune=0.01, sweep=None):
    n = int((dur + rel) * SR)
    x = supersaw(freq, n, voices=voices, detune=detune, vib=0.002, vib_rate=0.3)
    env = adsr(n, attack, 1.0, 0.85, rel, hold=dur - attack - 1.0)
    if sweep is not None:
        t = np.arange(n) / SR
        cut = cutoff * (1 + sweep * 0.5 * (1 - np.cos(2 * np.pi * t / max(dur, 1))))
        return lowpass(x, cut, q=0.9) * env
    return lowpass(x, cutoff, q=0.8) * env


def bell(freq, dur=6.0, index=3.0):
    n = int(dur * SR)
    return (fm(freq, n, 3.5, index, 0.6) * 0.7 + fm(freq * 2.0, n, 1.4, 1.5, 0.3) * 0.3) * expdecay(n, dur / 4)


def epiano(freq, dur, rel=0.8):
    n = int((dur + rel) * SR)
    tone = fm(freq, n, 1.0, 1.4, 0.5) * 0.8 + fm(freq, n, 14.0, 0.6, 0.06) * 0.25
    return tone * adsr(n, 0.004, 1.2, 0.35, rel, hold=dur) * (0.6 + 0.4 * expdecay(n, 1.5))


def subbass(freq, dur, rel=0.4, drive=1.4):
    n = int((dur + rel) * SR)
    x = sine(freq, n) + 0.25 * sine(freq * 2, n)
    return np.tanh(drive * x) * adsr(n, 0.01, 0.2, 0.9, rel, hold=dur)


def acidbass(freq, dur, cutoff=900, decay=0.18, q=3.0):
    n = int((dur + 0.08) * SR)
    x = saw(freq, n) * 0.7 + square(freq * 0.5, n) * 0.3
    fenv = 120 + cutoff * expdecay(n, decay)
    return np.tanh(1.6 * lowpass(x, fenv, q=q)) * adsr(n, 0.003, 0.08, 0.7, 0.06, hold=dur)


def pluck(freq, dur=0.6, bright=3000):
    n = int(dur * SR)
    x = saw(freq, n) * 0.6 + square(freq, n) * 0.3
    return lowpass(x, 200 + bright * expdecay(n, 0.12), q=1.5) * expdecay(n, dur / 3)


def lead(freq, dur, rel=0.6, glide=None):
    n = int((dur + rel) * SR)
    x = saw(freq, n, vib=0.007, vib_rate=5.5, vib_delay=0.25, glide=glide) * 0.7 + square(freq * 1.003, n, vib=0.006, vib_rate=5.5, vib_delay=0.25) * 0.3
    env = adsr(n, 0.03, 0.3, 0.8, rel, hold=dur)
    return lowpass(x, 2600 + 1600 * adsr(n, 0.05, 0.6, 0.4, rel, hold=dur), q=1.2) * env


def sax(freq, dur, rel=0.5, glide=None):
    """Breathy synth reed for the noir theme: filtered saw, slow vibrato and air noise."""
    n = int((dur + rel) * SR)
    x = saw(freq, n, vib=0.009, vib_rate=4.6, vib_delay=0.35, glide=glide)
    env = adsr(n, 0.09, 0.4, 0.8, rel, hold=dur)
    body = lowpass(x, 900 + 1500 * env, q=2.2)
    air = bandpass(noise(n), 1200, 5000) * 0.05 * env
    return (body + air) * env


# drums
def kick(punch=1.0, length=0.55):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = 46 + 150 * np.exp(-t / 0.035) * punch
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * expdecay(n, 0.22)
    click = highpass(noise(n), 2000) * expdecay(n, 0.004) * 0.4
    return np.tanh(1.8 * (body + click))


def clap(length=0.5):
    n = int(length * SR)
    x = bandpass(noise(n), 900, 4500)
    env = np.zeros(n)
    for k, d in enumerate((0, 0.011, 0.022)):
        i = int(d * SR); env[i:] += expdecay(n - i, 0.008 if k < 2 else 0.12)
    return x * env * 0.8


def snare(length=0.4):
    n = int(length * SR)
    tone = sine(185, n) * expdecay(n, 0.05) * 0.6
    sn = bandpass(noise(n), 1500, 8000) * expdecay(n, 0.11)
    return tone + sn


def hat(open_=False):
    n = int((0.35 if open_ else 0.08) * SR)
    return highpass(noise(n), 7000, 3) * expdecay(n, 0.12 if open_ else 0.018) * 0.5


def tom(freq=110):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    f = freq * (1 + 0.6 * np.exp(-t / 0.05))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * expdecay(n, 0.18)


def boom(length=4.0):
    """Deep distant hit (taiko through a hall)."""
    n = int(length * SR)
    t = np.arange(n) / SR
    f = 38 + 50 * np.exp(-t / 0.08)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * expdecay(n, 0.9)
    x += lowpass(noise(n), 400) * expdecay(n, 0.25) * 0.4
    return np.tanh(1.5 * x)


def riser(length, lo=200, hi=6000):
    n = int(length * SR)
    t = np.linspace(0, 1, n)
    cut = lo * (hi / lo) ** t
    return lowpass(noise(n), cut, q=4.0) * (t ** 2) * 0.5


def rain(length):
    """Soft rain on glass: band-limited noise with random droplets."""
    n = int(length * SR)
    bed = bandpass(noise(n), 400, 7000) * 0.05
    drops = np.zeros(n)
    idx = RNG.integers(0, n - 2000, int(length * 40))
    for i in idx:
        drops[i:i + 400] += RNG.uniform(0.02, 0.08) * np.sin(np.arange(400) * RNG.uniform(0.3, 0.9)) * expdecay(400, 0.002)
    return bed + highpass(drops, 1500)


# ------------------------------------------------------------------ effects

def hall_ir(length=4.0, predelay=0.02, damp=0.6, seed=1):
    r = np.random.default_rng(seed)
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    for c in range(2):
        x = r.standard_normal(n) * np.exp(-t * 6.9 / length)
        # darker tail: low-pass gets lower over time
        x = lowpass(x, 9000 * (1 - damp * np.clip(t / length, 0, 1)) + 600)
        ir[c] = x
    pd = int(predelay * SR)
    ir = np.concatenate([np.zeros((2, pd)), ir], axis=1)
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


def reverb(x, ir, wet=0.3):
    """x stereo (2, n)."""
    out = np.zeros((2, x.shape[1] + ir.shape[1] - 1))
    for c in range(2):
        out[c] = signal.fftconvolve(x[c], ir[c])
    out = out[:, :x.shape[1]]
    return x * (1 - wet) + out * wet


def delay(x, time, feedback=0.4, mix=0.3, pingpong=True):
    d = int(time * SR)
    out = x.copy()
    tap = x.copy()
    for k in range(1, 8):
        tap = tap * feedback
        if pingpong:
            tap = tap[::-1]
        sh = np.zeros_like(x)
        if d * k < x.shape[1]:
            sh[:, d * k:] = tap[:, :x.shape[1] - d * k]
        out += sh * mix
    return out


def sidechain(track, kicks, depth=0.6, release=0.25):
    """Gain curve ducking at every kick time (s)."""
    g = np.ones(track.n)
    rel = int(release * SR)
    curve = 1 - depth * np.exp(-np.arange(rel) / (rel / 4))
    for at in kicks:
        i = int(at * SR)
        m = min(rel, track.n - i)
        if m > 0:
            g[i:i + m] = np.minimum(g[i:i + m], curve[:m])
    return g


def master(x, target=-1.0, drive=1.2):
    x = x - np.mean(x, axis=1, keepdims=True)
    peak = np.max(np.abs(x)) + 1e-9
    x = np.tanh(drive * x / peak) / np.tanh(drive)
    return x * 10 ** (target / 20)


def write(path, x, loop_fade=0.0):
    """Stereo float -> 16-bit wav."""
    from scipy.io import wavfile
    if loop_fade:
        n = int(loop_fade * SR)
        x[:, -n:] *= np.linspace(1, 0, n)
    wavfile.write(path, SR, (np.clip(x, -1, 1).T * 32767).astype(np.int16))
