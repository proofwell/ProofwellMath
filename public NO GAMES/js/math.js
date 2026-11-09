import { auth, db, el, avatar, toast } from "./firebase.js";
import { openModal } from "./ui.js";
import { startMinuteXp } from "./minutexp.js";
import { TOPICS, makeProblem, makeTopicProblem, xpFor, isCorrect, answerText, levelOf, xpIntoLevel, XP_PER_LEVEL } from "./mathgen.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, onSnapshot, updateDoc, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
let guest = false, user = null, profile = null;
let xp = 0, pendingXp = 0;              // pendingXp = earned but not saved yet
let problem = null, tries = 0, streak = 0, focusTopic = null, startedAt = 0, timerInt = null, nextTimer = null;
const dayKey = d => d.toISOString().slice(0, 10);
const today = dayKey(new Date());

// today's stats + all-time stats (both only on this device)
let stats = { day: today, solved: 0, attempts: 0, best: 0, xp: 0 };
{ const s = store.get("mathStats", null); if (s && s.day === today) stats = { ...stats, ...s }; else if (s) stats.best = s.best || 0; }
const all = store.get("mathAll", { solved: 0, attempts: 0, best: 0, xp: 0, byTopic: {}, days: {}, fastest: null });
const saveStats = () => { store.set("mathStats", stats); store.set("mathAll", all); };

// ---------- settings (saved per device) ----------
const PDEF = { sound: true, timer: false, advance: "normal", hints: true, theme: "paper", size: 100, readable: false, goal: 20,
  grade: "Not set", language: "English (US)", emails: false, reminders: false, showPath: true, confetti: true, keys: true };
const prefs = { ...PDEF, ...store.get("mathPrefs", {}) };
const savePrefs = () => { store.set("mathPrefs", prefs); applyPrefs(); };
function applyPrefs() {
  document.body.dataset.mtheme = prefs.theme;
  document.body.classList.toggle("m-readable", !!prefs.readable);
  document.documentElement.style.fontSize = prefs.size + "%";
  document.querySelector(".m-path")?.toggleAttribute("hidden", !prefs.showPath);
  document.querySelector(".m-main")?.classList.toggle("no-path", !prefs.showPath);
  if ($("timer")) $("timer").hidden = !prefs.timer;
  if ($("hint-btn") && !prefs.hints) $("hint-btn").hidden = true;
}
applyPrefs();

// tiny sound effects (no files)
let actx = null;
function beep(ok) {
  if (!prefs.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = ok ? [660, 880] : [300, 220];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * .09;
      o.frequency.value = f; o.type = "sine"; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .16);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .18);
    });
  } catch {}
}

// ---------- who's here ----------
onAuthStateChanged(auth, u => {
  let isGuest = false; try { isGuest = sessionStorage.getItem("guest") === "1"; } catch {}
  if (!u && !isGuest) { location.replace("signin.html"); return; }
  if (!u) {
    guest = true;
    try { xp = Number(localStorage.getItem("guestXp") || 0); } catch {}
    $("guest-banner").hidden = false;
    $("guest-signin").onclick = () => { try { sessionStorage.removeItem("guest"); } catch {} };
    start();
    return;
  }
  user = u;
  let first = true;
  onSnapshot(doc(db, "users", u.uid), s => {
    if (!s.exists()) { location.replace("signin.html"); return; }
    profile = s.data();
    xp = (profile.xp || 0);
    renderXp(); renderProfileBtn();
    if (first) { first = false; start(); }
  }, () => location.replace("signin.html"));
});

function start() {
  renderXp(); renderProfileBtn(); renderPath(); renderStats();
  startMinuteXp(guest ? { guest: true, onGuestXp: () => { xp++; try { localStorage.setItem("guestXp", String(xp)); } catch {} renderXp(); } } : { uid: user.uid });
  next();
  route();
  document.body.classList.remove("loading");
}

// ---------- pages ----------
const PAGES = ["practice", "skills", "progress", "settings", "help", "privacy", "terms"];
function route() {
  const page = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const p = PAGES.includes(page) ? page : "practice";
  document.querySelectorAll(".m-page").forEach(s => (s.hidden = s.dataset.page !== p));
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === p));
  if (p === "skills") renderSkills();
  if (p === "progress") renderProgress();
  if (p === "settings") renderSettings();
  if (p === "practice") setTimeout(() => $("answer").focus(), 0);
  window.scrollTo({ top: 0 });
}
addEventListener("hashchange", route);

