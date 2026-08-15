# Phai Music v1.0

> A clean, minimal, offline-first music player built with HTML, CSS, and Vanilla JavaScript.
> Designed for personal use and later deployment as an Android app via Capacitor.

---

## 📁 Project Structure

```
Phai music/
├── index.html            ← Single-page app shell
├── css/
│   └── style.css         ← Full design system + component styles
├── js/
│   ├── library.js        ← Song library, metadata, favorites (localStorage)
│   ├── ui.js             ← All DOM rendering, color extraction, animations
│   ├── player.js         ← Audio engine, queue, shuffle, MediaSession
│   └── app.js            ← Main coordinator, event binding, routing
├── assets/
│   ├── icons/            ← (SVG icons — add your own)
│   └── covers/           ← (Default covers — add your own)
├── music/                ← (Your demo MP3 files — not committed to git)
└── README.md
```

---

## ✨ Features (v1.0)

| Feature | Status |
|---|---|
| Dark theme UI | ✅ |
| Custom pill-shaped mini player | ✅ |
| Dynamic accent color from album art | ✅ |
| File picker (add local music) | ✅ |
| Play / Pause / Next / Previous | ✅ |
| Seekable progress bar | ✅ |
| Volume control | ✅ |
| Shuffle (Fisher-Yates) | ✅ |
| Repeat single song | ✅ |
| Favorites / Liked Songs | ✅ |
| Recently Played | ✅ |
| Library search | ✅ |
| Edit song title + artist | ✅ |
| Edit album cover (image upload) | ✅ |
| Metadata stored in localStorage | ✅ |
| Original files never modified | ✅ |
| Android lock-screen controls (MediaSession) | ✅ |
| Swipe-down to close full player | ✅ |

---

## 🚀 How to Run (Browser / Web)

1. Open `index.html` in any modern browser.
2. Tap the **+** button (top right) to add your music files.
3. Enjoy your music!

> **Tip:** For the best experience on mobile, open in Chrome and use
> "Add to Home Screen" for a PWA-like feel.

---

## 📱 Stage 5 — Android with Capacitor

```bash
# 1. Initialize npm in the project root
npm init -y

# 2. Install Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android

# 3. Initialize Capacitor
npx cap init "Phai Music" "com.phaimusic.app"

# 4. Set webDir in capacitor.config.json to "."
#    (since index.html is in the root)

# 5. Add Android platform
npx cap add android

# 6. Sync your web files
npx cap sync android

# 7. Open in Android Studio
npx cap open android
```

### Required Capacitor plugins for real device file access:
```bash
npm install @capacitor/filesystem @capacitor/media
npx cap sync android
```

---

## 🎨 Design Tokens

| Token | Value | Usage |
|---|---|---|
| `--bg-0` | `#0b0b0c` | App background |
| `--bg-1` | `#141418` | Cards |
| `--bg-2` | `#1e1e27` | Elevated cards |
| `--bg-3` | `#27273a` | Hover / active |
| `--txt-hi` | `#f2f2f7` | Primary text |
| `--txt-mid` | `#9494ad` | Secondary text |
| `--txt-lo` | `#55556a` | Muted / placeholder |
| `--a-purple` | `#c4a8f7` | Default accent |
| `--a-blue` | `#7eb8f7` | Blue accent |
| `--a-pink` | `#f4a0b0` | Pink accent |
| `--a-peach` | `#f7c59f` | Peach accent |
| `--a-green` | `#a8e6cf` | Green accent |
| `--dyn-accent` | dynamic | Mini-player bar color |

---

## 🗺️ Roadmap

- [ ] **v1.1** — Drag-to-reorder queue
- [ ] **v1.2** — Custom playlists
- [ ] **v1.3** — Lyrics viewer
- [ ] **v1.4** — Equalizer (Web Audio API)
- [ ] **v1.5** — Multiple themes (light, AMOLED)
- [ ] **v2.0** — Full Capacitor Android build with native file access

---

## 📝 License

MIT — build freely, learn openly.
