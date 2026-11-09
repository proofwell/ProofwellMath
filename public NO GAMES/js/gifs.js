import { db, el, toast } from "./firebase.js";
import {
  doc, getDoc, setDoc, updateDoc, getDocs, collection, query, orderBy, limit, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal } from "./ui.js";

// ===== OPTIONAL: GIF search =====
// Tenor's API was shut down by Google (June 2026), so search uses GIPHY instead.
// Get a free key at developers.giphy.com → Create an App → API, paste it here.
// Leave it empty and people can still paste Tenor/GIPHY GIF links.
export const GIPHY_KEY = "";
// KLIPY (free GIF API, used first when set): sign up at partner.klipy.com → create an app → copy the API key here.
export const KLIPY_KEY = "";

// Turns a pasted link into { gif, gifKey } or null.
// Tenor: right-click a GIF on tenor.com → "Copy image address" (media.tenor.com/...)
// GIPHY: any giphy.com/gifs/... link, or a media.giphy.com / i.giphy.com link
export function parseGif(input) {
  let s = (input || "").trim();
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase(), parts = u.pathname.split("/").filter(Boolean);

  // Tenor media link: https://media.tenor.com/<id>/<name>.gif  (or media1.tenor.com/m/<id>/<name>.gif)
  if (/^media\d*\.tenor\.com$/.test(host)) {
    const p = parts[0] === "m" ? parts.slice(1) : parts;
    if (p.length !== 2 || !/^[A-Za-z0-9_-]{4,80}$/.test(p[0])) return null;
    const file = p[1].replace(/[^A-Za-z0-9_.%-]/g, "");
    if (!/\.(gif|webp)$/i.test(file)) return null;
    return { gif: `https://media.tenor.com/${p[0]}/${file}`, gifKey: p[0] };
  }
  // GIPHY: media*.giphy.com/media/<maybe v1 stuff>/<id>/giphy.gif, i.giphy.com/<id>.gif, giphy.com/gifs/name-<id>
  if (/(^|\.)giphy\.com$/.test(host)) {
    let id = null;
    if (host === "giphy.com" && parts[0] === "gifs") id = parts[1]?.split("-").pop();
    else if (host === "i.giphy.com") id = (parts[parts.length - 1] || "").replace(/\.(gif|webp)$/i, "");
    else if (parts[0] === "media") id = parts[parts.length - 1]?.startsWith("giphy") ? parts[parts.length - 2] : parts[1];
    if (id && /^[A-Za-z0-9_-]{4,80}$/.test(id)) return { gif: `https://media.giphy.com/media/${id}/giphy.gif`, gifKey: id };
  }
  // ----- Discord -----
  // GIFs picked in Discord's GIF menu → "Copy Link" gives a Tenor page: tenor.com/view/name-gif-123456
  if (/^(www\.)?tenor\.com$/.test(host)) {
    const view = parts.findIndex(x => x === "view");
    if (view >= 0 && parts[view + 1]) {
      const slug = parts[view + 1].replace(/[^A-Za-z0-9-]/g, ""), id = slug.match(/-(\d{4,})$/)?.[1];
      if (id) return { gif: `https://tenor.com/view/${slug}`, gifKey: id };
    }
    const short = parts.length === 1 && parts[0].match(/^([A-Za-z0-9_-]{4,80})\.gif$/);
    if (short) return { gif: `https://tenor.com/${short[1]}.gif`, gifKey: short[1] };
  }
  // KLIPY: static.klipy.com/… (right-click a KLIPY GIF → Copy image address)
  if (/(^|\.)klipy\.com$/.test(host) && /\.(gif|webp|mp4)$/i.test(u.pathname)) return klipyGif(`https://${host}${u.pathname}`);
  // Uploaded GIFs: cdn.discordapp.com/attachments/<channel>/<id>/<name>.gif?ex=…  (or media.discordapp.net)
  if (host === "cdn.discordapp.com" || host === "media.discordapp.net") {
    const q = u.search.replace(/[^A-Za-z0-9_=&.%?-]/g, "");
    if (parts[0] === "attachments" && parts.length === 4 && /^\d+$/.test(parts[1]) && /^\d{4,80}$/.test(parts[2])
        && /\.(gif|webp|png|jpe?g|mp4|webm)$/i.test(parts[3])) {
      return { gif: `https://${host}/attachments/${parts[1]}/${parts[2]}/${parts[3].replace(/[^A-Za-z0-9_.%-]/g, "")}${q}`, gifKey: parts[2] };
    }
    // Animated emojis: cdn.discordapp.com/emojis/<id>.gif
    const em = parts[0] === "emojis" && parts[1]?.match(/^(\d{4,80})\.(gif|webp|png)$/);
    if (em) return { gif: `https://${host}/emojis/${em[1]}.${em[2]}${q}`, gifKey: em[1] };
  }
  return null;
}