// ---------- XP ----------
const shownXp = () => xp + pendingXp;
function renderXp() {
  const x = shownXp();
  $("lvl").textContent = "Lv " + levelOf(x);
  $("bar").style.width = (xpIntoLevel(x) / XP_PER_LEVEL * 100) + "%";
  $("xptext").textContent = `${xpIntoLevel(x)} / ${XP_PER_LEVEL} XP`;
  renderPath();
}
// The database accepts one XP save every 2 seconds (+1 to +6), so saves wait their turn.
let saveChain = Promise.resolve(), lastSave = 0;
function awardXp(n) {
  const lvlBefore = levelOf(shownXp());
  if (guest) {
    xp += n; try { localStorage.setItem("guestXp", String(xp)); } catch {}
  } else {
    pendingXp += n;
    saveChain = saveChain.then(async () => {
      const wait = 2100 - (Date.now() - lastSave);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      try { await updateDoc(doc(db, "users", user.uid), { xp: increment(n), lastXpAt: serverTimestamp() }); }
      catch { toast("Couldn't save XP — check your connection."); }
      lastSave = Date.now(); pendingXp -= n; renderXp();
    });
  }
  stats.xp += n; all.xp += n;
  renderXp();
  if (levelOf(shownXp()) > lvlBefore) levelUp(levelOf(shownXp()));
}
function levelUp(lvl) {
  const t = TOPICS[Math.min(lvl, TOPICS.length) - 1];
  const box = el("div", { class: "m-levelup" }, el("div", { class: "m-levelup-n" }, "Level " + lvl),
    el("div", {}, lvl <= TOPICS.length ? "New skill unlocked: " + t.name : "Mixed challenges — keep going!"));
  document.body.append(box); setTimeout(() => box.remove(), 2600);
  if (prefs.confetti) confetti();
}
function confetti() {
  const c = el("div", { class: "m-confetti" });
  for (let i = 0; i < 40; i++) c.append(el("i", { style: { left: Math.random() * 100 + "%", background: ["#2f6b4f", "#e0a526", "#c2410c", "#3b82f6", "#9333ea"][i % 5],
    animationDelay: Math.random() * .4 + "s", transform: `rotate(${Math.random() * 360}deg)` } }));
  document.body.append(c); setTimeout(() => c.remove(), 2200);
}

// ---------- problems ----------
function next() {
  clearTimeout(nextTimer); $("next-btn").hidden = true;
  problem = focusTopic != null ? makeTopicProblem(focusTopic, shownXp()) : makeProblem(shownXp()); tries = 0;
  $("topic").textContent = problem.topic;
  const w = xpFor(problem, streak + 1, true);
  $("worth").textContent = `+${w.total} XP`; $("worth").title = w.bonus ? `${w.base} XP + ${w.bonus} streak bonus` : "XP for getting this right on the first try";
  $("focus").hidden = focusTopic == null;
  if (focusTopic != null) $("focus").replaceChildren("Focus: " + TOPICS[focusTopic].name + " ", el("button", { type: "button", title: "Back to your path", onclick: () => { focusTopic = null; next(); } }, "×"));
  $("question").textContent = problem.text;
  $("var").hidden = !problem.variable; $("var").textContent = (problem.variable || "x") + " =";
  $("answer").value = ""; $("answer").disabled = false; $("check").disabled = false;
  $("feedback").textContent = ""; $("feedback").className = "m-feedback";
  $("hint-btn").hidden = !prefs.hints; $("hint-btn").disabled = false;
  startedAt = Date.now(); clearInterval(timerInt);
  if (prefs.timer) { $("timer").textContent = "0s"; timerInt = setInterval(() => ($("timer").textContent = Math.floor((Date.now() - startedAt) / 1000) + "s"), 500); }
  $("answer").focus();
}
function after(ms) {
  clearInterval(timerInt);
  if (prefs.advance === "off") { $("next-btn").hidden = false; $("next-btn").focus(); return; }
  nextTimer = setTimeout(next, prefs.advance === "fast" ? ms * .5 : ms);
}
$("next-btn").onclick = next;

