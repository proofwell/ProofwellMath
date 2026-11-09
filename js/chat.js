import { levelBadge } from "./firebase.js";
import { auth, db, el, avatar, modBadge, canChat, banActive, dmIdFor, fmtTime, toast, codeOkThisVisit, clearCodeOk } from "./firebase.js";
import { openModal, contextMenu, colorPicker, renameUser, banUser, unbanUser, showProfile,
  timeoutUser, clearTimeoutUser, timeoutActive, timeoutLeft, bulkDelete, banGif } from "./ui.js";
import { openGifPicker, gifEl, parseGif, bumpGif, toggleFav, loadFavs, isFav } from "./gifs.js";
import { openChess, gameCard, isMyTurn, isOpen, challenge } from "./chessgame.js";
import { openGamesMenu } from "./games.js";
import { matchCard, openMatch, claimMatchXp } from "./boardgames/kit.js";
import { openMovies } from "./movies.js";
import { openMusic, mountMiniPlayer } from "./music.js";
import { requireCode } from "./codegate.js";
import { watchFriends, friendSection, openFriends, friends } from "./friends.js";
import { watchBlocks, isBlocked, block, unblock } from "./blocks.js";
import { startMinuteXp } from "./minutexp.js";
import { sendDmImage, watchDmImages, imageEl, pickImageFile, confirmImage, trimImages } from "./dmimages.js";
import { watchChannels, editChannel, deleteChannel } from "./channels.js";
import { notify, openNotifySettings } from "./notify.js";
import { openSettings, applyChatSettings } from "./settings.js";
import { richText, mentionsUid, attachMentions } from "./mentions.js";
import { renderExplore } from "./explore.js";
import { watchWordFilter, findBlocked } from "./wordfilter.js";
import { startPresence, statusOf, statusDot, withStatus, openStatusMenu, isDnd, myChoice, myActivity, activityText, activityIcon, STATES } from "./presence.js";
import { openSearch, closeSearch } from "./msgsearch.js";
import { watchSuggestions, openSuggestions } from "./suggestions.js";
import { watchKick, kickUser, showKickedNotice } from "./kick.js";
import { reactionBar, openReactPicker, toggleReaction } from "./reactions.js";
import { stickerEl, openStickerPicker, STICKERS } from "./stickers.js";
import { sendDmMedia, watchDmMedia, mediaEl, openGallery, pickMediaFile, kindOf, trimMedia } from "./dmmedia.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { increment, getDoc, getDocs, setDoc, deleteField,
  doc, collection, query, where, orderBy, limitToLast, onSnapshot, writeBatch,
  serverTimestamp, addDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);

let me = null;            // Firebase auth user
let myProfile = null;     // my users/{uid} doc
const users = new Map();  // uid -> profile
const mods = new Set();   // mod uids
let dms = [];             // my DM threads
const chessGames = new Map(); // my chess games, id -> game
const matches = new Map();    // my Connect Four / Checkers / Dots games
let view = { type: "explore" };
let channels = [];                // channels I can see
const bootTime = Date.now();      // only notify about messages newer than this
const notified = new Map();       // room id -> newest message time already notified
let globalLast = null;            // newest #global message (for unread dot)
let msgs = [];
let msgUnsub = null;
let imgUnsub = null, dmImages = new Map(), imagesLoaded = false; // photos in the open DM
let mediaUnsub = null, dmMedia = new Map(), mediaLoaded = false;   // audio/video in the open DM
let replyTo = null;               // the message you're replying to
let amMod = false;                // am I really a mod (my mods doc, or I'm an owner)
let myModDoc = null;              // my mods doc (hideTag)
let modDocIn = false, amOwner = false, myOwnerDoc = null;
const realMods = new Set(), hiddenMods = new Set(); // only filled for mods
const realOwners = new Map();      // only filled for owners: uid -> tag
const owners = new Set();          // who shows an OWNER tag (what this viewer can see)
let booted = false;
const ready = { me: false, mods: false };
const unsubs = [];
const bannedGifs = new Set(); // banned GIF keys
const recentGifs = [];         // GIFs seen this visit, for the picker

const isMod = (uid = me?.uid) => (uid === me?.uid ? amMod : mods.has(uid));
// who you can find (Explore, member list, pickers): people who didn't hide, your friends, yourself — mods see everyone
const findable = uid => uid === me?.uid || amMod || friends.list.includes(uid) || !lookup(uid).hideFromExplore;
const activeMember = (uid, u) => isMod(uid) || (u.approved && u.codeVerified && !banActive(u));
const lookup = uid => users.get(uid) || (uid === me?.uid ? myProfile : null) || { name: "Unknown", nameColor: "#95a5a6" };

// ---------- the "tiny auth" gate ----------
onAuthStateChanged(auth, user => {
  if (!user || !codeOkThisVisit(user.uid)) { kick(); return; }
  me = user;
  let modsUnsub = null, ownersUnsub = null, gotMod = false, gotOwner = false;
  const roleChanged = () => {
    amMod = modDocIn || amOwner;
    if (booted) syncSuggest();
    if (amOwner && !ownersUnsub) {
      ownersUnsub = onSnapshot(collection(db, "owners"), os => {
        realOwners.clear(); os.forEach(d => realOwners.set(d.id, d.data().tag || "owner"));
        rebuildMods(); renderAll();
      }, () => {});
      unsubs.push(() => ownersUnsub?.());
    }
    if (amMod && !modsUnsub) {
      modsUnsub = onSnapshot(collection(db, "mods"), ms => {
        realMods.clear(); hiddenMods.clear();
        ms.forEach(d => { realMods.add(d.id); if (d.data().hideTag) hiddenMods.add(d.id); });
        rebuildMods(); renderAll();
      }, () => {});
      unsubs.push(() => modsUnsub?.());
    }
    if (gotMod && gotOwner) { ready.mods = true; gate(); }
    syncModTag(); rebuildMods(); renderAll();
  };
  unsubs.push(onSnapshot(doc(db, "mods", user.uid), s => {
    modDocIn = s.exists(); myModDoc = s.exists() ? s.data() : null; gotMod = true; roleChanged();
  }, () => { gotMod = true; roleChanged(); }));
  unsubs.push(onSnapshot(doc(db, "owners", user.uid), s => {
    amOwner = s.exists(); myOwnerDoc = s.exists() ? s.data() : null; gotOwner = true; roleChanged();
  }, () => { gotOwner = true; roleChanged(); }));
  unsubs.push(onSnapshot(doc(db, "users", user.uid), s => {
    myProfile = s.exists() ? s.data() : null;
    ready.me = true; gate(); syncModTag(); renderMe(); renderComposer();
  }, () => kick()));
});

