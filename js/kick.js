import { db, el, toast } from "./firebase.js";
import { openModal } from "./ui.js";
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 👢 Kick: a mod writes kicks/{uid}. Every open tab of that person sees the change and closes itself.
// The site normally runs in an about:blank tab opened by the site, which the browser lets us close.
// If the browser won't close it (e.g. they opened the site with ?direct), the tab goes to Google instead.

export function watchKick(uid) {
  let baseline;          // the kick that already existed when this page opened (ignored)
  return onSnapshot(doc(db, "kicks", uid), s => {
    if (s.metadata?.hasPendingWrites) return;
    const at = s.exists() ? s.data().at?.toMillis?.() ?? 0 : 0;
    if (baseline === undefined) { baseline = at; return; }
    if (at && at !== baseline) { baseline = at; closeSite(s.data().reason || ""); }
  }, () => {});
}

export function closeSite(reason = "") {
  try { localStorage.setItem("kickedMsg", JSON.stringify({ reason, at: Date.now() })); } catch {}
  let top = window;
  try { top = window.top; void top.location.href; } catch { top = window; }
  try { top.close(); } catch {}
  try { window.close(); } catch {}
  // still here → the browser didn't allow closing
  setTimeout(() => {
    try { top.location.replace("https://www.google.com"); } catch { location.replace("https://www.google.com"); }
  }, 250);
}

// shown the next time they open the chat
export function showKickedNotice() {
  let k = null;
  try { k = JSON.parse(localStorage.getItem("kickedMsg") || "null"); localStorage.removeItem("kickedMsg"); } catch {}
  if (!k || Date.now() - k.at > 7 * 86400_000) return;
  openModal("👢 You were kicked", el("div", {},
    el("p", {}, "A mod kicked you off the site."),
    k.reason ? el("p", {}, el("b", {}, "Reason: "), k.reason) : null), [{ label: "OK", kind: "primary" }]);
}

// the mod's side: confirm, then kick
export function kickUser(uid, name, { me, online = true, findBlocked = () => null } = {}) {
  const reason = el("input", { class: "input", maxLength: 200, placeholder: "Reason (optional) — they'll see it next time they open the site" });
  openModal(`👢 Kick ${name}?`, el("div", { class: "form" },
    el("p", { style: { marginTop: 0 } }, "Their site tab closes right away. They can come back — use Timeout or Ban to keep them out."),
    online ? null : el("p", { class: "muted", style: { fontSize: "12px" } }, `⚠️ ${name} doesn't look online right now, so there may be nothing to close.`),
    reason), [
    { label: "Cancel" },
    { label: "Kick", kind: "danger", onClick: async () => {
      const r = reason.value.trim();
      if (findBlocked(r)) { toast("🚫 The reason has a blocked word."); return false; }
      try { await setDoc(doc(db, "kicks", uid), { by: me, at: serverTimestamp(), reason: r }); }
      catch (err) { toast(err.code === "permission-denied" ? "You can't kick mods or owners." : "Couldn't kick: " + (err.code || err.message)); return false; }
      toast(`👢 Kicked ${name}`);
    } }
  ]);
}
