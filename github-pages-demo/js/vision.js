/* Intelligent Spray demo - image processing on OpenCV.js: contours, polygon offsets, recipe matching
   (ORB + RANSAC over one or more feature regions, with a rotation-searching template-match fallback),
   lighting/noise stress effects, and before/after paint detection for inspection. */
(function (root) {
  'use strict';

  var Core = root.ISDCore;
  var V = {};

  V.ready = function () { return typeof cv !== 'undefined' && !!cv.Mat; };

  /** Runs fn(track) and deletes every Mat/vector passed to track(), even if fn throws. */
  function withMats(fn) {
    var mats = [];
    function track(m) { mats.push(m); return m; }
    try { return fn(track); } finally { mats.forEach(function (m) { try { m.delete(); } catch (e) { } }); }
  }

  function contourToPoints(c) {
    var pts = [];
    for (var j = 0; j < c.data32S.length; j += 2) pts.push({ x: c.data32S[j], y: c.data32S[j + 1] });
    return pts;
  }

  function pointsToMat(points) {
    var flat = [];
    points.forEach(function (p) { flat.push(Math.round(p.x), Math.round(p.y)); });
    return cv.matFromArray(points.length, 1, cv.CV_32SC2, flat);
  }

  /**
   * Thresholds the canvas and returns contours (largest first): {points, area, rect, parent, isHole}. parent is
   * the index (in the returned list) of the outer contour a hole belongs to, or -1.
   */
  V.findContours = function (canvas, threshold, minArea) {
    return withMats(function (track) {
      var src = track(cv.imread(canvas));
      var gray = track(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      var bin = track(new cv.Mat());
      cv.threshold(gray, bin, threshold, 255, cv.THRESH_BINARY);
      var contours = track(new cv.MatVector());
      var hier = track(new cv.Mat());
      cv.findContours(bin, contours, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
      var raw = [];
      for (var i = 0; i < contours.size(); i++) {
        var c = contours.get(i);
        var area = cv.contourArea(c, false);
        var br = cv.boundingRect(c);
        raw.push({ orig: i, points: contourToPoints(c), area: area, rect: { x: br.x, y: br.y, w: br.width, h: br.height }, origParent: hier.data32S[i * 4 + 3] });
        c.delete();
      }
      var kept = raw.filter(function (r) { return r.area >= minArea; });
      kept.sort(function (a, b) { return b.area - a.area; });
      var indexOf = {};
      kept.forEach(function (r, i) { indexOf[r.orig] = i; });
      return kept.map(function (r) {
        var parent = r.origParent >= 0 && indexOf[r.origParent] !== undefined ? indexOf[r.origParent] : -1;
        return { points: r.points, area: r.area, rect: r.rect, parent: parent, isHole: r.origParent >= 0 };
      });
    });
  };

  V.simplify = function (points, eps) {
    if (points.length < 4) return points.slice();
    return withMats(function (track) {
      var m = track(pointsToMat(points));
      var out = track(new cv.Mat());
      cv.approxPolyDP(m, out, eps, true);
      return contourToPoints(out);
    });
  };

  /** Grows (d > 0) or shrinks (d < 0) a closed polygon by |d| px using a morphological dilate/erode of its mask. */
  V.offsetPolygon = function (points, d, W, H) {
    if (Math.abs(d) < 0.5) return V.simplify(points, 1);
    return withMats(function (track) {
      var mask = track(cv.Mat.zeros(H, W, cv.CV_8UC1));
      var vec = track(new cv.MatVector());
      var pm = track(pointsToMat(points));
      vec.push_back(pm);
      cv.fillPoly(mask, vec, new cv.Scalar(255));
      var r = Math.round(Math.abs(d));
      var k = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * r + 1, 2 * r + 1)));
      var out = track(new cv.Mat());
      if (d > 0) cv.dilate(mask, out, k); else cv.erode(mask, out, k);
      var contours = track(new cv.MatVector());
      var hier = track(new cv.Mat());
      cv.findContours(out, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      var best = null, bestArea = 0;
      for (var i = 0; i < contours.size(); i++) {
        var c = contours.get(i);
        var a = cv.contourArea(c, false);
        if (a > bestArea) { bestArea = a; best = contourToPoints(c); }
        c.delete();
      }
      return best ? V.simplify(best, 1) : [];
    });
  };

  function grayOf(canvas, clahe, track) {
    var src = track(cv.imread(canvas));
    var gray = track(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    if (!clahe) return gray;
    var eq = track(new cv.Mat());
    var cl = new cv.CLAHE(2.0, new cv.Size(8, 8));
    try { cl.apply(gray, eq); } finally { cl.delete(); }
    return eq;
  }

  function roundRect(r, W, H) {
    var x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
    return new cv.Rect(x, y, Math.max(2, Math.min(W - x, Math.round(r.w))), Math.max(2, Math.min(H - y, Math.round(r.h))));
  }

  /** ORB features from every feature region, matched into the current image and fitted with one RANSAC similarity. */
  function orbMatch(tGray, regions, cGray, track) {
    var minSide = Math.min.apply(null, regions.map(function (r) { return Math.min(r.w, r.h); }));
    var edge = Math.max(2, Math.min(15, Math.floor(minSide / 5)));
    var patch = Math.max(9, edge * 2 + 1);
    var orb = new cv.ORB(1500, 1.2, 8, edge, 0, 2, 0, patch, 5);
    var bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
    try {
      var empty = track(new cv.Mat());
      var kp2 = track(new cv.KeyPointVector()), desc2 = track(new cv.Mat());
      orb.detectAndCompute(cGray, empty, kp2, desc2);
      if (desc2.rows < 2) return { ok: false, err: 'prerun.matchTooFewFeatures' };
      var pairs = [], perRegion = regions.map(function () { return { pairs: 0, inliers: 0 }; });
      regions.forEach(function (fr, ri) {
        var rect = roundRect(fr, tGray.cols, tGray.rows);
        var crop = track(tGray.roi(rect));
        var kp1 = track(new cv.KeyPointVector()), desc1 = track(new cv.Mat());
        orb.detectAndCompute(crop, empty, kp1, desc1);
        if (desc1.rows < 2) return;
        var matches = track(new cv.DMatchVectorVector());
        bf.knnMatch(desc1, desc2, matches, 2);
        for (var i = 0; i < matches.size(); i++) {
          var m = matches.get(i);
          if (m.size() < 2) continue;
          var m0 = m.get(0), m1 = m.get(1);
          if (m0.distance < 0.85 * m1.distance) {
            var p1 = kp1.get(m0.queryIdx).pt, p2 = kp2.get(m0.trainIdx).pt;
            pairs.push({ x1: p1.x + rect.x, y1: p1.y + rect.y, x2: p2.x, y2: p2.y, region: ri });
            perRegion[ri].pairs++;
          }
        }
      });
      if (pairs.length < 4) return { ok: false, err: 'prerun.matchTooFewMatches', vars: { count: pairs.length } };
      var fit = Core.ransacSimilarity(pairs, 6, 500);
      // no inlier-ratio cut here: clutter (noise, mist, glare) adds false matches and lowers the ratio even when
      // dozens of matches agree - the station limits judge the result
      if (!fit || fit.inliers.length < 8) {
        return { ok: false, err: 'prerun.matchLowConfidence', vars: { inliers: fit ? fit.inliers.length : 0, score: fit ? fit.score.toFixed(2) : '0' } };
      }
      fit.inliers.forEach(function (i) { perRegion[pairs[i].region].inliers++; });
      return { ok: true, T: fit.T, inliers: fit.inliers.length, total: pairs.length, score: fit.score, method: 'orb', perRegion: perRegion };
    } finally { orb.delete(); bf.delete(); }
  }

  /** Best normalised cross-correlation of tpl in img rotated by each angle about center; optional search window. */
  function searchAngles(img, tpl, center, angles, win, track) {
    var best = null;
    var rot = track(new cv.Mat()), res = track(new cv.Mat()), empty = track(new cv.Mat());
    angles.forEach(function (ang) {
      var M = cv.getRotationMatrix2D(center, ang, 1);
      cv.warpAffine(img, rot, M, new cv.Size(img.cols, img.rows), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0));
      M.delete();
      var area = rot, ox = 0, oy = 0, sub = null;
      if (win) {
        ox = Math.max(0, Math.round(win.x)); oy = Math.max(0, Math.round(win.y));
        var w = Math.min(rot.cols - ox, Math.round(win.w)), h = Math.min(rot.rows - oy, Math.round(win.h));
        if (w < tpl.cols || h < tpl.rows) return;
        sub = rot.roi(new cv.Rect(ox, oy, w, h)); area = sub;
      }
      if (area.cols < tpl.cols || area.rows < tpl.rows) { if (sub) sub.delete(); return; }
      cv.matchTemplate(area, tpl, res, cv.TM_CCOEFF_NORMED, empty);
      var mm = cv.minMaxLoc(res);
      if (sub) sub.delete();
      if (!isFinite(mm.maxVal)) return;
      if (!best || mm.maxVal > best.val) best = { val: mm.maxVal, x: mm.maxLoc.x + ox, y: mm.maxLoc.y + oy, ang: ang };
    });
    return best;
  }

  function range(from, to, step) { var a = []; for (var v = from; v <= to + 1e-9; v += step) a.push(Math.round(v * 100) / 100); return a; }

  /** Coarse-to-fine (1/4 -> 1/2 -> full res) rotation + position search of the primary feature region. */
  function grayStdDev(m) {
    var c = m.clone(), d = c.data, s = 0, s2 = 0;
    for (var i = 0; i < d.length; i++) { s += d[i]; s2 += d[i] * d[i]; }
    c.delete();
    var mean = s / d.length;
    return Math.sqrt(Math.max(0, s2 / d.length - mean * mean));
  }

  function templateMatch(tGray, fr, cGray, track) {
    var rect = roundRect(fr, tGray.cols, tGray.rows);
    var tpl = track(tGray.roi(rect));
    // a featureless template correlates "perfectly" with any flat patch - refuse it
    if (grayStdDev(tpl) < 4) return { ok: false, err: 'prerun.matchTooFewFeatures' };
    var W = cGray.cols, H = cGray.rows, best = null;
    var levels = [{ f: 0.25, span: 45, step: 3, pad: null }, { f: 0.5, span: 3, step: 0.5, pad: 10 }, { f: 1, span: 0.5, step: 0.25, pad: 4 }];
    levels.forEach(function (L) {
      var img = cGray, t = tpl;
      if (L.f !== 1) {
        img = track(new cv.Mat()); t = track(new cv.Mat());
        cv.resize(cGray, img, new cv.Size(Math.round(W * L.f), Math.round(H * L.f)), 0, 0, cv.INTER_AREA);
        cv.resize(tpl, t, new cv.Size(Math.max(4, Math.round(rect.width * L.f)), Math.max(4, Math.round(rect.height * L.f))), 0, 0, cv.INTER_AREA);
      }
      var center = new cv.Point(W * L.f / 2, H * L.f / 2);
      var angles = best ? range(best.ang - L.span, best.ang + L.span, L.step) : range(-L.span, L.span, L.step);
      var win = best && L.pad ? { x: best.x * L.f - L.pad, y: best.y * L.f - L.pad, w: t.cols + 2 * L.pad, h: t.rows + 2 * L.pad } : null;
      var r = searchAngles(img, t, center, angles, win, track);
      if (r) best = { val: r.val, x: r.x / L.f, y: r.y / L.f, ang: r.ang };
    });
    if (!best) return { ok: false, err: 'prerun.matchTooFewFeatures' };
    // The match is in the current image rotated by OpenCV angle φ (counter-clockwise) about the centre, i.e. our
    // clockwise-positive θ = -φ; undoing it maps recipe point q to R(φ)·(q - fr + loc - C) + C.
    var th = best.ang * Math.PI / 180, a = Math.cos(th), b = Math.sin(th);
    var C = { x: W / 2, y: H / 2 };
    var vx = best.x - rect.x - C.x, vy = best.y - rect.y - C.y;
    var T = { a: a, b: b, tx: a * vx - b * vy + C.x, ty: b * vx + a * vy + C.y };
    return { ok: true, T: T, inliers: null, total: null, score: best.val, method: 'template', perRegion: null };
  }

  /**
   * Finds the recipe's feature regions in the current image. opts = { method: 'auto'|'orb'|'template', clahe }.
   * Returns { ok, T, thetaDeg, scale, inliers, total, score, method, perRegion } or { ok:false, err, vars }.
   */
  V.matchRecipe = function (templateCanvas, regions, currentCanvas, opts) {
    if (!regions || !regions.length) return { ok: false, err: 'prerun.matchNoFeatureRegion' };
    opts = opts || {};
    var res = withMats(function (track) {
      var tGray = grayOf(templateCanvas, opts.clahe, track);
      var cGray = grayOf(currentCanvas, opts.clahe, track);
      if (opts.method === 'template') return templateMatch(tGray, regions[0], cGray, track);
      var r = orbMatch(tGray, regions, cGray, track);
      if (opts.method === 'orb' || r.ok) return r;
      var tm = templateMatch(tGray, regions[0], cGray, track);
      return tm.ok && tm.score >= 0.5 ? tm : r;
    });
    if (res.ok) {
      res.thetaDeg = Math.atan2(res.T.b, res.T.a) * 180 / Math.PI;
      res.scale = Math.hypot(res.T.a, res.T.b);
    }
    return res;
  };

  /**
   * Independent check of a match: warps the current image back into the recipe frame with T and correlates the
   * primary feature region (normalised cross-correlation, -1..1). Comparable across recipes and methods, so it
   * is what part identification ranks by.
   */
  V.verifyMatch = function (templateCanvas, region, currentCanvas, T, clahe) {
    return withMats(function (track) {
      var tGray = grayOf(templateCanvas, clahe, track), cGray = grayOf(currentCanvas, clahe, track);
      var M = track(cv.matFromArray(2, 3, cv.CV_64F, [T.a, -T.b, T.tx, T.b, T.a, T.ty]));
      var back = track(new cv.Mat());
      cv.warpAffine(cGray, back, M, new cv.Size(tGray.cols, tGray.rows), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0));
      var rect = roundRect(region, tGray.cols, tGray.rows);
      var a = track(tGray.roi(rect)), b = track(back.roi(rect));
      if (grayStdDev(a) < 4 || grayStdDev(b) < 4) return 0;
      var res = track(new cv.Mat()), empty = track(new cv.Mat());
      cv.matchTemplate(b, a, res, cv.TM_CCOEFF_NORMED, empty);
      var v = res.data32F[0];
      return isFinite(v) ? v : 0;
    });
  };

  // ---------- stress effects (for robustness testing) ----------

  /** Gaussian-ish random number (sum of uniforms). */
  function randn() { return (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.7; }

  /**
   * Degrades the canvas in place. s = { brightness (-60..60 %), contrast (40..160 %), noise (σ, 0..40),
   * blur (px), glare (0..100), cover (0..100 % of coverQuad's width hidden by paint mist) }.
   */
  V.applyStress = function (canvas, s, coverQuad) {
    var ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    if (s.cover > 0 && coverQuad) {
      // covers the region from its right-hand side, like overspray mist or a hose drifting into view
      var f = s.cover / 100, q = coverQuad;
      var p1 = { x: q[1].x + (q[0].x - q[1].x) * f, y: q[1].y + (q[0].y - q[1].y) * f };
      var p2 = { x: q[2].x + (q[3].x - q[2].x) * f, y: q[2].y + (q[3].y - q[2].y) * f };
      ctx.save();
      ctx.fillStyle = 'rgba(120,128,140,0.96)';
      ctx.beginPath(); ctx.moveTo(q[1].x, q[1].y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(q[2].x, q[2].y); ctx.closePath();
      ctx.fill(); ctx.restore();
    }
    if (s.glare > 0) {
      var gx = W * (0.25 + Math.random() * 0.5), gy = H * (0.25 + Math.random() * 0.5), gr = Math.max(W, H) * 0.35;
      var g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, 'rgba(255,255,245,' + (0.9 * s.glare / 100) + ')');
      g.addColorStop(1, 'rgba(255,255,245,0)');
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    var gain = (s.contrast || 100) / 100, off = (s.brightness || 0) * 2.55, noise = s.noise || 0;
    if (gain !== 1 || off !== 0 || noise > 0) {
      var img = ctx.getImageData(0, 0, W, H), d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var n = noise ? randn() * noise : 0;
        for (var k = 0; k < 3; k++) d[i + k] = (d[i + k] - 128) * gain + 128 + off + n;
      }
      ctx.putImageData(img, 0, 0);
    }
    if (s.blur > 0 && V.ready()) {
      withMats(function (track) {
        var m = track(cv.imread(canvas)), o = track(new cv.Mat());
        var k = Math.max(1, Math.round(s.blur)) * 2 + 1;
        cv.GaussianBlur(m, o, new cv.Size(k, k), s.blur, s.blur, cv.BORDER_DEFAULT);
        cv.imshow(canvas, o);
      });
    }
  };

  // ---------- inspection ----------

  /**
   * Paint opacity per grid cell from a before/after photo pair and the paint colour: each pixel's change is
   * projected onto (paint - before), giving 0 = bare .. 1 = fully hidden by paint. Where the surface is
   * already close to the paint colour the opacity can't be measured; those cells are -1.
   */
  V.paintOpacity = function (before, after, paintRgb, cell, nx, ny) {
    var W = before.width, H = before.height;
    var a = before.getContext('2d').getImageData(0, 0, W, H).data;
    var b = after.getContext('2d').getImageData(0, 0, W, H).data;
    var sum = new Float32Array(nx * ny), known = new Uint16Array(nx * ny), cnt = new Uint16Array(nx * ny);
    for (var y = 0; y < H; y++) {
      var gy = Math.min(ny - 1, Math.floor(y / cell));
      for (var x = 0; x < W; x++) {
        var i = (y * W + x) * 4, gi = gy * nx + Math.min(nx - 1, Math.floor(x / cell));
        cnt[gi]++;
        var p0 = paintRgb[0] - a[i], p1 = paintRgb[1] - a[i + 1], p2 = paintRgb[2] - a[i + 2];
        var pp = p0 * p0 + p1 * p1 + p2 * p2;
        if (pp < 900) continue;
        var al = ((b[i] - a[i]) * p0 + (b[i + 1] - a[i + 1]) * p1 + (b[i + 2] - a[i + 2]) * p2) / pp;
        sum[gi] += Math.max(0, Math.min(1.2, al));
        known[gi]++;
      }
    }
    var out = new Float32Array(nx * ny);
    for (var j = 0; j < out.length; j++) out[j] = known[j] * 2 >= cnt[j] && known[j] ? sum[j] / known[j] : -1;
    return out;
  };

  root.ISDVision = V;
})(window);
