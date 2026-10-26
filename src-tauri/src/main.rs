// AnyPS5 Launcher – Tauri backend (Linux).
// Converts a PS5 game dump with the AnyPS5 relinker, keeps a game library and launches games.
// License: GPL-2.0-only (same as AnyPS5). Contains no games, keys or Sony software.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

const MODULE_DIRS: [&str; 3] = ["sce_module", "sce_modules", "prx"];
const MODULE_EXTS: [&str; 7] = ["prx", "sprx", "elf", "self", "bin", "so", "dll"];
const ELF_MAGIC: [u8; 4] = [0x7f, b'E', b'L', b'F'];
const SELF_MAGICS: [[u8; 4]; 2] = [[0x4f, 0x15, 0x3d, 0x1d], [0x54, 0x14, 0xf5, 0xee]];

const INPUT_TEMPLATE: &str = "# AnyPS5 keyboard and mouse bindings
# Format:  Action = KEY:Name   or   MOUSE:Left/Right/Middle/X1/X2   or   WHEEL:Up/Down
# Remove the '#' in front of a line to use it. Controllers work automatically.
# All actions: https://github.com/boykopovar/AnyPS5/blob/main/docs/user/INPUT_MAPPING.md
#
# Cross    = KEY:Return
# Circle   = KEY:C
# Triangle = KEY:I
# Square   = MOUSE:Left
# Options  = KEY:Escape
# Up       = KEY:Up
# Down     = KEY:Down
# Left     = KEY:Left
# Right    = KEY:Right
# ToggleFullscreen = KEY:F11
# TogglePerformanceOverlay = KEY:F10
# Screenshot = KEY:F12
";

// ------------------------------------------------------------------ data

#[derive(Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
struct Options {
    language: i64,
    overlay: bool,
    vsync: String,
    gpu: String,
    playgo: String,
}
impl Default for Options {
    fn default() -> Self {
        Options { language: 1, overlay: false, vsync: String::new(), gpu: String::new(), playgo: String::new() }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
struct Game {
    id: String,
    name: String,
    title_id: String,
    folder: String,
    exe: String,
    source: String,
    added: f64,
    last_played: Option<f64>,
    options: Options,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
struct Settings {
    relinker: String,
    libs: String,
    games_dir: String,
    games: Vec<Game>,
}

struct ConvertHandle {
    cancel: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

#[derive(Default)]
struct AppState {
    settings: Mutex<Settings>,
    convert: Mutex<Option<ConvertHandle>>,
    running: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
}

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

fn config_file() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".config"));
    base.join("anyps5-launcher").join("settings.json")
}

fn default_games_dir() -> String {
    home().join("AnyPS5 Games").to_string_lossy().into_owned()
}

fn load_settings() -> Settings {
    let mut s: Settings = fs::read_to_string(config_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    if s.games_dir.is_empty() {
        s.games_dir = default_games_dir();
    }
    s
}

fn save_settings(s: &Settings) -> Result<(), String> {
    let p = config_file();
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, serde_json::to_string_pretty(s).unwrap()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ detection helpers

fn read_magic(p: &Path) -> [u8; 4] {
    let mut b = [0u8; 4];
    if let Ok(mut f) = fs::File::open(p) {
        let _ = f.read(&mut b);
    }
    b
}

fn find_executable(dir: &Path) -> Option<PathBuf> {
    for n in ["eboot.bin", "eboot.elf", "EBOOT.BIN"] {
        let p = dir.join(n);
        if p.is_file() {
            return Some(p);
        }
    }
    let mut c: Vec<PathBuf> = fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| {
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        p.is_file() && (ext == "elf" || ext == "bin") && {
            let m = read_magic(p);
            m == ELF_MAGIC || SELF_MAGICS.contains(&m)
        }
    }).collect();
    c.sort();
    c.into_iter().next()
}

fn read_param(dir: &Path) -> (String, String) {
    let Ok(t) = fs::read_to_string(dir.join("sce_sys").join("param.json")) else { return (String::new(), String::new()) };
    let Ok(v) = serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')) else { return (String::new(), String::new()) };
    let tid = v.get("titleId").and_then(Value::as_str).unwrap_or("").to_string();
    let mut name = String::new();
    if let Some(loc) = v.get("localizedParameters").and_then(Value::as_object) {
        let lang = loc.get("defaultLanguage").or_else(|| v.get("defaultLanguage")).and_then(Value::as_str).unwrap_or("");
        for key in [lang, "en-US"] {
            if let Some(n) = loc.get(key).and_then(|e| e.get("titleName")).and_then(Value::as_str) {
                if !n.is_empty() {
                    name = n.to_string();
                    break;
                }
            }
        }
        if name.is_empty() {
            name = loc.values().find_map(|e| e.get("titleName").and_then(Value::as_str).filter(|n| !n.is_empty()))
                .unwrap_or("").to_string();
        }
    }
    (tid, name)
}

fn search_dirs() -> Vec<PathBuf> {
    let mut v = vec![];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            v.push(d.to_path_buf());
        }
    }
    if let Some(a) = std::env::var_os("APPIMAGE").map(PathBuf::from) {
        if let Some(d) = a.parent() {
            v.push(d.to_path_buf());
        }
    }
    if let Ok(c) = std::env::current_dir() {
        v.push(c);
    }
    let h = home();
    v.extend([h.join("AnyPS5"), h.join("Downloads"), h.join("Downloads").join("AnyPS5")]);
    v
}

