import { db, el, toast } from "./firebase.js";
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Blocked words. Mods keep the list in config/wordFilter. The database checks every message
// against `re` (so it can't be skipped), and this file checks first so people get a clear message.
//   word      → blocks the whole word (also catches "wooord", "w.o.r.d", "w0rd")
//   word*     → also blocks anything starting with it ("word*" blocks "words", "wording")
//   two words → blocks that phrase
export const filter = { words: [], re: null };
const NEVER = "[^\\s\\S]"; // matches nothing

// same swaps the database does
export const normalize = t => String(t || "").toLowerCase()
  .replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/@/g, "a").replace(/\$/g, "s");
const esc = c => c.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");

function wordPattern(w) {
  const prefix = w.endsWith("*");
  const core = normalize(w.replace(/\*+$/, "").trim());
  if (!core) return null;
  const parts = core.split(/\s+/).map(word => [...word].map(c => esc(c) + "+").join("[\\W_]*"));
  return "\\b" + parts.join("[\\W_]+") + (prefix ? "" : "\\b");
}
export function buildRe(words) {
  const alts = words.map(wordPattern).filter(Boolean);
  return alts.length ? "(?s).*(?:" + alts.join("|") + ").*" : NEVER;
}

export function watchWordFilter(cb = () => {}) {
  return onSnapshot(doc(db, "config", "wordFilter"), s => {
    filter.words = s.exists() ? s.data().words || [] : [];
    const alts = filter.words.map(wordPattern).filter(Boolean);
    filter.re = alts.length ? new RegExp("(?:" + alts.join("|") + ")", "s") : null;
    cb();
  }, () => {});
}

// → the blocked word that matched (censored), or null if the text is fine
export function findBlocked(text) {
  if (!filter.re || !text) return null;
  const n = normalize(text);
  for (const w of filter.words) {
    const p = wordPattern(w);
    if (p && new RegExp(p, "s").test(n)) { const c = w.replace(/\*+$/, ""); return c[0] + "*".repeat(Math.max(1, c.length - 1)); }
  }
  return null;
}

async function save(me, words) {
  const clean = [...new Set(words.map(w => w.trim().toLowerCase()).filter(w => w && w.length <= 40))].slice(0, 800).sort();
  await setDoc(doc(db, "config", "wordFilter"), { words: clean, re: buildRe(clean), by: me, at: serverTimestamp() });
}

// ---------- Mod panel tab ----------
export function wordFilterPane(me) {
  const box = el("div", { class: "wf" });
  const input = el("textarea", { class: "input", rows: 3, placeholder: "Add words, one per line or separated by commas.\nEnd with * to also block longer forms, e.g.  word*" });
  const test = el("input", { class: "input", placeholder: "Test a sentence…" });
  const result = el("div", { class: "muted", style: { minHeight: "20px", marginTop: "6px" } });
  const list = el("div", { class: "wf-list" });
  let reveal = false;
  const add = async () => {
    const add = input.value.split(/[\n,]+/).map(w => w.trim()).filter(Boolean);
    if (!add.length) return;
    try { await save(me, [...filter.words, ...add]); input.value = ""; toast(`Blocked ${add.length} word${add.length === 1 ? "" : "s"}`); }
    catch (err) { toast("Couldn't save: " + (err.code || err.message)); }
  };
  const draw = () => {
    list.replaceChildren(...(filter.words.length ? filter.words.map(w => el("span", { class: "wf-chip" },
      reveal ? w : w[0] + "•".repeat(Math.max(1, w.length - 1)),
      el("button", { type: "button", title: "Remove", onclick: () => save(me, filter.words.filter(x => x !== w)).catch(err => toast(err.message)) }, "×")))
      : [el("div", { class: "muted" }, "No blocked words yet.")]));
  };
  test.oninput = () => { const hit = findBlocked(test.value); result.textContent = !test.value ? "" : hit ? `🚫 Would be blocked (${hit})` : "✓ Would be allowed"; result.style.color = hit ? "var(--danger)" : ""; };
  box.append(
    el("p", { class: "muted", style: { marginTop: 0 } }, "Messages with these words can't be sent anywhere (Announcements, channels, DMs, captions). The database checks it too, so it can't be skipped. Look-alikes like 0→o, 1→i, @→a, $→s, stretched letters (“wooord”) and dots between letters are caught."),
    input, el("div", { class: "row", style: { margin: "8px 0 16px" } },
      el("button", { class: "btn primary sm", type: "button", onclick: add }, "🚫 Block"),
      el("button", { class: "btn sm ghost", type: "button", onclick: e => { reveal = !reveal; e.currentTarget.textContent = reveal ? "🙈 Hide words" : "👁 Show words"; draw(); } }, "👁 Show words")),
    el("div", { class: "lbl" }, "Blocked words"), list,
    el("div", { class: "lbl" }, "Try it"), test, result);
  draw();
  return { box, draw };
}
