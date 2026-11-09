import { db, el, avatar, toast } from "./firebase.js";
import { openModal } from "./ui.js";
import {
  collection, doc, query, where, onSnapshot, writeBatch, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 💡 Suggestions: anyone can send one; only mods (and owners) can see everyone's.
// You can always see your own and whether a mod marked it Planned / Done / Not doing.
export const CATS = {
  idea: "💡 Idea", game: "🎮 Game request", music: "🎵 Song request", bug: "🐞 Bug", other: "💬 Other"
};
export const STATUS = {
  new: { label: "New", icon: "🆕", cls: "" },
  planned: { label: "Planned", icon: "👍", cls: "ok" },
  done: { label: "Done", icon: "✅", cls: "ok" },
  declined: { label: "Not doing", icon: "✕", cls: "danger" }
};
const COOLDOWN = 30; // seconds between suggestions (the database rules enforce it too)

let list = [], unsub = null;
const subs = new Set();
const emit = () => subs.forEach(f => f());

// mod = true → everyone's suggestions, otherwise just mine
export function watchSuggestions(me, mod, onCount = () => {}) {
  unsub?.();
  const q = mod ? collection(db, "suggestions") : query(collection(db, "suggestions"), where("uid", "==", me));
  unsub = onSnapshot(q, s => {
    list = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    onCount(mod ? list.filter(x => x.status === "new").length : 0);
    emit();
  }, () => { list = []; onCount(0); emit(); });
  return () => { unsub?.(); unsub = null; };
}

const ago = ts => {
  const t = ts?.toMillis?.(); if (!t) return "";
  const s = (Date.now() - t) / 1000;
  return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago"
    : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

// ctx: { me, isMod, lookup, findBlocked, onProfile }
export function openSuggestions(ctx) {
  if (document.querySelector(".suggest-page")) return;
  const mod = ctx.isMod();
  let filter = mod ? "new" : "all", cat = "", q = "";

  // ---- the form ----
  const text = el("textarea", { class: "input", rows: 3, maxLength: 1000, placeholder: "What should we add or change? Be specific 🙂" });
  const catSel = el("select", { class: "input sg-cat" }, Object.entries(CATS).map(([k, v]) => el("option", { value: k }, v)));
  const count = el("span", { class: "muted sg-count" }, "0 / 1000");
  text.oninput = () => { count.textContent = `${text.value.length} / 1000`; };
  const send = el("button", { class: "btn primary", type: "button", onclick: submit }, "Send suggestion");
  text.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } };
  async function submit() {
    const t = text.value.trim();
    if (t.length < 3) { toast("Write a bit more first."); return; }
    const bad = ctx.findBlocked?.(t); if (bad) { toast(`🚫 “${bad}” is a blocked word.`); return; }
    let last = 0; try { last = +localStorage.getItem("lastSuggest") || 0; } catch {}
    const wait = Math.ceil(COOLDOWN - (Date.now() - last) / 1000);
    if (wait > 0) { toast(`Wait ${wait}s before sending another.`); return; }
    send.disabled = true;
    try {
      const b = writeBatch(db);
      b.set(doc(db, "suggestLimits", ctx.me), { at: serverTimestamp() });
      b.set(doc(collection(db, "suggestions")), { uid: ctx.me, text: t, category: catSel.value, status: "new", createdAt: serverTimestamp() });
      await b.commit();
      try { localStorage.setItem("lastSuggest", Date.now()); } catch {}
      text.value = ""; count.textContent = "0 / 1000";
      toast("💡 Thanks! The mods will see it.");
    } catch (err) {
      toast(err.code === "permission-denied" ? "Couldn't send — wait 30 seconds between suggestions." : "Couldn't send: " + (err.code || err.message));
    }
    send.disabled = false;
  }

  const listBox = el("div", { class: "sg-list" });
  const tools = el("div", { class: "sg-tools" });
  const overlay = el("div", { class: "game-overlay suggest-page" },
    el("div", { class: "game-bar" },
      el("div", { class: "game-title" }, "💡 Suggestions"),
      el("button", { class: "btn sm", onclick: () => close() }, "✕ Close")),
    el("div", { class: "movies-body" }, el("div", { class: "sg-wrap" },
      el("div", { class: "sg-form" },
        el("h2", {}, "Got an idea?"),
        el("p", { class: "muted" }, mod ? "Send one yourself, or go through what people sent below." : "Suggest a feature, a game, a song or report a bug. Only the mods can read these."),
        text, el("div", { class: "sg-row" }, catSel, count, send)),
      el("h3", { class: "sg-head" }, mod ? "Everyone's suggestions" : "Your suggestions"),
      tools, listBox)));
  document.body.append(overlay);
  setTimeout(() => text.focus(), 30);
  const onKey = e => { if (e.key === "Escape" && !document.querySelector(".overlay")) close(); };
  document.addEventListener("keydown", onKey);
  subs.add(draw);
  function close() { subs.delete(draw); overlay.remove(); document.removeEventListener("keydown", onKey); }

  function draw() {
    const counts = Object.fromEntries(Object.keys(STATUS).map(k => [k, list.filter(x => x.status === k).length]));
    if (mod) {
      const search = el("input", { class: "input sg-search", type: "search", placeholder: "🔎 Search", value: q });
      search.oninput = () => { q = search.value.toLowerCase(); drawList(); };
      tools.replaceChildren(
        el("div", { class: "explore-sorts" },
          [["new", "🆕 New"], ["planned", "👍 Planned"], ["done", "✅ Done"], ["declined", "✕ Not doing"], ["all", "All"]].map(([k, l]) =>
            el("button", { type: "button", class: "pill" + (filter === k ? " sel" : ""), onclick: () => { filter = k; draw(); } },
              l, " ", el("span", { class: "muted" }, k === "all" ? list.length : counts[k])))),
        el("select", { class: "input sg-cat", onchange: e => { cat = e.target.value; drawList(); } },
          el("option", { value: "" }, "All types"), Object.entries(CATS).map(([k, v]) => el("option", { value: k, selected: k === cat }, v))),
        search);
    } else tools.replaceChildren();
    drawList();
  }
  function drawList() {
    const shown = list.filter(s => (filter === "all" || s.status === filter) && (!cat || s.category === cat)
      && (!q || s.text.toLowerCase().includes(q) || (ctx.lookup(s.uid).name || "").toLowerCase().includes(q)));
    if (!shown.length) {
      listBox.replaceChildren(el("div", { class: "empty" }, mod ? (filter === "new" ? "No new suggestions 🎉" : "Nothing here.") : "You haven't sent any yet."));
      return;
    }
    listBox.replaceChildren(...shown.map(s => card(s)));
  }
  function card(s) {
    const u = ctx.lookup(s.uid), st = STATUS[s.status] || STATUS.new;
    const by = s.handledBy ? ctx.lookup(s.handledBy).name : null;
    return el("div", { class: "sg-card sg-" + s.status },
      el("div", { class: "sg-top" },
        mod ? el("button", { class: "sg-who", type: "button", onclick: () => ctx.onProfile?.(s.uid) }, avatar(u, 26), el("b", { style: { color: u.nameColor } }, u.name)) : null,
        el("span", { class: "chip" }, CATS[s.category] || CATS.other),
        el("span", { class: "chip " + st.cls }, st.icon + " " + st.label),
        el("span", { class: "muted grow" }, ago(s.createdAt))),
      el("div", { class: "sg-text" }, s.text),
      s.note ? el("div", { class: "sg-note" }, el("b", {}, "Mod reply" + (mod && by ? ` (${by})` : "") + ": "), s.note) : null,
      mod ? el("div", { class: "sg-actions" },
        Object.entries(STATUS).filter(([k]) => k !== s.status).map(([k, v]) =>
          el("button", { class: "btn sm" + (k === "declined" ? " danger" : k === "new" ? "" : " ok"), type: "button", onclick: () => setStatus(s, k) }, v.icon + " " + (k === "new" ? "Mark new" : v.label))),
        el("button", { class: "btn sm", type: "button", onclick: () => reply(s) }, s.note ? "✏️ Edit reply" : "💬 Reply"),
        el("button", { class: "btn sm danger", type: "button", onclick: () => remove(s) }, "🗑 Delete"))
      : s.status === "new" ? el("div", { class: "sg-actions" }, el("button", { class: "btn sm", type: "button", onclick: () => remove(s) }, "Take back")) : null);
  }
  async function setStatus(s, status) {
    try { await updateDoc(doc(db, "suggestions", s.id), { status, handledBy: ctx.me, updatedAt: serverTimestamp() }); }
    catch (err) { toast("Couldn't update: " + (err.code || err.message)); }
  }
  function reply(s) {
    const input = el("textarea", { class: "input", rows: 3, maxLength: 300, placeholder: "They'll see this under their suggestion" }, s.note || "");
    openModal("💬 Reply to suggestion", el("div", { class: "form" }, el("p", { class: "muted", style: { marginTop: 0 } }, s.text.slice(0, 200)), input), [
      { label: "Cancel" },
      { label: "Save", kind: "primary", onClick: async () => {
        const n = input.value.trim();
        if (ctx.findBlocked?.(n)) { toast("🚫 That has a blocked word."); return false; }
        await updateDoc(doc(db, "suggestions", s.id), { note: n, handledBy: ctx.me, updatedAt: serverTimestamp() });
      } }
    ]);
  }
  function remove(s) {
    openModal(mod ? "Delete suggestion?" : "Take back your suggestion?", el("p", {}, s.text.slice(0, 200)), [
      { label: "Cancel" },
      { label: "Delete", kind: "danger", onClick: () => deleteDoc(doc(db, "suggestions", s.id)) }
    ]);
  }
  draw();
}
