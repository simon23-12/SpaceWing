"""Voice-over generator: renders every line from tools/lines.json with Piper TTS (local, free) into
public/assets/voice/<hash>.mp3 and writes index.json {hash: seconds}.

Voices (all freely licensed, see README):
  de_DE-thorsten-high, de_DE-thorsten_emotional-medium, de_DE-kerstin-low  (CC0)
  de_DE-mls-medium (Multilingual LibriSpeech, CC-BY 4.0)
Usage: ../SpaceWing_vendor/piper/venv/bin/python tools/voices.py [--force]
The radio effect is applied at runtime (Web Audio), so the same file works face to face and over comms."""
import json, os, re, subprocess, sys, tempfile, wave
import numpy as np
from piper import PiperVoice, SynthesisConfig

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICES = os.path.join(REPO, '..', 'SpaceWing_vendor', 'piper', 'voices')
OUT = os.path.join(REPO, 'public', 'assets', 'voice')
FORCE = '--force' in sys.argv

# speaker -> (model, speaker_id, length_scale, ffmpeg effect)
ROBOT = 'aecho=0.8:0.8:7|11:0.45|0.35,flanger=delay=1.5:depth=1.5:speed=0.6,highpass=f=140'
COMPUTER = 'aecho=0.6:0.5:4:0.25,highpass=f=110'
CAST = {
    'mags': ('mls', 51, 1.0, None), 'juno': ('mls', 136, 1.0, None), 'varga': ('mls', 98, 1.08, None),
    'haendler': ('mls', 187, 1.0, None), 'noor': ('mls', 120, 1.0, None), 'saffi': ('mls', 15, 1.0, None),
    'gast_rana': ('mls', 130, 1.0, None), 'gast_ilse': ('mls', 155, 1.0, None), 'crew_b': ('mls', 179, 1.0, None),
    'crew_c': ('mls', 10, 1.0, None), 'crew_d': ('mls', 164, 1.0, None),
    'oduya': ('mls', 124, 1.0, None), 'morrow': ('mls', 213, 1.0, None), 'brandt': ('thorsten', None, 1.05, None),
    'vesper': ('mls', 39, 1.1, None), 'rook': ('emo', 2, 1.0, None), 'schakal': ('emo', 1, 0.95, None),
    'gast_kesh': ('mls', 7, 1.05, None), 'gast_tomas': ('mls', 116, 1.0, None), 'crew_a': ('mls', 22, 1.0, None),
    'crew_e': ('mls', 115, 1.0, None), 'kix': ('thorsten', None, 1.05, ROBOT), 'comp': ('kerstin', None, 0.95, COMPUTER),
    'tanker': ('mls', 95, 1.0, None), 'quelle': ('mls', 62, 1.0, None), 'control': ('mls', 25, 1.0, None),
    'gilde': ('mls', 109, 1.0, None), 'gold': ('mls', 49, 1.0, None), 'boerse': ('mls', 58, 1.0, None),
    'generic': ('mls', 182, 1.0, None), 'mags_weak': ('mls', 51, 1.15, None),
}
ALIAS = {
    'Mags': 'mags', 'Mags (Turm)': 'mags', 'Mags (Funk)': 'mags', 'Mags (schwach)': 'mags_weak', 'Juno': 'juno', 'Juno (Funk)': 'juno',
    'Konsulin Varga': 'varga', 'Noor Haddad-Lund': 'noor', 'Ol’ Kesh': 'gast_kesh', 'Kapitän Morrow': 'morrow',
    'Kommodore Brandt': 'brandt', 'Silas Rook': 'rook', 'Schakal Alpha': 'schakal', 'Bordcomputer': 'comp',
    'Tropfen 7': 'tanker', 'Quelle Flugleitung': 'quelle', 'Flugleitung ': 'control', 'Ringgilde Patrouille': 'gilde',
    'Goldwacht': 'gold', 'Söldnerbörse': 'boerse',
}
SKIP_SPEAKERS = {'who', 'self'}
PIRATE = re.compile(r'Schakal|sterben|weh\.|Fracht hast du|Feuer frei|Abdrehen')


