import { auth, db, el, avatar, modBadge, banActive, banText, toast, codeOkThisVisit } from "./firebase.js";
import { renameUser, banUser, unbanUser, setApproved, getEmail, contextMenu, timeoutUser, clearTimeoutUser, timeoutActive, timeoutLeft, bulkDelete, unbanGif } from "./ui.js";
import { watchWordFilter, wordFilterPane, filter as wordFilter, findBlocked } from "./wordfilter.js";
import { kickUser } from "./kick.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
let me = null;
const users = new Map();
const mods = new Set();
const emails = new Map();
const bannedGifs = new Map(); // key -> {url, by, at}
let tab = "pending";
let wfPane = null;

// ---------- gate: only mods (mods are set server-side in the "mods" collection) ----------
onAuthStateChanged(auth, async user => {
  if (!user || !codeOkThisVisit(user.uid)) return location.replace("signin.html?join");
  me = user;
  let ok = false, owner = false;
  try { ok = (await getDoc(doc(db, "mods", user.uid))).exists(); } catch {}
  try { owner = (await getDoc(doc(db, "owners", user.uid))).exists(); } catch {}
  if (!ok && !owner) return location.replace("chat.html");

  onSnapshot(collection(db, "mods"), s => {
    mods.clear(); s.forEach(d => mods.add(d.id));
    if (owner) mods.add(me.uid); // owners count as mods
    if (!mods.has(me.uid)) location.replace("chat.html");
    render();
  });
  watchWordFilter(() => { if (tab === "words") wfPane?.draw(); render(); });
  onSnapshot(collection(db, "bannedGifs"), s => {
    bannedGifs.clear(); s.forEach(d => bannedGifs.set(d.id, d.data()));
    render();
  }, () => {});
  onSnapshot(collection(db, "users"), s => {
    users.clear(); s.forEach(d => users.set(d.id, d.data()));
    for (const uid of users.keys()) if (!emails.has(uid)) {
      emails.set(uid, "");
      getEmail(uid).then(e => { emails.set(uid, e); render(); });
    }
    render();
    document.body.classList.remove("loading");
  }, err => toast("Can't load users: " + err.code));
});

// ---------- categories ----------
const TABS = [
  ["pending", "Needs approval", (id, u) => !mods.has(id) && u.codeVerified && !u.approved && !u.rejected],
  ["code", "No code yet", (id, u) => !mods.has(id) && !u.codeVerified && !u.rejected],
  ["members", "Members", (id, u) => mods.has(id) || (u.approved && !banActive(u))],
  ["banned", "Banned", (id, u) => banActive(u)],
  ["timeout", "Timed out", (id, u) => timeoutActive(u)],
  ["rejected", "Denied", (id, u) => !!u.rejected && !u.approved],
  ["all", "Everyone", () => true]
];
$("search").oninput = () => render();

function chipsFor(id, u) {
  const c = [];
  if (mods.has(id)) c.push(el("span", { class: "chip mod" }, "Mod"));
  if (banActive(u)) c.push(el("span", { class: "chip danger" }, "Banned " + banText(u)));
  if (timeoutActive(u)) c.push(el("span", { class: "chip warn" }, "⏱ Timed out · " + timeoutLeft(u) + " left"));
  else if (u.banned) c.push(el("span", { class: "chip" }, "Ban expired"));
  if (!mods.has(id)) {
    if (!u.codeVerified) c.push(el("span", { class: "chip warn" }, "No code"));
    else if (u.approved) c.push(el("span", { class: "chip ok" }, "Approved"));
    else if (u.rejected) c.push(el("span", { class: "chip danger" }, "Denied"));
    else c.push(el("span", { class: "chip warn" }, "Waiting"));
  }
  return c;
}

const act = (label, kind, fn) => el("button", { class: "btn sm " + kind, onclick: async () => {
  try { await fn(); } catch (err) { toast(err.message || String(err)); }
} }, label);

function actionsFor(id, u) {
  const a = [];
  const target = id !== me.uid && !mods.has(id);
  if (target && u.codeVerified && !u.approved) a.push(act("Approve", "ok", () => setApproved(id, true).then(() => toast(u.name + " approved"))));
  if (target && !u.approved && !u.rejected) a.push(act("Deny", "danger", () => setApproved(id, false).then(() => toast(u.name + " denied"))));
  if (target && u.approved) a.push(act("Revoke", "", () => setApproved(id, false).then(() => toast(u.name + "'s access revoked"))));
  a.push(act("Rename", "", () => renameUser(id, u)));
  if (target) {
    if (timeoutActive(u)) a.push(act("End timeout", "", () => clearTimeoutUser(id, u)));
    else a.push(act("Timeout", "", () => timeoutUser(id, u, me.uid)));
  }
  a.push(act("Delete msgs", "", () => bulkDelete(id, u)));
  if (target) a.push(act("👢 Kick", "", () => kickUser(id, u.name, { me: me.uid, findBlocked })));
  if (target) {
    if (banActive(u)) a.push(act("Unban", "", () => unbanUser(id, u)));
    else a.push(act("Ban", "danger", () => banUser(id, u, me.uid)));
  }
  return a;
}

