import { db, el, avatar, modBadge, banActive, banText, toast, COLORS, levelFromXp } from "./firebase.js";
import { profileCard } from "./settings.js";
import { doc, getDoc, getDocs, updateDoc, setDoc, deleteDoc, collection, query, where, writeBatch, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- modal ----------
export function openModal(title, body, buttons = [{ label: "Close" }]) {
  const overlay = el("div", { class: "overlay" });
  const onKey = e => { if (e.key === "Escape") close(); };
  function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
  document.addEventListener("keydown", onKey);

  const row = el("div", { class: "modal-actions" }, buttons.map(b => {
    const btn = el("button", { class: "btn " + (b.kind || "ghost"), type: "button" }, b.label);
    btn.onclick = async () => {
      if (b.onClick) {
        btn.disabled = true;
        try { if ((await b.onClick()) === false) { btn.disabled = false; return; } }
        catch (e) { toast(e.message || String(e)); btn.disabled = false; return; }
      }
      close();
    };
    return btn;
  }));
  overlay.append(el("div", { class: "modal" }, el("h2", {}, title), body, row));
  overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  overlay.querySelector("input, textarea")?.focus();
  return { close };
}

// ---------- right-click menu ----------
let openMenu = null;
export function contextMenu(x, y, items) {
  openMenu?.remove();
  const menu = el("div", { class: "ctx" }, items.map(it => it === "sep"
    ? el("div", { class: "ctx-sep" })
    : el("button", { class: "ctx-item" + (it.danger ? " danger" : ""), type: "button",
        onclick: () => { menu.remove(); openMenu = null; it.onClick(); } }, it.label)));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  openMenu = menu;
}
const closeMenu = () => { openMenu?.remove(); openMenu = null; };
addEventListener("mousedown", e => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
addEventListener("blur", closeMenu);

// ---------- color picker ----------
export function colorPicker(initial) {
  let value = (initial || COLORS[0]).toLowerCase();
  const api = { onChange: null, get value() { return value; } };
  const swatches = COLORS.map(c => el("button", { type: "button", class: "swatch", title: c,
    style: { background: c }, onclick: () => set(c) }));
  const custom = el("input", { type: "color", value, oninput: e => set(e.target.value) });
  api.root = el("div", { class: "color-picker" }, swatches,
    el("label", { class: "swatch custom", title: "Custom color" }, "+", custom));
  function set(c) {
    value = c.toLowerCase();
    swatches.forEach((s, i) => s.classList.toggle("sel", COLORS[i].toLowerCase() === value));
    custom.value = value;
    api.onChange?.(value);
  }
  set(value);
  return api;
}

// ---------- mod actions ----------
const emailCache = new Map();
export async function getEmail(uid) {
  if (emailCache.has(uid)) return emailCache.get(uid);
  try {
    const s = await getDoc(doc(db, "privateInfo", uid));
    const e = s.exists() ? s.data().email : "(no email on file)";
    emailCache.set(uid, e);
    return e;
  } catch { return "(hidden)"; }
}

export function renameUser(uid, u) {
  const input = el("input", { class: "input", value: u.name || "", maxlength: 24 });
  openModal("Rename user", el("div", { class: "form" },
    el("label", { class: "lbl" }, "New name for ", el("b", { style: { color: u.nameColor } }, u.name)),
    input), [
    { label: "Cancel" },
    { label: "Save", kind: "primary", onClick: async () => {
      const name = input.value.trim();
      if (name.length < 1 || name.length > 24) { toast("Name must be 1–24 characters."); return false; }
      await updateDoc(doc(db, "users", uid), { name });
      toast("Renamed to " + name);
    } }
  ]);
}

export function banUser(uid, u, myUid) {
  const tempRadio = el("input", { type: "radio", name: "bantype", checked: true });
  const permRadio = el("input", { type: "radio", name: "bantype" });
  const dur = el("select", { class: "input" },
    [["1", "1 hour"], ["6", "6 hours"], ["24", "1 day"], ["72", "3 days"], ["168", "1 week"],
     ["720", "30 days"], ["custom", "Custom…"]].map(([v, t]) => el("option", { value: v }, t)));
  const customHours = el("input", { class: "input", type: "number", min: 1, placeholder: "Hours", hidden: true });
  const durRow = el("div", { class: "row" }, dur, customHours);
  const reason = el("textarea", { class: "input", rows: 3, maxlength: 300, placeholder: "Reason (shown to the user)" });
  const sync = () => {
    durRow.hidden = permRadio.checked;
    customHours.hidden = dur.value !== "custom";
  };
  [tempRadio, permRadio, dur].forEach(x => x.addEventListener("change", sync));

  openModal("Ban user", el("div", { class: "form" },
    el("p", { class: "muted" }, "Banning ", el("b", { style: { color: u.nameColor } }, u.name)),
    el("div", { class: "seg" },
      el("label", {}, tempRadio, " Temporary"),
      el("label", {}, permRadio, " Permanent")),
    durRow,
    el("label", { class: "lbl" }, "Reason"), reason), [
    { label: "Cancel" },
    { label: "Ban", kind: "danger", onClick: async () => {
      const r = reason.value.trim();
      if (!r) { toast("Please give a reason."); return false; }
      const perm = permRadio.checked;
      let hours = dur.value === "custom" ? Number(customHours.value) : Number(dur.value);
      if (!perm && !(hours > 0)) { toast("Enter how many hours."); return false; }
      await updateDoc(doc(db, "users", uid), {
        banned: true,
        banPermanent: perm,
        banUntil: perm ? null : Timestamp.fromMillis(Date.now() + hours * 3600e3),
        banReason: r,
        bannedBy: myUid,
        bannedAt: serverTimestamp()
      });
      toast(u.name + " was banned " + (perm ? "permanently" : "for " + dur.selectedOptions[0].text.replace("Custom…", hours + " hours")));
    } }
  ]);
}

export async function unbanUser(uid, u) {
  await updateDoc(doc(db, "users", uid), { banned: false, banPermanent: false, banUntil: null, banReason: "" });
  toast(u.name + " was unbanned");
}

export async function setApproved(uid, approved) {
  await updateDoc(doc(db, "users", uid), { approved, rejected: !approved });
}

export function showProfile(uid, u, { viewerIsMod, targetIsMod, onMessage, extra, status, badge } = {}) {
  if (!u) return;
  const joined = u.createdAt?.toMillis ? new Date(u.createdAt.toMillis()).toLocaleDateString() : "";
  const info = el("div", { class: "profile-info" });
  if (viewerIsMod) {
    const emailEl = el("div", { class: "muted" }, "Loading email…");
    getEmail(uid).then(e => { emailEl.textContent = e; });
    info.append(emailEl);
    if (banActive(u)) info.append(el("div", { class: "chip danger" }, "Banned " + banText(u) + " — " + (u.banReason || "")));
    else if (!u.approved && !targetIsMod) info.append(el("div", { class: "chip" }, "Not approved"));
  }
  const xp = el("div", { class: "profile-xp" },
    el("div", { class: "profile-xp-top" }, el("b", {}, "Level " + levelFromXp(u.xp)), el("span", { class: "muted" }, `${u.xp || 0} XP total`)),
    el("div", { class: "m-bar" }, el("div", { class: "m-bar-fill", style: { width: ((u.xp || 0) % 20) / 20 * 100 + "%" } })),
    el("div", { class: "muted", style: { fontSize: "12px" } }, `${20 - (u.xp || 0) % 20} XP to level ${levelFromXp(u.xp) + 1}`));
  const stats = el("div", { class: "pf-stats" },
    el("div", {}, el("b", {}, "Lv " + levelFromXp(u.xp)), el("span", {}, "Level")),
    el("div", {}, el("b", {}, String(u.xp || 0)), el("span", {}, "XP")),
    el("div", {}, el("b", {}, joined ? new Date(u.createdAt.toMillis()).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—"), el("span", {}, "Joined")));
  const body = el("div", { class: "profile" },
    profileCard(u, { badge: badge || (targetIsMod ? modBadge() : null), after: el("div", { class: "pf-extra" },
      status || null, stats, xp, extra || null, info) }));
  const buttons = [{ label: "Close" }];
  if (onMessage) buttons.push({ label: "Send message", kind: "primary", onClick: onMessage });
  openModal("", body, buttons);
}


// ---------- timeouts ----------
export function timeoutActive(u) {
  const ms = u?.timeoutUntil?.toMillis?.();
  return !!ms && ms > Date.now();
}
export function timeoutLeft(u) {
  const s = Math.max(0, Math.ceil(((u?.timeoutUntil?.toMillis?.() ?? 0) - Date.now()) / 1000));
  if (s >= 3600) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
  if (s >= 60) return Math.floor(s / 60) + "m " + (s % 60) + "s";
  return s + "s";
}

export function timeoutUser(uid, u, myUid) {
  const amount = el("input", { class: "input", type: "number", min: 1, value: 60, style: { flex: 1 } });
  const unit = el("select", { class: "input", style: { flex: 1 } },
    [["1", "seconds"], ["60", "minutes"], ["3600", "hours"]].map(([v, t]) => el("option", { value: v }, t)));
  const quick = [[30, "30s"], [60, "1m"], [300, "5m"], [600, "10m"], [3600, "1h"]].map(([sec, t]) =>
    el("button", { type: "button", class: "pill", onclick: () => { amount.value = sec; unit.value = "1"; } }, t));
  const reason = el("input", { class: "input", maxlength: 300, placeholder: "Reason (optional, shown to them)" });
  openModal("Timeout user", el("div", { class: "form" },
    el("p", { class: "muted" }, el("b", { style: { color: u.nameColor } }, u.name), " can still read chat but can't send anything until it runs out."),
    el("div", { class: "row", style: { flexWrap: "wrap", marginBottom: "8px" } }, quick),
    el("div", { class: "row" }, amount, unit),
    el("label", { class: "lbl" }, "Reason"), reason), [
    { label: "Cancel" },
    { label: "Timeout", kind: "danger", onClick: async () => {
      const secs = Number(amount.value) * Number(unit.value);
      if (!(secs >= 1)) { toast("Enter a time."); return false; }
      await updateDoc(doc(db, "users", uid), {
        timeoutUntil: Timestamp.fromMillis(Date.now() + secs * 1000),
        timeoutReason: reason.value.trim(), timeoutBy: myUid
      });
      toast(`${u.name} timed out for ${amount.value} ${unit.selectedOptions[0].text}`);
    } }
  ]);
}
export async function clearTimeoutUser(uid, u) {
  await updateDoc(doc(db, "users", uid), { timeoutUntil: null, timeoutReason: "" });
  toast(u.name + "'s timeout removed");
}

// ---------- bulk delete (#global + channels) ----------
export function bulkDelete(uid, u, channels = null) {
  const range = el("select", { class: "input" },
    [["300", "Last 5 minutes"], ["3600", "Last hour"], ["86400", "Last 24 hours"], ["604800", "Last 7 days"], ["all", "All of their messages"]]
      .map(([v, t]) => el("option", { value: v }, t)));
  const info = el("p", { class: "muted" }, "Counting…");
  let msgs = [];
  (async () => {
    const chans = channels ?? (await getDocs(collection(db, "channels")).then(s => s.docs.map(d => ({ id: d.id }))).catch(() => []));
    const cols = [collection(db, "rooms", "global", "messages"), ...chans.map(c => collection(db, "channels", c.id, "messages"))];
    const all = await Promise.all(cols.map(c => getDocs(query(c, where("uid", "==", uid))).then(s => s.docs).catch(() => [])));
    msgs = all.flat(); update();
  })();
  const pickList = () => {
    if (range.value === "all") return msgs;
    const cutoff = Date.now() - Number(range.value) * 1000;
    return msgs.filter(d => (d.data().createdAt?.toMillis?.() ?? Date.now()) >= cutoff);
  };
  const update = () => { info.textContent = `${pickList().length} message(s) from ${u.name} will be deleted.`; };
  range.onchange = update;
  openModal("Delete messages", el("div", { class: "form" },
    el("p", {}, "Delete ", el("b", { style: { color: u.nameColor } }, u.name), "'s messages in #global and all channels (DMs aren't touched)."),
    range, info), [
    { label: "Cancel" },
    { label: "Delete", kind: "danger", onClick: async () => {
      const list = pickList();
      if (!list.length) { toast("Nothing to delete."); return false; }
      for (let i = 0; i < list.length; i += 400) {
        const b = writeBatch(db);
        list.slice(i, i + 400).forEach(d => b.delete(d.ref));
        await b.commit();
      }
      toast(`Deleted ${list.length} message(s)`);
    } }
  ]);
}

// ---------- GIF bans ----------
export async function banGif(m, myUid) {
  await setDoc(doc(db, "bannedGifs", m.gifKey), { url: m.gif, by: myUid, at: serverTimestamp() });
  toast("GIF banned everywhere");
}
export async function unbanGif(key) {
  await deleteDoc(doc(db, "bannedGifs", key));
  toast("GIF unbanned");
}