def cast_for(line):
    s = line['speaker']
    if s in SKIP_SPEAKERS:
        return None
    if s == 'generic' and PIRATE.search(line['text']):
        return CAST['schakal']
    return CAST.get(ALIAS.get(s, s)) or CAST['generic']


def fnv(text):
    h = 0x811c9dc5
    b = text.encode('utf-16-le')
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 0x01000193) & 0xffffffff
    return format(h, '08x')


def speakable(t):
    t = t.replace('{name}', 'Pilot')
    for a, b in (('„', ''), ('“', ''), ('”', ''), ('»', ''), ('«', ''), ('–', ','), ('—', ','), ('…', '.'), ('Ol’', 'Old'), ('’', "'"),
                 ('SW-2', 'S W zwei'), ('KX-9', 'K X neun'), ('4-117', 'vier eins siebzehn'), ('m/s', 'Meter pro Sekunde'),
                 ('Helium-3', 'Helium drei'), ('HL-7', 'H L sieben'), ('Cr ', 'Kredits '), (' Cr', ' Kredits')):
        t = t.replace(a, b)
    t = re.sub(r'(\d)\.(\d{3})', r'\1\2', t)   # 1.200 -> 1200
    return t


def main():
    os.makedirs(OUT, exist_ok=True)
    lines = json.load(open(os.path.join(REPO, 'tools', 'lines.json')))
    idx_path = os.path.join(OUT, 'index.json')
    index = {} if FORCE else (json.load(open(idx_path)) if os.path.exists(idx_path) else {})
    models = {}
    def model(k):
        if k not in models:
            fn = {'mls': 'de_DE-mls-medium', 'emo': 'de_DE-thorsten_emotional-medium', 'thorsten': 'de_DE-thorsten-high', 'kerstin': 'de_DE-kerstin-low'}[k]
            models[k] = PiperVoice.load(os.path.join(VOICES, fn + '.onnx'))
        return models[k]
    keep = set()
    for n, line in enumerate(lines):
        c = cast_for(line)
        if not c:
            continue
        h = fnv(line['text'])
        keep.add(h)
        mp3 = os.path.join(OUT, h + '.mp3')
        if h in index and os.path.exists(mp3):
            continue
        mk, sid, ls, fx = c
        v = model(mk)
        cfg = SynthesisConfig(speaker_id=sid, length_scale=ls)
        sr = v.config.sample_rate
        parts = []
        for ch in v.synthesize(speakable(line['text']), syn_config=cfg):
            a = ch.audio_float_array
            loud = np.where(np.abs(a) > 0.015)[0]
            if len(loud):   # trim each sentence, then join with a short natural pause
                a = a[max(0, loud[0] - int(0.03 * sr)):loud[-1] + int(0.06 * sr)]
            parts += [a, np.zeros(int(0.22 * sr), np.float32)]
        audio = np.concatenate([np.zeros(int(0.04 * sr), np.float32)] + parts[:-1])
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tf:
            w = wave.open(tf.name, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes((np.clip(audio, -1, 1) * 32000).astype(np.int16).tobytes()); w.close()
            af = ['-af', fx] if fx else []
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tf.name, *af, '-ac', '1', '-ar', '22050', '-b:a', '32k', mp3], check=True)
            os.unlink(tf.name)
        index[h] = round(len(audio) / sr, 2)
        print(f'{n + 1}/{len(lines)} {line["speaker"]}: {line["text"][:60]}', flush=True)
    # drop stale files
    for f in os.listdir(OUT):
        if f.endswith('.mp3') and f[:-4] not in keep:
            os.unlink(os.path.join(OUT, f))
    index = {k: v for k, v in index.items() if k in keep}
    json.dump(index, open(idx_path, 'w'), separators=(',', ':'))
    print('voiced lines:', len(index))


if __name__ == '__main__':
    main()
