import { db, el, toast } from "./firebase.js";
import { openModal } from "./ui.js";
import {
  collection, doc, getDoc, getDocs, onSnapshot, writeBatch, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 🎵 Music. Mods/owners add songs: an audio file (saved in pieces in the free database,
// like DM audio) or a link to one, plus a link to the album picture. Everyone who can chat
// can listen. Music keeps playing while you chat — there's a little player in the sidebar.
export const MAX_SONG = 12 * 1024 * 1024;           // 12 MB per audio file
const CHUNK = 700_000;                               // base64 characters per piece
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
const fmtTime = s => !isFinite(s) ? "0:00" : Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const https = s => /^https:\/\/\S+$/i.test((s || "").trim());

// ---------- the shared player ----------
const audio = new Audio();
audio.preload = "metadata";
let songs = [];                      // everything in the library (kept live while Music is open or something plays)
let queue = [], idx = -1, shuffle = false, repeat = "off"; // repeat: off | all | one
let loading = false, unsubLib = null, libUsers = 0;
const subs = new Set();
const emit = () => subs.forEach(f => { try { f(); } catch {} });
try { audio.volume = Math.min(1, Math.max(0, +(localStorage.getItem("musicVol") ?? 0.8))); } catch {}
["play", "pause", "timeupdate", "loadedmetadata", "volumechange"].forEach(t => audio.addEventListener(t, emit));
audio.addEventListener("ended", () => { if (repeat === "one") { audio.currentTime = 0; audio.play().catch(() => {}); } else next(true); });
audio.addEventListener("error", () => { if (audio.getAttribute("src")) { toast("That song couldn't play. The file or link may be broken."); loading = false; emit(); } });

export const current = () => (idx >= 0 ? queue[idx] : null);

function watchLibrary() {
  libUsers++;
  if (unsubLib) return;
  unsubLib = onSnapshot(collection(db, "songs"), s => {
    songs = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? Date.now()) - (a.createdAt?.toMillis?.() ?? Date.now()));
    // keep the queue's info fresh (renames / new covers), drop deleted songs
    const cur = current();
    queue = queue.map(q => songs.find(s => s.id === q.id) || (q === cur ? q : null)).filter(Boolean);
    idx = cur ? queue.findIndex(q => q.id === cur.id) : -1;
    emit();
  }, err => { songs = []; emit(); toast("Couldn't load music: " + err.code); });
}
function unwatchLibrary() {
  libUsers = Math.max(0, libUsers - 1);
  if (!libUsers && !current() && unsubLib) { unsubLib(); unsubLib = null; }
}

export async function playSong(song, list = [song]) {
  queue = shuffle ? [song, ...list.filter(s => s.id !== song.id).sort(() => Math.random() - 0.5)] : list.slice();
  idx = queue.findIndex(s => s.id === song.id);
  await start();
}
async function start() {
  const s = current(); if (!s) return;
  loading = true; emit();
  try {
    const url = s.type === "url" ? s.url : await songUrl(s);
    if (current() !== s) return;       // skipped while loading
    audio.src = url;
    await audio.play();
  } catch (e) {
    if (current() === s && e?.name !== "AbortError") toast(e?.name === "NotAllowedError" ? "Click play to start the music." : "Couldn't load that song.");
  } finally { if (current() === s) { loading = false; emit(); } }
  mediaSession(s);
}
export function togglePlay() {
  if (!current()) { if (songs.length) playSong(songs[0], songs); return; }
  if (!audio.getAttribute("src")) { start(); return; }
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
}
export function next(auto = false) {
  if (!queue.length) return;
  if (idx >= queue.length - 1) {
    if (repeat !== "all" && auto) { audio.pause(); audio.currentTime = 0; emit(); return; }
    idx = 0;
  } else idx++;
  start();
}
export function prev() {
  if (!queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  idx = idx <= 0 ? queue.length - 1 : idx - 1;
  start();
}
export function stopMusic() {
  audio.pause(); audio.removeAttribute("src"); audio.load();
  queue = []; idx = -1; loading = false; emit();
  if (!libUsers && unsubLib) { unsubLib(); unsubLib = null; }
}
function toggleShuffle() {
  shuffle = !shuffle;
  const cur = current();
  if (cur && queue.length > 1) {
    const rest = queue.filter(s => s.id !== cur.id);
    queue = shuffle ? [cur, ...rest.sort(() => Math.random() - 0.5)] : songs.filter(s => queue.some(q => q.id === s.id));
    idx = queue.findIndex(s => s.id === cur.id);
  }
  emit();
}
function cycleRepeat() { repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off"; emit(); }

function mediaSession(s) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist || "", album: s.album || "",
      artwork: s.cover ? [{ src: s.cover, sizes: "512x512" }] : [] });
    navigator.mediaSession.setActionHandler("play", () => audio.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => next());
    navigator.mediaSession.setActionHandler("previoustrack", () => prev());
  } catch {}
}

