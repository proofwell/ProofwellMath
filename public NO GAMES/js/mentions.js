import { el, avatar } from "./firebase.js";

// ---------- show @Name in messages as a colored, clickable chip ----------
// people: [[uid, profile]]; returns an element with the text and mention chips.
export function richText(text, { people, me, onProfile }) {
  const out = el("div", { class: "msg-text" });
  if (!text) return out;
  const names = people.map(([uid, u]) => [uid, u.name || ""]).filter(([, n]) => n).sort((a, b) => b[1].length - a[1].length);
  let i = 0, buf = "";
  const flush = () => { if (buf) { out.append(buf); buf = ""; } };
  while (i < text.length) {
    if (text[i] === "@" && (i === 0 || /[\s(]/.test(text[i - 1]))) {
      const rest = text.slice(i + 1).toLowerCase();
      if (rest.startsWith("everyone") && !/\w/.test(rest[8] || "")) {
        flush(); out.append(el("span", { class: "mention everyone" }, "@everyone")); i += 9; continue;
      }
      const hit = names.find(([, n]) => rest.startsWith(n.toLowerCase()) && !/[\w]/.test(rest[n.length] || ""));
      if (hit) {
        flush();
        const [uid, n] = hit;
        out.append(el("button", { type: "button", class: "mention" + (uid === me ? " me" : ""), onclick: e => { e.stopPropagation(); onProfile(uid); } }, "@" + n));
        i += 1 + n.length; continue;
      }
    }
    buf += text[i++];
  }
  flush();
  return out;
}

export function mentionsUid(text, name) {
  if (!text || !name) return false;
  const t = text.toLowerCase(), n = "@" + name.toLowerCase();
  let at = t.indexOf(n);
  while (at >= 0) {
    if ((at === 0 || /[\s(]/.test(t[at - 1])) && !/\w/.test(t[at + n.length] || "")) return true;
    at = t.indexOf(n, at + 1);
  }
  return false;
}

// ---------- the @ autocomplete popup above the message box ----------
// getPeople() → [[uid, profile]] that can be mentioned here. nameEl(uid) → colored name.
export function attachMentions(input, { getPeople, nameEl, anchor }) {
  const pop = el("div", { class: "mention-pop", hidden: true });
  anchor.append(pop);
  let items = [], sel = 0, start = -1;

  function query() {
    const pos = input.selectionStart, before = input.value.slice(0, pos);
    const m = /(^|[\s(])@([^\s@]{0,24}(?: [^\s@]{0,24})?)$/.exec(before);
    if (!m) return null;
    return { start: pos - m[2].length - 1, q: m[2].toLowerCase() };
  }
  function close() { pop.hidden = true; items = []; start = -1; }
  function draw() {
    const q = query();
    if (!q) return close();
    start = q.start;
    const people = getPeople().filter(([, u]) => (u.name || "").toLowerCase().startsWith(q.q) || (q.q.length > 1 && (u.name || "").toLowerCase().includes(q.q)))
      .sort((a, b) => a[1].name.localeCompare(b[1].name)).slice(0, 8);
    items = people;
    if (!items.length) return close();
    sel = Math.min(sel, items.length - 1);
    pop.replaceChildren(el("div", { class: "mention-pop-h" }, "Members"), ...items.map(([uid, u], i) =>
      el("button", { type: "button", class: "mention-opt" + (i === sel ? " sel" : ""),
        onmousedown: e => { e.preventDefault(); pick(i); }, onmouseenter: () => { sel = i; mark(); } },
        avatar(u, 24), nameEl(uid), u.pronouns ? el("span", { class: "muted" }, u.pronouns) : null)));
    pop.hidden = false;
  }
  function mark() { [...pop.querySelectorAll(".mention-opt")].forEach((b, i) => b.classList.toggle("sel", i === sel)); }
  function pick(i) {
    const [, u] = items[i]; if (!u) return;
    const pos = input.selectionStart, v = input.value;
    const ins = "@" + u.name + " ";
    input.value = v.slice(0, start) + ins + v.slice(pos);
    const c = start + ins.length; input.setSelectionRange(c, c);
    close(); input.dispatchEvent(new Event("input")); input.focus();
  }
  input.addEventListener("input", () => { sel = 0; draw(); });
  input.addEventListener("click", draw);
  input.addEventListener("blur", () => setTimeout(close, 120));
  // call this first from the message box's keydown; true = the @ list used the key
  function handleKey(e) {
    if (pop.hidden || !items.length) return false;
    if (e.key === "ArrowDown") { sel = (sel + 1) % items.length; mark(); }
    else if (e.key === "ArrowUp") { sel = (sel - 1 + items.length) % items.length; mark(); }
    else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") pick(sel);
    else if (e.key === "Escape") close();
    else return false;
    e.preventDefault(); return true;
  }
  return { close, handleKey, isOpen: () => !pop.hidden };
}