fn sorted_entries(d: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(d).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    v.sort();
    v.reverse(); // newest version first
    v
}

fn detect_relinker(s: &Settings) -> Option<PathBuf> {
    if !s.relinker.is_empty() && Path::new(&s.relinker).is_file() {
        return Some(PathBuf::from(&s.relinker));
    }
    for d in search_dirs() {
        for p in sorted_entries(&d) {
            let n = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if p.is_file() && n.starts_with("relinker") && !n.contains('.') {
                return Some(p);
            }
            // relinker-v0.1.2 has a dot in the version: accept names without a known extension
            if p.is_file() && n.starts_with("relinker-v") && !n.ends_with(".exe") && !n.ends_with(".zip") && !n.ends_with(".gz") {
                return Some(p);
            }
        }
    }
    None
}

fn libs_ok(p: &Path) -> bool {
    if p.is_dir() {
        return fs::read_dir(p).map(|r| r.flatten().any(|e| e.path().extension().map_or(false, |x| x == "prx"))).unwrap_or(false);
    }
    let n = p.to_string_lossy();
    p.is_file() && (n.ends_with(".zip") || n.ends_with(".tar.gz"))
}

fn detect_libs(s: &Settings) -> Option<PathBuf> {
    if !s.libs.is_empty() && libs_ok(Path::new(&s.libs)) {
        return Some(PathBuf::from(&s.libs));
    }
    for d in search_dirs() {
        if libs_ok(&d.join("libs")) {
            return Some(d.join("libs"));
        }
        for p in sorted_entries(&d) {
            let n = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if n.starts_with("prx-linux-") && (n.ends_with(".zip") || n.ends_with(".tar.gz")) {
                return Some(p);
            }
        }
    }
    None
}

fn cpu_vendor() -> String {
    let t = fs::read_to_string("/proc/cpuinfo").unwrap_or_default();
    let model = t.lines().find(|l| l.starts_with("model name")).and_then(|l| l.split(':').nth(1)).unwrap_or("").trim().to_string();
    let vendor = if t.contains("AuthenticAMD") { "amd" } else if t.contains("GenuineIntel") { "intel" } else { "unknown" };
    format!("{vendor}|{model}")
}

fn safe_name(t: &str) -> String {
    let s: String = t.chars().filter(|c| !"<>:\"/\\|?*".contains(*c) && !c.is_control()).collect();
    let s = s.trim().trim_end_matches('.').to_string();
    if s.is_empty() { "Game".into() } else { s.chars().take(80).collect() }
}

