import { db, el } from "./firebase.js";
import { doc, updateDoc, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Tiny bar in the corner: every minute you're on the site (tab visible) = +1 XP.
// The database only accepts one of these per ~minute, so extra tabs can't speed it up.
// opts: { uid } for accounts, or { guest: true, onGuestXp() } for guests
export function startMinuteXp(opts) {
  const KEY = "minuteXpProgress";
  let secs = 0; try { secs = Number(sessionStorage.getItem(KEY) || 0) % 60; } catch {}
  const fill = el("div", { class: "mxp-fill" });
  const label = el("span", { class: "mxp-label" }, "+1 XP");
  const box = el("div", { class: "mxp", title: "Every minute you're here = +1 XP" }, el("span", { class: "mxp-icon" }, "⏱"), el("div", { class: "mxp-bar" }, fill), label);
  document.body.append(box);
  const draw = () => { fill.style.width = (secs / 60 * 100) + "%"; };
  draw();
  setInterval(async () => {
    if (document.hidden) return;
    secs++;
    if (secs >= 60) {
      secs = 0;
      let ok = true;
      if (opts.guest) opts.onGuestXp?.();
      else {
        try { await updateDoc(doc(db, "users", opts.uid), { xp: increment(1), lastMinXpAt: serverTimestamp() }); }
        catch { ok = false; } // another tab already got this minute's XP
      }
      if (ok) { box.classList.add("pop"); setTimeout(() => box.classList.remove("pop"), 900); }
    }
    try { sessionStorage.setItem(KEY, String(secs)); } catch {}
    draw();
  }, 1000);
}