// A KLIPY media link → { gif, gifKey }. The key is the longest id-looking piece of the link.
export function klipyGif(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)klipy\.com$/.test(u.hostname) || !/^[A-Za-z0-9_./%-]+\.(gif|webp|mp4)$/i.test(u.pathname)) return null;
    const segs = u.pathname.split("/").filter(Boolean).flatMap((p, i, a) => i === a.length - 1 ? [p.replace(/\.[a-z0-9]+$/i, "")] : [p]);
    // the piece must be followed by / . _ or - in the link (the database checks that too)
    const key = segs.filter(x => /^[A-Za-z0-9_-]{4,80}$/.test(x)).sort((a, b) => b.length - a.length)[0];
    if (!key) return null;
    return { gif: `https://${u.hostname}${u.pathname}`, gifKey: key };
  } catch { return null; }
}
function klipyItem(d) {
  const f = d.file || d.files || {};
  const pick = (...sizes) => { for (const sz of sizes) { const x = f[sz]; const url = x?.gif?.url || x?.webp?.url || (typeof x?.gif === "string" ? x.gif : null); if (url) return url; } return null; };
  const full = pick("md", "hd", "sm"), small = pick("sm", "xs", "md");
  const g = full && klipyGif(full);
  return g ? { ...g, preview: small || full } : null;
}

// Old helper (Tenor pages are now supported directly)
export function looksLikeTenorPage() { return false; }

