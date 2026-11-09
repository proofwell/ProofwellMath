import { db, el, avatar, toast } from "./firebase.js";
import { openModal } from "./ui.js";
import {
  collection, doc, getDoc, query, where, onSnapshot, writeBatch, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Live friend state for the signed-in user.
export const friends = { me: null, list: [], incoming: [], outgoing: [], onChange: null };
const listCache = new Map(); // uid -> their friend list (for mutuals)

export function watchFriends(me, onChange) {
  friends.me = me; friends.onChange = onChange;
  const fire = () => friends.onChange?.();
  const u1 = onSnapshot(doc(db, "friendLists", me), s => { friends.list = s.exists() ? s.data().list || [] : []; fire(); }, () => {});
  const u2 = onSnapshot(query(collection(db, "friendRequests"), where("to", "==", me)), s => { friends.incoming = s.docs.map(d => d.data().from); fire(); }, () => {});
  const u3 = onSnapshot(query(collection(db, "friendRequests"), where("from", "==", me)), s => { friends.outgoing = s.docs.map(d => d.data().to); fire(); }, () => {});
  return () => { u1(); u2(); u3(); };
}

export const isFriend = uid => friends.list.includes(uid);
export const status = uid => isFriend(uid) ? "friends" : friends.incoming.includes(uid) ? "incoming" : friends.outgoing.includes(uid) ? "outgoing" : "none";

async function theirList(uid) {
  const s = await getDoc(doc(db, "friendLists", uid));
  const l = s.exists() ? s.data().list || [] : null;
  listCache.set(uid, l || []);
  return l;
}
export async function mutualsWith(uid) {
  const l = listCache.get(uid) ?? (await theirList(uid).catch(() => [])) ?? [];
  return l.filter(x => friends.list.includes(x));
}

// ---------- actions ----------
export async function sendRequest(uid) {
  if (friends.incoming.includes(uid)) return accept(uid); // they already asked → just accept
  try { await setDoc(doc(db, "friendRequests", `${friends.me}_${uid}`), { from: friends.me, to: uid, createdAt: serverTimestamp() }); }
  catch (err) { if (/permission/i.test(err.code || "")) throw new Error("They aren't accepting friend requests."); throw err; }
  toast("Friend request sent");
}
export async function cancelRequest(uid) { await deleteDoc(doc(db, "friendRequests", `${friends.me}_${uid}`)); }
export async function decline(uid) { await deleteDoc(doc(db, "friendRequests", `${uid}_${friends.me}`)); }
export async function accept(uid) {
  const me = friends.me;
  const [mine, theirs] = await Promise.all([theirList(me).catch(() => null), theirList(uid).catch(() => null)]);
  const b = writeBatch(db);
  b.set(doc(db, "friendLists", me), { list: [...(mine || []).filter(x => x !== uid), uid], last: uid });
  b.set(doc(db, "friendLists", uid), { list: [...(theirs || []).filter(x => x !== me), me], last: me });
  b.delete(doc(db, "friendRequests", `${uid}_${me}`));
  await b.commit();
  toast("You're now friends 🎉");
}
export async function unfriend(uid) {
  const me = friends.me;
  const [mine, theirs] = await Promise.all([getDoc(doc(db, "friendLists", me)), getDoc(doc(db, "friendLists", uid))]);
  const b = writeBatch(db);
  if (mine.exists()) b.update(doc(db, "friendLists", me), { list: (mine.data().list || []).filter(x => x !== uid) });
  if (theirs.exists()) b.update(doc(db, "friendLists", uid), { list: (theirs.data().list || []).filter(x => x !== me) });
  await b.commit();
  listCache.delete(uid);
  toast("Removed from friends");
}

// ---------- UI: buttons + mutuals for a profile ----------
// lookup(uid) -> profile, nameEl(uid) -> colored name, onMessage(uid)
export function friendSection(uid, { lookup, onOpenProfile }) {
  const box = el("div", { class: "friend-box" });
  const btns = el("div", { class: "row", style: { justifyContent: "center", flexWrap: "wrap" } });
  const mutualBox = el("div", { class: "mutuals" }, el("span", { class: "muted" }, "Loading mutual friends…"));
  const act = (label, kind, fn) => el("button", { class: "btn sm " + kind, type: "button", onclick: async e => {
    e.currentTarget.disabled = true;
    try { await fn(); } catch (err) { toast("Couldn't do that: " + (err.code || err.message)); }
    draw();
  } }, label);
  function draw() {
    const st = status(uid);
    btns.replaceChildren(...(
      st === "friends" ? [el("span", { class: "chip ok" }, "✓ Friends"), act("Unfriend", "ghost", () => unfriend(uid))]
      : st === "incoming" ? [act("Accept friend request", "ok", () => accept(uid)), act("Decline", "ghost", () => decline(uid))]
      : st === "outgoing" ? [el("span", { class: "chip" }, "Request sent"), act("Cancel", "ghost", () => cancelRequest(uid))]
      : lookup(uid)?.noFriendRequests ? [el("span", { class: "chip" }, "Not accepting friend requests")]
      : [act("➕ Add friend", "primary", () => sendRequest(uid))]));
  }
  draw();
  mutualsWith(uid).then(m => {
    if (!m.length) { mutualBox.replaceChildren(el("span", { class: "muted" }, "No mutual friends")); return; }
    mutualBox.replaceChildren(el("div", { class: "muted", style: { fontSize: "12px", marginBottom: "6px" } }, `${m.length} mutual friend${m.length === 1 ? "" : "s"}`),
      el("div", { class: "mutual-list" }, m.slice(0, 12).map(id => el("button", { class: "mutual", type: "button", title: lookup(id).name,
        onclick: () => onOpenProfile?.(id) }, avatar(lookup(id), 28), el("span", {}, lookup(id).name)))));
  }).catch(() => mutualBox.replaceChildren());
  box.append(btns, mutualBox);
  return box;
}

// ---------- UI: the Friends window ----------
export function openFriends({ lookup, nameEl, onMessage, onOpenProfile }) {
  const body = el("div", { class: "friends-win" });
  let m;
  const row = (uid, ...right) => el("div", { class: "item friend-row" }, avatar(lookup(uid), 34),
    el("button", { class: "grow link-like", type: "button", onclick: () => { m.close(); onOpenProfile(uid); } }, nameEl(uid)), el("div", { class: "row" }, right));
  const act = (label, kind, fn) => el("button", { class: "btn sm " + kind, type: "button", onclick: async e => {
    e.currentTarget.disabled = true;
    try { await fn(); } catch (err) { toast("Couldn't do that: " + (err.code || err.message)); e.currentTarget.disabled = false; }
  } }, label);
  function draw() {
    const parts = [];
    if (friends.incoming.length) parts.push(el("div", { class: "lbl", style: { marginTop: 0 } }, `Friend requests — ${friends.incoming.length}`),
      ...friends.incoming.map(uid => row(uid, act("Accept", "ok", () => accept(uid)), act("Decline", "ghost", () => decline(uid)))));
    parts.push(el("div", { class: "lbl", style: friends.incoming.length ? {} : { marginTop: 0 } }, `Friends — ${friends.list.length}`));
    parts.push(...(friends.list.length ? friends.list.map(uid => row(uid,
        act("💬", "", () => { m.close(); onMessage(uid); }), act("Unfriend", "ghost", () => unfriend(uid))))
      : [el("div", { class: "muted", style: { padding: "4px 2px" } }, "No friends yet. Click someone's name → Add friend.")]));
    if (friends.outgoing.length) parts.push(el("div", { class: "lbl" }, `Sent — ${friends.outgoing.length}`),
      ...friends.outgoing.map(uid => row(uid, act("Cancel", "ghost", () => cancelRequest(uid)))));
    body.replaceChildren(...parts);
  }
  draw();
  const prev = friends.onChange;
  friends.onChange = () => { prev?.(); if (document.body.contains(body)) draw(); };
  m = openModal("👥 Friends", body, [{ label: "Close" }]);
}
