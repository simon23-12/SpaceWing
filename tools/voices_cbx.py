"""Voice-over generator v2: Chatterbox Multilingual (Resemble AI, MIT) cloning public-domain LibriVox voices,
with a Whisper check of every line against the script (regenerated until it says what is written).

Writes public/assets/voice/<hash>.mp3 + index.json {hash: seconds}; same keys as before (FNV-1a of the line).
Usage: ../SpaceWing_vendor/cbx/venv/bin/python tools/voices_cbx.py <worker> <workers>   (then: ... --merge)
References: ../SpaceWing_vendor/voice_refs/clips/*.wav (12 s excerpts of LibriVox German recordings, public domain)."""
import difflib, json, os, re, subprocess, sys, tempfile
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VEND = os.path.join(REPO, '..', 'SpaceWing_vendor')
REFS = os.path.join(VEND, 'voice_refs', 'clips')
OUT = os.path.join(REPO, 'public', 'assets', 'voice')
TMP = os.path.join(VEND, 'voice_tmp')

ROBOT = 'aecho=0.8:0.8:7|11:0.4|0.3,flanger=delay=1.5:depth=1.2:speed=0.6,highpass=f=140'
COMPUTER = 'aecho=0.6:0.5:4:0.22,highpass=f=120'
# speaker -> (reference clip, exaggeration, cfg_weight, ffmpeg effect)
CAST = {
    'mags': ('ak_04_hampelmann_hok', 0.6, 0.5, None), 'juno': ('ak_05_christianweihnachten_cs', 0.5, 0.5, None),
    'varga': ('ak_08_weihnachtsrezepte_nt', 0.35, 0.55, None), 'haendler': ('ak_03_speisekammer_ss', 0.55, 0.5, None),
    'noor': ('ak_06_nikolausabend_rosegger_ava', 0.55, 0.5, None), 'saffi': ('ak_07_christnacht_jn', 0.6, 0.5, None),
    'gast_rana': ('ak_07_christnacht_jn', 0.55, 0.45, None), 'gast_ilse': ('ak_11_weihnachtsschnee_ek', 0.55, 0.5, None),
    'crew_b': ('ak_03_speisekammer_ss', 0.45, 0.5, None), 'crew_c': ('ak_06_nikolausabend_rosegger_ava', 0.45, 0.5, None),
    'crew_d': ('ak_11_weihnachtsschnee_ek', 0.6, 0.45, None),
    'oduya': ('ak_10_zweiweihnachtsabende_ksn', 0.5, 0.5, None), 'morrow': ('ak_23_stillenacht_mah', 0.5, 0.5, None),
    'brandt': ('ak_17_yorkshire_bg', 0.45, 0.55, None), 'vesper': ('gr_202_meister_pfriem', 0.4, 0.55, None),
    'rook': ('ak_19_freudendeswinters_hr', 0.75, 0.45, None), 'schakal': ('gr_209_rumpelstilzchen', 0.8, 0.4, None),
    'gast_kesh': ('gr_124_lebenszeit', 0.5, 0.5, None), 'gast_tomas': ('gr_220_vom_klugen_schneiderlein', 0.5, 0.5, None),
    'crew_a': ('gr_135_die_wichtelmaenner', 0.45, 0.5, None), 'crew_e': ('gr_114_erbsenprobe', 0.4, 0.5, None),
    'kix': ('ak_02_daddeldu_fm', 0.5, 0.5, ROBOT), 'comp': ('ak_08_weihnachtsrezepte_nt', 0.3, 0.6, COMPUTER),
    'tanker': ('gr_206_rapunzel', 0.55, 0.5, None), 'quelle': ('ak_05_christianweihnachten_cs', 0.45, 0.5, None),
    'control': ('gr_214_spindel_weberschiffchen_und_nadel', 0.4, 0.5, None), 'gilde': ('gr_180_frau_holle', 0.5, 0.5, None),
    'gold': ('gr_160_diesiebenraben', 0.5, 0.5, None), 'boerse': ('ak_10_zweiweihnachtsabende_ksn', 0.45, 0.5, None),
    'generic': ('gr_215_strohhalm_kohle_und_bohne', 0.5, 0.5, None), 'mags_weak': ('ak_04_hampelmann_hok', 0.35, 0.5, None),
}
ALIAS = {
    'Mags': 'mags', 'Mags (Turm)': 'mags', 'Mags (Funk)': 'mags', 'Mags (schwach)': 'mags_weak', 'Juno': 'juno', 'Juno (Funk)': 'juno',
    'Konsulin Varga': 'varga', 'Noor Haddad-Lund': 'noor', 'Ol’ Kesh': 'gast_kesh', 'Kapitän Morrow': 'morrow',
    'Kommodore Brandt': 'brandt', 'Silas Rook': 'rook', 'Schakal Alpha': 'schakal', 'Bordcomputer': 'comp',
    'Tropfen 7': 'tanker', 'Quelle Flugleitung': 'quelle', 'Flugleitung ': 'control', 'Ringgilde Patrouille': 'gilde',
    'Goldwacht': 'gold', 'Söldnerbörse': 'boerse',
}
SKIP = {'who', 'self'}
PIRATE = re.compile(r'Schakal|sterben|weh\.|Fracht hast du|Feuer frei|Abdrehen')


