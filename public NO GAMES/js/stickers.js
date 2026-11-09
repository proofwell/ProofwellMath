import { el } from "./firebase.js";

// Stickers: big animated pictures you can send instead of a message.
// To add more later: add an entry here (and its name to the list in firestore.rules → stickerOk).
export const STICKERS = {
  heart: { name: "Floating heart", preview: "💖", draw: heartSticker }
};

function heartSticker() {
  const svg = `<svg viewBox="0 0 120 110" aria-hidden="true">
    <defs>
      <linearGradient id="shg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8fb8"/><stop offset=".55" stop-color="#ff3d7f"/><stop offset="1" stop-color="#d6145c"/></linearGradient>
      <radialGradient id="shs" cx=".32" cy=".28" r=".35"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    <path d="M60 104 C26 80 6 60 6 36 C6 18 20 6 36 6 C47 6 55 12 60 21 C65 12 73 6 84 6 C100 6 114 18 114 36 C114 60 94 80 60 104Z" fill="url(#shg)" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
    <ellipse cx="40" cy="32" rx="18" ry="13" fill="url(#shs)"/>
  </svg>`;
  const heart = el("div", { class: "stk-heart" }); heart.innerHTML = svg;
  return el("div", { class: "sticker stk-float", role: "img", "aria-label": "Floating heart sticker" },
    el("span", { class: "stk-spark s1" }, "✦"), el("span", { class: "stk-spark s2" }, "✦"), el("span", { class: "stk-spark s3" }, "✧"),
    el("div", { class: "stk-shadow" }), heart);
}

export function stickerEl(key) {
  const s = STICKERS[key];
  return s ? s.draw() : el("div", { class: "muted" }, "Unknown sticker");
}

// the picker that opens from the composer's sticker button
let pop = null;
export function openStickerPicker(anchor, onPick) {
  if (pop) { closeStickerPicker(); return; }
  const r = anchor.getBoundingClientRect();
  pop = el("div", { class: "sticker-pop" },
    el("div", { class: "sticker-pop-head" }, "Stickers"),
    el("div", { class: "sticker-grid" }, Object.entries(STICKERS).map(([k, s]) =>
      el("button", { type: "button", class: "sticker-opt", title: s.name, onclick: () => { closeStickerPicker(); onPick(k); } }, stickerEl(k)))));
  document.body.append(pop);
  pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left)) + "px";
  pop.style.top = Math.max(8, r.top - pop.offsetHeight - 8) + "px";
  setTimeout(() => { addEventListener("pointerdown", outside, true); addEventListener("keydown", esc, true); });
}
function outside(e) { if (pop && !pop.contains(e.target) && !e.target.closest?.("#sticker-btn")) closeStickerPicker(); }
function esc(e) { if (e.key === "Escape") closeStickerPicker(); }
export function closeStickerPicker() {
  pop?.remove(); pop = null;
  removeEventListener("pointerdown", outside, true); removeEventListener("keydown", esc, true);
}
