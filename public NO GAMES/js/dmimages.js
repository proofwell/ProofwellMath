import { db, el, toast } from "./firebase.js";
import {
  collection, doc, query, orderBy, onSnapshot, getDocs, writeBatch, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// How many images each DM conversation keeps. Older ones are deleted automatically.
// Free database = 1 GB. Each image is shrunk to ~200 KB, so with 20 people
// (190 possible DM pairs) × 5 images ≈ 190 MB. Even 20 per DM (≈ 760 MB) would fit.
export const KEEP_PER_DM = 5;

const MAX_SIDE = 1280;          // longest side in pixels
const TARGET_CHARS = 280_000;   // ~200 KB image (base64 is a bit bigger than the file)
const HARD_LIMIT = 880_000;     // the database rule allows up to 900,000

// ---------- shrink a picture in the browser ----------
async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch {}
  }
  return await new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = () => rej(new Error("That file isn't an image we can read."));
    img.src = URL.createObjectURL(file);
  });
}
export async function shrinkImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("Only images can be sent.");
  if (file.size > 25 * 1024 * 1024) throw new Error("That image is over 25 MB.");
  const bmp = await loadBitmap(file);
  let side = MAX_SIDE, best = null;
  for (let round = 0; round < 6; round++) {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const cx = c.getContext("2d");
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h); // transparent PNGs get a white background
    cx.drawImage(bmp, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.58, 0.45]) {
      let data = c.toDataURL("image/webp", q);
      if (!data.startsWith("data:image/webp")) data = c.toDataURL("image/jpeg", q); // Safari: no WebP export
      best = { data, w, h };
      if (data.length <= TARGET_CHARS) return best;
    }
    side = Math.round(side * 0.75);
  }
  if (best && best.data.length <= HARD_LIMIT) return best;
  throw new Error("Couldn't shrink that image enough. Try a smaller one.");
}

// ---------- send ----------
// Saves the image + a message pointing at it in one go, then trims old images.
export async function sendDmImage({ dmId, me, file, caption = "" }) {
  const img = await shrinkImage(file);
  const imgRef = doc(collection(db, "dms", dmId, "images"));
  const b = writeBatch(db);
  b.set(imgRef, { uid: me, data: img.data, w: img.w, h: img.h, createdAt: serverTimestamp() });
  b.set(doc(db, "dms", dmId), { members: dmId.split("_"), lastMessageAt: serverTimestamp(), lastText: "📷 Photo", lastFrom: me });
  b.set(doc(collection(db, "dms", dmId, "messages")), { uid: me, text: caption.slice(0, 1000), createdAt: serverTimestamp(), imageId: imgRef.id });
  await b.commit();
  trimImages(dmId);
}

// Delete everything but the newest KEEP_PER_DM images in a DM.
export async function trimImages(dmId) {
  try {
    const s = await getDocs(query(collection(db, "dms", dmId, "images"), orderBy("createdAt", "desc")));
    const old = s.docs.slice(KEEP_PER_DM);
    await Promise.all(old.map(d => deleteDoc(d.ref).catch(() => {})));
  } catch {}
}

// ---------- live list of a DM's images ----------
// cb(Map id -> {data, w, h, uid}) every time it changes. Returns unsubscribe.
export function watchDmImages(dmId, cb) {
  return onSnapshot(collection(db, "dms", dmId, "images"), s => {
    const m = new Map();
    s.forEach(d => m.set(d.id, d.data()));
    cb(m);
  }, () => cb(new Map()));
}

// ---------- show an image in a message ----------
export function imageEl(imageId, images, loaded) {
  const img = images.get(imageId);
  if (!img) {
    return el("div", { class: "gif-removed" }, loaded
      ? `🖼️ Image expired (only the newest ${KEEP_PER_DM} in a DM are kept)`
      : "🖼️ Loading image…");
  }
  // reserve space so the chat doesn't jump while it decodes
  const maxW = 320, maxH = 320, s = Math.min(1, maxW / img.w, maxH / img.h);
  return el("img", { class: "chat-img", src: img.data, alt: "Photo", width: Math.round(img.w * s), height: Math.round(img.h * s),
    onclick: () => viewImage(img.data) });
}

export function viewImage(src) {
  const o = el("div", { class: "lightbox", onclick: () => close() },
    el("img", { src, alt: "" }),
    el("div", { class: "lightbox-bar", onclick: e => e.stopPropagation() },
      el("a", { class: "btn sm", href: src, download: "photo." + (src.startsWith("data:image/webp") ? "webp" : "jpg") }, "⬇ Save"),
      el("button", { class: "btn sm", onclick: () => close() }, "✕ Close")));
  const onKey = e => { if (e.key === "Escape") close(); };
  function close() { o.remove(); document.removeEventListener("keydown", onKey); }
  document.addEventListener("keydown", onKey);
  document.body.append(o);
}

// ---------- pick / paste / drop ----------
export function pickImageFile() {
  return new Promise(res => {
    const i = el("input", { type: "file", accept: "image/*", style: { display: "none" } });
    i.onchange = () => { res(i.files[0] || null); i.remove(); };
    document.body.append(i); i.click();
  });
}

// Small confirm dialog with preview + optional caption
export function confirmImage(file, toName) {
  return new Promise(async res => {
    const url = URL.createObjectURL(file);
    const caption = el("input", { class: "input", maxlength: 1000, placeholder: "Add a caption (optional)" });
    const { openModal } = await import("./ui.js");
    let done = false;
    const m = openModal("Send photo to " + toName, el("div", { class: "form" },
      el("img", { class: "send-preview", src: url, alt: "" }),
      el("p", { class: "muted", style: { fontSize: "12px" } }, `It gets shrunk before sending. Each DM keeps only the newest ${KEEP_PER_DM} photos.`),
      caption), [
      { label: "Cancel", onClick: () => { done = true; URL.revokeObjectURL(url); res(null); } },
      { label: "Send", kind: "primary", onClick: () => { done = true; URL.revokeObjectURL(url); res({ caption: caption.value.trim() }); } }
    ]);
    caption.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); done = true; m.close(); URL.revokeObjectURL(url); res({ caption: caption.value.trim() }); } };
    // closed by Esc / clicking outside
    const iv = setInterval(() => { if (!document.body.contains(caption) && !done) { clearInterval(iv); res(null); } else if (done) clearInterval(iv); }, 300);
  });
}
