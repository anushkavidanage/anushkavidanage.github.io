/* ============================================================
   Sidebar toggle + hero typing effect
   ============================================================ */

(function () {
  "use strict";

  /* ---------- mobile sidebar ---------- */
  var body   = document.body;
  var toggle = document.querySelector(".navtoggle");
  var scrim  = document.querySelector(".scrim");

  function setNav(open) {
    body.classList.toggle("nav-open", open);
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  if (toggle) {
    toggle.addEventListener("click", function () {
      setNav(!body.classList.contains("nav-open"));
    });
  }
  if (scrim) scrim.addEventListener("click", function () { setNav(false); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setNav(false);
  });

  /* ---------- typed roles ---------- */
  var el = document.querySelector("[data-roles]");
  if (!el) return;

  var roles;
  try { roles = JSON.parse(el.dataset.roles); }
  catch (err) { return; }
  if (!roles || !roles.length) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) { el.textContent = roles[0]; return; }

  var TYPE = 65, ERASE = 34, HOLD = 1900, GAP = 420;
  var r = 0, c = 0, erasing = false;

  function tick() {
    var word = roles[r];
    el.textContent = word.slice(0, c);

    if (!erasing) {
      if (c < word.length) { c++; setTimeout(tick, TYPE); }
      else { erasing = true; setTimeout(tick, HOLD); }
    } else {
      if (c > 0) { c--; setTimeout(tick, ERASE); }
      else { erasing = false; r = (r + 1) % roles.length; setTimeout(tick, GAP); }
    }
  }
  tick();
})();
