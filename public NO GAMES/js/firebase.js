import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAuth, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===== PASTE YOUR CONFIG HERE =====
// Firebase console → Project settings → General → Your apps → Web app → SDK setup and configuration
export const firebaseConfig = {
  apiKey: "AIzaSyDbx9CIaPfPoagoXXLJ1FhAH0Gjc2h2k4A",
  authDomain: "sussy-study-edu.firebaseapp.com",
  projectId: "sussy-study-edu",
  storageBucket: "sussy-study-edu.firebasestorage.app",
  messagingSenderId: "892933472794",
  appId: "1:892933472794:web:c7ab6b3491cae9c3e107a3"
};

export const app = initializeApp(firebaseConfig);
// "Session" login: you stay logged in while the tab is open (moving between pages,
// refreshing), but opening the site fresh means typing your password again.
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
export const db = getFirestore(app);

// The access code has to be entered once per visit too (also per tab).
const codeKey = uid => "codeOk_" + uid;
// The database only accepts a code for 12 hours, so the site asks again a bit before that.
const CODE_MS = 11.5 * 3600e3;
export function codeOkThisVisit(uid) {
  try { const t = Number(sessionStorage.getItem(codeKey(uid)) || 0); return t > 1 && Date.now() - t < CODE_MS; } catch { return false; }
}
export function markCodeOk(uid) { try { sessionStorage.setItem(codeKey(uid), String(Date.now())); } catch {} }
export function clearCodeOk(uid) { try { sessionStorage.removeItem(codeKey(uid)); } catch {} }

export const COLORS = ["#5865f2", "#3ba55d", "#faa61a", "#ed4245", "#eb459e", "#00b0f4",
                       "#9b59b6", "#1abc9c", "#e67e22", "#f1c40f", "#ffffff", "#95a5a6"];

export function banActive(u) {
  if (!u || !u.banned) return false;
  if (u.banPermanent) return true;
  const until = u.banUntil?.toMillis?.() ?? 0;
  return until > Date.now();
}

export function canChat(u, isMod) {
  return !!(isMod || (u && u.codeVerified && u.approved && !banActive(u)));
}

export function banText(u) {
  if (u.banPermanent) return "permanently";
  const ms = u.banUntil?.toMillis?.();
  return ms ? "until " + new Date(ms).toLocaleString() : "";
}

export function dmIdFor(a, b) { return [a, b].sort().join("_"); }

// Tiny DOM builder. Text is always inserted as text, never as HTML.
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k in n && !k.includes("-")) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : String(c));
  }
  return n;
}

export function avatar(u, size = 36) {
  const name = (u && u.name) || "?";
  const wrap = el("div", {
    class: "avatar",
    style: { width: size + "px", height: size + "px", background: (u && u.nameColor) || "#5865f2",
             fontSize: Math.round(size * 0.45) + "px" }
  }, name[0].toUpperCase());
  if (u && u.photoURL && /^https?:\/\//.test(u.photoURL)) {
    const img = el("img", { src: u.photoURL, alt: "", referrerPolicy: "no-referrer" });
    img.onerror = () => img.remove();
    wrap.append(img);
  }
  return wrap;
}

export function modBadge() { return el("span", { class: "badge" }, "MOD"); }

export function fmtTime(ms) {
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: !window.__clock24 });
  return d.toDateString() === now.toDateString() ? "Today at " + time : d.toLocaleDateString() + " " + time;
}

export function toast(text) {
  let box = document.getElementById("toasts");
  if (!box) { box = el("div", { id: "toasts" }); document.body.append(box); }
  const t = el("div", { class: "toast" }, text);
  box.append(t);
  setTimeout(() => t.remove(), 3500);
}

// ---------- XP / levels (20 XP = 1 level) ----------
export const levelFromXp = xp => Math.floor((xp || 0) / 20) + 1;
export function levelBadge(u) {
  const lv = levelFromXp(u?.xp);
  return el("span", { class: "lvl-badge" + (lv >= 10 ? " high" : lv >= 5 ? " mid" : ""), title: `Level ${lv} · ${u?.xp || 0} XP` }, "Lv " + lv);
}
