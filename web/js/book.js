/* Theory of Horology — online flip-book.
 *
 * A dependency-free viewer that reads tools/build_webbook.py's book.json and
 * presents the *photographed* pages as a page-flipping book. The OCR text in
 * the manifest powers full-text search and the "read aloud" audiobook mode
 * (Web Speech API) — it is never shown in place of the scans, so every
 * illustration in the original survives.
 */
(function () {
  "use strict";

  var state = {
    book: null,
    pages: [],
    index: 0, // index of the left page of the current spread (or the single page)
    spread: true, // two-page spread vs single page
    busy: false, // a flip animation is running
  };

  var el = {};
  function $(id) { return document.getElementById(id); }

  function init() {
    [
      "book-title", "book", "stage", "nav-prev", "nav-next",
      "page-slider", "page-label", "btn-contents", "btn-thumbs", "btn-listen",
      "contents", "contents-list", "thumbs", "thumbs-grid",
      "search-input", "search-results", "player", "lightbox", "lightbox-img",
      "loading",
    ].forEach(function (id) { el[camel(id)] = $(id); });

    fetch("book.json", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(start)
      .catch(function (err) {
        el.loading.className = "loading error";
        el.loading.innerHTML =
          "Could not load <code>book.json</code>.<br>Run " +
          "<code>tools/build_webbook.py</code> first, then serve this folder " +
          "(e.g. <code>python3 -m http.server</code>).<br><br>" +
          "<small>" + String(err) + "</small>";
      });
  }

  function camel(id) { return id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  function start(book) {
    state.book = book;
    state.pages = book.pages || [];
    if (!state.pages.length) {
      el.loading.className = "loading error";
      el.loading.textContent = "book.json contains no pages.";
      return;
    }
    if (book.title) {
      el.bookTitle.textContent = book.title;
      document.title = book.title;
    }
    el.pageSlider.max = String(state.pages.length - 1);

    buildContents();
    bindEvents();
    computeMode();
    goTo(0, true);
    el.loading.hidden = true;
  }

  /* ---------------- layout mode ---------------- */
  function computeMode() {
    // Two-page spread only when the window is wide enough to show two portrait
    // pages comfortably; otherwise a single page.
    state.spread = window.innerWidth > 820 && window.innerWidth > window.innerHeight * 0.9;
  }

  function leftIndexFor(i) {
    return state.spread ? i - (i % 2) : i;
  }

  /* ---------------- rendering ---------------- */
  function pageLeaf(page, side) {
    var leaf = document.createElement("div");
    leaf.className = "leaf " + side;
    var img = document.createElement("img");
    img.src = page.img;
    img.alt = pageLabel(page);
    img.addEventListener("click", function () { openLightbox(page); });
    leaf.appendChild(img);
    return leaf;
  }

  function render() {
    var book = el.book;
    book.innerHTML = "";
    var i = leftIndexFor(state.index);
    if (state.spread) {
      book.appendChild(pageLeaf(state.pages[i], "left"));
      if (state.pages[i + 1]) book.appendChild(pageLeaf(state.pages[i + 1], "right"));
    } else {
      book.appendChild(pageLeaf(state.pages[state.index], "left"));
    }
    updateStatus();
  }

  function updateStatus() {
    var page = state.pages[state.index];
    var ch = state.book.chapters[page.chapter];
    el.pageLabel.textContent =
      (ch ? ch.title + " · " : "") +
      "p " + (state.index + 1) + " / " + state.pages.length;
    el.pageSlider.value = String(state.index);
    el.navPrev.disabled = state.index <= 0;
    el.navNext.disabled = state.index >= state.pages.length - 1;
    markCurrentThumb();
  }

  function pageLabel(page) {
    var ch = state.book.chapters[page.chapter];
    return (ch ? ch.title + ", " : "") + "page " + page.n;
  }

  /* ---------------- navigation ---------------- */
  function step() { return state.spread ? 2 : 1; }

  function goTo(i, immediate) {
    i = Math.max(0, Math.min(state.pages.length - 1, i));
    state.index = i;
    if (immediate) { render(); return; }
    render();
  }

  function flip(dir) {
    if (state.busy) return;
    var target = leftIndexFor(state.index) + dir * step();
    if (target < 0 || target >= state.pages.length) {
      // allow landing on the last single page in spread mode
      if (target < 0) return;
      if (target >= state.pages.length) return;
    }
    // Build a transient flipper from the outgoing facing page for a turn effect.
    var outgoing = dir > 0
      ? (state.spread ? state.pages[leftIndexFor(state.index) + 1] : state.pages[state.index])
      : state.pages[leftIndexFor(state.index)];
    state.busy = true;
    state.index = Math.max(0, Math.min(state.pages.length - 1, target));
    render();
    animateTurn(dir, outgoing);
  }

  function animateTurn(dir, outgoing) {
    if (!outgoing) { state.busy = false; return; }
    var book = el.book;
    var flipper = document.createElement("div");
    flipper.className = "flipper";
    var img = document.createElement("img");
    img.src = outgoing.img;
    flipper.appendChild(img);
    book.appendChild(flipper);

    // Position the flipper over the half it originates from.
    var bookRect = book.getBoundingClientRect();
    var half = state.spread ? bookRect.width / 2 : bookRect.width;
    if (dir > 0) {
      flipper.style.left = (state.spread ? half : 0) + "px";
      flipper.style.transformOrigin = "left center";
      requestAnimationFrame(function () {
        flipper.style.transform = "rotateY(-180deg)";
      });
    } else {
      flipper.style.left = "0px";
      flipper.style.transformOrigin = "right center";
      requestAnimationFrame(function () {
        flipper.style.transform = "rotateY(180deg)";
      });
    }
    var done = function () {
      if (flipper.parentNode) flipper.parentNode.removeChild(flipper);
      state.busy = false;
    };
    flipper.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 700); // safety net if transitionend doesn't fire
  }

  /* ---------------- contents + thumbnails ---------------- */
  function buildContents() {
    var list = el.contentsList;
    list.innerHTML = "";
    state.book.chapters.forEach(function (ch) {
      var a = document.createElement("a");
      a.href = "#";
      a.innerHTML = escapeHtml(ch.title) +
        ' <span class="pages">' + ch.pageCount + " pp</span>";
      a.addEventListener("click", function (e) {
        e.preventDefault();
        goTo(ch.start, true);
        closeDrawer("contents");
      });
      list.appendChild(a);
    });
  }

  var thumbsBuilt = false;
  function buildThumbs() {
    if (thumbsBuilt) return;
    thumbsBuilt = true;
    var grid = el.thumbsGrid;
    grid.innerHTML = "";
    state.pages.forEach(function (page, i) {
      var fig = document.createElement("figure");
      fig.dataset.index = String(i);
      var img = document.createElement("img");
      img.loading = "lazy";
      img.src = page.thumb;
      img.alt = pageLabel(page);
      var cap = document.createElement("figcaption");
      cap.textContent = "p " + (i + 1);
      fig.appendChild(img);
      fig.appendChild(cap);
      fig.addEventListener("click", function () {
        goTo(i, true);
        closeDrawer("thumbs");
      });
      grid.appendChild(fig);
    });
  }

  function markCurrentThumb() {
    if (!thumbsBuilt) return;
    var cur = el.thumbsGrid.querySelector("figure.current");
    if (cur) cur.classList.remove("current");
    var fig = el.thumbsGrid.querySelector('figure[data-index="' + leftIndexFor(state.index) + '"]');
    if (fig) fig.classList.add("current");
  }

  /* ---------------- lightbox ---------------- */
  function openLightbox(page) {
    el.lightboxImg.src = page.img;
    el.lightbox.hidden = false;
  }

  /* ---------------- search ---------------- */
  function runSearch(q) {
    q = q.trim();
    var box = el.searchResults;
    if (q.length < 2) { box.hidden = true; return; }
    var needle = q.toLowerCase();
    var hits = [];
    for (var i = 0; i < state.pages.length && hits.length < 60; i++) {
      var text = state.pages[i].text || "";
      var pos = text.toLowerCase().indexOf(needle);
      if (pos === -1) continue;
      hits.push({ index: i, snippet: snippetAround(text, pos, q.length) });
    }
    box.innerHTML = "";
    if (!hits.length) {
      box.innerHTML = '<div class="empty">No matches for “' + escapeHtml(q) + '”.</div>';
    } else {
      hits.forEach(function (h) {
        var page = state.pages[h.index];
        var ch = state.book.chapters[page.chapter];
        var div = document.createElement("div");
        div.className = "hit";
        div.innerHTML =
          '<div class="where">' + escapeHtml(ch ? ch.title : "") +
          " · p " + (h.index + 1) + "</div>" + h.snippet;
        div.addEventListener("click", function () {
          goTo(h.index, true);
          box.hidden = true;
        });
        box.appendChild(div);
      });
    }
    box.hidden = false;
  }

  function snippetAround(text, pos, len) {
    var start = Math.max(0, pos - 40);
    var end = Math.min(text.length, pos + len + 60);
    var pre = (start > 0 ? "… " : "") + text.slice(start, pos);
    var hit = text.slice(pos, pos + len);
    var post = text.slice(pos + len, end) + (end < text.length ? " …" : "");
    return escapeHtml(pre) + "<mark>" + escapeHtml(hit) + "</mark>" + escapeHtml(post);
  }

  /* ---------------- audiobook (read aloud) ---------------- */
  var tts = {
    on: false,
    paused: false,
    rate: 1,
    voice: null,
  };

  function ttsSupported() {
    return "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }

  function populateVoices() {
    var sel = $("ab-voice");
    if (!sel) return;
    var voices = window.speechSynthesis.getVoices();
    sel.innerHTML = "";
    voices.forEach(function (v, i) {
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = v.name + (v.lang ? " (" + v.lang + ")" : "");
      sel.appendChild(o);
    });
    // prefer an English voice by default
    var def = voices.findIndex(function (v) { return /^en/i.test(v.lang); });
    if (def >= 0) { sel.value = String(def); tts.voice = voices[def]; }
    else if (voices.length) { tts.voice = voices[0]; }
  }

  function toggleListen() {
    if (!ttsSupported()) {
      alert("This browser does not support speech synthesis. Use tools/build_audiobook.py to export audio files instead.");
      return;
    }
    if (tts.on) { stopListen(); return; }
    tts.on = true;
    el.player.hidden = false;
    el.btnListen.classList.add("active");
    populateVoices();
    speakCurrent();
  }

  function stopListen() {
    tts.on = false;
    tts.paused = false;
    window.speechSynthesis.cancel();
    el.player.hidden = true;
    el.btnListen.classList.remove("active");
  }

  function currentSpeakIndices() {
    var i = leftIndexFor(state.index);
    if (state.spread && state.pages[i + 1]) return [i, i + 1];
    return [i];
  }

  function speakCurrent() {
    if (!tts.on) return;
    window.speechSynthesis.cancel();
    var indices = currentSpeakIndices();
    var text = indices.map(function (k) { return state.pages[k].text || ""; })
      .join("\n\n").trim();
    setAbStatus(indices.length > 1
      ? "p " + (indices[0] + 1) + "–" + (indices[1] + 1)
      : "p " + (indices[0] + 1));
    if (!text) { setTimeout(advanceSpoken, 400); return; }
    var u = new SpeechSynthesisUtterance(text);
    u.rate = tts.rate;
    if (tts.voice) u.voice = tts.voice;
    u.onend = function () { if (tts.on && !tts.paused) advanceSpoken(); };
    window.speechSynthesis.speak(u);
  }

  function advanceSpoken() {
    var next = leftIndexFor(state.index) + step();
    if (next >= state.pages.length) { setAbStatus("Finished"); tts.on = false; el.btnListen.classList.remove("active"); return; }
    flip(1);
    // wait for the flip to settle before reading the new spread
    setTimeout(speakCurrent, 560);
  }

  function setAbStatus(txt) {
    var s = $("ab-status");
    if (s) s.textContent = txt;
  }

  /* ---------------- drawers ---------------- */
  function openDrawer(id) {
    if (id === "thumbs") buildThumbs();
    $(id).hidden = false;
    if (id === "thumbs") markCurrentThumb();
  }
  function closeDrawer(id) { $(id).hidden = true; }

  /* ---------------- events ---------------- */
  function bindEvents() {
    el.navPrev.addEventListener("click", function () { flip(-1); });
    el.navNext.addEventListener("click", function () { flip(1); });

    el.btnContents.addEventListener("click", function () { toggleDrawer("contents"); });
    el.btnThumbs.addEventListener("click", function () { toggleDrawer("thumbs"); });
    el.btnListen.addEventListener("click", toggleListen);

    el.pageSlider.addEventListener("input", function () {
      goTo(parseInt(el.pageSlider.value, 10), true);
    });

    el.searchInput.addEventListener("input", function () { runSearch(el.searchInput.value); });
    el.searchInput.addEventListener("focus", function () {
      if (el.searchInput.value.trim().length >= 2) runSearch(el.searchInput.value);
    });

    document.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-close");
        if (id === "player") { stopListen(); return; }
        $(id).hidden = true;
      });
    });

    el.lightbox.addEventListener("click", function (e) {
      if (e.target === el.lightbox || e.target === el.lightboxImg) el.lightbox.hidden = true;
    });

    // audiobook controls
    on("ab-toggle", "click", function () {
      if (!tts.on) return;
      if (tts.paused) { tts.paused = false; window.speechSynthesis.resume(); }
      else { tts.paused = true; window.speechSynthesis.pause(); }
      this.innerHTML = tts.paused ? "&#9658;" : "&#10073;&#10073;";
    });
    on("ab-prev", "click", function () { flip(-1); setTimeout(speakCurrent, 560); });
    on("ab-next", "click", function () { advanceSpoken(); });
    on("ab-rate", "input", function () { tts.rate = parseFloat(this.value); speakCurrent(); });
    on("ab-voice", "change", function () {
      tts.voice = window.speechSynthesis.getVoices()[parseInt(this.value, 10)] || null;
      speakCurrent();
    });
    if (ttsSupported() && typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
      window.speechSynthesis.onvoiceschanged = populateVoices;
    }

    document.addEventListener("keydown", function (e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { flip(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { flip(-1); }
      else if (e.key === "Home") { goTo(0, true); }
      else if (e.key === "End") { goTo(state.pages.length - 1, true); }
      else if (e.key === "Escape") {
        el.lightbox.hidden = true;
        closeDrawer("contents"); closeDrawer("thumbs");
        el.searchResults.hidden = true;
      }
    });

    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var was = state.spread;
        computeMode();
        if (was !== state.spread) render(); else updateStatus();
      }, 150);
    });

    window.addEventListener("beforeunload", function () {
      if (ttsSupported()) window.speechSynthesis.cancel();
    });
  }

  function on(id, ev, fn) {
    var node = $(id);
    if (node) node.addEventListener(ev, fn);
  }

  function toggleDrawer(id) {
    var node = $(id);
    if (node.hidden) {
      closeDrawer("contents"); closeDrawer("thumbs");
      openDrawer(id);
    } else {
      closeDrawer(id);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
