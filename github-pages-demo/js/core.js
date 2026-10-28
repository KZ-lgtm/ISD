/* Intelligent Spray demo - pure logic (no DOM, no OpenCV): transforms, calibration fits,
   spray path generation, paint deposition / coverage metrics, statistics and robot exports.
   Image coordinates are canvas pixels (x right, y down); "mm" values come from the station calibration. */
(function (root) {
  'use strict';

  var Core = {};

  // ---------- small math ----------

  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  Core.dist = dist;

  Core.mean = function (arr) {
    if (!arr.length) return 0;
    var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  };

  Core.percentile = function (arr, p) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var idx = Math.min(s.length - 1, Math.max(0, (s.length - 1) * p));
    var lo = Math.floor(idx), hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };

  /**
   * Least-squares line through ys against their index (0..n-1), with the standard errors of the slope and of
   * the mean - drift is only reported when it stands clearly above the cycle-to-cycle scatter.
   */
  Core.linearTrend = function (ys) {
    var n = ys.length;
    if (n < 3) return { slope: 0, slopeSE: Infinity, mean: Core.mean(ys), meanSE: Infinity };
    var mx = (n - 1) / 2, my = Core.mean(ys), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { sxy += (i - mx) * (ys[i] - my); sxx += (i - mx) * (i - mx); syy += (ys[i] - my) * (ys[i] - my); }
    var slope = sxy / sxx;
    var resid = Math.max(0, syy - slope * sxy) / (n - 2);
    return { slope: slope, slopeSE: Math.sqrt(resid / sxx), mean: my, meanSE: Math.sqrt(syy / (n - 1) / n) };
  };

  /** Smallest round-number axis limit >= v (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 x 10^k). */
  Core.niceCeil = function (v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    var steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (m <= steps[i] + 1e-9) return steps[i] * p;
    return 10 * p;
  };

  /** Solves the 3x3 system m·v = r (Gaussian elimination with partial pivoting); null if singular. */
  function solve3(m, r) {
    var a = [m[0].concat([r[0]]), m[1].concat([r[1]]), m[2].concat([r[2]])];
    for (var c = 0; c < 3; c++) {
      var piv = c;
      for (var k = c + 1; k < 3; k++) if (Math.abs(a[k][c]) > Math.abs(a[piv][c])) piv = k;
      if (Math.abs(a[piv][c]) < 1e-12) return null;
      var tmp = a[c]; a[c] = a[piv]; a[piv] = tmp;
      for (var k2 = 0; k2 < 3; k2++) {
        if (k2 === c) continue;
        var f = a[k2][c] / a[c][c];
        for (var j = c; j < 4; j++) a[k2][j] -= f * a[c][j];
      }
    }
    return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
  }

  // ---------- similarity transforms (image -> image) ----------
  // T = { a, b, tx, ty } maps p to (a·x - b·y + tx, b·x + a·y + ty); a = s·cosθ, b = s·sinθ.

  Core.applySim = function (T, p) {
    return { x: T.a * p.x - T.b * p.y + T.tx, y: T.b * p.x + T.a * p.y + T.ty };
  };

  /** Same motion as T at point c, but with the scale removed - the rigid move applied to the spray path. */
  Core.rigidAbout = function (T, c) {
    var s = Math.hypot(T.a, T.b) || 1;
    var a = T.a / s, b = T.b / s;
    var c2 = Core.applySim(T, c);
    return { a: a, b: b, tx: c2.x - (a * c.x - b * c.y), ty: c2.y - (b * c.x + a * c.y) };
  };

  Core.simFromParams = function (thetaDeg, scale, tx, ty) {
    var r = thetaDeg * Math.PI / 180;
    return { a: scale * Math.cos(r), b: scale * Math.sin(r), tx: tx, ty: ty };
  };

  function solveSimilarity2(p, q) {
    var dx1 = q.x1 - p.x1, dy1 = q.y1 - p.y1;
    var dx2 = q.x2 - p.x2, dy2 = q.y2 - p.y2;
    var denom = dx1 * dx1 + dy1 * dy1;
    if (denom < 1e-6) return null;
    var a = (dx1 * dx2 + dy1 * dy2) / denom;
    var b = (dx1 * dy2 - dy1 * dx2) / denom;
    return { a: a, b: b, tx: p.x2 - (a * p.x1 - b * p.y1), ty: p.y2 - (b * p.x1 + a * p.y1) };
  }

  function leastSquaresSimilarity(pairs) {
    var n = pairs.length;
    var mx1 = 0, my1 = 0, mx2 = 0, my2 = 0;
    pairs.forEach(function (p) { mx1 += p.x1; my1 += p.y1; mx2 += p.x2; my2 += p.y2; });
    mx1 /= n; my1 /= n; mx2 /= n; my2 /= n;
    var Sxx = 0, Sxy = 0, Syy = 0;
    pairs.forEach(function (p) {
      var cx1 = p.x1 - mx1, cy1 = p.y1 - my1, cx2 = p.x2 - mx2, cy2 = p.y2 - my2;
      Sxx += cx1 * cx2 + cy1 * cy2;
      Sxy += cx1 * cy2 - cy1 * cx2;
      Syy += cx1 * cx1 + cy1 * cy1;
    });
    if (Syy < 1e-6) return null;
    var a = Sxx / Syy, b = Sxy / Syy;
    return { a: a, b: b, tx: mx2 - (a * mx1 - b * my1), ty: my2 - (b * mx1 + a * my1) };
  }

  function residuals(model, pairs) {
    return pairs.map(function (pr) {
      return Math.hypot(model.a * pr.x1 - model.b * pr.y1 + model.tx - pr.x2, model.b * pr.x1 + model.a * pr.y1 + model.ty - pr.y2);
    });
  }

  function inlierIdx(res, th) {
    var out = [];
    for (var i = 0; i < res.length; i++) if (res[i] < th) out.push(i);
    return out;
  }

  /**
   * Robust similarity fit over point pairs {x1,y1,x2,y2}: MSAC scoring (sum of truncated squared residuals, so
   * models with equal inlier counts are told apart by how well they fit), then local optimisation - refit on
   * the inliers and re-select them with a tighter threshold. Repetitive patterns (rows of identical squares)
   * otherwise let slightly-wrong models tie with the right one. Returns { T, inliers:[indices], score } or null.
   */
  Core.ransacSimilarity = function (pairs, inlierThresh, iterations) {
    var n = pairs.length;
    if (n < 2) return null;
    var th = inlierThresh || 6, th2 = th * th;
    iterations = iterations || 500;
    var best = null, bestCost = Infinity;
    for (var iter = 0; iter < iterations; iter++) {
      var i1 = Math.floor(Math.random() * n), i2 = Math.floor(Math.random() * n);
      if (i2 === i1) continue;
      var model = solveSimilarity2(pairs[i1], pairs[i2]);
      if (!model) continue;
      // a part can't really appear at half or double size - such models come from mismatches and, when they
      // collapse many points onto one spot, can out-score the true model on a noisy image
      var s = Math.hypot(model.a, model.b);
      if (s < 0.5 || s > 2) continue;
      var cost = 0;
      for (var i = 0; i < n; i++) {
        var pr = pairs[i];
        var dx = model.a * pr.x1 - model.b * pr.y1 + model.tx - pr.x2;
        var dy = model.b * pr.x1 + model.a * pr.y1 + model.ty - pr.y2;
        cost += Math.min(dx * dx + dy * dy, th2);
        if (cost >= bestCost) break;
      }
      if (cost < bestCost) { bestCost = cost; best = model; }
    }
    if (!best) return null;
    var T = best;
    [th, th, th / 2, th / 2].forEach(function (t) {
      var idx = inlierIdx(residuals(T, pairs), t);
      if (idx.length < 2) return;
      var refit = leastSquaresSimilarity(idx.map(function (i) { return pairs[i]; }));
      if (refit) T = refit;
    });
    var inl = inlierIdx(residuals(T, pairs), th);
    if (inl.length < 2) return null;
    return { T: T, inliers: inl, score: inl.length / n };
  };

  // ---------- calibration: image px -> robot mm ----------

  /** Least-squares 2D affine fit from >= 3 pairs {px,py,rx,ry} (allows the y-axis flip between image and robot frames). */
  Core.fitAffine = function (pairs) {
    if (!pairs || pairs.length < 3) return null;
    var m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], vx = [0, 0, 0], vy = [0, 0, 0];
    pairs.forEach(function (p) {
      var row = [p.px, p.py, 1];
      for (var i = 0; i < 3; i++) {
        for (var j = 0; j < 3; j++) m[i][j] += row[i] * row[j];
        vx[i] += row[i] * p.rx; vy[i] += row[i] * p.ry;
      }
    });
    var sx = solve3(m, vx), sy = solve3(m, vy);
    if (!sx || !sy) return null;
    var T = { a: sx[0], b: sx[1], c: sx[2], d: sy[0], e: sy[1], f: sy[2] };
    var se = 0;
    pairs.forEach(function (p) {
      var q = Core.applyAffine(T, { x: p.px, y: p.py });
      se += (q.x - p.rx) * (q.x - p.rx) + (q.y - p.ry) * (q.y - p.ry);
    });
    var det = T.a * T.e - T.b * T.d;
    T.rmsMm = Math.sqrt(se / pairs.length);
    T.mmPerPx = Math.sqrt(Math.abs(det));
    T.rotDeg = Math.atan2(T.d, T.a) * 180 / Math.PI;
    T.mirrored = det < 0;
    return T;
  };

  Core.applyAffine = function (T, p) {
    return { x: T.a * p.x + T.b * p.y + T.c, y: T.d * p.x + T.e * p.y + T.f };
  };

  // ---------- polygons / scanlines ----------

  Core.bbox = function (pts) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  Core.rectCenter = function (r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };

  Core.rotatePts = function (pts, rad, c) {
    var cs = Math.cos(rad), sn = Math.sin(rad);
    return pts.map(function (p) {
      var dx = p.x - c.x, dy = p.y - c.y;
      return { x: c.x + cs * dx - sn * dy, y: c.y + sn * dx + cs * dy };
    });
  };

  /** Even-odd inside intervals [[x0,x1],...] of a closed polygon on the horizontal line y. */
  function insideIntervals(poly, y) {
    var xs = [];
    for (var i = 0; i < poly.length; i++) {
      var p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
        xs.push(p1.x + (y - p1.y) / (p2.y - p1.y) * (p2.x - p1.x));
      }
    }
    xs.sort(function (a, b) { return a - b; });
    var out = [];
    for (var k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
    return out;
  }

  function unionIntervals(list) {
    var s = list.slice().sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    s.forEach(function (iv) {
      var last = out[out.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else out.push([iv[0], iv[1]]);
    });
    return out;
  }

  function subtractIntervals(base, cuts) {
    var out = [];
    base.forEach(function (b) {
      var pieces = [[b[0], b[1]]];
      cuts.forEach(function (c) {
        var next = [];
        pieces.forEach(function (p) {
          if (c[1] <= p[0] || c[0] >= p[1]) { next.push(p); return; }
          if (c[0] > p[0]) next.push([p[0], c[0]]);
          if (c[1] < p[1]) next.push([c[1], p[1]]);
        });
        pieces = next;
      });
      out = out.concat(pieces);
    });
    return out;
  }

  Core.pointInPolygon = function (poly, p) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };

  // ---------- spray program -> path ----------

  Core.DEFAULT_PROGRAM = {
    widthMm: 40, overlapPct: 50, edgeOffsetMm: -10, leadMm: 20, fillAngleDeg: 0,
    passes: [
      { type: 'edge', enabled: true, speed: 400, flow: 50 },
      { type: 'fill', enabled: true, speed: 400, flow: 100 },
      { type: 'cross', enabled: false, speed: 400, flow: 100 }
    ]
  };

  Core.cloneProgram = function (p) { return JSON.parse(JSON.stringify(p || Core.DEFAULT_PROGRAM)); };

  /** Spray width, raster spacing and lead length in image px for a program at the given calibration. */
  Core.programPx = function (program, mmPerPx) {
    var widthPx = program.widthMm / mmPerPx;
    return {
      widthPx: widthPx,
      spacingPx: Math.max(2, widthPx * (1 - program.overlapPct / 100)),
      leadPx: Math.max(0, program.leadMm / mmPerPx),
      edgeOffsetPx: program.edgeOffsetMm / mmPerPx
    };
  };

  /** Raster rows for one fill pass: gun on only inside the outline and outside every keep-out, with lead-in/out beyond the edge. */
  function fillRows(geom, angleDeg, spacing, lead) {
    var rad = angleDeg * Math.PI / 180;
    var c = Core.rectCenter(Core.bbox(geom.outline));
    var outline = Core.rotatePts(geom.outline, -rad, c);
    var keeps = (geom.keepOuts || []).map(function (k) { return Core.rotatePts(k, -rad, c); });
    var bb = Core.bbox(outline);
    var rows = [], leftToRight = true;
    for (var y = bb.y + spacing / 2; y < bb.y + bb.h; y += spacing) {
      var base = insideIntervals(outline, y);
      var cuts = unionIntervals([].concat.apply([], keeps.map(function (k) { return insideIntervals(k, y); })));
      var segs = subtractIntervals(base, cuts).filter(function (s) { return s[1] - s[0] > 1; });
      if (!segs.length) continue;
      var row = [];
      if (leftToRight) {
        row.push({ x: segs[0][0] - lead, y: y, on: false });
        segs.forEach(function (s) { row.push({ x: s[0], y: y, on: false }); row.push({ x: s[1], y: y, on: true }); });
        row.push({ x: segs[segs.length - 1][1] + lead, y: y, on: false });
      } else {
        row.push({ x: segs[segs.length - 1][1] + lead, y: y, on: false });
        for (var i = segs.length - 1; i >= 0; i--) { row.push({ x: segs[i][1], y: y, on: false }); row.push({ x: segs[i][0], y: y, on: true }); }
        row.push({ x: segs[0][0] - lead, y: y, on: false });
      }
      rows = rows.concat(row);
      leftToRight = !leftToRight;
    }
    var back = Core.rotatePts(rows, rad, c);
    return back.map(function (p, i) { return { x: p.x, y: p.y, on: rows[i].on }; });
  }

  /** Closed edge loop with a gun-off lead-in along the first edge, a short closing overlap, and a gun-off lead-out. */
  function edgeLoopPath(loop, lead, overlap) {
    if (!loop || loop.length < 3) return [];
    var p0 = loop[0], p1 = loop[1];
    var len = dist(p0, p1) || 1;
    var t = { x: (p1.x - p0.x) / len, y: (p1.y - p0.y) / len };
    var out = [{ x: p0.x - t.x * lead, y: p0.y - t.y * lead, on: false }, { x: p0.x, y: p0.y, on: false }];
    for (var i = 1; i < loop.length; i++) out.push({ x: loop[i].x, y: loop[i].y, on: true });
    out.push({ x: p0.x, y: p0.y, on: true });
    var ov = Math.min(overlap, len);
    var pe = { x: p0.x + t.x * ov, y: p0.y + t.y * ov };
    out.push({ x: pe.x, y: pe.y, on: true });
    out.push({ x: pe.x + t.x * lead, y: pe.y + t.y * lead, on: false });
    return out;
  }

  /** Splits gun-on segments into ~step px pieces and turns the gun off for pieces whose midpoint lies in a keep-out. */
  function gateByKeepOuts(points, keepOuts, step) {
    if (!keepOuts || !keepOuts.length) return points;
    var out = [points[0]];
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      if (!b.on) { out.push(b); continue; }
      var n = Math.max(1, Math.ceil(dist(a, b) / step));
      for (var k = 1; k <= n; k++) {
        var f0 = (k - 0.5) / n, f1 = k / n;
        var mid = { x: a.x + (b.x - a.x) * f0, y: a.y + (b.y - a.y) * f0 };
        var blocked = keepOuts.some(function (poly) { return Core.pointInPolygon(poly, mid); });
        out.push({ x: a.x + (b.x - a.x) * f1, y: a.y + (b.y - a.y) * f1, on: !blocked });
      }
    }
    // merge runs of collinear pieces with the same gun state back into single segments
    var merged = [out[0]];
    for (var j = 1; j < out.length; j++) {
      var prev = merged[merged.length - 1], p0 = merged[merged.length - 2], cur = out[j];
      if (p0 && prev.on === cur.on) {
        var cross = Math.abs((prev.x - p0.x) * (cur.y - p0.y) - (prev.y - p0.y) * (cur.x - p0.x));
        if (cross / (dist(p0, cur) || 1) < 0.05) { merged[merged.length - 1] = cur; continue; }
      }
      merged.push(cur);
    }
    return merged;
  }

  /**
   * Builds the full spray path. geom = { outline, edgeLoop, keepOuts } in image px (edgeLoop already offset,
   * keep-outs already grown by the spray radius). Each point: {x, y, on, speed (mm/s), flow (%), pass} where
   * `on` is the gun state while moving from the previous point to this one.
   */
  Core.generatePath = function (geom, program, mmPerPx) {
    var px = Core.programPx(program, mmPerPx);
    var points = [];
    program.passes.forEach(function (pass) {
      if (!pass.enabled) return;
      var seg;
      if (pass.type === 'edge') seg = gateByKeepOuts(edgeLoopPath(geom.edgeLoop || geom.outline, px.leadPx, px.widthPx / 2), geom.keepOuts, 3);
      else seg = fillRows(geom, program.fillAngleDeg + (pass.type === 'cross' ? 90 : 0), px.spacingPx, px.leadPx);
      seg.forEach(function (p, i) {
        points.push({ x: p.x, y: p.y, on: i === 0 ? false : p.on, speed: pass.speed, flow: pass.flow, pass: pass.type });
      });
    });
    return points;
  };

  Core.transformPath = function (points, T) {
    return points.map(function (p) {
      var q = Core.applySim(T, p);
      return { x: q.x, y: q.y, on: p.on, speed: p.speed, flow: p.flow, pass: p.pass };
    });
  };

  /** Path length, cycle time, gun-on time and paint used. Gun-off moves run at the pass speed too. */
  Core.pathStats = function (points, mmPerPx, gunMlPerMin) {
    var len = 0, onLen = 0, cycle = 0, onT = 0, ml = 0;
    for (var i = 1; i < points.length; i++) {
      var mm = dist(points[i - 1], points[i]) * mmPerPx;
      var t = mm / Math.max(1, points[i].speed);
      len += mm; cycle += t;
      if (points[i].on) { onLen += mm; onT += t; ml += t * (points[i].flow / 100) * gunMlPerMin / 60; }
    }
    return { lengthMm: len, onLengthMm: onLen, cycleS: cycle, onS: onT, paintMl: ml };
  };

  // ---------- paint deposition ----------

  /**
   * Samples the path every ~1 px: {x, y, amt, t}. amt is paint per sample (flow fraction x seconds), t the
   * time since start. defect = { from, to, factor } scales flow over that fraction of the gun-on length
   * (a clogged nozzle).
   */
  Core.buildSamples = function (points, mmPerPx, defect) {
    var onTotal = 0;
    for (var i = 1; i < points.length; i++) if (points[i].on) onTotal += dist(points[i - 1], points[i]);
    var samples = [], t = 0, onSoFar = 0;
    for (var j = 1; j < points.length; j++) {
      var a = points[j - 1], b = points[j];
      var L = dist(a, b);
      var n = Math.max(1, Math.ceil(L));
      var ds = L / n;
      var speedPx = Math.max(1, b.speed) / mmPerPx;
      for (var k = 1; k <= n; k++) {
        t += ds / speedPx;
        var amt = 0;
        if (b.on) {
          onSoFar += ds;
          amt = (b.flow / 100) * (ds / speedPx);
          if (defect && onTotal > 0) {
            var f = onSoFar / onTotal;
            if (f >= defect.from && f <= defect.to) amt *= defect.factor;
          }
        }
        samples.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, amt: amt, t: t, on: b.on });
      }
    }
    return samples;
  };

  /** A W x H film-density grid with `cell`-px cells. Paint from each sample is spread as a Gaussian (sigma px). */
  Core.DepositionGrid = function (W, H, cell, sigma) {
    this.cell = cell;
    this.nx = Math.ceil(W / cell);
    this.ny = Math.ceil(H / cell);
    this.data = new Float32Array(this.nx * this.ny);
    this.sigma = sigma;
    this.radius = Math.ceil(3 * sigma / cell);
    this.norm = 1 / (2 * Math.PI * sigma * sigma);
  };
  Core.DepositionGrid.prototype.deposit = function (s) {
    if (!s.amt) return;
    var c = this.cell, cx = Math.floor(s.x / c), cy = Math.floor(s.y / c), R = this.radius;
    var inv = 1 / (2 * this.sigma * this.sigma), k = s.amt * this.norm;
    for (var gy = Math.max(0, cy - R); gy <= Math.min(this.ny - 1, cy + R); gy++) {
      var dy = (gy + 0.5) * c - s.y;
      for (var gx = Math.max(0, cx - R); gx <= Math.min(this.nx - 1, cx + R); gx++) {
        var dx = (gx + 0.5) * c - s.x;
        this.data[gy * this.nx + gx] += k * Math.exp(-(dx * dx + dy * dy) * inv);
      }
    }
  };
  Core.DepositionGrid.prototype.reset = function () { this.data.fill(0); };

  /** Film density an endless raster of the program's fill passes would lay down - the "100 %" film reference. Null if no fill pass. */
  Core.nominalDensity = function (program, mmPerPx) {
    var px = Core.programPx(program, mmPerPx), total = 0;
    program.passes.forEach(function (p) {
      if (!p.enabled || p.type === 'edge') return;
      total += (p.flow / 100) / ((Math.max(1, p.speed) / mmPerPx) * px.spacingPx);
    });
    return total || null;
  };

  /**
   * Coverage metrics. masks.part / masks.keep are Uint8Array per grid cell (1 = inside). Film values are
   * reported as fractions of `nominal` (falls back to the median film on the part when there is no fill pass).
   */
  Core.coverageMetrics = function (grid, masks, nominal) {
    var partVals = [], total = 0, outside = 0, keep = 0;
    for (var i = 0; i < grid.data.length; i++) {
      var v = grid.data[i];
      total += v;
      if (masks.keep[i]) keep += v;
      else if (masks.part[i]) partVals.push(v);
      else outside += v;
    }
    if (!nominal) {
      var pos = partVals.filter(function (v) { return v > 0; });
      nominal = pos.length ? Core.percentile(pos, 0.5) : 1;
    }
    var rel = partVals.map(function (v) { return v / nominal; });
    var covered = rel.filter(function (r) { return r >= 0.5; }).length;
    var inSpec = rel.filter(function (r) { return r >= 0.8 && r <= 1.2; }).length;
    var m = Core.mean(rel);
    var sd = Math.sqrt(Core.mean(rel.map(function (r) { return (r - m) * (r - m); })));
    return {
      nominal: nominal,
      coveredPct: rel.length ? 100 * covered / rel.length : 0,
      inSpecPct: rel.length ? 100 * inSpec / rel.length : 0,
      meanRel: m,
      cvPct: m ? 100 * sd / m : 0,
      p5Rel: Core.percentile(rel, 0.05),
      p95Rel: Core.percentile(rel, 0.95),
      oversprayPct: total ? 100 * outside / total : 0,
      keepOutPct: total ? 100 * keep / total : 0,
      onPartPct: total ? 100 * (total - outside - keep) / total : 0
    };
  };

  /**
   * Diverging film ramp around the target (rel = film / nominal): blue arm = too thin, neutral grey band =
   * on target (80-120 %), red arm = too thick. No film is transparent so the photo shows through.
   */
  Core.filmColor = function (rel) {
    var stops = [
      [0.0, [16, 66, 129, 0]], [0.1, [16, 66, 129, 140]], [0.5, [57, 135, 229, 200]],
      [0.8, [195, 194, 183, 205]], [1.2, [195, 194, 183, 205]], [1.5, [230, 103, 103, 215]], [1.9, [208, 59, 59, 235]]
    ];
    if (rel <= 0) return stops[0][1];
    for (var i = 1; i < stops.length; i++) {
      if (rel <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], f = (rel - a[0]) / (b[0] - a[0]);
        return a[1].map(function (v, k) { return v + (b[1][k] - v) * f; });
      }
    }
    return stops[stops.length - 1][1];
  };

  // ---------- robot export ----------

  /** Maps image-px path points to robot mm: through the camera->robot affine when calibrated, else image axes x mm/px. */
  Core.toRobotPoints = function (points, station) {
    return points.map(function (p) {
      var q = station.camToRobot ? Core.applyAffine(station.camToRobot, p) : { x: p.x * station.mmPerPx, y: p.y * station.mmPerPx };
      return { x: q.x, y: q.y, z: station.standoffMm, on: p.on, speed: p.speed, flow: p.flow, pass: p.pass };
    });
  };

  /** Drops points where the gun state and speed don't change and the point is collinear-ish - robot programs stay short. */
  Core.compactRobotPoints = function (rp) {
    if (rp.length < 3) return rp;
    var out = [rp[0]];
    for (var i = 1; i < rp.length - 1; i++) {
      var a = out[out.length - 1], b = rp[i], c = rp[i + 1];
      var same = b.on === c.on && b.speed === c.speed && b.flow === c.flow;
      var cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      var base = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      if (same && cross / base < 0.05) continue;
      out.push(b);
    }
    out.push(rp[rp.length - 1]);
    return out;
  };

  function f3(v) { return (Math.round(v * 1000) / 1000).toFixed(3); }
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  Core.exportCSV = function (rp) {
    var lines = ['index,x_mm,y_mm,z_mm,gun_on,speed_mm_s,flow_pct,pass'];
    rp.forEach(function (p, i) { lines.push([i + 1, f3(p.x), f3(p.y), f3(p.z), p.on ? 1 : 0, p.speed, p.flow, p.pass].join(',')); });
    return lines.join('\n') + '\n';
  };

  /** Gun-state switches happen on arrival at a point: the segment into point i uses gun state points[i].on. */
  function gunChanges(rp, i) { return i === 0 ? rp[0].on : rp[i].on !== rp[i - 1].on; }

  Core.exportRapid = function (rp, meta) {
    var L = [];
    L.push('MODULE SprayPath');
    L.push('  ! Intelligent Spray demo export - ' + meta.title);
    L.push('  ! TEMPLATE: tool orientation, tool/wobj data and the gun output (doSprayGun) must be taught/verified on your cell.');
    L.push('  ! Gun flow % per segment is in comments - map it to your flow analog output if you have one.');
    L.push('  PERS tooldata tSprayGun := [TRUE,[[0,0,250],[1,0,0,0]],[2,[0,0,100],[1,0,0,0],0,0,0]];');
    L.push('  PROC main()');
    L.push('    SetDO doSprayGun, 0;');
    rp.forEach(function (p, i) {
      if (i > 0 && gunChanges(rp, i) && p.on) L.push('    SetDO doSprayGun, 1;  ! flow ' + p.flow + ' %');
      var target = '[[' + f1(p.x) + ',' + f1(p.y) + ',' + f1(p.z) + '],[0,0,1,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]';
      var move = i === 0 ? 'MoveJ ' : 'MoveL ';
      L.push('    ' + move + target + ', [' + p.speed + ',500,5000,1000], z1, tSprayGun;');
      if (i + 1 < rp.length && p.on && !rp[i + 1].on) L.push('    SetDO doSprayGun, 0;');
    });
    L.push('    SetDO doSprayGun, 0;');
    L.push('  ENDPROC');
    L.push('ENDMODULE');
    return L.join('\n') + '\n';
  };

  Core.exportKrl = function (rp, meta) {
    var L = [];
    L.push('DEF SprayPath()');
    L.push('; Intelligent Spray demo export - ' + meta.title);
    L.push('; TEMPLATE: A/B/C orientation, $TOOL/$BASE and the gun output $OUT[1] must be taught/verified on your cell.');
    L.push('BAS(#INITMOV, 0)');
    L.push('$OUT[1] = FALSE');
    var lastSpeed = null;
    rp.forEach(function (p, i) {
      if (i > 0 && gunChanges(rp, i)) L.push('$OUT[1] = ' + (p.on ? 'TRUE ; flow ' + p.flow + ' %' : 'FALSE'));
      if (p.speed !== lastSpeed) { L.push('$VEL.CP = ' + (p.speed / 1000).toFixed(3)); lastSpeed = p.speed; }
      var pos = '{X ' + f1(p.x) + ', Y ' + f1(p.y) + ', Z ' + f1(p.z) + ', A 0, B 90, C 0}';
      L.push((i === 0 ? 'PTP ' : 'LIN ') + pos + (i === 0 ? '' : ' C_DIS'));
    });
    L.push('$OUT[1] = FALSE');
    L.push('END');
    return L.join('\n') + '\n';
  };

  Core.exportFanuc = function (rp, meta) {
    var mn = [], pos = [], line = 0;
    function add(s) { line++; mn.push(('    ' + line).slice(-4) + ':  ' + s + ' ;'); }
    add('! ' + meta.title.replace(/[^\w .-]/g, '').slice(0, 30));
    add('DO[1:SPRAY GUN]=OFF');
    rp.forEach(function (p, i) {
      if (i > 0 && gunChanges(rp, i)) add('DO[1:SPRAY GUN]=' + (p.on ? 'ON' : 'OFF'));
      add((i === 0 ? 'J P[' + (i + 1) + '] 50%' : 'L P[' + (i + 1) + '] ' + p.speed + 'mm/sec') + ' CNT50');
      pos.push('P[' + (i + 1) + ']{\n   GP1:\n\tUF : 0, UT : 1,\t\tCONFIG : \'N U T, 0, 0, 0\',\n\tX = ' + f3(p.x) +
        '  mm,\tY = ' + f3(p.y) + '  mm,\tZ = ' + f3(p.z) + '  mm,\n\tW = 180.000 deg,\tP = 0.000 deg,\tR = 0.000 deg\n};');
    });
    add('DO[1:SPRAY GUN]=OFF');
    return ['/PROG  SPRAYPATH', '/ATTR', 'OWNER\t\t= MNEDITOR;', 'COMMENT\t\t= "ISD SPRAY DEMO";', 'PROG_SIZE\t= 0;',
      'FILE_NAME\t= ;', 'VERSION\t\t= 0;', 'LINE_COUNT\t= ' + line + ';', 'MEMORY_SIZE\t= 0;', 'PROTECT\t\t= READ_WRITE;',
      'TCD:  STACK_SIZE\t= 0,', '      TASK_PRIORITY\t= 50,', '      TIME_SLICE\t= 0,', '      BUSY_LAMP_OFF\t= 0,',
      '      ABORT_REQUEST\t= 0,', '      PAUSE_REQUEST\t= 0;', 'DEFAULT_GROUP\t= 1,*,*,*,*;', 'CONTROL_CODE\t= 00000000 00000000;',
      '/MN'].concat(mn).concat(['/POS']).concat(pos).concat(['/END']).join('\n') + '\n';
  };

  root.ISDCore = Core;
})(window);
