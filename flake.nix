{
  description = "AnyPS5 Launcher – unofficial desktop launcher for AnyPS5";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux"; # AnyPS5 games are x86-64 only
      pkgs = nixpkgs.legacyPackages.${system};
      inherit (pkgs) lib;

      # What the AnyPS5 system libraries (libs/*.prx) link to or load at runtime.
      # Converted games find them through nix-ld (NIX_LD_LIBRARY_PATH), set by the launcher.
      gameLibs = with pkgs; [
        stdenv.cc.cc.lib # libstdc++, libgcc_s
        vulkan-loader
        libxkbcommon
        wayland
        libdecor
        libx11
        libxext
        libxrandr
        libxcursor
        libxi
        libxfixes
        libxrender
        libxscrnsaver
        libxcb
        libpulseaudio
        alsa-lib
        pipewire
        dbus
        udev
      ];

      launcher = pkgs.rustPlatform.buildRustPackage {
        pname = "anyps5-launcher";
        version = "0.2.0";
        src = lib.cleanSource ./.;

        cargoRoot = "src-tauri";
        buildAndTestSubdir = "src-tauri";
        cargoLock.lockFile = ./src-tauri/Cargo.lock;

        nativeBuildInputs = with pkgs; [ cargo-tauri.hook pkg-config wrapGAppsHook3 ];
        buildInputs = with pkgs; [ glib-networking webkitgtk_4_1 gtk3 librsvg ];

        preFixup = ''
          gappsWrapperArgs+=(
            --set ANYPS5_LAUNCHER_NIX 1
            --set ANYPS5_GAME_LIBRARY_PATH ${lib.makeLibraryPath gameLibs}
            --prefix PATH : ${lib.makeBinPath [ pkgs.python3 pkgs.xdg-utils ]}
          )
        '';

        meta = {
          description = "Unofficial desktop launcher for AnyPS5";
          homepage = "https://github.com/Fexiven/AnyPS5-Launcher";
          license = lib.licenses.gpl2Only;
          mainProgram = "anyps5-launcher";
          platforms = [ system ];
        };
      };
    in
    {
      packages.${system} = {
        default = launcher;
        anyps5-launcher = launcher;
      };

      apps.${system}.default = {
        type = "app";
        program = lib.getExe launcher;
      };

      # programs.anyps5-launcher.enable = true; installs the launcher and what converted games need.
      nixosModules.default = { config, lib, ... }: {
        options.programs.anyps5-launcher.enable = lib.mkEnableOption "AnyPS5 Launcher";
        config = lib.mkIf config.programs.anyps5-launcher.enable {
          environment.systemPackages = [ self.packages.${system}.default ];
          programs.nix-ld.enable = true; # provides /lib64/ld-linux-x86-64.so.2 for converted games
          hardware.graphics.enable = lib.mkDefault true; # Vulkan drivers
        };
      };

      devShells.${system}.default = pkgs.mkShell {
        inputsFrom = [ launcher ];
        packages = [ pkgs.cargo-tauri ];
      };
    };
}
