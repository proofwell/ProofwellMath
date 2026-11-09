import { el, toast } from "./firebase.js";
import { updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Reactions on messages. Saved on the message as reactions: { uid: ["heart", "party", …] },
// so each person can only change their own (the database rules check that).
export const REACTIONS = [
  { key: "heart", emoji: "❤️", label: "Heart" },
  { key: "x", emoji: "❌", label: "X" },
  { key: "check", emoji: "✅", label: "Check" },
  { key: "q", emoji: "❓", label: "Question" },
  { key: "party", emoji: "🎉", label: "Party" }
];
const byKey = Object.fromEntries(REACTIONS.map(r => [r.key, r]));

// who reacted with what: key -> [uids]
function tally(m) {
  const out = {};
  for (const [uid, keys] of Object.entries(m.reactions || {})) for (const k of keys || []) if (byKey[k]) (out[k] ||= []).push(uid);
  return out;
}
export const hasReacted = (m, me, key) => (m.reactions?.[me] || []).includes(key);

export async function toggleReaction(ref, m, me, key) {
  const had = hasReacted(m, me, key);
  try { await updateDoc(ref, { [`reactions.${me}`]: had ? arrayRemove(key) : arrayUnion(key) }); }
  catch (err) { toast(err.code === "permission-denied" ? "You can't react here." : "Couldn't react: " + (err.code || err.message)); }
}

// the little pills under a message: ❤️ 3  🎉 1
// opts: { me, lookup, canReact, onToggle(key), onAdd(anchorEl) }
export function reactionBar(m, { me, lookup, canReact, onToggle, onAdd }) {
  const t = tally(m);
  const keys = REACTIONS.map(r => r.key).filter(k => t[k]?.length);
  if (!keys.length) return null;
  return el("div", { class: "reacts" },
    keys.map(k => {
      const who = t[k], mine = who.includes(me);
      const names = who.map(u => u === me ? "You" : lookup(u).name);
      const title = (names.length > 8 ? names.slice(0, 8).join(", ") + ` and ${names.length - 8} more` : names.join(", ")) + " reacted " + byKey[k].emoji;
      return el("button", { type: "button", class: "react-pill" + (mine ? " mine" : ""), title, disabled: !canReact,
        onclick: e => { e.stopPropagation(); onToggle(k); } }, el("span", { class: "re" }, byKey[k].emoji), el("span", {}, String(who.length)));
    }),
    canReact ? el("button", { type: "button", class: "react-pill add", title: "Add reaction", onclick: e => { e.stopPropagation(); onAdd(e.currentTarget); } }, "+") : null);
}

// the pop-up with the 5 choices
let pop = null;
export function openReactPicker(anchor, m, me, onPick) {
  closeReactPicker();
  const r = anchor.getBoundingClientRect();
  pop = el("div", { class: "react-pop" }, REACTIONS.map(x =>
    el("button", { type: "button", class: hasReacted(m, me, x.key) ? "on" : "", title: x.label,
      onclick: e => { e.stopPropagation(); onPick(x.key); closeReactPicker(); } }, x.emoji)));
  document.body.append(pop);
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px";
  pop.style.top = (r.top - h - 6 < 8 ? r.bottom + 6 : r.top - h - 6) + "px";
  setTimeout(() => {
    addEventListener("pointerdown", outside, true);
    addEventListener("keydown", esc, true);
  });
}
function outside(e) { if (pop && !pop.contains(e.target)) closeReactPicker(); }
function esc(e) { if (e.key === "Escape") { e.stopPropagation(); closeReactPicker(); } }
export function closeReactPicker() {
  pop?.remove(); pop = null;
  removeEventListener("pointerdown", outside, true);
  removeEventListener("keydown", esc, true);
}