// ---------- mod tags ----------
// Mods see the real list; everyone else only sees mods who show their tag.
function rebuildMods() {
  mods.clear(); owners.clear();
  // everyone sees public tags; mods also see every real mod; owners also see every owner
  users.forEach((u, id) => { if (u.showMod === true) mods.add(id); if (u.showOwner === true) owners.add(id); });
  if (amMod) realMods.forEach(id => mods.add(id));
  if (amOwner) realOwners.forEach((t, id) => { mods.add(id); owners.add(id); });
  if (amOwner) { mods.add(me.uid); owners.add(me.uid); }
}
const ownerTagOf = uid => uid === me?.uid ? (myOwnerDoc?.tag || "owner") : realOwners.get(uid) || "owner";
// keep my public tag in step with my "hide my mod tag" setting
let syncing = false;
async function syncModTag() {
  if (!amMod || !myProfile || syncing) return;
  const tag = amOwner ? ownerTagOf(me.uid) : null;
  const wantMod = amOwner ? tag !== "hidden" : !myModDoc?.hideTag;
  const wantOwner = amOwner && tag === "owner";
  if ((myProfile.showMod === true) === wantMod && (myProfile.showOwner === true) === wantOwner
    && myProfile.approved && myProfile.codeVerified && !myProfile.rejected) return;
  syncing = true;
  try { await updateDoc(doc(db, "users", me.uid), { showMod: wantMod ? true : deleteField(), showOwner: wantOwner ? true : deleteField(), approved: true, codeVerified: true, rejected: false }); }
  catch {} syncing = false;
}
async function setOwnerTag(tag) {
  await updateDoc(doc(db, "owners", me.uid), { tag });
  myOwnerDoc = { ...(myOwnerDoc || {}), tag };
  await syncModTag(); rebuildMods(); renderAll();
}
// owners: give / take away mod
async function makeMod(uid) {
  await setDoc(doc(db, "mods", uid), { by: me.uid, at: serverTimestamp() });
  toast(`🛡️ ${lookup(uid).name} is now a mod`);
}
async function removeMod(uid) {
  await deleteDoc(doc(db, "mods", uid));
  await updateDoc(doc(db, "users", uid), { showMod: deleteField(), showOwner: deleteField() }).catch(() => {});
  toast(`${lookup(uid).name} is no longer a mod`);
}
export async function setHideModTag(hide) {
  await updateDoc(doc(db, "mods", me.uid), { hideTag: !!hide });
  myModDoc = { ...(myModDoc || {}), hideTag: !!hide };
  await updateDoc(doc(db, "users", me.uid), { showMod: hide ? deleteField() : true, approved: true, codeVerified: true, rejected: false });
}

function kick() {
  unsubs.forEach(u => u()); msgUnsub?.();
  location.replace("signin.html?join");
}

function gate() {
  if (!ready.me || !ready.mods) return;
  if (!myProfile || !canChat(myProfile, isMod())) { kick(); return; }
  if (!isMod() && !me.emailVerified) { kick(); return; }
  if (!booted) boot();
}