// ---------- loading uploaded songs (saved in this browser after the first play) ----------
const urlCache = new Map();
function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open("sussy-music", 1); r.onupgradeneeded = () => r.result.createObjectStore("b64"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function cacheGet(k) { try { const d = await idb(); return await new Promise(r => { const q = d.transaction("b64").objectStore("b64").get(k); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }); } catch { return null; } }
async function cachePut(k, v) { try { const d = await idb(); d.transaction("b64", "readwrite").objectStore("b64").put(v, k); } catch {} }
async function cacheDel(k) { try { const d = await idb(); d.transaction("b64", "readwrite").objectStore("b64").delete(k); } catch {} }

async function songUrl(s) {
  if (urlCache.has(s.id)) return urlCache.get(s.id);
  let b64 = await cacheGet(s.id);
  if (!b64) {
    const parts = await Promise.all(Array.from({ length: s.chunks }, (_, i) =>
      getDoc(doc(db, "songs", s.id, "chunks", String(i))).then(d => { if (!d.exists()) throw new Error("missing"); return d.data().data; })));
    b64 = parts.join(""); cachePut(s.id, b64);
  }
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: s.mime || "audio/mpeg" }));
  urlCache.set(s.id, url);
  return url;
}

// ---------- the controls (used by the big bar on the Music page and the sidebar mini player) ----------
function cover(s, size) {
  const box = el("div", { class: "song-cover", style: size ? { width: size + "px", height: size + "px" } : null }, el("span", {}, "🎵"));
  if (s?.cover) box.append(el("img", { src: s.cover, alt: "", loading: "lazy", referrerPolicy: "no-referrer", onerror: e => e.target.remove() }));
  return box;
}
function playerBar({ mini = false, onOpen } = {}) {
  const bar = el("div", { class: mini ? "mini-player" : "music-bar" });
  let seeking = false;
  function draw() {
    const s = current();
    bar.hidden = !s;
    if (!s) { bar.replaceChildren(); return; }
    const playing = !audio.paused;
    const pp = el("button", { class: "mp-btn mp-main", title: playing ? "Pause" : "Play", onclick: togglePlay }, loading ? "…" : playing ? "⏸" : "▶");
    const info = el("div", { class: "mp-info", onclick: onOpen || null, title: onOpen ? "Open Music" : "" },
      el("div", { class: "mp-title" }, s.title), el("div", { class: "mp-artist" }, s.artist || s.album || ""));
    if (mini) {
      bar.replaceChildren(cover(s, 38), info, pp,
        el("button", { class: "mp-btn", title: "Next", onclick: () => next() }, "⏭"),
        el("button", { class: "mp-btn mp-x", title: "Stop", onclick: stopMusic }, "✕"),
        el("div", { class: "mp-progress" }, el("div", { style: { width: (audio.duration ? audio.currentTime / audio.duration * 100 : 0) + "%" } })));
      return;
    }
    const seek = el("input", { type: "range", class: "mp-seek", min: 0, max: audio.duration || 0, step: 0.1, value: audio.currentTime || 0 });
    seek.oninput = () => { seeking = true; time.textContent = fmtTime(+seek.value); };
    seek.onchange = () => { audio.currentTime = +seek.value; seeking = false; };
    const time = el("span", { class: "mp-time" }, fmtTime(audio.currentTime));
    const vol = el("input", { type: "range", class: "mp-vol", min: 0, max: 1, step: 0.01, value: audio.volume, title: "Volume" });
    vol.oninput = () => { audio.volume = +vol.value; try { localStorage.setItem("musicVol", vol.value); } catch {} };
    bar.replaceChildren(
      el("div", { class: "mp-left" }, cover(s, 52), info),
      el("div", { class: "mp-center" },
        el("div", { class: "mp-buttons" },
          el("button", { class: "mp-btn" + (shuffle ? " on" : ""), title: "Shuffle", onclick: toggleShuffle }, "🔀"),
          el("button", { class: "mp-btn", title: "Previous", onclick: prev }, "⏮"), pp,
          el("button", { class: "mp-btn", title: "Next", onclick: () => next() }, "⏭"),
          el("button", { class: "mp-btn" + (repeat !== "off" ? " on" : ""), title: { off: "Repeat: off", all: "Repeat: all", one: "Repeat: this song" }[repeat], onclick: cycleRepeat }, repeat === "one" ? "🔂" : "🔁")),
        el("div", { class: "mp-seekrow" }, time, seek, el("span", { class: "mp-time" }, fmtTime(audio.duration)))),
      el("div", { class: "mp-right" }, el("span", {}, audio.volume === 0 ? "🔇" : "🔊"), vol));
    bar.__update = () => { if (!seeking) { seek.max = audio.duration || 0; seek.value = audio.currentTime || 0; time.textContent = fmtTime(audio.currentTime); } };
  }
  // timeupdate fires a lot — only move the slider, don't rebuild
  let lastKey = "";
  const update = () => {
    const s = current();
    const key = [s?.id, s?.title, s?.artist, s?.cover, audio.paused, loading, shuffle, repeat, Math.round(audio.volume * 100), isFinite(audio.duration) ? Math.round(audio.duration) : 0].join("|");
    if (key !== lastKey) { lastKey = key; draw(); }
    else if (mini) { const p = bar.querySelector(".mp-progress div"); if (p) p.style.width = (audio.duration ? audio.currentTime / audio.duration * 100 : 0) + "%"; }
    else bar.__update?.();
  };
  subs.add(update); update();
  bar.__off = () => subs.delete(update);
  return bar;
}

