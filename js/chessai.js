import { board as looseBoard, movesFrom, isPromotion, play as loosePlay, skipTurn, kingCapture, outcome, SKIP } from "./chessloose.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
import { el, toast } from "./firebase.js";
import { openModal } from "./ui.js";
import { goFullscreen } from "./games.js";

const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = "abcdefgh";
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };

let worker = null, reqId = 0;
function engine() {
  if (!worker) worker = new Worker(new URL("./chessai-worker.js", import.meta.url), { type: "module" });
  return worker;
}
function askEngine(fen, level) {
  return new Promise(res => {
    const id = ++reqId, w = engine();
    const on = e => { if (e.data.id === id) { w.removeEventListener("message", on); res(e.data.move); } };
    w.addEventListener("message", on);
    w.postMessage({ id, fen, level });
  });
}

// ---------- setup: pick level and color ----------
export function startVsComputer() {
  let level = "medium", color = "w";
  const pills = (opts, get, set) => {
    const row = el("div", { class: "row", style: { flexWrap: "wrap" } });
    row.append(...opts.map(([v, t]) => el("button", { type: "button", class: "pill" + (get() === v ? " sel" : ""), onclick: e => {
      set(v); row.querySelectorAll(".pill").forEach(b => b.classList.toggle("sel", b === e.currentTarget));
    } }, t)));
    return row;
  };
  openModal("🤖 Chess vs Computer", el("div", { class: "form" },
    el("div", { class: "lbl", style: { marginTop: 0 } }, "Difficulty"),
    pills([["easy", "😊 Easy"], ["medium", "🙂 Medium"], ["hard", "😈 Hard"]], () => level, v => level = v),
    el("div", { class: "lbl" }, "You play as"),
    pills([["w", "♔ White"], ["b", "♚ Black"], ["random", "🎲 Random"]], () => color, v => color = v)), [
    { label: "Cancel" },
    { label: "Play", kind: "primary", onClick: () => {
      const c = color === "random" ? (Math.random() < 0.5 ? "w" : "b") : color;
      setTimeout(() => openBoard(level, c), 0);
    } }
  ]);
}

