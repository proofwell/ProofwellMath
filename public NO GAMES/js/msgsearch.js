import { db, el, avatar, toast } from "./firebase.js";
import { collection, query, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 🔍 Search the words in a DM or channel. Loads the whole conversation once when you open the
// search (one read per message), then searches it instantly as you type.
// opts: { path: ["dms", id] | ["channels", id], title, me, other, lookup, isBlocked, onJump(id) → true if it could scroll there }
let panel = null;
export function openSearch(opts) {
  closeSearch();
  const input = el("input", { class: "input", placeholder: "Search messages…", type: "search" });
  const who = el("select", { class: "input search-who" },
    el("option", { value: "" }, "Anyone"), el("option", { value: opts.me }, "Sent by me"),
    opts.other ? el("option", { value: opts.other }, "Sent by " + opts.lookup(opts.other).name) : null);
  const info = el("div", { class: "muted search-info" }, "Loading messages…");
  const results = el("div", { class: "search-results" });
  panel = el("aside", { class: "search-panel" },
    el("div", { class: "search-head" }, el("b", {}, "🔍 Search " + opts.title), el("button", { class: "icon-btn", title: "Close (Esc)", onclick: closeSearch }, "✕")),
    el("div", { class: "search-tools" }, input, who), info, results);
  document.querySelector(".main").append(panel);
  document.querySelector(".app").classList.add("searching");
  const onKey = e => { if (e.key === "Escape" && panel) closeSearch(); };
  document.addEventListener("keydown", onKey);
  panel.__off = () => document.removeEventListener("keydown", onKey);
  setTimeout(() => input.focus(), 30);

  let all = [];
  getDocs(query(collection(db, ...opts.path, "messages"), orderBy("createdAt", "desc"))).then(s => {
    all = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.text && !opts.isBlocked(m.uid));
    run();
  }).catch(err => { info.textContent = "Couldn't load messages: " + (err.code || err.message); });

  let t;
  input.oninput = () => { clearTimeout(t); t = setTimeout(run, 120); };
  who.onchange = run;
  function run() {
    if (!panel) return;
    const q = input.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    if (!words.length) { info.textContent = `${all.length} messages — type to search`; results.replaceChildren(); return; }
    const hits = all.filter(m => (!who.value || m.uid === who.value) && words.every(w => m.text.toLowerCase().includes(w)));
    info.textContent = `${hits.length} result${hits.length === 1 ? "" : "s"}`;
    results.replaceChildren(...hits.slice(0, 200).map(m => {
      const u = opts.lookup(m.uid), at = m.createdAt?.toDate?.();
      return el("button", { class: "search-hit", type: "button", onclick: () => { if (!opts.onJump(m.id)) toast("That message is too far back to jump to — it's shown here in the search."); } },
        el("div", { class: "search-hit-top" }, avatar(u, 22), el("b", { style: { color: u.nameColor } }, u.name),
          el("span", { class: "muted" }, at ? at.toLocaleDateString(undefined, { month: "short", day: "numeric", year: at.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }) + " " + at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "")),
        highlight(m.text, words));
    }));
  }
}
export function closeSearch() {
  if (!panel) return;
  panel.__off?.(); panel.remove(); panel = null;
  document.querySelector(".app")?.classList.remove("searching");
}
// the matching words in bold
function highlight(text, words) {
  const box = el("div", { class: "search-text" });
  const re = new RegExp("(" + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
  let last = 0, m, shown = text.length > 300 ? text.slice(0, 300) + "…" : text;
  while ((m = re.exec(shown))) { box.append(shown.slice(last, m.index), el("mark", {}, m[0])); last = m.index + m[0].length; if (!m[0]) re.lastIndex++; }
  box.append(shown.slice(last));
  return box;
}