// ---------- boot ----------
function boot() {
  booted = true;
  syncSuggest();
  unsubs.push(watchKick(me.uid));
  showKickedNotice();
  unsubs.push(onSnapshot(collection(db, "users"), s => {
    users.clear(); s.forEach(d => users.set(d.id, d.data()));
    rebuildMods(); renderAll();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "dms"), where("members", "array-contains", me.uid)), s => {
    dms = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (b.lastMessageAt?.toMillis?.() ?? 0) - (a.lastMessageAt?.toMillis?.() ?? 0));
    for (const d of dms) {
      const other = d.members.find(m => m !== me.uid);
      maybeNotify(d.id, d.lastMessageAt?.toMillis?.(), d.lastFrom, {
        kind: "dms", title: lookup(other).name, body: d.lastText, avatar: avatar(lookup(other), 36),
        onOpen: () => openDm(other), isOpenView: view.type === "dm" && view.id === d.id });
    }
    if (view.type === "dm") markSeen(view.id);
    renderDms();
  }, () => {}));
  unsubs.push(watchChannels(me.uid, isMod(), list => {
    channels = list;
    for (const c of channels) {
      maybeNotify("ch_" + c.id, c.lastMessageAt?.toMillis?.(), c.lastFrom, {
        kind: "channels", title: `#${c.name} · ${lookup(c.lastFrom).name}`, body: c.lastText,
        avatar: avatar(lookup(c.lastFrom), 36), mention: mentionsMe(c.lastText),
        onOpen: () => openChannel(c.id), isOpenView: view.type === "channel" && view.id === c.id });
    }
    if (view.type === "channel") {
      const c = channels.find(c => c.id === view.id);
      if (!c) { toast("You no longer have access to that channel."); switchView({ type: "explore" }); return; }
      view.channel = c; markSeen("ch_" + c.id); renderHeader();
    }
    renderRooms();
  }));
  unsubs.push(onSnapshot(query(collection(db, "rooms", "global", "messages"), orderBy("createdAt"), limitToLast(1)), s => {
    const m = s.docs[0]?.data({ serverTimestamps: "estimate" });
    if (!m) return;
    globalLast = { at: m.createdAt?.toMillis?.() ?? Date.now(), from: m.uid };
    maybeNotify("global", globalLast.at, m.uid, {
      kind: "global", title: `📢 Announcement · ${lookup(m.uid).name}`, body: m.gif ? "🖼️ GIF" : m.text,
      avatar: avatar(lookup(m.uid), 36), mention: mentionsMe(m.text) || /@everyone\b/i.test(m.text || ""),
      onOpen: () => switchView({ type: "announce" }), isOpenView: view.type === "announce" });
    if (view.type === "announce") markSeen("global");
    renderRooms();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "chess"), where("players", "array-contains", me.uid)), s => {
    chessGames.clear();
    s.forEach(d => chessGames.set(d.id, { id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    for (const g of chessGames.values()) claimChessXp(g);
    renderDms();
    if (view.type === "dm") renderMessages(false);
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "matches"), where("players", "array-contains", me.uid)), s => {
    matches.clear();
    s.forEach(d => matches.set(d.id, { id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    for (const m of matches.values()) claimMatchXp(m, me.uid, lookup(m.players.find(p => p !== me.uid)).name);
    renderDms();
    if (view.type === "dm") renderMessages(false);
  }, () => {}));
  unsubs.push(onSnapshot(collection(db, "bannedGifs"), s => {
    bannedGifs.clear(); s.forEach(d => bannedGifs.add(d.id));
    renderMessages(false);
  }, () => {}));
  switchView({ type: "explore" });
  document.body.classList.remove("loading");
  setInterval(renderComposer, 1000);
  startMinuteXp({ uid: me.uid });
  unsubs.push(watchFriends(me.uid, renderFriendsBtn));
  unsubs.push(watchBlocks(me.uid, () => { renderMessages(false); renderComposer(); renderDms(); }));
  setInterval(() => { if (!codeOkThisVisit(me.uid)) kick(); }, 60000); // code expired → enter it again
  loadFavs(me.uid);
  unsubs.push(watchWordFilter());
  unsubs.push(startPresence(me.uid, () => { renderMembers(); renderDms(); renderHeader(); renderMe(); if (view.type === "explore" && !document.querySelector(".explore-search:focus")) renderMessages(false); }));
}
// "Online", "⛔ Do Not Disturb", "📘 Working on Canvas"…
function statusLine(uid) {
  const { state, activity } = uid === me.uid ? { state: myChoice() === "invisible" ? "invisible" : myChoice(), activity: myChoice() === "invisible" ? null : myActivity() } : statusOf(uid);
  return activity ? `${activityIcon(activity)} ${activityText(activity)}` : STATES[state]?.label || "";
}
const av = (uid, size) => withStatus(avatar(lookup(uid), size), uid, { mine: uid === me?.uid });

// ---------- +5 XP for winning a chess game (once per game) ----------
const claiming = new Set();
async function claimChessXp(g) {
  if (!["checkmate", "resigned"].includes(g.status) || g.winner !== me.uid || g.xpClaimed || claiming.has(g.id)) return;
  claiming.add(g.id);
  try {
    const b = writeBatch(db);
    b.update(doc(db, "chess", g.id), { xpClaimed: true, updatedAt: serverTimestamp() });
    b.update(doc(db, "users", me.uid), { xp: increment(5), lastChessClaim: g.id });
    await b.commit();
    toast(`♟ You won against ${lookup(opponentOfGame(g)).name}! +5 XP`);
  } catch { claiming.delete(g.id); }
}
const opponentOfGame = g => g.players.find(p => p !== me.uid);

// ---------- games ----------
function showMatch(id) { openMatch(id, { me: me.uid, lookup, onRematch: showMatch }); }
function pickPlayer(title, cb) {
  const search = el("input", { class: "input", placeholder: "Search people" });
  const list = el("div", { style: { marginTop: "10px", maxHeight: "50vh", overflowY: "auto" } });
  let modal;
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const people = [...users.entries()].filter(([uid, u]) => uid !== me.uid && activeMember(uid, u) && findable(uid) && u.name.toLowerCase().includes(q))
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    list.replaceChildren(...(people.length ? people.map(([uid, u]) => el("button", { class: "item", onclick: () => { modal.close(); cb(uid); } },
      avatar(u, 32), el("span", { class: "grow" }, nameEl(uid)))) : [el("div", { class: "muted" }, "Nobody found.")]));
  };
  search.oninput = draw; draw();
  modal = openModal(title, el("div", {}, search, list), [{ label: "Cancel" }]);
}
function showChess(id) {
  openChess(id, { me: me.uid, lookup, nameEl, onRematch: id2 => showChess(id2) });
}
async function quickChallenge(uid) {
  const open = [...chessGames.values()].find(g => g.dmId === dmIdFor(me.uid, uid) && isOpen(g));
  if (open) { showChess(open.id); return; }
  try { openDm(uid); showChess(await challenge(me.uid, uid, "random")); }
  catch (err) { toast("Couldn't start game: " + (err.code || err.message)); }
}
let musicOk = false;
const showMusic = async () => { if (musicOk || (musicOk = await requireCode(me.uid, "Music"))) openMusic({ me: me.uid, isMod: () => isMod(), findBlocked }); };
$("music").onclick = showMusic;
mountMiniPlayer($("mini-player"), showMusic);
$("movies").onclick = async () => { if (await requireCode(me.uid, "Movies")) openMovies({ me: me.uid, isMod: () => isMod() }); };
$("games").onclick = async () => { if (await requireCode(me.uid, "Games")) openGamesMenu({ me: me.uid, view, lookup, nameEl, chessGames, openChess: showChess, isMod: () => isMod(),
  openMatch: showMatch, pickPlayer }); };

// ---------- views ----------
function switchView(v) {
  msgUnsub?.(); msgUnsub = null; imgUnsub?.(); imgUnsub = null; mediaUnsub?.(); mediaUnsub = null;
  view = v; msgs = []; setReply(null); closeSearch();
  dmImages = new Map(); imagesLoaded = false; dmMedia = new Map(); mediaLoaded = false;
  if (v.type === "dm") {
    imgUnsub = watchDmImages(v.id, m => { dmImages = m; imagesLoaded = true; renderMessages(false); });
    mediaUnsub = watchDmMedia(v.id, m => { dmMedia = m; mediaLoaded = true; renderMessages(false); });
    trimImages(v.id); trimMedia(v.id); // tidy up in case an older send didn't
  }
  $("img-btn").hidden = $("media-btn").hidden = v.type !== "dm";
  // the member list is only for channels / announcements
  document.querySelector(".app").classList.toggle("no-right", v.type === "dm" || v.type === "explore");
  document.querySelector(".app").classList.toggle("exploring", v.type === "explore");
  renderComposer();
  closeDrawers();
  if (v.type === "explore") { renderHeader(); renderMessages(true); renderDms(); renderRooms(); return; }
  const col = v.type === "announce" ? collection(db, "rooms", "global", "messages")
    : v.type === "channel" ? collection(db, "channels", v.id, "messages")
    : collection(db, "dms", v.id, "messages");
  let first = true;
  msgUnsub = onSnapshot(query(col, orderBy("createdAt"), limitToLast(200)), s => {
    msgs = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    renderMessages(first); first = false;
    markSeen(view.type === "dm" ? view.id : view.type === "channel" ? "ch_" + view.id : "global");
    renderRooms();
  }, err => toast("Couldn't load messages: " + err.code));
  renderHeader(); renderMessages(true); renderDms(); renderRooms();
  $("input").placeholder = v.type === "announce" ? "Post an announcement for everyone (use @everyone to ping)"
    : v.type === "channel" ? "Message #" + (v.channel?.name || "channel") : "Message @" + lookup(v.other).name;
  $("input").focus();
}

function openChannel(id) {
  const c = channels.find(c => c.id === id);
  if (c) switchView({ type: "channel", id, channel: c });
}

function openDm(uid) {
  if (uid === me.uid) return;
  switchView({ type: "dm", other: uid, id: dmIdFor(me.uid, uid) });
}

// unread tracking (per device)
const seenKey = id => "seen_" + me.uid + "_" + id;
function markSeen(id) { try { localStorage.setItem(seenKey(id), String(Date.now())); } catch {} }
function isUnread(d, key = d.id) {
  if (d.lastFrom === me.uid) return false;
  let seen = 0; try { seen = Number(localStorage.getItem(seenKey(key)) || 0); } catch {}
  return (d.lastMessageAt?.toMillis?.() ?? 0) > seen;
}

// ---------- notifications ----------
function mentionsMe(text) { return mentionsUid(text, myProfile?.name); }
function maybeNotify(roomKey, at, from, n) {
  if (!at || !from || from === me.uid || at <= bootTime || isBlocked(from)) return;
  if ((notified.get(roomKey) || 0) >= at - 2000) { notified.set(roomKey, Math.max(at, notified.get(roomKey))); return; }
  notified.set(roomKey, at);
  if (isDnd()) return; // Do Not Disturb: no pop-ups or sounds (unread dots still show)
  const looking = n.isOpenView && !document.hidden && document.hasFocus();
  if (looking) return;
  notify({ ...n, tag: roomKey });
}

// ---------- right-click user menu ----------
function userMenu(e, uid, msg) {
  e.preventDefault(); e.stopPropagation();
  const u = lookup(uid);
  const items = [];
  if (msg?.gif && !bannedGifs.has(msg.gifKey)) {
    items.push({ label: isFav(msg.gifKey) ? "★ Remove from favorites" : "☆ Favorite this GIF",
      onClick: () => toggleFav(me.uid, msg).catch(err => toast(err.message)) });
    items.push("sep");
  }
  if (msg && canReplyHere()) items.push({ label: "↩ Reply", onClick: () => setReply(msg) });
  if (msg?.text) items.push({ label: "📋 Copy text", onClick: () => navigator.clipboard?.writeText(msg.text).then(() => toast("Copied")) });
  if (msg && canReactHere()) items.push({ label: "🙂 React…", onClick: () => {
    const x = e.clientX, y = e.clientY;
    openReactPicker({ getBoundingClientRect: () => ({ left: x, right: x + 120, top: y, bottom: y }) }, msg, me.uid, key => toggleReaction(msgRef(msg.id), msg, me.uid, key));
  } });
  if (msg && uid !== me.uid) items.push({ label: "@ Mention", onClick: () => insertMention(uid) });
  if (msg) items.push("sep");
  items.push({ label: "View profile", onClick: () => profile(uid) });
  if (uid !== me.uid) {
    items.push({ label: "Send message", onClick: () => openDm(uid) });
    items.push({ label: "♟ Challenge to chess", onClick: () => quickChallenge(uid) });
    items.push(isBlocked(uid)
      ? { label: "Unblock", onClick: () => unblock(uid, u.name).catch(err => toast(err.message)) }
      : { label: "🚫 Block", danger: true, onClick: () => confirmBlock(uid) });
  }
  if (amOwner && uid !== me.uid && !(owners.has(uid) && amOwner && realOwners.has(uid))) {
    items.push("sep");
    items.push(realMods.has(uid)
      ? { label: "👑 Remove mod", danger: true, onClick: () => openModal(`Remove ${u.name} as a mod?`, el("p", {}, "They lose all mod powers right away."), [{ label: "Cancel" }, { label: "Remove mod", kind: "danger", onClick: () => removeMod(uid) }]) }
      : { label: "👑 Make mod", onClick: () => openModal(`Make ${u.name} a mod?`, el("p", {}, "They'll be able to approve, ban, time out and rename people, delete messages and post announcements."), [{ label: "Cancel" }, { label: "Make mod", kind: "primary", onClick: () => makeMod(uid) }]) });
  }
  if (isMod()) {
    items.push("sep");
    items.push({ label: "Rename", onClick: () => renameUser(uid, u) });
    if (!isMod(uid)) {
      if (timeoutActive(u)) items.push({ label: `Remove timeout (${timeoutLeft(u)} left)`, onClick: () => clearTimeoutUser(uid, u).catch(err => toast(err.message)) });
      else items.push({ label: "⏱ Timeout…", onClick: () => timeoutUser(uid, u, me.uid) });
      if (banActive(u)) items.push({ label: "Unban", onClick: () => unbanUser(uid, u).catch(err => toast(err.message)) });
      else items.push({ label: "Ban…", danger: true, onClick: () => banUser(uid, u, me.uid) });
    }
    if (!isMod(uid) && uid !== me.uid) items.push({ label: "👢 Kick off site…", danger: true,
      onClick: () => kickUser(uid, u.name, { me: me.uid, online: statusOf(uid).state !== "offline", findBlocked }) });
    items.push({ label: "🧹 Delete their messages…", danger: true, onClick: () => bulkDelete(uid, u, channels) });
    if (msg?.gif && !bannedGifs.has(msg.gifKey)) items.push({ label: "🚫 Ban this GIF (NSFW)", danger: true,
      onClick: () => banGif(msg, me.uid).catch(err => toast(err.message)) });
    if (msg && view.type !== "dm") items.push({ label: "Delete message", danger: true,
      onClick: () => deleteDoc(view.type === "announce" ? doc(db, "rooms", "global", "messages", msg.id)
        : doc(db, "channels", view.id, "messages", msg.id)).catch(err => toast(err.message)) });
  }
  contextMenu(e.clientX, e.clientY, items);
}
function confirmBlock(uid) {
  const u = lookup(uid);
  openModal(`Block ${u.name}?`, el("div", {},
    el("p", {}, "They won't be able to DM you, send you friend requests or challenge you to games. Their messages in channels will be hidden for you."),
    el("p", { class: "muted" }, "If you're friends, this also unfriends them. They aren't told.")), [
    { label: "Cancel" },
    { label: "Block", kind: "danger", onClick: () => block(uid, u.name) }
  ]);
}

function profile(uid) {
  document.querySelectorAll(".overlay").forEach(o => { if (o.querySelector(".profile")) o.remove(); });
  const st = uid === me.uid ? (myChoice() === "invisible" ? "invisible" : myChoice()) : statusOf(uid).state;
  const act = uid === me.uid ? myActivity() : statusOf(uid).activity;
  showProfile(uid, lookup(uid), {
    viewerIsMod: isMod(), targetIsMod: isMod(uid),
    badge: owners.has(uid) && (!amOwner || ownerTagOf(uid) === "owner") ? el("span", { class: "badge owner" }, "OWNER") : null,
    status: el("div", { class: "pf-status" }, el("span", { class: "st-dot st-" + st }), el("b", {}, STATES[st].label),
      act ? el("span", { class: "pf-activity" }, activityIcon(act) + " " + activityText(act)) : null),
    onMessage: uid !== me.uid ? () => openDm(uid) : null,
    extra: uid !== me.uid ? el("div", { class: "pf-actions" },
      isBlocked(uid) ? el("div", { class: "chip danger" }, "🚫 Blocked") : friendSection(uid, { lookup, onOpenProfile: profile }),
      el("button", { class: "btn sm ghost", type: "button", onclick: () => {
        document.querySelectorAll(".overlay").forEach(o => { if (o.querySelector(".profile")) o.remove(); });
        isBlocked(uid) ? unblock(uid, lookup(uid).name).catch(err => toast(err.message)) : confirmBlock(uid);
      } }, isBlocked(uid) ? "Unblock" : "🚫 Block")) : null
  });
}
function nameEl(uid, cls = "name") {
  const u = lookup(uid);
  let badge = null;
  const isOwn = owners.has(uid);
  if (isOwn && (!amOwner || ownerTagOf(uid) === "owner")) {
    badge = el("span", { class: "badge owner", title: "Owner" }, "OWNER");
  } else if (isOwn) { // owner looking at an owner who disguised or hid their tag
    badge = el("span", { class: "badge owner hidden-tag", title: ownerTagOf(uid) === "mod" ? "Owner — shows as MOD to everyone" : "Owner — tag hidden from everyone" }, "OWNER");
  } else if (isMod(uid)) {
    const hidden = uid === me?.uid ? !!myModDoc?.hideTag : hiddenMods.has(uid);
    badge = modBadge();
    if (hidden) { badge.classList.add("hidden-tag"); badge.title = "Hidden — only mods see this"; }
  }
  return el("span", { class: cls, style: { color: u.nameColor } }, u.name, badge, users.has(uid) || uid === me?.uid ? levelBadge(u) : null);
}

// ---------- rendering ----------
function renderAll() { if (!booted) return; renderMembers(); renderRooms(); renderDms(); renderHeader(); renderMessages(false); renderMe(); }

function renderMe() {
  if (!myProfile) return;
  $("me-avatar").replaceChildren(av(me.uid, 34));
  $("me-avatar").title = "Set your status";
  $("me-name").replaceChildren(nameEl(me.uid, ""));
  $("me-email").textContent = statusLine(me.uid);
  $("mod-link").hidden = !isMod();
  const pending = [...users.values()].filter(u => u.codeVerified && !u.approved && !u.rejected).length;
  $("pending-count").hidden = !pending;
  $("pending-count").textContent = pending;
}

function renderMembers() {
  const list = [...users.entries()]
    .filter(([uid, u]) => activeMember(uid, u) && findable(uid))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const on = ([id]) => (id === me.uid ? myChoice() !== "invisible" : statusOf(id).state !== "offline");
  const shownOwner = id => owners.has(id) && (!amOwner || ownerTagOf(id) === "owner" || id === me.uid);
  const groups = [["Owner", list.filter(x => shownOwner(x[0]) && on(x))], ["Mods", list.filter(x => !shownOwner(x[0]) && isMod(x[0]) && on(x))],
    ["Online", list.filter(x => !isMod(x[0]) && on(x))], ["Offline", list.filter(x => !on(x))]];
  $("members").replaceChildren(...groups.filter(g => g[1].length).flatMap(([title, arr]) => [
    el("div", { class: "side-title" }, `${title} — ${arr.length}`),
    ...arr.map(([uid, u]) => {
      const line = statusOf(uid).activity || (uid === me.uid && myActivity()) ? statusLine(uid) : "";
      return el("button", {
        class: "item" + (title === "Offline" ? " offline" : ""), onclick: () => profile(uid), oncontextmenu: e => userMenu(e, uid)
      }, av(uid, 32), el("span", { class: "grow" }, el("div", {}, nameEl(uid)), line ? el("div", { class: "sub" }, line) : null));
    })
  ]));
}

function renderDms() {
  if (!me) return;
  const rows = dms.map(d => {
    const other = d.members.find(m => m !== me.uid);
    const u = lookup(other);
    const myMove = [...chessGames.values()].some(g => g.dmId === d.id && (isMyTurn(g, me.uid)
      || (g.status === "pending" && g.createdBy !== me.uid)))
      || [...matches.values()].some(m => m.dmId === d.id && ((m.status === "active" && m.turn === me.uid) || (m.status === "pending" && m.createdBy !== me.uid)));
    return el("button", {
      class: "item" + (view.type === "dm" && view.id === d.id ? " active" : ""),
      onclick: () => openDm(other), oncontextmenu: e => userMenu(e, other)
    }, av(other, 32), el("span", { class: "grow" },
      el("div", {}, nameEl(other)),
      el("div", { class: "sub" }, (d.lastFrom === me.uid ? "You: " : "") + (d.lastText || ""))),
    myMove ? el("span", { class: "chess-flag", title: "Your move in chess" }, "♟") : null,
    isUnread(d) && !(view.type === "dm" && view.id === d.id) ? el("span", { class: "dot" }) : null);
  });
  // a brand-new DM that has no messages yet
  if (view.type === "dm" && !dms.some(d => d.id === view.id)) {
    rows.unshift(el("button", { class: "item active" }, avatar(lookup(view.other), 32),
      el("span", { class: "grow" }, nameEl(view.other))));
  }
  $("dm-list").replaceChildren(...(rows.length ? rows : [el("div", { class: "muted", style: { padding: "4px 8px" } },
    "No messages yet. Click + or someone's name.")]));
}

function renderHeader() {
  if (view.type === "explore") {
    $("title").replaceChildren(el("span", { class: "hash", style: { width: "auto" } }, "🧭"), "Explore", el("span", { class: "sub" }, "Find people"));
  } else if (view.type === "announce") {
    $("title").replaceChildren(el("span", { class: "hash", style: { width: "auto" } }, "📢"), "Announcements",
      el("span", { class: "sub" }, isMod() ? "Only mods can post — everyone sees it" : "News from the mods"));
  } else if (view.type === "channel") {
    const c = view.channel;
    $("title").replaceChildren(...[el("span", { class: "hash", style: { width: "auto" } }, c.everyone ? "#" : "🔒"), c.name,
      el("span", { class: "sub" }, c.everyone ? "Everyone" : `${c.members.length} member${c.members.length === 1 ? "" : "s"} + mods`),
      el("span", { class: "call-btns" }, searchBtn(),
        isMod() ? el("button", { class: "btn sm ghost", title: "Edit channel", onclick: () => channelEditor(c) }, "⚙️ Edit") : null)].filter(Boolean));
  } else {
    const u = lookup(view.other);
    const t = el("span", { style: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" },
      onclick: () => profile(view.other), oncontextmenu: e => userMenu(e, view.other) }, av(view.other, 26), nameEl(view.other),
      el("span", { class: "sub" }, statusLine(view.other)));
    $("title").replaceChildren(t,
      el("span", { class: "call-btns" }, searchBtn(),
        el("button", { class: "btn sm ghost media-gal-btn", type: "button", title: "Photos, videos and audio in this DM", onclick: openMediaGallery }, "🖼️ Media")));
  }
}

function renderMessages(forceBottom) {
  const box = $("messages");
  if (!booted) return;
  if (view.type === "explore") {
    const all = [...users.entries()].filter(([uid, u]) => activeMember(uid, u));
    const people = all.filter(([uid]) => findable(uid));
    renderExplore(box, { people, me: me.uid, isMod, statusDot: uid => statusDot(uid, { mine: uid === me.uid }),
      activity: uid => { const a = uid === me.uid ? myActivity() : statusOf(uid).activity; return a ? activityIcon(a) + " " + activityText(a) : ""; }, isFriend: uid => friends.list.includes(uid), onProfile: profile, onMessage: openDm,
      viewerIsMod: amMod, hiddenCount: all.filter(([, u]) => u.hideFromExplore).length });
    return;
  }
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const out = [];
  const people = [...users.entries()];
  const txt = t => richText(t, { people, me: me.uid, onProfile: profile });
  if (!msgs.length) {
    out.push(view.type === "announce"
      ? el("div", { class: "empty" }, el("b", {}, "📢 Announcements"), isMod() ? "Post something for everyone. Only mods can write here." : "Nothing yet. Mods post news here.")
      : view.type === "channel"
      ? el("div", { class: "empty" }, el("b", {}, "Welcome to #" + view.channel.name),
          view.channel.everyone ? "This channel is open to everyone." : "Only the people a mod added (and mods) can see this channel.")
      : el("div", { class: "empty" }, avatar(lookup(view.other), 72), el("b", { style: { marginTop: "10px" } }, lookup(view.other).name),
          "This is the start of your conversation."));
  }
  let prev = null;
  for (const m of msgs) {
    const t = m.createdAt?.toMillis?.() ?? Date.now();
    if (isBlocked(m.uid) && !revealed.has(m.id)) {
      if (!(prev && prev.blocked && prev.uid === m.uid)) {
        out.push(el("div", { class: "msg-blocked" }, "🚫 Message from someone you blocked · ",
          el("button", { class: "link", type: "button", onclick: () => { msgs.filter(x => x.uid === m.uid).forEach(x => revealed.add(x.id)); renderMessages(false); } }, "Show")));
      }
      prev = { uid: m.uid, t, blocked: true };
      continue;
    }
    const grouped = prev && prev.uid === m.uid && t - prev.t < 5 * 60e3;
    let text;
    if (m.sticker) text = stickerEl(m.sticker);
    else if (m.chessId) text = gameCard(chessGames.get(m.chessId), me.uid, uid => lookup(uid).name, showChess);
    else if (m.matchId) text = matchCard(matches.get(m.matchId) && { ...matches.get(m.matchId) }, me.uid, uid => lookup(uid).name, showMatch);
    else if (m.gif) {
      if (!bannedGifs.has(m.gifKey) && !recentGifs.some(g => g.gifKey === m.gifKey)) recentGifs.unshift({ gif: m.gif, gifKey: m.gifKey });
      text = el("div", {}, m.text ? txt(m.text) : null, gifEl(m, bannedGifs, { fav: isFav(m.gifKey), onFav: () => toggleFav(me.uid, m).catch(err => { toast(err.message); }) }));
    } else if (m.imageId) {
      text = el("div", {}, imageEl(m.imageId, dmImages, imagesLoaded), m.text ? txt(m.text) : null);
    } else if (m.mediaId) {
      text = el("div", {}, mediaEl(view.id, m.mediaId, dmMedia, mediaLoaded), m.text ? txt(m.text) : null);
    } else text = txt(m.text);
    const menu = e => userMenu(e, m.uid, m);
    const quote = m.replyTo ? replyQuote(m.replyTo) : null;
    const pinged = m.uid !== me.uid && (mentionsMe(m.text) || (view.type === "announce" && /@everyone\b/i.test(m.text || "")) || m.replyTo?.uid === me.uid);
    const canReact = canReactHere();
    const react = key => toggleReaction(msgRef(m.id), m, me.uid, key);
    const reacts = reactionBar(m, { me: me.uid, lookup, canReact, onToggle: react, onAdd: a => openReactPicker(a, m, me.uid, react) });
    if (reacts) text = el("div", {}, text, reacts);
    const tools = el("div", { class: "msg-tools" },
      canReact ? el("button", { type: "button", title: "React", onclick: e => { e.stopPropagation(); openReactPicker(e.currentTarget, m, me.uid, react); } }, "🙂") : null,
      canReplyHere() ? el("button", { type: "button", title: "Reply", onclick: e => { e.stopPropagation(); setReply(m); } }, "↩") : null,
      el("button", { type: "button", title: "More", onclick: e => { const r = e.currentTarget.getBoundingClientRect(); userMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left - 150, clientY: r.bottom + 4 }, m.uid, m); } }, "⋯"));
    const cls = (pinged ? " mentioned" : "") + (replyTo?.id === m.id ? " replying" : "");
    if (grouped && !quote) {
      out.push(el("div", { class: "msg cont" + cls, "data-mid": m.id, oncontextmenu: menu, title: fmtTime(t) }, tools, el("div", { class: "msg-body" }, text)));
    } else {
      const u = lookup(m.uid);
      const av = avatar(u, 40); av.onclick = () => profile(m.uid);
      const nm = nameEl(m.uid, "msg-name"); nm.onclick = () => profile(m.uid);
      out.push(el("div", { class: "msg" + (quote ? " has-reply" : "") + cls, "data-mid": m.id, oncontextmenu: menu }, quote, tools, av,
        el("div", { class: "msg-body" }, el("div", { class: "msg-head" }, nm, el("span", { class: "msg-time" }, fmtTime(t))), text)));
    }
    prev = { uid: m.uid, t };
  }
  box.replaceChildren(...out);
  if (forceBottom || atBottom) box.scrollTop = box.scrollHeight;
}