// What kind of thing is this link? (decides how to show it)
export function gifKind(url) {
  if (/^https:\/\/tenor\.com\/view\//.test(url)) return "tenor-embed";
  if (/\.(mp4|webm)(\?|$)/i.test(url)) return "video";
  return "img";
}

// Rendered GIF inside a message. opts: { fav: bool, onFav() } adds a ☆ in the corner (like Discord)
export function gifEl(m, banned, opts = {}) {
  if (banned.has(m.gifKey)) return el("div", { class: "gif-removed" }, "🚫 GIF removed by a mod");
  const kind = gifKind(m.gif);
  let media;
  if (kind === "tenor-embed") {
    media = el("iframe", { class: "chat-gif tenor-frame", src: `https://tenor.com/embed/${m.gifKey}`, title: "GIF", loading: "lazy",
      referrerPolicy: "no-referrer", allow: "autoplay" });
    media.setAttribute("frameborder", "0");
  } else if (kind === "video") {
    media = el("video", { class: "chat-gif", src: m.gif, autoplay: true, loop: true, muted: true, playsInline: true });
    media.muted = true;
    media.onerror = () => media.replaceWith(el("div", { class: "gif-removed" }, "GIF expired or couldn't load"));
  } else {
    media = el("img", { class: "chat-gif", src: m.gif, alt: "GIF", loading: "lazy", referrerPolicy: "no-referrer" });
    media.onerror = () => media.replaceWith(el("div", { class: "gif-removed" }, "GIF expired or couldn't load"));
  }
  const wrap = el("div", { class: "gif-wrap" }, media);
  if (opts.onFav) {
    const star = el("button", { type: "button", class: "gif-corner-star" + (opts.fav ? " on" : ""), title: opts.fav ? "Remove from favorites" : "Add to favorites",
      onclick: async e => { e.stopPropagation(); const now = await opts.onFav(); if (typeof now === "boolean") { star.classList.toggle("on", now); star.textContent = now ? "★" : "☆"; star.title = now ? "Remove from favorites" : "Add to favorites"; } } },
      opts.fav ? "★" : "☆");
    wrap.append(star);
  }
  return wrap;
}

// ---------- favorites (private, max 10) ----------
export const MAX_FAVS = 10;
let favs = null; // [{gif, gifKey}]
export async function loadFavs(uid) {
  if (favs) return favs;
  try { const s = await getDoc(doc(db, "favGifs", uid)); favs = s.exists() ? (s.data().gifs || []) : []; }
  catch { favs = []; }
  return favs;
}
export const isFav = key => !!favs?.some(f => f.gifKey === key);
// returns true if now a favorite
export async function toggleFav(uid, g) {
  await loadFavs(uid);
  let next;
  if (isFav(g.gifKey)) next = favs.filter(f => f.gifKey !== g.gifKey);
  else {
    if (favs.length >= MAX_FAVS) { toast(`You can only have ${MAX_FAVS} favorites. Remove one first.`); return false; }
    next = [{ gif: g.gif, gifKey: g.gifKey }, ...favs];
  }
  await setDoc(doc(db, "favGifs", uid), { gifs: next });
  favs = next;
  toast(isFav(g.gifKey) ? "⭐ Added to favorites" : "Removed from favorites");
  return isFav(g.gifKey);
}

// ---------- popularity ----------
// +1 for a GIF after it's sent. Separate from the message, so it can never block sending.
export async function bumpGif(g) {
  const ref = doc(db, "gifStats", g.gifKey);
  try { await updateDoc(ref, { count: increment(1), last: serverTimestamp() }); }
  catch { try { await setDoc(ref, { url: g.gif, count: 1, last: serverTimestamp() }); } catch {} }
}
async function loadPopular(banned) {
  try {
    const s = await getDocs(query(collection(db, "gifStats"), orderBy("count", "desc"), limit(30)));
    return s.docs.map(d => ({ gif: d.data().url, gifKey: d.id, count: d.data().count }))
      .filter(g => !banned.has(g.gifKey)).slice(0, 12);
  } catch { return []; }
}

// ---------- the picker ----------
// recent: [{gif, gifKey}] seen in chat; onPick({gif, gifKey})
export function openGifPicker({ uid, recent = [], banned, onPick }) {
  const body = el("div", { class: "gif-picker" });
  let modal;
  const pick = g => {
    if (banned.has(g.gifKey)) { toast("That GIF was banned by a mod."); return; }
    modal.close(); onPick(g);
  };

  // a grid of GIFs, each with a ⭐ toggle
  const cell = g => {
    const star = el("button", { type: "button", class: "gif-star" + (isFav(g.gifKey) ? " on" : ""),
      title: isFav(g.gifKey) ? "Remove from favorites" : "Add to favorites",
      onclick: async e => {
        e.stopPropagation();
        try { await toggleFav(uid, g); drawFavs(); refreshStars(); } catch (err) { toast(err.message); }
      } }, isFav(g.gifKey) ? "★" : "☆");
    star.dataset.key = g.gifKey;
    return el("div", { class: "gif-cell", title: "Send", onclick: () => pick(g) },
      previewMedia(g),
      g.count ? el("span", { class: "gif-count" }, "🔥 " + g.count) : null,
      star);
  };
  const grid = (items, empty) => el("div", { class: "gif-grid" }, ...(items.length ? items.map(cell)
    : [el("div", { class: "muted gif-empty" }, empty)]));
  function refreshStars() {
    body.querySelectorAll(".gif-star").forEach(s => {
      const on = isFav(s.dataset.key);
      s.classList.toggle("on", on); s.textContent = on ? "★" : "☆";
      s.title = on ? "Remove from favorites" : "Add to favorites";
    });
  }

  // ⭐ Favorites
  const favBox = el("div");
  const favTitle = el("div", { class: "lbl", style: { marginTop: 0 } });
  function drawFavs() {
    const list = (favs || []).filter(g => !banned.has(g.gifKey));
    favTitle.textContent = `⭐ Your favorites (${list.length}/${MAX_FAVS})`;
    favBox.replaceChildren(grid(list, "Tap ☆ on any GIF to save it here."));
  }
  body.append(favTitle, favBox);

  // 🔥 Most popular
  const popBox = el("div", {}, el("div", { class: "muted", style: { padding: "6px 2px" } }, "Loading…"));
  body.append(el("div", { class: "lbl" }, "🔥 Most popular"), popBox);

  // search: KLIPY if a key is set (with trending), otherwise GIPHY
  if (KLIPY_KEY) {
    const q = el("input", { class: "input", placeholder: "Search KLIPY" });
    const results = el("div", {}, el("div", { class: "muted", style: { padding: "6px 2px" } }, "Loading trending…"));
    let timer;
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => search(q.value.trim()), 350); };
    body.append(el("div", { class: "lbl" }, "🔎 Search"), q,
      el("div", { class: "muted", style: { margin: "4px 0 6px", fontSize: "11px" } }, "Powered by KLIPY"), results);
    const base = `https://api.klipy.com/api/v1/${encodeURIComponent(KLIPY_KEY)}/gifs`;
    let cid = ""; try { cid = localStorage.getItem("klipyId") || ""; if (!cid) { cid = Math.random().toString(36).slice(2, 12); localStorage.setItem("klipyId", cid); } } catch {}
    async function search(term) {
      const ep = term ? `${base}/search?q=${encodeURIComponent(term)}&per_page=24&rating=pg&customer_id=${cid}`
        : `${base}/trending?per_page=24&rating=pg&customer_id=${cid}`;
      try {
        const j = await (await fetch(ep)).json();
        const items = (j?.data?.data || []).filter(d => !d.type || d.type === "gif").map(klipyItem).filter(g => g && !banned.has(g.gifKey));
        results.replaceChildren(el("div", { class: "muted", style: { fontSize: "12px", margin: "2px 0 6px" } }, term ? `Results for “${term}”` : "🔥 Trending"), grid(items, "No results."));
        refreshStars();
      } catch { results.replaceChildren(el("div", { class: "muted" }, "GIF search isn't working right now.")); }
    }
    search("");
  } else if (GIPHY_KEY) {
    const q = el("input", { class: "input", placeholder: "Search GIFs" });
    const results = el("div");
    let timer;
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => search(q.value.trim()), 350); };
    body.append(el("div", { class: "lbl" }, "🔎 Search"), q,
      el("div", { class: "muted", style: { margin: "4px 0 6px", fontSize: "11px" } }, "Powered by GIPHY"), results);
    async function search(term) {
      if (!term) { results.replaceChildren(); return; }
      const ep = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(term)}&limit=24&rating=g`;
      try {
        const j = await (await fetch(ep)).json();
        results.replaceChildren(grid((j.data || []).map(d => ({
          gif: `https://media.giphy.com/media/${d.id}/giphy.gif`, gifKey: d.id,
          preview: d.images?.fixed_width_small?.url || d.images?.fixed_width?.url
        })).filter(g => /^[A-Za-z0-9_-]{4,80}$/.test(g.gifKey) && !banned.has(g.gifKey)), "No results."));
      } catch { toast("GIF search failed"); }
    }
  }

  // paste a link
  const link = el("input", { class: "input", placeholder: "Paste a KLIPY, Tenor, GIPHY or Discord GIF link" });
  const preview = el("div", { class: "gif-preview" });
  const hint = el("div", { class: "muted", style: { fontSize: "12px", marginTop: "6px" } },
    "From Discord: right-click a GIF → ", el("b", {}, "Copy Link"), ". From Tenor: copy the page link or right-click the GIF → Copy image address.");
  const sendBtn = el("button", { class: "btn primary", type: "button", disabled: true }, "Send");
  const favBtn = el("button", { class: "btn", type: "button", disabled: true, title: "Add to favorites" }, "☆");
  let current = null;
  link.oninput = () => {
    current = parseGif(link.value);
    sendBtn.disabled = favBtn.disabled = !current;
    if (current && banned.has(current.gifKey)) {
      preview.replaceChildren(el("div", { class: "gif-removed" }, "🚫 That GIF is banned")); sendBtn.disabled = favBtn.disabled = true;
    } else if (current) {
      preview.replaceChildren(gifEl(current, new Set()));
    } else if (looksLikeTenorPage(link.value)) {
      preview.replaceChildren(el("div", { class: "muted" }, "That's a Tenor page link. Right-click the GIF itself → Copy image address."));
    } else preview.replaceChildren();
  };
  link.onkeydown = e => { if (e.key === "Enter" && current && !sendBtn.disabled) { e.preventDefault(); pick(current); } };
  sendBtn.onclick = () => current && pick(current);
  favBtn.onclick = async () => { if (current) { await toggleFav(uid, current).catch(err => toast(err.message)); drawFavs(); refreshStars(); } };
  body.append(el("div", { class: "lbl" }, "🔗 Paste a link"),
    el("div", { class: "row" }, link, favBtn, sendBtn), hint, preview);

  // recent GIFs from chat
  const seen = new Set(), rec = [];
  for (const g of recent) if (!seen.has(g.gifKey) && !banned.has(g.gifKey)) { seen.add(g.gifKey); rec.push(g); }
  if (rec.length) body.append(el("div", { class: "lbl" }, "🕘 Recently in chat"), grid(rec.slice(0, 12), ""));

  modal = openModal("🖼️ GIFs", body, [{ label: "Close" }]);

  loadFavs(uid).then(drawFavs);
  loadPopular(banned).then(list => { popBox.replaceChildren(grid(list, "No GIFs sent yet — be the first!")); refreshStars(); });
}

function previewMedia(g) {
  const k = gifKind(g.gif);
  if (k === "tenor-embed") return el("iframe", { src: `https://tenor.com/embed/${g.gifKey}`, loading: "lazy", tabIndex: -1, style: { pointerEvents: "none" } });
  if (k === "video") { const v = el("video", { src: g.gif, autoplay: true, loop: true, muted: true, playsInline: true }); v.muted = true; return v; }
  return el("img", { src: g.preview || g.gif, loading: "lazy", referrerPolicy: "no-referrer", alt: "" });
}
