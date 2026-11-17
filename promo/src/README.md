# naraflood promo clip: source files

These files build the 9:16 promo clip `promo/naraflood-promo*.mp4`. They are not part of the website.

- `comp.html` – the animation: one page that `render(t)` draws for any time `t`; `setTimeline()` sets the scene lengths
- `shots/` – screenshots of naraflood.com taken 16 Nov 2026 (iPhone 13, 390×853)
- `render.js` – Playwright renders `comp.html` to 30 fps JPEG frames
- `vo_script.json` – Thai voice-over script, one line per scene
- `gtts.py` – synthesizes the voice-over with Google Cloud Text-to-Speech, writing `vo/<scene>.wav`
- `build_vo.py` – fits the scene lengths to the voice, mixes the narration, renders the frames and encodes the MP4

## Rebuild the narrated version

Prerequisites: an API key for `texttospeech.googleapis.com`, saved in the cloud environment as a Network secret with header `X-Goog-Api-Key` (the proxy injects it), plus `pip install numpy soundfile` and ffmpeg.

```bash
cd promo/src
python3 gtts.py list                       # list the th-TH voices
python3 gtts.py synth <voice-name>       # a name printed by the list command
python3 build_vo.py ../naraflood-promo-voice.mp4
```
