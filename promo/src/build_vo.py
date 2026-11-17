"""Fit scene timings to vo/*.wav, mix the narration track, render frames, mux the MP4.
Usage: python3 build_vo.py OUT.mp4
"""
import sys, os, json, subprocess, numpy as np, soundfile as sf
C = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
ORDER = ['hook', 'logo', 'index', 'map', 'check', 'shelter', 'alert', 'cta']
MIN = {'hook': 3.0, 'logo': 2.8, 'index': 5.6, 'map': 3.8, 'check': 3.8, 'shelter': 3.8, 'alert': 3.8, 'cta': 5.0}
LEAD = {'hook': 0.3, 'logo': 0.5, 'cta': 0.6}   # seconds before the voice starts in a scene
TAIL = 0.45                                   # breathing room after each line
SR = 24000

def load(k):
    x, sr = sf.read(f'{C}/vo/{k}.wav', dtype='float32')
    if x.ndim > 1: x = x.mean(1)
    if sr != SR:
        x = np.interp(np.arange(0, len(x) * SR / sr) * sr / SR, np.arange(len(x)), x).astype(np.float32)
    idx = np.where(np.abs(x) > 0.01)[0]
    return x[idx[0]: idx[-1] + 1] if len(idx) else x

clips = {k: load(k) for k in ORDER}
tl, t = {}, 0.0
for k in ORDER:
    lead = LEAD.get(k, 0.35)
    d = max(MIN[k], lead + len(clips[k]) / SR + TAIL)
    if k == 'cta': d += 1.2   # hold the end card after the last word
    tl[k] = [round(t, 3), round(t + d, 3)]; t += d
tl['hook2'] = round(tl['hook'][0] + LEAD['hook'] + 0.5 * len(clips['hook']) / SR, 2)
json.dump(tl, open(C + '/timeline.json', 'w'))
DUR = tl['cta'][1]
print('timeline', tl, 'duration', round(DUR, 2))

track = np.zeros(int(DUR * SR) + SR, np.float32)
for k in ORDER:
    s = int((tl[k][0] + LEAD.get(k, 0.35)) * SR); x = clips[k]
    track[s: s + len(x)] += x
track /= max(1e-9, np.abs(track).max()) / 0.89
sf.write(C + '/narration.wav', track[: int(DUR * SR)], SR)

frames = C + '/frames-vo'
os.makedirs(frames, exist_ok=True)
subprocess.run(['node', C + '/render.js', C + '/timeline.json', frames], check=True)
N = round(DUR * 30)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', frames + '/f%04d.jpg',
                '-i', C + '/narration.wav', '-frames:v', str(N),
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
                '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7', '-ar', '48000', '-c:a', 'aac', '-b:a', '160k',
                '-movflags', '+faststart', OUT], check=True)
print('wrote', OUT)
