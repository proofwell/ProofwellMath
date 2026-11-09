import { el, avatar, levelBadge, modBadge } from "./firebase.js";
import { bannerEl, flagsOf } from "./settings.js";
import { flagEl, flagById } from "./flags.js";
import { levelFromXp } from "./firebase.js";

// The Explore page: everyone's profile card in a grid, with search and sorting.
// people: [[uid, profile]] already filtered for who can be seen.
let q = "", sort = "active";
export function renderExplore(box, { people, me, isMod, isFriend, onProfile, onMessage, hiddenCount = 0, viewerIsMod, statusDot = () => null, activity = () => "" }) {
  const search = el("input", { class: "input explore-search", placeholder: "🔎 Search people by name, pronouns or bio", value: q });
  const grid = el("div", { class: "explore-grid" });
  const sorts = { active: "Newest", level: "Top level", name: "A → Z" };
  const sortBar = el("div", { class: "explore-sorts" });
  const count = el("span", { class: "muted" });

  function draw() {
    const s = q.trim().toLowerCase();
    let list = people.filter(([, u]) => !s || [u.name, u.pronouns, u.bio].some(x => (x || "").toLowerCase().includes(s)));
    list.sort(sort === "level" ? (a, b) => (b[1].xp || 0) - (a[1].xp || 0)
      : sort === "name" ? (a, b) => a[1].name.localeCompare(b[1].name)
      : (a, b) => (b[1].createdAt?.toMillis?.() ?? 0) - (a[1].createdAt?.toMillis?.() ?? 0));
    count.textContent = `${list.length} ${list.length === 1 ? "person" : "people"}`;
    sortBar.replaceChildren(...Object.entries(sorts).map(([k, l]) => el("button", { type: "button", class: "pill" + (k === sort ? " sel" : ""), onclick: () => { sort = k; draw(); } }, l)));
    grid.replaceChildren(...(list.length ? list.map(([uid, u]) => card(uid, u)) : [el("div", { class: "empty", style: { gridColumn: "1/-1" } }, el("b", {}, "Nobody found"), "Try another search.")]));
  }
  function card(uid, u) {
    const flags = flagsOf(u);
    return el("div", { class: "ex-card", tabindex: 0, onclick: () => onProfile(uid), onkeydown: e => { if (e.key === "Enter") onProfile(uid); } },
      bannerEl(u, 64),
      el("div", { class: "ex-av" }, avatar(u, 64), statusDot(uid)),
      el("div", { class: "ex-body" },
        el("div", { class: "ex-name", style: { color: u.nameColor } }, u.name, isMod(uid) ? modBadge() : null),
        el("div", { class: "ex-sub" },
          el("span", { class: "ex-lvl" }, "Lv " + levelFromXp(u.xp)),
          u.pronouns ? el("span", {}, u.pronouns) : null,
          uid === me ? el("span", { class: "chip" }, "You") : isFriend(uid) ? el("span", { class: "chip ok" }, "Friend") : null,
          viewerIsMod && u.hideFromExplore ? el("span", { class: "chip warn", title: "Hidden from Explore (mods can still see)" }, "Hidden") : null),
        activity(uid) ? el("div", { class: "ex-activity" }, activity(uid)) : null,
        flags.length ? el("div", { class: "ex-flags" }, flags.map(id => el("span", { title: flagById(id).name }, flagEl(id, 16)))) : null,
        el("div", { class: "ex-bio" + (u.bio ? "" : " muted") }, u.bio || "No bio yet."),
        uid !== me ? el("div", { class: "ex-actions" },
          el("button", { class: "btn sm primary", type: "button", onclick: e => { e.stopPropagation(); onMessage(uid); } }, "💬 Message"),
          el("button", { class: "btn sm", type: "button", onclick: e => { e.stopPropagation(); onProfile(uid); } }, "Profile")) : null));
  }
  search.oninput = () => { q = search.value; draw(); };
  box.replaceChildren(el("div", { class: "explore" },
    el("div", { class: "explore-head" },
      el("div", {}, el("h1", {}, "🧭 Explore"), el("div", { class: "muted" }, "Everyone on the server. Click someone to see their profile.")),
      count),
    el("div", { class: "explore-tools" }, search, sortBar),
    grid,
    el("p", { class: "muted explore-foot" }, "Don't want to show up here? Settings → Privacy → Hide me from Explore.",
      hiddenCount && viewerIsMod ? ` (${hiddenCount} hidden — you see them because you're a mod)` : "")));
  draw();
  if (q) { search.focus(); search.setSelectionRange(q.length, q.length); }
}
