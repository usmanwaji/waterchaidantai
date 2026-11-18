"""Cut vo/_joined.wav (whole script in one take) into vo/<scene>.wav.

Splits at every pause, transcribes each piece with Whisper (sherpa-onnx), then assigns
consecutive pieces to scene lines with dynamic programming on text similarity.
Env WHISPER_DIR = folder with small-encoder.int8.onnx / small-decoder.int8.onnx / small-tokens.txt
(github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2).
"""
import os, json, re, difflib, numpy as np, soundfile as sf, sherpa_onnx
C = os.path.dirname(os.path.abspath(__file__))
W = os.environ['WHISPER_DIR']
keys, lines = zip(*[(s['key'], s['line']) for s in json.load(open(C + '/scenes.json'))])
x, sr = sf.read(C + '/vo/_joined.wav', dtype='float32')

# 1. pauses -> pieces
hop = int(sr * 0.02)
rms = np.sqrt(np.convolve(x ** 2, np.ones(hop) / hop, 'same'))[::hop]
quiet = rms < max(0.004, 0.05 * np.percentile(rms, 95))
cuts, run = [], 0
for i, q in enumerate(quiet):
    run = run + 1 if q else 0
    if run == 9: cuts.append(i - 4)          # pause of >= 0.18 s: cut in its middle-ish
cuts = [c * hop for c in cuts if 0 < c * hop < len(x)]
bounds = [0] + cuts + [len(x)]
pieces = [(a, b) for a, b in zip(bounds, bounds[1:]) if b - a > sr * 0.15]

# 2. transcribe pieces
asr = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=W + '/small-encoder.int8.onnx', decoder=W + '/small-decoder.int8.onnx',
    tokens=W + '/small-tokens.txt', language='th', task='transcribe', num_threads=4)
def stt(seg):
    y = np.interp(np.arange(0, len(seg) * 16000 / sr) * sr / 16000, np.arange(len(seg)), seg).astype(np.float32)
    pad = np.zeros(16000, np.float32); s = asr.create_stream()
    s.accept_waveform(16000, np.concatenate([pad, y, pad, pad])); asr.decode_stream(s); return s.result.text
texts = [stt(x[a:b]) for a, b in pieces]
norm = lambda s: re.sub(r'[^฀-๿a-z0-9]', '', s.lower())

# 3. DP: split pieces into len(lines) consecutive groups maximizing similarity
P, N = len(pieces), len(lines)
sim = lambda i, j, k: difflib.SequenceMatcher(None, norm(''.join(texts[i:j])), norm(lines[k])).ratio()
best = np.full((N + 1, P + 1), -1e9); best[0][0] = 0; prev = {}
for k in range(N):
    for j in range(1, P + 1):
        for i in range(max(0, j - 12), j):
            if best[k][i] < -1e8: continue
            v = best[k][i] + sim(i, j, k)
            if v > best[k + 1][j]: best[k + 1][j] = v; prev[(k + 1, j)] = i
j, groups = P, []
for k in range(N, 0, -1):
    i = prev[(k, j)]; groups.append((i, j)); j = i
groups.reverse()
for k, (i, j) in enumerate(groups):
    a, b = pieces[i][0], pieces[j - 1][1]
    sf.write(f'{C}/vo/{keys[k]}.wav', x[a:b], sr)
    print(f'{keys[k]:8s} {(b - a) / sr:5.2f}s  match {sim(i, j, k):.2f} | {"".join(texts[i:j])[:70]}')
