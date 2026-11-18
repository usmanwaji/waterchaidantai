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

Prerequisites: `GEMINI_API_KEY` in the environment (a free AI Studio key allows 10 TTS requests per model per day), plus `pip install numpy soundfile` and ffmpeg.

```bash
cd promo/src
MODEL=gemini-3.1-flash-tts-preview python3 gemini_tts.py Kore          # all 8 lines (8 requests)
MODEL=gemini-3.1-flash-tts-preview python3 gemini_tts.py Kore map cta  # redo only some lines
python3 build_vo.py ../naraflood-promo-voice.mp4
```

The TTS models read any style instruction aloud, so only the Thai text is sent. Write numbers and English words the way they should be spoken (e.g. `หนึ่ง เจ็ด แปด สี่`, `นาราฟลัด ดอทคอม`).
