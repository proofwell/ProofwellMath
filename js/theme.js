// Theme: light/dark, accent color, brightness and the background grid.
// A plain script (not a module) so it runs before the page paints — no flash of the wrong colors.
(function () {
  var KEY = "sussyTheme";
  var DEF = { mode: "dark", accent: "#14b8a6", brightness: 50, grid: true };
  var ACCENTS = [
    { name: "Teal", c: "#14b8a6" }, { name: "Violet", c: "#8b5cf6" }, { name: "Blue", c: "#3b82f6" },
    { name: "Rose", c: "#f43f5e" }, { name: "Amber", c: "#f59e0b" }, { name: "Lime", c: "#65a30d" },
    { name: "Pink", c: "#ec4899" }, { name: "Slate", c: "#64748b" }
  ];

  function get() {
    try { var t = JSON.parse(localStorage.getItem(KEY) || "{}"); var o = {}; for (var k in DEF) o[k] = k in t ? t[k] : DEF[k]; return o; }
    catch (e) { return Object.assign({}, DEF); }
  }
  function hexToHsl(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return [174, 70, 40];
    var n = parseInt(m[1], 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }
  function apply(t) {
    t = t || get();
    var root = document.documentElement, hsl = hexToHsl(t.accent), h = hsl[0];
    var tint = Math.min(18, hsl[1] * .22);                 // surfaces get a faint hint of the accent
    var b = (Math.max(0, Math.min(100, +t.brightness)) - 50) / 50; // -1 … 1
    var c = function (s, l) { return "hsl(" + h + " " + s.toFixed(1) + "% " + Math.max(0, Math.min(100, l)).toFixed(1) + "%)"; };
    var v;
    if (t.mode === "light") {
      var o = b * 4;
      v = { bg: c(tint, 93 + o), panel: c(tint, 97 + o), panel2: c(tint * .6, 99.5 + o), input: c(tint, 90 + o), hover: c(tint, 88 + o),
        line: c(tint, 83 + o), text: c(tint * .8, 13), muted: c(tint * .6, 40), side: c(tint, 95 + o), ctx: "#ffffff",
        grid: "color-mix(in srgb, " + t.accent + " 9%, transparent)", shadow: "#0f172a22", hoverMsg: c(tint, 95 + o) };
    } else {
      var d = b * 6;
      v = { bg: c(tint, 7 + d), panel: c(tint, 10 + d), panel2: c(tint, 12.5 + d), input: c(tint, 17 + d), hover: c(tint, 19 + d),
        line: c(tint, 21 + d), text: c(tint * .4, 95), muted: c(tint * .5, 66), side: c(tint, 8.5 + d), ctx: c(tint, 6 + d),
        grid: "color-mix(in srgb, " + t.accent + " 7%, transparent)", shadow: "#0009", hoverMsg: c(tint, 15 + d) };
    }
    for (var k in v) root.style.setProperty("--" + k, v[k]);
    root.style.setProperty("--accent", t.accent);
    root.style.setProperty("--accent-h", "color-mix(in srgb, " + t.accent + " 82%, black)");
    root.style.setProperty("--accent-soft", "color-mix(in srgb, " + t.accent + " 18%, transparent)");
    root.style.setProperty("--link", t.mode === "light" ? "color-mix(in srgb, " + t.accent + " 75%, black)" : "color-mix(in srgb, " + t.accent + " 65%, white)");
    root.dataset.theme = t.mode === "light" ? "light" : "dark";
    root.classList.toggle("grid-bg", !!t.grid);
    root.style.colorScheme = t.mode === "light" ? "light" : "dark";
  }
  function set(patch) {
    var t = Object.assign(get(), patch);
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) {}
    apply(t); return t;
  }
  window.sussyTheme = { get: get, set: set, apply: apply, DEF: DEF, ACCENTS: ACCENTS };
  apply();
})();
