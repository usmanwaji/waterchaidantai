"""Fit scene timings to vo/<scene>.wav, mix the narration, render frames, encode the MP4.
Usage: python3 build_vo.py OUT.mp4      (env TEMPO=1.0 speeds the voice up without changing pitch)
"""
import sys, os, json, subprocess, numpy as np, soundfile as sf
C = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
TEMPO = float(os.environ.get('TEMPO', '1.0'))
SCENES = json.load(open(C + '/scenes.json'))
MIN = {'hook': 3.0, 'logo': 2.8, 'phone': 3.6, 'cta': 5.0}
LEAD = {'hook': 0.25, 'logo': 0.45, 'phone': 0.3, 'cta': 0.5}   # silence before the voice in a scene
TAIL = 0.3                                                       # breathing room after each line
SR = 24000

def load(k):
    path = f'{C}/vo/{k}.wav'
    if TEMPO != 1.0:
        tmp = f'{C}/vo/_tempo_{k}.wav'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-af', f'atempo={TEMPO}', tmp], check=True)
        path = tmp
    x, sr = sf.read(path, dtype='float32')
    if x.ndim > 1: x = x.mean(1)
    if sr != SR:
        x = np.interp(np.arange(0, len(x) * SR / sr) * sr / SR, np.arange(len(x)), x).astype(np.float32)
    idx = np.where(np.abs(x) > 0.01)[0]
    return x[idx[0]: idx[-1] + 1] if len(idx) else x

clips = {s['key']: load(s['key']) for s in SCENES}
t = 0.0
for s in SCENES:
    k, ty = s['key'], s['type']
    d = max(MIN[ty], LEAD[ty] + len(clips[k]) / SR + TAIL)
    if ty == 'cta': d += 1.5          # hold the end card after the last word
    s['t0'], s['t1'], s['v0'] = round(t, 3), round(t + d, 3), round(t + LEAD[ty], 3); t += d
hook = SCENES[0]; hook['hook2'] = round(hook['v0'] + 0.45 * len(clips[hook['key']]) / SR, 2)

def pauses(x):
    """Centres (s) of pauses >= 0.12 s inside a voice clip."""
    hop = int(SR * 0.02)
    rms = np.sqrt(np.convolve(x ** 2, np.ones(hop) / hop, 'same'))[::hop]
    q = rms < max(0.004, 0.06 * np.percentile(rms, 95))
    out, run = [], 0
    for i, v in enumerate(q):
        if v: run += 1
        elif run:
            if run >= 6: out.append((i - run / 2) * hop / SR)
            run = 0
    return out

def weight(txt):   # rough spoken length: digits and Latin read longer than they look
    import re
    return len(re.sub(r'[\s!?.,"]', '', txt)) + 2.5 * len(re.findall(r'\d', txt)) + 0.8 * len(re.findall(r'[A-Za-z]', txt))

for s in SCENES:   # subtitle timing: split the clip by text weight, snap each cut to the nearest pause
    subs = s.get('subs') or []
    if not subs: continue
    L = len(clips[s['key']]) / SR; ps = pauses(clips[s['key']])
    w = np.cumsum([weight(c) for c in subs]); cuts = []
    for c in (w[:-1] / w[-1] * L):
        near = [p for p in ps if abs(p - c) < 0.7 and (not cuts or p > cuts[-1] + 0.4)]
        cuts.append(min(near, key=lambda p: abs(p - c)) if near else c)
    b = [0.0] + cuts + [L]
    s['subt'] = [[round(s['v0'] + b[i] - 0.05, 2), round(s['v0'] + b[i + 1] + (0.25 if i == len(subs) - 1 else 0), 2), subs[i]]
                 for i in range(len(subs))]
json.dump(SCENES, open(C + '/timeline.json', 'w'), ensure_ascii=False)
DUR = SCENES[-1]['t1']
for s in SCENES: print(f"{s['key']:8s} {s['t0']:6.2f} - {s['t1']:6.2f}")
print('duration', round(DUR, 2))

track = np.zeros(int(DUR * SR) + SR, np.float32)
for s in SCENES:
    a = int(s['v0'] * SR); x = clips[s['key']]; track[a: a + len(x)] += x
track /= max(1e-9, np.abs(track).max()) / 0.89
sf.write(C + '/narration.wav', track[: int(DUR * SR)], SR)

frames = C + '/frames-vo'
os.makedirs(frames, exist_ok=True)
if not os.environ.get('SKIP_RENDER'):
    subprocess.run(['node', C + '/render.js', C + '/timeline.json', frames], check=True)

# audio: narration alone, or narration over background music (MUSIC=path) ducked while the voice speaks
MUSIC, MVOL = os.environ.get('MUSIC'), os.environ.get('MUSIC_VOL', '0.6')
cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', frames + '/f%04d.jpg', '-i', C + '/narration.wav']
if MUSIC:
    cmd += ['-i', MUSIC, '-filter_complex',
            '[1:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[vo][key];'
            f'[2:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{DUR:.2f},asetpts=PTS-STARTPTS,'
            f'afade=t=in:d=1.5,afade=t=out:st={DUR - 3:.2f}:d=3,volume={MVOL}[m];'
            '[m][key]sidechaincompress=threshold=0.015:ratio=6:attack=30:release=500[md];'
            '[vo][md]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-15:TP=-1.5:LRA=9[a]',
            '-map', '0:v', '-map', '[a]']
else:
    cmd += ['-af', 'loudnorm=I=-15:TP=-1.5:LRA=7']
cmd += ['-frames:v', str(round(DUR * 30)), '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
        '-profile:v', 'high', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT]
subprocess.run(cmd, check=True)
print('wrote', OUT)