// ---------- sending ----------
async function send(gif, sticker = null) {
  const input = $("input");
  const fromPicker = !!gif || !!sticker;
  let text = gif || sticker ? "" : input.value.trim();
  if (timeoutActive(myProfile) && !isMod()) { toast("You're timed out for " + timeoutLeft(myProfile)); return; }
  // a message that's just a GIF link is sent as a GIF
  if (!gif && !sticker) { const g = parseGif(text); if (g && !/\s/.test(text)) { gif = g; text = ""; } }
  if (gif && bannedGifs.has(gif.gifKey)) { toast("That GIF was banned by a mod."); return; }
  if (!text && !gif && !sticker) return;
  if (text.length > 1000) { toast("Max 1000 characters."); return; }
  if (view.type === "announce" && !isMod()) { toast("Only mods can post announcements."); return; }
  { const bad = findBlocked(text); if (bad) { toast(`🚫 Not sent — “${bad}” is a blocked word.`); return; } }
  if (!fromPicker) { input.value = ""; autosize(); }
  const reply = replyTo ? { id: replyTo.id, uid: replyTo.uid, text: replyTo.text } : null;
  const data = { uid: me.uid, text, createdAt: serverTimestamp(), ...(gif ? { gif: gif.gif, gifKey: gif.gifKey } : {}), ...(sticker ? { sticker } : {}), ...(reply ? { replyTo: reply } : {}) };
  setReply(null);
  try {
    if (view.type === "announce") {
      await addDoc(collection(db, "rooms", "global", "messages"), data);
    } else if (view.type === "channel") {
      const b = writeBatch(db);
      b.set(doc(collection(db, "channels", view.id, "messages")), data);
      b.update(doc(db, "channels", view.id), { lastMessageAt: serverTimestamp(), lastText: sticker ? "💖 Sticker" : gif ? "🖼️ GIF" : text.slice(0, 100), lastFrom: me.uid });
      await b.commit();
    } else {
      const b = writeBatch(db);
      b.set(doc(db, "dms", view.id), {
        members: view.id.split("_"), lastMessageAt: serverTimestamp(),
        lastText: sticker ? "💖 Sticker" : gif ? "🖼️ GIF" : text.slice(0, 100), lastFrom: me.uid
      });
      b.set(doc(collection(db, "dms", view.id, "messages")), data);
      await b.commit();
    }
    if (gif) bumpGif(gif);
    $("messages").scrollTop = $("messages").scrollHeight;
  } catch (err) {
    toast("Couldn't send: " + (err.code || err.message));
    if (!fromPicker && !input.value) { input.value = text || gif?.gif || ""; autosize(); }
  }
}
function autosize() { const i = $("input"); i.style.height = "auto"; i.style.height = Math.min(i.scrollHeight, 180) + "px"; }
$("input").addEventListener("input", autosize);
let mentionUi = null;
$("input").addEventListener("keydown", e => {
  if (mentionUi?.handleKey(e)) return; // the @ list handles Enter / Tab / arrows
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  else if (e.key === "Escape" && replyTo) { e.preventDefault(); setReply(null); }
});
mentionUi = attachMentions($("input"), { anchor: $("composer-wrap"), nameEl: uid => uid === "@everyone" ? el("span", { style: { fontWeight: 700 } }, "everyone — ping all") : nameEl(uid, ""),
  getPeople: () => {
    let ids;
    if (view.type === "dm") ids = [view.other, me.uid];
    else if (view.type === "channel" && !view.channel?.everyone) ids = [...(view.channel?.members || []), ...mods];
    const list = [...users.entries()].filter(([uid, u]) => uid !== me.uid && activeMember(uid, u) && (!ids || ids.includes(uid)));
    if (view.type === "announce" && isMod()) list.unshift(["@everyone", { name: "everyone", nameColor: "#f59e0b" }]);
    return list;
  } });
