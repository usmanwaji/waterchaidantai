"""Thai voice-over via Google Cloud Text-to-Speech.
Credentials are injected by the environment proxy (Network secret of type
"GCP access token (with Service Account Key)" on texttospeech.googleapis.com);
the bearer token sent here is a dummy the proxy replaces.
Usage: python3 gtts.py list            -> list th-TH voices
       python3 gtts.py synth VOICE     -> write vo/<key>.wav for every line in vo_script.json
"""
import sys, os, json, base64, urllib.request, wave
C = os.path.dirname(os.path.abspath(__file__))
API = 'https://texttospeech.googleapis.com/v1'
HDR = {'Authorization': 'Bearer dummy-replaced-by-proxy', 'Content-Type': 'application/json'}

def call(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body else None, headers=HDR,
                                 method='POST' if body else 'GET')
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

if sys.argv[1] == 'list':
    for v in call('/voices?languageCode=th-TH')['voices']:
        print(v['name'], v['ssmlGender'], v.get('naturalSampleRateHertz'))
    sys.exit()

voice = sys.argv[2]
rate = float(os.environ.get('RATE', '1.05'))
lines = json.load(open(C + '/vo_script.json'))
os.makedirs(C + '/vo', exist_ok=True)
dur = {}
for key, text in lines.items():
    body = {'input': {'text': text}, 'voice': {'languageCode': 'th-TH', 'name': voice},
            'audioConfig': {'audioEncoding': 'LINEAR16', 'sampleRateHertz': 24000}}
    if 'Chirp' not in voice:
        body['audioConfig']['speakingRate'] = rate
    pcm = base64.b64decode(call('/text:synthesize', body)['audioContent'])
    open(f'{C}/vo/{key}.wav', 'wb').write(pcm)  # LINEAR16 response already has a WAV header
    with wave.open(f'{C}/vo/{key}.wav') as w:
        dur[key] = round(w.getnframes() / w.getframerate(), 2)
    print(f'{key:8s} {dur[key]:5.2f}s  {text}')
json.dump(dur, open(C + '/vo/durations.json', 'w'))
