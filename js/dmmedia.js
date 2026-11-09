import { db, el, toast } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, query, orderBy, onSnapshot, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Audio & video in DMs, stored in pieces in the free database (no paid storage).
// Limits keep the 1 GB free space safe: video ≤ 8 MB, audio ≤ 5 MB, newest 5 per DM.
export const KEEP_MEDIA = 5;
export const MAX_VIDEO = 8 * 1024 * 1024, MAX_AUDIO = 5 * 1024 * 1024;
const CHUNK = 700_000; // characters of base64 per piece

const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
const kindOf = type => (type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "audio" : null);

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

// ---------- send ----------
export async function sendDmMedia({ dmId, me, file, caption = "", replyTo = null, onProgress = () => {} }) {
  const kind = kindOf(file.type || "");
  if (!kind) throw new Error("Only audio or video files.");
  const max = kind === "video" ? MAX_VIDEO : MAX_AUDIO;
  if (file.size > max) throw new Error(`That ${kind} is ${fmtSize(file.size)}. Max is ${fmtSize(max)} (free storage).`);
  const b64 = await toBase64(file);
  const pieces = []; for (let i = 0; i < b64.length; i += CHUNK) pieces.push(b64.slice(i, i + CHUNK));
  const ref = doc(collection(db, "dms", dmId, "media"));
  // pieces first (≤ 8 per save, Firestore takes ~10 MB per save)
  for (let i = 0; i < pieces.length; i += 8) {
    const b = writeBatch(db);
    pieces.slice(i, i + 8).forEach((p, j) => b.set(doc(db, "dms", dmId, "media", ref.id, "chunks", String(i + j)), { data: p }));
    await b.commit();
    onProgress(Math.min(1, (i + 8) / pieces.length));
  }
  const b = writeBatch(db);
  b.set(ref, { uid: me, kind, type: file.type.slice(0, 60), name: (file.name || kind).slice(0, 120), size: file.size, chunks: pieces.length, createdAt: serverTimestamp() });
  b.set(doc(db, "dms", dmId), { members: dmId.split("_"), lastMessageAt: serverTimestamp(), lastText: kind === "video" ? "🎬 Video" : "🎵 Audio", lastFrom: me });
  b.set(doc(collection(db, "dms", dmId, "messages")), { uid: me, text: caption.slice(0, 1000), createdAt: serverTimestamp(), mediaId: ref.id,
    ...(replyTo ? { replyTo } : {}) });
  await b.commit();
  trimMedia(dmId);
}

// keep only the newest KEEP_MEDIA files in a DM
export async function trimMedia(dmId) {
  try {
    const s = await getDocs(query(collection(db, "dms", dmId, "media"), orderBy("createdAt", "desc")));
    for (const d of s.docs.slice(KEEP_MEDIA)) {
      const n = d.data().chunks || 0, b = writeBatch(db);
      for (let i = 0; i < n; i++) b.delete(doc(db, "dms", dmId, "media", d.id, "chunks", String(i)));
      b.delete(d.ref);
      await b.commit().catch(() => {});
    }
  } catch {}
}

export function watchDmMedia(dmId, cb) {
  return onSnapshot(collection(db, "dms", dmId, "media"), s => {
    const m = new Map(); s.forEach(d => m.set(d.id, { id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); cb(m);
  }, () => cb(new Map()));
}

// ---------- load (cached in this browser after the first time) ----------
const urlCache = new Map();
function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open("sussy-media", 1); r.onupgradeneeded = () => r.result.createObjectStore("b64"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function cacheGet(k) { try { const d = await idb(); return await new Promise(r => { const q = d.transaction("b64").objectStore("b64").get(k); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }); } catch { return null; } }
async function cachePut(k, v) { try { const d = await idb(); d.transaction("b64", "readwrite").objectStore("b64").put(v, k); } catch {} }

export async function loadMediaUrl(dmId, meta, onProgress = () => {}) {
  if (urlCache.has(meta.id)) return urlCache.get(meta.id);
  let b64 = await cacheGet(meta.id);
  if (!b64) {
    let done = 0;
    const parts = await Promise.all(Array.from({ length: meta.chunks }, (_, i) =>
      getDoc(doc(db, "dms", dmId, "media", meta.id, "chunks", String(i))).then(s => { onProgress(++done / meta.chunks); if (!s.exists()) throw new Error("missing"); return s.data().data; })));
    b64 = parts.join(""); cachePut(meta.id, b64);
  }
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: meta.type }));
  urlCache.set(meta.id, url);
  return url;
}

