(async function () {
  "use strict";

  const IIIF = "https://iiif.micr.io/";
  const RATIO = 0.64;  // sheet width / height, after cropping the photographic margins
  const DEPTH = 4;     // sheets kept under the top one (their edges peek out)
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const scene = $("scene"), pileEl = $("pile"), scrub = $("scrub");

  // Cover, inside cover (ex libris), then sheets 1–196: one loose sheet each.
  const records = await (await fetch("pages.json")).json();
  const LAST = records.length - 1;
  scrub.max = LAST;

  // ---------- layout ----------
  let pw = 0, ph = 0, travel = 0;
  function layout() {
    const sr = scene.getBoundingClientRect();
    // generous margins so the pile rests on the surface rather than filling the screen
    const availH = sr.height - 2 * Math.max(28, sr.height * 0.08);
    const availW = sr.width - 2 * Math.max(40, sr.width * 0.09);
    ph = Math.floor(Math.min(availH, availW / RATIO));
    pw = Math.floor(ph * RATIO);
    travel = sr.width / 2 + pw * 0.75; // far enough to leave the screen
    root.style.setProperty("--pw", pw + "px");
    root.style.setProperty("--ph", ph + "px");
    hiHeight = Math.min(3000, Math.max(800, Math.ceil((ph * devicePixelRatio * 1.06) / 200) * 200));
  }

  // ---------- images: thumbnail first, IIIF large image when loaded ----------
  let hiHeight = 1600;
  const hiLoaded = new Map(); // micr id -> url
  const hiUrl = (r) => `${IIIF}${r.id}/full/,${hiHeight}/0/default.jpg`;
  function srcFor(r) { return hiLoaded.get(r.id) || `thumbs/${r.f}`; }
  function loadHi(r) {
    if (!r || hiLoaded.has(r.id)) return;
    const url = hiUrl(r);
    hiLoaded.set(r.id, null);
    const im = new Image();
    im.decoding = "async";
    im.onload = () => {
      hiLoaded.set(r.id, url);
      document.querySelectorAll(`img[data-id="${r.id}"]`).forEach((el) => (el.src = url));
    };
    im.onerror = () => hiLoaded.delete(r.id);
    im.src = url;
  }
  function preload(i) {
    for (let d = -1; d <= 3; d++) loadHi(records[i + d]);
  }

  // ---------- sheets ----------
  // Each sheet keeps its own slightly crooked pose, so the pile looks hand-stacked
  // and a revealed sheet is already where it will stay.
  function rand(i, k) {
    const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
  const poses = records.map((r, i) => ({
    r: (rand(i, 1) - 0.5) * 1.4,      // degrees
    x: (rand(i, 2) - 0.5) * 0.016,    // fraction of the sheet width
    y: (rand(i, 3) - 0.5) * 0.016,    // fraction of the sheet height
  }));

  const div = (cls) => {
    const d = document.createElement("div");
    d.className = cls;
    return d;
  };
  const els = new Map(); // index -> sheet

  function makeSheet(i, withImage, enter = true) {
    const el = div(enter ? "sheet enter" : "sheet");
    if (records[i].n === "0") el.classList.add("cover");
    el.style.zIndex = 1000 - i;
    const paper = div("paper");
    paper.append(div("light"));
    el.append(div("sheet-shadow"), div("sheet-lift"), paper);
    const s = { i, el, paper, img: null };
    if (withImage) addImage(s);
    el.addEventListener("animationend", () => el.classList.remove("enter"), { once: true });
    pileEl.append(el);
    return s;
  }
  function addImage(s) {
    if (s.img) return;
    const r = records[s.i];
    const img = document.createElement("img");
    img.className = "pimg";
    img.alt = r.t;
    img.draggable = false;
    img.dataset.id = r.id;
    img.src = srcFor(r);
    s.paper.prepend(img);
    s.img = img;
  }
  function dropSheet(s) {
    els.delete(s.i);
    s.el.classList.add("leave"); // fade out, never vanish abruptly
    setTimeout(() => s.el.remove(), 500);
  }

  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // p: 0 = resting on the pile, 1 = slid off the screen to the left
  function place(s, p = 0, tilt = 0) {
    const ps = poses[s.i];
    const lift = smooth(0, 0.22, p);           // picked up first, then slid away
    const x = ps.x * pw - p * travel;
    const y = ps.y * ph - 6 * lift + p * 0.015 * ph;
    const rot = ps.r - 7 * p;
    const sc = 1 + 0.025 * lift;
    s.el.style.transform =
      `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) perspective(2000px) rotateY(${tilt.toFixed(2)}deg) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`;
    s.el.style.setProperty("--lift", lift.toFixed(3));
  }

  // Keep elements for the top sheet and the few beneath it (plus one coming back).
  function syncPile(extra = null) {
    const want = new Set();
    for (let i = cur; i <= Math.min(LAST, cur + DEPTH); i++) want.add(i);
    if (extra !== null) want.add(extra);
    for (const s of [...els.values()]) if (!want.has(s.i)) dropSheet(s);
    for (const i of want) {
      const withImage = i <= cur + 2 || i < cur;
      let s = els.get(i);
      if (!s) {
        s = makeSheet(i, withImage, i !== extra); // a sheet coming back slides in, it doesn't fade
        els.set(i, s);
      } else if (withImage) addImage(s);
      if (!move || move.s !== s) place(s, i === extra ? 1 : 0);
    }
  }

  // The rest of the pile: a few paper edges, thinner as fewer sheets remain.
  const depthEl = div("pile-depth");
  depthEl.style.zIndex = 1;
  pileEl.append(depthEl);
  function updateDepth() {
    const remaining = LAST - cur;
    const t = remaining ? Math.max(1, Math.round((6 * remaining) / LAST)) : 0;
    const layers = [];
    for (let k = 1; k <= t; k++) layers.push(`${(k * 0.6).toFixed(1)}px ${k}px 0 ${k % 2 ? "#e9dfc9" : "#d2c5a8"}`);
    layers.push(
      `${(t * 0.6 + 1).toFixed(1)}px ${t + 2}px ${4 + t}px rgb(var(--shadow-rgb) / .28)`,
      `8px 16px 30px rgb(var(--shadow-rgb) / .16)`,
      `16px 34px 70px rgb(var(--shadow-rgb) / .12)`,
    );
    depthEl.style.boxShadow = layers.join(", ");
    depthEl.style.opacity = remaining ? 1 : 0;
  }

  // ---------- caption, hash, state ----------
  let cur = 0;
  const label = (r) => (r.n === "0" ? "Cover" : r.n === "A" ? "Inside cover" : r.n);
  function caption(r) {
    const el = $("caption");
    el.replaceChildren();
    const a = document.createElement("a");
    a.href = r.u;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = "Rijksmuseum record";
    const b = document.createElement("b");
    b.textContent = label(r);
    a.append(b, r.n === "0" ? "" : r.t);
    el.append(a);
  }
  function hashFor(i) {
    const r = records[i];
    return r.n === "0" ? "" : r.n === "A" ? "#ex-libris" : "#" + r.n;
  }
  function indexFromHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return 0;
    if (h === "ex-libris") return records.findIndex((r) => r.n === "A");
    const i = records.findIndex((r) => r.n === String(parseInt(h, 10)));
    return i < 0 ? 0 : i;
  }

  function setCur(i, { updateHash = true } = {}) {
    cur = Math.max(0, Math.min(LAST, i));
    syncPile();
    updateDepth();
    caption(records[cur]);
    scrub.value = cur;
    $("prev").disabled = cur === 0;
    $("next").disabled = cur === LAST;
    if (updateHash) {
      const h = hashFor(cur);
      if (h !== location.hash) history.replaceState(null, "", h || location.pathname + location.search);
    }
    preload(cur);
  }

  // ---------- motion ----------
  // One sheet moves at a time. Forward: the top sheet slides off (p 0 → 1).
  // Back: the previous sheet slides in from the left (p 1 → 0).
  let move = null;
  let pending = 0;

  function startMove(dir) {
    if (move) return false;
    if (dir > 0 && cur >= LAST) return false;
    if (dir < 0 && cur <= 0) return false;
    const i = dir > 0 ? cur : cur - 1;
    if (dir < 0) syncPile(i);
    const s = els.get(i);
    const from = dir > 0 ? 0 : 1;
    const to = 1 - from;
    // mode: "drag" (follows the pointer), "auto" (timed glide to target)
    move = { dir, s, from, to, p: from, target: from, mode: "auto", tilt: 0, vel: 0, last: performance.now() };
    s.el.classList.add("moving");
    place(s, from);
    requestAnimationFrame(tick);
    return true;
  }

  function tick(now) {
    const m = move;
    if (!m || m.mode === "done") return;
    const dt = Math.min(50, now - m.last);
    m.last = now;
    const prev = m.p;
    const diff = m.target - m.p;
    if (reduceMotion && m.mode !== "drag") {
      m.p = m.target;
    } else if (m.mode === "drag") {
      m.goal = undefined;
      m.p += diff * (1 - Math.pow(0.78, dt / 16.7));
    } else {
      // a timed, eased glide: gentle start, unhurried travel, soft landing
      if (m.goal !== m.target) {
        const fromRest = Math.abs(m.vel) < 0.0002;
        m.goal = m.target; m.p0 = m.p; m.t0 = now;
        m.dur = (300 + 600 * Math.abs(diff)) * (pending ? 0.6 : 1);
        m.ease = fromRest ? (x) => 0.5 - 0.5 * Math.cos(Math.PI * x)
                          : (x) => Math.sin((Math.PI / 2) * x);
      }
      const k = Math.min(1, (now - m.t0) / m.dur);
      m.p = m.p0 + (m.goal - m.p0) * m.ease(k);
    }
    m.vel = dt > 0 ? (m.p - prev) / dt : 0;
    // the sheet tips a little as it moves through the air, and settles when it stops
    const xVel = -m.vel * travel; // px per ms
    const want = Math.max(-8, Math.min(8, xVel * 4));
    m.tilt += (want - m.tilt) * (1 - Math.pow(0.85, dt / 16.7));
    place(m.s, m.p, m.tilt);
    if (m.mode === "auto" && Math.abs(m.target - m.p) < 1e-4 && (m.target === m.to || m.target === m.from)) {
      finish(m.target === m.to);
      return;
    }
    requestAnimationFrame(tick);
  }

  function finish(done) {
    const m = move;
    m.mode = "done";
    m.s.el.classList.remove("moving");
    move = null;
    setCur(done ? cur + m.dir : cur);
    if (pending !== 0) {
      const d = Math.sign(pending);
      pending -= d;
      if (startMove(d)) move.target = move.to;
      else pending = 0;
    }
  }

  function go(dir) {
    if (move) {
      if (move.mode !== "drag") pending += dir;
      return;
    }
    if (startMove(dir)) move.target = move.to;
  }

  function jump(i) {
    if (move) { move.s.el.classList.remove("moving"); move.mode = "done"; move = null; }
    pending = 0;
    setCur(i);
  }

  // ---------- pointer: drag, swipe, tap ----------
  let drag = null;
  scene.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (move && move.mode === "drag")) return;
    const now = performance.now();
    drag = { x0: e.clientX, x: e.clientX, t0: now, xPrev: e.clientX, tPrev: now, v: 0, dir: 0 };
    scene.setPointerCapture(e.pointerId);
  });

  scene.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const now = performance.now();
    drag.v = (e.clientX - drag.xPrev) / Math.max(1, now - drag.tPrev);
    drag.xPrev = e.clientX;
    drag.tPrev = now;
    drag.x = e.clientX;
    const dx = e.clientX - drag.x0;
    if (!drag.dir) {
      if (Math.abs(dx) < 6) return;
      const dir = dx < 0 ? 1 : -1;
      if (!startMove(dir)) { drag.dir = "none"; return; }
      move.mode = "drag";
      drag.dir = dir;
      pileEl.classList.add("dragging");
    }
    if (drag.dir === 1 || drag.dir === -1) {
      const span = pw * 1.1;
      const q = drag.dir > 0 ? -dx / span : 1 - dx / span;
      move.target = Math.max(0, Math.min(1, q));
    }
  });

  function endDrag(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    pileEl.classList.remove("dragging");
    if (!d.dir) {
      // a tap: right half goes forward, left half goes back
      if (e.type === "pointerup" && performance.now() - d.t0 < 500) {
        const r = scene.getBoundingClientRect();
        go(e.clientX >= r.left + r.width / 2 ? 1 : -1);
      }
      return;
    }
    if (d.dir === "none" || !move || move.mode !== "drag") return;
    const progress = move.dir > 0 ? move.target : 1 - move.target;
    const v = performance.now() - d.tPrev > 100 ? 0 : d.v; // a pause before letting go is not a flick
    const flick = move.dir > 0 ? v < -0.35 : v > 0.35;
    move.mode = "auto";
    move.target = progress > 0.3 || flick ? move.to : move.from;
  }
  scene.addEventListener("pointerup", endDrag);
  scene.addEventListener("pointercancel", endDrag);

  // ---------- keyboard, buttons, slider, hash ----------
  document.addEventListener("keydown", (e) => {
    if ($("about").open || e.target === scrub) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
    else if (e.key === "Home") jump(0);
    else if (e.key === "End") jump(LAST);
    else if (e.key === "f" || e.key === "F") toggleFull();
  });
  $("prev").onclick = () => go(-1);
  $("next").onclick = () => go(1);
  scrub.addEventListener("input", () => jump(+scrub.value));
  window.addEventListener("hashchange", () => jump(indexFromHash()));
  $("about-open").onclick = () => $("about").showModal();
  // the page's own full screen hides every browser bar, in any browser
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen?.();
  }
  $("fs").onclick = toggleFull;
  document.addEventListener("fullscreenchange", () => {
    $("fs").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { layout(); jump(cur); }, 100);
  });

  layout();
  setCur(indexFromHash(), { updateHash: false });
})();
