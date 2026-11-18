# naraflood promo clip: source files

These files build the 9:16 promo clips `promo/naraflood-promo*.mp4`. They are not part of the website.

- `scenes.json` – every scene in order: Thai voice-over line, caption, screenshot, scroll range and zoom
- `comp.html` – the animation; `setTimeline(scenes-with-times)` then `render(t)` draws any moment
- `shoot.js` – screenshots naraflood.com pages into `shots/` (iPhone 13, 390×853)
- `gemini_tts.py` – voice-over with the Gemini API (`GEMINI_API_KEY`)
- `split_vo.py` – cuts a one-take voice-over into one clip per scene (Whisper + text alignment)
- `build_vo.py` – fits scene lengths to the voice, mixes the narration, renders frames, encodes the MP4
- `render.js` – Playwright renders `comp.html` to 30 fps frames (`--preview t…` for stills)
- `gtts.py` – alternative voice: Google Cloud Text-to-Speech

## Rebuild the 120-second version

Needs `GEMINI_API_KEY`, `pip install numpy soundfile sherpa-onnx`, ffmpeg, Playwright, and the Whisper small model
for sherpa-onnx (`sherpa-onnx-whisper-small.tar.bz2` from the k2-fsa/sherpa-onnx `asr-models` release).

```bash
cd promo/src
node shoot.js                                   # optional: fresh screenshots (update numbers in scenes.json)
python3 gemini_tts.py Fenrir --joined           # whole script in ONE request (free tier: 10 requests/model/day)
WHISPER_DIR=/path/to/sherpa-onnx-whisper-small python3 split_vo.py
python3 build_vo.py ../naraflood-promo-voice-120s.mp4
```

Voice: model `gemini-2.5-flash-preview-tts`, voice Fenrir (excitable young male), with the energetic direction in
`STYLE`. The 3.x TTS models read any direction aloud. Write numbers and English words the way they should be
spoken (`หนึ่ง เจ็ด แปด สี่`, `นาราฟลัด ดอทคอม`). `TEMPO=1.1 python3 build_vo.py …` speeds the voice up.

## Subtitles and background music

Each scene in `scenes.json` has `subs`: the subtitle chunks shown while its line is spoken. `build_vo.py`
times them by text length and snaps each cut to a pause in the voice. Background music:

```bash
MUSIC=music/bg.mp3 python3 build_vo.py ../naraflood-promo-120s-music-subs.mp4   # MUSIC_VOL=0.6 by default
```

The music is ducked under the voice (sidechain compression) and faded in/out. `music/` is not committed.