// Sidebar mini player: call once with the element to fill.
export function mountMiniPlayer(box, onOpen) {
  box.replaceChildren(playerBar({ mini: true, onOpen }));
}

// ---------- the Music page ----------
// ctx: { me, isMod, findBlocked }
export function openMusic(ctx) {
  if (document.querySelector(".music-page")) return;
  let q = "";
  watchLibrary();
  const list = el("div", { class: "song-grid" });
  const search = el("input", { class: "input movie-search", type: "search", placeholder: "🔎 Search songs, artists, albums", oninput: e => { q = e.target.value.toLowerCase(); draw(); } });
  const tools = el("div", { class: "music-tools" });
  const big = playerBar();
  const overlay = el("div", { class: "game-overlay music-page" },
    el("div", { class: "game-bar" },
      el("div", { class: "game-title" }, "🎵 Music"),
      el("div", { class: "row" },
        ctx.isMod() ? el("button", { class: "btn sm primary", onclick: () => editSong(ctx) }, "+ Add song") : null,
        el("button", { class: "btn sm", onclick: () => close(), title: "Music keeps playing" }, "✕ Close"))),
    el("div", { class: "movies-body" }, el("div", { class: "music-top" }, search, tools), list),
    big);
  document.body.append(overlay);
  const onKey = e => {
    if (document.querySelector(".overlay")) return;
    if (e.key === "Escape") close();
    else if (e.key === " " && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName)) { e.preventDefault(); togglePlay(); }
  };
  document.addEventListener("keydown", onKey);
  subs.add(draw);
  function close() { subs.delete(draw); big.__off(); overlay.remove(); document.removeEventListener("keydown", onKey); unwatchLibrary(); }

  let lastKey = "";
  function draw() {
    const shown = songs.filter(s => !q || [s.title, s.artist, s.album].some(x => (x || "").toLowerCase().includes(q)));
    const cur = current(), key = songs.map(s => s.id + s.title + s.artist + s.cover + s.album).join() + "|" + q + "|" + (cur?.id || "") + (audio.paused ? "p" : "") + loading;
    if (key === lastKey) return; lastKey = key;
    const used = songs.reduce((n, s) => n + (s.type === "upload" ? s.size || 0 : 0), 0);
    tools.replaceChildren(
      el("button", { class: "btn sm primary", disabled: !shown.length, onclick: () => { shuffle = false; playSong(shown[0], shown); } }, "▶ Play all"),
      el("button", { class: "btn sm", disabled: !shown.length, onclick: () => { shuffle = true; playSong(shown[Math.floor(Math.random() * shown.length)], shown); } }, "🔀 Shuffle"),
      el("span", { class: "muted" }, `${songs.length} song${songs.length === 1 ? "" : "s"}`, ctx.isMod() && used ? ` · ${fmtSize(used)} uploaded` : ""));
    if (!shown.length) {
      list.replaceChildren(el("div", { class: "empty" }, el("b", {}, songs.length ? "No matches" : "No songs yet"),
        songs.length ? "" : ctx.isMod() ? "Click + Add song to put one up." : "A mod hasn't added any yet."));
      return;
    }
    list.replaceChildren(...shown.map(s => {
      const isCur = cur?.id === s.id, playing = isCur && !audio.paused;
      const card = el("div", { class: "song-card" + (isCur ? " current" : ""), tabIndex: 0,
        onclick: () => isCur ? togglePlay() : playSong(s, shown),
        onkeydown: e => { if (e.key === "Enter") { e.preventDefault(); isCur ? togglePlay() : playSong(s, shown); } } },
        el("div", { class: "song-art" }, cover(s, 0), el("div", { class: "song-play" }, isCur && loading ? "…" : playing ? "⏸" : "▶"),
          playing ? el("div", { class: "song-eq" }, el("i"), el("i"), el("i")) : null),
        el("div", { class: "movie-title" }, s.title),
        el("div", { class: "movie-desc" }, [s.artist, s.album].filter(Boolean).join(" · ") || " "));
      if (ctx.isMod()) card.append(el("div", { class: "movie-mod" },
        el("span", { class: "chip" }, s.type === "upload" ? "File · " + fmtSize(s.size || 0) : "Link"),
        el("button", { class: "btn sm", onclick: e => { e.stopPropagation(); editSong(ctx, s); } }, "Edit"),
        el("button", { class: "btn sm danger", onclick: e => { e.stopPropagation(); removeSong(s); } }, "Delete")));
      return card;
    }));
  }
  draw();
}

