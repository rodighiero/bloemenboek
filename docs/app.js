(async function () {
  "use strict";

  const IIIF = "https://iiif.micr.io/";
  const RATIO = 0.64;   // page width / height, after cropping the photographic margins
  const SLICES = 4;     // a turning leaf is split in slices so it can bend
  const SHADE = 0.34;   // darkness of a page standing upright
  const BEND = 22;      // max extra rotation (deg) of the leaf's outer edge
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const scene = $("scene"), book = $("book"), leftEl = $("left"), rightEl = $("right");
  const scrub = $("scrub");

  const records = await (await fetch("pages.json")).json();

  // ---------- the book as a list of leaves ----------
  // Leaf 0: cover / inside cover (ex libris). Leaf k: sheet 2k-1 / sheet 2k.
  // Last leaf: blank endpaper facing sheet 196.
  const cover = records.find((r) => r.n === "0");
  const exlibris = records.find((r) => r.n === "A");
  const sheets = records.filter((r) => /^\d+$/.test(r.n) && r.n !== "0");
  const side = (r, extra = {}) => ({ r, ...extra });
  const BLANK = { blank: true };
  const leaves = [{ front: side(cover, { cover: true }), back: side(exlibris) }];
  for (let i = 0; i < sheets.length; i += 2) {
    leaves.push({ front: side(sheets[i]), back: sheets[i + 1] ? side(sheets[i + 1]) : BLANK });
  }
  if (leaves[leaves.length - 1].back !== BLANK) leaves.push({ front: BLANK, back: null });
  const MAX = leaves.length - 1; // spread index of the last opening
  scrub.max = MAX;

  const leftOf = (s) => (s > 0 ? leaves[s - 1].back : null);
  const rightOf = (s) => leaves[s]?.front ?? null;

  // ---------- layout ----------
  let pw = 0, ph = 0;
  function layout() {
    const sr = scene.getBoundingClientRect();
    // generous margins so the book rests on the surface rather than filling the screen
    const availH = sr.height - 2 * Math.max(28, sr.height * 0.08);
    const availW = sr.width - 2 * Math.max(40, sr.width * 0.09);
    ph = Math.floor(Math.min(availH, availW / 2 / RATIO));
    pw = Math.floor(ph * RATIO);
    root.style.setProperty("--pw", pw + "px");
    root.style.setProperty("--ph", ph + "px");
    hiHeight = Math.min(3000, Math.max(800, Math.ceil((ph * devicePixelRatio * 1.06) / 200) * 200));
    applyShift(spread === 0 ? 0 : 1);
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
  function preload(s) {
    for (let d = -2; d <= 3; d++) {
      const t = s + d;
      if (t < 0 || t > MAX) continue;
      loadHi(leftOf(t)?.r);
      loadHi(rightOf(t)?.r);
    }
  }

  // ---------- drawing a page side ----------
  // gutter: "r" = spine on the left edge (right-hand page), "l" = spine on the right edge.
  // side: "l" or "r", which page of the opening this is (for the curvature light)
  function fill(el, sd, { gutter, off = 0, n = 1, side = gutter } = {}) {
    el.replaceChildren();
    el.classList.remove("blank", "cover", "gutter-l", "gutter-r");
    if (!sd) return;
    if (sd.blank || !sd.r) {
      el.classList.add("blank");
    } else {
      const img = document.createElement("img");
      img.className = "pimg";
      img.alt = sd.r.t;
      img.draggable = false;
      img.dataset.id = sd.r.id;
      img.style.setProperty("--off", off);
      img.style.setProperty("--n", n);
      img.src = srcFor(sd.r);
      el.append(img);
      if (sd.cover) el.classList.add("cover");
    }
    if (side && !sd.cover) {
      // the page is not flat: it rises from the spine and falls toward the fore-edge
      const c = document.createElement("div");
      c.className = "curve curve-" + side;
      c.style.setProperty("--off", off);
      c.style.setProperty("--n", n);
      el.append(c);
    }
    if (gutter) el.classList.add("gutter-" + gutter);
  }
  function addOverlay(el, cls) {
    const o = document.createElement("div");
    o.className = cls;
    el.append(o);
    return o;
  }

  // ---------- static spread ----------
  let spread = 0;
  let castL = null, castR = null;
  const keyOf = (sd) => (!sd ? "none" : sd.blank || !sd.r ? "blank" : sd.r.id);

  // Builds the page off-screen, waits until its image is decoded, then swaps it in,
  // so a page never flashes empty. Unchanged pages are left untouched.
  function setStatic(el, sd, gutter) {
    const key = keyOf(sd);
    if (el.dataset.key === key) return Promise.resolve();
    el.dataset.key = key;
    const tmp = document.createElement("div");
    fill(tmp, sd, { gutter });
    if (sd) addOverlay(tmp, gutter === "l" ? "cast on-left" : "cast on-right");
    const img = tmp.querySelector("img");
    const ready = img ? Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 400))]) : Promise.resolve();
    return ready.then(() => {
      if (el.dataset.key !== key) return; // superseded meanwhile
      el.className = el.className.split(" ").filter((c) => c === "page" || c === "left" || c === "right").concat([...tmp.classList]).join(" ");
      el.replaceChildren(...tmp.childNodes);
    });
  }
  function drawStatic(l, r) {
    return Promise.all([setStatic(leftEl, l, "l"), setStatic(rightEl, r, "r")]);
  }
  const cast = (el) => el.querySelector(".cast");

  let shift = 0;
  function applyShift(openness) {
    // A closed book sits centred on its cover; it slides over as it opens.
    shift = -(pw / 2) * (1 - openness);
    root.style.setProperty("--shift", shift + "px");
  }

  function applyStacks(progress) {
    const max = Math.max(2, Math.round(pw * 0.012));
    const f = progress / MAX;
    root.style.setProperty("--stack-l", Math.max(1, Math.round(f * max)) + "px");
    root.style.setProperty("--stack-r", Math.max(1, Math.round((1 - f) * max)) + "px");
  }

  function label(r) {
    if (!r) return "";
    return r.n === "0" ? "Cover" : r.n === "A" ? "Inside cover" : r.n;
  }
  function caption(el, sd) {
    el.replaceChildren();
    if (!sd || !sd.r) return;
    const a = document.createElement("a");
    a.href = sd.r.u;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = "Rijksmuseum record";
    const b = document.createElement("b");
    b.textContent = label(sd.r);
    a.append(b, sd.r.n === "0" ? "" : sd.r.t);
    el.append(a);
  }

  function hashFor(s) {
    if (s === 0) return "";
    const r = leftOf(s)?.r || rightOf(s)?.r;
    return r && /^\d+$/.test(r.n) && r.n !== "0" ? "#" + r.n : "#inside-cover";
  }
  function spreadFromHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return 0;
    if (h === "inside-cover") return 1;
    const n = parseInt(h, 10);
    if (!n) return 0;
    return Math.min(MAX, Math.floor(n / 2) + 1);
  }

  function render(s, { updateHash = true } = {}) {
    spread = s;
    const ready = drawStatic(leftOf(s), rightOf(s));
    book.classList.toggle("closed", s === 0);
    book.classList.remove("opening");
    applyShift(s === 0 ? 0 : 1);
    applyStacks(s);
    caption($("cap-left"), leftOf(s));
    caption($("cap-right"), rightOf(s));
    scrub.value = s;
    $("prev").disabled = s === 0;
    $("next").disabled = s === MAX;
    if (updateHash) {
      const h = hashFor(s);
      if (h !== location.hash) history.replaceState(null, "", h || location.pathname + location.search);
    }
    preload(s);
    return ready;
  }

  // ---------- the turning leaf ----------
  // A turn rotates leaves[k] around the spine: angle 0 = lying on the right, -180 = on the left.
  let turn = null;
  let pending = 0;

  function buildLeaf(k) {
    const lf = leaves[k];
    const leaf = document.createElement("div");
    leaf.className = "leaf";
    leaf.style.setProperty("--n", SLICES);
    const shades = [];
    let parent = leaf;
    const segs = [leaf];
    for (let i = 0; i < SLICES; i++) {
      const seg = i === 0 ? leaf : document.createElement("div");
      if (i > 0) { seg.className = "slice"; parent.append(seg); segs.push(seg); }
      const front = document.createElement("div");
      front.className = "face front";
      fill(front, lf.front, { gutter: i === 0 ? "r" : null, off: i, n: SLICES, side: "r" });
      if (i === 0) front.classList.add("inner");
      if (i === SLICES - 1) front.classList.add("outer");
      const back = document.createElement("div");
      back.className = i === SLICES - 1 ? "face back outer" : "face back";
      fill(back, lf.back, { gutter: i === 0 ? "l" : null, off: SLICES - 1 - i, n: SLICES, side: "l" });
      shades.push({ front: addOverlay(front, "shade"), back: addOverlay(back, "shade"), i });
      seg.prepend(front, back);
      parent = seg;
    }
    book.append(leaf);
    return { el: leaf, segs, shades };
  }

  function startTurn(dir) {
    if (turn) return false;
    if (dir > 0 && spread >= MAX) return false;
    if (dir < 0 && spread <= 0) return false;
    const k = dir > 0 ? spread : spread - 1;
    const from = dir > 0 ? 0 : -180;
    const to = dir > 0 ? -180 : 0;
    // Underneath: the page that will be revealed on the side the leaf leaves.
    if (dir > 0) drawStatic(leftOf(spread), rightOf(spread + 1));
    else drawStatic(leftOf(spread - 1), rightOf(spread));
    book.classList.remove("closed");
    // mode: "peek" (corner lifted on hover), "drag" (follows the pointer), "auto" (animating to target)
    turn = { dir, k, from, to, angle: from, target: from, mode: "auto", leaf: buildLeaf(k), last: performance.now() };
    loadHi(leaves[k].front?.r);
    loadHi(leaves[k].back?.r);
    paint();
    requestAnimationFrame(tick);
    return true;
  }

  function paint() {
    const t = turn;
    const a = Math.abs(t.angle);                 // 0..180
    const lift = Math.sin((a * Math.PI) / 180);  // 0 flat, 1 upright
    // the free edge trails the motion, so the paper seems to float on the air
    const want = (t.vel ? Math.sign(t.vel) : (t.dir > 0 ? -1 : 1)) * BEND * lift * (0.55 + 0.45 * Math.min(1, Math.abs(t.vel || 0) / 0.2));
    t.bend = t.bend === undefined ? want : t.bend + (want - t.bend) * 0.12;
    const bend = t.bend;
    t.leaf.el.style.transform = `perspective(2600px) rotateY(${t.angle}deg)`;
    for (let i = 1; i < t.leaf.segs.length; i++) {
      t.leaf.segs[i].style.transform = `rotateY(${bend / (SLICES - 1)}deg)`;
    }
    // Light each slice by its own angle (the bent outer part can already be past vertical
    // while the inner part is not). Front and back meet at the same value at 90°, so
    // there is no jump when the page goes upright.
    const rad = Math.PI / 180;
    for (const s of t.leaf.shades) {
      const ai = Math.max(0, Math.min(180, Math.abs(t.angle + (bend * s.i) / (SLICES - 1))));
      s.front.style.opacity = SHADE * (1 - Math.cos(Math.min(ai, 90) * rad));
      s.back.style.opacity = SHADE * (1 - Math.cos(Math.min(180 - ai, 90) * rad));
    }
    // The shadow cast on the page below is strongest while the leaf is low and fades
    // to nothing as it stands upright, on both sides, so it never switches over abruptly.
    castR = cast(rightEl);
    castL = cast(leftEl);
    const castK = 0.85 * Math.abs(Math.sin(2 * a * rad));
    if (castR) castR.style.opacity = a < 90 ? castK : 0;
    if (castL) castL.style.opacity = a > 90 ? castK : 0;
    // Opening or closing the cover slides the whole book.
    if (t.k === 0) {
      applyShift(a / 180);
      book.classList.toggle("closed", a < 1);
      book.classList.toggle("opening", a < 179); // the front board is still in the air
    }
    applyStacks(t.k + a / 180);
  }

  function tick(now) {
    const t = turn;
    if (!t) return;
    const dt = Math.min(50, now - t.last);
    t.last = now;
    const prev = t.angle;
    const diff = t.target - t.angle;
    if (reduceMotion && t.mode !== "drag") {
      t.angle = t.target;
    } else if (t.mode === "drag") {
      t.angle += diff * (1 - Math.pow(0.78, dt / 16.7));
    } else if (t.mode === "auto") {
      // a timed, eased glide: slow lift, unhurried travel, soft landing
      if (t.goal !== t.target) {
        const fromRest = Math.abs(t.vel || 0) < 0.02;
        t.goal = t.target; t.a0 = t.angle; t.t0 = now;
        t.dur = 300 + 600 * Math.abs(diff) / 180;
        t.ease = fromRest ? (x) => 0.5 - 0.5 * Math.cos(Math.PI * x)   // ease in-out
                          : (x) => Math.sin((Math.PI / 2) * x);         // already moving: ease out
      }
      const p = Math.min(1, (now - t.t0) / t.dur);
      t.angle = t.a0 + (t.goal - t.a0) * t.ease(p);
    } else {
      t.goal = undefined;
      t.angle += diff * (1 - Math.pow(0.93, dt / 16.7));
    }
    t.vel = dt > 0 ? (t.angle - prev) / dt : 0;
    paint();
    if (t.mode === "auto" && Math.abs(t.target - t.angle) < 0.01 && (t.target === t.to || t.target === t.from)) {
      finish(t.target === t.to);
      return;
    }
    requestAnimationFrame(tick);
  }

  function finish(done) {
    const t = turn;
    t.mode = "done";
    render(done ? spread + t.dir : spread).then(() => {
      if (turn !== t) return;
      t.leaf.el.remove();
      turn = null;
      next();
    });
  }
  function next() {
    if (pending !== 0) {
      const d = Math.sign(pending);
      pending -= d;
      if (startTurn(d)) turn.target = turn.to;
      else pending = 0;
    }
  }

  function go(dir) {
    if (turn) {
      if (turn.mode === "drag") return;
      if (turn.mode === "peek" && turn.dir === dir) { turn.mode = "auto"; turn.target = turn.to; return; }
      if (turn.mode === "peek") { turn.mode = "auto"; turn.target = turn.from; }
      pending += dir;
      return;
    }
    if (startTurn(dir)) turn.target = turn.to;
  }

  function jump(s) {
    if (turn) { turn.leaf.el.remove(); turn = null; }
    pending = 0;
    castL?.style.setProperty("opacity", 0);
    castR?.style.setProperty("opacity", 0);
    render(Math.max(0, Math.min(MAX, s)));
  }

  // ---------- pointer: drag, swipe, tap, corner peek ----------
  let drag = null;
  // Page geometry on screen, from the scene (the book's own box changes while a leaf is lifted).
  function geom() {
    const r = scene.getBoundingClientRect();
    const spine = r.left + r.width / 2 + shift;
    const top = r.top + r.height / 2 - ph / 2;
    return { spine, top, bottom: top + ph, left: spine - pw, right: spine + pw };
  }

  scene.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const dir = e.clientX >= geom().spine ? 1 : -1;
    if (turn && !(turn.mode === "peek" && turn.dir === dir)) return;
    if (!turn && !startTurn(dir)) return;
    turn.mode = "drag";
    drag = { x0: e.clientX, t0: performance.now(), x: e.clientX, tPrev: performance.now(), xPrev: e.clientX, v: 0 };
    book.classList.add("dragging");
    scene.setPointerCapture(e.pointerId);
  });

  scene.addEventListener("pointermove", (e) => {
    if (drag && turn) {
      const now = performance.now();
      drag.v = (e.clientX - drag.xPrev) / Math.max(1, now - drag.tPrev);
      drag.xPrev = e.clientX;
      drag.tPrev = now;
      drag.x = e.clientX;
      const span = pw * 1.4;
      const p = Math.max(0, Math.min(1, (turn.dir > 0 ? drag.x0 - e.clientX : e.clientX - drag.x0) / span));
      turn.target = turn.from + (turn.to - turn.from) * p;
      return;
    }
    if (e.pointerType !== "mouse") return;
    peek(e);
  });

  function endDrag(e) {
    if (!drag || !turn) return;
    const moved = Math.abs(drag.x - drag.x0);
    const dt = performance.now() - drag.t0;
    const p = (turn.target - turn.from) / (turn.to - turn.from);
    const flick = turn.dir * -drag.v > 0.35;
    const tap = moved < 6 && dt < 500;
    turn.mode = "auto";
    turn.target = tap || flick || p > 0.3 ? turn.to : turn.from;
    drag = null;
    book.classList.remove("dragging");
  }
  scene.addEventListener("pointerup", endDrag);
  scene.addEventListener("pointercancel", endDrag);

  // Lift the page corner a little when the mouse comes near an outer edge.
  function peek(e) {
    const g = geom();
    const zone = (w, d) => {
      const inY = e.clientY > g.top - 20 && e.clientY < g.bottom + 20;
      if (d > 0) return inY && e.clientX > g.right - pw * w && e.clientX < g.right + 40 && spread < MAX;
      return inY && e.clientX < g.left + pw * w && e.clientX > g.left - 40 && spread > 0;
    };
    if (turn) {
      if (turn.mode === "peek" && !zone(0.3, turn.dir)) { turn.mode = "auto"; turn.target = turn.from; }
      return;
    }
    const dir = zone(0.18, 1) ? 1 : zone(0.18, -1) ? -1 : 0;
    if (dir && !reduceMotion && startTurn(dir)) {
      turn.mode = "peek";
      turn.target = turn.from + (dir > 0 ? -16 : 16);
    }
  }
  scene.addEventListener("pointerleave", () => {
    if (turn && turn.mode === "peek") { turn.mode = "auto"; turn.target = turn.from; }
  });

  // ---------- keyboard, buttons, slider, hash ----------
  document.addEventListener("keydown", (e) => {
    if ($("about").open || e.target === scrub) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
    else if (e.key === "Home") jump(0);
    else if (e.key === "End") jump(MAX);
    else if (e.key === "f" || e.key === "F") toggleFull();
  });
  $("prev").onclick = () => go(-1);
  $("next").onclick = () => go(1);
  scrub.addEventListener("input", () => jump(+scrub.value));
  window.addEventListener("hashchange", () => jump(spreadFromHash()));
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
    resizeTimer = setTimeout(() => { layout(); jump(spread); }, 100);
  });

  layout();
  render(spreadFromHash(), { updateHash: false });
})();
