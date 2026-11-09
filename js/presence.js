import { db, el, toast } from "./firebase.js";
import { contextMenu, openModal } from "./ui.js";
import { collection, doc, onSnapshot, setDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Online / Idle / Do Not Disturb / Invisible + "what I'm working on".
// To keep the free database quota happy we only save when something changes, plus a check-in
// every 8 minutes. Someone who hasn't checked in for 12 minutes counts as offline.
const BEAT = 8 * 60_000, STALE = 12 * 60_000, IDLE_AFTER = 5 * 60_000;

export const STATES = {
  online: { label: "Online", color: "#22c55e", icon: "🟢" },
  idle: { label: "Idle", color: "#f59e0b", icon: "🌙" },
  dnd: { label: "Do Not Disturb", color: "#ef4444", icon: "⛔", sub: "You won't get pop-ups or sounds" },
  invisible: { label: "Invisible", color: "#80848e", icon: "⚫", sub: "You'll look offline, but can still chat" },
  offline: { label: "Offline", color: "#80848e", icon: "⚫" }
};
// "Playing PolyTrack" (set automatically by the Games hub) or a custom status you type.
export const APPS = {
  gaming: { label: "a game", icon: "🎮", verb: "Playing" },
  custom: { label: "", icon: "💬", verb: "" }
};

export const presence = new Map(); // uid -> doc
let me = null, choice = "online", activity = null, idle = false, lastInput = Date.now(), beatTimer = null, onChange = () => {};
try { choice = localStorage.getItem("myStatus") || "online"; if (!STATES[choice] || choice === "offline") choice = "online"; } catch {}

// what other people see for uid
export function statusOf(uid) {
  const p = presence.get(uid);
  if (!p || p.gone) return { state: "offline", activity: null };
  const at = p.at?.toMillis?.() ?? 0;
  if (Date.now() - at > STALE) return { state: "offline", activity: null };
  const act = p.activity && (Date.now() - (p.activity.since?.toMillis?.() ?? 0) < 4 * 3600_000) ? p.activity : null;
  return { state: p.state === "dnd" ? "dnd" : p.idle ? "idle" : "online", activity: act };
}
export const myChoice = () => choice;
export const isDnd = () => choice === "dnd";
export const myActivity = () => activity;

export function activityText(a) {
  if (!a) return "";
  const app = APPS[a.app] || APPS.custom;
  if (a.app === "gaming") return "Playing " + (a.text || "a game");
  return a.app === "custom" ? a.text : `${app.verb} ${app.label}`;
}
export const activityIcon = a => (APPS[a?.app] || APPS.custom).icon;

// a little colored dot to put on an avatar
export function statusDot(uid, { mine = false } = {}) {
  const s = mine ? (choice === "invisible" ? "invisible" : choice === "dnd" ? "dnd" : idle ? "idle" : "online") : statusOf(uid).state;
  return el("span", { class: "st-dot st-" + s, title: STATES[s].label });
}
export function withStatus(avatarEl, uid, opts) {
  return el("span", { class: "av-wrap" }, avatarEl, statusDot(uid, opts));
}

// ---------- my own presence ----------
async function save(extra = {}) {
  if (!me) return;
  try {
    await setDoc(doc(db, "presence", me), {
      state: choice === "dnd" ? "dnd" : "online", idle, gone: choice === "invisible",
      activity: choice === "invisible" ? null : activity, at: serverTimestamp(), ...extra
    });
  } catch {}
}
export function startPresence(uid, changed = () => {}) {
  me = uid; onChange = changed;
  try { const a = JSON.parse(localStorage.getItem("myActivity") || "null"); if (a && a.app === "custom" && Date.now() - a.since < 4 * 3600_000) activity = { app: a.app, text: a.text || "", since: Timestamp.fromMillis(a.since) }; } catch {}
  save();
  beatTimer = setInterval(() => { checkIdle(); save(); }, BEAT);
  const bump = () => { lastInput = Date.now(); if (idle) { idle = false; save(); onChange(); } };
  ["pointerdown", "keydown", "mousemove", "touchstart", "wheel"].forEach(t => addEventListener(t, bump, { passive: true }));
  setInterval(() => { checkIdle(); onChange(); }, 60_000); // also re-checks who went stale
  addEventListener("pagehide", () => { if (choice !== "invisible") setDoc(doc(db, "presence", me), { state: "online", idle, gone: true, activity: null, at: serverTimestamp() }).catch(() => {}); });
  addEventListener("pageshow", e => { if (e.persisted) save(); });
  const unsub = onSnapshot(collection(db, "presence"), s => { presence.clear(); s.forEach(d => presence.set(d.id, d.data({ serverTimestamps: "estimate" }))); onChange(); }, () => {});
  return () => { unsub(); clearInterval(beatTimer); };
}
function checkIdle() {
  const now = Date.now() - lastInput > IDLE_AFTER;
  if (now !== idle) { idle = now; save(); }
}
export function setChoice(c) {
  choice = c; try { localStorage.setItem("myStatus", c); } catch {}
  save(); onChange();
}
let beforeGame = null;
export function setPlaying(name) {
  if (name) { if (activity?.app !== "gaming") beforeGame = activity; setActivity("gaming", name); }
  else if (activity?.app === "gaming") { const b = beforeGame; beforeGame = null; b ? setActivity(b.app, b.text) : setActivity(null); }
}
export function setActivity(app, text = "") {
  activity = app ? { app, text: String(text).slice(0, 60), since: Timestamp.now() } : null;
  try { localStorage.setItem("myActivity", JSON.stringify(activity ? { app, text: activity.text, since: Date.now() } : null)); } catch {}
  save(); onChange();
}

// ---------- the status menu (click your avatar) ----------
export function openStatusMenu(x, y, { findBlocked = () => null } = {}) {
  const items = ["online", "idle", "dnd", "invisible"].map(k => ({
    label: `${STATES[k].icon}  ${STATES[k].label}${k === choice ? "  ✓" : ""}`, onClick: () => setChoice(k)
  }));
  items.push("sep");
  items.push({ label: "✏️  Custom status…", onClick: () => customStatus(findBlocked) });
  if (activity?.app === "custom") items.push({ label: "✕  Clear custom status", onClick: () => setActivity(null) });
  contextMenu(x, y, items);
}
function customStatus(findBlocked) {
  const input = el("input", { class: "input", maxLength: 60, placeholder: "e.g. studying for the bio test", value: activity?.app === "custom" ? activity.text : "" });
  openModal("✏️ Custom status", el("div", { class: "form" }, input, el("p", { class: "muted", style: { fontSize: "12px" } }, "Shows on your profile and next to your name for up to 4 hours.")), [
    { label: "Cancel" },
    { label: "Save", kind: "primary", onClick: () => {
      const t = input.value.trim();
      if (!t) { setActivity(null); return; }
      if (findBlocked(t)) { toast("🚫 That has a blocked word."); return false; }
      setActivity("custom", t);
    } }
  ]);
  setTimeout(() => input.focus(), 50);
}
