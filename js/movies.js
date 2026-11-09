import { app, db, el, toast } from "./firebase.js";
import { openModal } from "./ui.js";
import { goFullscreen } from "./games.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const STORAGE_SDK = "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
const TYPE_LABEL = { drive: "Google Drive", url: "Video link", upload: "Uploaded" };

// ---------- links ----------
// Google Drive: share the file as "Anyone with the link", then paste the share link.
export function driveId(s) {
  s = (s || "").trim();
  let m = s.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})/) ||
          s.match(/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}
const drivePreview = id => `https://drive.google.com/file/d/${id}/preview`;
const isVideoUrl = s => /^https:\/\/\S+$/i.test((s || "").trim());

// ---------- the Movies page ----------
// ctx: { me, isMod }
export function openMovies(ctx) {
  let movies = [], q = "";
  const grid = el("div", { class: "movie-grid" });
  const search = el("input", { class: "input movie-search", placeholder: "Search movies", oninput: e => { q = e.target.value.toLowerCase(); draw(); } });
  const overlay = el("div", { class: "game-overlay movies-page" },
    el("div", { class: "game-bar" },
      el("div", { class: "game-title" }, "🎬 Movies"),
      el("div", { class: "row" },
        ctx.isMod() ? el("button", { class: "btn sm primary", onclick: () => editMovie(ctx) }, "+ Add movie") : null,
        el("button", { class: "btn sm", onclick: () => close() }, "✕ Close"))),
    el("div", { class: "movies-body" }, search, grid));
  document.body.append(overlay);

  const unsub = onSnapshot(collection(db, "movies"), s => {
    movies = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? Date.now()) - (a.createdAt?.toMillis?.() ?? Date.now()));
    draw();
  }, err => { grid.replaceChildren(el("div", { class: "empty" }, "Couldn't load movies: " + err.code)); });

  const onKey = e => { if (e.key === "Escape" && !document.querySelector(".movie-player, .overlay")) close(); };
  document.addEventListener("keydown", onKey);
  function close() { unsub(); overlay.remove(); document.removeEventListener("keydown", onKey); }

  function draw() {
    const list = movies.filter(m => !q || m.title.toLowerCase().includes(q) || (m.description || "").toLowerCase().includes(q));
    if (!list.length) {
      grid.replaceChildren(el("div", { class: "empty" }, el("b", {}, movies.length ? "No matches" : "No movies yet"),
        movies.length ? "" : ctx.isMod() ? "Click + Add movie to put one up." : "A mod hasn't added any yet."));
      return;
    }
    grid.replaceChildren(...list.map(m => {
      const card = el("div", { class: "movie-card", tabIndex: 0, onclick: () => playMovie(m),
        onkeydown: e => { if (e.key === "Enter") playMovie(m); } },
        el("div", { class: "movie-poster" },
          m.poster ? el("img", { src: m.poster, alt: "", loading: "lazy", referrerPolicy: "no-referrer",
            onerror: e => e.target.remove() }) : null,
          el("div", { class: "movie-poster-fallback" }, "🎬"),
          el("div", { class: "movie-play" }, "▶")),
        el("div", { class: "movie-title" }, m.title),
        m.description ? el("div", { class: "movie-desc" }, m.description) : null);
      if (ctx.isMod()) {
        card.append(el("div", { class: "movie-mod" },
          el("span", { class: "chip" }, TYPE_LABEL[m.type] || m.type),
          el("button", { class: "btn sm", onclick: e => { e.stopPropagation(); editMovie(ctx, m); } }, "Edit"),
          el("button", { class: "btn sm danger", onclick: e => { e.stopPropagation(); removeMovie(m); } }, "Delete")));
      }
      return card;
    }));
  }
}