$("send").onclick = () => send();
$("sticker-btn").onclick = e => openStickerPicker(e.currentTarget, k => send(null, k));
$("gif-btn").onclick = () => openGifPicker({ uid: me.uid, recent: recentGifs, banned: bannedGifs, onPick: g => send(g) });

// ---------- photos in DMs ----------
let sendingImage = false;
async function sendImage(file) {
  if (!file || view.type !== "dm" || sendingImage) return;
  if (timeoutActive(myProfile) && !isMod()) { toast("You're timed out for " + timeoutLeft(myProfile)); return; }
  if (!file.type.startsWith("image/")) { toast("Only images can be sent."); return; }
  const dmId = view.id, ok = await confirmImage(file, lookup(view.other).name);
  if (!ok) return;
  if (findBlocked(ok.caption)) { toast("🚫 Your caption has a blocked word."); return; }
  sendingImage = true; $("img-btn").classList.add("busy"); toast("Sending photo…");
  try { await sendDmImage({ dmId, me: me.uid, file, caption: ok.caption }); }
  catch (err) { toast("Couldn't send photo: " + (err.code || err.message)); }
  sendingImage = false; $("img-btn").classList.remove("busy");
}
$("img-btn").onclick = async () => sendImage(await pickImageFile());
const sendFile = f => (f.type.startsWith("image/") ? sendImage(f) : sendMedia(f));

