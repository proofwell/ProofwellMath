import { auth, db, el, avatar, banActive, banText, codeOkThisVisit, markCodeOk, clearCodeOk } from "./firebase.js";
import { colorPicker } from "./ui.js";
import {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, onSnapshot, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const VIEWS = ["v-auth", "v-profile", "v-verify", "v-code", "v-pending", "v-rejected", "v-banned"];
function show(id) {
  VIEWS.forEach(v => $(v).hidden = v !== id);
  $("tagline").hidden = id !== "v-auth";
  document.body.classList.remove("loading");
}
const setErr = t => { $("err").textContent = t || ""; };

function friendly(e) {
  const c = e?.code || "";
  if (c.includes("email-already-in-use")) return "That email already has an account. Try logging in.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Wrong email or password.";
  if (c.includes("weak-password") || c.includes("password-does-not-meet")) return "Password is too weak: use 8+ characters with letters and numbers.";
  if (c.includes("invalid-email")) return "That email doesn't look right.";
  if (c.includes("too-many-requests")) return "Too many tries. Wait a bit and try again.";
  if (c.includes("permission-denied")) return "Not allowed.";
  return e?.message || String(e);
}

// ?join = came from "Terms of Service": ask for the codes / approval, then open chat.
// Without it, signing in just goes to the math practice page.
const JOIN = new URLSearchParams(location.search).has("join");
$("guest").onclick = () => { try { sessionStorage.setItem("guest", "1"); } catch {} location.replace("math.html"); };

// ---------- device: Chromebooks need 1 code, everything else needs 3 ----------
// (Browsers report their own device type, so this is a speed bump, not real security.
//  The codes themselves are only checked by the database rules.)
export const isChromebook = /\bCrOS\b/.test(navigator.userAgent) || navigator.userAgentData?.platform === "Chrome OS";
if (!isChromebook) {
  $("code-multi").hidden = false;
  $("code-sub").textContent = "This device needs your class code and section code.";
  $("code").placeholder = "Class code";
}

// password strength: 8+ characters with a letter and a number
function passwordProblem(p) {
  if (p.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return "Password needs at least one letter and one number.";
  if (/^(password|12345678|qwerty)/i.test(p)) return "That password is too easy to guess.";
  return null;
}
$("su-pass").addEventListener("input", () => {
  const p = $("su-pass").value, bad = p && passwordProblem(p);
  $("pass-hint").textContent = !p ? "8+ characters, with letters and numbers" : bad || "✓ Strong enough";
  $("pass-hint").style.color = !p ? "" : bad ? "#ff7b7e" : "#6fd793";
});

// ---------- tabs ----------
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("active", x === b));
  $("f-login").hidden = b.dataset.tab !== "login";
  $("f-signup").hidden = b.dataset.tab !== "signup";
  setErr("");
});

// ---------- signup color + preview ----------
const suColor = colorPicker("#5865f2");
$("su-color").append(suColor.root);
const pfColor = colorPicker("#5865f2");
$("pf-color").append(pfColor.root);
function renderPreview() {
  const u = { name: $("su-name").value.trim() || "Your name", nameColor: suColor.value, photoURL: $("su-photo").value.trim() };
  $("su-preview").replaceChildren(avatar(u, 40), el("b", { style: { color: u.nameColor } }, u.name));
}
suColor.onChange = renderPreview;
$("su-name").oninput = renderPreview;
$("su-photo").oninput = renderPreview;
renderPreview();

// ---------- profile creation ----------
let creating = false;
function cleanPhoto(p) {
  p = p.trim();
  if (!p) return "";
  if (!/^https?:\/\/.+/.test(p)) throw new Error("Profile picture must be a link starting with http:// or https://");
  return p;
}
async function createProfile(user, name, color, photo) {
  name = name.trim();
  if (name.length < 1 || name.length > 24) throw new Error("Name must be 1–24 characters.");
  const b = writeBatch(db);
  b.set(doc(db, "users", user.uid), {
    name, nameColor: color, photoURL: cleanPhoto(photo),
    codeVerified: false, approved: false,
    banned: false, banPermanent: false, banUntil: null, banReason: "",
    createdAt: serverTimestamp()
  });
  b.set(doc(db, "privateInfo", user.uid), { email: user.email });
  await b.commit();
}

// ---------- forms ----------
$("f-login").onsubmit = async e => {
  e.preventDefault(); setErr("");
  try { await signInWithEmailAndPassword(auth, $("li-email").value.trim(), $("li-pass").value); }
  catch (err) { setErr(friendly(err)); }
};

$("forgot").onclick = async () => {
  const email = $("li-email").value.trim();
  if (!email) { setErr("Type your email above first."); return; }
  try { await sendPasswordResetEmail(auth, email); setErr("If that email has an account, a reset link is on its way."); }
  catch (err) { setErr(friendly(err)); }
};

