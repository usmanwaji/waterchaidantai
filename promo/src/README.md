# naraflood promo clip: source files

These files build the 9:16 promo clip `promo/naraflood-promo*.mp4`. They are not part of the website.

- `comp.html` – the animation: one page that `render(t)` draws for any time `t`; `setTimeline()` sets the scene lengths
- `shots/` – screenshots of naraflood.com taken 16 Nov 2026 (iPhone 13, 390×853)
- `render.js` – Playwright renders `comp.html` to 30 fps JPEG frames
- `vo_script.json` – Thai voice-over script, one line per scene
- `gemini_tts.py` – synthesizes the voice-over with the Gemini API (`GEMINI_API_KEY`), writing `vo/<scene>.wav`; the current clip uses `MODEL=gemini-3.1-flash-tts-preview`, voice Kore
- `gtts.py` – alternative: Google Cloud Text-to-Speech
- `build_vo.py` – fits the scene lengths to the voice, mixes the narration, renders the frames and encodes the MP4

## Rebuild the narrated version

Prerequisites: a Network secret on `texttospeech.googleapis.com` of type "GCP access token (with Service Account Key)" (the proxy injects the token), plus `pip install numpy soundfile` and ffmpeg.

```bash
cd promo/src
python3 gtts.py list                       # list the th-TH voices
python3 gtts.py synth <voice-name>       # a name printed by the list command
python3 build_vo.py ../naraflood-promo-voice.mp4
```