// ---------- audio & video in DMs ----------
let sendingMedia = false;
async function sendMedia(file) {
  if (!file || view.type !== "dm" || sendingMedia) return;
  if (timeoutActive(myProfile) && !isMod()) { toast("You're timed out for " + timeoutLeft(myProfile)); return; }
  if (!kindOf(file.type)) { toast("Pick an audio or video file."); return; }
  const dmId = view.id, caption = $("input").value.trim().slice(0, 1000);
  if (findBlocked(caption)) { toast("🚫 Your caption has a blocked word."); return; }
  const reply = replyTo ? { id: replyTo.id, uid: replyTo.uid, text: replyTo.text } : null;
  sendingMedia = true; $("media-btn").classList.add("busy");
  const bar = el("div", { class: "upload-bar" }, el("span", {}, `Uploading ${file.name}…`), el("div", { class: "m-bar" }, el("div", { class: "m-bar-fill" })));
  $("composer-wrap").prepend(bar);
  try {
    await sendDmMedia({ dmId, me: me.uid, file, caption, replyTo: reply, onProgress: p => (bar.querySelector(".m-bar-fill").style.width = Math.round(p * 100) + "%") });
    if (caption) { $("input").value = ""; autosize(); }
    setReply(null);
  } catch (err) { toast("Couldn't send: " + (err.code || err.message)); }
  bar.remove(); sendingMedia = false; $("media-btn").classList.remove("busy");
}
$("media-btn").onclick = async () => sendMedia(await pickMediaFile());
function openMediaGallery() {
  if (view.type !== "dm") return;
  const items = [];
  for (const m of msgs) {
    const at = m.createdAt?.toMillis?.() ?? 0;
    if (m.imageId && dmImages.get(m.imageId)) items.push({ kind: "image", at, src: dmImages.get(m.imageId).data });
    if (m.mediaId && dmMedia.get(m.mediaId)) items.push({ kind: dmMedia.get(m.mediaId).kind, at, meta: dmMedia.get(m.mediaId) });
  }
  openGallery(view.id, items, lookup(view.other).name);
}