def cast_for(line):
    s = line['speaker']
    if s in SKIP:
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
    for a, b in (('„', ''), ('“', ''), ('”', ''), ('»', ''), ('«', ''), ('–', ','), ('—', ','), ('…', '...'), ('Ol’', 'Old'), ('’', "'"),
                 ('SW-2', 'S W zwei'), ('KX-9', 'K X neun'), ('4-117', 'vier eins siebzehn'), ('m/s', 'Meter pro Sekunde'),
                 ('Helium-3', 'Helium drei'), ('HL-7', 'H L sieben'), ('Cr ', 'Kredits '), (' Cr', ' Kredits'), ('L4', 'L vier'),
                 ('2260', 'zweitausendzweihundertsechzig'), ('Kix', 'Kicks')):
        t = t.replace(a, b)
    t = re.sub(r'(\d)\.(\d{3})', r'\1\2', t)
    return t


def words(t):
    t = t.lower().replace('ß', 'ss')
    return re.findall(r'[a-zäöü0-9]+', t)


def similarity(a, b):
    return difflib.SequenceMatcher(None, words(a), words(b)).ratio()


def trim(w, sr):
    loud = np.where(np.abs(w) > 0.012)[0]
    if len(loud):
        w = w[max(0, loud[0] - int(0.05 * sr)):loud[-1] + int(0.12 * sr)]
    return w


def done_hashes():
    out = set()
    for f in os.listdir(TMP):
        if f.startswith('part'):
            try: out |= set(json.load(open(os.path.join(TMP, f))))
            except Exception: pass
    return out


def work(worker, workers, device='cpu', reverse=False):
    import torch, librosa, soundfile as sf
    import perth
    if perth.PerthImplicitWatermarker is None:
        perth.PerthImplicitWatermarker = perth.DummyWatermarker
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from faster_whisper import WhisperModel
    torch.set_num_threads(max(2, (os.cpu_count() or 8) // workers))
    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    asr = WhisperModel('small', device='cpu', compute_type='int8')
    lines = json.load(open(os.path.join(REPO, 'tools', 'lines.json')))
    os.makedirs(OUT, exist_ok=True); os.makedirs(TMP, exist_ok=True)
    part_path = os.path.join(TMP, f'part{worker}{"_" + device if device != "cpu" else ""}.json')
    part = json.load(open(part_path)) if os.path.exists(part_path) else {}
    order = list(enumerate(lines))
    if reverse:
        order.reverse()
    for n, line in order:
        if n % workers != worker:
            continue
        c = cast_for(line)
        if not c:
            continue
        h = fnv(line['text'])
        if h in part or h in done_hashes():   # another worker (CPU / GPU) may have done it
            continue
        ref, exag, cfg, fx = c
        text = speakable(line['text'])
        best = None
        for attempt in range(4):
            torch.manual_seed(1000 * attempt + n)
            w = model.generate(text, language_id='de', audio_prompt_path=os.path.join(REFS, ref + '.wav'),
                               exaggeration=exag, cfg_weight=cfg, temperature=0.75 if attempt < 2 else 0.6)
            w = trim(w.squeeze(0).cpu().numpy(), model.sr)
            segs, _ = asr.transcribe(librosa.resample(w.astype(np.float32), orig_sr=model.sr, target_sr=16000), language='de', beam_size=5)
            heard = ' '.join(s.text.strip() for s in segs)
            sim = similarity(text, heard)
            if not best or sim > best[0]:
                best = (sim, w, heard)
            if sim >= 0.9:
                break
        sim, w, heard = best
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tf:
            sf.write(tf.name, w, model.sr)
            af = ['-af', (fx + ',' if fx else '') + 'loudnorm=I=-18:TP=-1.5']
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tf.name, *af, '-ac', '1', '-ar', '24000', '-b:a', '48k',
                            os.path.join(OUT, h + '.mp3')], check=True)
            os.unlink(tf.name)
        part[h] = {'d': round(len(w) / model.sr, 2), 'sim': round(sim, 3)}
        json.dump(part, open(part_path, 'w'))
        print(f'[{worker}] {n + 1}/{len(lines)} sim={sim:.2f} {line["speaker"]}: {line["text"][:50]} | heard: {heard[:50]}', flush=True)


def merge():
    lines = json.load(open(os.path.join(REPO, 'tools', 'lines.json')))
    keep = {fnv(l['text']) for l in lines if cast_for(l)}
    index, sims = {}, []
    for f in os.listdir(TMP):
        if f.startswith('part'):
            for h, v in json.load(open(os.path.join(TMP, f))).items():
                if h in keep:
                    index[h] = v['d']; sims.append((v['sim'], h))
    for f in os.listdir(OUT):
        if f.endswith('.mp3') and f[:-4] not in index:
            os.unlink(os.path.join(OUT, f))
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
    sims.sort()
    print('voiced', len(index), 'of', len(keep), '| mean similarity', round(sum(s for s, _ in sims) / max(1, len(sims)), 3), '| worst', sims[:5])


if __name__ == '__main__':
    if '--merge' in sys.argv:
        merge()
    else:
        work(int(sys.argv[1]), int(sys.argv[2]), device='mps' if '--mps' in sys.argv else 'cpu', reverse='--reverse' in sys.argv)
