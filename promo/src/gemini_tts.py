"""Thai voice-over via the Gemini API (TTS model).
Reads the key from the GEMINI_API_KEY environment variable.
Usage: python3 gemini_tts.py VOICE [KEY ...]   -> write vo/<key>.wav for lines in vo_script.json
       (all lines when no KEY is given). Env: MODEL (default gemini-3.8-flash-tts), OUTDIR (default vo)
Voices are Gemini's prebuilt voices, e.g. Kore, Charon, Aoede, Puck, Sulafat, Achird.
"""
import sys, os, json, base64, time, urllib.request, urllib.error, wave
C = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get('MODEL', 'gemini-3.8-flash-tts')
OUT = os.path.join(C, os.environ.get('OUTDIR', 'vo'))
URL = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent'
# Direction in English so the model does not read it aloud; only the Thai line is spoken.
# Empty by default: the TTS models tried here read any direction aloud, so only the Thai line is sent.
STYLE = os.environ.get('STYLE', '')

def synth(text, voice, tries=4):
    body = {'contents': [{'parts': [{'text': STYLE + text}]}],
            'generationConfig': {'responseModalities': ['AUDIO'],
                                 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}}}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method='POST', headers={
        'x-goog-api-key': os.environ['GEMINI_API_KEY'], 'Content-Type': 'application/json'})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.load(r)
            part = d['candidates'][0]['content']['parts'][0]['inlineData']
            return base64.b64decode(part['data']), part.get('mimeType', '')
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code in (429, 500, 503) and i < tries - 1:
                time.sleep(15 * (i + 1)); continue
            raise SystemExit(f'HTTP {e.code}: {msg}')

def save(path, pcm, rate):
    with wave.open(path, 'wb') as w:   # Gemini returns raw 16-bit mono PCM
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)

def rate_of(mime):
    return int(mime.split('rate=')[1].split(';')[0]) if 'rate=' in mime else 24000

def split_on_pauses(pcm, rate, n):
    """Cut one recording into n parts at the n-1 longest pauses."""
    import numpy as np
    x = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
    hop = int(rate * 0.02)
    rms = np.sqrt(np.convolve(x ** 2, np.ones(hop) / hop, 'same'))[::hop]
    quiet = rms < max(0.01, 0.06 * np.percentile(rms, 95))
    runs, start = [], None
    for i, q in enumerate(quiet):
        if q and start is None: start = i
        if not q and start is not None:
            runs.append((i - start, start, i)); start = None
    first = np.argmax(~quiet); last = len(quiet) - np.argmax(~quiet[::-1])
    inner = [r for r in runs if r[1] > first and r[2] < last]
    cuts = sorted((s + e) // 2 * hop for _, s, e in sorted(inner, reverse=True)[:n - 1])
    bounds = [0] + cuts + [len(x)]
    return [(x[a:b] * 32767).astype(np.int16).tobytes() for a, b in zip(bounds, bounds[1:])]

if __name__ == '__main__':
    voice = sys.argv[1]
    lines = json.load(open(C + '/vo_script.json'))
    keys = [k for k in sys.argv[2:] if k != '--joined'] or list(lines)
    os.makedirs(OUT, exist_ok=True)
    if '--joined' in sys.argv:   # one request for every line (saves free-tier quota), then split
        pcm, mime = synth('\n\n'.join(lines[k] for k in keys), voice)
        rate = rate_of(mime)
        save(f'{OUT}/_joined.wav', pcm, rate)
        for k, part in zip(keys, split_on_pauses(pcm, rate, len(keys))):
            save(f'{OUT}/{k}.wav', part, rate)
            print(f'{k:8s} {len(part) / 2 / rate:5.2f}s  {lines[k]}')
        sys.exit()
    for k in keys:
        pcm, mime = synth(lines[k], voice)
        rate = rate_of(mime)
        save(f'{OUT}/{k}.wav', pcm, rate)
        print(f'{k:8s} {len(pcm) / 2 / rate:5.2f}s  {lines[k]}')