// ---------- the board ----------
function openBoard(level, me) {
  // real-life rules (see chessloose.js): any move a piece can make is allowed, even into check
  let chess = looseBoard(START);
  let selected = null, targets = new Map(), thinking = false, lastMove = null, over = false;
  let sans = [], history = [], end = null; // end: { text } once the game is over

  const boardEl = el("div", { class: "board" });
  const status = el("div", { class: "chess-status" });
  const movesEl = el("div", { class: "move-list" });
  const actions = el("div", { class: "chess-actions" });
  const topP = el("div", { class: "player" }), botP = el("div", { class: "player" });
  const overlay = el("div", { class: "game-overlay" },
    el("div", { class: "game-bar" },
      el("div", { class: "game-title" }, `🤖 Chess vs Computer · ${LEVEL_NAME[level]}`),
      el("div", { class: "row" },
        el("button", { class: "btn sm", onclick: () => goFullscreen(overlay) }, "⛶ Fullscreen"),
        el("button", { class: "btn sm", onclick: () => close() }, "✕ Close"))),
    el("div", { class: "chess-wrap" },
      el("div", { class: "chess-board-col" }, topP, boardEl, botP),
      el("div", { class: "chess-side" }, status, actions, el("div", { class: "lbl" }, "Moves"), movesEl)));
  document.body.append(overlay);
  let closed = false;
  const onKey = e => { if (e.key === "Escape" && !document.fullscreenElement) close(); };
  document.addEventListener("keydown", onKey);
  function close() { closed = true; overlay.remove(); document.removeEventListener("keydown", onKey); }

  const player = (label, icon, color) => [el("div", { class: "avatar", style: { width: "30px", height: "30px", background: "#3f4147", fontSize: "16px" } }, icon),
    el("span", { class: "grow", style: { fontWeight: 700 } }, label), el("span", { class: "muted" }, color === "w" ? "White" : "Black"),
    !over && chess.turn() === color ? el("span", { class: "turn-dot" }) : null].filter(Boolean);

  function render() {
    const flip = me === "b", ai = me === "w" ? "b" : "w";
    topP.replaceChildren(...player(`Computer (${LEVEL_NAME[level]})`, "🤖", ai));
    botP.replaceChildren(...player("You", "🙂", me));
    const grid = chess.board();
    const cells = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const rr = flip ? 7 - r : r, ff = flip ? 7 - f : f;
      const sq = FILES[ff] + (8 - rr), piece = grid[rr][ff], t = targets.get(sq);
      const cls = ["sq", (rr + ff) % 2 ? "dark" : "light"];
      if (lastMove && (lastMove.from === sq || lastMove.to === sq)) cls.push("last");
      if (selected === sq) cls.push("sel");
      if (t) cls.push(piece ? "capture" : "target");
      if (piece && piece.color === me && canMove()) cls.push("mine");
      cells.push(el("div", { class: cls.join(" "), onclick: () => click(sq) },
        piece ? el("span", { class: "pc " + (piece.color === "w" ? "pw" : "pb") }, GLYPH[piece.type] + "︎") : null,
        f === 0 ? el("span", { class: "coord rank" }, String(8 - rr)) : null,
        r === 7 ? el("span", { class: "coord file" }, FILES[ff]) : null));
    }
    boardEl.replaceChildren(...cells);

    let text;
    if (end) text = end.text;
    else if (thinking) text = "Computer is thinking…";
    else text = chess.turn() === me ? "Your move" : "Computer's move";
    status.textContent = text;
    status.className = "chess-status" + (!over && chess.turn() === me && !thinking ? " mine" : "");

    actions.replaceChildren(
      el("button", { class: "btn", disabled: thinking || !history.some(h => h.turn === me), onclick: undo }, "↶ Undo"),
      el("button", { class: "btn", onclick: () => { close(); openBoard(level, me); } }, "New game"),
      el("button", { class: "btn", onclick: () => { close(); startVsComputer(); } }, "Change level"),
      over ? null : el("button", { class: "btn danger", onclick: () => { over = true; end = { text: "You resigned" }; render(); } }, "Resign"));
    const h = sans, rows = [], show = m => m === SKIP ? "⏭ lost turn" : m || "";
    for (let i = 0; i < h.length; i += 2) rows.push(el("div", { class: "mv" }, el("span", { class: "muted" }, i / 2 + 1 + "."), el("span", {}, show(h[i])), el("span", {}, show(h[i + 1]))));
    movesEl.replaceChildren(...(rows.length ? rows : [el("div", { class: "muted" }, "No moves yet.")]));
    movesEl.scrollTop = movesEl.scrollHeight;
  }

  const canMove = () => !over && !thinking && chess.turn() === me;

  function click(sq) {
    if (!canMove()) return;
    if (selected && targets.has(sq)) { playMine(selected, sq); return; }
    const p = chess.get(sq);
    if (p && p.color === me) {
      if (selected === sq) { selected = null; targets = new Map(); }
      else { selected = sq; targets = new Map(movesFrom(chess, sq).map(m => [m.to, m])); }
    } else if (selected) {
      // a move that piece can't make: it goes back and you lose your turn
      toast("🚫 That piece can't move there. It went back — and you lost your turn.");
      save(); chess = looseBoard(skipTurn(chess.fen())); sans.push(SKIP);
      lastMove = null; selected = null; targets = new Map();
      afterMove(false); return;
    }
    render();
  }
  function save() { history.push({ fen: chess.fen(), sans: sans.slice(), lastMove, turn: chess.turn() }); }

  async function playMine(from, to) {
    let promotion;
    if (isPromotion(chess, from, to)) { promotion = await pickPromotion(me); if (!promotion) return; }
    save();
    const res = loosePlay(chess, from, to, promotion);
    if (!res) { history.pop(); return; }
    sans.push(res.san); lastMove = { from, to }; selected = null; targets = new Map();
    afterMove(res.kingTaken);
  }

  async function aiTurn() {
    thinking = true; render();
    const started = Date.now();
    // you left your king in check? the computer takes it
    const kc = kingCapture(chess);
    const m = kc || await askEngine(chess.fen(), level);
    await new Promise(r => setTimeout(r, Math.max(0, 450 - (Date.now() - started)))); // don't move instantly
    if (closed) return;
    thinking = false;
    let taken = false;
    if (m) {
      save();
      const res = loosePlay(chess, m.from, m.to, m.promotion);
      if (res) { sans.push(res.san); lastMove = { from: m.from, to: m.to }; taken = res.kingTaken; } else history.pop();
    }
    afterMove(taken);
  }

  function afterMove(kingTaken) {
    const o = outcome(chess, kingTaken);
    if (o.status !== "active") {
      over = true;
      const iWon = chess.turn() !== me; // the side to move is the one that got mated / lost its king
      end = { text: o.result === "King captured" ? (iWon ? "You took the computer's king — you win! 🎉" : "The computer took your king 🤖")
        : o.status === "checkmate" ? (iWon ? "Checkmate — you win! 🎉" : "Checkmate — the computer wins 🤖")
        : o.status === "stalemate" ? "Stalemate — draw" : "Draw" };
    }
    render();
    if (!over && chess.turn() !== me) aiTurn();
  }

  function undo() {
    if (thinking) return;
    // go back to the last time it was your move
    let st = null;
    while (history.length) { st = history.pop(); if (st.turn === me) break; }
    if (!st) return;
    chess = looseBoard(st.fen); sans = st.sans; lastMove = st.lastMove;
    over = false; end = null; selected = null; targets = new Map();
    render();
  }

  render();
  if (me === "b") aiTurn();
}

function pickPromotion(color) {
  return new Promise(resolve => {
    let chosen = null;
    const row = el("div", { class: "promo-row" }, ["q", "r", "b", "n"].map(p =>
      el("button", { class: "promo " + (color === "w" ? "pw" : "pb"), type: "button",
        onclick: () => { chosen = p; m.close(); resolve(p); } }, GLYPH[p] + "︎")));
    const m = openModal("Promote to…", row, [{ label: "Cancel", onClick: () => { if (!chosen) resolve(null); } }]);
  });
}
