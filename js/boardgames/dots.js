// Dots & Boxes on a 4×4 grid of boxes. Finish a box → you score it and go again.
const N = 4, H = (N + 1) * N, V = N * (N + 1), L = H + V;
export const meta = { id: "dots", name: "Dots & Boxes", icon: "▦", desc: "Close boxes, most boxes wins", p1: "Blue", p2: "Pink" };

export const init = () => ({ lines: Array(L).fill(0), boxes: Array(N * N).fill(0), turn: 1, last: null });
export const current = s => s.turn;
export const moves = s => s.lines.map((v, i) => (v ? -1 : i)).filter(i => i >= 0);

// which lines surround box (r,c)
const boxLines = (r, c) => [r * N + c, (r + 1) * N + c, H + r * (N + 1) + c, H + r * (N + 1) + c + 1];
// which boxes touch line i
function boxesOf(i) {
  const out = [];
  if (i < H) { const r = Math.floor(i / N), c = i % N; if (r > 0) out.push([r - 1, c]); if (r < N) out.push([r, c]); }
  else { const j = i - H, r = Math.floor(j / (N + 1)), c = j % (N + 1); if (c > 0) out.push([r, c - 1]); if (c < N) out.push([r, c]); }
  return out;
}
const sides = (lines, r, c) => boxLines(r, c).filter(i => lines[i]).length;

export function apply(s, line) {
  if (s.lines[line]) throw new Error("Taken");
  const lines = s.lines.slice(), boxes = s.boxes.slice();
  lines[line] = s.turn;
  let scored = false;
  for (const [r, c] of boxesOf(line)) if (sides(lines, r, c) === 4 && !boxes[r * N + c]) { boxes[r * N + c] = s.turn; scored = true; }
  return { lines, boxes, turn: scored ? s.turn : 3 - s.turn, last: line };
}
export const score = s => [1, 2].map(p => s.boxes.filter(b => b === p).length);
export function result(s) {
  if (s.lines.some(x => !x)) return null;
  const [a, b] = score(s);
  return a === b ? "draw" : a > b ? 1 : 2;
}

// ---------- bot ----------
const completes = (s, i) => boxesOf(i).some(([r, c]) => sides(s.lines, r, c) === 3);
const gives = (s, i) => boxesOf(i).some(([r, c]) => sides(s.lines, r, c) === 2);
// how many boxes the opponent could grab in a row after we play i
function chainAfter(s, i) {
  let t = apply(s, i), n = 0;
  while (t.turn !== s.turn && !result(t)) {
    const take = moves(t).find(j => completes(t, j)); if (take === undefined) break;
    t = apply(t, take); n++;
  }
  return n;
}
export function bot(s, level = "medium") {
  const ms = moves(s), rnd = a => a[Math.floor(Math.random() * a.length)];
  const take = ms.filter(i => completes(s, i));
  if (level === "easy") return take.length && Math.random() < 0.6 ? rnd(take) : rnd(ms);
  if (take.length) return rnd(take);
  const safe = ms.filter(i => !gives(s, i));
  if (safe.length) return rnd(safe);
  if (level === "medium") return rnd(ms);
  // hard: give away the smallest chain
  let best = ms[0], bestN = Infinity;
  for (const i of ms) { const n = chainAfter(s, i); if (n < bestN) { bestN = n; best = i; } }
  return best;
}

// ---------- drawing ----------
export function render(root, s, ctx) {
  const g = document.createElement("div"); g.className = "db-grid";
  g.style.gridTemplateColumns = `repeat(${N}, 14px 1fr) 14px`;
  g.style.gridTemplateRows = `repeat(${N}, 14px 1fr) 14px`;
  for (let R = 0; R <= 2 * N; R++) for (let C = 0; C <= 2 * N; C++) {
    const d = document.createElement(R % 2 === 0 && C % 2 === 0 ? "div" : (R % 2) !== (C % 2) ? "button" : "div");
    if (R % 2 === 0 && C % 2 === 0) d.className = "db-dot";
    else if (R % 2 === 0) { // horizontal line
      const i = (R / 2) * N + (C - 1) / 2; lineBtn(d, i, "h");
    } else if (C % 2 === 0) { // vertical line
      const i = H + ((R - 1) / 2) * (N + 1) + C / 2; lineBtn(d, i, "v");
    } else { const o = s.boxes[((R - 1) / 2) * N + (C - 1) / 2]; d.className = "db-box" + (o ? " p" + o : ""); if (o) d.textContent = o === ctx.me ? "You" : ""; }
    g.append(d);
  }
  function lineBtn(d, i, dir) {
    d.type = "button";
    d.className = `db-line ${dir}` + (s.lines[i] ? " on p" + s.lines[i] : "") + (i === s.last ? " last" : "");
    d.disabled = !ctx.canMove || !!s.lines[i];
    d.setAttribute("aria-label", "Draw line");
    d.onclick = () => ctx.onMove(i);
  }
  const [a, b] = score(s);
  const sc = document.createElement("div"); sc.className = "db-score";
  sc.innerHTML = `<span class="p1">● ${a}</span><span class="p2">● ${b}</span>`;
  root.replaceChildren(sc, g);
}