function topicStat(name) { return (all.byTopic[name] ||= { s: 0, a: 0 }); }
$("answer-form").onsubmit = e => {
  e.preventDefault();
  const v = $("answer").value.trim();
  if (!v || $("check").disabled) return;
  tries++; stats.attempts++; all.attempts++;
  const ts = topicStat(TOPICS[problem.level - 1]?.name || problem.topic); ts.a++;
  if (isCorrect(problem, v)) {
    const first = tries === 1;
    if (first) streak++;
    stats.solved++; all.solved++; ts.s++; all.days[today] = (all.days[today] || 0) + 1;
    stats.best = Math.max(stats.best, streak); all.best = Math.max(all.best || 0, streak);
    const secs = (Date.now() - startedAt) / 1000; if (first && (!all.fastest || secs < all.fastest)) all.fastest = Math.round(secs * 10) / 10;
    const w = xpFor(problem, streak, first);
    awardXp(w.total); beep(true);
    feedback("ok", `${pick(["Correct!", "Nice!", "That's right!", "Yes!", "Great work!"])} +${w.total} XP` + (w.bonus ? ` (🔥 +${w.bonus} streak bonus)` : ""));
    $("answer").disabled = true; $("check").disabled = true;
    after(1100);
    if (stats.solved === prefs.goal) setTimeout(() => toast(`🎯 Daily goal reached: ${prefs.goal} problems!`), 400);
  } else if (tries < 2) {
    beep(false);
    feedback("bad", "Not quite — try once more.");
    $("answer").select();
  } else {
    streak = 0; beep(false);
    feedback("bad", `The answer was ${answerText(problem)}. No XP this time.`);
    $("answer").disabled = true; $("check").disabled = true;
    after(2200);
  }
  saveStats(); renderStats();
};
$("skip-btn").onclick = () => { streak = 0; renderStats(); next(); };
$("hint-btn").onclick = () => {
  feedback("hint", "💡 " + (problem.hint || hintFor(problem.topic)));
  $("hint-btn").disabled = true;
};
document.addEventListener("keydown", e => {
  if (!prefs.keys || document.querySelector(".overlay")) return;
  if (e.key === "Enter" && !$("next-btn").hidden && document.activeElement !== $("next-btn")) { e.preventDefault(); next(); }
  if ((e.key === "h" || e.key === "H") && document.activeElement === $("answer") && !$("answer").value && !$("hint-btn").hidden && !$("hint-btn").disabled) { e.preventDefault(); $("hint-btn").click(); }
});
function hintFor(topic) {
  if (/equation/i.test(topic)) return "Do the same thing to both sides until x is alone.";
  if (/Order/.test(topic)) return "Parentheses first, then × and ÷, then + and −.";
  if (/Percent/.test(topic)) return "10% is the number ÷ 10. Build from there.";
  if (/Negative/.test(topic)) return "Subtracting a negative is the same as adding.";
  if (/Geometry/.test(topic)) return "Hypotenuse: a² + b² = c². Area of a triangle: ½ × base × height.";
  if (/slope/i.test(topic)) return "Slope = (change in y) ÷ (change in x).";
  if (/Log/.test(topic)) return "log_b(n) asks: b to what power gives n?";
  if (/Exponent/.test(topic)) return "x² means x × x. √ asks what number squared gives this.";
  return "Take it one step at a time — you've got this.";
}
const pick = a => a[Math.floor(Math.random() * a.length)];
function feedback(kind, text) { $("feedback").textContent = text; $("feedback").className = "m-feedback " + kind; }
function renderStats() {
  $("streak").textContent = streak >= 2 ? `🔥 ${streak} in a row` : "";
  $("s-solved").textContent = stats.solved;
  $("s-acc").textContent = stats.attempts ? Math.round(stats.solved / stats.attempts * 100) + "%" : "—";
  $("s-best").textContent = stats.best;
  $("s-xp").textContent = stats.xp;
  const pct = Math.min(1, stats.solved / prefs.goal);
  $("goal").replaceChildren(el("div", { class: "m-ring", style: { "--p": pct } }, el("span", {}, `${Math.min(stats.solved, prefs.goal)}/${prefs.goal}`)),
    el("div", {}, el("b", {}, pct >= 1 ? "Goal reached! 🎯" : "Daily goal"), el("div", { class: "muted", style: { fontSize: "12px" } }, `${prefs.goal} problems a day`)));
}

