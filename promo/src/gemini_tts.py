"""Thai voice-over via the Gemini API (TTS model). Reads the key from GEMINI_API_KEY.

  python3 gemini_tts.py VOICE --joined        one request for the whole script -> vo/_joined.wav
                                              (then run split_vo.py to cut it into vo/<scene>.wav)
  python3 gemini_tts.py VOICE [KEY ...]       one request per scene -> vo/<key>.wav

Lines come from scenes.json ("line"). Env:
  MODEL  (default gemini-2.5-flash-preview-tts; the 2.5 models follow STYLE without reading it aloud,
          the 3.x TTS models read any direction aloud, so use STYLE= with them)
  STYLE  direction prefixed to the text; OUTDIR (default vo)
Free AI Studio keys allow 10 TTS requests per model per day, hence --joined.
"""
import sys, os, json, base64, time, urllib.request, urllib.error, wave
C = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get('MODEL', 'gemini-2.5-flash-preview-tts')
OUT = os.path.join(C, os.environ.get('OUTDIR', 'vo'))
URL = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent'
STYLE = os.environ.get('STYLE', 'Read this Thai script like an energetic, excited young Thai male YouTuber '
                                'hyping a cool new website, fast and punchy, with a short pause between paragraphs: ')

def synth(text, voice, tries=4):
    body = {'contents': [{'parts': [{'text': STYLE + text}]}],
            'generationConfig': {'responseModalities': ['AUDIO'],
                                 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}}}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method='POST', headers={
        'x-goog-api-key': os.environ['GEMINI_API_KEY'], 'Content-Type': 'application/json'})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                d = json.load(r)
            part = d['candidates'][0]['content']['parts'][0]['inlineData']
            return base64.b64decode(part['data']), part.get('mimeType', '')
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code in (500, 503) and i < tries - 1:
                time.sleep(15 * (i + 1)); continue
            raise SystemExit(f'HTTP {e.code}: {msg}')

def save(path, pcm, rate):
    with wave.open(path, 'wb') as w:   # Gemini returns raw 16-bit mono PCM
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)

def rate_of(mime):
    return int(mime.split('rate=')[1].split(';')[0]) if 'rate=' in mime else 24000

def lines():
    return {s['key']: s['line'] for s in json.load(open(C + '/scenes.json'))}

if __name__ == '__main__':
    voice = sys.argv[1]
    L = lines()
    os.makedirs(OUT, exist_ok=True)
    if '--joined' in sys.argv:
        pcm, mime = synth('\n\n'.join(L.values()), voice)
        save(f'{OUT}/_joined.wav', pcm, rate_of(mime))
        print(f'_joined {len(pcm) / 2 / rate_of(mime):.1f}s -> run split_vo.py'); sys.exit()
    for k in sys.argv[2:] or list(L):
        pcm, mime = synth(L[k], voice)
        save(f'{OUT}/{k}.wav', pcm, rate_of(mime))
        print(f'{k:8s} {len(pcm) / 2 / rate_of(mime):5.2f}s  {L[k]}')
