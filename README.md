# 🔑 KeyChat

> A modern, aesthetic, zero-config real-time web chat that connects anyone across the internet using a simple shared key with End-to-End Encryption (E2EE).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)
![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)
![E2EE](https://img.shields.io/badge/Security-AES--256--GCM-emerald.svg)

---

## ✨ Features

- 🔒 **Zero-Knowledge End-to-End Encryption (E2EE)**: Messages and media are encrypted in the browser with **AES-256-GCM** derived from the shared secret key using **PBKDF2** & **SHA-256**.
- 🌐 **Connect Over the Internet**: Peer-to-peer real-time communication via WebRTC data channels with public signaling and local `BroadcastChannel` fallback.
- 🎨 **Modern Aesthetic UI**: Glassmorphic dark/light luxe theme, smooth micro-animations, customizable avatars, and responsive layout for Mac and mobile.
- 🔗 **1-Click Share & QR Codes**: Instant invite links (`?key=your-secret-key`) and dynamic QR codes for instant mobile device pairing.
- 🔊 **Procedural Web Audio**: Built-in sound effects synthesized dynamically using the Web Audio API without external audio files.
- 🖼️ **Encrypted Media Sharing**: Send images and media directly P2P with client-side compression.
- ⌨️ **Typing Indicators & Peer Presence**: Real-time peer roster, connection pulse, and live typing notifications.
- 🚀 **Zero Backend Maintenance**: 100% serverless, zero database required, ready for 1-click deployment on **Vercel** or local execution on **macOS**.

---

## 🚀 Getting Started Locally on macOS

You can run KeyChat locally on your Mac with zero configuration.

### Option 1: Using the helper script
```bash
cd keychat
./start.sh
```

### Option 2: Using Python (Built-in on macOS)
```bash
cd keychat
python3 -m http.server 3000
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### Option 3: Using Node / npx
```bash
cd keychat
npm start
# or: npx serve .
```

---

## 🌍 Deploying to Vercel

KeyChat is ready for instant deployment to Vercel with zero build steps or environment variables needed.

### Method A: Deploy via GitHub (Recommended)
1. Initialize git and push this folder to your GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "feat: initial KeyChat release"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```
2. Go to [vercel.com/new](https://vercel.com/new).
3. Import your GitHub repository.
4. Click **Deploy**!

### Method B: Deploy using Vercel CLI
```bash
npx vercel
```

---

## 🔒 Security & Architecture

```
User A (Browser)                      Signaling / STUN                      User B (Browser)
┌──────────────────────┐               ┌───────────────┐                  ┌──────────────────────┐
│  Enter Shared Key    │               │ PeerJS Cloud  │                  │  Enter Shared Key    │
│  "crimson-falcon"    │               │  STUN Server  │                  │  "crimson-falcon"    │
└──────────┬───────────┘               └───────┬───────┘                  └──────────┬───────────┘
           │                                   │                                     │
   Derive AES-256-GCM                  P2P Handshake                         Derive AES-256-GCM
   + Room ID (PBKDF2)                          │                             + Room ID (PBKDF2)
           │                                   │                                     │
           ▼                                   ▼                                     ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│             Direct WebRTC Data Channel (Direct P2P Encrypted Stream)                   │
│                                                                                        │
│   Plain Text  ──►  AES-256-GCM Encrypt  ──►  Encrypted Payload  ──►  AES-256 Decrypt  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Room Key Derivation**: When a user inputs a key (e.g. `cosmic-matrix-4819`), the Web Crypto API derives a deterministic 16-character room hash for peer discovery and a distinct 256-bit AES-GCM encryption key.
2. **Payload Encryption**: Every chat message, image, and typing event is encrypted client-side with a fresh 12-byte initialization vector (`IV`) before transmission.
3. **Zero Knowledge**: Signaling servers only coordinate WebRTC network routing and never have access to the raw key or unencrypted messages.

---

## 📂 Project Structure

```
keychat/
├── index.html        # Semantic HTML5 app structure, modals, responsive layout
├── css/
│   └── style.css     # Glassmorphic dark/light UI, responsive grid & animations
├── js/
│   ├── crypto.js     # Web Crypto API (PBKDF2, SHA-256, AES-GCM-256)
│   ├── p2p.js        # WebRTC PeerJS coordinator & BroadcastChannel fallback
│   ├── audio.js      # Synthesized Web Audio sound effects
│   └── app.js        # UI controller, event listeners, file attachments
├── vercel.json       # Vercel deployment configuration & security headers
├── package.json      # Node/npm scripts
├── start.sh          # macOS quick launcher
├── .gitignore        # Git rules
└── README.md         # Documentation
```

---

## 📄 License

MIT License © 2026 KeyChat.