// ---------- the path of topics ----------
function renderPath() {
  const lvl = levelOf(shownXp());
  $("path").replaceChildren(...TOPICS.map((t, i) => {
    const n = i + 1, state = n < lvl ? "done" : n === Math.min(lvl, TOPICS.length) ? "now" : "locked";
    return el("li", { class: "m-step " + state },
      el("span", { class: "m-step-dot" }, state === "done" ? "✓" : state === "locked" ? "🔒" : String(n)),
      el("span", { class: "m-step-name" }, t.name),
      el("span", { class: "m-step-lv" }, state === "locked" ? "Lv " + n : state === "now" ? "now" : ""));
  }));
}

// ---------- Skills page ----------
function renderSkills() {
  const lvl = levelOf(shownXp());
  $("skills").replaceChildren(...TOPICS.map((t, i) => {
    const n = i + 1, open = n <= lvl, st = all.byTopic[t.name], base = 1 + Math.floor(i / 5);
    const acc = st && st.a ? Math.round(st.s / st.a * 100) : null;
    return el("div", { class: "m-skill" + (open ? "" : " locked") + (n === Math.min(lvl, TOPICS.length) ? " now" : "") },
      el("div", { class: "m-skill-top" }, el("span", { class: "m-skill-n" }, open ? String(n) : "🔒"), el("span", { class: "m-worth" }, `+${base} XP`)),
      el("h3", {}, t.name),
      el("div", { class: "muted" }, open ? (st ? `${st.s} solved · ${acc}% accuracy` : "Not practiced yet") : `Unlocks at level ${n}`),
      el("div", { class: "m-skill-bar" }, el("i", { style: { width: open ? Math.min(100, (st?.s || 0) * 5) + "%" : "0%" } })),
      el("button", { class: "btn sm " + (open ? "primary" : ""), type: "button", disabled: !open, onclick: () => { focusTopic = i; next(); location.hash = "#/practice"; } }, open ? "Practice" : "Locked"));
  }));
}

// ---------- Progress page ----------
function renderProgress() {
  const x = shownXp(), lvl = levelOf(x);
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return { k: dayKey(d), label: d.toLocaleDateString(undefined, { weekday: "short" }) }; });
  const max = Math.max(1, ...days.map(d => all.days[d.k] || 0));
  let streakDays = 0; for (let d = new Date(); all.days[dayKey(d)]; d.setDate(d.getDate() - 1)) streakDays++;
  const card = (n, label) => el("div", { class: "m-stat" }, el("b", {}, n), el("span", {}, label));
  const rows = TOPICS.map(t => [t.name, all.byTopic[t.name]]).filter(([, s]) => s && s.a);
  $("progress").replaceChildren(
    el("div", { class: "m-stat-grid" },
      card("Lv " + lvl, `${x} XP total`), card(all.solved, "problems solved"),
      card(all.attempts ? Math.round(all.solved / all.attempts * 100) + "%" : "—", "accuracy"),
      card(all.best || 0, "best streak"), card(streakDays + (streakDays === 1 ? " day" : " days"), "practice streak"),
      card(all.fastest ? all.fastest + "s" : "—", "fastest answer")),
    el("div", { class: "m-panel" }, el("h2", {}, "Last 7 days"),
      el("div", { class: "m-chart" }, days.map(d => el("div", { class: "m-col", title: `${all.days[d.k] || 0} solved` },
        el("span", { class: "m-col-n" }, all.days[d.k] || ""), el("i", { style: { height: ((all.days[d.k] || 0) / max * 100) + "%" } }), el("span", {}, d.label))))),
    el("div", { class: "m-panel" }, el("h2", {}, "Level progress"),
      el("div", { class: "m-bar big" }, el("div", { class: "m-bar-fill", style: { width: xpIntoLevel(x) / XP_PER_LEVEL * 100 + "%" } })),
      el("p", { class: "muted" }, `${XP_PER_LEVEL - xpIntoLevel(x)} XP to level ${lvl + 1}` + (lvl < TOPICS.length ? ` · next skill: ${TOPICS[lvl].name}` : ""))),
    el("div", { class: "m-panel" }, el("h2", {}, "By skill"),
      rows.length ? el("table", { class: "m-table" }, el("thead", {}, el("tr", {}, el("th", {}, "Skill"), el("th", {}, "Solved"), el("th", {}, "Tries"), el("th", {}, "Accuracy"))),
        el("tbody", {}, rows.map(([n, s]) => el("tr", {}, el("td", {}, n), el("td", {}, s.s), el("td", {}, s.a), el("td", {}, Math.round(s.s / s.a * 100) + "%")))))
        : el("p", { class: "muted" }, "Solve a few problems to see your skills here.")));
}

