# AnyPS5 Launcher (Linux)

An **unofficial** desktop app for [AnyPS5](https://github.com/boykopovar/AnyPS5): pick a PS5 game folder you dumped from your own console, click **Convert**, then **Play**. No terminal needed.

This project is not affiliated with AnyPS5. It doesn't contain AnyPS5 itself: it runs the official relinker and system libraries that you download from the AnyPS5 releases.

## Install

- **Debian / Ubuntu / Mint / Pop!_OS:** `sudo apt install ./AnyPS5.Launcher_0.2.0_amd64.deb`
- **Any other distro:** `chmod +x AnyPS5.Launcher_0.2.0_amd64.AppImage` and double-click it.
- **NixOS:** see [below](#nixos).

Then download the Linux **relinker** and **prx-linux-….zip** from the [AnyPS5 releases](https://github.com/boykopovar/AnyPS5/releases) and put them in `~/AnyPS5` or `~/Downloads`. They are found automatically; no unzipping needed.

## What it does

- Reads the game's name, title ID and cover art (`sce_sys/param.json`, `icon0.png`).
- Builds the folder layout AnyPS5 expects (`app.elf`, `libs/`, `app0/`) and runs the relinker. On Intel processors it adds `--to-intel` automatically.
- Links large game files instead of copying them when possible. The original dump is never changed.
- Per-game settings: language, V-Sync, FPS counter, graphics card, PlayGo fix, keyboard controls, fonts and screenshots folders.
- Live game output, with plain-language tips for common problems (GPU memory permission, missing fonts, Vulkan driver, CPU features, PlayGo errors).

Settings are stored in `~/.config/anyps5-launcher/settings.json`. Converted games go to `~/AnyPS5 Games` by default.

## How it works

The launcher is a front-end for the official AnyPS5 command-line tools; it doesn't change how AnyPS5 converts or runs a game.

1. **Convert** copies (or hard-links) the game's files into `<game>/app0/`, unpacks the system libraries from `prx-linux-….zip` into `<game>/libs/`, then runs the relinker: `relinker [--to-intel] <dump>/eboot.bin <game>/app.elf`. A SELF-wrapped `eboot.bin` is first unwrapped with AnyPS5's `tools/unwrap_self.py`. The relinker's output is shown live and saved as `conversion.log`.
2. **Play** starts `<game>/app.elf` directly, with the per-game settings as AnyPS5's environment variables (`ANYPS5_LANGUAGE`, `ANYPS5_OVERLAY`, `ANYPS5_PRESENT_MODE`, `ANYPS5_GPU`, `APS5_PLAYGO_UNLISTED_CHUNKS`). The game's output is shown live, saved as `last-run.log`, and checked for common problems.

## NixOS

Converted games are ordinary Linux programs that expect `/lib64/ld-linux-x86-64.so.2`, so on NixOS they run through [nix-ld](https://github.com/nix-community/nix-ld). The flake's NixOS module sets that up; the launcher passes the libraries games need (Vulkan, SDL's X11/Wayland/audio libraries, libstdc++) to nix-ld itself.

```nix
# flake.nix of your system
{
  inputs.anyps5-launcher.url = "github:Fexiven/AnyPS5-Launcher";

  outputs = { nixpkgs, anyps5-launcher, ... }: {
    nixosConfigurations.<host> = nixpkgs.lib.nixosSystem {
      modules = [
        anyps5-launcher.nixosModules.default
        {
          programs.anyps5-launcher.enable = true; # also enables nix-ld and hardware.graphics
          users.users.<you>.extraGroups = [ "kvm" ]; # GPU memory sharing (/dev/udmabuf), not needed with the NVIDIA driver
        }
      ];
    };
  };
}
```

Without flakes in your system configuration, enable `programs.nix-ld.enable = true;` and `hardware.graphics.enable = true;` yourself and run the launcher with `nix run github:Fexiven/AnyPS5-Launcher`.

## Build from source

Requires Rust, Node.js and the Tauri Linux dependencies (`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev`).

```sh
npm install
npx tauri build        # .deb and .AppImage in src-tauri/target/release/bundle/
```

The UI is plain HTML/CSS/JS in `ui/`; the backend is `src-tauri/src/main.rs`.

With Nix: `nix build` (package in `result/`), or `nix develop` for a shell with all build dependencies.

Only use games you own. The launcher contains no games, keys or Sony software. License: GPL-2.0-only.