$("f-signup").onsubmit = async e => {
  e.preventDefault(); setErr("");
  const name = $("su-name").value, photo = $("su-photo").value;
  try {
    cleanPhoto(photo); if (!name.trim()) throw new Error("Enter a display name.");
    const pp = passwordProblem($("su-pass").value); if (pp) throw new Error(pp);
  } catch (err) { setErr(err.message); return; }
  creating = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, $("su-email").value.trim(), $("su-pass").value);
    await createProfile(cred.user, name, suColor.value, photo);
    sendEmailVerification(cred.user).catch(() => {});
  } catch (err) { setErr(friendly(err)); }
  creating = false;
  if (auth.currentUser) watch(auth.currentUser);
};

$("f-profile").onsubmit = async e => {
  e.preventDefault(); setErr("");
  try { await createProfile(auth.currentUser, $("pf-name").value, pfColor.value, $("pf-photo").value); }
  catch (err) { setErr(friendly(err)); }
};

// The codes are never in this file — the database rules check them.
$("f-code").onsubmit = async e => {
  e.preventDefault(); setErr("");
  const uid = auth.currentUser.uid;
  const guess = { code: $("code").value.trim() };
  if (!isChromebook) guess.code2 = $("code2").value.trim();
  if (Object.values(guess).some(v => !v)) { setErr(isChromebook ? "Enter your class code." : "Enter both codes (class and section)."); return; }
  const btn = $("f-code").querySelector("button"); btn.disabled = true;

  // check it
  const b = writeBatch(db);
  b.set(doc(db, "codeChecks", uid), { ...guess, at: serverTimestamp() });
  if (!lastProfile?.codeVerified) b.update(doc(db, "users", uid), { codeVerified: true });
  try {
    await b.commit();
    markCodeOk(uid);
    ["code", "code2"].forEach(id => $(id).value = "");
    route();
  } catch {
    setErr(isChromebook ? "That class code isn't right." : "One or more of those codes isn't right.");
    $("code").select();
  }
  btn.disabled = false;
};

// ---------- email verification ----------
async function refreshVerified() {
  const u = auth.currentUser; if (!u) return false;
  await u.reload();
  if (u.emailVerified) { await u.getIdToken(true); return true; } // new token tells the database you're verified
  return false;
}
let verifyPoll = null;
$("verify-done").onclick = async () => {
  setErr("");
  if (await refreshVerified()) route(); else setErr("Not confirmed yet. Click the link in the email first (check spam).");
};
$("verify-resend").onclick = async () => {
  try { await sendEmailVerification(auth.currentUser); setErr("Sent! Check your inbox and spam folder."); }
  catch (err) { setErr(friendly(err)); }
};

$("signout").onclick = () => { if (auth.currentUser) clearCodeOk(auth.currentUser.uid); signOut(auth); };

// ---------- state ----------
// Order every visit: password (log in) → verified email → code(s) → (banned / waiting / denied) → chat
let unsubUser = null, banTimer = null, lastProfile = null, lastIsMod = false;

function route() {
  const user = auth.currentUser;
  if (!user) return;
  clearTimeout(banTimer);
  const u = lastProfile, isMod = lastIsMod;
  if (!u) { show("v-profile"); return; }
  if (!JOIN) {
    // normal sign-in → math practice (email must be confirmed first, except mods)
    if (!isMod && !user.emailVerified) { showVerify(user); return; }
    return location.replace("math.html");
  }
  if (!isMod && banActive(u)) {
    $("ban-when").textContent = "Suspended " + banText(u);
    $("ban-reason").textContent = u.banReason || "No reason given.";
    show("v-banned");
    if (!u.banPermanent) {
      const ms = u.banUntil.toMillis() - Date.now();
      if (ms < 2 ** 31) banTimer = setTimeout(route, ms + 1000);
    }
    return;
  }
  if (!isMod && !user.emailVerified) { showVerify(user); return; }
  if (!codeOkThisVisit(user.uid)) { show("v-code"); $("code").focus(); return; }
  if (isMod) return location.replace("chat.html");
  if (u.rejected) { show("v-rejected"); return; }
  if (!u.approved) { show("v-pending"); return; }
  location.replace("chat.html");
}

function showVerify(user) {
  clearInterval(verifyPoll);
  $("verify-email").textContent = user.email;
  show("v-verify");
  verifyPoll = setInterval(async () => { if (await refreshVerified()) { clearInterval(verifyPoll); route(); } }, 5000);
}

function watch(user) {
  unsubUser?.();
  getDoc(doc(db, "mods", user.uid)).then(m => {
    lastIsMod = m.exists();
    unsubUser = onSnapshot(doc(db, "users", user.uid), snap => {
      if (creating) return;
      lastProfile = snap.exists() ? snap.data() : null;
      route();
    }, err => { setErr(friendly(err)); });
  }).catch(err => setErr(friendly(err)));
}

onAuthStateChanged(auth, user => {
  unsubUser?.(); unsubUser = null;
  setErr("");
  $("signed-as").hidden = !user;
  if (!user) { show("v-auth"); return; }
  $("signed-as-text").textContent = "Signed in as " + user.email;
  $("back-practice").hidden = !JOIN;
  try { sessionStorage.removeItem("guest"); } catch {}
  if (!creating) watch(user);
});