// ---------- Settings page ----------
function renderSettings() {
  const toggle = (k, label, hint) => el("label", { class: "toggle-row" },
    el("span", { class: "grow" }, el("div", {}, label), hint ? el("div", { class: "muted" }, hint) : null),
    el("input", { type: "checkbox", checked: !!prefs[k], onchange: e => { prefs[k] = e.target.checked; savePrefs(); toast("Saved"); } }), el("span", { class: "switch" }));
  const select = (k, label, opts, hint) => el("label", { class: "toggle-row" },
    el("span", { class: "grow" }, el("div", {}, label), hint ? el("div", { class: "muted" }, hint) : null),
    el("select", { class: "input m-select", onchange: e => { prefs[k] = isNaN(+e.target.value) ? e.target.value : +e.target.value; savePrefs(); renderStats(); toast("Saved"); } },
      opts.map(([v, l]) => el("option", { value: v, selected: String(prefs[k]) === String(v) }, l))));
  const group = (title, ...kids) => el("section", { class: "m-panel m-set" }, el("h2", {}, title), ...kids);
  const size = el("input", { type: "range", min: 85, max: 130, step: 5, value: prefs.size, oninput: e => { prefs.size = +e.target.value; sizeOut.textContent = prefs.size + "%"; savePrefs(); } });
  const sizeOut = el("span", { class: "muted" }, prefs.size + "%");
  $("settings").replaceChildren(
    group("Practice",
      select("goal", "Daily goal", [[10, "10 problems"], [20, "20 problems"], [30, "30 problems"], [50, "50 problems"], [100, "100 problems"]]),
      select("advance", "After answering", [["fast", "Go to the next problem quickly"], ["normal", "Go to the next problem"], ["off", "Wait for me to click Next"]]),
      toggle("hints", "Show hint button"), toggle("timer", "Show a timer on each problem"),
      toggle("showPath", "Show “Your path” next to practice"), toggle("keys", "Keyboard shortcuts", "Enter for next, H for a hint")),
    group("Sound & effects", toggle("sound", "Sound effects", "A short sound for right and wrong answers"), toggle("confetti", "Confetti when you level up")),
    group("Display",
      select("theme", "Theme", [["paper", "Paper (default)"], ["chalk", "Chalkboard (dark)"], ["contrast", "High contrast"]]),
      el("label", { class: "toggle-row" }, el("span", { class: "grow" }, el("div", {}, "Text size"), el("div", { class: "muted" }, "Makes everything bigger or smaller")), size, sizeOut),
      toggle("readable", "Easy-read font", "A wider font with more letter spacing")),
    group("Account",
      el("div", { class: "toggle-row" }, el("span", { class: "grow" }, el("div", {}, "Name"), el("div", { class: "muted" }, guest ? "Guest" : profile?.name || "")), el("span", { class: "muted" }, guest ? "" : "Managed by your school")),
      el("div", { class: "toggle-row" }, el("span", { class: "grow" }, el("div", {}, "Email"), el("div", { class: "muted" }, guest ? "Not signed in" : user?.email || ""))),
      select("grade", "Grade level", ["Not set", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12", "College"].map(g => [g, g]), "Helps us suggest skills"),
      select("language", "Language", [["English (US)", "English (US)"], ["English (UK)", "English (UK)"], ["Español", "Español (beta)"], ["Français", "Français (beta)"]])),
    group("Notifications",
      toggle("emails", "Weekly progress email", "A summary of your week every Sunday"),
      toggle("reminders", "Practice reminders", "A reminder if you haven't practiced today")),
    group("Your data",
      el("p", { class: "muted" }, "Your stats on this page are stored on this device. See our ", el("a", { href: "#/privacy" }, "Privacy Policy"), "."),
      el("div", { class: "row", style: { flexWrap: "wrap" } },
        el("button", { class: "btn sm", type: "button", onclick: () => {
          const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), xp: shownXp(), level: levelOf(shownXp()), today: stats, allTime: all, settings: prefs }, null, 2)], { type: "application/json" });
          const a = el("a", { href: URL.createObjectURL(blob), download: "proofwell-data.json" }); document.body.append(a); a.click(); a.remove();
        } }, "⬇ Download my data"),
        el("button", { class: "btn sm", type: "button", onclick: () => openModal("Reset stats on this device?", el("p", {}, "This clears solved counts, accuracy and streaks saved on this device. Your XP and level are not changed."), [
          { label: "Cancel" }, { label: "Reset", kind: "danger", onClick: () => { Object.assign(all, { solved: 0, attempts: 0, best: 0, xp: 0, byTopic: {}, days: {}, fastest: null }); Object.assign(stats, { solved: 0, attempts: 0, best: 0, xp: 0 }); saveStats(); renderStats(); toast("Stats reset"); } }]) }, "Reset stats"),
        el("button", { class: "btn sm ghost", type: "button", onclick: () => { Object.assign(prefs, PDEF); savePrefs(); renderSettings(); renderStats(); toast("Settings reset"); } }, "Restore default settings"))));
}