// ---------- player ----------
export function playMovie(m) {
  let media;
  if (m.type === "drive") {
    media = el("iframe", { class: "movie-frame", src: m.url, allow: "autoplay; fullscreen; encrypted-media", title: m.title });
    media.setAttribute("allowfullscreen", "");
  } else {
    media = el("video", { class: "movie-video", src: m.url, controls: true, autoplay: true, playsInline: true,
      poster: m.poster || null, preload: "metadata" });
    media.onerror = () => toast("This video couldn't play. The link may be broken or not an MP4.");
  }
  const overlay = el("div", { class: "game-overlay movie-player" },
    el("div", { class: "game-bar" },
      el("div", { class: "game-title" }, "🎬 " + m.title),
      el("div", { class: "row" },
        el("button", { class: "btn sm", onclick: () => goFullscreen(media) }, "⛶ Fullscreen"),
        el("button", { class: "btn sm", onclick: () => close() }, "✕ Close"))),
    el("div", { class: "movie-stage" }, media),
    m.type === "drive" ? el("div", { class: "muted movie-note" },
      "Playing from Google Drive. If it says it can't play, the file must be shared as \"Anyone with the link\" and finished processing.") : null);
  document.body.append(overlay);
  const onKey = e => { if (e.key === "Escape" && !document.fullscreenElement) close(); };
  document.addEventListener("keydown", onKey);
  function close() {
    if (media.tagName === "VIDEO") { media.pause(); media.removeAttribute("src"); media.load(); }
    else media.src = "about:blank";
    overlay.remove(); document.removeEventListener("keydown", onKey);
  }
}

// ---------- add / edit (mods) ----------
function editMovie(ctx, m = null) {
  const title = el("input", { class: "input", maxlength: 100, value: m?.title || "", placeholder: "Movie title" });
  const desc = el("textarea", { class: "input", rows: 2, maxlength: 500, placeholder: "Short description (optional)" }, m?.description || "");
  const poster = el("input", { class: "input", type: "url", maxlength: 1000, value: m?.poster || "", placeholder: "https://… image link (optional)" });
  const posterPrev = el("div", { class: "poster-preview" });
  const drawPoster = () => {
    const v = poster.value.trim();
    posterPrev.replaceChildren(v ? el("img", { src: v, referrerPolicy: "no-referrer", alt: "", onerror: e => e.target.replaceWith(el("span", { class: "muted" }, "Image didn't load")) }) : el("span", { class: "muted" }, "No poster"));
  };
  poster.oninput = drawPoster; drawPoster();

  // source tabs
  let type = m?.type || "drive";
  const driveIn = el("input", { class: "input", placeholder: "https://drive.google.com/file/d/…/view", value: m?.type === "drive" ? m.url.replace("/preview", "/view") : "" });
  const urlIn = el("input", { class: "input", type: "url", placeholder: "https://…/movie.mp4", value: m?.type === "url" ? m.url : "" });
  const fileIn = el("input", { class: "input", type: "file", accept: "video/mp4,video/webm,video/*" });
  const prog = el("div", { class: "upload-prog", hidden: true }, el("div", { class: "bar" }), el("span", {}));
  const panes = {
    drive: el("div", {}, driveIn, el("p", { class: "muted", style: { fontSize: "12px" } },
      "In Google Drive: right-click the video → Share → General access: ", el("b", {}, "Anyone with the link"), " → Copy link. Free, no size limit here.")),
    url: el("div", {}, urlIn, el("p", { class: "muted", style: { fontSize: "12px" } },
      "A direct link to an .mp4 or .webm file. Tip: you can put an MP4 in your site's ", el("b", {}, "movies"), " folder and use its link.")),
    upload: el("div", {}, m?.type === "upload" ? el("p", { class: "muted" }, "Current file is kept unless you choose a new one.") : null,
      fileIn, prog, el("p", { class: "muted", style: { fontSize: "12px" } },
      "Needs Firebase Storage, which requires the Blaze plan (see README). Max 5 GB."))
  };
  const tabs = el("div", { class: "seg-tabs" }, Object.entries({ drive: "Google Drive", url: "Video link", upload: "Upload MP4" }).map(([k, t]) =>
    el("button", { type: "button", class: k === type ? "active" : "", onclick: e => {
      type = k; tabs.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === e.currentTarget)); showPane();
    } }, t)));
  const paneBox = el("div");
  const showPane = () => paneBox.replaceChildren(panes[type]);
  showPane();

  openModal(m ? "Edit movie" : "Add movie", el("div", { class: "form movie-form" },
    el("label", { class: "lbl", style: { marginTop: 0 } }, "Title"), title,
    el("label", { class: "lbl" }, "Description"), desc,
    el("label", { class: "lbl" }, "Poster image link"), el("div", { class: "row", style: { alignItems: "center" } }, poster, posterPrev),
    el("label", { class: "lbl" }, "Video"), tabs, paneBox), [
    { label: "Cancel" },
    { label: m ? "Save" : "Add movie", kind: "primary", onClick: async () => {
      const t = title.value.trim(), p = poster.value.trim();
      if (!t) { toast("Give it a title."); return false; }
      if (p && !/^https:\/\/.+/.test(p)) { toast("Poster link must start with https://"); return false; }
      let url = "", storagePath = m?.type === "upload" && type === "upload" ? m.storagePath : "";
      if (type === "drive") {
        const id = driveId(driveIn.value);
        if (!id) { toast("That doesn't look like a Google Drive file link."); return false; }
        url = drivePreview(id);
      } else if (type === "url") {
        url = urlIn.value.trim();
        if (!isVideoUrl(url)) { toast("Video link must start with https://"); return false; }
      } else {
        const f = fileIn.files[0];
        if (!f && m?.type === "upload") url = m.url;
        else if (!f) { toast("Choose a video file."); return false; }
        else {
          try { ({ url, storagePath } = await uploadVideo(f, prog)); }
          catch (err) { toast(uploadError(err)); prog.hidden = true; return false; }
        }
      }
      const data = { title: t, description: desc.value.trim(), poster: p, type, url, storagePath, updatedAt: serverTimestamp() };
      if (m) await updateDoc(doc(db, "movies", m.id), { ...data, addedBy: m.addedBy, createdAt: m.createdAt });
      else await addDoc(collection(db, "movies"), { ...data, addedBy: ctx.me, createdAt: serverTimestamp() });
      // replaced an uploaded file → delete the old one
      if (m?.type === "upload" && m.storagePath && m.storagePath !== storagePath) deleteFile(m.storagePath);
      toast(m ? "Movie saved" : "Movie added 🎬");
    } }
  ]);
}

