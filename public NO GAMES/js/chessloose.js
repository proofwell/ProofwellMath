import { Chess } from "./vendor/chess.js";

// "Real-life" chess rules, like playing on a real board with nobody checking:
// - You may make any move a piece can physically make, even one that leaves your king in check.
//   If you do, the other player can just take your king — and taking the king wins.
// - If you try a move the piece can't make, it goes back and you lose your turn.
// - Checkmate and stalemate still end the game like normal.
// Uses chess.js's own move generator with its "is this safe for your king?" filter turned off.

const SQ = i => "abcdefgh"[i & 15] + (8 - (i >> 4));
export const SKIP = "--"; // how a skipped turn is written in the move list

export function board(fen) {
  const c = new Chess();
  c.load(fen, { skipValidation: true });
  return c;
}

// every move the piece on `square` can physically make (whether or not it's safe)
export function movesFrom(c, square) {
  return c._moves({ legal: false, square }).map(m => ({
    from: SQ(m.from), to: SQ(m.to), promotion: m.promotion, captured: m.captured, piece: m.piece, flags: m.flags, _m: m
  }));
}
export const isPromotion = (c, from, to) => movesFrom(c, from).some(m => m.to === to && m.promotion);

// play a move on c. Returns { san, kingTaken } or null if the piece can't move there.
export function play(c, from, to, promotion) {
  const all = c._moves({ legal: false });
  const m = all.find(x => SQ(x.from) === from && SQ(x.to) === to && (!x.promotion || x.promotion === (promotion || "q")));
  if (!m) return null;
  // the move's name, without the "+" / "#" that would give away check
  let san;
  try { san = c._moveToSan(m, all).replace(/[+#]/g, ""); } catch { san = from + to; }
  const kingTaken = m.captured === "k";
  if (kingTaken) san = san.replace(/[+#]?$/, "") + " (takes king)";
  c._makeMove(m);
  return { san, kingTaken };
}

// pass the turn to the other player without moving (after a move that wasn't allowed)
export function skipTurn(fen) {
  const t = fen.split(" ");
  const black = t[1] === "b";
  t[1] = black ? "w" : "b";
  t[3] = "-";
  t[4] = String((+t[4] || 0) + 1);
  if (black) t[5] = String((+t[5] || 1) + 1);
  return t.join(" ");
}

// can the side to move take the other king right now? (it was left in check)
export function kingCapture(c) {
  const m = c._moves({ legal: false }).find(x => x.captured === "k");
  return m ? { from: SQ(m.from), to: SQ(m.to) } : null;
}

// how the game stands after a move
export function outcome(c, kingTaken) {
  if (kingTaken) return { status: "checkmate", result: "King captured" };
  try {
    if (c.isCheckmate()) return { status: "checkmate", result: "" };
    if (c.isStalemate()) return { status: "stalemate", result: "Stalemate" };
    if (c.isInsufficientMaterial()) return { status: "draw", result: "Insufficient material" };
    if (c.isDrawByFiftyMoves()) return { status: "draw", result: "50-move rule" };
  } catch {}
  return { status: "active", result: "" };
}