// ---------- replies ----------
const canReplyHere = () => view.type !== "explore" && (view.type !== "announce" || isMod());
// where the open conversation's messages live
function msgRef(id) {
  return view.type === "announce" ? doc(db, "rooms", "global", "messages", id)
    : view.type === "channel" ? doc(db, "channels", view.id, "messages", id)
    : doc(db, "dms", view.id, "messages", id);
}
function canReactHere() {
  if (view.type === "announce") return true;
  if (!isMod() && timeoutActive(myProfile)) return false;
  return view.type !== "dm" || !isBlocked(view.other);
}
const previewOf = m => (m.text || (m.sticker ? "💖 Sticker" : m.gif ? "🖼️ GIF" : m.imageId ? "📷 Photo" : m.mediaId ? "🎞️ Media" : m.chessId ? "♟ Chess game" : m.matchId ? "🎮 Game" : "")).slice(0, 120);
function setReply(m) {
  replyTo = m ? { id: m.id, uid: m.uid, text: previewOf(m) } : null;
  const bar = $("reply-bar");
  if (!replyTo) { bar.hidden = true; document.querySelectorAll(".msg.replying").forEach(x => x.classList.remove("replying")); return; }
  bar.replaceChildren(el("span", { class: "grow" }, "Replying to ", nameEl(m.uid, "reply-name"), el("span", { class: "muted" }, " — " + (replyTo.text || ""))),
    el("button", { class: "icon-btn", type: "button", title: "Cancel reply (Esc)", onclick: () => setReply(null) }, "✕"));
  bar.hidden = false;
  document.querySelectorAll(".msg.replying").forEach(x => x.classList.remove("replying"));
  document.querySelector(`[data-mid="${CSS.escape(m.id)}"]`)?.classList.add("replying");
  $("input").focus();
}
function replyQuote(r) {
  const u = lookup(r.uid);
  return el("button", { type: "button", class: "reply-quote", title: "Jump to message", onclick: () => jumpTo(r.id) },
    el("span", { class: "reply-curve" }), avatar(u, 16), el("span", { class: "reply-who", style: { color: u.nameColor } }, isBlocked(r.uid) ? "Blocked user" : u.name),
    el("span", { class: "reply-text" }, isBlocked(r.uid) ? "Hidden message" : r.text || "Click to see attachment"));
}
function jumpTo(id, quiet) {
  const n = document.querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (!n) { if (!quiet) toast("That message is too old or was deleted."); return false; }
  n.scrollIntoView({ block: "center", behavior: "smooth" });
  n.classList.remove("flash"); void n.offsetWidth; n.classList.add("flash");
  return true;
}
function searchHere() {
  if (view.type === "dm") openSearch({ path: ["dms", view.id], title: "DM with " + lookup(view.other).name, me: me.uid, other: view.other, lookup, isBlocked, onJump: id => jumpTo(id, true) });
  else if (view.type === "channel") openSearch({ path: ["channels", view.id], title: "#" + view.channel.name, me: me.uid, lookup, isBlocked, onJump: id => jumpTo(id, true) });
}
const searchBtn = () => el("button", { class: "icon-btn", type: "button", title: "Search messages (Ctrl+F)", onclick: searchHere }, "🔍");
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && (view.type === "dm" || view.type === "channel") && !document.querySelector(".overlay, .game-overlay")) { e.preventDefault(); searchHere(); }
});
function insertMention(uid) {
  const i = $("input"), add = "@" + lookup(uid).name + " ";
  i.value = (i.value && !/\s$/.test(i.value) ? i.value + " " : i.value) + add; autosize(); i.focus();
}
$("input").addEventListener("paste", e => {
  const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith("image/") || kindOf(f.type));
  if (f && view.type === "dm") { e.preventDefault(); sendFile(f); }
});
for (const zone of [$("messages"), $("composer-box")]) {
  zone.addEventListener("dragover", e => { if (view.type === "dm" && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); zone.classList.add("drop"); } });
  zone.addEventListener("dragleave", () => zone.classList.remove("drop"));
  zone.addEventListener("drop", e => {
    zone.classList.remove("drop");
    const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith("image/") || kindOf(f.type));
    if (f && view.type === "dm") { e.preventDefault(); sendFile(f); }
  });
}

