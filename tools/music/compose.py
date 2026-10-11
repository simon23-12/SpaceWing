"""SpaceWing soundtrack, composed in code and rendered offline with synth.py.

Usage:  python tools/music/compose.py [name ...]      (default: all)
Writes public/assets/audio/music/<name>.mp3 (needs ffmpeg on PATH).

  menu            "Ringsturm"    – driving title theme, D minor, 118 BPM, drums, acid bass, brass, lead
  space_noir1     "Tannhäuser"   – slow C minor brass and pads, distant hits, rain (flight rotation)
  space_noir2     "Neonregen"    – pulsing arpeggio under a breathy reed melody, E minor (flight rotation)
  space_noir3     "Ringschatten" – drone, bells and a low choir pad, F minor (flight rotation)
  station_noir1   "Deck 4, nachts" – noir lounge: electric piano, brushed hats, upright-ish bass, reed theme
  station_noir2   "Kabinenlicht"   – rain on glass, slow pads and a lonely electric piano
"""
import os, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth as S
from synth import midi

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'assets', 'audio', 'music')
TMP = os.environ.get('TEMP', '/tmp')


def finish(tr, name, sends, ir_len=3.5, wet=0.25, kick_sc=None, sc_buses=(), loop_fade=3.0, gains=None):
    """Mix buses (with per-bus reverb sends), side-chain, master, export mp3."""
    gains = gains or {}
    ir = S.hall_ir(ir_len, damp=0.65)
    dry = np.zeros((2, tr.n)); send = np.zeros((2, tr.n))
    sc = S.sidechain(tr, kick_sc, 0.55, 0.22) if kick_sc else None
    for k, b in tr.buses.items():
        x = b * gains.get(k, 1.0)
        if sc is not None and k in sc_buses:
            x = x * sc
        dry += x
        send += x * sends.get(k, 0.0)
    wetsig = S.reverb(send, ir, wet=1.0)
    mix = dry + wetsig * wet * 4
    mix = np.vstack([S.highpass(mix[0], 32, 2), S.highpass(mix[1], 32, 2)])   # keep the rumble out
    mix = S.master(mix, target=-1.2, drive=1.3)
    mix = mix[:, :int((tr.length + (0 if loop_fade else 4)) * S.SR)]
    if loop_fade:
        n = int(loop_fade * S.SR); mix[:, -n:] *= np.linspace(1, 0, n) ** 0.7
        n0 = int(0.05 * S.SR); mix[:, :n0] *= np.linspace(0, 1, n0)
    wav = os.path.join(TMP, name + '.wav')
    S.write(wav, mix)
    mp3 = os.path.abspath(os.path.join(OUT, name + '.mp3'))
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3], check=True)
    os.remove(wav)
    print(f'{name}: {tr.length:.0f} s -> {mp3}')


def chord_notes(root_midi, kind):
    iv = {'m': [0, 3, 7], 'M': [0, 4, 7], 'm7': [0, 3, 7, 10], 'M7': [0, 4, 7, 11], 'm9': [0, 3, 7, 10, 14], 'sus': [0, 5, 7], 'add9': [0, 7, 14, 15], '7': [0, 4, 7, 10]}[kind]
    return [root_midi + i for i in iv]


# =============================================================================== title theme