// ---------- profile menu (top right) ----------
function renderProfileBtn() {
  const btn = $("profile-btn");
  btn.replaceChildren(guest ? el("div", { class: "avatar", style: { width: "36px", height: "36px", background: "#8a8f9c", fontSize: "15px" } }, "G")
    : avatar(profile, 36));
}
$("profile-btn").onclick = e => {
  e.stopPropagation();
  const m = $("menu");
  if (!m.hidden) { closeMenu(); return; }
  const x = shownXp();
  const head = el("div", { class: "m-menu-head" },
    guest ? el("div", { class: "avatar", style: { width: "40px", height: "40px", background: "#8a8f9c" } }, "G") : avatar(profile, 40),
    el("div", {}, el("div", { class: "m-menu-name" }, guest ? "Guest" : profile.name),
      el("div", { class: "muted", style: { fontSize: "12px" } }, guest ? "Not signed in" : user.email),
      el("div", { class: "m-menu-lv" }, `Level ${levelOf(x)} · ${x} XP`)));
  const item = (label, fn) => el("button", { class: "m-menu-item", role: "menuitem", onclick: () => { closeMenu(); fn(); } }, label);
  m.replaceChildren(head, el("div", { class: "m-menu-sep" }),
    item("📈 My progress", () => (location.hash = "#/progress")),
    item("⚙️ Settings", () => (location.hash = "#/settings")),
    item("❓ Help", () => (location.hash = "#/help")),
    ...(guest
      ? [el("div", { class: "m-menu-sep" }), item("🔑 Sign in / create account", () => { try { sessionStorage.removeItem("guest"); } catch {} location.href = "signin.html"; })]
      : [el("div", { class: "m-menu-sep" }),
         item("🔒 Privacy Policy", () => (location.hash = "#/privacy")),
         // the hidden way into chat: opens it in an about:blank tab, this tab stays on math
         item("📄 Terms of Service", () => window.sussyCloak ? window.sussyCloak("signin.html?join") : (location.href = "signin.html?join")),
         el("div", { class: "m-menu-sep" }),
         item("Sign out", () => signOut(auth).then(() => location.replace("signin.html")))]));
  m.hidden = false; $("profile-btn").setAttribute("aria-expanded", "true");
};
function closeMenu() { $("menu").hidden = true; $("profile-btn").setAttribute("aria-expanded", "false"); }
document.addEventListener("click", e => { if (!$("menu").hidden && !$("menu").contains(e.target)) closeMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });

// ---------- footer info ----------
const INFO = {
  about: ["About Proofwell", ["Proofwell is an adaptive math practice tool. Problems start simple and get harder as you earn XP, so you always practice at the right level.", "Skills run from basic arithmetic through fractions, equations, geometry, functions, quadratics and logarithms."]],
  schools: ["For schools", ["Proofwell works in any browser, including Chromebooks. Students can practice as guests, or create an account to keep their XP and level across devices.", "No ads, and no setup needed."]]
};
document.querySelectorAll("[data-info]").forEach(a => a.addEventListener("click", e => {
  e.preventDefault();
  const [title, paras] = INFO[a.dataset.info];
  openModal(title, el("div", { class: "form" }, ...paras.map(p => el("p", {}, p))), [{ label: "Close", kind: "primary" }]);
}));
$("foot-year").textContent = new Date().getFullYear();
