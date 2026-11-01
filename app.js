(() => {
  "use strict";

  const D = window.MAP_DATA;
  const NS = "http://www.w3.org/2000/svg";
  const FF = '"Inter","Segoe UI",system-ui,sans-serif';
  const STORE_KEY = "systems-map-positions-v1";
  const $ = (s) => document.querySelector(s);

  const svg = $("#svg");
  const viewport = $("#viewport");
  const nodeLayer = $("#nodeLayer");
  const edgeLayer = $("#edgeLayer");
  const defs = $("#defs");
  const stage = $("#stage");
  const tip = $("#tip");

  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  /* ------------------------------------------------------------------ *
   * Data model
   * ------------------------------------------------------------------ */
  const nodes = D.nodes.map((n) => ({ ...n }));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const WEIGHT_KEY = "systems-map-weights-v1";
  // Default strength of an unweighted link, as a fraction. 0.5 => a change in the
  // source passes on half its size to the target each tick.
  const DEFAULT_W = 0.7;

  const edges = D.edges.map((e, i) => ({
    ...e,
    i,
    sign: e.sign || 1,
    marked: !!e.marked,
    // weight is a signed fraction in [-1, 1]; its sign is the link polarity.
    weight: (e.sign || 1) * (e.weight == null ? DEFAULT_W : e.weight),
  }));
  const defaultPos = Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const defaultWeight = Object.fromEntries(edges.map((e) => [e.i, e.weight]));

  // A stable key for a link that survives edits to data.js ordering.
  const edgeKey = (e) => `${e.from}->${e.to}`;

  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    for (const id in saved) if (byId[id]) { byId[id].x = saved[id].x; byId[id].y = saved[id].y; }
  } catch (_) { /* ignore corrupt storage */ }

  try {
    const savedW = JSON.parse(localStorage.getItem(WEIGHT_KEY) || "{}");
    edges.forEach((e) => { const k = edgeKey(e); if (savedW[k] != null) e.weight = savedW[k]; });
  } catch (_) { /* ignore corrupt storage */ }

  // Live sign/marked follow the (possibly edited) weight so loop maths stays correct.
  const syncEdge = (e) => { e.sign = e.weight < 0 ? -1 : 1; };
  edges.forEach(syncEdge);

  const savePositions = () => {
    const out = {};
    nodes.forEach((n) => { out[n.id] = { x: Math.round(n.x), y: Math.round(n.y) }; });
    try { localStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch (_) { }
  };

  const saveWeights = () => {
    const out = {};
    edges.forEach((e) => { out[edgeKey(e)] = +e.weight.toFixed(3); });
    try { localStorage.setItem(WEIGHT_KEY, JSON.stringify(out)); } catch (_) { }
  };

  /* ------------------------------------------------------------------ *
   * Loop detection (all elementary cycles)
   * ------------------------------------------------------------------ */
  const order = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const outgoing = Object.fromEntries(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => outgoing[e.from].push(e));

  function findCycles() {
    const found = [];
    for (const start of nodes) {
      const path = [start.id];
      const pathEdges = [];
      const onPath = new Set([start.id]);
      (function dfs(u) {
        for (const e of outgoing[u]) {
          if (e.to === start.id) {
            found.push({ nodes: [...path], edges: [...pathEdges, e] });
          } else if (!onPath.has(e.to) && order[e.to] > order[start.id]) {
            onPath.add(e.to); path.push(e.to); pathEdges.push(e);
            dfs(e.to);
            pathEdges.pop(); path.pop(); onPath.delete(e.to);
          }
        }
      })(start.id);
    }
    return found;
  }

  const FAMILIES = [
    { key: "results", label: "Seeing results" },
    { key: "trustPC", label: "Trust in public consultation" },
    { key: "efficacy", label: "Perceived value & efficacy" },
    { key: "capacity", label: "CIVIS capacity & motivation" },
    { key: "affected", label: "Affected-community feedback" },
    { key: "ngoTrust", label: "NGO collaboration → trust in CIVIS" },
    { key: "ngoCap", label: "NGO collaboration → CIVIS capacity" },
    { key: "outreach", label: "Outreach ↔ NGO collaboration" },
  ];
  const famIndex = Object.fromEntries(FAMILIES.map((f, i) => [f.key, i]));

  function familyOf(l) {
    const s = new Set(l.nodes);
    if (s.has("ngo") && s.has("wfOps")) return "ngoCap";
    if (s.has("ngo") && s.has("trustCivis")) return "ngoTrust";
    if (s.has("ngo") && l.nodes.length === 2) return "outreach";
    if (s.has("fbAff")) return "affected";
    if (s.has("capacity")) return "capacity";
    if (s.has("trustPC")) return "trustPC";
    if (s.has("valueEff")) return "efficacy";
    return "results";
  }

  const loops = findCycles().map((c) => {
    const assumed = c.edges.filter((e) => !e.marked).length;
    const set = new Set(c.nodes);
    const fam = familyOf(c);
    const tags = [];
    if (set.has("workload")) tags.push("admin workload");
    if (set.has("cipca")) tags.push("CIPCA awards");
    if (set.has("draftConsult") && fam !== "results" && fam !== "trustPC" && fam !== "efficacy") tags.push("via draft laws");
    const l = {
      nodes: c.nodes,
      edges: c.edges,
      edgeIdx: new Set(c.edges.map((e) => e.i)),
      nodeSet: set,
      assumed,
      fam,
      famLabel: FAMILIES[famIndex[fam]].label,
      tags,
    };
    // neg / type / strength follow the live weights, so editing a link can flip a
    // loop between reinforcing and balancing.
    Object.defineProperty(l, "neg", { get: () => l.edges.filter((e) => e.sign < 0).length });
    Object.defineProperty(l, "type", { get: () => (l.neg % 2 === 0 ? "R" : "B") });
    // Product of absolute weights: how much a nudge survives one trip round the loop.
    Object.defineProperty(l, "gain", { get: () => l.edges.reduce((p, e) => p * Math.abs(e.weight), 1) });
    return l;
  });
  loops.sort((a, b) => famIndex[a.fam] - famIndex[b.fam] || a.nodes.length - b.nodes.length || a.tags.length - b.tags.length);
  // Codes are assigned by the initial (data.js) polarity so they stay stable while
  // the user edits weights during a session.
  let cR = 0, cB = 0;
  loops.forEach((l, i) => {
    l.id = i;
    l.code = l.type + (l.type === "R" ? ++cR : ++cB);
    l.name = l.famLabel;
  });
  const loopById = loops;
  const inAnyLoop = new Set(loops.flatMap((l) => l.nodes));

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  const state = {
    selected: new Set(),
    hoverLoop: null,
    focus: null,           // {kind:'node'|'edge', id}
    hoverNode: null,
    mode: "highlight",
    type: "all",
    query: "",
    polarity: true,
    flow: true,
    sim: false,            // simulation mode on/off
    playing: false,        // auto-stepping
    speed: 1,              // ticks-per-second multiplier
    weightTarget: null,    // edge index whose weight popover is open
  };

  // Each node carries a simulation value in [-100, 100]. 0 is its baseline.
  nodes.forEach((n) => { n.value = 0; n.pulse = 0; });

  /* ------------------------------------------------------------------ *
   * Rendering: markers, nodes, edges
   * ------------------------------------------------------------------ */
  const MARKER_COLORS = { base: "#aab2c2", R: "#e5484d", B: "#2b7de9", RB: "#8b5cf6", hov: "#394152", edit: "#1d2433" };
  for (const k in MARKER_COLORS) {
    const m = mk("marker", {
      id: "arr-" + k, viewBox: "0 0 10 10", refX: "8.5", refY: "5",
      markerWidth: "7.5", markerHeight: "7.5",
      markerUnits: "strokeWidth", orient: "auto-start-reverse",
    }, defs);
    mk("path", { d: "M0,1.2 L9,5 L0,8.8 Z", fill: MARKER_COLORS[k] }, m);
  }

  const mctx = document.createElement("canvas").getContext("2d");
  function wrap(text, font, maxW) {
    mctx.font = font;
    const words = text.split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (mctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return { lines, width: Math.max(...lines.map((l) => mctx.measureText(l).width)) };
  }

  nodes.forEach((n) => {
    const main = wrap(n.label, `600 15px ${FF}`, 190);
    const sub = n.sub ? wrap(n.sub, `400 11.5px ${FF}`, 190) : null;
    n.w = Math.ceil(Math.max(main.width, sub ? sub.width : 0)) + 44;
    n.h = 18 + main.lines.length * 19 + (sub ? 5 + sub.lines.length * 15 : 0) + 6;

    const g = mk("g", { class: "node" + (inAnyLoop.has(n.id) ? "" : " ctx"), "data-id": n.id }, nodeLayer);
    n.el = g;
    const clipId = "clip-" + n.id;
    const cp = mk("clipPath", { id: clipId }, defs);
    mk("rect", { x: -n.w / 2, y: -n.h / 2, width: n.w, height: n.h, rx: 12 }, cp);
    mk("rect", { class: "card", x: -n.w / 2, y: -n.h / 2, width: n.w, height: n.h, rx: 12 }, g);
    const acc = mk("g", { "clip-path": `url(#${clipId})` }, g);
    // simulation value fill (grows from the bottom); drawn behind the accent + text
    n.fill = mk("rect", { class: "valfill", x: -n.w / 2, width: n.w, y: n.h / 2 - 1, height: 0, opacity: 0 }, acc);
    mk("rect", { x: -n.w / 2, y: -n.h / 2, width: 6, height: n.h, fill: D.categories[n.cat].color }, acc);

    let y = -n.h / 2 + 11;
    const tx = -n.w / 2 + 20;
    main.lines.forEach((ln) => {
      y += 19;
      const t = mk("text", { class: "t", x: tx, y: y - 4 }, g);
      t.textContent = ln;
    });
    if (sub) {
      y += 5;
      sub.lines.forEach((ln) => {
        y += 15;
        const t = mk("text", { class: "s", x: tx, y: y - 4 }, g);
        t.textContent = ln;
      });
    }
    if (n.star) {
      const s = mk("text", { class: "star", x: n.w / 2 - 4, y: -n.h / 2 + 2 }, g);
      s.textContent = "★";
      const ti = mk("title", null, s);
      ti.textContent = "Starred in the original map";
    }
    const step = mk("g", { class: "step", transform: `translate(${-n.w / 2 + 2},${-n.h / 2 + 2})` }, g);
    mk("circle", { r: 11 }, step);
    n.stepText = mk("text", null, step);

    // Simulation value readout (top-right) + up/down nudge handle (right edge)
    n.valText = mk("text", { class: "valtext", x: n.w / 2 - 10, y: -n.h / 2 + 13, opacity: 0 }, g);
    const handle = mk("g", { class: "nudge" }, g);
    n.nudgeEl = handle;
    handle.setAttribute("transform", `translate(${n.w / 2},0)`);
    mk("rect", { x: -13, y: -24, width: 30, height: 48, rx: 9, class: "nudge-bg" }, handle);
    const up = mk("g", { class: "nudge-btn up", transform: "translate(1.5,-12)" }, handle);
    mk("circle", { r: 11 }, up);
    mk("path", { d: "M-4,2 L0,-3 L4,2", class: "chev" }, up);
    const dn = mk("g", { class: "nudge-btn dn", transform: "translate(1.5,12)" }, handle);
    mk("circle", { r: 11 }, dn);
    mk("path", { d: "M-4,-2 L0,3 L4,-2", class: "chev" }, dn);
    const hook = (el, amt) => {
      el.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); });
      el.addEventListener("click", (ev) => { ev.stopPropagation(); nudge(n, amt); });
    };
    hook(up, 25); hook(dn, -25);

    n.el.addEventListener("pointerdown", (ev) => startNodeDrag(ev, n));
    n.el.addEventListener("pointerenter", () => { state.hoverNode = n.id; refresh(); });
    n.el.addEventListener("pointerleave", () => { state.hoverNode = null; refresh(); });
    placeNode(n);
  });

  function placeNode(n) { n.el.setAttribute("transform", `translate(${n.x},${n.y})`); }

  function boundary(n, tx, ty, pad) {
    const dx = tx - n.x, dy = ty - n.y;
    const hw = n.w / 2 + pad, hh = n.h / 2 + pad;
    const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return { x: n.x + dx * Math.min(t, 1), y: n.y + dy * Math.min(t, 1) };
  }

  function geom(e) {
    const a = byId[e.from], b = byId[e.to];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = e.bend == null ? 0.16 : e.bend;
    const off = Math.sign(bend) * Math.min(Math.abs(bend) * len * 1.6, 240);
    const cx = (a.x + b.x) / 2 - (dy / len) * off;
    const cy = (a.y + b.y) / 2 + (dx / len) * off;
    const p0 = boundary(a, cx, cy, 3);
    const p2 = boundary(b, cx, cy, 5);
    return {
      p0, p2, c: { x: cx, y: cy },
      mid: { x: 0.25 * p0.x + 0.5 * cx + 0.25 * p2.x, y: 0.25 * p0.y + 0.5 * cy + 0.25 * p2.y },
    };
  }

  edges.forEach((e) => {
    const g = mk("g", { class: "edge", "data-i": e.i }, edgeLayer);
    e.el = g;
    e.casing = mk("path", { class: "casing" }, g);   // white halo for readable crossings
    e.line = mk("path", { class: "line" }, g);
    e.flowEl = mk("path", { class: "flow" }, g);
    e.hit = mk("path", { class: "hit" }, g);
    e.pol = mk("g", { class: "pol" + (e.marked ? " marked" : "") }, g);
    e.polCircle = mk("circle", { r: 9 }, e.pol);
    e.polText = mk("text", null, e.pol);
    if (e.note) {
      e.info = mk("g", { class: "info" }, g);
      mk("circle", { r: 7 }, e.info);
      mk("text", null, e.info).textContent = "i";
    }
    e.hit.addEventListener("pointerenter", (ev) => { e.hovered = true; showEdgeTip(e, ev); refresh(); });
    e.hit.addEventListener("pointermove", (ev) => moveTip(ev));
    e.hit.addEventListener("pointerleave", () => { e.hovered = false; hideTip(); refresh(); });
    e.hit.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setFocus({ kind: "edge", id: e.i });
    });
    // Click the badge to edit the weight; scroll on it for a quick change.
    e.pol.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    e.pol.addEventListener("click", (ev) => { ev.stopPropagation(); openWeightPopover(e); });
    e.pol.addEventListener("wheel", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      setWeight(e, e.weight + (ev.deltaY < 0 ? 0.05 : -0.05));
    }, { passive: false });
    updateEdgeWeightVisual(e);
    drawEdge(e);
  });

  // Reflect a link's weight on the badge (percentage), line thickness and tooltip.
  function updateEdgeWeightVisual(e) {
    const pct = Math.round(e.weight * 100);
    e.polText.textContent = (pct > 0 ? "+" : pct < 0 ? "\u2212" : "") + Math.abs(pct) + "%";
    e.pol.classList.toggle("neg", e.weight < 0);
    e.pol.classList.toggle("zero", pct === 0);
    const base = 1.4 + Math.abs(e.weight) * 3.2;   // thickness tracks strength
    e.line.style.setProperty("--w", base.toFixed(2));
    e.polCircle.setAttribute("rx", 15); e.polCircle.setAttribute("ry", 10);
    e.polCircle.removeAttribute("r");
  }

  function setWeight(e, w) {
    w = Math.max(-1, Math.min(1, Math.round(w * 100) / 100));
    e.weight = w; syncEdge(e);
    updateEdgeWeightVisual(e);
    saveWeights();
    renderList();   // loop R/B type may have flipped
    refresh();
    if (state.weightTarget === e.i) syncWeightPopover(e);
  }

  function drawEdge(e) {
    const { p0, p2, c, mid } = geom(e);
    const d = `M${p0.x},${p0.y} Q${c.x},${c.y} ${p2.x},${p2.y}`;
    e.line.setAttribute("d", d);
    e.casing.setAttribute("d", d);
    e.flowEl.setAttribute("d", d);
    e.hit.setAttribute("d", d);
    e.pol.setAttribute("transform", `translate(${mid.x},${mid.y})`);
    if (e.info) e.info.setAttribute("transform", `translate(${mid.x + 15},${mid.y - 11})`);
  }
  const redrawEdgesOf = (id) => edges.forEach((e) => { if (e.from === id || e.to === id) drawEdge(e); });

  /* ------------------------------------------------------------------ *
   * Selection logic & visual state
   * ------------------------------------------------------------------ */
  const matchesFocus = (l) => {
    if (!state.focus) return true;
    return state.focus.kind === "node" ? l.nodeSet.has(state.focus.id) : l.edgeIdx.has(state.focus.id);
  };

  function activeLoopSet() {
    const s = new Set(state.selected);
    if (state.hoverLoop != null) s.add(state.hoverLoop);
    if (!state.selected.size && state.hoverLoop == null && state.focus) {
      loops.forEach((l) => { if (matchesFocus(l)) s.add(l.id); });
    }
    return s;
  }

  function refresh() {
    const act = activeLoopSet();
    const has = act.size > 0;
    const isolate = state.mode === "isolate" && has;

    const edgeState = new Map();   // idx -> {R,B}
    const nodeAct = new Set();
    act.forEach((id) => {
      const l = loops[id];
      l.edges.forEach((e) => {
        const s = edgeState.get(e.i) || {};
        s[l.type] = true;
        edgeState.set(e.i, s);
      });
      l.nodes.forEach((n) => nodeAct.add(n));
    });

    const near = new Set();
    const hoverEdges = new Set();
    if (!has && state.hoverNode) {
      edges.forEach((e) => {
        if (e.from === state.hoverNode || e.to === state.hoverNode) {
          hoverEdges.add(e.i); near.add(e.from); near.add(e.to);
        }
      });
    }

    edges.forEach((e) => {
      const s = edgeState.get(e.i);
      let cls = "edge", marker = "base";
      if (s) { const k = s.R && s.B ? "RB" : s.R ? "R" : "B"; cls += " " + k; marker = k; }
      else if (has) cls += isolate ? " hidden" : " dim";
      else if (hoverEdges.size) {
        if (hoverEdges.has(e.i)) { cls += " hov"; marker = "hov"; } else cls += " dim";
      } else if (e.hovered) { cls += " hov"; marker = "hov"; }
      if (state.weightTarget === e.i) cls += " editing";
      e.el.setAttribute("class", cls);
      e.line.setAttribute("marker-end", `url(#arr-${marker})`);
    });

    const single = state.selected.size === 1 && state.hoverLoop == null ? loops[[...state.selected][0]] : null;
    nodes.forEach((n) => {
      let cls = "node" + (inAnyLoop.has(n.id) ? "" : " ctx");
      if (has) {
        if (nodeAct.has(n.id)) cls += " act"; else cls += isolate ? " hidden" : " dim";
      } else if (hoverEdges.size) {
        if (!near.has(n.id)) cls += " dim"; else cls += " near";
      }
      if (state.focus && state.focus.kind === "node" && state.focus.id === n.id) cls += " focus";
      if (single && single.nodeSet.has(n.id)) {
        cls += " numbered";
        n.stepText.textContent = single.nodes.indexOf(n.id) + 1;
      }
      n.el.setAttribute("class", cls);
    });

    updateList();
    updateDetail();
    updateToggleLabel();
  }

  function setFocus(f) {
    const same = state.focus && f && state.focus.kind === f.kind && state.focus.id === f.id;
    state.focus = same ? null : f;
    renderList();
    refresh();
  }

  function toggleSelect(id, additive) {
    if (additive) {
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    } else if (state.selected.size === 1 && state.selected.has(id)) {
      state.selected.clear();
    } else {
      state.selected = new Set([id]);
    }
    state.hoverLoop = null;
    refresh();
    if (state.mode === "isolate") fitSelection();
  }

  function clearAll() {
    state.selected.clear();
    state.hoverLoop = null;
    state.focus = null;
    state.query = "";
    $("#search").value = "";
    renderList();
    refresh();
    fitAll();
  }

  /* ------------------------------------------------------------------ *
   * Sidebar
   * ------------------------------------------------------------------ */
  const labelOf = (id) => byId[id].label;

  function loopMatches(l) {
    if (state.type !== "all" && l.type !== state.type) return false;
    if (!matchesFocus(l)) return false;
    const q = state.query.trim().toLowerCase();
    if (q) {
      const hay = (l.name + " " + l.tags.join(" ") + " " + l.nodes.map((id) => labelOf(id) + " " + (byId[id].sub || "")).join(" ")).toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  function renderList() {
    $("#cntAll").textContent = loops.length;
    $("#cntR").textContent = loops.filter((l) => l.type === "R").length;
    $("#cntB").textContent = loops.filter((l) => l.type === "B").length;

    const chip = $("#focusChip");
    if (state.focus) {
      chip.classList.remove("hidden");
      chip.innerHTML = "";
      const label = state.focus.kind === "node"
        ? `Loops through \u201C${labelOf(state.focus.id)}\u201D`
        : (() => { const e = edges[state.focus.id]; return `Loops using link ${labelOf(e.from)} \u2192 ${labelOf(e.to)}`; })();
      chip.append(h("span", null, label));
      const x = h("button", null, "\u00D7");
      x.title = "Remove filter";
      x.onclick = () => { state.focus = null; renderList(); refresh(); };
      chip.append(x);
    } else chip.classList.add("hidden");

    const list = $("#loopList");
    list.innerHTML = "";
    let shown = 0;
    FAMILIES.forEach((f) => {
      const items = loops.filter((l) => l.fam === f.key && loopMatches(l));
      if (!items.length) return;
      shown += items.length;
      const g = h("div", "group");
      const hd = h("h2");
      hd.append(h("span", null, f.label), h("span", null, items.length));
      g.append(hd);
      items.forEach((l) => g.append(rowFor(l)));
      list.append(g);
    });
    if (!shown) list.append(h("div", "empty", "No loops match."));
    updateList();
  }

  function rowFor(l) {
    const r = h("div", "row");
    r.dataset.id = l.id;
    r.setAttribute("role", "listitem");
    r.append(h("span", "box"));
    r.append(h("span", "badge " + l.type, l.code));
    const t = h("div", "txt");
    t.append(h("div", "name", loopTitle(l)));
    const meta = h("div", "meta");
    meta.append(h("span", null, `${l.nodes.length} variables`));
    meta.append(h("span", null, `${l.neg} negative link${l.neg === 1 ? "" : "s"}`));
    t.append(meta);
    r.append(t);
    r.addEventListener("click", (ev) => {
      const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.target.classList.contains("box");
      toggleSelect(l.id, additive);
      // On phones the sheet covers the map, so tuck it away after a plain tap.
      if (!additive && isMobile()) setSide(false);
    });
    r.addEventListener("pointerenter", () => { state.hoverLoop = l.id; refresh(); });
    r.addEventListener("pointerleave", () => { state.hoverLoop = null; refresh(); });
    return r;
  }

  // Loops in a family share a core path; variants add the government-side detours.
  function loopTitle(l) {
    return l.tags.length ? "Core loop + " + l.tags.join(" + ") : "Core loop";
  }

  function updateList() {
    document.querySelectorAll(".row").forEach((r) => {
      r.classList.toggle("sel", state.selected.has(+r.dataset.id));
    });
  }

  function updateDetail() {
    const box = $("#detail");
    box.innerHTML = "";
    if (state.selected.size === 0) return;
    if (state.selected.size > 1) {
      const sel = [...state.selected].map((id) => loops[id]);
      box.append(h("h3", null, `${sel.length} loops selected`));
      const p = h("p", "kind", sel.map((l) => l.code).join(", ") + ". Shared links are drawn in purple where reinforcing and balancing loops overlap.");
      box.append(p);
      return;
    }
    const l = loops[[...state.selected][0]];
    const h3 = h("h3");
    // Badge uses the stable code; the word reflects the live type (weights can flip it).
    h3.append(h("span", "badge " + l.type, l.code), h("span", null, l.name));
    if (l.code[0] !== l.type) h3.append(h("span", "tag", "now " + (l.type === "R" ? "reinforcing" : "balancing")));
    box.append(h3);
    const kind = l.type === "R"
      ? `Reinforcing loop. It has ${l.neg} negative link${l.neg === 1 ? "" : "s"} (an even number), so a change feeds back on itself and grows.`
      : `Balancing loop. It has ${l.neg} negative link${l.neg === 1 ? "" : "s"} (an odd number), so a change is pushed back and the loop settles.`;
    box.append(h("p", "kind", kind));

    // Live loop strength: product of link weights around the loop.
    const gain = l.gain;
    const gb = h("div", "loopgain");
    const lab = h("div", "lab");
    lab.append(h("span", null, "Loop strength (gain per cycle)"), h("span", null, (gain * 100).toFixed(0) + "%"));
    gb.append(lab);
    const track = h("div", "track");
    const fillbar = h("div", "fillbar");
    fillbar.style.width = Math.min(100, gain * 100) + "%";
    fillbar.style.background = l.type === "R" ? "var(--R)" : "var(--B)";
    track.append(fillbar);
    gb.append(track);
    gb.append(h("div", "note", gain >= 1
      ? "At 100% or more, a nudge keeps growing each cycle. Lower some link weights to settle it."
      : "Below 100%, each trip round the loop shrinks, so the effect fades over time."));
    box.append(gb);
    const ol = h("ol");
    l.edges.forEach((e, i) => {
      const li = h("li");
      li.append(h("span", "n", i + 1));
      const pct = Math.round(e.weight * 100);
      const sg = h("span", "sg" + (e.weight < 0 ? " neg" : ""), (pct > 0 ? "+" : "") + pct + "%");
      sg.title = "Click to edit this link's weight";
      sg.style.cursor = "pointer";
      sg.onclick = () => openWeightPopover(e);
      li.append(sg);
      li.append(h("span", null, `${labelOf(e.from)} \u2192 ${labelOf(e.to)}`));
      li.addEventListener("pointerenter", () => { e.hovered = true; refresh(); });
      li.addEventListener("pointerleave", () => { e.hovered = false; refresh(); });
      ol.append(li);
    });
    box.append(ol);
    box.append(h("p", "note", "Each percentage is how much a change passes along that link. Click one to adjust it; the loop type and strength update live."));
  }

  $("#typeFilter").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    state.type = b.dataset.type;
    document.querySelectorAll("#typeFilter button").forEach((x) => x.classList.toggle("on", x === b));
    renderList();
  });
  $("#search").addEventListener("input", (ev) => { state.query = ev.target.value; renderList(); });

  /* ------------------------------------------------------------------ *
   * Toolbar
   * ------------------------------------------------------------------ */
  $("#modeSeg").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    state.mode = b.dataset.mode;
    document.querySelectorAll("#modeSeg button").forEach((x) => x.classList.toggle("on", x === b));
    refresh();
    state.mode === "isolate" ? fitSelection() : null;
  });
  $("#btnPolarity").addEventListener("click", (ev) => {
    state.polarity = !state.polarity;
    ev.currentTarget.classList.toggle("on", state.polarity);
    document.body.classList.toggle("nopol", !state.polarity);
  });
  $("#btnFlow").addEventListener("click", (ev) => {
    state.flow = !state.flow;
    ev.currentTarget.classList.toggle("on", state.flow);
    document.body.classList.toggle("noflow", !state.flow);
  });
  $("#btnSim").addEventListener("click", () => setSim(!state.sim));
  $("#btnPlay").addEventListener("click", () => playSim(!state.playing));
  $("#btnStep").addEventListener("click", () => { if (!state.sim) setSim(true); simStep(); });
  $("#btnResetVals").addEventListener("click", resetValues);
  $("#simSpeed").addEventListener("input", (ev) => { state.speed = +ev.target.value; });
  $("#btnFit").addEventListener("click", () => fitSelection(true));
  $("#btnClear").addEventListener("click", clearAll);
  $("#btnReset").addEventListener("click", () => {
    nodes.forEach((n) => { n.x = defaultPos[n.id].x; n.y = defaultPos[n.id].y; placeNode(n); });
    edges.forEach(drawEdge);
    try { localStorage.removeItem(STORE_KEY); } catch (_) { }
    fitAll();
  });
  window.addEventListener("keydown", (ev) => { if (ev.key === "Escape") clearAll(); });

  /* ------------------------------------------------------------------ *
   * Legend
   * ------------------------------------------------------------------ */
  (function buildLegend() {
    const lg = $("#legend");
    const row = (swatch, text) => { const d = h("div", "li"); d.append(swatch, h("span", null, text)); lg.append(d); };
    for (const k in D.categories) {
      const s = h("span", "sw"); s.style.background = D.categories[k].color;
      row(s, D.categories[k].label);
    }
    lg.append(h("hr"));
    const dash = h("span", "dash"); row(dash, "Not part of any loop");
    const r = h("span", "ln"); r.style.background = "var(--R)"; row(r, "Reinforcing loop");
    const b = h("span", "ln"); b.style.background = "var(--B)"; row(b, "Balancing loop");
    const p1 = h("span", "pol solid", "%"); row(p1, "Link weight (click to edit)");
  })();

  /* ------------------------------------------------------------------ *
   * Tooltip
   * ------------------------------------------------------------------ */
  function showEdgeTip(e, ev) {
    tip.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = `${labelOf(e.from)} \u2192 ${labelOf(e.to)}`;
    tip.append(b);
    const pct = Math.round(e.weight * 100);
    const s = h("div", "s", `Weight ${pct > 0 ? "+" : ""}${pct}% ${e.weight >= 0 ? "(same direction)" : "(opposite direction)"} \u00B7 click to edit`);
    tip.append(s);
    if (e.note) tip.append(h("div", null, e.note));
    tip.classList.remove("hidden");
    moveTip(ev);
  }
  function moveTip(ev) {
    const r = stage.getBoundingClientRect();
    let x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
    x = Math.min(x, r.width - tip.offsetWidth - 10);
    y = Math.min(y, r.height - tip.offsetHeight - 10);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip() { tip.classList.add("hidden"); }

  /* ------------------------------------------------------------------ *
   * Weight popover (edit how strongly a link affects its target)
   * ------------------------------------------------------------------ */
  const pop = $("#weightPop");
  let popEdge = null;

  function openWeightPopover(e) {
    popEdge = e;
    state.weightTarget = e.i;
    pop.innerHTML = "";

    const title = h("div", "wp-title");
    title.append(h("b", null, labelOf(e.from)));
    title.append(h("span", "wp-arrow", " \u2192 "));
    title.append(h("b", null, labelOf(e.to)));
    pop.append(title);

    pop.append(h("div", "wp-hint", "How much a change in the first spreads to the second."));

    const row = h("div", "wp-row");
    const sign = h("button", "wp-sign");
    sign.title = "Flip between a + (same direction) and \u2212 (opposite) link";
    sign.onclick = () => setWeight(e, -e.weight || -DEFAULT_W);
    const slider = document.createElement("input");
    slider.type = "range"; slider.min = "-100"; slider.max = "100"; slider.step = "5"; slider.className = "wp-slider";
    slider.oninput = () => setWeight(e, +slider.value / 100);
    const num = document.createElement("input");
    num.type = "number"; num.min = "-100"; num.max = "100"; num.className = "wp-num";
    num.onchange = () => setWeight(e, (+num.value || 0) / 100);
    const pctSign = h("span", "wp-pct", "%");
    row.append(sign, slider, num, pctSign);
    pop.append(row);

    const foot = h("div", "wp-foot");
    const reset = h("button", "wp-link", "Reset to default");
    reset.onclick = () => setWeight(e, defaultWeight[e.i]);
    const close = h("button", "wp-link", "Done");
    close.onclick = closeWeightPopover;
    foot.append(reset, close);
    pop.append(foot);

    pop.els = { sign, slider, num };
    pop.classList.remove("hidden");
    syncWeightPopover(e);
    positionWeightPopover(e);
  }

  function syncWeightPopover(e) {
    if (!pop.els) return;
    const pct = Math.round(e.weight * 100);
    pop.els.slider.value = pct;
    pop.els.num.value = pct;
    pop.els.sign.textContent = e.weight < 0 ? "\u2212" : "+";
    pop.els.sign.classList.toggle("neg", e.weight < 0);
  }

  function positionWeightPopover(e) {
    const { mid } = geom(e);
    const r = svg.getBoundingClientRect();
    const sx = r.left + view.x + mid.x * view.k;
    const sy = r.top + view.y + mid.y * view.k;
    const stageR = stage.getBoundingClientRect();
    let x = sx - stageR.left - pop.offsetWidth / 2;
    let y = sy - stageR.top - pop.offsetHeight - 18;
    if (y < 8) y = sy - stageR.top + 24;
    x = Math.max(8, Math.min(x, stageR.width - pop.offsetWidth - 8));
    pop.style.left = x + "px"; pop.style.top = y + "px";
  }

  function closeWeightPopover() {
    popEdge = null; state.weightTarget = null; pop.els = null;
    pop.classList.add("hidden");
    refresh();
  }
  svg.addEventListener("pointerdown", () => { if (popEdge) closeWeightPopover(); }, true);

  /* ------------------------------------------------------------------ *
   * Pan / zoom / drag
   * ------------------------------------------------------------------ */
  const view = { x: 0, y: 0, k: 1 };
  const applyView = () => {
    viewport.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
    if (popEdge) positionWeightPopover(popEdge);
  };

  function toWorld(cx, cy) {
    const r = svg.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  }

  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const k2 = Math.min(3, Math.max(0.12, view.k * Math.exp(-ev.deltaY * 0.0016)));
    view.x = px - ((px - view.x) / view.k) * k2;
    view.y = py - ((py - view.y) / view.k) * k2;
    view.k = k2;
    applyView();
  }, { passive: false });

  let pan = null;
  svg.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".node") || ev.target.closest(".edge")) return;
    pan = { sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };
    svg.setPointerCapture(ev.pointerId);
    svg.classList.add("panning");
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!pan) return;
    const dx = ev.clientX - pan.sx, dy = ev.clientY - pan.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
    view.x = pan.vx + dx; view.y = pan.vy + dy;
    applyView();
  });
  const endPan = () => {
    if (!pan) return;
    if (!pan.moved && state.focus) { state.focus = null; renderList(); refresh(); }
    pan = null;
    svg.classList.remove("panning");
  };
  svg.addEventListener("pointerup", endPan);
  svg.addEventListener("pointercancel", endPan);

  let drag = null, vdrag = null;
  function startValueDrag(ev, n) {
    ev.stopPropagation();
    vdrag = { n, sy: ev.clientY, v0: n.value, moved: false };
    n.nudgeEl.setPointerCapture(ev.pointerId);
    n.nudgeEl.addEventListener("pointermove", onValueDrag);
    n.nudgeEl.addEventListener("pointerup", endValueDrag);
    n.nudgeEl.addEventListener("pointercancel", endValueDrag);
  }
  function onValueDrag(ev) {
    if (!vdrag) return;
    const dy = (ev.clientY - vdrag.sy) / view.k;
    vdrag.moved = true;
    vdrag.n.value = Math.max(-SIM.clamp, Math.min(SIM.clamp, vdrag.v0 - dy));
    renderValues();
    if (state.sim && !state.playing) simStep();
  }
  function endValueDrag(ev) {
    if (!vdrag) return;
    const n = vdrag.n;
    n.nudgeEl.removeEventListener("pointermove", onValueDrag);
    n.nudgeEl.removeEventListener("pointerup", endValueDrag);
    n.nudgeEl.removeEventListener("pointercancel", endValueDrag);
    vdrag = null;
  }

  function startNodeDrag(ev, n) {
    ev.stopPropagation();
    // In sim mode a vertical drag on the handle area adjusts the value instead.
    if (state.sim && ev.target.closest(".nudge-bg")) { startValueDrag(ev, n); return; }
    drag = { n, sx: ev.clientX, sy: ev.clientY, ox: n.x, oy: n.y, moved: false };
    n.el.setPointerCapture(ev.pointerId);
    n.el.addEventListener("pointermove", onDrag);
    n.el.addEventListener("pointerup", endDrag);
    n.el.addEventListener("pointercancel", endDrag);
  }
  function onDrag(ev) {
    if (!drag) return;
    const dx = (ev.clientX - drag.sx) / view.k, dy = (ev.clientY - drag.sy) / view.k;
    if (!drag.moved && Math.hypot(dx, dy) * view.k < 4) return;
    drag.moved = true;
    drag.n.x = drag.ox + dx; drag.n.y = drag.oy + dy;
    placeNode(drag.n);
    redrawEdgesOf(drag.n.id);
  }
  function endDrag(ev) {
    if (!drag) return;
    const { n, moved } = drag;
    n.el.removeEventListener("pointermove", onDrag);
    n.el.removeEventListener("pointerup", endDrag);
    n.el.removeEventListener("pointercancel", endDrag);
    drag = null;
    if (moved) savePositions();
    else if (inAnyLoop.has(n.id)) setFocus({ kind: "node", id: n.id });
  }

  /* ------------------------------------------------------------------ *
   * Fit helpers
   * ------------------------------------------------------------------ */
  let anim = null;
  function animateTo(target) {
    cancelAnimationFrame(anim);
    const from = { ...view };
    const t0 = performance.now(), dur = 480;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    (function step(now) {
      const t = Math.min(1, (now - t0) / dur), e = ease(t);
      view.x = from.x + (target.x - from.x) * e;
      view.y = from.y + (target.y - from.y) * e;
      view.k = from.k + (target.k - from.k) * e;
      applyView();
      if (t < 1) anim = requestAnimationFrame(step);
    })(t0);
  }

  function fitNodes(ids, animate) {
    const list = ids.map((id) => byId[id]);
    if (!list.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach((n) => {
      x0 = Math.min(x0, n.x - n.w / 2); x1 = Math.max(x1, n.x + n.w / 2);
      y0 = Math.min(y0, n.y - n.h / 2); y1 = Math.max(y1, n.y + n.h / 2);
    });
    const r = svg.getBoundingClientRect();
    const mobile = isMobile();
    const sheetOpen = mobile && !document.body.classList.contains("side-closed");
    const padX = mobile ? 24 : 60;
    const padTop = mobile ? 70 : 80;
    // Leave room for the legend/toggle strip, or for the open bottom sheet on phones.
    const padBottom = sheetOpen ? r.height * 0.64 + 20 : mobile ? 80 : 110;
    const k = Math.min((r.width - padX * 2) / (x1 - x0), (r.height - padTop - padBottom) / (y1 - y0), 1.5);
    const target = {
      k,
      x: (r.width - (x1 - x0) * k) / 2 - x0 * k,
      y: padTop + (r.height - padTop - padBottom - (y1 - y0) * k) / 2 - y0 * k,
    };
    if (animate) animateTo(target); else { Object.assign(view, target); applyView(); }
  }
  const fitAll = (animate = true) => fitNodes(nodes.map((n) => n.id), animate);
  function fitSelection(animate = true) {
    const act = activeLoopSet();
    if (!act.size) return fitAll(animate);
    const ids = new Set();
    act.forEach((id) => loops[id].nodes.forEach((n) => ids.add(n)));
    fitNodes([...ids], animate);
  }

  window.addEventListener("resize", () => { if (!state.selected.size) fitAll(false); });

  /* ------------------------------------------------------------------ *
   * Simulation engine (Loopy-style, weighted)
   *
   * Model: each node holds value v in [-100, 100]. Every tick, each link pushes
   * delta = (source value) * weight into its target, the target eases toward the
   * sum of pushes, and every value decays a little toward 0. Decay keeps loops
   * from running away to infinity; the weight magnitude sets how strong each push
   * is. It is qualitative (direction + relative strength), like Loopy, not a
   * numeric forecast.
   * ------------------------------------------------------------------ */
  const SIM = { decay: 0.045, ease: 0.22, clamp: 100, baseHz: 3 };

  function simStep() {
    // When a loop is isolated/selected, only its links transmit, so you can watch
    // one loop in isolation. Otherwise the whole map is live.
    const act = activeLoopSet();
    let activeEdges = edges;
    if (act.size) {
      const idx = new Set();
      act.forEach((id) => loops[id].edges.forEach((e) => idx.add(e.i)));
      activeEdges = edges.filter((e) => idx.has(e.i));
    }
    const push = Object.fromEntries(nodes.map((n) => [n.id, 0]));
    activeEdges.forEach((e) => { push[e.to] += byId[e.from].value * e.weight; });

    let moving = false;
    nodes.forEach((n) => {
      const target = push[n.id];
      let v = n.value + (target - n.value) * SIM.ease;   // ease toward incoming influence
      v *= (1 - SIM.decay);                               // gentle pull back to baseline
      v = Math.max(-SIM.clamp, Math.min(SIM.clamp, v));
      if (Math.abs(v - n.value) > 0.05 || Math.abs(v) > 0.05) moving = true;
      n.value = Math.abs(v) < 0.02 ? 0 : v;
    });
    renderValues();
    return moving;
  }

  let simRAF = null, simLast = 0, simAcc = 0;
  function simLoop(now) {
    if (!state.playing) return;
    if (!simLast) simLast = now;
    simAcc += (now - simLast) / 1000;
    simLast = now;
    const interval = 1 / (SIM.baseHz * state.speed);
    let any = false, guard = 0;
    while (simAcc >= interval && guard++ < 10) { any = simStep() || any; simAcc -= interval; }
    simRAF = requestAnimationFrame(simLoop);
  }
  function playSim(on) {
    state.playing = on;
    $("#btnPlay").classList.toggle("on", on);
    $("#btnPlay").textContent = on ? "\u275A\u275A Pause" : "\u25B6 Play";
    if (on) { simLast = 0; simAcc = 0; simRAF = requestAnimationFrame(simLoop); }
    else cancelAnimationFrame(simRAF);
  }

  function resetValues() {
    nodes.forEach((n) => { n.value = 0; n.pulse = 0; });
    renderValues();
  }

  // Nudge a node's value (from the drag handle). dir is +1 / -1.
  function nudge(n, amount) {
    n.value = Math.max(-SIM.clamp, Math.min(SIM.clamp, n.value + amount));
    n.pulse = 1;
    renderValues();
    if (state.sim && !state.playing) simStep();
  }

  function renderValues() {
    if (!state.sim) return;
    nodes.forEach((n) => {
      const v = n.value;
      const frac = Math.min(1, Math.abs(v) / SIM.clamp);
      // fill height grows from the bottom of the card
      const fillH = frac * (n.h - 2);
      n.fill.setAttribute("y", n.h / 2 - 1 - fillH);
      n.fill.setAttribute("height", fillH);
      n.fill.setAttribute("fill", v >= 0 ? "var(--up)" : "var(--down)");
      n.fill.setAttribute("opacity", frac ? 0.16 + 0.1 * frac : 0);
      if (n.valText) {
        n.valText.textContent = (v > 0 ? "+" : "") + Math.round(v);
        n.valText.setAttribute("opacity", frac > 0.01 ? 1 : 0);
        n.valText.setAttribute("fill", v >= 0 ? "var(--up-ink)" : "var(--down-ink)");
      }
    });
  }

  function setSim(on) {
    state.sim = on;
    document.body.classList.toggle("sim-on", on);
    $("#btnSim").classList.toggle("on", on);
    $("#simBar").classList.toggle("hidden", !on);
    if (!on) { playSim(false); resetValues(); closeWeightPopover(); }
    else { renderValues(); }
    refresh();
  }

  /* ------------------------------------------------------------------ *
   * Collapsible sidebar (side panel on desktop, bottom sheet on phones)
   * ------------------------------------------------------------------ */
  const mobileQuery = window.matchMedia("(max-width: 760px)");
  function isMobile() { return mobileQuery.matches; }

  let sideTimer = null;
  function setSide(open) {
    document.body.classList.toggle("side-closed", !open);
    $("#sideClose").setAttribute("aria-expanded", String(open));
    // Re-frame once the panel has finished sliding, so the fit uses the new stage size.
    clearTimeout(sideTimer);
    sideTimer = setTimeout(() => fitSelection(true), 320);
  }
  $("#sideClose").addEventListener("click", () => setSide(false));
  $("#sideToggle").addEventListener("click", () => setSide(true));

  // Show which loop is active on the floating button while the panel is hidden.
  function updateToggleLabel() {
    const n = state.selected.size;
    let txt = "\u2630 Loops";
    if (n === 1) txt = "\u2630 " + loops[[...state.selected][0]].code;
    else if (n > 1) txt = `\u2630 ${n} loops`;
    $("#sideToggle").textContent = txt;
  }

  /* ------------------------------------------------------------------ *
   * Two-finger pinch zoom / pan (touch)
   * ------------------------------------------------------------------ */
  const pointers = new Map();
  let pinch = null;
  svg.addEventListener("pointerdown", (ev) => {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) {
      // A second finger cancels any single-finger pan or node drag.
      pan = null; svg.classList.remove("panning");
      if (drag) { if (drag.moved) savePositions(); drag = null; }
      const [a, b] = [...pointers.values()];
      const r = svg.getBoundingClientRect();
      pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top,
        v: { ...view },
      };
      cancelAnimationFrame(anim);
    }
  }, true);
  svg.addEventListener("pointermove", (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (!pinch || pointers.size < 2) return;
    ev.stopPropagation();
    const [a, b] = [...pointers.values()];
    const r = svg.getBoundingClientRect();
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    const k = Math.min(3, Math.max(0.12, pinch.v.k * d / pinch.d));
    // Keep the world point that started under the fingers' midpoint under them now.
    const wx = (pinch.mx - pinch.v.x) / pinch.v.k, wy = (pinch.my - pinch.v.y) / pinch.v.k;
    view.k = k; view.x = mx - wx * k; view.y = my - wy * k;
    applyView();
  }, true);
  const endPointer = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  svg.addEventListener("pointerup", endPointer, true);
  svg.addEventListener("pointercancel", endPointer, true);

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  if (isMobile()) document.body.classList.add("side-closed");   // start with the map visible on phones
  renderList();
  refresh();
  fitAll(false);

  // Handy for debugging / screenshots: ?loop=R3 preselects a loop, &mode=isolate
  const qs = new URLSearchParams(location.search);
  if (qs.get("side")) document.body.classList.toggle("side-closed", qs.get("side") === "closed");
  if (qs.get("sim") === "1") setSim(true);
  if (qs.get("loop")) {
    qs.get("loop").split(",").forEach((c) => { const l = loops.find((x) => x.code === c); if (l) state.selected.add(l.id); });
    if (qs.get("mode") === "isolate") {
      state.mode = "isolate";
      document.querySelectorAll("#modeSeg button").forEach((x) => x.classList.toggle("on", x.dataset.mode === "isolate"));
    }
    refresh();
    fitSelection(false);
  }
  window.__sysmap = { loops, nodes, edges, state };
})();
