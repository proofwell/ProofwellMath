import { el } from "./firebase.js";
import { openModal } from "./ui.js";

// ---------- settings (saved per browser) ----------
const KEY = "notifySettings";
const DEFAULTS = { dms: true, channels: true, global: true, mentions: true, sound: true, popups: true, preview: true };
export function settings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

// ---------- sound: a short two-note "ding" (no file needed) ----------
let ac = null;
function ding() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const t = ac.currentTime;
    [[880, 0], [1320, 0.09]].forEach(([f, d]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
      o.connect(g).connect(ac.destination); o.start(t + d); o.stop(t + d + 0.3);
    });
  } catch {}
}
// browsers only allow sound after the first click/keypress on the page
addEventListener("pointerdown", () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch {} }, { once: true });

// ---------- show a notification ----------
// n: { kind: "dms"|"channels"|"global", title, body, avatar?: Node, mention?: bool, onOpen() }
let lastDing = 0;
export function notify(n) {
  const s = settings();
  if (!(s[n.kind] || (n.mention && s.mentions))) return;
  // Only while you're looking at the site: nothing plays or pops up when you're in another tab.
  if (document.hidden) return;
  const body = s.preview ? n.body : "New message";

  if (s.sound && Date.now() - lastDing > 1500) { lastDing = Date.now(); ding(); }

  if (!s.popups) return;
  // pop-up inside the page
  let box = document.getElementById("notifs");
  if (!box) { box = el("div", { id: "notifs" }); document.body.append(box); }
  const card = el("div", { class: "notif", onclick: () => { card.remove(); n.onOpen?.(); } },
    n.avatar || el("div", { class: "notif-icon" }, "💬"),
    el("div", { class: "grow" }, el("div", { class: "notif-title" }, n.title), el("div", { class: "notif-body" }, body)),
    el("button", { class: "notif-x", title: "Dismiss", onclick: e => { e.stopPropagation(); card.remove(); } }, "✕"));
  box.prepend(card);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => card.remove(), 6000);
}

// ---------- settings window ----------
export function openNotifySettings(onChange) {
  const s = settings();
  const toggle = (key, label, hint) => {
    const box = el("input", { type: "checkbox", checked: !!s[key], onchange: e => { s[key] = e.target.checked; save(s); onChange?.(); } });
    return el("label", { class: "toggle-row" }, el("span", { class: "grow" }, el("div", {}, label), hint ? el("div", { class: "muted" }, hint) : null), box, el("span", { class: "switch" }));
  };
  openModal("🔔 Notifications", el("div", { class: "form notify-form" },
    el("div", { class: "lbl", style: { marginTop: 0 } }, "Notify me for"),
    toggle("dms", "Direct messages"),
    toggle("channels", "Channel messages"),
    toggle("global", "📢 Announcements", "When a mod posts news"),
    toggle("mentions", "When someone @mentions me", "Even in rooms that are turned off"),
    el("div", { class: "lbl" }, "How"),
    toggle("sound", "Play a sound"),
    toggle("preview", "Show the message text", "Turn off to just say \"New message\""),
    toggle("popups", "Show pop-ups in the corner"),
    el("p", { class: "muted", style: { fontSize: "12px" } }, "Sounds and pop-ups only happen while this tab is open in front of you.")), [{ label: "Done", kind: "primary" }]);
}
