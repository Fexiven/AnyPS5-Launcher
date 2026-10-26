"use strict";
// AnyPS5 Launcher – UI. Talks to the Rust side through Tauri commands and events.

const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;

// ------------------------------------------------------------------ icons & helpers
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  chev: '<path d="M9 18l6-6-6-6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  pad: '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59l-.9 7.8A3 3 0 0 0 4.8 20c1 0 1.8-.6 2.3-1.4L8.5 16h7l1.4 2.6c.5.8 1.3 1.4 2.3 1.4a3 3 0 0 0 3-3.6l-.9-7.8A4 4 0 0 0 17.32 5z"/>',
  keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  font: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  term: '<path d="M4 17l6-6-6-6M12 19h8"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
};
const icon = (n, cls = "") => `<span class="i ${cls}"><svg viewBox="0 0 24 24">${ICONS[n] || ""}</svg></span>`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hashColor(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  return `linear-gradient(150deg, hsl(${hue} 70% 52%), hsl(${(hue + 50) % 360} 65% 32%))`;
}
function initials(name) {
  const w = String(name).split(/[\s:\-_]+/).filter((x) => /[\p{L}\p{N}]/u.test(x[0] || ""));
  return (w.slice(0, 2).map((x) => x[0]).join("") || "?").toUpperCase();
}
const placeholder = (name) => `<div class="ph" style="background:${hashColor(name)}">${esc(initials(name))}</div>`;
const coverHtml = (g) => (icons[g.id] ? `<img src="${icons[g.id]}" alt="">` : placeholder(g.name));