// ---------- in a message ----------
export function mediaEl(dmId, mediaId, media, loaded) {
  const meta = media.get(mediaId);
  if (!meta) return el("div", { class: "gif-removed" }, loaded ? `${"🎞️"} Media expired (only the newest ${KEEP_MEDIA} in a DM are kept)` : "Loading…");
  const box = el("div", { class: "media-card " + meta.kind });
  const label = el("div", { class: "media-meta" }, el("b", {}, meta.kind === "video" ? "🎬 " : "🎵 ", meta.name), el("span", { class: "muted" }, " · " + fmtSize(meta.size)));
  const play = el("button", { class: "media-play", type: "button", title: "Play" }, "▶");
  const status = el("span", { class: "muted media-status" });
  play.onclick = async () => {
    play.disabled = true; status.textContent = "Loading…";
    try {
      const url = await loadMediaUrl(dmId, meta, p => (status.textContent = `Loading… ${Math.round(p * 100)}%`));
      const player = el(meta.kind, { class: "media-player", src: url, controls: true, autoplay: true, playsInline: true });
      box.replaceChildren(label, player);
    } catch { status.textContent = "Couldn't load it."; play.disabled = false; }
  };
  box.append(label, el("div", { class: "media-row" }, play, status));
  return box;
}

// ---------- the Media gallery (like Discord's) ----------
// items: [{ kind: "image"|"video"|"audio", at, src? (image), meta? (media) }]
export function openGallery(dmId, items, title) {
  const sorted = [...items].sort((a, b) => b.at - a.at);
  const tabs = ["all", "image", "video", "audio"]; let tab = "all";
  const grid = el("div", { class: "gal-grid" });
  const nav = el("div", { class: "settings-tabs" });
  const overlay = el("div", { class: "game-overlay gal" },
    el("div", { class: "game-bar" }, el("div", { class: "game-title" }, "🖼️ Media · " + title),
      el("button", { class: "btn sm", onclick: () => close() }, "✕ Close")),
    el("div", { class: "gal-body" }, nav, grid));
  document.body.append(overlay);
  const onKey = e => { if (e.key === "Escape" && !document.querySelector(".gal-viewer")) close(); };
  document.addEventListener("keydown", onKey);
  function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
  const list = () => sorted.filter(i => tab === "all" || i.kind === tab);
  function draw() {
    nav.replaceChildren(...tabs.map(t => el("button", { type: "button", class: t === tab ? "active" : "", onclick: () => { tab = t; draw(); } },
      { all: "All", image: "📷 Photos", video: "🎬 Videos", audio: "🎵 Audio" }[t] + ` (${sorted.filter(i => t === "all" || i.kind === t).length})`)));
    const l = list();
    grid.replaceChildren(...(l.length ? l.map((it, i) => el("button", { type: "button", class: "gal-cell " + it.kind, onclick: () => viewer(l, i) },
      it.kind === "image" ? el("img", { src: it.src, alt: "" })
        : el("div", { class: "gal-icon" }, it.kind === "video" ? "🎬" : "🎵", el("span", {}, it.meta.name), el("small", {}, fmtSize(it.meta.size)))))
      : [el("div", { class: "empty" }, "Nothing here yet.")]));
  }
  draw();

  // full-screen viewer with ← → to scroll through everything
  function viewer(l, i) {
    const stage = el("div", { class: "gal-stage" });
    const counter = el("span", { class: "muted" });
    const v = el("div", { class: "gal-viewer" },
      el("div", { class: "gal-vbar" }, counter, el("button", { class: "btn sm", onclick: () => shut() }, "✕")),
      el("button", { class: "gal-arrow left", type: "button", title: "Previous", onclick: () => go(-1) }, "‹"),
      stage,
      el("button", { class: "gal-arrow right", type: "button", title: "Next", onclick: () => go(1) }, "›"));
    document.body.append(v);
    const key = e => { if (e.key === "ArrowLeft") go(-1); else if (e.key === "ArrowRight") go(1); else if (e.key === "Escape") shut(); };
    document.addEventListener("keydown", key);
    let tx = null;
    v.addEventListener("touchstart", e => (tx = e.touches[0].clientX), { passive: true });
    v.addEventListener("touchend", e => { if (tx !== null) { const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); tx = null; } });
    function shut() { stage.querySelectorAll("video,audio").forEach(x => x.pause()); v.remove(); document.removeEventListener("keydown", key); }
    function go(d) { i = (i + d + l.length) % l.length; show(); }
    async function show() {
      const it = l[i]; counter.textContent = `${i + 1} / ${l.length}`;
      stage.querySelectorAll("video,audio").forEach(x => x.pause());
      if (it.kind === "image") { stage.replaceChildren(el("img", { src: it.src, alt: "" })); return; }
      stage.replaceChildren(el("div", { class: "muted" }, "Loading…"));
      try {
        const url = await loadMediaUrl(dmId, it.meta);
        if (l[i] !== it) return;
        stage.replaceChildren(el(it.kind, { src: url, controls: true, autoplay: true, playsInline: true }), el("div", { class: "gal-name" }, it.meta.name));
      } catch { stage.replaceChildren(el("div", { class: "muted" }, "Couldn't load it.")); }
    }
    show();
  }
}

export function pickMediaFile() {
  return new Promise(res => {
    const i = el("input", { type: "file", accept: "audio/*,video/*", style: { display: "none" } });
    i.onchange = () => { res(i.files[0] || null); i.remove(); };
    document.body.append(i); i.click();
  });
}
export { kindOf, fmtSize };