fn data_url(p: &Path) -> Option<String> {
    let b = fs::read(p).ok()?;
    if b.len() > 4_000_000 {
        return None;
    }
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
}

#[cfg(unix)]
fn make_exec(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(m) = fs::metadata(p) {
        let mut perm = m.permissions();
        perm.set_mode(perm.mode() | 0o111);
        let _ = fs::set_permissions(p, perm);
    }
}
#[cfg(not(unix))]
fn make_exec(_: &Path) {}

fn is_nixos() -> bool {
    std::env::var_os("ANYPS5_LAUNCHER_NIX").is_some()
        || Path::new("/etc/NIXOS").exists()
        || fs::read_to_string("/etc/os-release").map_or(false, |t| t.lines().any(|l| l.trim() == "ID=nixos"))
}

// Converted games ask for this loader (the relinker writes it as PT_INTERP). On NixOS it comes from nix-ld.
const GAME_INTERP: &str = "/lib64/ld-linux-x86-64.so.2";

fn open_with_system(p: &str) -> Result<(), String> {
    let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    Command::new(cmd).arg(p).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ commands: state & setup

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateView {
    settings: Settings,
    relinker: Option<String>,
    libs: Option<String>,
    cpu: String,
    nixos: bool,
    version: String,
    running: Vec<String>,
}

#[tauri::command]
fn get_state(state: State<AppState>, app: AppHandle) -> StateView {
    let s = state.settings.lock().unwrap().clone();
    StateView {
        relinker: detect_relinker(&s).map(|p| p.to_string_lossy().into_owned()),
        libs: detect_libs(&s).map(|p| p.to_string_lossy().into_owned()),
        cpu: cpu_vendor(),
        nixos: is_nixos(),
        version: app.package_info().version.to_string(),
        running: state.running.lock().unwrap().keys().cloned().collect(),
        settings: s,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupReq {
    relinker: String,
    libs: String,
    games_dir: String,
}

#[tauri::command]
fn save_setup(req: SetupReq, state: State<AppState>) -> Result<(), String> {
    if !Path::new(&req.relinker).is_file() {
        return Err("Please choose the relinker program.".into());
    }
    if !libs_ok(Path::new(&req.libs)) {
        return Err("Please choose the system libraries (prx-linux-….zip or a libs folder with .prx files).".into());
    }
    let mut s = state.settings.lock().unwrap();
    s.relinker = req.relinker;
    s.libs = req.libs;
    s.games_dir = if req.games_dir.trim().is_empty() { default_games_dir() } else { req.games_dir.trim().into() };
    save_settings(&s)
}

#[tauri::command]
async fn pick(app: AppHandle, kind: String, title: String) -> Option<String> {
    let d = app.dialog().file().set_title(&title);
    let r = match kind.as_str() {
        "folder" => d.blocking_pick_folder(),
        "archive" => d.add_filter("Library archive", &["zip", "gz"]).blocking_pick_file(),
        _ => d.blocking_pick_file(),
    };
    r.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Inspect {
    ok: bool,
    message: String,
    exe: String,
    wrapped: bool,
    title_id: String,
    name: String,
    modules: usize,
    icon: Option<String>,
    suggested_out: String,
}

#[tauri::command]
fn inspect_folder(path: String, state: State<AppState>) -> Inspect {
    let d = Path::new(&path);
    if !d.is_dir() {
        return Inspect { message: "This folder doesn't exist.".into(), ..Default::default() };
    }
    let (tid, mut name) = read_param(d);
    if name.is_empty() {
        name = d.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Game".into());
    }
    let games_dir = state.settings.lock().unwrap().games_dir.clone();
    let folder = safe_name(&if tid.is_empty() { name.clone() } else { format!("{name} [{tid}]") });
    let modules = MODULE_DIRS.iter().map(|m| fs::read_dir(d.join(m)).map(|r| r.count()).unwrap_or(0)).sum();
    let mut r = Inspect {
        title_id: tid,
        name,
        modules,
        icon: data_url(&d.join("sce_sys").join("icon0.png")),
        suggested_out: Path::new(&games_dir).join(folder).to_string_lossy().into_owned(),
        ..Default::default()
    };
    match find_executable(d) {
        None => r.message = "No eboot.bin found here – choose the folder that contains it.".into(),
        Some(exe) => {
            let m = read_magic(&exe);
            r.wrapped = SELF_MAGICS.contains(&m);
            if m != ELF_MAGIC && !r.wrapped {
                r.message = format!("{} is not a PS5 executable.", exe.file_name().unwrap().to_string_lossy());
            } else {
                r.ok = true;
                r.exe = exe.file_name().unwrap().to_string_lossy().into_owned();
            }
        }
    }
    r
}

#[tauri::command]
fn game_icon(id: String, state: State<AppState>) -> Option<String> {
    let s = state.settings.lock().unwrap();
    let g = s.games.iter().find(|g| g.id == id)?;
    [Path::new(&g.folder).join("app0/sce_sys/icon0.png"), Path::new(&g.source).join("sce_sys/icon0.png")]
        .iter().find_map(|p| data_url(p))
}

// ------------------------------------------------------------------ commands: conversion

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConvertReq {
    source: String,
    out: String,
    name: String,
    title_id: String,
    cpu_fix: String,
    link: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConvertEvent {
    kind: String,
    text: String,
    pct: Option<f64>,
    game: Option<Game>,
}

struct Job {
    app: AppHandle,
    cancel: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    log: Mutex<Vec<String>>,
}

impl Job {
    fn emit(&self, kind: &str, text: &str, pct: Option<f64>, game: Option<Game>) {
        let _ = self.app.emit("convert", ConvertEvent { kind: kind.into(), text: text.into(), pct, game });
    }
    fn log(&self, t: &str) {
        self.log.lock().unwrap().push(t.to_string());
        self.emit("log", t, None, None);
    }
    fn status(&self, t: &str, pct: f64) {
        self.emit("status", t, Some(pct), None);
    }
    fn check_cancel(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::SeqCst) { Err("Cancelled.".into()) } else { Ok(()) }
    }
}

fn walk(base: &Path, rel: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(base.join(rel)) else { return };
    for e in rd.flatten() {
        let name = e.file_name();
        let r = rel.join(&name);
        let Ok(ft) = e.file_type() else { continue };
        let is_dir = ft.is_dir() || (ft.is_symlink() && e.path().is_dir());
        if is_dir {
            if rel.as_os_str().is_empty() && MODULE_DIRS.iter().any(|m| name == *m) {
                continue; // the relinker writes converted modules there
            }
            walk(base, &r, out);
        } else {
            out.push(r);
        }
    }
}

fn extract_libs(archive: &Path, out: &Path) -> Result<(), String> {
    let n = archive.to_string_lossy();
    if n.ends_with(".zip") {
        let f = fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
        for i in 0..z.len() {
            let mut e = z.by_index(i).map_err(|e| e.to_string())?;
            let Some(rel) = e.enclosed_name() else { continue };
            if !rel.starts_with("libs") {
                continue;
            }
            let dst = out.join(rel);
            if e.is_dir() {
                fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
            } else {
                if let Some(p) = dst.parent() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
                let mut w = fs::File::create(&dst).map_err(|e| e.to_string())?;
                std::io::copy(&mut e, &mut w).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    } else if n.ends_with(".tar.gz") {
        let f = fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut t = tar::Archive::new(flate2::read::GzDecoder::new(f));
        for e in t.entries().map_err(|e| e.to_string())? {
            let mut e = e.map_err(|e| e.to_string())?;
            let p = e.path().map_err(|e| e.to_string())?.into_owned();
            let kind = e.header().entry_type();
            if p.starts_with("libs") && (kind.is_file() || kind.is_dir()) {
                e.unpack_in(out).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    } else {
        Err(format!("Unsupported libraries archive: {n}"))
    }
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)?.flatten() {
        let p = e.path();
        let d = dst.join(e.file_name());
        if p.is_dir() { copy_dir(&p, &d)? } else { fs::copy(&p, &d).map(|_| ())? }
    }
    Ok(())
}

fn run_convert(job: &Job, req: &ConvertReq, relinker: &Path, libs: &Path) -> Result<String, String> {
    let src = PathBuf::from(&req.source);
    let out = PathBuf::from(&req.out);
    let exe = find_executable(&src).ok_or("No game executable (eboot.bin) was found in this folder.")?;
    let magic = read_magic(&exe);
    let mut tmp: Option<PathBuf> = None;
    let exe_input = if SELF_MAGICS.contains(&magic) {
        job.log(&format!("{} is a SELF container – trying to unwrap it…", exe.display()));
        let unwrap = search_dirs().into_iter().flat_map(|d| [d.join("unwrap_self.py"), d.join("tools/unwrap_self.py")])
            .find(|p| p.is_file())
            .ok_or("The executable is still wrapped (SELF format) and must be a clean ELF.\n\nPut AnyPS5's tools/unwrap_self.py next to the launcher (or in ~/AnyPS5) and try again, or use a dump with a decrypted ELF.")?;
        let dir = std::env::temp_dir().join(format!("anyps5-{}", std::process::id()));
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let target = dir.join("eboot.elf");
        let o = Command::new("python3").arg("-I").arg(&unwrap).arg(&exe).arg(&target).output()
            .map_err(|e| format!("Could not run Python to unwrap the executable: {e}"))?;
        job.log(&String::from_utf8_lossy(&o.stdout));
        job.log(&String::from_utf8_lossy(&o.stderr));
        if !o.status.success() || !target.is_file() {
            return Err("Could not unwrap the SELF executable. It may still be encrypted.".into());
        }
        tmp = Some(dir);
        target
    } else if magic == ELF_MAGIC {
        exe.clone()
    } else {
        return Err("The game executable has an unknown format.".into());
    };

    fs::create_dir_all(&out).map_err(|e| format!("Could not create {}: {e}", out.display()))?;
    let app0 = out.join("app0");

    // 1) game resources -> app0/
    job.status("Copying game files…", 1.0);
    let mut files = vec![];
    walk(&src, Path::new(""), &mut files);
    let total = files.len().max(1);
    let (mut copied, mut linked, mut kept) = (0, 0, 0);
    for (i, rel) in files.iter().enumerate() {
        job.check_cancel()?;
        let s = src.join(rel);
        let d = app0.join(rel);
        if let Some(p) = d.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        if let (Ok(sm), Ok(dm)) = (fs::metadata(&s), fs::metadata(&d)) {
            if sm.len() == dm.len() && dm.modified().ok() >= sm.modified().ok() {
                kept += 1;
                continue;
            }
            let _ = fs::remove_file(&d);
        }
        let ext = rel.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        // never hard-link anything the relinker may rewrite, so the original dump stays untouched
        if req.link && !MODULE_EXTS.contains(&ext.as_str()) && fs::hard_link(&s, &d).is_ok() {
            linked += 1;
        } else {
            fs::copy(&s, &d).map_err(|e| format!("Copying {} failed: {e}", rel.display()))?;
            copied += 1;
        }
        if i % 20 == 0 {
            job.status(&format!("Copying game files… {}/{}", i + 1, total), 1.0 + 44.0 * (i + 1) as f64 / total as f64);
        }
    }
    job.log(&format!("Game files ready in app0/ – {copied} copied, {linked} linked, {kept} unchanged."));

    // 2) system libraries -> libs/
    job.status("Installing AnyPS5 system libraries…", 46.0);
    let libs_out = out.join("libs");
    fs::create_dir_all(&libs_out).map_err(|e| e.to_string())?;
    if libs.is_dir() {
        copy_dir(libs, &libs_out).map_err(|e| e.to_string())?;
    } else {
        extract_libs(libs, &out)?;
    }
    let count = fs::read_dir(&libs_out).map(|r| r.flatten().filter(|e| e.path().extension().map_or(false, |x| x == "prx")).count()).unwrap_or(0);
    if count == 0 {
        return Err("No system libraries (*.prx) were installed. Check the AnyPS5 files setting.".into());
    }
    job.log(&format!("Installed {count} system libraries into libs/."));

    // 3) relink
    job.check_cancel()?;
    job.status("Converting the game – this can take a while…", 50.0);
    let out_exe = out.join("app.elf");
    let mut args: Vec<String> = vec![];
    if !req.cpu_fix.is_empty() {
        args.push(req.cpu_fix.clone());
    }
    let has_modules = MODULE_DIRS.iter().any(|m| src.join(m).is_dir());
    if exe_input != exe || !has_modules {
        args.push("--sce-module-path".into());
        args.push(req.source.clone());
    }
    if !has_modules {
        args.push("--module-dir".into());
        args.push(".".into());
    }
    args.push(exe_input.to_string_lossy().into_owned());
    args.push(out_exe.to_string_lossy().into_owned());
    job.log(&format!("$ {} {}", relinker.display(), args.iter().map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.clone() }).collect::<Vec<_>>().join(" ")));
    make_exec(relinker);
    let mut child = Command::new(relinker).args(&args).current_dir(&out).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|e| format!("Could not start the relinker: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    *job.child.lock().unwrap() = Some(child);
    thread::scope(|sc| {
        sc.spawn(|| for l in BufReader::new(stderr).lines().map_while(Result::ok) { job.log(&l) });
        for l in BufReader::new(stdout).lines().map_while(Result::ok) {
            job.log(&l);
            if l.starts_with("Guest module:") {
                job.status("Converting the game – modules…", 75.0);
            }
        }
    });
    let code = job.child.lock().unwrap().take().map(|mut c| c.wait().ok().and_then(|s| s.code()).unwrap_or(-1)).unwrap_or(-1);
    if let Some(d) = tmp {
        let _ = fs::remove_dir_all(d);
    }
    job.check_cancel()?;
    if code != 0 || !out_exe.is_file() {
        return Err(format!("The relinker reported an error (exit code {code}). Open “Details” to see why."));
    }
    make_exec(&out_exe);
    let _ = fs::create_dir_all(out.join("anyps5-fonts"));
    Ok(out_exe.to_string_lossy().into_owned())
}

#[tauri::command]
fn start_convert(req: ConvertReq, app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let (relinker, libs) = {
        let s = state.settings.lock().unwrap();
        (detect_relinker(&s), detect_libs(&s))
    };
    let relinker = relinker.ok_or("The AnyPS5 relinker hasn't been set up yet.")?;
    let libs = libs.ok_or("The AnyPS5 system libraries haven't been set up yet.")?;
    let (s, o) = (fs::canonicalize(&req.source).map_err(|_| "The game folder doesn't exist.")?, PathBuf::from(&req.out));
    let o = fs::canonicalize(&o).unwrap_or(o);
    if o == s || o.starts_with(&s) {
        return Err("Save the converted game in a different folder, not inside the original game folder.".into());
    }
    let mut cur = state.convert.lock().unwrap();
    if cur.is_some() {
        return Err("A conversion is already running.".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    let child = Arc::new(Mutex::new(None));
    *cur = Some(ConvertHandle { cancel: cancel.clone(), child: child.clone() });
    let app2 = app.clone();
    thread::spawn(move || {
        let job = Job { app: app2.clone(), cancel, child, log: Mutex::new(vec![]) };
        let res = run_convert(&job, &req, &relinker, &libs);
        let st = app2.state::<AppState>();
        *st.convert.lock().unwrap() = None;
        match res {
            Ok(exe) => {
                let folder = Path::new(&exe).parent().unwrap().to_string_lossy().into_owned();
                let _ = fs::write(Path::new(&folder).join("conversion.log"), job.log.lock().unwrap().join("\n"));
                let mut s = st.settings.lock().unwrap();
                let old = s.games.iter().find(|g| g.folder == folder).cloned().unwrap_or_default();
                let game = Game {
                    id: folder.clone(),
                    name: if req.name.trim().is_empty() { "Game".into() } else { req.name.trim().into() },
                    title_id: req.title_id.clone(),
                    folder: folder.clone(),
                    exe,
                    source: req.source.clone(),
                    added: if old.added > 0.0 { old.added } else { now() },
                    last_played: old.last_played,
                    options: if old.id.is_empty() { Options::default() } else { old.options },
                };
                s.games.retain(|g| g.folder != folder);
                s.games.push(game.clone());
                let _ = save_settings(&s);
                job.emit("done", "Ready to play", Some(100.0), Some(game));
            }
            Err(e) => job.emit("error", &e, None, None),
        }
    });
    Ok(())
}

#[tauri::command]
fn cancel_convert(state: State<AppState>) {
    if let Some(h) = state.convert.lock().unwrap().as_ref() {
        h.cancel.store(true, Ordering::SeqCst);
        if let Some(c) = h.child.lock().unwrap().as_mut() {
            let _ = c.kill();
        }
    }
}

// ------------------------------------------------------------------ commands: library & play

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GameEvent {
    id: String,
    kind: String,
    text: String,
    code: Option<i32>,
}

#[tauri::command]
fn play(id: String, app: AppHandle, state: State<AppState>) -> Result<(), String> {
    if state.running.lock().unwrap().contains_key(&id) {
        return Err("This game is already running.".into());
    }
    let game = {
        let mut s = state.settings.lock().unwrap();
        let g = s.games.iter_mut().find(|g| g.id == id).ok_or("Game not found.")?;
        g.last_played = Some(now());
        let g = g.clone();
        let _ = save_settings(&s);
        g
    };
    let exe = PathBuf::from(&game.exe);
    if !exe.is_file() {
        return Err(format!("The game file is missing:\n{}\n\nUse “Convert again”.", exe.display()));
    }
    if !Path::new(GAME_INTERP).exists() {
        return Err(if is_nixos() {
            format!("Games need {GAME_INTERP}, which NixOS only provides with nix-ld.\n\nAdd programs.anyps5-launcher.enable = true; (from this project's flake) or programs.nix-ld.enable = true; to your NixOS configuration and rebuild.")
        } else {
            format!("Games need {GAME_INTERP}, which is missing on this system. Install your distribution's 64-bit glibc.")
        });
    }
    make_exec(&exe);
    let o = &game.options;
    let mut cmd = Command::new(&exe);
    cmd.current_dir(exe.parent().unwrap()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .env("ANYPS5_LANGUAGE", o.language.to_string());
    if o.overlay { cmd.env("ANYPS5_OVERLAY", "1"); }
    if !o.vsync.is_empty() { cmd.env("ANYPS5_PRESENT_MODE", &o.vsync); }
    if !o.gpu.is_empty() { cmd.env("ANYPS5_GPU", &o.gpu); }
    if !o.playgo.is_empty() { cmd.env("APS5_PLAYGO_UNLISTED_CHUNKS", &o.playgo); }
    // Nix package: hand the game's libraries to nix-ld (ignored on other distributions)
    if let Some(libs) = std::env::var_os("ANYPS5_GAME_LIBRARY_PATH") {
        let existing = std::env::var_os("NIX_LD_LIBRARY_PATH").unwrap_or_default();
        let paths: Vec<PathBuf> = std::env::split_paths(&libs).chain(std::env::split_paths(&existing)).collect();
        if let Ok(joined) = std::env::join_paths(paths) {
            cmd.env("NIX_LD_LIBRARY_PATH", joined);
        }
    }
    // the launcher's own WebKit settings must not leak into the game
    cmd.env_remove("WEBKIT_DISABLE_COMPOSITING_MODE").env_remove("WEBKIT_DISABLE_DMABUF_RENDERER");
    let mut child = cmd.spawn().map_err(|e| format!("Could not start the game: {e}"))?;
    let (so, se) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let child = Arc::new(Mutex::new(child));
    state.running.lock().unwrap().insert(id.clone(), child.clone());
    let log: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
    let send = {
        let (app, id, log) = (app.clone(), id.clone(), log.clone());
        move |l: String| {
            let mut v = log.lock().unwrap();
            v.push(l.clone());
            if v.len() > 20000 { v.drain(0..5000); }
            let _ = app.emit("game", GameEvent { id: id.clone(), kind: "log".into(), text: l, code: None });
        }
    };
    let s2 = send.clone();
    let t_err = thread::spawn(move || for l in BufReader::new(se).lines().map_while(Result::ok) { s2(l) });
    let folder = game.folder.clone();
    thread::spawn(move || {
        for l in BufReader::new(so).lines().map_while(Result::ok) { send(l) }
        let _ = t_err.join();
        let code = loop {
            if let Ok(Some(s)) = child.lock().unwrap().try_wait() { break s.code().unwrap_or(-1); }
            thread::sleep(std::time::Duration::from_millis(100));
        };
        let _ = fs::write(Path::new(&folder).join("last-run.log"), log.lock().unwrap().join("\n"));
        app.state::<AppState>().running.lock().unwrap().remove(&id);
        let _ = app.emit("game", GameEvent { id, kind: "exit".into(), text: String::new(), code: Some(code) });
    });
    Ok(())
}

#[tauri::command]
fn stop_game(id: String, state: State<AppState>) {
    if let Some(c) = state.running.lock().unwrap().get(&id) {
        let _ = c.lock().unwrap().kill();
    }
}

#[tauri::command]
fn last_log(id: String, state: State<AppState>) -> String {
    let s = state.settings.lock().unwrap();
    s.games.iter().find(|g| g.id == id).and_then(|g| fs::read_to_string(Path::new(&g.folder).join("last-run.log")).ok()).unwrap_or_default()
}

#[tauri::command]
fn update_game(id: String, name: String, options: Options, state: State<AppState>) -> Result<(), String> {
    let mut s = state.settings.lock().unwrap();
    let g = s.games.iter_mut().find(|g| g.id == id).ok_or("Game not found.")?;
    if !name.trim().is_empty() {
        g.name = name.trim().into();
    }
    g.options = options;
    save_settings(&s)
}

#[tauri::command]
fn remove_game(id: String, delete_files: bool, state: State<AppState>) -> Result<(), String> {
    let mut s = state.settings.lock().unwrap();
    let g = s.games.iter().find(|g| g.id == id).cloned().ok_or("Game not found.")?;
    if delete_files {
        let f = Path::new(&g.folder);
        // only delete folders that look like a converted game
        if f.join("app0").is_dir() && f.join("libs").is_dir() && f.join("app.elf").exists() {
            fs::remove_dir_all(f).map_err(|e| format!("Could not delete the folder: {e}"))?;
        }
    }
    s.games.retain(|x| x.id != id);
    save_settings(&s)
}

#[tauri::command]
fn open_game_path(id: String, what: String, state: State<AppState>) -> Result<(), String> {
    let folder = {
        let s = state.settings.lock().unwrap();
        PathBuf::from(&s.games.iter().find(|g| g.id == id).ok_or("Game not found.")?.folder)
    };
    let p = match what.as_str() {
        "controls" => {
            let ini = folder.join("anyps5-input.ini");
            if !ini.exists() {
                fs::write(&ini, INPUT_TEMPLATE).map_err(|e| e.to_string())?;
            }
            ini
        }
        "fonts" | "screenshots" => {
            let d = folder.join(format!("anyps5-{what}"));
            fs::create_dir_all(&d).map_err(|e| e.to_string())?;
            d
        }
        _ => folder,
    };
    open_with_system(&p.to_string_lossy())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only web links can be opened.".into());
    }
    open_with_system(&url)
}

fn main() {
    // WebKitGTK's GPU compositing breaks on some Linux drivers (blank window); software is plenty for this UI.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { settings: Mutex::new(load_settings()), ..Default::default() })
        .invoke_handler(tauri::generate_handler![
            get_state, save_setup, pick, inspect_folder, game_icon, start_convert, cancel_convert,
            play, stop_game, last_log, update_game, remove_game, open_game_path, open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running AnyPS5 Launcher");
}