// ---------- add / edit (mods & owners) ----------
function editSong(ctx, s = null) {
  const title = el("input", { class: "input", maxLength: 100, value: s?.title || "", placeholder: "Song title" });
  const artist = el("input", { class: "input", maxLength: 100, value: s?.artist || "", placeholder: "Artist (optional)" });
  const album = el("input", { class: "input", maxLength: 100, value: s?.album || "", placeholder: "Album (optional)" });
  const coverIn = el("input", { class: "input", type: "url", maxLength: 1000, value: s?.cover || "", placeholder: "https://… album picture link" });
  const prev = el("div", { class: "poster-preview square" });
  const drawCover = () => {
    const v = coverIn.value.trim();
    prev.replaceChildren(v ? el("img", { src: v, referrerPolicy: "no-referrer", alt: "", onerror: e => e.target.replaceWith(el("span", { class: "muted" }, "Didn't load")) }) : el("span", { class: "muted" }, "🎵"));
  };
  coverIn.oninput = drawCover; drawCover();

  const fileIn = el("input", { class: "input", type: "file", accept: "audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac" });
  const urlIn = el("input", { class: "input", type: "url", placeholder: "https://…/song.mp3" });
  const prog = el("div", { class: "upload-prog", hidden: true }, el("div", { class: "bar" }), el("span", {}));
  // fill the title from the file name, e.g. "Artist - Song.mp3"
  fileIn.onchange = () => {
    const f = fileIn.files[0]; if (!f) return;
    const base = f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
    const m = base.match(/^(.+?)\s+-\s+(.+)$/);
    if (!title.value.trim()) title.value = (m ? m[2] : base).slice(0, 100);
    if (m && !artist.value.trim()) artist.value = m[1].slice(0, 100);
    if (f.size > MAX_SONG) toast(`That file is ${fmtSize(f.size)}. Max is ${fmtSize(MAX_SONG)}.`);
  };

  let type = "upload";
  const panes = {
    upload: el("div", {}, fileIn, prog, el("p", { class: "muted", style: { fontSize: "12px" } },
      `MP3 works best. Up to ${fmtSize(MAX_SONG)} per song — saved in the free database, nothing to pay.`)),
    url: el("div", {}, urlIn, el("p", { class: "muted", style: { fontSize: "12px" } },
      "A direct link to an audio file (.mp3, .m4a…). Tip: put MP3s in your site's ", el("b", {}, "music"), " folder and use their links — that takes no database space."))
  };
  const paneBox = el("div");
  const tabs = el("div", { class: "seg-tabs" }, Object.entries({ upload: "Upload file", url: "Audio link" }).map(([k, t]) =>
    el("button", { type: "button", class: k === type ? "active" : "", onclick: e => {
      type = k; tabs.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === e.currentTarget)); paneBox.replaceChildren(panes[type]);
    } }, t)));
  paneBox.replaceChildren(panes[type]);

  const body = el("div", { class: "form movie-form" },
    s ? null : [el("label", { class: "lbl", style: { marginTop: 0 } }, "Song"), tabs, paneBox],
    el("label", { class: "lbl", style: s ? { marginTop: 0 } : null }, "Title"), title,
    el("label", { class: "lbl" }, "Artist"), artist,
    el("label", { class: "lbl" }, "Album"), album,
    el("label", { class: "lbl" }, "Album picture link"), el("div", { class: "row", style: { alignItems: "center" } }, coverIn, prev),
    s ? el("p", { class: "muted", style: { fontSize: "12px" } }, "To change the audio itself, delete this song and add it again.") : null);

  openModal(s ? "Edit song" : "🎵 Add song", body, [
    { label: "Cancel" },
    { label: s ? "Save" : "Add song", kind: "primary", onClick: async () => {
      const t = title.value.trim(), c = coverIn.value.trim();
      if (!t) { toast("Give it a title."); return false; }
      if (c && !https(c)) { toast("The picture link must start with https://"); return false; }
      for (const v of [t, artist.value, album.value]) if (ctx.findBlocked?.(v)) { toast("🚫 That has a blocked word."); return false; }
      const meta = { title: t, artist: artist.value.trim(), album: album.value.trim(), cover: c, updatedAt: serverTimestamp() };
      if (s) { await updateDoc(doc(db, "songs", s.id), meta); toast("Song saved"); return; }

      const ref = doc(collection(db, "songs"));
      if (type === "url") {
        const u = urlIn.value.trim();
        if (!https(u)) { toast("The audio link must start with https://"); return false; }
        const b = writeBatch(db);
        b.set(ref, { ...meta, type: "url", mime: "", url: u, chunks: 0, size: 0, addedBy: ctx.me, createdAt: serverTimestamp() });
        await b.commit();
      } else {
        const f = fileIn.files[0];
        if (!f) { toast("Choose an audio file."); return false; }
        if (!(f.type || "").startsWith("audio/") && !/\.(mp3|m4a|wav|ogg|aac|flac|opus)$/i.test(f.name)) { toast("That isn't an audio file."); return false; }
        if (f.size > MAX_SONG) { toast(`That file is ${fmtSize(f.size)}. Max is ${fmtSize(MAX_SONG)}.`); return false; }
        prog.hidden = false;
        const bar = prog.querySelector(".bar"), label = prog.querySelector("span");
        const show = (p, txt) => { bar.style.width = (p * 100).toFixed(1) + "%"; label.textContent = txt; };
        show(0, "Reading file…");
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(new Error("Couldn't read that file.")); r.readAsDataURL(f); });
        const pieces = []; for (let i = 0; i < b64.length; i += CHUNK) pieces.push(b64.slice(i, i + CHUNK));
        try {
          for (let i = 0; i < pieces.length; i += 8) {
            const b = writeBatch(db);
            pieces.slice(i, i + 8).forEach((p, j) => b.set(doc(db, "songs", ref.id, "chunks", String(i + j)), { data: p }));
            await b.commit();
            const p = Math.min(1, (i + 8) / pieces.length);
            show(p, `Uploading… ${Math.round(p * 100)}%`);
          }
          const b = writeBatch(db);
          b.set(ref, { ...meta, type: "upload", mime: (f.type || "audio/mpeg").slice(0, 60), url: "", chunks: pieces.length, size: f.size, addedBy: ctx.me, createdAt: serverTimestamp() });
          await b.commit();
          show(1, "Uploaded ✓");
        } catch (err) {
          deleteChunks(ref.id, pieces.length);
          prog.hidden = true;
          toast(err?.code === "permission-denied" ? "Not allowed — only mods and owners can add songs (and the new database rules must be published)." : "Upload failed: " + (err?.code || err?.message));
          return false;
        }
      }
      toast("Song added 🎵");
    } }
  ]);
}

async function deleteChunks(id, n) {
  for (let i = 0; i < n; i += 400) {
    const b = writeBatch(db);
    for (let j = i; j < Math.min(n, i + 400); j++) b.delete(doc(db, "songs", id, "chunks", String(j)));
    await b.commit().catch(() => {});
  }
}
function removeSong(s) {
  openModal("Delete song?", el("p", {}, "Remove ", el("b", {}, s.title), " for everyone?"), [
    { label: "Cancel" },
    { label: "Delete", kind: "danger", onClick: async () => {
      if (current()?.id === s.id) stopMusic();
      let n = s.chunks || 0;
      if (s.type === "upload") { try { n = Math.max(n, (await getDocs(collection(db, "songs", s.id, "chunks"))).docs.length); } catch {} }
      await deleteChunks(s.id, n);
      await deleteDoc(doc(db, "songs", s.id));
      urlCache.delete(s.id); cacheDel(s.id);
      toast("Song deleted");
    } }
  ]);
}
