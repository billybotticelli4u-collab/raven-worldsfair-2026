(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var reveals = document.querySelectorAll(".reveal");
  if (reveals.length) {
    if (reduce || !("IntersectionObserver" in window)) {
      reveals.forEach(function (el) { el.classList.add("in"); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
      reveals.forEach(function (el) { io.observe(el); });
    }
  }

  var tabs = document.querySelectorAll('.tabs [role="tab"]');
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var panelId = tab.getAttribute("aria-controls");
      tabs.forEach(function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      document.querySelectorAll(".panel[role='tabpanel']").forEach(function (p) {
        var show = p.id === panelId;
        p.hidden = !show;
        if (!show) {
          var v = p.querySelector("video");
          if (v && !v.paused) v.pause();
        }
      });
    });
  });
})();
