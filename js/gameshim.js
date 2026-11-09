// Added to the top of each game in /games. Games run in a locked-down frame (no access to your
// login), where cookies and localStorage don't exist and many games crash. This gives them
// stand-ins, and saves their progress through the site (the frame's name carries the old save in).
(function () {
  // panic key ":" → the site jumps to Google
  window.addEventListener("keydown", function (e) {
    if (e.key === ":" && !e.ctrlKey && !e.metaKey && !e.altKey) { try { parent.postMessage({ __panic: 1 }, "*"); } catch (x) {} }
  }, true);
  var S = {}; try { if (window.name && window.name.indexOf('{"__gs"') === 0) S = JSON.parse(window.name); } catch (e) {}
  var ls = S.ls || {}, ck = S.cookie || "", mem = {};
  function save() { try { parent.postMessage({ __gs: 1, ls: ls, cookie: ck }, "*"); } catch (e) {} }
  function mk(o, persist) {
    var s = {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(o(), k) ? o()[k] : null; },
      setItem: function (k, v) { o()[String(k)] = String(v); if (persist) save(); },
      removeItem: function (k) { delete o()[String(k)]; if (persist) save(); },
      clear: function () { var x = o(); for (var k in x) delete x[k]; if (persist) save(); },
      key: function (i) { return Object.keys(o())[i] || null; }
    };
    Object.defineProperty(s, "length", { get: function () { return Object.keys(o()).length; } });
    return s;
  }
  try { window.localStorage.length; } catch (e) { try { var L = mk(function () { return ls; }, true); Object.defineProperty(window, "localStorage", { get: function () { return L; }, configurable: true }); } catch (e2) {} }
  try { window.sessionStorage.length; } catch (e) { try { var T = mk(function () { return mem; }, false); Object.defineProperty(window, "sessionStorage", { get: function () { return T; }, configurable: true }); } catch (e2) {} }
  try { document.cookie; } catch (e) {
    try {
      // on the document itself (works in Chrome and Firefox), falls back to the prototype
      var target = document;
      try { Object.defineProperty(document, "__t", { value: 1, configurable: true }); delete document.__t; } catch (x) { target = Document.prototype; }
      Object.defineProperty(target, "cookie", { configurable: true,
        get: function () { return ck; },
        set: function (v) {
          var kv = String(v).split(";")[0], n = kv.split("=")[0].trim(), parts = ck ? ck.split("; ") : [];
          parts = parts.filter(function (p) { return p.split("=")[0] !== n; });
          if (!/expires=Thu, 01 Jan 1970/i.test(v) && !/max-age=0/i.test(v)) parts.push(kv.trim());
          ck = parts.join("; "); save();
        } });
    } catch (e2) {}
  }
  try { var idb = window.indexedDB; if (idb) idb.cmp(1, 2); } catch (e) {
    try {
      var fail = function () { var r = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, error: new Error("storage off"), result: null,
        addEventListener: function (t, f) { if (t === "error") setTimeout(function () { f({ target: r }); }, 0); }, removeEventListener: function () {} };
        setTimeout(function () { r.onerror && r.onerror({ target: r, preventDefault: function () {} }); }, 0); return r; };
      var fake = { open: fail, deleteDatabase: fail, cmp: function (a, b) { return a < b ? -1 : a > b ? 1 : 0; }, databases: function () { return Promise.resolve([]); } };
      Object.defineProperty(window, "indexedDB", { get: function () { return fake; }, configurable: true });
    } catch (e2) {}
  }
  try { if (!navigator.serviceWorker) throw 0; navigator.serviceWorker.getRegistrations; } catch (e) {
    try {
      var sw = { register: function () { return Promise.reject(new Error("off")); }, getRegistrations: function () { return Promise.resolve([]); },
        getRegistration: function () { return Promise.resolve(undefined); }, ready: new Promise(function () {}),
        addEventListener: function () {}, removeEventListener: function () {}, controller: null };
      Object.defineProperty(Navigator.prototype, "serviceWorker", { get: function () { return sw; }, configurable: true });
    } catch (e2) {}
  }
})();
