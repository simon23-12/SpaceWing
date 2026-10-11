"""Quick look at a rendered track without listening: loudness over time, band balance and a spectrogram PNG.
Usage: python tools/music/analyze.py public/assets/audio/music/menu.mp3 [out.png]"""
import subprocess, sys
import numpy as np

path = sys.argv[1]
raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', '22050', '-'], capture_output=True, check=True).stdout
x = np.frombuffer(raw, np.int16).astype(float) / 32768
sr = 22050
win = sr * 4
rms = [20 * np.log10(np.sqrt(np.mean(x[i:i + win] ** 2)) + 1e-9) for i in range(0, len(x) - win, win)]
print(f'{len(x) / sr:.0f} s, peak {20 * np.log10(np.abs(x).max()):.1f} dBFS, overall RMS {20 * np.log10(np.sqrt(np.mean(x ** 2))):.1f} dB')
print('RMS per 4 s:', ' '.join(f'{r:.0f}' for r in rms))
spec = np.abs(np.fft.rfft(x[:sr * 60] * np.hanning(min(len(x), sr * 60))))
f = np.fft.rfftfreq(min(len(x), sr * 60), 1 / sr)
bands = [(20, 60), (60, 150), (150, 400), (400, 1000), (1000, 3000), (3000, 8000), (8000, 11000)]
e = [np.sum(spec[(f >= a) & (f < b)] ** 2) for a, b in bands]
tot = sum(e)
print('band energy %:', ' '.join(f'{a}-{b}:{100 * v / tot:.0f}' for (a, b), v in zip(bands, e)))
if len(sys.argv) > 2:
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.figure(figsize=(14, 4))
    plt.specgram(x, NFFT=2048, Fs=sr, noverlap=1024, cmap='magma', vmin=-120)
    plt.ylim(0, 8000); plt.tight_layout(); plt.savefig(sys.argv[2], dpi=70)
