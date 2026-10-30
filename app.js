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
  const edges = D.edges.map((e, i) => ({
    ...e,
    i,
    sign: e.sign || 1,
    marked: !!e.marked,
  }));
  const defaultPos = Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    for (const id in saved) if (byId[id]) { byId[id].x = saved[id].x; byId[id].y = saved[id].y; }
  } catch (_) { /* ignore corrupt storage */ }

  const savePositions = () => {
    const out = {};
    nodes.forEach((n) => { out[n.id] = { x: Math.round(n.x), y: Math.round(n.y) }; });
    try { localStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch (_) { }
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
    const neg = c.edges.filter((e) => e.sign < 0).length;
    const assumed = c.edges.filter((e) => !e.marked).length;
    const set = new Set(c.nodes);
    const fam = familyOf(c);
    const tags = [];
    if (set.has("workload")) tags.push("admin workload");
    if (set.has("cipca")) tags.push("CIPCA awards");
    if (set.has("draftConsult") && fam !== "results" && fam !== "trustPC" && fam !== "efficacy") tags.push("via draft laws");
    return {
      nodes: c.nodes,
      edges: c.edges,
      edgeIdx: new Set(c.edges.map((e) => e.i)),
      nodeSet: set,
      neg,
      assumed,
      type: neg % 2 === 0 ? "R" : "B",
      fam,
      famLabel: FAMILIES[famIndex[fam]].label,
      tags,
    };
  });
  loops.sort((a, b) => famIndex[a.fam] - famIndex[b.fam] || a.nodes.length - b.nodes.length || a.tags.length - b.tags.length);
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
  };

  /* ------------------------------------------------------------------ *
   * Rendering: markers, nodes, edges
   * ------------------------------------------------------------------ */
  const MARKER_COLORS = { base: "#b3bac8", R: "#e5484d", B: "#2b7de9", RB: "#8b5cf6", hov: "#4b5568" };
  for (const k in MARKER_COLORS) {
    const m = mk("marker", {
      id: "arr-" + k, viewBox: "0 0 12 12", refX: "10", refY: "6",
      markerWidth: k === "base" ? "9" : "11", markerHeight: k === "base" ? "9" : "11",
      markerUnits: "userSpaceOnUse", orient: "auto",
    }, defs);
    mk("path", { d: "M1,1 L11,6 L1,11 L3.5,6 Z", fill: MARKER_COLORS[k] }, m);
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
    e.line = mk("path", { class: "line" }, g);
    e.flowEl = mk("path", { class: "flow" }, g);
    e.hit = mk("path", { class: "hit" }, g);
    e.pol = mk("g", { class: "pol" + (e.marked ? " marked" : "") }, g);
    mk("circle", { r: 9 }, e.pol);
    mk("text", null, e.pol).textContent = e.sign > 0 ? "+" : "\u2212";
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
    drawEdge(e);
  });

  function drawEdge(e) {
    const { p0, p2, c, mid } = geom(e);
    const d = `M${p0.x},${p0.y} Q${c.x},${c.y} ${p2.x},${p2.y}`;
    e.line.setAttribute("d", d);
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
    r.addEventListener("click", (ev) => toggleSelect(l.id, ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.target.classList.contains("box")));
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
    h3.append(h("span", "badge " + l.type, l.code), h("span", null, l.name));
    box.append(h3);
    const kind = l.type === "R"
      ? `Reinforcing loop. It has ${l.neg} negative link${l.neg === 1 ? "" : "s"} (an even number), so a change feeds back on itself and grows.`
      : `Balancing loop. It has ${l.neg} negative link${l.neg === 1 ? "" : "s"} (an odd number), so a change is pushed back and the loop settles.`;
    box.append(h("p", "kind", kind));
    const ol = h("ol");
    l.edges.forEach((e, i) => {
      const li = h("li");
      li.append(h("span", "n", i + 1));
      const sg = h("span", "sg" + (e.sign < 0 ? " neg" : "") + (e.marked ? "" : " asm"), e.sign > 0 ? "+" : "\u2212");
      sg.title = e.marked ? "Polarity shown in the original map" : "Assumed polarity (not marked in the original map)";
      li.append(sg);
      li.append(h("span", null, `${labelOf(e.from)} \u2192 ${labelOf(e.to)}`));
      li.addEventListener("pointerenter", () => { e.hovered = true; refresh(); });
      li.addEventListener("pointerleave", () => { e.hovered = false; refresh(); });
      ol.append(li);
    });
    box.append(ol);
    if (l.assumed) box.append(h("p", "note", `Faded signs are assumed "+" links (${l.assumed} of ${l.edges.length}). Confirm them to be sure the loop type is right.`));
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
    const p1 = h("span", "pol solid", "\u2212"); row(p1, "Polarity marked in your map");
    const p2 = h("span", "pol hollow", "+"); row(p2, "Polarity assumed");
  })();

  /* ------------------------------------------------------------------ *
   * Tooltip
   * ------------------------------------------------------------------ */
  function showEdgeTip(e, ev) {
    tip.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = `${labelOf(e.from)} \u2192 ${labelOf(e.to)}`;
    tip.append(b);
    const s = h("div", "s", `${e.sign > 0 ? "Positive (+)" : "Negative (\u2212)"} link${e.marked ? "" : ", assumed"}`);
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
   * Pan / zoom / drag
   * ------------------------------------------------------------------ */
  const view = { x: 0, y: 0, k: 1 };
  const applyView = () => viewport.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);

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

  let drag = null;
  function startNodeDrag(ev, n) {
    ev.stopPropagation();
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
    const padX = 60, padTop = 80, padBottom = 110;
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
   * Boot
   * ------------------------------------------------------------------ */
  renderList();
  refresh();
  fitAll(false);

  // Handy for debugging / screenshots: ?loop=R3 preselects a loop, &mode=isolate
  const qs = new URLSearchParams(location.search);
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
