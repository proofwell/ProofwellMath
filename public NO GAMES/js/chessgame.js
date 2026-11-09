import { Chess } from "./vendor/chess.js";
import { board as looseBoard, movesFrom, isPromotion, play as loosePlay, skipTurn, outcome, SKIP } from "./chessloose.js";
import { db, el, avatar, toast } from "./firebase.js";
import { openModal } from "./ui.js";
import {
  doc, collection, writeBatch, updateDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = "abcdefgh";
const OPEN = ["pending", "active"];
function fullscreen(node) {
  const fn = node.requestFullscreen || node.webkitRequestFullscreen;
  try { const p = fn?.call(node); p?.catch?.(() => toast("Fullscreen was blocked — press F11 instead")); }
  catch { toast("Fullscreen was blocked — press F11 instead"); }
}

export const isOpen = g => OPEN.includes(g.status);
export const colorOf = (g, uid) => (g.white === uid ? "w" : "b");
export const opponentOf = (g, uid) => g.players.find(p => p !== uid);
export function turnOf(g) { return (g.fen || START_FEN).split(" ")[1]; }
export const isMyTurn = (g, uid) => g.status === "active" && turnOf(g) === colorOf(g, uid);

// the board as it stands (real-life rules: see chessloose.js)
function replay(g) {
  return looseBoard(g.fen || START_FEN);
}

// ---------- starting and answering games ----------
export async function challenge(meUid, otherUid, color = "random") {
  if (color === "random") color = Math.random() < 0.5 ? "w" : "b";
  const players = [meUid, otherUid].sort();
  const dmId = players.join("_");
  const ref = doc(collection(db, "chess"));
  const b = writeBatch(db);
  b.set(ref, {
    players, dmId,
    white: color === "w" ? meUid : otherUid,
    black: color === "w" ? otherUid : meUid,
    createdBy: meUid, status: "pending", fen: START_FEN, moves: [],
    winner: null, drawOffer: null, result: "", lastMove: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  b.set(doc(db, "dms", dmId), { members: players, lastMessageAt: serverTimestamp(), lastText: "♟️ Chess challenge", lastFrom: meUid });
  b.set(doc(collection(db, "dms", dmId, "messages")), {
    uid: meUid, text: "♟️ Challenged you to a game of chess", createdAt: serverTimestamp(), chessId: ref.id
  });
  await b.commit();
  return ref.id;
}

const upd = (id, data) => updateDoc(doc(db, "chess", id), { ...data, updatedAt: serverTimestamp() });
export const accept  = id => upd(id, { status: "active" });
export const decline = id => upd(id, { status: "declined" });
export const cancel  = id => upd(id, { status: "cancelled" });

// ---------- status line ----------
export function statusText(g, me, nameOf) {
  const opp = nameOf(opponentOf(g, me));
  switch (g.status) {
    case "pending":  return g.createdBy === me ? `Waiting for ${opp} to accept` : `${opp} challenged you`;
    case "active": {
      return isMyTurn(g, me) ? "Your move" : `${opp}'s move`;
    }
    case "checkmate":
      if (g.result === "King captured") return g.winner === me ? "You took their king — you win! 🎉" : `${opp} took your king — ${opp} wins`;
      return g.winner === me ? "Checkmate — you win! 🎉" : `Checkmate — ${opp} wins`;
    case "resigned":  return g.winner === me ? `${opp} resigned — you win! 🎉` : "You resigned";
    case "stalemate": return "Stalemate — draw";
    case "draw":      return "Draw" + (g.result ? " — " + g.result : "");
    case "declined":  return "Challenge declined";
    case "cancelled": return "Challenge cancelled";
    default: return g.status;
  }
}

// ---------- the invite card shown inside the DM ----------
export function gameCard(g, me, nameOf, onOpen) {
  if (!g) return el("div", { class: "game-card muted" }, "♟️ Loading game…");
  const w = nameOf(g.white), b = nameOf(g.black);
  const btns = [];
  const act = (label, kind, fn) => el("button", { class: "btn sm " + kind, onclick: async e => {
    e.stopPropagation();
    try { await fn(); } catch (err) { toast(err.message || String(err)); }
  } }, label);
  if (g.status === "pending" && g.createdBy !== me) {
    btns.push(act("Accept", "ok", async () => { await accept(g.id); onOpen(g.id); }));
    btns.push(act("Decline", "", () => decline(g.id)));
  } else if (g.status === "pending") {
    btns.push(act("Cancel", "", () => cancel(g.id)));
  } else if (g.status === "active") {
    btns.push(act(isMyTurn(g, me) ? "Play your move" : "Open board", "primary", () => onOpen(g.id)));
  } else if (g.status !== "declined" && g.status !== "cancelled") {
    btns.push(act("View game", "", () => onOpen(g.id)));
  }
  return el("div", { class: "game-card" + (isMyTurn(g, me) ? " my-turn" : "") },
    el("div", { class: "game-card-icon" }, "♟"),
    el("div", { class: "grow" },
      el("div", { style: { fontWeight: 700 } }, "Chess"),
      el("div", { class: "muted" }, `♔ ${w}  vs  ♚ ${b}`),
      el("div", { class: "game-card-status" }, statusText(g, me, nameOf))),
    el("div", { class: "row" }, btns));
}

const showMove = m => m === SKIP ? "⏭ lost turn" : m || "";

// ---------- promotion picker ----------
function pickPromotion(color) {
  return new Promise(resolve => {
    let chosen = null;
    const row = el("div", { class: "promo-row" }, ["q", "r", "b", "n"].map(p =>
      el("button", { class: "promo " + (color === "w" ? "pw" : "pb"), type: "button",
        onclick: () => { chosen = p; modal.close(); resolve(p); } }, GLYPH[p] + "︎")));
    const modal = openModal("Promote to…", row, [{ label: "Cancel", onClick: () => { if (!chosen) resolve(null); } }]);
  });
}

// ---------- full board window ----------
export function openChess(gameId, { me, lookup, nameEl, onRematch }) {
  const ref = doc(db, "chess", gameId);
  let g = null, chess = new Chess(), selected = null, targets = new Map(), busy = false;

  const boardEl = el("div", { class: "board" });
  const topP = el("div", { class: "player" }), botP = el("div", { class: "player" });
  const status = el("div", { class: "chess-status" });
  const movesEl = el("div", { class: "move-list" });
  const actions = el("div", { class: "chess-actions" });
  const overlay = el("div", { class: "game-overlay" },
    el("div", { class: "game-bar" },
      el("div", { class: "game-title" }, "♟ Chess"),
      el("div", { class: "row" },
        el("button", { class: "btn sm", onclick: () => fullscreen(overlay) }, "⛶ Fullscreen"),
        el("button", { class: "btn sm", onclick: () => close() }, "✕ Close"))),
    el("div", { class: "chess-wrap" },
      el("div", { class: "chess-board-col" }, topP, boardEl, botP),
      el("div", { class: "chess-side" }, status, actions, el("div", { class: "lbl" }, "Moves"), movesEl)));
  document.body.append(overlay);
  const onKey = e => { if (e.key === "Escape" && !document.fullscreenElement) close(); };
  document.addEventListener("keydown", onKey);

  const unsub = onSnapshot(ref, s => {
    if (!s.exists()) { toast("Game not found"); close(); return; }
    const prevTurn = g && turnOf(g);
    g = { id: s.id, ...s.data() };
    chess = replay(g);
    if (prevTurn !== turnOf(g)) { selected = null; targets = new Map(); }
    busy = false;
    render();
  }, err => { toast("Can't open game: " + err.code); close(); });

  function close() {
    unsub(); document.removeEventListener("keydown", onKey);
    if (document.fullscreenElement === overlay) document.exitFullscreen?.().catch(() => {});
    overlay.remove();
  }

  const myColor = () => colorOf(g, me);
  const canMove = () => g && g.status === "active" && chess.turn() === myColor() && !busy;

  function playerRow(uid, color) {
    const u = lookup(uid);
    const toMove = g.status === "active" && turnOf(g) === color;
    return [avatar(u, 30), el("span", { class: "grow" }, nameEl(uid)),
      el("span", { class: "muted" }, color === "w" ? "White" : "Black"),
      toMove ? el("span", { class: "turn-dot", title: "To move" }) : null];
  }

  function render() {
    if (!g) return;
    const mine = myColor(), flip = mine === "b";
    const opp = opponentOf(g, me);
    topP.replaceChildren(...playerRow(opp, mine === "w" ? "b" : "w").filter(Boolean));
    botP.replaceChildren(...playerRow(me, mine).filter(Boolean));

    // board
    const grid = chess.board();
    const cells = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const rr = flip ? 7 - r : r, ff = flip ? 7 - f : f;
      const sq = FILES[ff] + (8 - rr);
      const piece = grid[rr][ff];
      const t = targets.get(sq);
      const cls = ["sq", (rr + ff) % 2 ? "dark" : "light"];
      if (g.lastMove && (g.lastMove.from === sq || g.lastMove.to === sq)) cls.push("last");
      if (selected === sq) cls.push("sel");
      if (t) cls.push(piece ? "capture" : "target");
      if (piece && piece.color === mine && canMove()) cls.push("mine");
      cells.push(el("div", { class: cls.join(" "), onclick: () => clickSquare(sq) },
        piece ? el("span", { class: "pc " + (piece.color === "w" ? "pw" : "pb") }, GLYPH[piece.type] + "︎") : null,
        f === 0 ? el("span", { class: "coord rank" }, String(8 - rr)) : null,
        r === 7 ? el("span", { class: "coord file" }, FILES[ff]) : null));
    }
    boardEl.replaceChildren(...cells);

    // status + buttons
    status.textContent = statusText(g, me, uid => lookup(uid).name);
    status.className = "chess-status" + (isMyTurn(g, me) ? " mine" : "");
    const btns = [];
    const act = (label, kind, fn) => el("button", { class: "btn " + kind, onclick: async () => {
      try { await fn(); } catch (err) { toast(err.message || String(err)); }
    } }, label);
    if (g.status === "pending") {
      if (g.createdBy === me) btns.push(act("Cancel challenge", "", () => cancel(g.id)));
      else btns.push(act("Accept", "ok", () => accept(g.id)), act("Decline", "danger", () => decline(g.id)));
    } else if (g.status === "active") {
      if (g.drawOffer && g.drawOffer !== me) {
        btns.push(el("div", { class: "muted", style: { width: "100%" } }, `${lookup(opp).name} offers a draw`));
        btns.push(act("Accept draw", "ok", () => upd(g.id, { status: "draw", result: "Agreed", drawOffer: null })));
        btns.push(act("Decline", "", () => upd(g.id, { drawOffer: null })));
      } else if (g.drawOffer === me) {
        btns.push(act("Take back draw offer", "", () => upd(g.id, { drawOffer: null })));
      } else {
        btns.push(act("Offer draw", "", () => upd(g.id, { drawOffer: me }).then(() => toast("Draw offered"))));
      }
      btns.push(act("Resign", "danger", () => new Promise(res => openModal("Resign?",
        el("p", {}, "You'll lose this game."), [
          { label: "Cancel", onClick: () => res() },
          { label: "Resign", kind: "danger", onClick: async () => { await upd(g.id, { status: "resigned", winner: opp }); res(); } }
        ]))));
    } else if (g.status !== "declined" && g.status !== "cancelled" && onRematch) {
      btns.push(act("Rematch", "primary", async () => {
        const id = await challenge(me, opp, myColor() === "w" ? "b" : "w");
        close(); onRematch(id);
      }));
    }
    actions.replaceChildren(...btns);

    // move list
    const rows = [];
    const mv = g.moves || [];
    for (let i = 0; i < mv.length; i += 2) {
      rows.push(el("div", { class: "mv" }, el("span", { class: "muted" }, i / 2 + 1 + "."),
        el("span", {}, showMove(mv[i])), el("span", {}, showMove(mv[i + 1]))));
    }
    movesEl.replaceChildren(...(rows.length ? rows : [el("div", { class: "muted" }, "No moves yet.")]));
    movesEl.scrollTop = movesEl.scrollHeight;
  }

  function clickSquare(sq) {
    if (!canMove()) return;
    if (selected && targets.has(sq)) { makeMove(selected, sq); return; }
    const p = chess.get(sq);
    if (p && p.color === myColor()) {
      if (selected === sq) { selected = null; targets = new Map(); }
      else { selected = sq; targets = new Map(movesFrom(chess, sq).map(m => [m.to, m])); }
    } else if (selected) { illegal(); return; }   // tried to move somewhere that piece can't go
    render();
  }

  // a move the piece can't make: it goes back and you lose your turn
  async function illegal() {
    selected = null; targets = new Map();
    toast("🚫 That piece can't move there. It went back — and you lost your turn.");
    const fen = skipTurn(g.fen || START_FEN), next = looseBoard(fen);
    const { status, result } = outcome(next, false);
    busy = true; chess = next;
    g = { ...g, fen, moves: [...(g.moves || []), SKIP], lastMove: null };
    render();
    try {
      await upd(g.id, { fen, moves: g.moves, status, winner: status === "checkmate" ? me : null, result, drawOffer: null, lastMove: null });
    } catch (err) { toast("Didn't go through: " + (err.code || err.message)); busy = false; }
  }

  async function makeMove(from, to) {
    let promotion;
    if (isPromotion(chess, from, to)) {
      promotion = await pickPromotion(myColor());
      if (!promotion) return;
    }
    const next = replay(g);
    const res = loosePlay(next, from, to, promotion);
    if (!res) return;
    const o = outcome(next, res.kingTaken);
    // checkmate here means the OTHER player has no way out (or you took their king)
    const winner = o.status === "checkmate" ? me : null;
    // show it right away, the database confirms a moment later
    busy = true; chess = next; selected = null; targets = new Map();
    g = { ...g, fen: next.fen(), moves: [...(g.moves || []), res.san], lastMove: { from, to } };
    render();
    try {
      await upd(g.id, { fen: next.fen(), moves: g.moves, status: o.status, winner, result: o.result, drawOffer: null, lastMove: { from, to } });
    } catch (err) {
      toast("Move didn't go through: " + (err.code || err.message));
      busy = false;
    }
  }

  return { close };
}
