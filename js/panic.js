// Panic key: press ":" to jump straight to Google (works in games too).
// Ignored while you're typing in a text box, so ":)" in chat is safe.
(function () {
  var GO = "https://www.google.com";
  function go() { try { window.top.location.replace(GO); } catch (e) { location.replace(GO); } }
  function typing(t) { return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !/^(checkbox|radio|range|button|submit|color|file)$/i.test(t.type || "")); }
  window.addEventListener("keydown", function (e) {
    if (e.key === ":" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) { e.preventDefault(); go(); }
  }, true);
  // games (in their own frames) tell us when ":" is pressed
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.__panic !== 1) return;
    var frames = document.getElementsByTagName("iframe");
    for (var i = 0; i < frames.length; i++) if (frames[i].contentWindow === e.source) return go();
  });
})();
