# Zoope

**Your AI avatar for every meeting.** Zoope scans your face and voice, builds an avatar that
blinks, talks and lip-syncs in your cloned voice, and sends it into Zoom, Google Meet and
Microsoft Teams calls for you.

## What's in this repo

| File | What it is |
| --- | --- |
| `index.html` | Marketing landing page (white background, blue text theme) |
| `app.html` | The Zoope web app: scan face → clone voice → connect apps → join meeting |
| `js/avatar.js` | `ZoopeAvatar` — animates the captured face on a canvas (blinking + mouth movement) |
| `js/app.js` | Onboarding flow: camera, microphone, integrations, meeting launcher |
| `css/styles.css` | Shared, responsive styles |
| `assets/` | Hero background, app icon |
| `manifest.webmanifest` | Lets iPhone/iPad users "Add to Home Screen" as an app |

No build step — it's plain HTML/CSS/JS.

## Setting the landing page background image

Save your image as **`assets/hero.jpg`**. The hero uses it as a full-bleed background with a
light white wash so the blue text stays readable. Until that file exists, a soft blue
placeholder (`assets/hero-placeholder.svg`) is shown.

## Run it locally

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Camera and microphone access require **HTTPS** (or `localhost`). To test on an iPhone or iPad,
deploy to any static HTTPS host (GitHub Pages, Netlify, Vercel, Cloudflare Pages) and open it in Safari.

## Devices

- **iPhone / iPad** — Safari 14.5+. Front camera for the face scan, `MediaRecorder` for voice
  (records as `audio/mp4` on iOS). Tap Share → *Add to Home Screen* for a full-screen app.
  Layout adapts to notch/home-indicator safe areas, 16px inputs prevent iOS zoom.
- **Computer / laptop** — Chrome, Edge, Safari, Firefox on macOS, Windows, ChromeOS.

## What works today vs. what needs a backend

Working in the browser now:
- Live camera face scan with framing guide, lighting check, and face crop
- Animated avatar with natural random blinking and audio-driven mouth movement
- Voice recording with live waveform; playback lip-syncs the avatar to your real voice
- Text-to-speech preview with lip-sync (uses the browser's built-in voice)
- Meeting link detection for Zoom / Meet / Teams; connection state per app
- Saves progress on the device (localStorage)

Simulated (UI is in place, needs server-side services):

1. **Voice cloning** — send the recorded sample to a voice-cloning TTS provider
   (e.g. ElevenLabs, Resemble, or a self-hosted model); swap
   `speechSynthesis` in `speak()` (`js/app.js`) for the returned audio stream.
2. **Face model / lip-sync** — run a face-mesh + talking-head model (e.g. a
   SadTalker/LivePortrait-style pipeline) and drive visemes from TTS output. `ZoopeAvatar`
   already accepts a per-frame openness level and custom landmarks.
3. **OAuth** — replace the `prompt()` in the Connect step with real OAuth:
   Zoom OAuth app, Google OAuth (Calendar scope), Microsoft identity platform (Graph).
4. **Joining meetings** — a meeting-bot service that joins as a participant and publishes the
   avatar video + cloned audio: Zoom Meeting SDK, Microsoft Teams bot (Graph Communications
   / real-time media), and for Google Meet a headless-browser bot or a meeting-bot API
   such as Recall.ai covering all three.

## Consent & safety

Zoope is built for people to create avatars of **themselves**. The avatar is labeled as AI in
meetings and the FAQ promises disclosure — keep that when building the backend, add
liveness checks during the scan, and check each meeting platform's terms and local
recording/consent laws.
