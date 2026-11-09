// Math problem generator. Difficulty follows XP: one new topic per level (20 XP),
// and numbers grow a little within each level. Older topics keep coming back as review.

export const XP_PER_LEVEL = 20;
export const levelOf = xp => Math.floor((xp || 0) / XP_PER_LEVEL) + 1;
export const xpIntoLevel = xp => (xp || 0) % XP_PER_LEVEL;

const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));         // random int a..b
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const nz = (a, b) => { let x; do { x = R(a, b); } while (x === 0); return x; }; // non-zero
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
const neg = n => (n < 0 ? "−" + Math.abs(n) : String(n));                 // nice minus sign
const sgn = n => (n < 0 ? " − " + Math.abs(n) : " + " + n);              // "+ 3" / "− 3"
const frac = (n, d) => { const g = gcd(n, d); n /= g; d /= g; if (d < 0) { n = -n; d = -d; } return { n, d }; };
const fracStr = f => (f.d === 1 ? neg(f.n) : `${neg(f.n)}/${f.d}`);

// t = 0..1 progress inside the level (makes numbers a bit bigger as you go)
export const TOPICS = [
  { name: "Adding",                 gen: t => { const a = R(1, 5 + 5 * t | 0), b = R(1, 5 + 4 * t | 0); return q(`${a} + ${b}`, a + b); } },
  { name: "Adding & subtracting",   gen: t => { const a = R(5, 12 + 8 * t | 0), b = R(1, a); return Math.random() < .5 ? q(`${a} + ${b}`, a + b) : q(`${a} − ${b}`, a - b); } },
  { name: "Two-digit numbers",      gen: t => { const a = R(12, 60 + 39 * t | 0), b = R(10, 50 + 30 * t | 0); return Math.random() < .5 ? q(`${a} + ${b}`, a + b) : q(`${Math.max(a, b)} − ${Math.min(a, b)}`, Math.abs(a - b)); } },
  { name: "Times tables",           gen: t => { const a = R(2, 6 + 6 * t | 0), b = R(2, 9 + 3 * t | 0); return q(`${a} × ${b}`, a * b); } },
  { name: "Division",               gen: t => { const b = R(2, 9 + 3 * t | 0), a = R(2, 9 + 3 * t | 0); return q(`${a * b} ÷ ${b}`, a); } },
  { name: "Order of operations",    gen: t => {
      const a = R(2, 12), b = R(2, 9), c = R(2, 6 + 4 * t | 0);
      return pick([q(`${a} + ${b} × ${c}`, a + b * c), q(`(${a} + ${b}) × ${c}`, (a + b) * c), q(`${a * c} ÷ ${c} + ${b}`, a + b)]); } },
  { name: "Negative numbers",       gen: t => {
      const a = nz(-12 - 8 * t | 0, 12), b = nz(-12, 12 + 8 * t | 0);
      return pick([q(`${neg(a)} + ${b < 0 ? "(" + neg(b) + ")" : b}`, a + b), q(`${neg(a)} − ${b < 0 ? "(" + neg(b) + ")" : b}`, a - b), q(`${neg(a)} × ${b < 0 ? "(" + neg(b) + ")" : b}`, a * b)]); } },
  { name: "Fractions",              gen: t => {
      const d = pick([2, 3, 4, 5, 6, 8, 10, 12]), a = R(1, d - 1), b = R(1, d);
      if (Math.random() < .5) { const f = frac(a + b, d); return q(`${a}/${d} + ${b}/${d}`, f, "Simplify your answer, e.g. 3/4 or 2"); }
      const d2 = pick([2, 3, 4, 5]), f = frac(a * d2 + 1 * d, d * d2);
      return q(`${a}/${d} + 1/${d2}`, f, "Find a common denominator. Answer as a fraction like 5/6"); } },
  { name: "Decimals",               gen: t => {
      const a = R(1, 90 + 60 * t | 0) / 10, b = R(1, 50) / 10;
      return pick([q(`${a} + ${b}`, +(a + b).toFixed(2)), q(`${Math.max(a, b)} − ${Math.min(a, b)}`, +Math.abs(a - b).toFixed(2)), q(`${a} × 10`, +(a * 10).toFixed(2))]); } },
  { name: "Percents",               gen: t => { const p = pick([10, 20, 25, 50, 75, 5, 15, 40]), base = pick([20, 40, 60, 80, 100, 120, 200, 240, 300, 400]); return q(`${p}% of ${base}`, base * p / 100); } },
  { name: "One-step equations",     gen: t => {
      const x = R(-5, 15 + 10 * t | 0), a = nz(2, 9), b = R(1, 20);
      return pick([q(`x + ${b} = ${x + b}`, x, null, "x"), q(`x − ${b} = ${neg(x - b)}`, x, null, "x"), q(`${a}x = ${neg(a * x)}`, x, null, "x")]); } },
  { name: "Two-step equations",     gen: t => { const x = R(-8, 12 + 8 * t | 0), a = nz(2, 9), b = nz(-15, 15); return q(`${a}x${sgn(b)} = ${neg(a * x + b)}`, x, null, "x"); } },
  { name: "Exponents & roots",      gen: t => {
      const b = R(2, 12 + 3 * t | 0), c = R(2, 5), e = R(3, 9);
      return pick([q(`${b}²`, b * b), q(`√${b * b}`, b), q(`${c}³`, c ** 3), q(`2^${e}`, 2 ** e)]); } },
  { name: "Geometry",               gen: t => {
      const [a, b, c] = pick([[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [7, 24, 25]]);
      const w = R(3, 15), h = R(3, 12), r = R(2, 9);
      return pick([
        q(`Right triangle, legs ${a} and ${b}. Hypotenuse?`, c),
        q(`Rectangle ${w} by ${h}. Area?`, w * h),
        q(`Rectangle ${w} by ${h}. Perimeter?`, 2 * (w + h)),
        q(`Triangle, base ${w * 2} and height ${h}. Area?`, w * h),
        q(`Circle, radius ${r}. Area? (use π ≈ 3.14, round to 1 decimal)`, +(3.14 * r * r).toFixed(1)),
      ]); } },
  { name: "Variables on both sides", gen: t => {
      const x = R(-6, 10 + 6 * t | 0), a = R(3, 9), c = R(1, a - 1), b = R(-12, 12);
      const d = a * x + b - c * x;
      return q(`${a}x${sgn(b)} = ${c}x${sgn(d)}`, x, null, "x"); } },
  { name: "Functions & slope",      gen: t => {
      if (Math.random() < .5) {
        const m = nz(-5, 6), x1 = R(-4, 4), y1 = R(-6, 6), dx = R(1, 5);
        return q(`Slope through (${neg(x1)}, ${neg(y1)}) and (${neg(x1 + dx)}, ${neg(y1 + m * dx)})`, m, null, "m");
      }
      const a = nz(-3, 4), b = R(-9, 9), c = R(-5, 5), x = R(-4, 5);
      return q(`f(x) = ${a}x²${sgn(b)}x${sgn(c)}.  f(${neg(x)}) = ?`, a * x * x + b * x + c); } },
  { name: "Systems of equations",   gen: t => {
      const x = R(-6, 12), y = R(-6, 12), a = R(1, 4), b = R(1, 4);
      return q(`${a === 1 ? "" : a}x + ${b === 1 ? "" : b}y = ${neg(a * x + b * y)}\nx − y = ${neg(x - y)}\nFind x`, x, null, "x"); } },
  { name: "Quadratics",             gen: t => {
      let r1 = R(-9, 9), r2 = R(-9, 9); if (r1 === r2) r2 += 2;
      const B = -(r1 + r2), C = r1 * r2;
      const eq = `x²${B === 0 ? "" : sgn(B) + "x"}${C === 0 ? "" : sgn(C)} = 0`.replace(/([+−]) 1x/, "$1 x");
      return q(`${eq}\nWhat's the larger solution?`, Math.max(r1, r2), "Factor it into (x − a)(x − b)", "x"); } },
  { name: "Logarithms",             gen: t => {
      const base = pick([2, 3, 5, 10]), e = R(1, base === 2 ? 10 : base === 10 ? 5 : 4);
      return Math.random() < .5 ? q(`log${sub(base)}(${base ** e})`, e) : q(`${base}^x = ${base ** e}`, e, null, "x"); } },
  { name: "Mixed challenge",        gen: t => {
      const i = R(5, TOPICS.length - 2); const p = TOPICS[i].gen(1);
      return { ...p, topic: "Mixed challenge · " + TOPICS[i].name }; } },
];
function sub(n) { return String(n).replace(/\d/g, d => "₀₁₂₃₄₅₆₇₈₉"[d]); }

function q(text, answer, hint = null, variable = null) {
  return { text, answer, hint, variable };
}

// Make a problem for this much XP. 65% current topic, 35% review of earlier topics.
export function makeProblem(xp) {
  const lvl = levelOf(xp), top = Math.min(lvl, TOPICS.length) - 1;
  const t = lvl > TOPICS.length ? 1 : xpIntoLevel(xp) / XP_PER_LEVEL;
  const i = top === 0 || Math.random() < 0.65 ? top : R(Math.max(0, top - 6), top - 1);
  const p = TOPICS[i].gen(i === top ? t : 1);
  return { topic: p.topic || TOPICS[i].name, ...p, level: i + 1 };
}

// A problem from one chosen topic (Skills page). Full difficulty for topics you've passed.
export function makeTopicProblem(i, xp) {
  const lvl = levelOf(xp), cur = Math.min(lvl, TOPICS.length) - 1;
  const t = i < cur || lvl > TOPICS.length ? 1 : xpIntoLevel(xp) / XP_PER_LEVEL;
  const p = TOPICS[i].gen(t);
  return { topic: p.topic || TOPICS[i].name, ...p, level: i + 1 };
}

// XP for a correct answer: harder topics give more, and every 5 in a row adds a streak bonus.
// Max 6 (the database checks this). Second-try answers give 1.
export function xpFor(problem, streak, firstTry) {
  if (!firstTry) return { total: 1, base: 1, bonus: 0 };
  const base = 1 + Math.floor(((problem.level || 1) - 1) / 5);   // 1 → 4
  const bonus = Math.min(2, Math.floor(streak / 5));             // +1 at 5 in a row, +2 at 10
  return { total: Math.min(6, base + bonus), base, bonus };
}

// ---------- checking answers ----------
// Accepts 12, -12, −12, 2.5, 3/4, "x = 5", spaces etc.
export function parseAnswer(s) {
  s = String(s || "").trim().replace(/−/g, "-").replace(/^[a-z]\s*=\s*/i, "").replace(/\s+/g, "").replace(/,/g, "");
  if (!s) return null;
  let m = s.match(/^(-?\d+)\/(-?\d+)$/);
  if (m) { const d = +m[2]; return d === 0 ? null : { n: +m[1], d }; }
  if (/^-?\d*\.?\d+$/.test(s)) return { n: parseFloat(s), d: 1 };
  return null;
}
export function isCorrect(problem, input) {
  const a = parseAnswer(input); if (!a) return false;
  const want = typeof problem.answer === "object" ? problem.answer : { n: problem.answer, d: 1 };
  return Math.abs(a.n / a.d - want.n / want.d) < 1e-6;
}
export function answerText(problem) {
  return typeof problem.answer === "object" ? fracStr(problem.answer) : neg(problem.answer);
}
