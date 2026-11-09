// Checkers (English draughts): 8×8, captures are mandatory, multi-jumps, kings.
// Pieces: 1 = player 1 man (moves up), 2 = player 2 man (moves down), 3 / 4 = their kings.
export const meta = { id: "checkers", name: "Checkers", icon: "⛀", desc: "Jump and capture all their pieces", p1: "Red", p2: "Black" };

const owner = p => (p === 1 || p === 3 ? 1 : p === 2 || p === 4 ? 2 : 0);
const isKing = p => p === 3 || p === 4;
export function init() {
  const b = Array(64).fill(0);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) {
    if (r < 3) b[r * 8 + c] = 2; else if (r > 4) b[r * 8 + c] = 1;
  }
  return { b, turn: 1, quiet: 0, last: null };
}
export const current = s => s.turn;

function dirsFor(p) { return isKing(p) ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : owner(p) === 1 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]; }
const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

function jumpsFrom(b, sq, p, path, caps, out) {
  const r = sq >> 3, c = sq & 7; let found = false;
  for (const [dr, dc] of dirsFor(p)) {
    const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc;
    if (!inB(tr, tc)) continue;
    const mid = mr * 8 + mc, to = tr * 8 + tc;
    if (owner(b[mid]) === 3 - owner(p) && !caps.includes(mid) && b[to] === 0) {
      found = true;
      const nb = b.slice(); nb[sq] = 0; nb[to] = p;
      const promotes = !isKing(p) && ((owner(p) === 1 && tr === 0) || (owner(p) === 2 && tr === 7));
      if (promotes) out.push({ from: path[0], path: [...path, to], caps: [...caps, mid] });
      else jumpsFrom(nb, to, p, [...path, to], [...caps, mid], out);
    }
  }
  if (!found && caps.length) out.push({ from: path[0], path, caps });
}
export function moves(s) {
  const caps = [], simple = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = s.b[sq]; if (owner(p) !== s.turn) continue;
    jumpsFrom(s.b, sq, p, [sq], [], caps);
    const r = sq >> 3, c = sq & 7;
    for (const [dr, dc] of dirsFor(p)) {
      const tr = r + dr, tc = c + dc;
      if (inB(tr, tc) && s.b[tr * 8 + tc] === 0) simple.push({ from: sq, path: [sq, tr * 8 + tc], caps: [] });
    }
  }
  return caps.length ? caps : simple;
}
export function apply(s, m) {
  const b = s.b.slice(); let p = b[m.from];
  b[m.from] = 0; m.caps.forEach(x => (b[x] = 0));
  const to = m.path[m.path.length - 1], tr = to >> 3;
  if (p === 1 && tr === 0) p = 3; if (p === 2 && tr === 7) p = 4;
  b[to] = p;
  return { b, turn: 3 - s.turn, quiet: m.caps.length ? 0 : s.quiet + 1, last: { from: m.from, to } };
}
export function result(s) {
  if (s.quiet >= 80) return "draw";
  if (!moves(s).length) return 3 - s.turn; // can't move = lose
  return null;
}

// ---------- bot ----------
function evaluate(s, me) {
  let sc = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s.b[sq]; if (!p) continue;
    const r = sq >> 3, adv = owner(p) === 1 ? 7 - r : r;
    const v = isKing(p) ? 170 : 100 + adv * 4 + ((sq & 7) > 1 && (sq & 7) < 6 ? 3 : 0);
    sc += owner(p) === me ? v : -v;
  }
  return sc;
}
function negamax(s, depth, alpha, beta, me) {
  const ms = moves(s);
  if (!ms.length) return -100000 - depth;
  if (s.quiet >= 80) return 0;
  if (depth === 0) return (s.turn === me ? 1 : -1) * evaluate(s, me);
  let best = -Infinity;
  for (const m of ms) {
    const v = -negamax(apply(s, m), depth - 1, -beta, -alpha, me);
    if (v > best) best = v; if (v > alpha) alpha = v; if (alpha >= beta) break;
  }
  return best;
}
export function bot(s, level = "medium") {
  const ms = moves(s), me = s.turn;
  if (level === "easy" && Math.random() < 0.4) return ms[Math.floor(Math.random() * ms.length)];
  const depth = { easy: 1, medium: 4, hard: 6 }[level] || 4;
  let best = ms[0], bestV = -Infinity;
  for (const m of ms) {
    const v = -negamax(apply(s, m), depth - 1, -Infinity, Infinity, me) + Math.random() * 2;
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}

// ---------- drawing ----------
// ctx: { me, canMove, onMove(move) }. Your pieces are always at the bottom.
let selected = null;
export function render(root, s, ctx) {
  const flip = ctx.me === 2, ms = ctx.canMove ? moves(s) : [];
  if (selected !== null && !ms.some(m => m.from === selected)) selected = null;
  const dests = new Map(ms.filter(m => m.from === selected).map(m => [m.path[m.path.length - 1], m]));
  const board = document.createElement("div"); board.className = "ck-board";
  for (let i = 0; i < 64; i++) {
    const r = flip ? 7 - (i >> 3) : i >> 3, c = flip ? 7 - (i & 7) : i & 7, sq = r * 8 + c, p = s.b[sq];
    const cell = document.createElement("div");
    cell.className = "ck-sq " + ((r + c) % 2 ? "dark" : "light") + (selected === sq ? " sel" : "") +
      (s.last && (s.last.from === sq || s.last.to === sq) ? " last" : "") + (dests.has(sq) ? " dest" : "");
    if (p) {
      const pc = document.createElement("div");
      pc.className = "ck-pc o" + owner(p) + (isKing(p) ? " king" : "");
      if (isKing(p)) pc.textContent = "♛";
      cell.append(pc);
    }
    cell.onclick = () => {
      if (!ctx.canMove) return;
      if (dests.has(sq)) { const m = [...ms.filter(m => m.from === selected && m.path[m.path.length - 1] === sq)].sort((a, b) => b.caps.length - a.caps.length)[0]; selected = null; ctx.onMove(m); return; }
      selected = ms.some(m => m.from === sq) ? sq : null;
      render(root, s, ctx);
    };
    board.append(cell);
  }
  const mustJump = ms.length && ms[0].caps.length;
  root.replaceChildren(board, mustJump && ctx.canMove ? Object.assign(document.createElement("div"), { className: "muted bg-note", textContent: "You must capture this turn." }) : "");
}