function render() {
  if (!me) return;
  const q = $("search").value.trim().toLowerCase();
  const all = [...users.entries()];

  $("tabs").replaceChildren(...TABS.map(([key, label, fn]) => {
    const n = all.filter(([id, u]) => fn(id, u)).length;
    return el("button", { class: tab === key ? "active" : "", onclick: () => { tab = key; render(); } },
      label, (key === "pending" && n) ? el("span", { class: "count" }, n) : el("span", { class: "muted" }, " " + n));
  }), el("button", { class: tab === "gifs" ? "active" : "", onclick: () => { tab = "gifs"; render(); } },
      "Banned GIFs", el("span", { class: "muted" }, " " + bannedGifs.size)),
    el("button", { class: tab === "words" ? "active" : "", onclick: () => { tab = "words"; render(); } },
      "🚫 Blocked words", el("span", { class: "muted" }, " " + wordFilter.words.length)));
  $("search").hidden = tab === "gifs" || tab === "words";

  if (tab === "words") {
    if (!wfPane) wfPane = wordFilterPane(me.uid);
    if (!$("list").contains(wfPane.box)) $("list").replaceChildren(wfPane.box);
    wfPane.draw();
    return;
  }

  if (tab === "gifs") {
    const list = [...bannedGifs.entries()].sort((a, b) => (b[1].at?.toMillis?.() ?? 0) - (a[1].at?.toMillis?.() ?? 0));
    $("list").replaceChildren(...(list.length ? [el("div", { class: "gif-ban-grid" }, list.map(([key, g]) =>
      el("div", { class: "gif-ban" },
        el("button", { class: "gif-ban-img", title: "Click to reveal", onclick: e => e.currentTarget.classList.toggle("show") },
          el("img", { src: g.url, loading: "lazy", referrerPolicy: "no-referrer", alt: "" }), el("span", {}, "Hidden · click to view")),
        el("div", { class: "muted" }, "by " + (users.get(g.by)?.name || "?")),
        act("Unban GIF", "", () => unbanGif(key)))))]
      : [el("div", { class: "empty" }, "No banned GIFs. Right-click a GIF in chat → Ban this GIF.")]));
    return;
  }

  const filter = TABS.find(t => t[0] === tab)[2];
  const rows = all
    .filter(([id, u]) => filter(id, u))
    .filter(([id, u]) => !q || u.name.toLowerCase().includes(q) || (emails.get(id) || "").toLowerCase().includes(q))
    .sort((a, b) => (b[1].createdAt?.toMillis?.() ?? 0) - (a[1].createdAt?.toMillis?.() ?? 0));

  if (!rows.length) {
    $("list").replaceChildren(el("div", { class: "empty" }, tab === "pending" ? "Nobody is waiting for approval 🎉" : "Nobody here."));
    return;
  }
  $("list").replaceChildren(...rows.map(([id, u]) => {
    const joined = u.createdAt?.toMillis ? new Date(u.createdAt.toMillis()).toLocaleString() : "";
    const by = u.bannedBy ? users.get(u.bannedBy)?.name : null;
    return el("div", { class: "user-row", oncontextmenu: e => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: "Rename", onClick: () => renameUser(id, u) },
          ...(id !== me.uid && !mods.has(id)
            ? [banActive(u) ? { label: "Unban", onClick: () => unbanUser(id, u).catch(err => toast(err.message)) }
                            : { label: "Ban…", danger: true, onClick: () => banUser(id, u, me.uid) }] : []),
          { label: "Copy UID", onClick: () => navigator.clipboard.writeText(id).then(() => toast("UID copied")) }
        ]);
      } },
      avatar(u, 44),
      el("div", { class: "grow" },
        el("div", { class: "name", style: { color: u.nameColor } }, u.name, mods.has(id) ? modBadge() : null),
        el("div", { class: "muted" }, (emails.get(id) || "…") + (joined ? " · joined " + joined : "")),
        el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" } }, chipsFor(id, u)),
        banActive(u) ? el("div", { class: "reason" }, "Reason: " + (u.banReason || "—") + (by ? " · by " + by : "")) : null),
      el("div", { class: "actions" }, actionsFor(id, u)));
  }));
}
setInterval(() => { if (tab === "timeout" || [...users.values()].some(timeoutActive)) render(); }, 5000);
