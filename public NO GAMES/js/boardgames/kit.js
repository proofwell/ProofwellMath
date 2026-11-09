// Shared screen + online matches + XP for Connect Four, Checkers, Dots & Boxes.
import { db, el, avatar, toast } from "../firebase.js";
import { openModal } from "../ui.js";
import { goFullscreen } from "../games.js";
import * as connect4 from "./connect4.js";
import * as checkers from "./checkers.js";
import * as dots from "./dots.js";
import {
  collection, doc, onSnapshot, updateDoc, writeBatch, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const GAMES = { connect4, checkers, dots };
const BOT_XP = { easy: 1, medium: 2, hard: 3 };

// ---------- XP ----------
// Beating a bot: +1/+2/+3 (database allows one game reward every 30 s)
export async function awardGameXp(uid, amount) {
  try { await updateDoc(doc(db, "users", uid), { xp: increment(amount), lastGameXpAt: serverTimestamp() }); toast(`+${amount} XP`); }
  catch { toast("XP not added — game rewards are limited to one every 30 seconds."); }
}
// Beating a player: +5, once per match
const claiming = new Set();
export async function claimMatchXp(m, me, opponentName) {
  if (m.status !== "done" || m.winner !== me || m.xpClaimed || claiming.has(m.id)) return;
  claiming.add(m.id);
  try {
    const b = writeBatch(db);
    b.update(doc(db, "matches", m.id), { xpClaimed: true, updatedAt: serverTimestamp() });
    b.update(doc(db, "users", me), { xp: increment(5), lastMatchClaim: m.id });
    await b.commit();
    toast(`🏆 You beat ${opponentName} at ${GAMES[m.type].meta.name}! +5 XP`);
  } catch { claiming.delete(m.id); }
}

// ---------- pick bot level ----------
export function startVsBot(type, me) {
  const G = GAMES[type]; let level = "medium", side = 1;
  const pills = (opts, get, set) => {
    const row = el("div", { class: "row", style: { flexWrap: "wrap" } });
    row.append(...opts.map(([v, t]) => el("button", { type: "button", class: "pill" + (get() === v ? " sel" : ""), onclick: e => {
      set(v); row.querySelectorAll(".pill").forEach(b => b.classList.toggle("sel", b === e.currentTarget)); } }, t)));
    return row;
  };
  openModal(`${G.meta.icon} ${G.meta.name} vs Bot`, el("div", { class: "form" },
    el("div", { class: "lbl", style: { marginTop: 0 } }, "Difficulty"),
    pills([["easy", "😊 Easy (+1 XP)"], ["medium", "🙂 Medium (+2 XP)"], ["hard", "😈 Hard (+3 XP)"]], () => level, v => level = v),
    el("div", { class: "lbl" }, "Go first?"),
    pills([[1, `Yes (${G.meta.p1})`], [2, `No (${G.meta.p2})`]], () => side, v => side = v)), [
    { label: "Cancel" },
    { label: "Play", kind: "primary", onClick: () => { setTimeout(() => openLocal(type, level, side, me), 0); } }
  ]);
}

// ---------- the board screen ----------
function frame(G, title, onClose) {
  const boardBox = el("div", { class: "bg-board" });
  const status = el("div", { class: "chess-status" });
  const actions = el("div", { class: "chess-actions" });
  const players = el("div", { class: "bg-players" });
  const overlay = el("div", { class: "game-overlay" },
    el("div", { class: "game-bar" }, el("div", { class: "game-title" }, title),
      el("div", { class: "row" },
        el("button", { class: "btn sm", onclick: () => goFullscreen(overlay) }, "⛶ Fullscreen"),
        el("button", { class: "btn sm", onclick: () => close() }, "✕ Close"))),
    el("div", { class: "chess-wrap" }, el("div", { class: "bg-col" }, boardBox),
      el("div", { class: "chess-side" }, players, status, actions)));
  document.body.append(overlay);
  const onKey = e => { if (e.key === "Escape" && !document.fullscreenElement && !document.querySelector(".overlay")) close(); };
  document.addEventListener("keydown", onKey);
  let closed = false;
  function close() { closed = true; overlay.remove(); document.removeEventListener("keydown", onKey); onClose?.(); }
  return { boardBox, status, actions, players, close, isClosed: () => closed };
}
const playerRow = (label, icon, colorName, active, cls) => el("div", { class: "player" + (active ? " to-move" : "") },
  icon, el("span", { class: "grow", style: { fontWeight: 700 } }, label), el("span", { class: "muted bg-side " + cls }, colorName), active ? el("span", { class: "turn-dot" }) : null);
const botIcon = () => el("div", { class: "avatar", style: { width: "30px", height: "30px", background: "#3f4147", fontSize: "16px" } }, "🤖");

function openLocal(type, level, me, uid) {
  const G = GAMES[type]; let s = G.init(), thinking = false, over = false;
  const f = frame(G, `${G.meta.icon} ${G.meta.name} vs Bot · ${level[0].toUpperCase() + level.slice(1)}`);
  function draw() {
    const res = G.result(s);
    G.render(f.boardBox, s, { me, canMove: !res && !thinking && !over && G.current(s) === me, onMove: play });
    f.players.replaceChildren(
      playerRow("Bot", botIcon(), me === 1 ? G.meta.p2 : G.meta.p1, !res && G.current(s) !== me, "p" + (3 - me)),
      playerRow("You", el("div", { class: "avatar", style: { width: "30px", height: "30px", background: "#5865f2", fontSize: "16px" } }, "🙂"), me === 1 ? G.meta.p1 : G.meta.p2, !res && G.current(s) === me, "p" + me));
    f.status.textContent = res === "draw" ? "It's a draw" : res === me ? `You win! 🎉 +${BOT_XP[level]} XP` : res ? "The bot wins 🤖" : over ? "You resigned" : thinking ? "Bot is thinking…" : "Your turn";
    f.status.className = "chess-status" + (!res && G.current(s) === me && !thinking ? " mine" : "");
    f.actions.replaceChildren(
      el("button", { class: "btn", onclick: () => { f.close(); openLocal(type, level, me, uid); } }, "New game"),
      el("button", { class: "btn", onclick: () => { f.close(); startVsBot(type, uid); } }, "Change level"),
      !res && !over ? el("button", { class: "btn danger", onclick: () => { over = true; draw(); } }, "Resign") : null);
  }
  function play(m) {
    s = G.apply(s, m); after();
  }
  function after() {
    const res = G.result(s);
    draw();
    if (res === me && uid) awardGameXp(uid, BOT_XP[level]);
    if (!res && !over && G.current(s) !== me) {
      thinking = true; draw();
      setTimeout(() => { if (f.isClosed()) return; const m = G.bot(s, level); thinking = false; s = G.apply(s, m); after(); }, 350);
    }
  }
  draw();
  if (G.current(s) !== me) after();
}

// ---------- online ----------
export async function challenge(type, me, other) {
  const G = GAMES[type], players = [me, other].sort(), dmId = players.join("_");
  const ref = doc(collection(db, "matches"));
  const b = writeBatch(db);
  b.set(ref, { type, players, p1: me, p2: other, dmId, createdBy: me, status: "pending", state: JSON.stringify(G.init()),
    turn: me, winner: null, xpClaimed: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.set(doc(db, "dms", dmId), { members: players, lastMessageAt: serverTimestamp(), lastText: `${G.meta.icon} ${G.meta.name} challenge`, lastFrom: me });
  b.set(doc(collection(db, "dms", dmId, "messages")), { uid: me, text: `${G.meta.icon} Challenged you to ${G.meta.name}`, createdAt: serverTimestamp(), matchId: ref.id });
  await b.commit();
  return ref.id;
}

const upd = (id, data) => updateDoc(doc(db, "matches", id), { ...data, updatedAt: serverTimestamp() });
export const acceptMatch = id => upd(id, { status: "active" });
export const declineMatch = id => upd(id, { status: "declined" });
export const cancelMatch = id => upd(id, { status: "cancelled" });

export function matchStatus(m, me, nameOf) {
  const G = GAMES[m.type], opp = nameOf(m.players.find(p => p !== me));
  if (m.status === "pending") return m.createdBy === me ? `Waiting for ${opp} to accept` : `${opp} challenged you`;
  if (m.status === "active") return m.turn === me ? "Your turn" : `${opp}'s turn`;
  if (m.status === "done") return m.winner === "draw" ? "Draw" : m.winner === me ? "You won! 🏆" : `${opp} won`;
  return m.status === "declined" ? "Challenge declined" : "Challenge cancelled";
}

// Invite card inside a DM
export function matchCard(m, me, nameOf, onOpen) {
  if (!m) return el("div", { class: "game-card muted" }, "Loading game…");
  const G = GAMES[m.type], btns = [];
  const act = (label, kind, fn) => el("button", { class: "btn sm " + kind, onclick: async e => {
    e.stopPropagation(); try { await fn(); } catch (err) { toast(err.message || String(err)); } } }, label);
  if (m.status === "pending" && m.createdBy !== me) btns.push(act("Accept", "ok", async () => { await acceptMatch(m.id); onOpen(m.id); }), act("Decline", "", () => declineMatch(m.id)));
  else if (m.status === "pending") btns.push(act("Cancel", "", () => cancelMatch(m.id)));
  else if (m.status === "active") btns.push(act(m.turn === me ? "Play your turn" : "Open", "primary", () => onOpen(m.id)));
  else if (m.status === "done") btns.push(act("View", "", () => onOpen(m.id)));
  const myTurn = m.status === "active" && m.turn === me;
  return el("div", { class: "game-card" + (myTurn ? " my-turn" : "") },
    el("div", { class: "game-card-icon" }, G.meta.icon),
    el("div", { class: "grow" }, el("div", { style: { fontWeight: 700 } }, G.meta.name),
      el("div", { class: "game-card-status" }, matchStatus(m, me, nameOf))),
    el("div", { class: "row" }, btns));
}

// Live online board
export function openMatch(id, { me, lookup, onRematch }) {
  let m = null, s = null, busy = false;
  let f = null;
  const unsub = onSnapshot(doc(db, "matches", id), snap => {
    if (!snap.exists()) { toast("Game not found"); f?.close(); return; }
    m = { id, ...snap.data() }; s = JSON.parse(m.state); busy = false;
    const G = GAMES[m.type];
    if (!f) f = frame(G, `${G.meta.icon} ${G.meta.name}`, () => unsub());
    draw();
  }, err => { toast("Can't open game: " + err.code); f?.close(); });

  function draw() {
    const G = GAMES[m.type], mine = m.p1 === me ? 1 : 2, opp = m.players.find(p => p !== me);
    const canMove = m.status === "active" && m.turn === me && !busy;
    G.render(f.boardBox, s, { me: mine, canMove, onMove: move });
    f.players.replaceChildren(
      playerRow(lookup(opp).name, avatar(lookup(opp), 30), mine === 1 ? G.meta.p2 : G.meta.p1, m.status === "active" && m.turn === opp, "p" + (3 - mine)),
      playerRow("You", avatar(lookup(me), 30), mine === 1 ? G.meta.p1 : G.meta.p2, m.status === "active" && m.turn === me, "p" + mine));
    f.status.textContent = matchStatus(m, me, uid => lookup(uid).name) + (m.status === "done" && m.winner === me ? " +5 XP" : "");
    f.status.className = "chess-status" + (canMove ? " mine" : "");
    const btns = [];
    const act = (label, kind, fn) => el("button", { class: "btn " + kind, onclick: async () => { try { await fn(); } catch (err) { toast(err.message || String(err)); } } }, label);
    if (m.status === "pending") btns.push(m.createdBy === me ? act("Cancel challenge", "", () => cancelMatch(id)) : act("Accept", "ok", () => acceptMatch(id)));
    if (m.status === "active") btns.push(act("Resign", "danger", () => upd(id, { status: "done", winner: opp })));
    if (["done", "declined", "cancelled"].includes(m.status) && onRematch) btns.push(act("Rematch", "primary", async () => { const nid = await challenge(m.type, me, opp); f.close(); onRematch(nid); }));
    f.actions.replaceChildren(...btns);
  }

  async function move(mv) {
    const G = GAMES[m.type], mine = m.p1 === me ? 1 : 2;
    const ns = G.apply(s, mv), res = G.result(ns);
    const nextUid = G.current(ns) === 1 ? m.p1 : m.p2;
    busy = true; s = ns; draw();
    try {
      await upd(id, { state: JSON.stringify(ns), turn: res ? me : nextUid, status: res ? "done" : "active",
        winner: res === "draw" ? "draw" : res ? (res === 1 ? m.p1 : m.p2) : null });
    } catch (err) { toast("Move didn't go through: " + (err.code || err.message)); busy = false; s = JSON.parse(m.state); draw(); }
  }
}