def menu():
    tr = S.Track(118, 68)
    prog = [(38, 'm'), (34, 'M'), (31, 'm'), (33, 'M')]          # Dm  Bb  Gm  A   (2 bars each)
    voicing = {38: [50, 53, 57, 62], 34: [46, 53, 58, 62], 31: [43, 50, 55, 58], 33: [45, 52, 57, 61]}
    mel = [(0, 0, 69, 1), (0, 1, 74, 1), (0, 2, 77, 1.5), (0, 3.5, 76, .5), (1, 0, 74, 2), (1, 2, 69, 2),
           (2, 0, 70, 1), (2, 1, 74, 1), (2, 2, 77, 1.5), (2, 3.5, 79, .5), (3, 0, 77, 2), (3, 2, 74, 2),
           (4, 0, 67, 1), (4, 1, 70, 1), (4, 2, 74, 1.5), (4, 3.5, 72, .5), (5, 0, 70, 2), (5, 2, 67, 1), (5, 3, 69, 1),
           (6, 0, 69, 1), (6, 1, 73, 1), (6, 2, 76, 1.5), (6, 3.5, 79, .5), (7, 0, 77, 1), (7, 1, 76, 1), (7, 2, 73, 2)]
    kicks = []
    spb = tr.spb
    for bar in range(68):
        root, kind = prog[(bar // 2) % 4]
        sec = 'intro' if bar < 8 else 'A' if bar < 24 else 'B' if bar < 40 else 'break' if bar < 48 else 'drop' if bar < 64 else 'outro'
        t0 = tr.t(bar)
        # pads and brass: one chord per two bars
        if bar % 2 == 0:
            dur = 2 * 4 * spb
            for m in voicing[root]:
                cut = 500 + 2200 * min(1, bar / 8) if sec == 'intro' else 2600
                tr.add('pad', S.pad(midi(m), dur, rel=2.5, cutoff=cut, attack=0.6 if sec != 'intro' else 2.5), t0, pan=(m % 5 - 2) * 0.2, gain=0.26)
                if sec in ('A', 'B', 'drop', 'break', 'outro'):
                    tr.add('brass', S.brass(midi(m), dur * 0.92, rel=1.2, bright=1.3 if sec == 'drop' else 1.0, attack=0.12), t0, pan=(2 - m % 5) * 0.25, gain=0.24)
            if sec != 'break':
                tr.add('sub', S.subbass(midi(root - 12 if root > 36 else root), dur * 0.98), t0, gain=0.12 if sec != 'intro' else 0.1)
        # drums
        if sec in ('A', 'B', 'drop'):
            for b in range(4):
                tr.add('drums', S.kick(1.1), t0 + b * spb, gain=0.6); kicks.append(t0 + b * spb)
                tr.add('hats', S.hat(open_=sec != 'A'), t0 + (b + 0.5) * spb, pan=0.3, gain=0.35 if sec != 'A' else 0.5)
                if sec == 'drop':
                    tr.add('hats', S.hat(), t0 + (b + 0.25) * spb, pan=-0.3, gain=0.25); tr.add('hats', S.hat(), t0 + (b + 0.75) * spb, pan=-0.3, gain=0.25)
            for b in (1, 3):
                tr.add('snare', S.clap(), t0 + b * spb, gain=0.55); tr.add('snare', S.snare(), t0 + b * spb, gain=0.35)
            if bar % 8 == 7:
                for k, f in enumerate((180, 150, 120, 95)):
                    tr.add('drums', S.tom(f), t0 + (2 + k * 0.5) * spb, pan=0.4 - k * 0.25, gain=0.6)
            if bar % 8 == 0:
                tr.add('fx', S.highpass(S.noise(int(2.2 * S.SR)), 4000) * S.expdecay(int(2.2 * S.SR), 0.5) * 0.35, t0, gain=0.8)
            # acid bass in 16ths
            pat = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 0, 12, 10, 7]
            for i, iv in enumerate(pat):
                tr.add('bass', S.acidbass(midi(root + iv), spb / 4 * 0.85, cutoff=700 + 900 * (sec == 'drop') + 300 * np.sin(bar * 0.7 + i), decay=0.14), t0 + i * spb / 4, gain=0.26)
        if sec == 'intro':
            if bar in (0, 4):
                tr.add('boom', S.boom(5), t0, gain=0.8)
            if bar >= 4:
                for i in range(16):
                    m = voicing[root][i % 4] + 12
                    tr.add('arp', S.pluck(midi(m), 0.3, bright=500 + 3000 * (bar - 4 + i / 16) / 4), t0 + i * spb / 4, pan=0.5 * np.sin(i), gain=0.18)
            if bar == 4:
                tr.add('fx', S.riser(4 * 4 * spb, 150, 8000), t0, gain=0.6)
            if bar == 7:
                for k in range(8):
                    tr.add('drums', S.tom(200 - k * 15), t0 + k * spb / 2, gain=0.55)
        if sec in ('B', 'drop'):
            for i in range(16):
                m = voicing[root][(i * 3) % 4] + 24
                tr.add('arp', S.pluck(midi(m), 0.25, bright=2500), t0 + i * spb / 4, pan=0.6 * ((i % 2) * 2 - 1), gain=0.09)
        if sec in ('B', 'drop', 'break'):
            for (mb, beat, m, d) in mel:
                if mb == bar % 8:
                    up = 12 if sec == 'drop' else 0
                    tr.add('lead', S.lead(midi(m + up), d * spb * 0.95, rel=0.4), t0 + beat * spb, gain=0.3 if sec != 'break' else 0.22)
                    if sec == 'drop':
                        tr.add('brass', S.brass(midi(m), d * spb, rel=0.6, bright=1.4, attack=0.05), t0 + beat * spb, gain=0.1)
        if sec == 'break':
            if bar == 40:
                tr.add('boom', S.boom(6), t0, gain=0.9)
            if bar == 44:
                tr.add('fx', S.riser(4 * 4 * spb, 120, 9000), t0, gain=0.7)
            if bar >= 46:
                steps = 8 if bar == 46 else 16
                for i in range(steps):
                    tr.add('snare', S.snare(0.2), t0 + i * 4 * spb / steps, gain=0.18 + 0.25 * (bar - 46 + i / steps) / 2)
        if sec == 'outro' and bar == 64:
            tr.add('boom', S.boom(6), t0, gain=0.9)
    tr.buses['lead'] = S.delay(tr.bus('lead'), spb * 0.75, 0.35, 0.35)
    tr.buses['arp'] = S.delay(tr.bus('arp'), spb * 0.5, 0.3, 0.3)
    finish(tr, 'menu', sends={'pad': 0.6, 'brass': 0.4, 'lead': 0.35, 'snare': 0.35, 'arp': 0.4, 'boom': 0.6, 'fx': 0.5, 'drums': 0.08},
           ir_len=3.8, wet=0.22, kick_sc=kicks, sc_buses=('pad', 'brass', 'bass', 'sub', 'arp'),
           gains={'drums': 1.0, 'bass': 0.9, 'pad': 1.0, 'brass': 1.1, 'lead': 1.0, 'sub': 1.0})


# =============================================================================== flight: noir rotation

def noir1():
    """Tannhäuser: slow C minor, brass swells, distant hits, rain."""
    tr = S.Track(56, 42)
    prog = [([36, 48, 55, 62, 63], 4), ([32, 44, 51, 55, 60], 4), ([29, 41, 48, 56, 60, 63], 4), ([31, 43, 50, 55, 59, 62], 4)]   # Cm(add9) Abmaj7 Fm9 G(sus)
    theme = [(0, 67, 3), (3, 70, 1), (4, 72, 6), (10, 70, 2), (12, 67, 4), (16, 68, 3), (19, 67, 1), (20, 63, 6), (26, 65, 2), (28, 67, 8)]
    spb = tr.spb
    for i in range(0, 42, 4):
        chord, bars = prog[(i // 4) % 4]
        t0 = tr.t(i); dur = bars * 4 * spb
        for k, m in enumerate(chord):
            if k == 0:
                tr.add('sub', S.subbass(midi(m + 12), dur, rel=2, drive=1.1), t0, gain=0.11)
            else:
                tr.add('pad', S.pad(midi(m), dur, rel=4, cutoff=900, attack=3, sweep=1.2), t0, pan=(k - 2.5) * 0.3, gain=0.15)
        if (i // 4) % 2 == 0:
            tr.add('boom', S.boom(6), t0, gain=0.4)
        for _ in range(3):
            m = chord[S.RNG.integers(1, len(chord))] + 24
            tr.add('bell', S.bell(midi(m), 7, index=2.2), t0 + S.RNG.uniform(0, dur), pan=S.RNG.uniform(-0.8, 0.8), gain=0.07)
    # the theme on brass, twice (bars 8-23 and 26-41)
    for start in (8, 26):
        for (beat, m, d) in theme:
            at = tr.t(start) + beat * spb
            if at < tr.length - 2:
                tr.add('brass', S.brass(midi(m), d * spb, rel=2.5, bright=0.7, attack=0.45, vib=0.01), at, gain=0.16)
                tr.add('brass', S.brass(midi(m - 12), d * spb, rel=2.5, bright=0.4, attack=0.6), at, gain=0.08)
    tr.add('rain', S.rain(tr.length), 0, gain=0.6)
    finish(tr, 'space_noir1', sends={'pad': 0.7, 'brass': 0.6, 'bell': 0.9, 'boom': 0.7, 'sub': 0.1}, ir_len=6.0, wet=0.3)


def noir2():
    """Neonregen: pulsing filtered arpeggio, breathy reed melody, E minor."""
    tr = S.Track(84, 56)
    prog = [(40, 'm9'), (36, 'M7'), (43, 'M7'), (38, 'add9')]   # Em9 Cmaj7 Gmaj7 D(add9)
    mel = [(0, 71, 2), (2, 74, 1), (3, 76, 3), (6, 74, 1), (7, 71, 1), (8, 72, 4), (12, 71, 2), (14, 67, 2),
           (16, 74, 2), (18, 76, 1), (19, 79, 3), (22, 78, 2), (24, 76, 4), (28, 74, 2), (30, 71, 2)]
    spb = tr.spb
    for bar in range(56):
        root, kind = prog[(bar // 2) % 4]
        t0 = tr.t(bar)
        notes = chord_notes(root + 12, kind)
        if bar % 2 == 0:
            for k, m in enumerate(notes[:4]):
                tr.add('pad', S.pad(midi(m + 12), 8 * spb, rel=3, cutoff=1100, attack=1.2), t0, pan=(k - 1.5) * 0.35, gain=0.1)
            tr.add('sub', S.subbass(midi(root - 12 if root > 40 else root), 8 * spb * 0.97, drive=1.2), t0, gain=0.12)
        # arpeggio: 8ths, filter opening over the track
        if bar >= 4:
            for i in range(8):
                m = notes[(i * 2) % len(notes)] + (12 if i % 4 == 3 else 0)
                tr.add('arp', S.pluck(midi(m + 12), 0.5, bright=600 + 1800 * min(1, (bar - 4) / 24)), t0 + i * spb / 2, pan=0.5 if i % 2 else -0.5, gain=0.12)
        # soft pulse: muted kick and hats from bar 12
        if 12 <= bar < 52:
            for b in range(4):
                if b in (0, 2) or (b == 3 and bar % 2):
                    tr.add('drums', S.kick(0.6, 0.4) * 0.6, t0 + b * spb, gain=0.5)
                tr.add('hats', S.hat(), t0 + (b + 0.5) * spb, pan=0.25, gain=0.25)
            tr.add('snare', S.snare(0.3), t0 + 3 * spb, gain=0.18)
    for start in (16, 36):
        for (beat, m, d) in mel:
            at = tr.t(start) + beat * spb
            tr.add('lead', S.sax(midi(m - 12), d * spb * 0.95, rel=0.8), at, gain=0.22)
    tr.add('rain', S.rain(tr.length) * 0.5, 0)
    tr.buses['arp'] = S.delay(tr.bus('arp'), spb * 0.75, 0.4, 0.35)
    tr.buses['lead'] = S.delay(tr.bus('lead'), spb * 1.5, 0.3, 0.25)
    finish(tr, 'space_noir2', sends={'pad': 0.6, 'arp': 0.4, 'lead': 0.55, 'snare': 0.4}, ir_len=5.0, wet=0.28)


def noir3():
    """Ringschatten: drone, low choir-like pads and sparse bells, F minor."""
    tr = S.Track(50, 32)
    spb = tr.spb
    roots = [41, 37, 44, 39]   # F  Db  Ab  Eb
    for i in range(0, 32, 4):
        r = roots[(i // 4) % 4]; t0 = tr.t(i); dur = 16 * spb
        tr.add('sub', S.subbass(midi(r - 12 if r > 40 else r), dur, rel=3, drive=1.0), t0, gain=0.12)
        for k, iv in enumerate((12, 19, 24, 27)):
            tr.add('pad', S.pad(midi(r + iv), dur, rel=5, cutoff=700, attack=4, voices=7, detune=0.014, sweep=2.0), t0, pan=(k - 1.5) * 0.4, gain=0.12)
        for _ in range(5):
            m = r + int(S.RNG.choice([24, 27, 31, 36, 39]))
            tr.add('bell', S.bell(midi(m), 8, index=1.6), t0 + S.RNG.uniform(0, dur), pan=S.RNG.uniform(-0.9, 0.9), gain=0.06)
        if (i // 4) % 2 == 1:
            tr.add('boom', S.boom(7), t0 + 8 * spb, gain=0.45)
    n = int(tr.length * S.SR)
    tr.add('air', S.lowpass(S.noise(n), 500 + 300 * np.sin(np.arange(n) / S.SR * 0.2)) * 0.06, 0)
    finish(tr, 'space_noir3', sends={'pad': 0.8, 'bell': 1.0, 'boom': 0.8}, ir_len=7.0, wet=0.32)


# =============================================================================== station

def station1():
    """Deck 4, nachts: noir lounge, A minor."""
    tr = S.Track(68, 48)
    prog = [(45, 'm9'), (41, 'M7'), (38, 'm9'), (40, '7')]   # Am9 Fmaj7 Dm9 E7
    theme = [(0, 76, 2), (2, 74, 1), (3, 72, 1), (4, 71, 3), (7, 69, 1), (8, 72, 2), (10, 71, 1), (11, 69, 1), (12, 68, 4),
             (16, 69, 2), (18, 72, 1), (19, 76, 1), (20, 77, 3), (23, 76, 1), (24, 74, 2), (26, 72, 2), (28, 71, 4)]
    spb = tr.spb
    for bar in range(48):
        root, kind = prog[(bar // 2) % 4]
        t0 = tr.t(bar)
        notes = chord_notes(root + 12, kind)
        if bar % 2 == 0:
            tr.add('pad', sum_pad(notes, 8 * spb), t0, gain=0.07)
        # electric piano comping: on 1 and the and-of-2
        for beat, vel in ((0, 1.0), (1.5, 0.7)) if bar % 2 == 0 else ((0.5, 0.6), (2.5, 0.8)):
            for k, m in enumerate(notes[1:]):
                tr.add('ep', S.epiano(midi(m + 12), spb * 1.4), t0 + beat * spb + k * 0.012, pan=(k - 1.5) * 0.25, gain=0.07 * vel)
        # walking-ish bass
        for b, iv in enumerate((0, 7, 12, 10) if bar % 2 == 0 else (0, 3, 5, 7)):
            tr.add('bass', S.subbass(midi(root - 12 + iv if root > 40 else root + iv), spb * 0.8, rel=0.15, drive=1.6), t0 + b * spb, gain=0.13)
        if bar >= 4:
            for b in range(4):
                tr.add('hats', S.bandpass(S.noise(int(0.25 * S.SR)), 2500, 9000) * S.expdecay(int(0.25 * S.SR), 0.05) * 0.25, t0 + b * spb, pan=0.3, gain=0.6)
                tr.add('hats', S.hat(), t0 + (b + 0.66) * spb, pan=0.3, gain=0.15)
            tr.add('drums', S.kick(0.4, 0.4) * 0.5, t0, gain=0.5)
            tr.add('snare', S.snare(0.3) * 0.5, t0 + 2 * spb, gain=0.25)
    for start in (8, 28):
        for (beat, m, d) in theme:
            tr.add('lead', S.sax(midi(m - 12), d * spb * 0.95, rel=0.7), tr.t(start) + beat * spb, gain=0.24)
    tr.add('rain', S.rain(tr.length) * 0.35, 0)
    tr.buses['lead'] = S.delay(tr.bus('lead'), spb * 0.75, 0.25, 0.2)
    finish(tr, 'station_noir1', sends={'ep': 0.4, 'lead': 0.5, 'pad': 0.6, 'snare': 0.3}, ir_len=3.2, wet=0.25)


def sum_pad(notes, dur):
    out = None
    for k, m in enumerate(notes):
        x = S.pad(midi(m), dur, rel=3, cutoff=1000, attack=1.5)
        out = x if out is None else out + x
    return out


def station2():
    """Kabinenlicht: rain on glass, slow pads, a lonely electric piano. B minor."""
    tr = S.Track(60, 32)
    spb = tr.spb
    prog = [(47, 'm9'), (43, 'M7'), (40, 'm7'), (42, 'sus')]
    for bar in range(0, 32, 2):
        root, kind = prog[(bar // 2) % 4]
        t0 = tr.t(bar); notes = chord_notes(root + 12, kind)
        tr.add('pad', sum_pad(notes, 8 * spb), t0, gain=0.08)
        tr.add('sub', S.subbass(midi(root - 12 if root > 40 else root), 8 * spb, rel=1.5, drive=1.0), t0, gain=0.1)
        for k in range(4):
            m = notes[S.RNG.integers(0, len(notes))] + 12 * S.RNG.integers(1, 3)
            tr.add('ep', S.epiano(midi(m), spb * 2), t0 + (k * 2 + S.RNG.uniform(-0.1, 0.3)) * spb, pan=S.RNG.uniform(-0.6, 0.6), gain=0.08)
    tr.add('rain', S.rain(tr.length) * 0.9, 0)
    finish(tr, 'station_noir2', sends={'ep': 0.6, 'pad': 0.7}, ir_len=4.5, wet=0.3)


PIECES = {'menu': menu, 'space_noir1': noir1, 'space_noir2': noir2, 'space_noir3': noir3, 'station_noir1': station1, 'station_noir2': station2}

if __name__ == '__main__':
    for name in sys.argv[1:] or PIECES:
        PIECES[name]()