function timeAgo(t) {
  if (!t) return "Never played";
  const s = Date.now() / 1000 - t;
  if (s < 60) return "Played just now";
  if (s < 3600) return `Played ${Math.round(s / 60)} min ago`;
  if (s < 86400) return `Played ${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `Played ${Math.round(s / 86400)} days ago`;
  return "Played " + new Date(t * 1000).toLocaleDateString();
}

function toast(text, kind = "ok", onClick) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  if (onClick) { el.style.cursor = "pointer"; el.onclick = () => { el.remove(); onClick(); }; }
  el.innerHTML = icon(kind === "err" ? "alert" : "check") + `<div>${esc(text)}</div>`;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "err" ? 7000 : 3500);
}

async function call(cmd, args) {
  try {
    return await invoke(cmd, args);
  } catch (e) {
    toast(String(e), "err");
    throw e;
  }
}

// ------------------------------------------------------------------ state
const LANGUAGES = [[1, "English (United States)"], [18, "English (United Kingdom)"], [4, "German"], [2, "French"], [22, "French (Canada)"], [3, "Spanish"], [20, "Spanish (Latin America)"], [5, "Italian"], [6, "Dutch"], [7, "Portuguese (Portugal)"], [17, "Portuguese (Brazil)"], [16, "Polish"], [8, "Russian"], [30, "Ukrainian"], [19, "Turkish"], [23, "Czech"], [24, "Hungarian"], [25, "Greek"], [26, "Romanian"], [12, "Finnish"], [13, "Swedish"], [14, "Danish"], [15, "Norwegian"], [0, "Japanese"], [9, "Korean"], [10, "Chinese (Traditional)"], [11, "Chinese (Simplified)"], [21, "Arabic"], [27, "Thai"], [28, "Vietnamese"], [29, "Indonesian"]];
const PLAYGO = [["", "Automatic (recommended)"], ["installed", "Report missing chunks as installed"], ["absent", "Report missing chunks as absent"]];

let S = null; // state from the backend
const icons = {};
const logs = {}; // game id -> lines of the current/last run
const running = new Set();
let view = { page: "library", id: null, tab: "settings" };
let query = "";

const games = () => (S ? S.settings.games : []);
const gameById = (id) => games().find((g) => g.id === id);
const setupOk = () => S && S.relinker && S.libs;
const cpuVendor = () => (S ? S.cpu.split("|")[0] : "unknown");

async function refresh() {
  S = await invoke("get_state");
  S.running.forEach((id) => running.add(id));
  $("#version").textContent = `Launcher v${S.version}`;
  await Promise.all(games().filter((g) => !(g.id in icons)).map(async (g) => {
    icons[g.id] = await invoke("game_icon", { id: g.id }).catch(() => null);
  }));
  render();
}

// ------------------------------------------------------------------ sidebar
function renderSidebar() {
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.nav === (view.page === "game" ? "library" : view.page)));
  const st = $("#setup-status");
  const row = (ok, t) => `<div class="row"><span class="dot ${ok ? "ok" : "bad"}"></span>${t}</div>`;
  st.innerHTML = S ? row(!!S.relinker, "Relinker") + row(!!S.libs, "System libraries") : "";
  const np = $("#now-playing");
  const id = [...running][0];
  const g = id && gameById(id);
  if (g) {
    np.classList.remove("hidden");
    np.innerHTML = `${icons[g.id] ? `<img src="${icons[g.id]}" alt="">` : placeholder(g.name)}
      <div style="min-width:0"><div class="t">${esc(g.name)}</div><div class="s"><span class="pulse"></span>Running</div></div>`;
    np.onclick = () => openGame(g.id, "log");
  } else np.classList.add("hidden");
}

// ------------------------------------------------------------------ library
function renderLibrary() {
  const list = games().slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name));
  const shown = list.filter((g) => !query || (g.name + " " + g.titleId).toLowerCase().includes(query.toLowerCase()));
  const banner = setupOk() ? "" : `
    <div class="banner">${icon("alert")}<div class="txt"><b>One-time setup needed.</b>
      Tell the launcher where the AnyPS5 relinker and system libraries are.</div>
      <button class="btn primary sm" data-act="setup">Set up now</button></div>`;
  let body;
  if (!list.length) {
    body = `
    <div class="empty">
      <div class="empty-art">${icon("pad")}</div>
      <h2>Your library is empty</h2>
      <p>Add a game folder you dumped from your own PS5. The launcher converts it for Linux and keeps it here, ready to play.</p>
      <button class="btn primary" data-act="add">${icon("plus")}Add your first game</button>
      <div class="steps">
        <div class="step"><div class="n">1</div><h3>Get AnyPS5</h3><div class="d">Download the relinker and Linux libraries from GitHub.</div></div>
        <div class="step"><div class="n">2</div><h3>Add a game</h3><div class="d">Pick your PS5 game folder. Conversion is automatic.</div></div>
        <div class="step"><div class="n">3</div><h3>Play</h3><div class="d">One click. No terminal needed.</div></div>
      </div>
    </div>`;
  } else {
    body = `<div class="grid">${shown.map((g) => {
      const run = running.has(g.id);
      return `<div class="card" tabindex="0" data-id="${esc(g.id)}">
        <div class="cover">${coverHtml(g)}
          ${run ? `<div class="badge"><span class="pulse"></span>Running</div>` : ""}
          <div class="overlay"><button class="fab ${run ? "running" : ""}" data-play="${esc(g.id)}" title="${run ? "Stop" : "Play"}">${icon(run ? "stop" : "play")}</button></div>
        </div>
        <div class="t" title="${esc(g.name)}">${esc(g.name)}</div>
        <div class="s">${esc(g.titleId || timeAgo(g.lastPlayed))}</div>
      </div>`;
    }).join("")}
      ${query ? "" : `<div class="card add-card" tabindex="0" data-act="add"><div class="cover">${icon("plus")}</div><div class="t muted">Add game</div><div class="s">&nbsp;</div></div>`}
    </div>${shown.length ? "" : `<p class="muted">No games match “${esc(query)}”.</p>`}`;
  }
  $("#main").innerHTML = `<div class="page">
    <div class="page-head"><h1>Library</h1>${list.length ? `<span class="count">${list.length} game${list.length === 1 ? "" : "s"}</span>` : ""}
      <div class="spacer"></div>
      ${list.length ? `<label class="search">${icon("search", "sm")}<input id="q" placeholder="Search games" value="${esc(query)}"></label>
      <button class="btn primary" data-act="add">${icon("plus")}Add game</button>` : ""}
    </div>${banner}${body}</div>`;

  const q = $("#q");
  if (q) {
    q.oninput = () => { query = q.value; renderLibrary(); const n = $("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  }
  $$("[data-act=add]").forEach((b) => (b.onclick = () => addGameModal()));
  $$("[data-act=setup]").forEach((b) => (b.onclick = () => setupModal()));
  $$(".card[data-id]").forEach((c) => {
    c.onclick = () => openGame(c.dataset.id);
    c.onkeydown = (e) => { if (e.key === "Enter") openGame(c.dataset.id); };
  });
  $$("[data-play]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); togglePlay(b.dataset.play); }));
}

// ------------------------------------------------------------------ game page
function openGame(id, tab) {
  view = { page: "game", id, tab: tab || (view.id === id ? view.tab : "settings") };
  render();
  $("#main").scrollTop = 0;
}

function renderGame() {
  const g = gameById(view.id);
  if (!g) { view = { page: "library" }; return renderLibrary(); }
  const run = running.has(g.id);
  const bg = icons[g.id] ? `style="background-image:url('${icons[g.id]}')"` : `style="background:${hashColor(g.name)}"`;
  $("#main").innerHTML = `
  <div class="hero"><div class="hero-bg" ${bg}></div>
    <div class="hero-inner">
      <button class="btn ghost sm back" id="back">${icon("back", "sm")}Library</button>
      <div class="hero-row">
        <div class="hero-cover">${coverHtml(g)}</div>
        <div class="hero-info">
          <h1 class="hero-title">${esc(g.name)}</h1>
          <div class="chips">
            ${run ? `<span class="chip ok"><span class="pulse"></span>Running</span>` : ""}
            ${g.titleId ? `<span class="chip">${esc(g.titleId)}</span>` : ""}
            <span class="chip">${esc(timeAgo(g.lastPlayed))}</span>
          </div>
          <div class="actions">
            ${run ? `<button class="btn stop" id="play">${icon("stop")}Stop</button>`
                  : `<button class="btn play" id="play">${icon("play")}Play</button>`}
            <button class="btn" id="folder">${icon("folder")}Open folder</button>
            <button class="btn ghost" id="reconvert">${icon("refresh")}Convert again</button>
            <button class="btn danger icon-btn" id="remove" title="Remove from library">${icon("trash")}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="tabs">
    <button class="tab ${view.tab === "settings" ? "active" : ""}" data-tab="settings">Settings</button>
    <button class="tab ${view.tab === "log" ? "active" : ""}" data-tab="log">Log${run ? " ●" : ""}</button>
  </div>
  <div class="tab-body" id="tab-body"></div>`;
  $("#back").onclick = () => { view = { page: "library" }; render(); };
  $("#play").onclick = () => togglePlay(g.id);
  $("#folder").onclick = () => call("open_game_path", { id: g.id, what: "folder" });
  $("#reconvert").onclick = () => addGameModal(g);
  $("#remove").onclick = () => removeModal(g);
  $$("[data-tab]").forEach((t) => (t.onclick = () => { view.tab = t.dataset.tab; renderGame(); }));
  if (view.tab === "log") renderLogTab(g); else renderSettingsTab(g);
}

function seg(name, options, value) {
  return `<div class="seg" data-seg="${name}">${options.map(([v, l]) =>
    `<button data-v="${esc(v)}" class="${v === value ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
}
function bindSeg(root, name, onChange) {
  const el = $(`[data-seg=${name}]`, root);
  $$("button", el).forEach((b) => (b.onclick = () => {
    $$("button", el).forEach((x) => x.classList.toggle("on", x === b));
    onChange(b.dataset.v);
  }));
}
function switchHtml(id, on, title, hint) {
  return `<div class="switch ${on ? "on" : ""}" id="${id}"><div class="knob"></div><div><div class="st">${esc(title)}</div>${hint ? `<div class="field-hint" style="margin-top:3px">${esc(hint)}</div>` : ""}</div></div>`;
}
function bindSwitch(id, onChange) {
  const el = document.getElementById(id);
  el.onclick = () => { el.classList.toggle("on"); onChange(el.classList.contains("on")); };
}

function renderSettingsTab(g) {
  const o = g.options;
  const body = $("#tab-body");
  body.innerHTML = `
    <div class="form">
      <label>Name</label><div><input class="input" id="f-name" value="${esc(g.name)}"></div>
      <label>Game language</label><div><select class="select" id="f-lang">${LANGUAGES.map(([v, l]) => `<option value="${v}" ${v === o.language ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <div class="field-hint">Games show their text in this language when they include it.</div></div>
      <label>V-Sync</label><div>${seg("vsync", [["", "On"], ["mailbox", "Fast"], ["immediate", "Off"]], o.vsync)}
        <div class="field-hint">On: smooth, no tearing · Fast: lower input lag · Off: fastest, may tear.</div></div>
      <label>FPS counter</label><div>${switchHtml("f-overlay", o.overlay, "Show FPS and frame times", "Toggle it in game any time with F10.")}</div>
      <label>Graphics card</label><div><input class="input" id="f-gpu" placeholder="Automatic" value="${esc(o.gpu)}">
        <div class="field-hint">Leave empty to pick automatically, or type part of the card's name, e.g. “nvidia” or “radeon”.</div></div>
      <label>Game data</label><div><select class="select" id="f-playgo">${PLAYGO.map(([v, l]) => `<option value="${v}" ${v === o.playgo ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <div class="field-hint">Only change this if a game stops with a PlayGo or chunk error.</div></div>
      <label>Files</label><div class="row-btns">
        <button class="btn sm" data-open="controls">${icon("keys", "sm")}Keyboard controls</button>
        <button class="btn sm" data-open="fonts">${icon("font", "sm")}Fonts folder</button>
        <button class="btn sm" data-open="screenshots">${icon("image", "sm")}Screenshots</button></div>
      <label></label><div class="saved" id="saved">${icon("check", "sm")} Saved</div>
    </div>`;
  let timer;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const name = $("#f-name").value.trim() || g.name;
      const options = {
        language: Number($("#f-lang").value), overlay: $("#f-overlay").classList.contains("on"),
        vsync: $(".seg[data-seg=vsync] .on").dataset.v, gpu: $("#f-gpu").value.trim(), playgo: $("#f-playgo").value,
      };
      await call("update_game", { id: g.id, name, options });
      Object.assign(g, { name, options });
      const s = $("#saved"); s.classList.add("show"); setTimeout(() => s.classList.remove("show"), 1400);
      $(".hero-title").textContent = name;
    }, 300);
  };
  ["f-name", "f-gpu"].forEach((i) => ($("#" + i).onchange = save));
  ["f-lang", "f-playgo"].forEach((i) => ($("#" + i).onchange = save));
  bindSeg(body, "vsync", save);
  bindSwitch("f-overlay", save);
  $$("[data-open]", body).forEach((b) => (b.onclick = () => call("open_game_path", { id: g.id, what: b.dataset.open })));
}

function classify(line) {
  if (/^\$ /.test(line)) return "c";
  if (/error|fatal|failed|exception|denied|abort/i.test(line)) return "e";
  return "";
}
const logLine = (l) => { const c = classify(l); return c ? `<span class="${c}">${esc(l)}</span>\n` : esc(l) + "\n"; };

function tipsFor(lines, g) {
  const t = lines.join("\n");
  const tips = [];
  if (/udmabuf: Permission denied/.test(t))
    tips.push({ title: "Allow GPU memory sharing", body: "Run <code>sudo usermod -aG kvm $USER</code> in a terminal, then log out and back in." });
  if (/sceFontOpenFontSet[^\n]*file=\(none\)/.test(t))
    tips.push({ title: "This game needs fonts", body: "Put the free Noto Sans fonts (NotoSans-Regular.ttf, NotoSans-Bold.ttf, NotoSansCJK-Regular.ttc …) into the game's fonts folder.", btn: ["Open fonts folder", () => call("open_game_path", { id: g.id, what: "fonts" })] });
  if (/\b(AVX2|F16C|BMI1|BMI2|LZCNT|MOVBE)\b/i.test(t) && /missing|lacks|not supported/i.test(t))
    tips.push({ title: "Your processor is missing required instructions", body: "AnyPS5 runs games natively, so the CPU needs AVX2 and similar extensions (most CPUs from 2015 or newer)." });
  if (/param\.json/i.test(t) && /error|invalid|missing/i.test(t))
    tips.push({ title: "Game information file problem", body: "The game's <code>sce_sys/param.json</code> is missing or damaged. Convert again from a complete dump." });
  if (/PlayGo|chunk ID/i.test(t) && /error|stop/i.test(t))
    tips.push({ title: "Game data chunk error", body: "In Settings, set <b>Game data</b> to “Report missing chunks as installed” – or “absent” if that doesn't help." });
  if (/vulkan|Physical device/i.test(t) && /no usable|not found|VK_ERROR|failed to (create|find)/i.test(t))
    tips.push({ title: "Graphics driver problem", body: "AnyPS5 needs a GPU with Vulkan 1.1. Install your distribution's Vulkan driver (e.g. <code>mesa-vulkan-drivers</code>) or pick a card in Settings." });
  if (/Illegal instruction|SIGILL|AMD-specific/i.test(t) && cpuVendor() === "intel")
    tips.push({ title: "Intel processor", body: "Use <b>Convert again</b> and keep the processor set to Intel – it rewrites AMD-only instructions." });
  if (/was not relinked/.test(t))
    tips.push({ title: "A game module wasn't converted", body: "Part of this game loads extra code at runtime that the launcher didn't convert. This needs a manual relinker run with <code>--module-dir</code>." });
  return tips;
}

async function renderLogTab(g) {
  const body = $("#tab-body");
  if (!logs[g.id] || (!running.has(g.id) && !logs[g.id].length)) {
    const txt = await invoke("last_log", { id: g.id }).catch(() => "");
    logs[g.id] = txt ? txt.split("\n") : [];
  }
  const lines = logs[g.id];
  const tips = tipsFor(lines, g);
  body.innerHTML = `
    ${tips.map((t, i) => `<div class="tip">${icon("alert")}<div><b>${esc(t.title)}</b><div class="d">${t.body}</div>${t.btn ? `<button class="btn sm" data-tip="${i}">${esc(t.btn[0])}</button>` : ""}</div></div>`).join("")}
    <div class="log-tools"><h3>${running.has(g.id) ? "Live output" : "Last run"}</h3><div class="spacer"></div>
      <button class="btn sm ghost" id="copy-log">Copy</button></div>
    <div class="log" id="log">${lines.length ? lines.map(logLine).join("") : `<span class="dim">No output yet. Press Play to start the game.</span>`}</div>`;
  tips.forEach((t, i) => t.btn && ($(`[data-tip="${i}"]`).onclick = t.btn[1]));
  $("#copy-log").onclick = () => navigator.clipboard.writeText(lines.join("\n")).then(() => toast("Log copied"));
  const el = $("#log");
  el.scrollTop = el.scrollHeight;
}

async function togglePlay(id) {
  if (running.has(id)) return invoke("stop_game", { id });
  if (!setupOk()) return setupModal();
  logs[id] = [];
  await call("play", { id });
  running.add(id);
  const g = gameById(id);
  if (g) g.lastPlayed = Date.now() / 1000;
  render();
}

// ------------------------------------------------------------------ modals
function modal(html, { onClose, wide } = {}) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="backdrop"><div class="modal" ${wide ? 'style="width:min(700px,calc(100vw - 48px))"' : ""}>${html}</div></div>`;
  const bd = $(".backdrop", root);
  const close = () => { if (!onClose || onClose() !== false) { root.innerHTML = ""; document.removeEventListener("keydown", esc_); } };
  const esc_ = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", esc_);
  bd.onmousedown = (e) => { if (e.target === bd) close(); };
  $$("[data-close]", root).forEach((b) => (b.onclick = close));
  return { el: $(".modal", root), close };
}

function setupModal() {
  const st = S.settings;
  const vals = { relinker: S.relinker || st.relinker || "", libs: S.libs || st.libs || "", gamesDir: st.gamesDir || "" };
  const row = (key, name, hint, ok) => `
    <div class="file-row ${ok ? "" : "bad"}" data-row="${key}">
      <div class="st ${ok ? "ok" : "bad"}">${icon(ok ? "check" : "alert", "sm")}</div>
      <div class="main"><div class="n">${name}</div><div class="p"><span dir="ltr">${esc(vals[key] || hint)}</span></div></div>
      <button class="btn sm" data-pick="${key}">Browse…</button></div>`;
  const draw = () => {
    $("#rows").innerHTML =
      row("relinker", "Relinker", "relinker-v… (the file without an extension)", !!vals.relinker) +
      row("libs", "System libraries", "prx-linux-v….zip or a libs folder", !!vals.libs) +
      row("gamesDir", "Converted games folder", "~/AnyPS5 Games", true);
    $$("[data-pick]").forEach((b) => (b.onclick = async () => {
      const k = b.dataset.pick;
      let p;
      if (k === "relinker") p = await invoke("pick", { kind: "file", title: "Select the AnyPS5 relinker" });
      else if (k === "libs") {
        p = await invoke("pick", { kind: "archive", title: "Select prx-linux-….zip (Cancel to choose a folder)" });
        if (!p) p = await invoke("pick", { kind: "folder", title: "Or select a libs folder with .prx files" });
      } else p = await invoke("pick", { kind: "folder", title: "Where should converted games go?" });
      if (p) { vals[k] = p; draw(); }
    }));
  };
  const m = modal(`
    <div class="modal-head"><h2>AnyPS5 files</h2><div class="spacer"></div><button class="btn ghost icon-btn" data-close>${icon("x")}</button></div>
    <div class="modal-body">
      <p class="modal-sub">Download two Linux files from the AnyPS5 releases page: the <b>relinker</b> and the <b>system libraries</b> (prx-linux-….zip).
        Put them in <code>~/AnyPS5</code> or <code>~/Downloads</code> and they're found automatically – no unzipping needed.</p>
      <button class="btn sm" id="dl">${icon("ext", "sm")}Open releases page</button>
      <div id="rows" style="margin-top:18px"></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="save">Save</button></div>`);
  draw();
  $("#dl").onclick = () => call("open_url", { url: "https://github.com/boykopovar/AnyPS5/releases" });
  $("#save").onclick = async () => {
    await call("save_setup", { req: { relinker: vals.relinker, libs: vals.libs, gamesDir: vals.gamesDir } });
    m.close();
    toast("AnyPS5 is set up");
    refresh();
  };
}

let conv = null; // active conversion UI state

function addGameModal(existing) {
  if (!setupOk()) return setupModal();
  const vendor = cpuVendor();
  const f = {
    source: existing ? existing.source : "", out: existing ? existing.folder : "", name: existing ? existing.name : "",
    titleId: existing ? existing.titleId : "", cpuFix: vendor === "intel" ? "--to-intel" : "", link: true, info: null,
  };
  const m = modal(`
    <div class="modal-head"><h2>${existing ? "Convert again" : "Add a game"}</h2><div class="spacer"></div><button class="btn ghost icon-btn" id="x">${icon("x")}</button></div>
    <div class="modal-body">
      <span class="label">Game folder</span>
      <div class="picker" id="picker"></div>
      <div id="details" class="hidden">
        <span class="label">Name</span><input class="input" id="a-name">
        <span class="label">Save to</span>
        <div class="inline"><input class="input" id="a-out"><button class="btn" id="a-browse">Browse…</button></div>
        <button class="adv-toggle" id="adv-t">${icon("chev", "sm")}Advanced options</button>
        <div class="adv hidden" id="adv">
          <div class="r"><span>Processor</span>${seg("cpu", [["", "AMD"], ["--to-intel", "Intel"]], f.cpuFix)}
            <span class="dim xs">Detected: ${esc((S.cpu.split("|")[1] || vendor).trim())}</span></div>
          ${switchHtml("a-link", true, "Save disk space", "Link large game files instead of copying them (same drive only). Your original dump is never changed.")}
        </div>
      </div>
      <div class="progress hidden" id="prog">
        <div class="top"><span class="spinner" id="spin"></span><span id="p-status">Starting…</span><div class="spacer"></div>
          <button class="btn sm ghost" id="p-log-t">Details</button></div>
        <div class="bar"><div id="p-bar"></div></div>
        <div class="log hidden" id="p-log"></div>
        <div id="p-result"></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary" id="go" disabled>Convert game</button></div>`,
  { wide: true, onClose: () => {
      if (conv && conv.active) { if (confirm("Stop the conversion?")) invoke("cancel_convert"); return false; }
      conv = null;
    } });
  $("#x").onclick = $("#cancel").onclick = () => m.close();

  const drawPicker = () => {
    const p = $("#picker");
    const i = f.info;
    if (!f.source) {
      p.className = "picker";
      p.innerHTML = `<div class="thumb">${icon("folder", "lg")}</div><div><div class="pt">Choose your game folder</div>
        <div class="muted sm-text" style="margin-top:4px">The folder you dumped from your own PS5 – it contains eboot.bin and sce_sys.</div></div>`;
      return;
    }
    p.className = "picker filled";
    const thumb = i && i.icon ? `<img src="${i.icon}" alt="">` : placeholder(f.name || "?");
    const det = !i ? "" : i.ok
      ? `<div class="pd ok">✓ ${esc(i.exe)}${i.wrapped ? " (will be unwrapped)" : ""}${i.titleId ? " · " + esc(i.titleId) : ""}${i.modules ? ` · ${i.modules} modules` : ""}</div>`
      : `<div class="pd bad">⚠ ${esc(i.message)}</div>`;
    p.innerHTML = `<div class="thumb">${thumb}</div><div style="min-width:0;flex:1"><div class="pt">${esc(f.name || "Game")}</div>
      <div class="pp"><span dir="ltr">${esc(f.source)}</span></div>${det}</div><span class="change">Change</span>`;
  };
  const update = () => {
    drawPicker();
    const ready = !!(f.info && f.info.ok);
    $("#details").classList.toggle("hidden", !f.source);
    $("#go").disabled = !ready || !f.out.trim();
  };
  const inspect = async (path, keepOut) => {
    f.source = path;
    f.info = await invoke("inspect_folder", { path });
    if (!keepOut || !f.name) f.name = f.info.name;
    f.titleId = f.info.titleId;
    if (!keepOut || !f.out) f.out = f.info.suggestedOut;
    $("#a-name").value = f.name;
    $("#a-out").value = f.out;
    update();
  };
  $("#picker").onclick = async () => {
    if (conv && conv.active) return;
    const p = await invoke("pick", { kind: "folder", title: "Choose the game folder (with eboot.bin)" });
    if (p) inspect(p, false);
  };
  $("#a-name").oninput = (e) => { f.name = e.target.value; drawPicker(); };
  $("#a-out").oninput = (e) => { f.out = e.target.value; update(); };
  $("#a-browse").onclick = async () => {
    const p = await invoke("pick", { kind: "folder", title: "Where should the converted game go?" });
    if (p) { f.out = p.replace(/\/$/, "") + "/" + (f.name || "Game").replace(/[\/\\:*?"<>|]/g, "").trim(); $("#a-out").value = f.out; update(); }
  };
  $("#adv-t").onclick = () => { $("#adv-t").classList.toggle("open"); $("#adv").classList.toggle("hidden"); };
  bindSeg(m.el, "cpu", (v) => (f.cpuFix = v));
  bindSwitch("a-link", (v) => (f.link = v));
  $("#p-log-t").onclick = () => $("#p-log").classList.toggle("hidden");

  $("#go").onclick = async () => {
    if (conv && conv.done) { const id = conv.game.id; m.close(); return togglePlay(id); }
    $("#prog").classList.remove("hidden");
    $("#p-result").innerHTML = "";
    $("#p-log").innerHTML = "";
    $("#spin").classList.remove("hidden");
    $("#p-bar").style.width = "2%";
    $("#p-status").textContent = "Starting…";
    conv = { active: true, done: false, lines: [] };
    $("#go").disabled = true;
    $("#go").textContent = "Converting…";
    $("#cancel").textContent = "Stop";
    try {
      await invoke("start_convert", { req: { source: f.source, out: f.out.trim(), name: f.name, titleId: f.titleId, cpuFix: f.cpuFix, link: f.link } });
    } catch (e) { onConvert({ kind: "error", text: String(e) }); }
  };

  update();
  if (existing) inspect(existing.source, true);
}

function onConvert(ev) {
  if (!conv || !$("#prog")) return;
  if (ev.kind === "log") {
    conv.lines.push(ev.text);
    const el = $("#p-log");
    el.insertAdjacentHTML("beforeend", logLine(ev.text));
    el.scrollTop = el.scrollHeight;
  } else if (ev.kind === "status") {
    $("#p-status").textContent = ev.text;
    if (ev.pct != null) $("#p-bar").style.width = Math.max(2, ev.pct) + "%";
  } else if (ev.kind === "done") {
    conv.active = false;
    conv.done = true;
    conv.game = ev.game;
    delete icons[ev.game.id];
    $("#p-bar").style.width = "100%";
    $("#spin").classList.add("hidden");
    $("#p-status").textContent = "Finished";
    $("#p-result").innerHTML = `<div class="success"><div class="ic">${icon("check")}</div><div><b>${esc(ev.game.name)} is ready</b>
      <div class="muted sm-text">It's in your library. You can play it right away.</div></div></div>`;
    $("#go").disabled = false;
    $("#go").className = "btn play";
    $("#go").style.height = "40px";
    $("#go").innerHTML = icon("play") + "Play now";
    $("#cancel").textContent = "Done";
    refresh();
  } else if (ev.kind === "error") {
    conv.active = false;
    $("#spin").classList.add("hidden");
    $("#p-bar").style.width = "0";
    $("#p-status").textContent = ev.text === "Cancelled." ? "Stopped" : "Conversion failed";
    if (ev.text !== "Cancelled.") {
      $("#p-log").classList.remove("hidden");
      $("#p-result").innerHTML = `<div class="tip" style="margin-top:14px;background:var(--danger-soft);border-color:rgba(239,90,95,.3)">${icon("alert")}<div><b>Couldn't convert this game</b><div class="d" style="white-space:pre-line">${esc(ev.text)}</div></div></div>`;
    }
    $("#go").disabled = false;
    $("#go").textContent = "Try again";
    $("#cancel").textContent = "Close";
  }
}

function removeModal(g) {
  let del = false;
  const m = modal(`
    <div class="modal-head"><h2>Remove “${esc(g.name)}”?</h2></div>
    <div class="modal-body"><p class="modal-sub">The game will be removed from your library.</p>
      ${switchHtml("r-del", false, "Also delete the converted game folder", "Frees disk space. Your original PS5 dump is not touched.")}</div>
    <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn danger-solid" id="r-go">Remove</button></div>`);
  bindSwitch("r-del", (v) => (del = v));
  $("#r-go").onclick = async () => {
    await call("remove_game", { id: g.id, deleteFiles: del });
    m.close();
    view = { page: "library" };
    toast(`Removed ${g.name}`);
    refresh();
  };
}

// ------------------------------------------------------------------ wiring
window.addEventListener("error", (e) => toast("Something went wrong: " + e.message, "err"));
window.addEventListener("unhandledrejection", (e) => { if (e.reason && e.reason.message) toast("Something went wrong: " + e.reason.message, "err"); });

function render() {
  renderSidebar();
  if (view.page === "game") renderGame(); else renderLibrary();
}

$$(".nav-item").forEach((b) => (b.onclick = () => {
  const n = b.dataset.nav;
  if (n === "library") { view = { page: "library" }; render(); }
  else if (n === "add") addGameModal();
  else if (n === "setup") setupModal();
}));
$("#setup-status").onclick = () => setupModal();
$$("[data-url]").forEach((b) => (b.onclick = () => call("open_url", { url: b.dataset.url })));
document.querySelectorAll("[data-icon]").forEach((el) => (el.outerHTML = icon(el.dataset.icon, el.className.replace("i", "").trim())));

listen("convert", (e) => onConvert(e.payload));
listen("game", (e) => {
  const { id, kind, text, code } = e.payload;
  if (kind === "log") {
    (logs[id] ||= []).push(text);
    if (view.page === "game" && view.id === id && view.tab === "log") {
      const el = $("#log");
      if (el) {
        if (logs[id].length === 1) el.innerHTML = "";
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        el.insertAdjacentHTML("beforeend", logLine(text));
        if (atBottom) el.scrollTop = el.scrollHeight;
      }
    }
  } else if (kind === "exit") {
    running.delete(id);
    const g = gameById(id);
    if (code === 0) toast(`${g ? g.name : "Game"} closed`);
    else {
      toast(`${g ? g.name : "The game"} stopped with an error (code ${code}). Click to see why.`, "err", () => openGame(id, "log"));
      if (view.page === "game" && view.id === id) view.tab = "log";
    }
    render();
  }
});

refresh();
