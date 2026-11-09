// Connect Four: 7 columns × 6 rows. Player 1 = red, player 2 = yellow.
const W = 7, H = 6;
export const meta = { id: "connect4", name: "Connect Four", icon: "🔴", desc: "Drop discs, get four in a row", p1: "Red", p2: "Yellow" };

export const init = () => ({ b: Array(W * H).fill(0), turn: 1, last: null });
export const current = s => s.turn;
export const moves = s => [3, 2, 4, 1, 5, 0, 6].filter(c => s.b[c] === 0);

export function apply(s, col) {
  const b = s.b.slice();
  let r = H - 1; while (r >= 0 && b[r * W + col]) r--;
  if (r < 0) throw new Error("Column full");
  b[r * W + col] = s.turn;
  return { b, turn: 3 - s.turn, last: r * W + col };
}

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
export function winLine(s) {
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const p = s.b[r * W + c]; if (!p) continue;
    for (const [dr, dc] of DIRS) {
      const cells = [r * W + c];
      for (let k = 1; k < 4; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= H || cc < 0 || cc >= W || s.b[rr * W + cc] !== p) break;
        cells.push(rr * W + cc);
      }
      if (cells.length === 4) return { p, cells };
    }
  }
  return null;
}
export function result(s) {
  const w = winLine(s); if (w) return w.p;
  return s.b.every(x => x) ? "draw" : null;
}

// ---------- bot ----------
function scoreWindow(a, me) {
  const mine = a.filter(x => x === me).length, theirs = a.filter(x => x === 3 - me).length, empty = 4 - mine - theirs;
  if (mine === 4) return 1000; if (mine === 3 && empty === 1) return 6; if (mine === 2 && empty === 2) return 2;
  if (theirs === 3 && empty === 1) return -8; if (theirs === 2 && empty === 2) return -1; return 0;
}
function evaluate(s, me) {
  let sc = 0;
  for (let r = 0; r < H; r++) if (s.b[r * W + 3] === me) sc += 3;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) for (const [dr, dc] of DIRS) {
    const rr = r + dr * 3, cc = c + dc * 3; if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
    sc += scoreWindow([0, 1, 2, 3].map(k => s.b[(r + dr * k) * W + c + dc * k]), me);
  }
  return sc;
}
function negamax(s, depth, alpha, beta, me) {
  const res = result(s);
  if (res === "draw") return 0;
  if (res) return (res === s.turn ? 1 : -1) * (100000 + depth); // previous player just won
  if (depth === 0) return (s.turn === me ? 1 : -1) * evaluate(s, me);
  let best = -Infinity;
  for (const m of moves(s)) {
    const v = -negamax(apply(s, m), depth - 1, -beta, -alpha, me);
    if (v > best) best = v; if (v > alpha) alpha = v; if (alpha >= beta) break;
  }
  return best;
}
export function bot(s, level = "medium") {
  const ms = moves(s), me = s.turn;
  if (level === "easy" && Math.random() < 0.35) return ms[Math.floor(Math.random() * ms.length)];
  const depth = { easy: 2, medium: 4, hard: 7 }[level] || 4;
  let best = ms[0], bestV = -Infinity;
  for (const m of ms) {
    const v = -negamax(apply(s, m), depth - 1, -Infinity, Infinity, me) + Math.random() * 0.5;
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}

// ---------- drawing ----------
// ctx: { me: 1|2, canMove: bool, onMove(col) }
export function render(root, s, ctx) {
  const w = winLine(s);
  const board = document.createElement("div"); board.className = "c4-board";
  for (let c = 0; c < W; c++) {
    const col = document.createElement("button");
    col.className = "c4-col"; col.type = "button";
    col.disabled = !ctx.canMove || s.b[c] !== 0;
    col.setAttribute("aria-label", "Drop in column " + (c + 1));
    col.onclick = () => ctx.onMove(c);
    for (let r = 0; r < H; r++) {
      const i = r * W + c, cell = document.createElement("div");
      cell.className = "c4-cell" + (s.b[i] ? " p" + s.b[i] : "") + (i === s.last ? " last" : "") + (w && w.cells.includes(i) ? " win" : "");
      col.append(cell);
    }
    board.append(col);
  }
  root.replaceChildren(board);
}
