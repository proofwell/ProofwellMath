import { db, el, toast } from "./firebase.js";
import { openModal } from "./ui.js";
import {
  collection, doc, getDoc, getDocs, writeBatch, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Games mods add from the site. Uploaded HTML files are split into ~700 KB pieces
// and stored in Firestore (free plan, 1 GB total shared with DM photos).
// Each browser caches a game after its first load, so replays don't re-download it.
export const MAX_GAME_MB = 40;
const CHUNK = 700_000; // characters per piece (Firestore docs max out at 1 MB)

// ---------- live list ----------
export function watchSiteGames(cb) {
  return onSnapshot(collection(db, "games"), s => {
    cb(s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || "")));
  }, () => cb([]));
}

// ---------- browser cache (IndexedDB) ----------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("sussy-games", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("html");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function cacheGet(key) {
  try { const d = await idb(); return await new Promise(res => { const q = d.transaction("html").objectStore("html").get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
  catch { return null; }
}
async function cachePut(key, val) {
  try { const d = await idb(); d.transaction("html", "readwrite").objectStore("html").put(val, key); } catch {}
}

// ---------- load a game for playing → a URL for the iframe ----------
export async function loadSiteGame(g, onProgress = () => {}) {
  if (g.type === "url") return g.url;
  const key = g.id + ":" + g.ver;
  let html = await cacheGet(key);
  if (!html) {
    let done = 0;
    const parts = await Promise.all(Array.from({ length: g.chunks }, (_, i) =>
      getDoc(doc(db, "games", g.id, "chunks", `v${g.ver}_${i}`)).then(s => {
        onProgress(++done / g.chunks);
        if (!s.exists()) throw new Error("Part of this game is missing. Ask a mod to re-upload it.");
        return s.data().data;
      })));
    html = parts.join("");
    cachePut(key, html);
  }
  return URL.createObjectURL(new Blob([html], { type: "text/html" }));
}

// ---------- add / edit (mods) ----------
export function editSiteGame(me, g = null) {
  const name = el("input", { class: "input", maxlength: 60, value: g?.name || "", placeholder: "Game name" });
  const icon = el("input", { class: "input", maxlength: 8, value: g?.icon || "🎮", style: { width: "70px", textAlign: "center", fontSize: "20px" } });
  const desc = el("input", { class: "input", maxlength: 200, value: g?.description || "", placeholder: "One line about it (optional)" });
  let type = g?.type || "html";
  const fileIn = el("input", { class: "input", type: "file", accept: ".html,.htm,text/html" });
  const fileInfo = el("div", { class: "muted", style: { fontSize: "12px", marginTop: "6px" } });
  fileIn.onchange = () => {
    const f = fileIn.files[0];
    fileInfo.textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` + (f.size > MAX_GAME_MB * 1048576 ? ` — too big (max ${MAX_GAME_MB} MB)` : "") : "";
    if (f && !name.value.trim()) name.value = f.name.replace(/\.html?$/i, "").replace(/[-_]+/g, " ").slice(0, 60);
  };
  const urlIn = el("input", { class: "input", type: "url", placeholder: "https://…/game.html", value: g?.type === "url" ? g.url : "" });
  const prog = el("div", { class: "upload-prog", hidden: true }, el("div", { class: "bar" }), el("span", {}));
  const panes = {
    html: el("div", {}, g?.type === "html" ? el("p", { class: "muted" }, `Current file: ${(g.size / 1048576).toFixed(1)} MB. Choose a new one only to replace it.`) : null,
      fileIn, fileInfo, prog,
      el("p", { class: "muted", style: { fontSize: "12px" } },
        `A single .html game file (everything built into one file, like Slope). Max ${MAX_GAME_MB} MB. Games run walled off from the site, so they can't save progress.`)),
    url: el("div", {}, urlIn, el("p", { class: "muted", style: { fontSize: "12px" } },
      "A link to a game page hosted somewhere else. Some sites refuse to load inside other sites — if it shows a blank or error screen, use Upload instead."))
  };
  const tabs = el("div", { class: "seg-tabs" }, Object.entries({ html: "Upload HTML file", url: "Link to a game" }).map(([k, t]) =>
    el("button", { type: "button", class: k === type ? "active" : "", onclick: e => {
      type = k; tabs.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === e.currentTarget)); paneBox.replaceChildren(panes[type]);
    } }, t)));
  const paneBox = el("div", {}, panes[type]);

  openModal(g ? "Edit game" : "Add game", el("div", { class: "form movie-form" },
    el("label", { class: "lbl", style: { marginTop: 0 } }, "Name & icon"),
    el("div", { class: "row" }, icon, name),
    el("label", { class: "lbl" }, "Description"), desc,
    el("label", { class: "lbl" }, "Game"), tabs, paneBox), [
    { label: "Cancel" },
    { label: g ? "Save" : "Add game", kind: "primary", onClick: async () => {
      const n = name.value.trim();
      if (!n) { toast("Give the game a name."); return false; }
      const base = { name: n, icon: icon.value.trim().slice(0, 8) || "🎮", description: desc.value.trim(), updatedAt: serverTimestamp() };
      const ref = g ? doc(db, "games", g.id) : doc(collection(db, "games"));
      let data, oldChunks = null;
      if (type === "url") {
        const u = urlIn.value.trim();
        if (!/^https:\/\/\S+$/.test(u)) { toast("The link must start with https://"); return false; }
        data = { ...base, type: "url", url: u, ver: 0, chunks: 0, size: 0 };
        if (g?.type === "html") oldChunks = g;
      } else {
        const f = fileIn.files[0];
        if (!f && g?.type === "html") data = { ...base, type: "html", url: "", ver: g.ver, chunks: g.chunks, size: g.size };
        else if (!f) { toast("Choose the game's .html file."); return false; }
        else {
          if (f.size > MAX_GAME_MB * 1048576) { toast(`That file is over ${MAX_GAME_MB} MB.`); return false; }
          const ver = (g?.ver || 0) + 1;
          let pieces;
          try { pieces = splitChunks(await f.text()); await uploadChunks(ref.id, ver, pieces, prog); }
          catch (err) { toast("Upload failed: " + (err.code || err.message)); prog.hidden = true; return false; }
          data = { ...base, type: "html", url: "", ver, chunks: pieces.length, size: f.size };
          if (g?.type === "html") oldChunks = g;
        }
      }
      const b = writeBatch(db);
      b.set(ref, g ? { ...data, addedBy: g.addedBy, createdAt: g.createdAt } : { ...data, addedBy: me, createdAt: serverTimestamp() });
      await b.commit();
      if (oldChunks) deleteChunks(ref.id, oldChunks.ver, oldChunks.chunks);
      toast(g ? "Game saved" : `${n} added for everyone 🎮`);
    } }
  ]);
}

