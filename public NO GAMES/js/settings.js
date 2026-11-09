import { db, el, avatar, toast, levelBadge } from "./firebase.js";
import { openModal, colorPicker } from "./ui.js";
import { FLAGS, flagEl, flagById } from "./flags.js";
import { openNotifySettings, settings as notifySettings } from "./notify.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { blocks, unblock } from "./blocks.js";

export const PRONOUNS = ["he/him", "she/her", "they/them", "he/they", "she/they", "any/all", "ask me"];
export const BIO_MAX = 190;
export const MAX_FLAGS = 4;
// a profile's flags: the new list, or the older single value
export const flagsOf = u => (Array.isArray(u?.sexualities) ? u.sexualities : u?.sexuality ? [u.sexuality] : []).filter(id => flagById(id)).slice(0, MAX_FLAGS);

// ---------- chat display settings (saved per browser) ----------
const CKEY = "chatSettings";
const CDEF = { compact: false, badges: true, clock24: false };
export function chatSettings() { try { return { ...CDEF, ...JSON.parse(localStorage.getItem(CKEY) || "{}") }; } catch { return { ...CDEF }; } }
export function applyChatSettings() {
  const s = chatSettings();
  document.body.classList.toggle("compact", s.compact);
  document.body.classList.toggle("no-badges", !s.badges);
  window.__clock24 = s.clock24;
}

// ---------- the profile card banner (used by profile popups and the preview) ----------
export function bannerEl(u, h = 90) {
  const b = el("div", { class: "pf-banner", style: { height: h + "px", background: u?.bannerColor || u?.nameColor || "#5865f2" } });
  if (u?.bannerURL && /^https:\/\/.+/.test(u.bannerURL)) {
    const img = el("img", { src: u.bannerURL, alt: "", referrerPolicy: "no-referrer" }); img.onerror = () => img.remove(); b.append(img);
  }
  return b;
}
export function profileCard(u, extras = {}) {
  return el("div", { class: "pf-card" },
    bannerEl(u),
    el("div", { class: "pf-av" }, avatar(u, 80)),
    el("div", { class: "pf-body" },
      el("div", { class: "pf-name", style: { color: u.nameColor } }, u.name, extras.badge || null, levelBadge(u)),
      u.pronouns ? el("div", { class: "pf-pron" }, u.pronouns) : null,
      flagsOf(u).length ? el("div", { class: "pf-flags" }, flagsOf(u).map(id => el("span", { class: "pf-flag" }, flagEl(id, 16), el("span", {}, flagById(id).name)))) : null,
      u.bio ? el("div", { class: "pf-sec" }, el("div", { class: "pf-sec-h" }, "About me"), el("div", { class: "pf-bio" }, u.bio)) : null,
      extras.after || null));
}

