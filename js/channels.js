import { db, el, avatar, toast } from "./firebase.js";
import { openModal } from "./ui.js";
import {
  collection, doc, query, where, onSnapshot, getDocs, setDoc, updateDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Live list of the channels I can see. Mods see all; everyone else sees
// "everyone" channels plus the ones they're listed in.
export function watchChannels(me, isMod, cb) {
  const parts = new Map();
  const emit = () => {
    const all = new Map();
    for (const list of parts.values()) for (const c of list) all.set(c.id, c);
    cb([...all.values()].sort((a, b) => a.name.localeCompare(b.name)));
  };
  const listen = (key, q) => onSnapshot(q, s => {
    parts.set(key, s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))); emit();
  }, () => { parts.set(key, []); emit(); });
  if (isMod) return listen("all", collection(db, "channels"));
  const a = listen("everyone", query(collection(db, "channels"), where("everyone", "==", true)));
  const b = listen("mine", query(collection(db, "channels"), where("members", "array-contains", me)));
  return () => { a(); b(); };
}

// ---------- create / edit (mods) ----------
// people: [[uid, profile]] of everyone who can be added; nameEl(uid) draws a colored name
export function editChannel({ me, channel = null, people, nameEl, onSaved }) {
  const name = el("input", { class: "input", maxlength: 40, value: channel?.name || "", placeholder: "e.g. homework, gaming, mods-only" });
  let everyone = channel ? channel.everyone : true;
  const picked = new Set(channel?.members || []);
  const pickBox = el("div", { class: "member-pick" });
  const search = el("input", { class: "input", placeholder: "Search people", style: { marginBottom: "6px" } });
  const count = el("span", { class: "muted" });
  const drawPeople = () => {
    const q = search.value.trim().toLowerCase();
    count.textContent = `${picked.size} picked`;
    pickBox.replaceChildren(...people
      .filter(([, u]) => !q || u.name.toLowerCase().includes(q))
      .sort((a, b) => (picked.has(b[0]) - picked.has(a[0])) || a[1].name.localeCompare(b[1].name))
      .map(([uid, u]) => {
        const box = el("input", { type: "checkbox", checked: picked.has(uid), onchange: e => {
          e.target.checked ? picked.add(uid) : picked.delete(uid); count.textContent = `${picked.size} picked`;
        } });
        return el("label", { class: "item pick-row" }, box, avatar(u, 26), el("span", { class: "grow" }, nameEl(uid)));
      }));
  };
  search.oninput = drawPeople;
  const pickArea = el("div", {}, el("div", { class: "row", style: { justifyContent: "space-between", alignItems: "center", margin: "8px 0 6px" } },
    el("span", { class: "muted" }, "Who can see it (mods always can):"), count), search, pickBox);
  const modes = el("div", { class: "seg-tabs" }, [[true, "🌐 Everyone"], [false, "🔒 Only certain people"]].map(([v, t]) =>
    el("button", { type: "button", class: v === everyone ? "active" : "", onclick: e => {
      everyone = v; modes.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === e.currentTarget));
      pickArea.hidden = everyone;
    } }, t)));
  pickArea.hidden = everyone;
  drawPeople();

  openModal(channel ? "Edit channel" : "New channel", el("div", { class: "form channel-form" },
    el("label", { class: "lbl", style: { marginTop: 0 } }, "Channel name"), name,
    el("label", { class: "lbl" }, "Who's in it"), modes, pickArea), [
    { label: "Cancel" },
    { label: channel ? "Save" : "Create channel", kind: "primary", onClick: async () => {
      const n = name.value.trim().replace(/^#/, "").replace(/\s+/g, "-").toLowerCase();
      if (!n) { toast("Give the channel a name."); return false; }
      if (!everyone && !picked.size) { toast("Pick at least one person, or choose Everyone."); return false; }
      const data = { name: n.slice(0, 40), everyone, members: everyone ? [] : [...picked] };
      if (channel) {
        await updateDoc(doc(db, "channels", channel.id), data);
        toast("#" + data.name + " saved");
      } else {
        const ref = doc(collection(db, "channels"));
        await setDoc(ref, { ...data, createdBy: me, createdAt: serverTimestamp(), lastMessageAt: null, lastText: "", lastFrom: "" });
        toast("#" + data.name + " created");
        onSaved?.(ref.id);
      }
    } }
  ]);
}

export function deleteChannel(channel, onDeleted) {
  openModal("Delete channel?", el("p", {}, "Delete ", el("b", {}, "#" + channel.name), " and all its messages for everyone? This can't be undone."), [
    { label: "Cancel" },
    { label: "Delete", kind: "danger", onClick: async () => {
      const msgs = await getDocs(collection(db, "channels", channel.id, "messages"));
      for (let i = 0; i < msgs.docs.length; i += 400) {
        const b = writeBatch(db);
        msgs.docs.slice(i, i + 400).forEach(d => b.delete(d.ref));
        await b.commit();
      }
      const b = writeBatch(db); b.delete(doc(db, "channels", channel.id)); await b.commit();
      toast("#" + channel.name + " deleted");
      onDeleted?.();
    } }
  ]);
}
