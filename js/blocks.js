import { db, toast } from "./firebase.js";
import { friends, unfriend, cancelRequest, decline } from "./friends.js";
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// People I've blocked. Private: only I can read my list.
// The database stops blocked people from DMing me, friending me or challenging me to games.
export const blocks = { me: null, list: [] };
export const isBlocked = uid => blocks.list.includes(uid);

export function watchBlocks(me, onChange) {
  blocks.me = me;
  return onSnapshot(doc(db, "blocks", me), s => { blocks.list = s.exists() ? s.data().list || [] : []; onChange?.(); }, () => {});
}

export async function block(uid, name = "them") {
  if (isBlocked(uid)) return;
  await setDoc(doc(db, "blocks", blocks.me), { list: [...blocks.list, uid] });
  // blocking also ends any friendship / pending requests
  try {
    if (friends.list.includes(uid)) await unfriend(uid);
    if (friends.outgoing.includes(uid)) await cancelRequest(uid);
    if (friends.incoming.includes(uid)) await decline(uid);
  } catch {}
  toast(`Blocked ${name}`);
}
export async function unblock(uid, name = "them") {
  await setDoc(doc(db, "blocks", blocks.me), { list: blocks.list.filter(x => x !== uid) });
  toast(`Unblocked ${name}`);
}