async function removeMovie(m) {
  openModal("Delete movie?", el("p", {}, "Remove ", el("b", {}, m.title), " for everyone?"), [
    { label: "Cancel" },
    { label: "Delete", kind: "danger", onClick: async () => {
      await deleteDoc(doc(db, "movies", m.id));
      if (m.type === "upload" && m.storagePath) deleteFile(m.storagePath);
      toast("Movie deleted");
    } }
  ]);
}

// ---------- uploads (Firebase Storage, Blaze plan) ----------
async function uploadVideo(file, prog) {
  if (file.size > 5 * 1024 ** 3) throw new Error("File is over 5 GB.");
  const { getStorage, ref, uploadBytesResumable, getDownloadURL } = await import(STORAGE_SDK);
  const path = `movies/${Date.now()}_${file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80)}`;
  const task = uploadBytesResumable(ref(getStorage(app), path), file, { contentType: file.type || "video/mp4" });
  prog.hidden = false;
  const bar = prog.querySelector(".bar"), label = prog.querySelector("span");
  await new Promise((res, rej) => task.on("state_changed", s => {
    const pct = s.totalBytes ? (s.bytesTransferred / s.totalBytes) * 100 : 0;
    bar.style.width = pct.toFixed(1) + "%";
    label.textContent = `Uploading… ${pct.toFixed(0)}% (${(s.bytesTransferred / 1048576).toFixed(0)} / ${(s.totalBytes / 1048576).toFixed(0)} MB)`;
  }, rej, res));
  label.textContent = "Uploaded ✓";
  return { url: await getDownloadURL(task.snapshot.ref), storagePath: path };
}
async function deleteFile(path) {
  try { const { getStorage, ref, deleteObject } = await import(STORAGE_SDK); await deleteObject(ref(getStorage(app), path)); } catch {}
}
function uploadError(err) {
  const c = err?.code || "";
  if (c.includes("unauthorized")) return "Upload not allowed. Did you paste storage.rules into Storage → Rules?";
  if (c.includes("bucket") || c.includes("project-not-found") || c.includes("unknown") || c.includes("no-default-bucket"))
    return "Firebase Storage isn't set up (it needs the Blaze plan). Use a Google Drive link instead.";
  if (c.includes("quota")) return "Storage is full (quota exceeded).";
  if (c.includes("canceled")) return "Upload cancelled.";
  if (/dynamically imported module|Failed to fetch/i.test(err?.message || "")) return "Couldn't load the upload tools. Check your internet and try again.";
  return "Upload failed: " + (err?.message || c);
}