// ---------- settings window ----------
// me: uid, profile: my users doc, lookup(uid) → profile. tab: "profile" | "privacy" | "notifications" | "chat"
export function openSettings({ me, profile, lookup = () => ({ name: "Someone" }), tab = "profile", isMod = false, hideModTag = false, onHideModTag, onTheme, isOwner = false, ownerTag = "owner", onOwnerTag }) {
  const draft = {
    nameColor: profile.nameColor || "#5865f2", photoURL: profile.photoURL || "",
    bannerColor: profile.bannerColor || profile.nameColor || "#5865f2", bannerURL: profile.bannerURL || "",
    pronouns: profile.pronouns || "", bio: profile.bio || "", sexualities: flagsOf(profile)
  };
  const body = el("div", { class: "settings" });
  const nav = el("div", { class: "settings-tabs" });
  const pane = el("div", { class: "settings-pane" });
  body.append(nav, pane);
  const tabs = { profile: "👤 Profile", appearance: "🎨 Appearance", privacy: "🔒 Privacy", notifications: "🔔 Notifications", chat: "💬 Chat" };
  let current = tab, modal;
  const show = t => {
    current = t;
    nav.replaceChildren(...Object.entries(tabs).map(([k, label]) => el("button", { type: "button", class: k === t ? "active" : "", onclick: () => show(k) }, label)));
    pane.replaceChildren(t === "profile" ? profilePane() : t === "appearance" ? appearancePane() : t === "privacy" ? privacyPane() : t === "notifications" ? notifyPane() : chatPane());
    saveBtn().hidden = t !== "profile";
  };
  const saveBtn = () => body.closest(".overlay")?.querySelector(".modal-actions .btn.primary") || {};

  // ----- Profile -----
  function profilePane() {
    const preview = el("div", { class: "pf-preview" });
    const redraw = () => preview.replaceChildren(profileCard({ ...profile, ...draft }));
    const color = colorPicker(draft.nameColor); color.onChange = v => { draft.nameColor = v; redraw(); };
    const bColor = colorPicker(draft.bannerColor); bColor.onChange = v => { draft.bannerColor = v; redraw(); };
    const input = (key, attrs) => { const i = el("input", { class: "input", value: draft[key], ...attrs }); i.oninput = () => { draft[key] = i.value; redraw(); }; return i; };
    // pronouns: presets + custom
    const pronIn = input("pronouns", { maxlength: 24, placeholder: "e.g. they/them" });
    const pronPills = el("div", { class: "row", style: { flexWrap: "wrap", gap: "6px", marginTop: "6px" } },
      PRONOUNS.map(p => el("button", { type: "button", class: "pill", onclick: () => { pronIn.value = draft.pronouns = p; redraw(); } }, p)));
    // bio
    const bio = el("textarea", { class: "input", rows: 3, maxlength: BIO_MAX, placeholder: "Tell people a bit about yourself" }, draft.bio);
    const bioCount = el("div", { class: "muted", style: { fontSize: "12px", textAlign: "right" } }, `${draft.bio.length}/${BIO_MAX}`);
    bio.oninput = () => { draft.bio = bio.value; bioCount.textContent = `${bio.value.length}/${BIO_MAX}`; redraw(); };
    // sexuality / identity flags: pick up to 4
    const flagList = el("div", { class: "flag-list" });
    const flagCount = el("span", { class: "muted", style: { fontSize: "12px", textTransform: "none", letterSpacing: 0, fontWeight: 500 } });
    const toggleFlag = id => {
      const has = draft.sexualities.includes(id);
      if (!has && draft.sexualities.length >= MAX_FLAGS) { toast(`You can pick up to ${MAX_FLAGS}. Unselect one first.`); return; }
      draft.sexualities = has ? draft.sexualities.filter(x => x !== id) : [...draft.sexualities, id];
      drawFlags(); redraw();
    };
    const drawFlags = () => {
      flagCount.textContent = ` · ${draft.sexualities.length}/${MAX_FLAGS} picked`;
      flagList.replaceChildren(
        ...FLAGS.map(f => el("button", { type: "button", class: "flag-opt" + (draft.sexualities.includes(f.id) ? " sel" : ""), "aria-pressed": String(draft.sexualities.includes(f.id)), onclick: () => toggleFlag(f.id) },
          flagEl(f.id, 18), f.name, draft.sexualities.includes(f.id) ? el("span", { class: "flag-check" }, "✓") : null)),
        el("button", { type: "button", class: "flag-opt" + (!draft.sexualities.length ? " sel" : ""), onclick: () => { draft.sexualities = []; drawFlags(); redraw(); } },
          el("span", { class: "flag flag-none" }), "Don't show"));
    };
    drawFlags();
    redraw();
    return el("div", { class: "settings-profile" },
      el("div", { class: "settings-form" },
        el("label", { class: "lbl", style: { marginTop: 0 } }, "Avatar image link"), input("photoURL", { type: "url", maxlength: 500, placeholder: "https://… (empty for none)" }),
        el("label", { class: "lbl" }, "Name color"), color.root,
        el("label", { class: "lbl" }, "Banner color"), bColor.root,
        el("label", { class: "lbl" }, "Banner image link (optional)"), input("bannerURL", { type: "url", maxlength: 500, placeholder: "https://… wide image" }),
        el("label", { class: "lbl" }, "Pronouns"), pronIn, pronPills,
        el("label", { class: "lbl" }, "About me"), bio, bioCount,
        el("label", { class: "lbl" }, "Sexuality / identity", flagCount), flagList,
        el("p", { class: "muted", style: { fontSize: "12px" } }, "Only mods can change display names.")),
      el("div", { class: "settings-side" }, el("div", { class: "lbl", style: { marginTop: 0 } }, "Preview"), preview));
  }

  // ----- Privacy -----
  function privacyPane() {
    const toggle = (key, label, hint) => {
      const box = el("input", { type: "checkbox", checked: !!profile[key], onchange: async e => {
        const v = e.target.checked;
        try { await updateDoc(doc(db, "users", me), { [key]: v }); profile[key] = v; toast("Saved"); }
        catch (err) { e.target.checked = !v; toast("Couldn't save: " + (err.code || err.message)); }
      } });
      return el("label", { class: "toggle-row" }, el("span", { class: "grow" }, el("div", {}, label), hint ? el("div", { class: "muted" }, hint) : null), box, el("span", { class: "switch" }));
    };
    const blockedBox = el("div");
    const drawBlocked = () => blockedBox.replaceChildren(...(blocks.list.length
      ? blocks.list.map(uid => el("div", { class: "item friend-row" }, avatar(lookup(uid), 30), el("span", { class: "grow", style: { fontWeight: 600 } }, lookup(uid).name),
          el("button", { class: "btn sm", type: "button", onclick: async e => { e.currentTarget.disabled = true; try { await unblock(uid, lookup(uid).name); } catch {} setTimeout(drawBlocked, 300); } }, "Unblock")))
      : [el("div", { class: "muted", style: { padding: "4px 2px" } }, "You haven't blocked anyone. Click someone's name → Block.")]));
    drawBlocked();
    return el("div", { class: "form" },
      toggle("hideEmail", "Hide my email", "Nobody, not even mods, can see your email address"),
      toggle("noFriendRequests", "Don't accept friend requests", "People can't send you new friend requests"),
      toggle("hideFromExplore", "Hide me from Explore", "You won't show up on Explore, the member list or people search. Your friends and mods can still find you."),
      isOwner ? el("label", { class: "toggle-row" },
        el("span", { class: "grow" }, el("div", {}, "👑 Owner tag"), el("div", { class: "muted" }, "What everyone (including mods) sees next to your name. Only other owners can tell you're an owner.")),
        el("select", { class: "input", style: { width: "auto" }, onchange: async e => {
          const v = e.target.value;
          try { await onOwnerTag(v); ownerTag = v; toast(v === "owner" ? "Showing OWNER" : v === "mod" ? "Showing as MOD" : "Tag hidden"); }
          catch (err) { e.target.value = ownerTag; toast("Couldn't save: " + (err.code || err.message)); }
        } }, [["owner", "Show OWNER"], ["mod", "Show as MOD"], ["hidden", "Hide (no tag)"]].map(([v, l]) => el("option", { value: v, selected: v === ownerTag }, l)))) : null,
      isMod ? el("label", { class: "toggle-row" },
        el("span", { class: "grow" }, el("div", {}, "🛡️ Hide my mod tag"), el("div", { class: "muted" }, "Nobody but other mods can tell you're a mod. You still have all your mod powers.")),
        el("input", { type: "checkbox", checked: hideModTag, onchange: async e => {
          const v = e.target.checked;
          try { await onHideModTag(v); hideModTag = v; toast(v ? "Mod tag hidden" : "Mod tag showing"); }
          catch (err) { e.target.checked = !v; toast("Couldn't save: " + (err.code || err.message)); }
        } }), el("span", { class: "switch" })) : null,
      el("div", { class: "lbl" }, "Blocked people"),
      el("p", { class: "muted", style: { fontSize: "12px", marginTop: 0 } }, "Blocked people can't DM you, send friend requests or challenge you to games. Their messages in channels are hidden."),
      blockedBox);
  }

  // ----- Notifications -----
  function notifyPane() {
    const s = notifySettings();
    return el("div", {}, el("p", { class: "muted" }, "Sounds and pop-ups only happen while this tab is open in front of you."),
      el("button", { class: "btn primary", type: "button", onclick: () => openNotifySettings() }, "Open notification settings"),
      el("p", { class: "muted", style: { marginTop: "14px" } }, `Now: ${["dms", "channels", "global", "mentions"].filter(k => s[k]).map(k => ({ dms: "DMs", channels: "channels", global: "announcements", mentions: "@mentions" }[k])).join(", ") || "nothing"} · sound ${s.sound ? "on" : "off"}`));
  }

  // ----- Appearance: light/dark, accent color, brightness, grid -----
  function appearancePane() {
    const T = window.sussyTheme;
    if (!T) return el("p", { class: "muted" }, "Themes couldn't load. Refresh the page.");
    const box = el("div", { class: "form" });
    const draw = () => {
      const t = T.get();
      const set = patch => { T.set(patch); onTheme?.(); draw(); };
      const mode = (m, label, bg, side) => el("button", { type: "button", class: "theme-mode" + (t.mode === m ? " sel" : ""), onclick: () => set({ mode: m }) },
        el("div", { class: "tm-prev" }, el("i", { style: { background: side } }), el("i", { style: { background: bg } })), el("span", {}, label));
      const custom = el("label", { class: "swatch custom", title: "Pick any color" }, "+", el("input", { type: "color", value: t.accent, oninput: e => { T.set({ accent: e.target.value }); onTheme?.(); }, onchange: () => draw() }));
      const bright = el("input", { type: "range", min: 0, max: 100, value: t.brightness, oninput: e => { T.set({ brightness: +e.target.value }); val.textContent = e.target.value; } });
      const val = el("span", { class: "muted", style: { width: "28px", textAlign: "right" } }, String(t.brightness));
      box.replaceChildren(
        el("label", { class: "lbl", style: { marginTop: 0 } }, "Mode"),
        el("div", { class: "theme-modes" }, mode("dark", "🌙 Dark", "#172021", "#111819"), mode("light", "☀️ Light", "#f7fafa", "#eaf0f0")),
        el("label", { class: "lbl" }, "Accent color"),
        el("div", { class: "accent-row" }, T.ACCENTS.map(a => el("button", { type: "button", class: "swatch" + (a.c.toLowerCase() === t.accent.toLowerCase() ? " sel" : ""), title: a.name, style: { background: a.c }, onclick: () => set({ accent: a.c }) })), custom),
        el("label", { class: "lbl" }, "Brightness"),
        el("div", { class: "range-row" }, el("span", {}, "🔅"), bright, el("span", {}, "🔆"), val),
        el("p", { class: "muted", style: { fontSize: "12px", margin: "4px 0 0" } }, t.mode === "light" ? "Lower = softer, warmer white. Higher = brighter." : "Lower = darker (great at night). Higher = lighter gray."),
        el("label", { class: "toggle-row", style: { marginTop: "10px" } }, el("span", { class: "grow" }, el("div", {}, "Grid background"), el("div", { class: "muted" }, "A faint grid behind the chat")),
          el("input", { type: "checkbox", checked: t.grid, onchange: e => set({ grid: e.target.checked }) }), el("span", { class: "switch" })),
        el("button", { class: "btn sm ghost", type: "button", style: { marginTop: "10px" }, onclick: () => set({ ...T.DEF }) }, "↺ Reset to default"),
        el("p", { class: "muted", style: { fontSize: "12px" } }, "Saved on this device."));
    };
    draw();
    return box;
  }

  // ----- Chat display -----
  function chatPane() {
    const s = chatSettings();
    const toggle = (key, label, hint) => {
      const box = el("input", { type: "checkbox", checked: !!s[key], onchange: e => { s[key] = e.target.checked; try { localStorage.setItem(CKEY, JSON.stringify(s)); } catch {} applyChatSettings(); } });
      return el("label", { class: "toggle-row" }, el("span", { class: "grow" }, el("div", {}, label), hint ? el("div", { class: "muted" }, hint) : null), box, el("span", { class: "switch" }));
    };
    return el("div", { class: "form" },
      toggle("compact", "Compact messages", "Smaller avatars and less space between messages"),
      toggle("badges", "Show level badges next to names"),
      toggle("clock24", "24-hour clock"));
  }

  modal = openModal("⚙️ Settings", body, [
    { label: "Close" },
    { label: "Save profile", kind: "primary", onClick: async () => {
      const urlOk = v => !v || /^https?:\/\/.+/.test(v);
      if (!urlOk(draft.photoURL.trim()) || !urlOk(draft.bannerURL.trim())) { toast("Image links must start with http:// or https://"); return false; }
      await updateDoc(doc(db, "users", me), {
        nameColor: draft.nameColor, photoURL: draft.photoURL.trim(),
        bannerColor: draft.bannerColor, bannerURL: draft.bannerURL.trim(),
        pronouns: draft.pronouns.trim().slice(0, 24), bio: draft.bio.trim().slice(0, BIO_MAX),
        sexualities: draft.sexualities.slice(0, MAX_FLAGS), sexuality: draft.sexualities[0] || ""
      });
      toast("Profile saved");
    } }
  ]);
  show(current);
}
