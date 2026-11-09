import { db, el, toast } from "./firebase.js";
import { setPlaying } from "./presence.js";
import { doc, setDoc, increment, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal } from "./ui.js";
import { challenge, isOpen } from "./chessgame.js";
import { watchSiteGames, loadSiteGame, editSiteGame, deleteSiteGame } from "./gamestore.js";
import { startVsComputer } from "./chessai.js";
import { GAMES, startVsBot, challenge as challengeMatch } from "./boardgames/kit.js";

// ---------- your own HTML games (listed in games/games.json) ----------
let cache = null;
export async function loadGames() {
  if (cache) return cache;
  try {
    const r = await fetch("games/games.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    cache = (Array.isArray(j) ? j : j.games || [])
      .filter(g => g && typeof g.name === "string" && typeof g.file === "string"
        && !g.file.includes("..") && !/^[a-z]+:/i.test(g.file));
  } catch { cache = []; }
  return cache;
}

// game.file = a file in the games folder; game.load = async () => URL (games mods added)
export function playHtmlGame(game, { fullscreen = false, onEnd: trackPlayEnd = null } = {}) {
  const frame = el("iframe", {
    class: "game-frame", title: game.name,
    allow: "fullscreen; autoplay; gamepad; pointer-lock; clipboard-write"
  });
  frame.setAttribute("allowfullscreen", "");
  // Sandbox: the game runs walled off from your site, so it can't read anyone's
  // login or post as them. Set "trusted": true in games.json only for games you
  // fully trust that need to save progress.
  if (game.trusted !== true || game.load) {
    frame.setAttribute("sandbox", "allow-scripts allow-pointer-lock allow-popups allow-forms allow-modals");
  }
  const loading = el("div", { class: "game-loading" }, el("div", { class: "spinner" }), el("span", {}, "Loading…"));
  let blobUrl = null, closed = false;
  if (game.load) {
    game.load(p => { loading.querySelector("span").textContent = `Loading… ${Math.round(p * 100)}%`; })
      .then(u => { if (closed) { if (u.startsWith("blob:")) URL.revokeObjectURL(u); return; }
        if (u.startsWith("blob:")) blobUrl = u; frame.src = u; })
      .catch(err => { loading.querySelector("span").textContent = "Couldn't load: " + (err.message || err.code); loading.querySelector(".spinner").remove(); });
  } else {
    // the game's old save rides in on the frame's name (js/gameshim.js reads it)
    try { const sv = JSON.parse(localStorage.getItem("gamesave:" + game.file) || "{}"); frame.name = JSON.stringify({ __gs: 1, ls: sv.ls || {}, cookie: sv.cookie || "" }); } catch {}
    frame.src = "games/" + game.file;
  }
  const saveKey = "gamesave:" + (game.file || game.id || game.name);
  const onMsg = e => {
    if (e.source !== frame.contentWindow || !e.data || e.data.__gs !== 1) return;
    try { localStorage.setItem(saveKey, JSON.stringify({ ls: e.data.ls, cookie: e.data.cookie })); } catch {}
  };
  window.addEventListener("message", onMsg);
  frame.addEventListener("load", () => { if (frame.src && frame.src !== "about:blank") loading.remove(); });
  const overlay = el("div", { class: "game-overlay" },
    el("div", { class: "game-bar" },
      el("div", { class: "game-title" }, (game.icon || "🎮") + " " + game.name),
      el("div", { class: "row" },
        el("button", { class: "btn sm", onclick: () => goFullscreen(frame) }, "⛶ Fullscreen"),
        el("button", { class: "btn sm", onclick: () => close() }, "✕ Close"))),
    el("div", { class: "game-stage" }, frame, loading));
  document.body.append(overlay);
  const onKey = e => { if (e.key === "Escape" && !document.fullscreenElement) close(); };
  document.addEventListener("keydown", onKey);
  function close() {
    closed = true; frame.src = "about:blank"; overlay.remove(); document.removeEventListener("keydown", onKey); window.removeEventListener("message", onMsg);
    trackPlayEnd?.();
    if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }
  frame.focus();
  if (fullscreen) goFullscreen(frame);
}

// Fullscreen that works in every browser (must be called from a click)
export function goFullscreen(node) {
  const fn = node.requestFullscreen || node.webkitRequestFullscreen || node.msRequestFullscreen;
  if (!fn) { toast("Fullscreen isn't supported here"); return; }
  try {
    const p = fn.call(node);
    if (p && p.catch) p.catch(() => toast("Fullscreen was blocked — press F11 instead"));
  } catch { toast("Fullscreen was blocked — press F11 instead"); }
}

// ---------- play counts (shared) + favorites / recent (this device) ----------
const playId = g => (g.file || "site_" + g.id || g.name).replace(/\.html$/, "").replace(/[^\w-]/g, "_").slice(0, 80);
function countPlay(g) {
  setDoc(doc(db, "gamePlays", playId(g)), { count: increment(1) }, { merge: true }).catch(() => {});
  try {
    const r = JSON.parse(localStorage.getItem("recentGames") || "[]").filter(x => x !== playId(g));
    localStorage.setItem("recentGames", JSON.stringify([playId(g), ...r].slice(0, 8)));
  } catch {}
}
const getFavs = () => { try { return JSON.parse(localStorage.getItem("favGames") || "[]"); } catch { return []; } };
const setFavs = f => { try { localStorage.setItem("favGames", JSON.stringify(f)); } catch {} };
const fmtCount = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);
const CATS = [["all", "All games"], ["popular", "🔥 Popular"], ["favs", "⭐ Favorites"], ["Action", "⚡ Action"], ["Racing", "🏁 Racing"],
  ["Sports", "🏀 Sports"], ["Puzzle", "🧩 Puzzle"], ["Arcade", "🕹️ Arcade"], ["Strategy", "♟️ Strategy"], ["site", "🛠️ Added by mods"]];
