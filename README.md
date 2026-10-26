# AnyPS5 Launcher (Linux)

A desktop app for [AnyPS5](https://github.com/boykopovar/AnyPS5): pick a PS5 game folder you dumped from your own console, click **Convert**, then **Play**. No terminal needed.

## Install

- **Debian / Ubuntu / Mint / Pop!_OS:** `sudo apt install ./AnyPS5.Launcher_0.2.0_amd64.deb`
- **Any other distro:** `chmod +x AnyPS5.Launcher_0.2.0_amd64.AppImage` and double-click it.

Then download the Linux **relinker** and **prx-linux-….zip** from the [AnyPS5 releases](https://github.com/boykopovar/AnyPS5/releases) and put them in `~/AnyPS5` or `~/Downloads`. They are found automatically; no unzipping needed.

## What it does

- Reads the game's name, title ID and cover art (`sce_sys/param.json`, `icon0.png`).
- Builds the folder layout AnyPS5 expects (`app.elf`, `libs/`, `app0/`) and runs the relinker. On Intel processors it adds `--to-intel` automatically.
- Links large game files instead of copying them when possible. The original dump is never changed.
- Per-game settings: language, V-Sync, FPS counter, graphics card, PlayGo fix, keyboard controls, fonts and screenshots folders.
- Live game output, with plain-language tips for common problems (GPU memory permission, missing fonts, Vulkan driver, CPU features, PlayGo errors).

Settings are stored in `~/.config/anyps5-launcher/settings.json`. Converted games go to `~/AnyPS5 Games` by default.

## Build from source

Requires Rust, Node.js and the Tauri Linux dependencies (`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev`).

```sh
npm install
npx tauri build        # .deb and .AppImage in src-tauri/target/release/bundle/
```

The UI is plain HTML/CSS/JS in `ui/`; the backend is `src-tauri/src/main.rs`.

Only use games you own. The launcher contains no games, keys or Sony software. License: GPL-2.0-only.