// Split into pieces that each stay under ~900 KB once saved (non-English text takes more bytes)
function splitChunks(text) {
  const enc = new TextEncoder(), out = [];
  let i = 0;
  while (i < text.length || !out.length) {
    let len = CHUNK;
    while (len > 1000 && enc.encode(text.slice(i, i + len)).length > 900_000) len = Math.floor(len / 2);
    out.push(text.slice(i, i + len)); i += len;
    if (i >= text.length) break;
  }
  return out;
}

async function uploadChunks(id, ver, pieces, prog) {
  const n = pieces.length;
  prog.hidden = false;
  const bar = prog.querySelector(".bar"), label = prog.querySelector("span");
  // Firestore takes up to ~10 MB per batch → 8 pieces at a time
  for (let i = 0; i < n; i += 8) {
    const b = writeBatch(db);
    for (let j = i; j < Math.min(n, i + 8); j++) b.set(doc(db, "games", id, "chunks", `v${ver}_${j}`), { data: pieces[j] });
    await b.commit();
    const pct = Math.min(n, i + 8) / n * 100;
    bar.style.width = pct + "%"; label.textContent = `Uploading… ${pct.toFixed(0)}%`;
  }
  label.textContent = "Uploaded ✓";
}

async function deleteChunks(id, ver, count) {
  for (let i = 0; i < count; i += 400) {
    const b = writeBatch(db);
    for (let j = i; j < Math.min(count, i + 400); j++) b.delete(doc(db, "games", id, "chunks", `v${ver}_${j}`));
    try { await b.commit(); } catch {}
  }
}

export function deleteSiteGame(g) {
  openModal("Delete game?", el("p", {}, "Remove ", el("b", {}, g.name), " for everyone?"), [
    { label: "Cancel" },
    { label: "Delete", kind: "danger", onClick: async () => {
      await deleteDoc(doc(db, "games", g.id));
      if (g.type === "html") deleteChunks(g.id, g.ver, g.chunks);
      toast(g.name + " deleted");
    } }
  ]);
}