const CAT_COLORS = { Action: ["#f97316", "#ef4444"], Racing: ["#eab308", "#f97316"], Sports: ["#22c55e", "#0ea5e9"], Puzzle: ["#8b5cf6", "#ec4899"],
  Arcade: ["#06b6d4", "#6366f1"], Strategy: ["#14b8a6", "#22c55e"], Other: ["#64748b", "#334155"] };

// ---------- the 🎮 Games hub ----------
// ctx: { me, view, lookup, nameEl, chessGames (Map), openChess(id), openMatch(id), pickPlayer, isMod() }
export async function openGamesMenu(ctx) {
  const mod = !!ctx.isMod?.();
  let fileGames = [], siteGames = [], plays = new Map(), cat = "all", q = "";
  const search = el("input", { class: "input hub-search", placeholder: "🔎 Search games", oninput: e => { q = e.target.value.trim().toLowerCase(); draw(); } });
  const chips = el("div", { class: "hub-chips" });
  const content = el("div", { class: "hub-content" });
  const overlay = el("div", { class: "game-overlay games-hub" },
    el("div", { class: "game-bar" },
      el("div", { class: "game-title" }, "🎮 Games"), search,
      el("div", { class: "row" }, mod ? el("button", { class: "btn sm primary", onclick: () => editSiteGame(ctx.me) }, "+ Add game") : null,
        el("button", { class: "btn sm", onclick: () => close() }, "✕ Close"))),
    el("div", { class: "hub-body" }, versusStrip(), chips, content));
  document.body.append(overlay);
  const onKey = e => { if (e.key === "Escape" && !document.querySelector(".game-overlay:not(.games-hub)") && !document.querySelector(".overlay")) close(); };
  document.addEventListener("keydown", onKey);
  const unsubs = [];
  function close() { unsubs.forEach(u => u()); overlay.remove(); document.removeEventListener("keydown", onKey); }
  setTimeout(() => search.focus(), 50);

  // --- play with people / bots ---
  function versusStrip() {
    const card = (icon, name, sub, ...btns) => el("div", { class: "vs-card" }, el("div", { class: "vs-icon" }, icon),
      el("div", { class: "grow" }, el("div", { class: "name" }, name), el("div", { class: "muted" }, sub)), el("div", { class: "vs-btns" }, btns));
    const vsPlayer = (type, name) => async () => {
      const go = async other => {
        try { const id = await challengeMatch(type, ctx.me, other); close(); ctx.openMatch(id); toast(`Challenge sent to ${ctx.lookup(other).name}`); }
        catch (err) { toast("Couldn't start game: " + (err.code || err.message)); }
      };
      if (ctx.view.type === "dm") go(ctx.view.other); else ctx.pickPlayer(`Challenge someone to ${name}`, go);
    };
    const chessBtn = () => {
      if (ctx.view.type !== "dm") return el("button", { class: "btn sm", title: "Open a DM first", onclick: () => toast("Open a DM with someone, then challenge them to chess.") }, "vs Player");
      const existing = [...ctx.chessGames.values()].filter(g => g.dmId === ctx.view.id && isOpen(g))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))[0];
      if (existing) return el("button", { class: "btn sm primary", onclick: () => { close(); ctx.openChess(existing.id); } }, existing.status === "pending" ? "Open challenge" : "Resume");
      return el("button", { class: "btn sm primary", onclick: async e => {
        e.currentTarget.disabled = true;
        try { const id = await challenge(ctx.me, ctx.view.other, "random"); close(); ctx.openChess(id); }
        catch (err) { toast("Couldn't start game: " + (err.code || err.message)); e.currentTarget.disabled = false; }
      } }, "vs " + ctx.lookup(ctx.view.other).name);
    };
    return el("section", { class: "hub-sec" },
      el("div", { class: "hub-h" }, el("h3", {}, "🤝 Play with people"), el("span", { class: "muted" }, "Beat a player for +5 XP")),
      el("div", { class: "vs-grid" },
        card("♟️", "Chess", ctx.view.type === "dm" ? "Easy, Medium, Hard bot — or your DM" : "Bot anytime · players from a DM",
          el("button", { class: "btn sm", onclick: () => { close(); startVsComputer(); } }, "vs Bot"), chessBtn()),
        ...Object.values(GAMES).map(G => card(G.meta.icon, G.meta.name, G.meta.desc,
          el("button", { class: "btn sm", onclick: () => { close(); startVsBot(G.meta.id, ctx.me); } }, "vs Bot"),
          el("button", { class: "btn sm primary", onclick: vsPlayer(G.meta.id, G.meta.name) }, "vs Player")))));
  }

  // --- the arcade ---
  const all = () => [...fileGames.map(g => ({ ...g, _site: false })), ...siteGames.map(g => ({ ...g, category: g.category || "Other", _site: true }))];
  const score = g => (plays.get(playId(g)) || 0) * 10 + Math.max(0, 40 - (g.rank || 40)); // real plays win; rank breaks ties early on
  function play(g, fs) {
    countPlay(g); plays.set(playId(g), (plays.get(playId(g)) || 0) + 1);
    setPlaying(g.name); // shows "🎮 Playing …" on your profile until you close it
    playHtmlGame(g._site ? { ...g, load: p => loadSiteGame(g, p) } : g, { fullscreen: fs, onEnd: () => setPlaying(null) });
  }
  function tile(g, rankNo = null) {
    const [c1, c2] = CAT_COLORS[g.category] || CAT_COLORS.Other;
    const fav = getFavs().includes(playId(g)), n = plays.get(playId(g)) || 0;
    return el("div", { class: "g-tile" + (rankNo ? " ranked" : ""), tabindex: 0, title: g.description || g.name,
      onclick: () => play(g, false), onkeydown: e => { if (e.key === "Enter") play(g, false); } },
      el("div", { class: "g-art", style: { background: `linear-gradient(135deg, ${c1}, ${c2})` } },
        el("span", { class: "g-emoji" }, g.icon || "🎮"),
        rankNo ? el("span", { class: "g-rank" }, "#" + rankNo) : null,
        el("button", { class: "g-fav" + (fav ? " on" : ""), type: "button", title: fav ? "Unfavorite" : "Favorite",
          onclick: e => { e.stopPropagation(); const f = getFavs(); setFavs(fav ? f.filter(x => x !== playId(g)) : [playId(g), ...f]); draw(); } }, fav ? "★" : "☆"),
        el("button", { class: "g-fs", type: "button", title: "Play fullscreen", onclick: e => { e.stopPropagation(); play(g, true); } }, "⛶"),
        el("span", { class: "g-play" }, "▶ Play")),
      el("div", { class: "g-info" },
        el("div", { class: "g-name" }, g.name),
        el("div", { class: "g-sub" }, g.category || "Game", n ? ` · ${fmtCount(n)} plays` : "", !g.size ? "" : g._site ? ` · ${(g.size / 1048576).toFixed(1)} MB` : ` · ${g.size} MB`),
        mod && g._site ? el("div", { class: "row", style: { marginTop: "6px" }, onclick: e => e.stopPropagation() },
          el("button", { class: "btn sm", onclick: () => editSiteGame(ctx.me, g) }, "Edit"),
          el("button", { class: "btn sm danger", onclick: () => deleteSiteGame(g) }, "Delete")) : null));
  }
  function row(title, list, ranked = false, sub = "") {
    if (!list.length) return null;
    return el("section", { class: "hub-sec" }, el("div", { class: "hub-h" }, el("h3", {}, title), sub ? el("span", { class: "muted" }, sub) : null),
      el("div", { class: "g-row" }, list.map((g, i) => tile(g, ranked ? i + 1 : null))));
  }
  function draw() {
    const games = all();
    const counts = { all: games.length, popular: Math.min(10, games.length), favs: games.filter(g => getFavs().includes(playId(g))).length, site: siteGames.length };
    chips.replaceChildren(...CATS.filter(([k]) => k !== "site" || siteGames.length || mod).map(([k, l]) =>
      el("button", { type: "button", class: "pill" + (k === cat ? " sel" : ""), onclick: () => { cat = k; draw(); } },
        l, el("span", { class: "muted" }, " " + (counts[k] ?? games.filter(g => g.category === k).length)))));
    const byPop = [...games].sort((a, b) => score(b) - score(a));
    if (q) {
      const hits = byPop.filter(g => [g.name, g.description, g.category].some(x => (x || "").toLowerCase().includes(q)));
      content.replaceChildren(hits.length ? row(`Results for “${q}”`, hits) : el("div", { class: "empty" }, el("b", {}, "No games match"), "Try another name."));
      return;
    }
    if (cat === "all") {
      let recent = []; try { recent = JSON.parse(localStorage.getItem("recentGames") || "[]"); } catch {}
      const rec = recent.map(id => games.find(g => playId(g) === id)).filter(Boolean);
      content.replaceChildren(...[
        row("🔥 Most popular", byPop.slice(0, 10), true, plays.size ? "Ranked by plays on this site" : "Most-played picks"),
        row("🕘 Jump back in", rec),
        row("⭐ Your favorites", games.filter(g => getFavs().includes(playId(g)))),
        ...["Action", "Racing", "Sports", "Puzzle", "Arcade", "Strategy", "Other"].map(c => row(CATS.find(x => x[0] === c)?.[1] || "🛠️ Added by mods", byPop.filter(g => g.category === c)))
      ].filter(Boolean));
      return;
    }
    const list = cat === "popular" ? byPop.slice(0, 10) : cat === "favs" ? byPop.filter(g => getFavs().includes(playId(g)))
      : cat === "site" ? byPop.filter(g => g._site) : byPop.filter(g => g.category === cat);
    content.replaceChildren(list.length
      ? el("div", { class: "g-grid" }, list.map((g, i) => tile(g, cat === "popular" ? i + 1 : null)))
      : el("div", { class: "empty" }, el("b", {}, cat === "favs" ? "No favorites yet" : "Nothing here yet"), cat === "favs" ? "Click ☆ on a game to save it here." : mod && cat === "site" ? "Click + Add game." : ""));
  }
  content.append(el("div", { class: "muted", style: { padding: "20px" } }, "Loading games…"));
  unsubs.push(watchSiteGames(g => { siteGames = g; draw(); }));
  unsubs.push(onSnapshot(collection(db, "gamePlays"), s => { plays = new Map(); s.forEach(d => plays.set(d.id, d.data().count || 0)); draw(); }, () => {}));
  fileGames = await loadGames(); draw();
}