// timeout banner on the message box (also: DMs with someone you blocked)
const revealed = new Set(); // blocked people's messages you chose to show
function renderComposer() {
  if (!myProfile) return;
  const out = timeoutActive(myProfile) && !isMod();
  const blockedDm = view.type === "dm" && isBlocked(view.other);
  const readOnly = view.type === "announce" && !isMod();
  $("composer").hidden = view.type === "explore";
  $("readonly-bar").hidden = !readOnly;
  $("timeout-bar").hidden = !(out || blockedDm) || readOnly;
  $("composer-box").hidden = out || blockedDm || readOnly;
  if (!blockedDm) delete $("timeout-bar").dataset.uid;
  if (out) $("timeout-bar").textContent = `⏱ You're timed out for ${timeoutLeft(myProfile)}` +
    (myProfile.timeoutReason ? ` — ${myProfile.timeoutReason}` : "") + ". You can still read chat.";
  else if (blockedDm && $("timeout-bar").dataset.uid !== view.other) {
    const u = lookup(view.other);
    $("timeout-bar").dataset.uid = view.other;
    $("timeout-bar").replaceChildren(`🚫 You blocked ${u.name}. `,
      el("button", { class: "link unblock-btn", type: "button", onclick: () => unblock(view.other, u.name).catch(err => toast(err.message)) }, "Unblock"));
  }
}

// ---------- channels in the sidebar ----------
function renderRooms() {
  if (!me) return;
  $("go-explore").classList.toggle("active", view.type === "explore");
  const g = $("go-announce");
  g.classList.toggle("active", view.type === "announce");
  g.querySelector(".dot")?.remove();
  if (view.type !== "announce" && globalLast && isUnread({ lastFrom: globalLast.from, lastMessageAt: { toMillis: () => globalLast.at } }, "global"))
    g.append(el("span", { class: "dot" }));
  $("new-channel").hidden = !isMod();
  $("channel-list").replaceChildren(...channels.map(c => {
    const active = view.type === "channel" && view.id === c.id;
    return el("button", { class: "item" + (active ? " active" : ""), onclick: () => openChannel(c.id),
      oncontextmenu: e => {
        if (!isMod()) return;
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: "⚙️ Edit channel", onClick: () => channelEditor(c) },
          { label: "🗑 Delete channel", danger: true, onClick: () => deleteChannel(c, () => { if (view.type === "channel" && view.id === c.id) switchView({ type: "explore" }); }) }
        ]);
      } },
      el("span", { class: "hash" }, c.everyone ? "#" : "🔒"), el("span", { class: "grow name" }, c.name),
      !active && isUnread(c, "ch_" + c.id) ? el("span", { class: "dot" }) : null);
  }));
}
function channelEditor(c = null) {
  const people = [...users.entries()].filter(([uid, u]) => !isMod(uid) && u.approved && u.codeVerified);
  editChannel({ me: me.uid, channel: c, people, nameEl, onSaved: id => setTimeout(() => openChannel(id), 400) });
}
$("new-channel").onclick = () => channelEditor();

// ---------- friends ----------
function renderFriendsBtn() {
  const n = friends.incoming.length;
  $("friends-count").hidden = !n; $("friends-count").textContent = n;
}
$("friends-btn").onclick = () => openFriends({ lookup, nameEl, onMessage: openDm, onOpenProfile: profile });

// ---------- notification settings ----------
$("bell").onclick = () => openNotifySettings();
applyChatSettings();

// ---------- sidebar buttons ----------
$("me-avatar").onclick = e => { const r = e.currentTarget.getBoundingClientRect(); openStatusMenu(r.left, r.top - 330, { findBlocked }); };
$("go-explore").onclick = () => switchView({ type: "explore" });
$("go-announce").onclick = () => switchView({ type: "announce" });
// 💡 suggestions (mods see everyone's + a count of new ones)
let suggestMode = null, suggestUnsub = null;
function syncSuggest() {
  if (suggestMode === amMod) return;
  suggestMode = amMod; suggestUnsub?.();
  suggestUnsub = watchSuggestions(me.uid, amMod, n => { const c = $("suggest-count"); c.hidden = !n; c.textContent = n; });
}
$("go-suggest").onclick = () => openSuggestions({ me: me.uid, isMod: () => isMod(), lookup, findBlocked, onProfile: uid => profile(uid) });
$("theme-btn").onclick = () => { const t = window.sussyTheme; t.set({ mode: t.get().mode === "light" ? "dark" : "light" }); drawThemeBtn(); };
const drawThemeBtn = () => { $("theme-btn").textContent = window.sussyTheme?.get().mode === "light" ? "🌙" : "☀️"; $("theme-btn").title = window.sussyTheme?.get().mode === "light" ? "Dark mode" : "Light mode"; };
drawThemeBtn();
$("signout").onclick = () => { clearCodeOk(me.uid); signOut(auth); };
$("new-dm").onclick = () => {
  const search = el("input", { class: "input", placeholder: "Search people" });
  const list = el("div", { style: { marginTop: "10px", maxHeight: "50vh", overflowY: "auto" } });
  let modal;
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const people = [...users.entries()]
      .filter(([uid, u]) => uid !== me.uid && activeMember(uid, u) && findable(uid) && u.name.toLowerCase().includes(q))
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    list.replaceChildren(...(people.length ? people.map(([uid, u]) => el("button", { class: "item",
      onclick: () => { modal.close(); openDm(uid); } }, avatar(u, 32), el("span", { class: "grow" }, nameEl(uid))))
      : [el("div", { class: "muted" }, "Nobody found.")]));
  };
  search.oninput = draw; draw();
  modal = openModal("New message", el("div", {}, search, list), [{ label: "Cancel" }]);
};
$("settings").onclick = () => openSettings({ me: me.uid, profile: myProfile, lookup, isMod: amMod && !amOwner, hideModTag: !!myModDoc?.hideTag,
  isOwner: amOwner, ownerTag: ownerTagOf(me.uid), onOwnerTag: setOwnerTag,
  onHideModTag: h => setHideModTag(h).then(() => renderAll()), onTheme: drawThemeBtn });

// ---------- mobile drawers ----------
function closeDrawers() { $("left").classList.remove("open"); $("right").classList.remove("open"); }
$("open-left").onclick = e => { e.stopPropagation(); $("right").classList.remove("open"); $("left").classList.toggle("open"); };
$("open-right").onclick = e => { e.stopPropagation(); $("left").classList.remove("open"); $("right").classList.toggle("open"); };
$("messages").addEventListener("click", closeDrawers);
