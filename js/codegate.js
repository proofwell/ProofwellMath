import { db, el, toast } from "./firebase.js";
import { openModal } from "./ui.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Ask for the class code (3253) before opening Games or Movies.
// The code isn't in this file: the database rules check it (same check as sign-in).
export function requireCode(uid, what) {
  return new Promise(resolve => {
    let done = false;
    const input = el("input", { class: "input code-input", inputmode: "numeric", maxlength: 12, autocomplete: "off", placeholder: "Code" });
    const err = el("p", { class: "err", style: { minHeight: "1em" } });
    const check = async () => {
      const code = input.value.trim();
      if (!code) { err.textContent = "Enter the code."; return false; }
      try {
        await setDoc(doc(db, "codeChecks", uid), { code, at: serverTimestamp() });
        done = true; resolve(true); return true;
      } catch {
        err.textContent = "That code isn't right."; input.select(); return false;
      }
    };
    input.onkeydown = async e => { if (e.key === "Enter") { e.preventDefault(); if (await check()) m.close(); } };
    const m = openModal(`🔒 Enter the code to open ${what}`, el("div", { class: "form" }, input, err), [
      { label: "Cancel", onClick: () => { done = true; resolve(false); } },
      { label: "Open", kind: "primary", onClick: check }
    ]);
    // closed with Esc / clicking outside
    const iv = setInterval(() => { if (!document.body.contains(input)) { clearInterval(iv); if (!done) { done = true; resolve(false); } } }, 300);
  });
}
