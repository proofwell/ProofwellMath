// Chess computer opponent. Runs in a background worker so the page never freezes.
// Alpha-beta search + piece-square tables + capture-only extension at the leaves.
import { Chess } from "./vendor/chess.js";

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// piece-square tables from White's point of view, a8..h8 first row
const PST = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
      0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
      -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
      0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20]
};

// score from the side-to-move's point of view
function evaluate(c) {
  let s = 0;
  const b = c.board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = b[r][f]; if (!p) continue;
    const idx = p.color === "w" ? r * 8 + f : (7 - r) * 8 + f;
    const v = VAL[p.type] + PST[p.type][idx];
    s += p.color === "w" ? v : -v;
  }
  return c.turn() === "w" ? s : -s;
}

const MATE = 100000;
let nodes = 0, deadline = 0;
class Timeout extends Error {}

function ordered(moves) {
  // captures first (most valuable victim / least valuable attacker), then promotions
  return moves.sort((a, b) => score(b) - score(a));
  function score(m) {
    let s = 0;
    if (m.captured) s += 10 * VAL[m.captured] - VAL[m.piece];
    if (m.promotion) s += VAL[m.promotion];
    return s;
  }
}

function quiesce(c, alpha, beta, depth) {
  const stand = evaluate(c);
  if (stand >= beta) return beta;
  if (alpha < stand) alpha = stand;
  if (depth <= 0) return alpha;
  for (const m of ordered(c.moves({ verbose: true }).filter(m => m.captured))) {
    c.move(m); const s = -quiesce(c, -beta, -alpha, depth - 1); c.undo();
    if (s >= beta) return beta;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function search(c, depth, alpha, beta, ply) {
  if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
  if (c.isCheckmate()) return -MATE + ply;
  if (c.isDraw() || c.isStalemate()) return 0;
  if (depth === 0) return quiesce(c, alpha, beta, 4);
  let best = -Infinity;
  for (const m of ordered(c.moves({ verbose: true }))) {
    c.move(m); const s = -search(c, depth - 1, -beta, -alpha, ply + 1); c.undo();
    if (s > best) best = s;
    if (s > alpha) alpha = s;
    if (alpha >= beta) break;
  }
  return best;
}

// levels: how deep to look, how much thinking time, how often to play a sloppy move
const LEVELS = {
  easy:   { depth: 1, ms: 400,  blunder: 0.35 },
  medium: { depth: 2, ms: 1500, blunder: 0.08 },
  hard:   { depth: 4, ms: 3500, blunder: 0 }
};

function bestMove(fen, level) {
  const L = LEVELS[level] || LEVELS.medium;
  const c = new Chess(fen);
  const moves = ordered(c.moves({ verbose: true }));
  if (!moves.length) return null;
  if (Math.random() < L.blunder) return moves[Math.floor(Math.random() * moves.length)];
  nodes = 0; deadline = Date.now() + L.ms;
  let best = moves[0];
  // iterative deepening: keep the best answer from the deepest finished search
  for (let d = 1; d <= L.depth; d++) {
    try {
      // margin: moves within this many points of the best count as "equally good"
      const margin = level === "hard" ? 1 : 15;
      let alpha = -Infinity, dBest = null, scored = [];
      for (const m of d > 1 ? [best, ...moves.filter(x => x.san !== best.san)] : moves) {
        // search with a window just below the best so far: any score above (alpha - margin) is exact
        c.move(m); const s = -search(c, d - 1, -Infinity, -(alpha - margin), 1); c.undo();
        scored.push([s, m]);
        if (s > alpha) { alpha = s; dBest = m; }
      }
      const top = scored.filter(([s]) => s > alpha - margin).map(([, m]) => m);
      best = top[Math.floor(Math.random() * top.length)] || dBest || best;
      if (alpha >= MATE - 100) break;
    } catch (e) { if (!(e instanceof Timeout)) throw e; break; }
  }
  return best;
}

onmessage = e => {
  const { id, fen, level } = e.data;
  const m = bestMove(fen, level);
  postMessage({ id, move: m ? { from: m.from, to: m.to, promotion: m.promotion } : null });
};
