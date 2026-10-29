(function () {
  'use strict';

  var Core = window.ISDCore, Vision = window.ISDVision;

  // ---------- i18n ----------

  var LANG_KEY = 'ispDemoLang';
  var ASSET_VERSION = '8'; // keep in sync with the ?v= on index.html's css/js links and version.json; bump on every change

  // ---------- stale-page check ----------
  // GitHub Pages lets browsers reuse a cached index.html for ~10 minutes after a deploy, which keeps
  // loading the old scripts. version.json is fetched past the cache; if it is newer than this script,
  // reload once from a URL carrying the new version, which the browser has never cached.
  (function checkForNewVersion() {
    if (!window.fetch || location.protocol === 'file:') return;
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
      var latest = v && String(v.version);
      if (!latest || latest === ASSET_VERSION) return;
      var params = new URLSearchParams(location.search);
      if (params.get('v') === latest) return; // already reloaded for this version - never loop
      params.set('v', latest);
      location.replace(location.pathname + '?' + params.toString() + location.hash);
    }).catch(function () { });
  })();
  var dictionaries = {};
  var currentLang = 'en';
  try {
    currentLang = localStorage.getItem(LANG_KEY) || ((navigator.language || '').indexOf('zh') === 0 ? 'zh-TW' : 'en');
  } catch (e) { }

  function t(key, vars) {
    var dict = dictionaries[currentLang] || {};
    var str = dict[key] || (dictionaries.en && dictionaries.en[key]) || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        var v = vars[k];
        if (v && typeof v === 'object' && v.k) v = t(v.k, v.vars);
        str = str.split('{' + k + '}').join(v);
      });
    }
    return str;
  }

  function loadDictionaries() {
    return Promise.all([
      fetch('i18n/en.json?v=' + ASSET_VERSION).then(function (r) { return r.json(); }),
      fetch('i18n/zh-TW.json?v=' + ASSET_VERSION).then(function (r) { return r.json(); })
    ]).then(function (results) {
      dictionaries.en = results[0];
      dictionaries['zh-TW'] = results[1];
    }).catch(function (err) {
      console.error('Failed to load i18n dictionaries, falling back to raw keys:', err);
    });
  }

  Promise.all([loadDictionaries(), window.ISDStore.open()]).then(function (r) { startApp(r[1]); });

  function startApp(store) {

  var W = 560, H = 360;
  var CX = W / 2, CY = H / 2;
  var GRID_CELL = 2;

  // ---------- small helpers ----------

  function $(id) { return document.getElementById(id); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function fmt(v, d) { return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function fmtSigned(v, d) { return (v >= 0 ? '+' : '') + fmt(v, d); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /** Sets a translated status line and remembers key/vars so a language switch can re-translate it. */
  var statusEls = [];
  function setStatus(el, key, vars, cls) {
    el._st = { key: key, vars: vars, cls: cls };
    if (statusEls.indexOf(el) === -1) statusEls.push(el);
    el.textContent = key ? t(key, vars) : '';
    if (el.classList.contains('status-line') || el._isStatusLine) {
      el._isStatusLine = true;
      el.className = 'status-line' + (cls ? ' ' + cls : '');
    }
    // every meaningful state change reports a status, so this keeps the step bar's done marks current
    if (wizardReady) renderStepper();
  }
  var wizardReady = false;

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function safeName(s) { return String(s).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'recipe'; }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  function loadFileAsImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () { loadImage(reader.result).then(cb); };
    reader.readAsDataURL(file);
  }

  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w || W; c.height = h || H; return c; }

  function fitImageIntoCanvas(img, canvas) {
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a2130';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    var dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  }

  /** Draws img fitted into W x H, then moved by (shiftX, shiftY), rotated by rotateDeg and scaled about the canvas centre. */
  function drawShiftedImage(ctx, img, shiftX, shiftY, rotateDeg, scale) {
    ctx.fillStyle = '#1a2130';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(CX + shiftX, CY + shiftY);
    ctx.rotate(rotateDeg * Math.PI / 180);
    ctx.scale(scale || 1, scale || 1);
    ctx.translate(-CX, -CY);
    var s = Math.min(W / img.width, H / img.height);
    var dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
  }

  /** The image transform drawShiftedImage applies, as a similarity {a,b,tx,ty}. */
  function shiftTransform(sx, sy, rotDeg, scale) {
    var r = rotDeg * Math.PI / 180, a = scale * Math.cos(r), b = scale * Math.sin(r);
    return { a: a, b: b, tx: CX + sx - (a * CX - b * CY), ty: CY + sy - (b * CX + a * CY) };
  }

  function rectQuad(r) { return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]; }
  function rectPoly(r) { return rectQuad(r); }

  // ---------- synthetic workpiece photos ----------

  function drawWorkpieceA(ctx) {
    var partW = 320, partH = 200;
    var px = (W - partW) / 2, py = (H - partH) / 2;
    ctx.fillStyle = '#c7cedd';
    ctx.fillRect(px, py, partW, partH);
    ctx.strokeStyle = '#5a6478';
    ctx.lineWidth = 3;
    ctx.strokeRect(px, py, partW, partH);
    var cols = 8, rows = 5, cw = partW / cols, ch = partH / rows;
    var colors = ['#4fd1c5', '#f6ad55', '#68d391', '#fc8181', '#63b3ed', '#b794f4'];
    var ci = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if ((r * cols + c) % 3 === 0) {
          ctx.fillStyle = colors[ci % colors.length];
          ci++;
          var rx = px + c * cw + cw * 0.25, ry = py + r * ch + ch * 0.25;
          ctx.fillRect(rx, ry, cw * 0.5, ch * 0.5);
          ctx.strokeStyle = '#2a3550';
          ctx.lineWidth = 1;
          ctx.strokeRect(rx, ry, cw * 0.5, ch * 0.5);
        }
      }
    }
    // distinctive asymmetric marker - the natural extra feature region
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(px + 10, py + 10, 46, 46);
    ctx.fillStyle = '#fc8181';
    ctx.beginPath();
    ctx.arc(px + 24, py + 24, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('A1', px + 28, py + 50);
  }

  function drawWorkpieceB(ctx) {
    var o = { x: CX, y: CY };
    var L = [[-150, -100], [150, -100], [150, -20], [-60, -20], [-60, 100], [-150, 100]];
    ctx.fillStyle = '#d6c9a8';
    ctx.strokeStyle = '#6b5f45';
    ctx.lineWidth = 3;
    ctx.beginPath();
    L.forEach(function (p, i) { if (i === 0) ctx.moveTo(o.x + p[0], o.y + p[1]); else ctx.lineTo(o.x + p[0], o.y + p[1]); });
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // texture: weld seams and bolts give the matcher something to lock on to
    ctx.strokeStyle = '#9c8c66'; ctx.lineWidth = 2;
    for (var i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(o.x - 40 + i * 30, o.y - 92); ctx.lineTo(o.x - 25 + i * 30, o.y - 30); ctx.stroke(); }
    ctx.fillStyle = '#7d6f50';
    [[-130, -5], [-80, -5], [-130, 40], [-80, 40], [-105, 80], [20, -60], [60, -40], [120, -80]].forEach(function (p) {
      ctx.beginPath(); ctx.arc(o.x + p[0], o.y + p[1], 5, 0, Math.PI * 2); ctx.fill();
    });
    // through-holes (background shows through - they become keep-outs)
    ctx.fillStyle = '#3a4358';
    [[95, -60, 18], [-105, 62, 16]].forEach(function (h) { ctx.beginPath(); ctx.arc(o.x + h[0], o.y + h[1], h[2], 0, Math.PI * 2); ctx.fill(); });
    // marker
    ctx.fillStyle = '#1a1f2e';
    ctx.beginPath(); ctx.moveTo(o.x - 140, o.y - 90); ctx.lineTo(o.x - 85, o.y - 90); ctx.lineTo(o.x - 140, o.y - 35); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('B2', o.x - 134, o.y - 70);
  }

  function makeWorkpieceCanvas(variant) {
    var c = makeCanvas();
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#3a4358';
    ctx.fillRect(0, 0, W, H);
    if (variant === 'B') drawWorkpieceB(ctx); else drawWorkpieceA(ctx);
    return c;
  }

  // ---------- DOM refs ----------

  var runDemoBtn = $('runDemoBtn') || document.createElement('button');

  var combineCanvas = $('combineCanvas'), combineCtx = combineCanvas.getContext('2d');
  var combineFeatureStrip = $('combineFeatureStrip');
  var sampleSelect = $('sampleSelect');
  var combineImageUpload = $('combineImageUpload');
  var resetSyntheticImageBtn = $('resetSyntheticImageBtn');
  var combineContourThreshold = $('combineContourThreshold'), combineThresholdVal = $('combineThresholdVal');
  var combineMinArea = $('combineMinArea'), combineMinAreaVal = $('combineMinAreaVal');
  var combineFindContoursBtn = $('combineFindContoursBtn');
  var combineContourList = $('combineContourList');
  var pathPointSizeInput = $('pathPointSizeInput'), pathPointSizeVal = $('pathPointSizeVal');
  var pathLineWidthInput = $('pathLineWidthInput'), pathLineWidthVal = $('pathLineWidthVal');
  var programStats = $('programStats');
  var recipeNameInput = $('recipeNameInput');
  var saveRecipeBtn = $('saveRecipeBtn');
  var combineRecipeSelect = $('combineRecipeSelect');
  var combineLoadRecipeBtn = $('combineLoadRecipeBtn');
  var combineDeleteRecipeBtn = $('combineDeleteRecipeBtn');
  var combineStatus = $('combineStatus');

  var preRunRecipeCanvas = $('preRunRecipeCanvas'), preRunRecipeCtx = preRunRecipeCanvas.getContext('2d');
  var preRunFeatureStatus = $('preRunFeatureStatus');
  var preRunRecipeSelect = $('preRunRecipeSelect');
  var preRunLoadRecipeBtn = $('preRunLoadRecipeBtn');
  var identifyBtn = $('identifyBtn'), identifyResult = $('identifyResult');
  var simShiftX = $('simShiftX'), simShiftXVal = $('simShiftXVal');
  var simShiftY = $('simShiftY'), simShiftYVal = $('simShiftYVal');
  var simRotate = $('simRotate'), simRotateVal = $('simRotateVal');
  var simScale = $('simScale'), simScaleVal = $('simScaleVal');
  var randomizeShiftBtn = $('randomizeShiftBtn');
  var uploadCurrentInput = $('uploadCurrentInput');
  var matchBtn = $('matchBtn'), confirmPathBtn = $('confirmPathBtn');
  var matchStatus = $('matchStatus');
  var matchResultBox = $('matchResultBox');
  var revealGroundTruthBtn = $('revealGroundTruthBtn'), groundTruthBox = $('groundTruthBox');
  var verdictBox = $('verdictBox'), verdictBanner = $('verdictBanner'), verdictChecks = $('verdictChecks'), overrideBtn = $('overrideBtn');

  var resultCanvas = $('resultCanvas'), resultCtx = resultCanvas.getContext('2d');
  var simColorInput = $('simColorInput');
  var simOpacityInput = $('simOpacityInput'), simOpacityVal = $('simOpacityVal');
  var simPlayback = $('simPlayback'), simPlaybackVal = $('simPlaybackVal');
  var simClog = $('simClog');
  var simPlayBtn = $('simPlayBtn'), simStopBtn = $('simStopBtn'), simInstantBtn = $('simInstantBtn');
  var simStatus = $('simStatus');
  var metricsBox = $('metricsBox');
  var filmLegend = $('filmLegend'), pathLegend = $('pathLegend');
  var exportBtns = Array.prototype.slice.call(document.querySelectorAll('.export-btn'));

  var inspectCanvas = $('inspectCanvas'), inspectCtx = inspectCanvas.getContext('2d');
  var inspectSimBtn = $('inspectSimBtn'), inspectUpload = $('inspectUpload'), inspectRunBtn = $('inspectRunBtn');
  var inspectThresh = $('inspectThresh'), inspectThreshVal = $('inspectThreshVal');
  var inspectVerdict = $('inspectVerdict'), inspectStats = $('inspectStats'), inspectStatus = $('inspectStatus');

  [combineStatus, matchStatus, simStatus, inspectStatus, groundTruthBox].forEach(function (el) { el._isStatusLine = true; });

  if (!store.persistent) setStatus($('storageNote'), 'app.storageMemory');

  // ---------- station setup ----------

  var DEFAULT_STATION = {
    mmPerPx: 1.25,
    camToRobot: null,
    calibPairs: [
      { px: 60, py: 60, rx: 875, ry: 375 }, { px: 500, py: 60, rx: 1425, ry: 375 }, { px: 60, py: 300, rx: 875, ry: 75 }
    ],
    tol: { maxShiftMm: 100, maxRotDeg: 40, maxScalePct: 4, minScorePct: 20, minInliers: 12, minVerify: 0.4, accuracyMm: 2 },
    match: { method: 'auto', clahe: false },
    gunMlPerMin: 300,
    standoffMm: 200,
    targetFilmUm: 60
  };
  var station = JSON.parse(JSON.stringify(DEFAULT_STATION));

  function saveStation() { store.putSetting('station', station).catch(function (e) { console.error(e); }); }

  var stationFields = [
    ['mmPerPxInput', function () { return station.mmPerPx; }, function (v) { station.mmPerPx = Math.max(0.001, num(v, station.mmPerPx)); }],
    ['tolShift', function () { return station.tol.maxShiftMm; }, function (v) { station.tol.maxShiftMm = num(v, 100); }],
    ['tolRot', function () { return station.tol.maxRotDeg; }, function (v) { station.tol.maxRotDeg = num(v, 40); }],
    ['tolScale', function () { return station.tol.maxScalePct; }, function (v) { station.tol.maxScalePct = num(v, 4); }],
    ['tolScore', function () { return station.tol.minScorePct; }, function (v) { station.tol.minScorePct = num(v, 20); }],
    ['tolInliers', function () { return station.tol.minInliers; }, function (v) { station.tol.minInliers = num(v, 12); }],
    ['tolVerify', function () { return station.tol.minVerify; }, function (v) { station.tol.minVerify = num(v, 0.4); }],
    ['tolAccuracy', function () { return station.tol.accuracyMm; }, function (v) { station.tol.accuracyMm = num(v, 2); }],
    ['gunFlow', function () { return station.gunMlPerMin; }, function (v) { station.gunMlPerMin = Math.max(1, num(v, 300)); }],
    ['standoff', function () { return station.standoffMm; }, function (v) { station.standoffMm = num(v, 200); }],
    ['targetFilm', function () { return station.targetFilmUm; }, function (v) { station.targetFilmUm = Math.max(1, num(v, 60)); }]
  ];

  function fillStationInputs() {
    stationFields.forEach(function (f) { $(f[0]).value = f[1](); });
    $('matchMethod').value = station.match.method;
    $('claheInput').checked = !!station.match.clahe;
    renderPairs();
    renderCalibStatus();
  }

  stationFields.forEach(function (f) {
    $(f[0]).addEventListener('change', function () {
      f[2]($(f[0]).value);
      if (f[0] === 'mmPerPxInput') station.camToRobot = null; // a manual scale replaces the point-pair alignment
      saveStation();
      onStationChanged(f[0]);
    });
  });
  $('matchMethod').addEventListener('change', function () { station.match.method = $('matchMethod').value; saveStation(); });
  $('claheInput').addEventListener('change', function () { station.match.clahe = $('claheInput').checked; saveStation(); });

  /** Calibration changes the px size of mm-based program values, so the combine path is rebuilt; everything else just re-renders. */
  function onStationChanged(field) {
    renderCalibStatus();
    if (field === 'mmPerPxInput' || field === 'calib') {
      $('mmPerPxInput').value = fmt(station.mmPerPx, 4);
      regenerateCombinePath();
    }
    renderProgramStats();
    renderExportHint();
    if (applied && applied.metrics) renderMetrics();
    renderFilmLegend();
    renderLog();
  }

  function renderCalibStatus() {
    var el = $('calibStatus');
    if (station.camToRobot) {
      var c = station.camToRobot;
      setStatus(el, 'setup.calibAligned', { mm: fmt(c.mmPerPx, 4), rot: fmt(c.rotDeg, 2), rms: fmt(c.rmsMm, 2), flip: { k: c.mirrored ? 'setup.flipYes' : 'setup.flipNo' } }, 'ok');
    } else {
      setStatus(el, 'setup.calibScaleOnly', { mm: fmt(station.mmPerPx, 4) });
    }
  }

  function renderPairs() {
    var body = $('pairsBody');
    body.innerHTML = '';
    station.calibPairs.forEach(function (p, i) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><div class="pair-cell"><input type="number" data-k="px" value="' + p.px + '"><input type="number" data-k="py" value="' + p.py + '"></div></td>' +
        '<td><div class="pair-cell"><input type="number" data-k="rx" value="' + p.rx + '"><input type="number" data-k="ry" value="' + p.ry + '"></div></td>' +
        '<td><button class="secondary" style="padding:3px 8px;">×</button></td>';
      Array.prototype.forEach.call(tr.querySelectorAll('input'), function (inp) {
        inp.addEventListener('change', function () { p[inp.getAttribute('data-k')] = num(inp.value, 0); saveStation(); });
      });
      tr.querySelector('button').addEventListener('click', function () { station.calibPairs.splice(i, 1); saveStation(); renderPairs(); });
      body.appendChild(tr);
    });
  }

  $('addPairBtn').addEventListener('click', function () { station.calibPairs.push({ px: 0, py: 0, rx: 0, ry: 0 }); saveStation(); renderPairs(); });
  $('fitPairsBtn').addEventListener('click', function () {
    var fit = Core.fitAffine(station.calibPairs);
    if (!fit) { setStatus($('calibStatus'), 'setup.calibFitFailed', null, 'err'); return; }
    station.camToRobot = fit;
    station.mmPerPx = fit.mmPerPx;
    saveStation();
    onStationChanged('calib');
  });
  $('clearAlignBtn').addEventListener('click', function () { station.camToRobot = null; saveStation(); onStationChanged('calib'); });
  $('knownSizeBtn').addEventListener('click', function () {
    var mm = num($('knownSizeInput').value, 0);
    var c = combineContours[combinePrimary];
    if (!c) { setStatus($('calibStatus'), 'setup.calibNeedContour', null, 'err'); return; }
    if (mm <= 0) { setStatus($('calibStatus'), 'setup.calibNeedSize', null, 'err'); return; }
    station.mmPerPx = mm / c.rect.w;
    station.camToRobot = null;
    saveStation();
    onStationChanged('calib');
  });

  // ---------- recipes ----------

  var recipes = {}; // name -> recipe (v2)

  /** Brings recipes saved by older versions of the demo (tiles / single featureRegion) into the v2 shape. */
  function normalizeRecipe(r) {
    if (r.v === 2) return r;
    var path = [];
    (r.tiles || []).forEach(function (tile) {
      var pts = tile.preset === 'contour' ? tile.points : [];
      pts.forEach(function (p, i) { path.push({ x: p.x, y: p.y, on: i > 0, speed: 300, flow: 100, pass: 'legacy' }); });
      if (tile.preset === 'contour' && tile.closed !== false && pts.length) path.push({ x: pts[0].x, y: pts[0].y, on: true, speed: 300, flow: 100, pass: 'legacy' });
    });
    return {
      v: 2, name: r.name, image: r.image, contours: [], primary: -1, features: [], keeps: [],
      featureRegions: r.featureRegion ? [r.featureRegion] : [], outline: null, keepOuts: [],
      program: null, path: path, created: Date.now(), updated: Date.now()
    };
  }

  function recipeNames() { return Object.keys(recipes).sort(function (a, b) { return a.localeCompare(b); }); }

  function refreshRecipeSelects() {
    var names = recipeNames();
    [combineRecipeSelect, preRunRecipeSelect].forEach(function (sel) {
      var prev = sel.value;
      sel.innerHTML = '';
      if (names.length === 0) {
        var opt = document.createElement('option');
        opt.textContent = t('combine.noSavedRecipes');
        opt.disabled = true;
        sel.appendChild(opt);
      } else {
        names.forEach(function (n) {
          var opt = document.createElement('option');
          opt.value = n; opt.textContent = n;
          sel.appendChild(opt);
        });
        if (names.indexOf(prev) !== -1) sel.value = prev;
      }
    });
  }

  function persistRecipe(rec) {
    recipes[rec.name] = rec;
    return store.putRecipe(rec).then(function () { return true; }, function (e) {
      console.error('Saving recipe failed:', e);
      setStatus(combineStatus, 'combine.statusStorageFull', null, 'err');
      return false;
    });
  }

  // ---------- path drawing ----------

  function currentPathLineWidth() { return num(pathLineWidthInput.value, 2); }
  function currentPathPointSize() { return num(pathPointSizeInput.value, 2); }

  /** Draws a spray path: gun-on segments solid in `color`, gun-off moves as a thin dotted line. */
  function drawProgramPath(ctx, pts, opts) {
    if (!pts || pts.length < 2) return;
    opts = opts || {};
    var on = new Path2D(), off = new Path2D();
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i - 1], q = pts[i], target = q.on ? on : off;
      target.moveTo(p.x, p.y); target.lineTo(q.x, q.y);
    }
    ctx.save();
    ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (opts.showOff !== false) {
      ctx.strokeStyle = '#93a0bd'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.stroke(off);
    }
    ctx.strokeStyle = opts.color || '#63b3ed';
    ctx.lineWidth = opts.width || currentPathLineWidth();
    ctx.setLineDash(opts.dashed ? [6, 5] : []);
    ctx.stroke(on);
    var ps = opts.pointSize == null ? currentPathPointSize() : opts.pointSize;
    if (ps > 0) {
      ctx.setLineDash([]);
      ctx.fillStyle = opts.color || '#63b3ed';
      pts.forEach(function (p, i) {
        if (!p.on && !(pts[i + 1] && pts[i + 1].on)) return;
        ctx.beginPath(); ctx.arc(p.x, p.y, ps, 0, Math.PI * 2); ctx.fill();
      });
    }
    ctx.restore();
  }

  function strokePoly(ctx, pts, color, width, dash, fill) {
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.beginPath();
    pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    ctx.stroke();
    ctx.restore();
  }

  function drawRegion(ctx, r, color) {
    ctx.save();
    ctx.strokeStyle = color || '#f6ad55';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  /** Small native-size crops of each feature region, under the canvas. */
  function renderFeatureStrip(strip, source, regions) {
    strip.innerHTML = '';
    (regions || []).forEach(function (r, i) {
      if (r.w < 2 || r.h < 2) return;
      var fig = document.createElement('figure');
      var c = makeCanvas(Math.round(r.w), Math.round(r.h));
      c.getContext('2d').drawImage(source, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      var cap = document.createElement('figcaption');
      cap.textContent = t(i === 0 ? 'combine.featureMain' : 'combine.featureExtra', { n: i + 1 }) + ' · ' + Math.round(r.w) + '×' + Math.round(r.h);
      fig.appendChild(c); fig.appendChild(cap);
      strip.appendChild(fig);
    });
  }

  // ---------- combine state ----------

  var combineRefCanvas = makeWorkpieceCanvas('A');
  var combineContours = [];       // from Vision.findContours (or restored from a recipe)
  var combinePrimary = -1;        // index of the part outline
  var combineFeatures = [];       // extra feature-region contour indices
  var combineKeeps = [];          // keep-out contour indices
  var combineProgram = Core.cloneProgram();
  var combinePath = [];
  var combineGeom = null;

  function combineFeatureRegions() {
    if (combinePrimary < 0) return [];
    var list = [combineContours[combinePrimary].rect];
    combineFeatures.forEach(function (i) { if (i !== combinePrimary && combineContours[i]) list.push(combineContours[i].rect); });
    return list;
  }

  function combineResetLayout(statusKey) {
    combineContours = []; combinePrimary = -1; combineFeatures = []; combineKeeps = [];
    combinePath = []; combineGeom = null;
    renderCombineContourList();
    renderCombineCanvas();
    renderProgramStats();
    if (statusKey) setStatus(combineStatus, statusKey);
  }

  /** Default roles after finding contours: the largest outer contour is the part; its sizeable holes are keep-outs. */
  function assignDefaultRoles() {
    combinePrimary = -1; combineFeatures = []; combineKeeps = [];
    for (var i = 0; i < combineContours.length; i++) if (!combineContours[i].isHole) { combinePrimary = i; break; }
    if (combinePrimary < 0) return;
    var minKeep = combineContours[combinePrimary].area * 0.01;
    combineContours.forEach(function (c, i) {
      if (c.isHole && c.parent === combinePrimary && c.area >= minKeep) combineKeeps.push(i);
    });
  }

  /** Rebuilds the spray path from the outline, keep-outs and program (needs OpenCV for the polygon offsets). */
  function regenerateCombinePath() {
    combinePath = []; combineGeom = null;
    if (combinePrimary < 0 || !Vision.ready()) { renderCombineCanvas(); renderProgramStats(); return; }
    var px = Core.programPx(combineProgram, station.mmPerPx);
    var outline = Vision.simplify(combineContours[combinePrimary].points, 1);
    var edgeLoop = Vision.offsetPolygon(outline, px.edgeOffsetPx, W, H);
    var keepOuts = combineKeeps.map(function (i) { return Vision.offsetPolygon(combineContours[i].points, px.widthPx / 2, W, H); })
      .filter(function (k) { return k.length >= 3; });
    combineGeom = { outline: outline, edgeLoop: edgeLoop.length >= 3 ? edgeLoop : outline, keepOuts: keepOuts };
    combinePath = Core.generatePath(combineGeom, combineProgram, station.mmPerPx);
    renderCombineCanvas();
    renderProgramStats();
  }

  function renderCombineCanvas() {
    combineCtx.clearRect(0, 0, W, H);
    combineCtx.drawImage(combineRefCanvas, 0, 0);
    combineContours.forEach(function (c, i) {
      if (i === combinePrimary || combineKeeps.indexOf(i) !== -1) return;
      strokePoly(combineCtx, c.points, '#68d391', 1);
    });
    combineKeeps.forEach(function (i) { strokePoly(combineCtx, combineContours[i].points, '#fc8181', 2, null, 'rgba(252,129,129,0.28)'); });
    if (combinePrimary >= 0) strokePoly(combineCtx, combineContours[combinePrimary].points, '#4fd1c5', 2.5);
    drawProgramPath(combineCtx, combinePath, { color: '#63b3ed', alpha: 0.95 });
    combineFeatureRegions().forEach(function (r) { drawRegion(combineCtx, r, '#f6ad55'); });
    renderFeatureStrip(combineFeatureStrip, combineRefCanvas, combineFeatureRegions());
  }

  function renderCombineContourList() {
    combineContourList.innerHTML = '';
    if (combineContours.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = t('combine.contourEmpty');
      combineContourList.appendChild(empty);
      return;
    }
    combineContours.forEach(function (c, i) {
      var li = document.createElement('li');
      li.className = i === combinePrimary ? 'selected' : '';
      var label = document.createElement('span');
      label.textContent = '#' + i + (c.isHole ? ' ' + t('combine.hole') : '');
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = t('combine.contourArea', { area: Math.round(c.area) });
      var roles = document.createElement('span');
      roles.className = 'roles';
      function roleBtn(key, active, extraCls, onClick) {
        var b = document.createElement('button');
        b.className = 'role-btn' + (active ? ' on' : '') + (extraCls ? ' ' + extraCls : '');
        b.textContent = t(key);
        b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
        roles.appendChild(b);
      }
      roleBtn('combine.roleOutline', i === combinePrimary, '', function () {
        combinePrimary = i;
        combineKeeps = combineKeeps.filter(function (k) { return k !== i; });
        combineFeatures = combineFeatures.filter(function (k) { return k !== i; });
        afterRoleChange();
      });
      roleBtn('combine.roleFeature', i === combinePrimary || combineFeatures.indexOf(i) !== -1, 'feat', function () {
        if (i === combinePrimary) return;
        toggle(combineFeatures, i); afterRoleChange();
      });
      roleBtn('combine.roleKeep', combineKeeps.indexOf(i) !== -1, 'keep', function () {
        if (i === combinePrimary) return;
        toggle(combineKeeps, i); afterRoleChange();
      });
      li.appendChild(label); li.appendChild(badge); li.appendChild(roles);
      combineContourList.appendChild(li);
    });
  }

  function toggle(arr, v) { var k = arr.indexOf(v); if (k === -1) arr.push(v); else arr.splice(k, 1); }
  function afterRoleChange() { renderCombineContourList(); regenerateCombinePath(); }

  function runFindContours() {
    if (!Vision.ready()) { setStatus(combineStatus, 'combine.statusCvLoading', null, 'busy'); return; }
    try {
      combineContours = Vision.findContours(combineRefCanvas, parseInt(combineContourThreshold.value, 10), parseInt(combineMinArea.value, 10));
      assignDefaultRoles();
      renderCombineContourList();
      regenerateCombinePath();
      if (combinePrimary >= 0) setStatus(combineStatus, 'combine.statusContoursFound', { count: combineContours.length }, 'ok');
      else setStatus(combineStatus, 'combine.statusNoContours', null, 'err');
    } catch (ex) {
      setStatus(combineStatus, 'combine.statusFindFailed', { msg: ex.message || String(ex) }, 'err');
    }
  }

  var findContoursDebounce = null;
  function scheduleFindContours() {
    if (findContoursDebounce) clearTimeout(findContoursDebounce);
    findContoursDebounce = setTimeout(runFindContours, 80);
  }
  combineContourThreshold.addEventListener('input', function () { combineThresholdVal.textContent = combineContourThreshold.value; scheduleFindContours(); });
  combineMinArea.addEventListener('input', function () { combineMinAreaVal.textContent = combineMinArea.value; scheduleFindContours(); });
  combineFindContoursBtn.addEventListener('click', runFindContours);

  combineImageUpload.addEventListener('change', function (evt) {
    var file = evt.target.files && evt.target.files[0];
    if (!file) return;
    loadFileAsImage(file, function (img) {
      fitImageIntoCanvas(img, combineRefCanvas);
      combineResetLayout('combine.statusPhotoLoaded');
    });
  });

  resetSyntheticImageBtn.addEventListener('click', function () {
    combineRefCanvas = makeWorkpieceCanvas(sampleSelect.value);
    combineImageUpload.value = '';
    combineResetLayout('combine.statusSampleRestored');
  });

  // ---------- spray program inputs ----------

  var programFields = [
    ['progWidth', 'widthMm', 1], ['progOverlap', 'overlapPct', 0], ['progEdgeOffset', 'edgeOffsetMm', null],
    ['progLead', 'leadMm', 0], ['progAngle', 'fillAngleDeg', null]
  ];
  var passFields = ['edge', 'fill', 'cross'];
  function passInputs(type) {
    var cap = type.charAt(0).toUpperCase() + type.slice(1);
    return { on: $('pass' + cap + 'On'), speed: $('pass' + cap + 'Speed'), flow: $('pass' + cap + 'Flow') };
  }
  function passOf(program, type) { return program.passes.filter(function (p) { return p.type === type; })[0]; }

  function fillProgramInputs() {
    programFields.forEach(function (f) { $(f[0]).value = combineProgram[f[1]]; });
    passFields.forEach(function (type) {
      var p = passOf(combineProgram, type), inp = passInputs(type);
      inp.on.checked = p.enabled; inp.speed.value = p.speed; inp.flow.value = p.flow;
    });
  }

  function readProgramInputs() {
    programFields.forEach(function (f) {
      var v = num($(f[0]).value, combineProgram[f[1]]);
      if (f[2] != null) v = Math.max(f[2], v);
      if (f[1] === 'overlapPct') v = Math.min(90, v);
      combineProgram[f[1]] = v;
    });
    passFields.forEach(function (type) {
      var p = passOf(combineProgram, type), inp = passInputs(type);
      p.enabled = inp.on.checked;
      p.speed = Math.max(10, num(inp.speed.value, p.speed));
      p.flow = Math.min(100, Math.max(0, num(inp.flow.value, p.flow)));
    });
  }

  var programDebounce = null;
  programFields.map(function (f) { return $(f[0]); }).concat([].concat.apply([], passFields.map(function (type) {
    var i = passInputs(type); return [i.on, i.speed, i.flow];
  }))).forEach(function (inp) {
    inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', function () {
      if (programDebounce) clearTimeout(programDebounce);
      programDebounce = setTimeout(function () { readProgramInputs(); regenerateCombinePath(); }, 120);
    });
  });

  function renderProgramStats() {
    if (!combinePath.length) { programStats.textContent = t('prog.statsNone'); return; }
    var s = Core.pathStats(combinePath, station.mmPerPx, station.gunMlPerMin);
    var px = Core.programPx(combineProgram, station.mmPerPx);
    programStats.textContent = t('prog.stats', {
      len: fmt(s.lengthMm / 1000, 2), cycle: fmt(s.cycleS, 1), paint: fmt(s.paintMl, 0),
      spacing: fmt(px.spacingPx * station.mmPerPx, 1), points: combinePath.length
    });
  }

  function refreshAllPathRendering() {
    renderCombineCanvas();
    if (preRunRecipe) renderPreRunRecipeCanvas();
    if (applied) renderResultFrame();
  }
  pathPointSizeInput.addEventListener('input', function () { pathPointSizeVal.textContent = pathPointSizeInput.value; refreshAllPathRendering(); });
  pathLineWidthInput.addEventListener('input', function () { pathLineWidthVal.textContent = pathLineWidthInput.value; refreshAllPathRendering(); });

  // ---------- save / load / import / export recipes ----------

  function buildRecipe(name) {
    var keepOuts = combineKeeps.map(function (i) { return combineContours[i].points; });
    return {
      v: 2, name: name,
      image: combineRefCanvas.toDataURL('image/png'),
      contours: combineContours,
      primary: combinePrimary, features: combineFeatures.slice(), keeps: combineKeeps.slice(),
      featureRegions: combineFeatureRegions(),
      outline: combineGeom ? combineGeom.outline : combineContours[combinePrimary].points,
      keepOuts: keepOuts,
      program: Core.cloneProgram(combineProgram),
      path: combinePath,
      mmPerPxAtSave: station.mmPerPx,
      created: (recipes[name] && recipes[name].created) || Date.now(),
      updated: Date.now()
    };
  }

  /** Saves the current Combine layout as recipe `name`; resolves true on success. */
  function saveCurrentRecipe(name, askBeforeOverwrite) {
    if (!name) { setStatus(combineStatus, 'combine.statusEnterName', null, 'err'); return Promise.resolve(false); }
    if (combinePrimary < 0 || combinePath.length < 2) { setStatus(combineStatus, 'combine.statusNeedPath', null, 'err'); return Promise.resolve(false); }
    if (recipes[name] && askBeforeOverwrite && !confirm(t('combine.confirmOverwrite', { name: name }))) return Promise.resolve(false);
    return persistRecipe(buildRecipe(name)).then(function (ok) {
      if (!ok) return false;
      refreshRecipeSelects();
      combineRecipeSelect.value = name;
      preRunRecipeSelect.value = name;
      setStatus(combineStatus, 'combine.statusSaved', { name: name }, 'ok');
      return true;
    });
  }

  saveRecipeBtn.addEventListener('click', function () { saveCurrentRecipe(recipeNameInput.value.trim(), true); });

  combineLoadRecipeBtn.addEventListener('click', function () {
    var rec = recipes[combineRecipeSelect.value];
    if (!rec) return;
    loadImage(rec.image).then(function (img) {
      combineRefCanvas = makeCanvas();
      combineRefCanvas.getContext('2d').drawImage(img, 0, 0, W, H);
      combineContours = rec.contours || [];
      combinePrimary = rec.primary == null ? -1 : rec.primary;
      combineFeatures = (rec.features || []).slice();
      combineKeeps = (rec.keeps || []).slice();
      combineProgram = Core.cloneProgram(rec.program);
      fillProgramInputs();
      renderCombineContourList();
      if (combinePrimary >= 0) regenerateCombinePath();
      else { combinePath = rec.path || []; renderCombineCanvas(); renderProgramStats(); }
      recipeNameInput.value = rec.name;
      setStatus(combineStatus, 'combine.statusLoaded', { name: rec.name }, 'ok');
    });
  });

  combineDeleteRecipeBtn.addEventListener('click', function () {
    var name = combineRecipeSelect.value;
    if (!recipes[name] || !confirm(t('combine.confirmDelete', { name: name }))) return;
    delete recipes[name];
    store.deleteRecipe(name).catch(function (e) { console.error(e); });
    refreshRecipeSelects();
    setStatus(combineStatus, 'combine.statusDeleted', { name: name });
  });

  function exportRecipes(list, filename) {
    download(filename, JSON.stringify({ format: 'isd-spray-recipes', version: 2, exported: new Date().toISOString(), recipes: list }), 'application/json');
  }
  $('exportRecipeBtn').addEventListener('click', function () {
    var rec = recipes[combineRecipeSelect.value];
    if (!rec) { setStatus(combineStatus, 'combine.statusNothingToExport', null, 'err'); return; }
    exportRecipes([rec], safeName(rec.name) + '.isd-recipe.json');
  });
  $('exportAllRecipesBtn').addEventListener('click', function () {
    var names = recipeNames();
    if (!names.length) { setStatus(combineStatus, 'combine.statusNothingToExport', null, 'err'); return; }
    exportRecipes(names.map(function (n) { return recipes[n]; }), 'isd-recipes-' + new Date().toISOString().slice(0, 10) + '.json');
  });
  $('importRecipesInput').addEventListener('change', function (evt) {
    var file = evt.target.files && evt.target.files[0];
    evt.target.value = '';
    if (!file) return;
    file.text().then(function (text) {
      var data = JSON.parse(text), list;
      if (data && data.format === 'isd-spray-recipes') list = data.recipes;
      else if (data && typeof data === 'object' && !Array.isArray(data)) list = Object.keys(data).map(function (k) { var r = data[k]; r.name = r.name || k; return r; });
      if (!list || !list.length || !list.every(function (r) { return r && r.name && r.image; })) throw new Error('format');
      var clashes = list.filter(function (r) { return recipes[r.name]; }).map(function (r) { return r.name; });
      if (clashes.length && !confirm(t('combine.confirmImportOverwrite', { names: clashes.join(', ') }))) list = list.filter(function (r) { return !recipes[r.name]; });
      return Promise.all(list.map(function (r) { return persistRecipe(normalizeRecipe(r)); })).then(function () {
        refreshRecipeSelects();
        setStatus(combineStatus, 'combine.statusImported', { count: list.length }, 'ok');
      });
    }).catch(function (e) {
      console.error(e);
      setStatus(combineStatus, 'combine.statusImportFailed', null, 'err');
    });
  });

  // ---------- pre-run state ----------

  var preRunRecipe = null; // { rec, imageObj, template (W x H canvas of the recipe photo) }
  var groundTruth = null;  // { sx, sy, rot, scale, T } when the current image is simulated
  var lastMatch = null;    // { res, evaluation }

  // The clean "current" camera image (simulated shift or uploaded photo), kept apart from
  // preRunRecipeCanvas so matching and the step-3 background never see drawn overlays.
  var preRunCurrentCanvas = makeCanvas();
  var preRunCurrentCtx = preRunCurrentCanvas.getContext('2d');
  var preRunCurrentIsRecipe = false; // true while the current image is the unshifted recipe photo
  var preRunHasCurrent = false;

  function recipeRegions(rec) { return rec.featureRegions || []; }

  /** Shows the current image; the recipe's path + feature regions are overlaid only while it is the unshifted recipe photo, where they line up. */
  function renderPreRunRecipeCanvas() {
    preRunRecipeCtx.clearRect(0, 0, W, H);
    if (!preRunHasCurrent) return;
    preRunRecipeCtx.drawImage(preRunCurrentCanvas, 0, 0);
    $('alignLegend').hidden = !applied;
    if (applied) {
      // the taught (uncorrected) path sits where the part was when taught, off the part in this photo - only on request
      if ($('showTaughtPath').checked) drawProgramPath(preRunRecipeCtx, applied.origPath, { color: '#fc8181', dashed: true, alpha: 0.8, showOff: false, pointSize: 0 });
      drawProgramPath(preRunRecipeCtx, applied.path, { color: '#4fd1c5' });
      return;
    }
    if (!preRunCurrentIsRecipe || !preRunRecipe) return;
    (preRunRecipe.rec.keepOuts || []).forEach(function (k) { strokePoly(preRunRecipeCtx, k, '#fc8181', 1.5, null, 'rgba(252,129,129,0.22)'); });
    drawProgramPath(preRunRecipeCtx, preRunRecipe.rec.path, { color: '#63b3ed', alpha: 0.9 });
    recipeRegions(preRunRecipe.rec).forEach(function (r) { drawRegion(preRunRecipeCtx, r, '#f6ad55'); });
  }

  function resetSimSliders() {
    simShiftX.value = 0; simShiftY.value = 0; simRotate.value = 0; simScale.value = 100;
    updateSliderLabels();
  }
  function updateSliderLabels() {
    simShiftXVal.textContent = simShiftX.value; simShiftYVal.textContent = simShiftY.value;
    simRotateVal.textContent = simRotate.value; simScaleVal.textContent = simScale.value;
  }

  /** Discards the previous match and step-3/4 results, since they no longer describe the current image. */
  function clearMatchState() {
    stopPathSimulation();
    lastMatch = null;
    applied = null;
    pendingOverride = null;
    matchResultBox.style.display = 'none';
    groundTruthBox.style.display = 'none';
    verdictBox.style.display = 'none';
    resultCtx.clearRect(0, 0, W, H);
    metricsBox.innerHTML = '';
    simPlayBtn.disabled = true; simInstantBtn.disabled = true;
    exportBtns.forEach(function (b) { b.disabled = true; });
    setStatus(simStatus, 'sim.statusInitial');
    resetInspection();
  }

  /** Loads recipe `name` into Pre-run; with keepCurrent the current camera image is kept (part identification). */
  function loadPreRunRecipe(name, onLoaded, keepCurrent) {
    var rec = recipes[name];
    if (!rec) return;
    recipeTemplate(rec).then(function (tpl) {
      var switched = !preRunRecipe || preRunRecipe.rec.name !== name;
      preRunRecipe = { rec: rec, imageObj: tpl.img, template: tpl.canvas };
      if (keepCurrent && switched) {
        // the kept photo's true shift (if simulated) was relative to the previous recipe's photo
        groundTruth = null;
        preRunCurrentIsRecipe = false;
      }
      if (generateCurrentDebounce) clearTimeout(generateCurrentDebounce);
      clearMatchState();
      if (!keepCurrent) {
        uploadCurrentInput.value = '';
        resetSimSliders();
        preRunCurrentCtx.clearRect(0, 0, W, H);
        preRunCurrentCtx.drawImage(tpl.img, 0, 0, W, H);
        preRunCurrentIsRecipe = true;
        preRunHasCurrent = true;
        groundTruth = { sx: 0, sy: 0, rot: 0, scale: 1, T: shiftTransform(0, 0, 0, 1) };
      }
      preRunRecipeSelect.value = name;
      renderPreRunRecipeCanvas();
      setStatus(preRunFeatureStatus, recipeRegions(rec).length ? 'prerun.featureRecipeLoaded' : 'prerun.featureNoRegion', { name: name, n: recipeRegions(rec).length });
      setStatus(matchStatus, 'prerun.matchRecipeLoaded');
      if (onLoaded) onLoaded();
    });
  }

  var templateCache = {};
  /** Decoded recipe photo at W x H (cached per recipe version). */
  function recipeTemplate(rec) {
    var key = rec.name + '@' + rec.updated;
    if (templateCache[key]) return Promise.resolve(templateCache[key]);
    return loadImage(rec.image).then(function (img) {
      var c = makeCanvas();
      c.getContext('2d').drawImage(img, 0, 0, W, H);
      templateCache[key] = { img: img, canvas: c };
      return templateCache[key];
    });
  }

  // one setting shown in two places (Align and Spray): keep both checkboxes in step and redraw both views
  ['showTaughtPath', 'showTaughtPathSpray'].forEach(function (id, i, ids) {
    $(id).addEventListener('change', function () {
      $(ids[1 - i]).checked = $(id).checked;
      renderPreRunRecipeCanvas();
      if (applied) renderResultFrame();
    });
  });
  preRunLoadRecipeBtn.addEventListener('click', function () { loadPreRunRecipe(preRunRecipeSelect.value); });

  // ---------- simulated current photo + stress ----------

  var stressIds = ['Brightness', 'Contrast', 'Noise', 'Blur', 'Glare', 'Cover'];
  function currentStress() {
    var s = {};
    stressIds.forEach(function (id) { s[id.toLowerCase()] = num($('stress' + id).value, 0); });
    return s;
  }
  function stressActive(s) { return s.brightness || s.contrast !== 100 || s.noise || s.blur || s.glare || s.cover; }

  /** Primary feature region as a quad after the true shift - the area the "covered feature" stress hides. */
  function coverQuadFor(rec, T) {
    var r = recipeRegions(rec)[0];
    return r ? rectQuad(r).map(function (p) { return Core.applySim(T, p); }) : null;
  }

  function renderSimulatedInto(canvas, rec, img, sx, sy, rot, scale, stress) {
    var ctx = canvas.getContext('2d');
    drawShiftedImage(ctx, img, sx, sy, rot, scale);
    var T = shiftTransform(sx, sy, rot, scale);
    if (stressActive(stress)) Vision.applyStress(canvas, stress, coverQuadFor(rec, T));
    return T;
  }

  var generateCurrentDebounce = null;
  [simShiftX, simShiftY, simRotate, simScale].concat(stressIds.map(function (id) { return $('stress' + id); })).forEach(function (input) {
    input.addEventListener('input', function () {
      updateSliderLabels();
      stressIds.forEach(function (id) { $('stress' + id + 'Val').textContent = $('stress' + id).value; });
      if (!preRunRecipe) return;
      if (generateCurrentDebounce) clearTimeout(generateCurrentDebounce);
      generateCurrentDebounce = setTimeout(generateCurrent, 80);
    });
  });

  function generateCurrent() {
    if (!preRunRecipe) { setStatus(matchStatus, 'prerun.matchLoadFirst', null, 'err'); return; }
    var sx = num(simShiftX.value, 0), sy = num(simShiftY.value, 0), rot = num(simRotate.value, 0), sc = num(simScale.value, 100) / 100;
    uploadCurrentInput.value = ''; // moving the sliders switches back from an uploaded photo to the simulated one
    var T = renderSimulatedInto(preRunCurrentCanvas, preRunRecipe.rec, preRunRecipe.imageObj, sx, sy, rot, sc, currentStress());
    preRunCurrentIsRecipe = false;
    preRunHasCurrent = true;
    groundTruth = { sx: sx, sy: sy, rot: rot, scale: sc, T: T };
    clearMatchState();
    renderPreRunRecipeCanvas();
    setStatus(matchStatus, 'prerun.matchSimGenerated');
  }

  /** Random shift within the slider ranges; `range` < 1 keeps it milder (the one-click demo stays inside the limits). */
  function randomizeShift(range) {
    var f = typeof range === 'number' ? range : 1;
    simShiftX.value = Math.round((Math.random() * 2 - 1) * 70 * f);
    simShiftY.value = Math.round((Math.random() * 2 - 1) * 50 * f);
    simRotate.value = Math.round((Math.random() * 2 - 1) * 35 * f);
    updateSliderLabels();
    generateCurrent();
  }
  randomizeShiftBtn.addEventListener('click', function () { randomizeShift(); });

  uploadCurrentInput.addEventListener('change', function (evt) {
    var file = evt.target.files && evt.target.files[0];
    if (!file) return;
    loadFileAsImage(file, function (img) {
      if (generateCurrentDebounce) clearTimeout(generateCurrentDebounce);
      fitImageIntoCanvas(img, preRunCurrentCanvas);
      preRunCurrentIsRecipe = false;
      preRunHasCurrent = true;
      resetSimSliders(); // the sliders don't describe an uploaded photo
      groundTruth = null;
      clearMatchState();
      renderPreRunRecipeCanvas();
      setStatus(matchStatus, 'prerun.matchUploaded');
    });
  });

  // ---------- matching + pass/fail ----------

  function matchOpts() { return { method: station.match.method, clahe: station.match.clahe }; }

  /** Best verification correlation over the recipe's feature regions - one visible region is enough when another is covered. */
  function verifyScore(template, rec, current, T) {
    return Math.max.apply(null, recipeRegions(rec).map(function (r) { return Vision.verifyMatch(template, r, current, T, station.match.clahe); }));
  }

  /** Part motion at the primary feature centre plus every tolerance check, for display, logging and the verdict. */
  function evaluateMatch(res, rec, verify) {
    var c = Core.rectCenter(recipeRegions(rec)[0]);
    var c2 = Core.applySim(res.T, c);
    var dxMm = (c2.x - c.x) * station.mmPerPx, dyMm = (c2.y - c.y) * station.mmPerPx;
    var shiftMm = Math.hypot(dxMm, dyMm), scalePct = (res.scale - 1) * 100, tol = station.tol;
    var checks = [
      { key: 'verdict.shift', ok: shiftMm <= tol.maxShiftMm, vars: { v: fmt(shiftMm, 1), lim: tol.maxShiftMm } },
      { key: 'verdict.rot', ok: Math.abs(res.thetaDeg) <= tol.maxRotDeg, vars: { v: fmt(res.thetaDeg, 2), lim: tol.maxRotDeg } },
      { key: 'verdict.scale', ok: Math.abs(scalePct) <= tol.maxScalePct, vars: { v: fmtSigned(scalePct, 2), lim: tol.maxScalePct } },
      { key: 'verdict.score', ok: res.score * 100 >= tol.minScorePct, vars: { v: fmt(res.score * 100, 0), lim: tol.minScorePct } }
    ];
    if (res.inliers != null) checks.push({ key: 'verdict.inliers', ok: res.inliers >= tol.minInliers, vars: { v: res.inliers, lim: tol.minInliers } });
    checks.push({ key: 'verdict.verify', ok: verify >= tol.minVerify, vars: { v: fmt(verify, 2), lim: tol.minVerify } });
    var regions = recipeRegions(rec).length;
    var found = res.perRegion ? res.perRegion.filter(function (r) { return r.inliers >= 3; }).length : 1;
    return {
      center: c, dxMm: dxMm, dyMm: dyMm, shiftMm: shiftMm, scalePct: scalePct, checks: checks, verify: verify,
      pass: checks.every(function (k) { return k.ok; }), regions: regions, found: found
    };
  }

  function renderMatchResult() {
    if (!lastMatch) return;
    var res = lastMatch.res, ev = lastMatch.evaluation;
    $('keyMoved').textContent = fmt(ev.shiftMm, 1) + ' mm';
    $('keyRotated').textContent = fmt(res.thetaDeg, 1) + '°';
    $('keyMatch').textContent = fmt(ev.verify, 2);
    $('resultShift').textContent = fmtSigned(ev.dxMm, 1) + ', ' + fmtSigned(ev.dyMm, 1) + ' mm';
    $('resultTheta').textContent = fmt(res.thetaDeg, 2) + ' °';
    $('resultScale').textContent = fmt(res.scale * 100, 2) + ' %';
    $('resultMethod').textContent = t(res.method === 'orb' ? 'prerun.methodOrb' : 'prerun.methodTemplate');
    $('resultInliers').textContent = res.inliers != null ? res.inliers + ' / ' + res.total : '—';
    $('resultFeatures').textContent = res.perRegion ? ev.found + ' / ' + ev.regions : '—';
    $('resultScore').textContent = fmt(res.score * 100, 0) + ' %';
    $('resultVerify').textContent = fmt(ev.verify, 2);
    $('resultVerify').className = 'v ' + (ev.verify >= station.tol.minVerify ? 'good' : 'bad');
    $('resultInliers').className = 'v ' + (res.inliers >= 8 ? 'good' : '');
    $('resultScore').className = 'v ' + (res.score * 100 >= station.tol.minScorePct ? 'good' : 'bad');
    matchResultBox.style.display = 'block';
    revealGroundTruthBtn.disabled = !groundTruth;
    renderVerdict();
  }

  function renderVerdict() {
    if (!lastMatch) { verdictBox.style.display = 'none'; return; }
    var ev = lastMatch.evaluation;
    verdictBox.style.display = 'flex';
    var overridden = applied && applied.labelKey === 'prerun.pathLabelOverride';
    verdictBanner.className = 'verdict ' + (ev.pass ? 'pass' : overridden ? 'warn' : 'fail');
    verdictBanner.textContent = ev.pass ? '✓ ' + t('verdict.pass') : overridden ? '⚠ ' + t('verdict.overridden') : '✗ ' + t('verdict.fail');
    verdictChecks.innerHTML = '';
    ev.checks.forEach(function (c) {
      var li = document.createElement('li');
      li.className = c.ok ? 'ok' : 'bad';
      li.textContent = t(c.key, c.vars);
      verdictChecks.appendChild(li);
    });
    overrideBtn.style.display = !ev.pass && !overridden ? 'inline-block' : 'none';
  }

  var pendingOverride = null;

  /** Runs the pattern match on the current image; applies it when it passes the station limits. Returns the evaluation or null. */
  function runMatchAndApply() {
    if (!Vision.ready()) { setStatus(matchStatus, 'combine.statusCvLoading', null, 'busy'); return null; }
    if (!preRunRecipe) { setStatus(matchStatus, 'prerun.matchLoadFirst', null, 'err'); return null; }
    var rec = preRunRecipe.rec;
    clearMatchState();
    var res = Vision.matchRecipe(preRunRecipe.template, recipeRegions(rec), preRunCurrentCanvas, matchOpts());
    if (!res.ok) {
      setStatus(matchStatus, res.err, res.vars, 'err');
      addLogEntry({ kind: 'nomatch', verdict: 'nomatch', recipe: rec.name, reason: t(res.err, res.vars) });
      return null;
    }
    var ev = evaluateMatch(res, rec, verifyScore(preRunRecipe.template, rec, preRunCurrentCanvas, res.T));
    lastMatch = { res: res, evaluation: ev };
    var entry = {
      kind: 'match', verdict: ev.pass ? 'pass' : 'fail', recipe: rec.name, method: res.method,
      shiftX: ev.dxMm, shiftY: ev.dyMm, rot: res.thetaDeg, scalePct: ev.scalePct, score: res.score,
      inliers: res.inliers, verify: ev.verify, features: res.perRegion ? ev.found + '/' + ev.regions : '-',
      failed: ev.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.key; })
    };
    if (ev.pass) {
      applyMatchToPath(Core.rigidAbout(res.T, ev.center), 'prerun.pathLabelMatched', entry);
      setStatus(matchStatus, 'prerun.matchApplied', null, 'ok');
    } else {
      pendingOverride = entry;
      addLogEntry(entry);
      setStatus(matchStatus, 'prerun.matchRejected', null, 'err');
      setStatus(simStatus, 'sim.statusRejected', null, 'err');
    }
    renderMatchResult();
    return ev;
  }

  matchBtn.addEventListener('click', function () {
    if (!preRunRecipe || !preRunRecipe.rec.path || preRunRecipe.rec.path.length < 2) { setStatus(matchStatus, 'prerun.matchNeedPath', null, 'err'); return; }
    setStatus(matchStatus, 'prerun.matchRunning', null, 'busy');
    setTimeout(runMatchAndApply, 30);
  });

  overrideBtn.addEventListener('click', function () {
    if (!lastMatch || !pendingOverride) return;
    if (!confirm(t('prerun.confirmOverride'))) return;
    var entry = pendingOverride;
    pendingOverride = null;
    var override = {};
    Object.keys(entry).forEach(function (k) { override[k] = entry[k]; });
    override.kind = 'override'; override.verdict = 'override';
    delete override.id;
    applyMatchToPath(Core.rigidAbout(lastMatch.res.T, lastMatch.evaluation.center), 'prerun.pathLabelOverride', override);
    setStatus(matchStatus, 'prerun.matchOverridden', null, 'busy');
    renderVerdict();
  });

  confirmPathBtn.addEventListener('click', function () {
    if (!preRunRecipe || !preRunRecipe.rec.path || preRunRecipe.rec.path.length < 2) { setStatus(matchStatus, 'prerun.matchNeedPath', null, 'err'); return; }
    clearMatchState();
    applyMatchToPath({ a: 1, b: 0, tx: 0, ty: 0 }, 'prerun.pathLabelConfirmed', { kind: 'confirm', verdict: 'confirm', recipe: preRunRecipe.rec.name });
    setStatus(matchStatus, 'prerun.matchConfirmed', null, 'ok');
  });

  function renderGroundTruthBox() {
    if (!groundTruth || !lastMatch) return;
    var c = lastMatch.evaluation.center;
    var trueC = Core.applySim(groundTruth.T, c), detC = Core.applySim(lastMatch.res.T, c);
    var errMm = Core.dist(trueC, detC) * station.mmPerPx;
    var errRot = lastMatch.res.thetaDeg - groundTruth.rot;
    var errScale = (lastMatch.res.scale - groundTruth.scale) * 100;
    var lines = [
      t('prerun.groundDialedIn', { sx: groundTruth.sx, sy: groundTruth.sy, rot: groundTruth.rot, scale: fmt(groundTruth.scale * 100, 1) }),
      t('prerun.groundTrueMove', { x: fmtSigned((trueC.x - c.x) * station.mmPerPx, 1), y: fmtSigned((trueC.y - c.y) * station.mmPerPx, 1) }),
      t('prerun.groundError', { e: fmt(errMm, 2), et: fmtSigned(errRot, 2), es: fmtSigned(errScale, 2) })
    ];
    groundTruthBox.textContent = lines.join(' ');
    groundTruthBox.className = 'status-line ' + (errMm <= station.tol.accuracyMm ? 'ok' : 'err');
    groundTruthBox.style.display = 'block';
  }
  revealGroundTruthBtn.addEventListener('click', renderGroundTruthBox);

  // ---------- part identification ----------

  var lastIdentify = null;
  var IDENTIFY_MIN_VERIFY = 0.7;

  identifyBtn.addEventListener('click', function () {
    if (!Vision.ready()) return;
    if (!preRunHasCurrent) { setStatus(identifyResult, 'prerun.identifyNeedPhoto'); return; }
    var names = recipeNames();
    if (!names.length) { setStatus(identifyResult, 'prerun.identifyNoRecipes'); return; }
    setStatus(identifyResult, 'prerun.identifyRunning');
    identifyBtn.disabled = true;
    var results = [];
    var current = makeCanvas();
    current.getContext('2d').drawImage(preRunCurrentCanvas, 0, 0);
    (function next(i) {
      if (i >= names.length) { finishIdentify(results); return; }
      var rec = recipes[names[i]];
      recipeTemplate(rec).then(function (tpl) {
        var regions = recipeRegions(rec);
        var res = regions.length ? Vision.matchRecipe(tpl.canvas, regions, current, matchOpts()) : { ok: false };
        var verify = res.ok ? Vision.verifyMatch(tpl.canvas, regions[0], current, res.T, station.match.clahe) : 0;
        results.push({ name: rec.name, ok: res.ok, score: res.ok ? res.score : 0, verify: verify, method: res.method });
        setTimeout(function () { next(i + 1); }, 0);
      });
    })(0);
  });

  function finishIdentify(results) {
    identifyBtn.disabled = false;
    // ranked by the verification correlation - match scores from ORB and template matching aren't comparable
    results.sort(function (a, b) { return (b.ok - a.ok) || (b.verify - a.verify); });
    var best = results[0];
    var known = best && best.ok && best.verify >= IDENTIFY_MIN_VERIFY;
    lastIdentify = { results: results, best: known ? best.name : null };
    renderIdentify();
    if (known) loadPreRunRecipe(best.name, null, true);
  }

  function renderIdentify() {
    if (!lastIdentify) return;
    var r = lastIdentify;
    var head = r.best ? t('prerun.identifyFound', { name: escapeHtml(r.best) }) : t('prerun.identifyUnknown');
    var rows = r.results.map(function (x) {
      return '<tr><td>' + escapeHtml(x.name) + '</td><td>' + (x.ok ? fmt(x.verify, 2) : '—') + '</td><td>' + (x.ok ? fmt(x.score * 100, 0) + ' %' : '—') + '</td></tr>';
    }).join('');
    identifyResult._st = null;
    identifyResult.innerHTML = '<div class="verdict ' + (r.best ? 'pass' : 'fail') + '" style="margin:6px 0;">' + (r.best ? '✓ ' : '✗ ') + head + '</div>' +
      '<table class="data-table"><tr><th>' + t('prerun.identifyRecipe') + '</th><th>' + t('prerun.identifyVerify', { min: IDENTIFY_MIN_VERIFY }) + '</th><th>' + t('prerun.confidenceScore') + '</th></tr>' + rows + '</table>';
  }

  // ---------- applied path, film deposition and simulation ----------

  var applied = null;
  var viewMode = 'path'; // 'path' | 'trail' | 'film'

  /** Rasterises polygons (image px) onto the deposition grid: 1 inside. */
  function polyMask(polys, nx, ny) {
    var c = makeCanvas(nx, ny), ctx = c.getContext('2d');
    ctx.scale(1 / GRID_CELL, 1 / GRID_CELL);
    ctx.fillStyle = '#fff';
    polys.forEach(function (poly) {
      if (!poly || poly.length < 3) return;
      ctx.beginPath();
      poly.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.closePath(); ctx.fill();
    });
    var d = ctx.getImageData(0, 0, nx, ny).data, out = new Uint8Array(nx * ny);
    for (var i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    return out;
  }

  function makeGrid(program) {
    var widthPx = (program ? program.widthMm : 40) / station.mmPerPx;
    return new Core.DepositionGrid(W, H, GRID_CELL, Math.max(1.5, widthPx / 4));
  }

  function applyMatchToPath(T, labelKey, logEntry) {
    stopPathSimulation();
    var rec = preRunRecipe.rec;
    var path = Core.transformPath(rec.path || [], T);
    var program = rec.program;
    var before = makeCanvas();
    before.getContext('2d').drawImage(preRunCurrentCanvas, 0, 0);
    var grid = makeGrid(program);
    var outlineT = rec.outline ? Core.transformPath(rec.outline, T) : null;
    var keepT = (rec.keepOuts || []).map(function (k) { return Core.transformPath(k, T); });
    applied = {
      T: T, labelKey: labelKey, recipe: rec, path: path,
      origPath: rec.path || [], before: before, grid: grid,
      nominal: program ? Core.nominalDensity(program, station.mmPerPx) : null,
      masks: {
        part: outlineT ? polyMask([outlineT], grid.nx, grid.ny) : polyMask([], grid.nx, grid.ny).fill(1),
        keep: polyMask(keepT, grid.nx, grid.ny)
      },
      stats: Core.pathStats(path, station.mmPerPx, station.gunMlPerMin),
      samples: null, sampleIdx: 0, done: false, metrics: null, logId: null
    };
    applied.samples = Core.buildSamples(path, station.mmPerPx, simClog.checked ? clogDefect() : null);
    resetDeposition();
    var enough = path.length >= 2;
    simPlayBtn.disabled = !enough; simInstantBtn.disabled = !enough;
    exportBtns.forEach(function (b) { b.disabled = !enough; });
    renderExportHint();
    setStatus(simStatus, enough ? 'sim.statusReady' : 'sim.statusTooFew');
    renderResultFrame();
    renderPreRunRecipeCanvas();
    metricsBox.innerHTML = '';
    resetInspection();
    if (logEntry) {
      logEntry.cycleS = applied.stats.cycleS;
      logEntry.paintMl = applied.stats.paintMl;
      var a = applied;
      addLogEntry(logEntry).then(function (id) { a.logId = id; });
    }
  }

  /** A random 12-20 % stretch of the gun-on path at 10 % flow - a partly clogged nozzle. */
  function clogDefect() {
    var len = 0.12 + Math.random() * 0.08, from = 0.15 + Math.random() * (0.8 - len);
    return { from: from, to: from + len, factor: 0.1 };
  }

  simClog.addEventListener('change', function () {
    if (!applied) return;
    stopPathSimulation();
    applied.samples = Core.buildSamples(applied.path, station.mmPerPx, simClog.checked ? clogDefect() : null);
    resetDeposition();
    renderResultFrame();
    setStatus(simStatus, 'sim.statusReady');
  });

  function resetDeposition() {
    applied.grid.reset();
    applied.sampleIdx = 0;
    applied.done = false;
    applied.metrics = null;
  }

  var paintLayer = null, paintLayerCtx = null;

  /** Renders the deposition grid as an overlay: paint colour by film (trail view) or the film thickness ramp. */
  function drawFilmOverlay(ctx, grid, mode) {
    if (!paintLayer || paintLayer.width !== grid.nx) { paintLayer = makeCanvas(grid.nx, grid.ny); paintLayerCtx = paintLayer.getContext('2d'); }
    var img = paintLayerCtx.createImageData(grid.nx, grid.ny), d = img.data;
    var nominal = applied.nominal || filmReference(), opacity = num(simOpacityInput.value, 85) / 100;
    var rgb = hexToRgb(simColorInput.value);
    for (var i = 0; i < grid.data.length; i++) {
      var rel = grid.data[i] / nominal;
      if (rel <= 0.02) continue;
      var o = i * 4;
      if (mode === 'film') {
        var c = Core.filmColor(rel);
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3];
      } else {
        d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = Math.min(1, rel) * opacity * 255;
      }
    }
    paintLayerCtx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(paintLayer, 0, 0, grid.nx * grid.cell, grid.ny * grid.cell);
    ctx.restore();
  }

  /** Film reference when the program has no fill pass (or a legacy recipe): the median film on the part so far. */
  function filmReference() {
    var vals = [];
    for (var i = 0; i < applied.grid.data.length; i++) if (applied.masks.part[i] && applied.grid.data[i] > 0) vals.push(applied.grid.data[i]);
    return vals.length ? Core.percentile(vals, 0.5) : 1;
  }

  function hexToRgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  function renderResultFrame() {
    resultCtx.clearRect(0, 0, W, H);
    if (!applied) return;
    resultCtx.drawImage(applied.before, 0, 0);
    if (viewMode === 'film') { resultCtx.fillStyle = 'rgba(10,14,24,0.45)'; resultCtx.fillRect(0, 0, W, H); }
    if (viewMode !== 'path') drawFilmOverlay(resultCtx, applied.grid, viewMode);
    if (viewMode === 'path') {
      if ($('showTaughtPath').checked) drawProgramPath(resultCtx, applied.origPath, { color: '#fc8181', dashed: true, alpha: 0.75, showOff: false, pointSize: 0 });
      drawProgramPath(resultCtx, applied.path, { color: '#4fd1c5' });
    }
    if (viewMode !== 'path' && applied.sampleIdx > 0 && !applied.done) {
      var s = applied.samples[applied.sampleIdx - 1];
      var r = (applied.recipe.program ? applied.recipe.program.widthMm : 40) / station.mmPerPx / 2;
      resultCtx.save();
      resultCtx.strokeStyle = '#e6ebf5'; resultCtx.lineWidth = 1.5; resultCtx.setLineDash(s.on ? [] : [3, 3]);
      resultCtx.beginPath(); resultCtx.arc(s.x, s.y, r, 0, Math.PI * 2); resultCtx.stroke();
      if (s.on) { resultCtx.fillStyle = '#e6ebf5'; resultCtx.beginPath(); resultCtx.arc(s.x, s.y, 3, 0, Math.PI * 2); resultCtx.fill(); }
      resultCtx.restore();
    }
    resultCtx.fillStyle = '#e6ebf5';
    resultCtx.font = 'bold 13px sans-serif';
    resultCtx.fillText(t(applied.labelKey), 10, 18);
    filmLegend.style.display = viewMode === 'film' ? 'block' : 'none';
    pathLegend.style.display = viewMode === 'path' ? 'flex' : 'none';
  }

  function setViewMode(mode) {
    viewMode = mode;
    $('viewPathBtn').classList.toggle('active', mode === 'path');
    $('viewTrailBtn').classList.toggle('active', mode === 'trail');
    $('viewFilmBtn').classList.toggle('active', mode === 'film');
    renderResultFrame();
  }
  $('viewPathBtn').addEventListener('click', function () { setViewMode('path'); });
  $('viewTrailBtn').addEventListener('click', function () { setViewMode('trail'); });
  $('viewFilmBtn').addEventListener('click', function () { setViewMode('film'); });

  var simAnimationId = null, simRunning = false;

  function depositUntil(simTime) {
    var s = applied.samples;
    while (applied.sampleIdx < s.length && s[applied.sampleIdx].t <= simTime) {
      applied.grid.deposit(s[applied.sampleIdx]);
      applied.sampleIdx++;
    }
  }

  function startPathSimulation() {
    if (!applied || simRunning) return;
    resetDeposition();
    if (viewMode === 'path') setViewMode('trail');
    simRunning = true;
    simPlayBtn.disabled = true; simInstantBtn.disabled = true; simStopBtn.disabled = false;
    var startTime = null;
    function frame(ts) {
      if (!simRunning) return;
      if (startTime === null) startTime = ts;
      var simT = (ts - startTime) / 1000 * num(simPlayback.value, 8);
      depositUntil(simT);
      renderResultFrame();
      var total = applied.samples.length ? applied.samples[applied.samples.length - 1].t : 0;
      setStatus(simStatus, 'sim.statusSimulating', { t: fmt(Math.min(simT, total), 1), total: fmt(total, 1) }, 'busy');
      if (applied.sampleIdx >= applied.samples.length) { finishSimulation(); return; }
      simAnimationId = requestAnimationFrame(frame);
    }
    simAnimationId = requestAnimationFrame(frame);
  }

  function stopPathSimulation() {
    if (!simRunning) return;
    simRunning = false;
    if (simAnimationId) cancelAnimationFrame(simAnimationId);
    simAnimationId = null;
    simPlayBtn.disabled = false; simInstantBtn.disabled = false; simStopBtn.disabled = true;
    setStatus(simStatus, 'sim.statusStopped');
  }

  function finishSimulation() {
    simRunning = false;
    if (simAnimationId) cancelAnimationFrame(simAnimationId);
    simAnimationId = null;
    depositUntil(Infinity);
    applied.done = true;
    applied.metrics = Core.coverageMetrics(applied.grid, applied.masks, applied.nominal);
    renderResultFrame();
    renderMetrics();
    simPlayBtn.disabled = false; simInstantBtn.disabled = false; simStopBtn.disabled = true;
    setStatus(simStatus, 'sim.statusFinished', null, 'ok');
    inspectSimBtn.disabled = false;
    setStatus(inspectStatus, 'inspect.statusReady');
    if (applied.logId != null) updateLogEntry(applied.logId, { coverage: applied.metrics.coveredPct, inSpec: applied.metrics.inSpecPct });
    if (onSimulationFinished) { var cb = onSimulationFinished; onSimulationFinished = null; cb(); }
  }
  var onSimulationFinished = null;

  simPlayBtn.addEventListener('click', startPathSimulation);
  simStopBtn.addEventListener('click', stopPathSimulation);
  simInstantBtn.addEventListener('click', function () {
    if (!applied) return;
    stopPathSimulation();
    resetDeposition();
    if (viewMode === 'path') setViewMode('film');
    finishSimulation();
  });
  simPlayback.addEventListener('input', function () { simPlaybackVal.textContent = simPlayback.value; });
  simOpacityInput.addEventListener('input', function () { simOpacityVal.textContent = simOpacityInput.value; if (applied) renderResultFrame(); });
  simColorInput.addEventListener('input', function () { if (applied) renderResultFrame(); });

  function stat(k, v, s) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
  }

  function renderMetrics() {
    if (!applied || !applied.metrics) { metricsBox.innerHTML = ''; return; }
    var m = applied.metrics, st = applied.stats, um = station.targetFilmUm;
    metricsBox.innerHTML = [
      stat(t('metric.covered'), fmt(m.coveredPct, 1) + ' %', t('metric.coveredSub')),
      stat(t('metric.inSpec'), fmt(m.inSpecPct, 1) + ' %', t('metric.inSpecSub')),
      stat(t('metric.film'), fmt(m.meanRel * um, 0) + ' µm', t('metric.filmSub', { lo: fmt(m.p5Rel * um, 0), hi: fmt(m.p95Rel * um, 0) })),
      stat(t('metric.uniformity'), fmt(m.cvPct, 1) + ' %', t('metric.uniformitySub')),
      stat(t('metric.onPart'), fmt(m.onPartPct, 1) + ' %', t('metric.onPartSub', { over: fmt(m.oversprayPct, 1) })),
      stat(t('metric.keepOut'), fmt(m.keepOutPct, 2) + ' %', t('metric.keepOutSub')),
      stat(t('metric.paint'), fmt(st.paintMl, 1) + ' ml', t('metric.paintSub', { flow: station.gunMlPerMin })),
      stat(t('metric.cycle'), fmt(st.cycleS, 1) + ' s', t('metric.cycleSub', { on: fmt(st.onS, 1), len: fmt(st.lengthMm / 1000, 2) }))
    ].join('');
  }

  function renderFilmLegend() {
    var c = $('filmLegendCanvas'), ctx = c.getContext('2d');
    for (var x = 0; x < c.width; x++) {
      var col = Core.filmColor(x / (c.width - 1) * 1.5);
      ctx.fillStyle = 'rgba(' + Math.round(col[0]) + ',' + Math.round(col[1]) + ',' + Math.round(col[2]) + ',' + (Math.max(col[3], 60) / 255) + ')';
      ctx.fillRect(x, 0, 1, c.height);
    }
    var um = station.targetFilmUm;
    $('filmL0').textContent = '0';
    $('filmL1').textContent = fmt(um * 0.5, 0) + ' µm';
    $('filmL2').textContent = fmt(um, 0) + ' µm';
    $('filmL3').textContent = fmt(um * 1.5, 0) + ' µm';
  }

  // ---------- export ----------

  function renderExportHint() {
    setStatus($('exportFrameHint'), station.camToRobot ? 'export.frameRobot' : 'export.frameImage', { mm: fmt(station.mmPerPx, 4), z: station.standoffMm });
  }

  exportBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!applied) return;
      var fmtName = btn.getAttribute('data-format');
      var rp = Core.toRobotPoints(applied.path, station);
      var name = safeName(applied.recipe.name) + '-corrected';
      var meta = { title: applied.recipe.name + ' ' + new Date().toISOString() };
      if (fmtName === 'csv') download(name + '.csv', Core.exportCSV(rp), 'text/csv');
      else if (fmtName === 'json') download(name + '.json', JSON.stringify({ recipe: applied.recipe.name, frame: station.camToRobot ? 'robot' : 'image-mm', transform: applied.T, standoffMm: station.standoffMm, points: rp }, null, 1), 'application/json');
      else if (fmtName === 'rapid') download(name + '.mod', Core.exportRapid(Core.compactRobotPoints(rp), meta));
      else if (fmtName === 'krl') download(name + '.src', Core.exportKrl(Core.compactRobotPoints(rp), meta));
      else if (fmtName === 'fanuc') download(name + '.ls', Core.exportFanuc(Core.compactRobotPoints(rp), meta));
    });
  });

  // ---------- inspection ----------

  var inspection = null; // { after: canvas, result }

  function resetInspection() {
    inspection = null;
    inspectCtx.clearRect(0, 0, W, H);
    inspectVerdict.style.display = 'none';
    inspectStats.innerHTML = '';
    inspectSimBtn.disabled = true; inspectRunBtn.disabled = true;
    inspectUpload.value = '';
    setStatus(inspectStatus, 'inspect.statusInitial');
  }

  /** Before-photo with the simulated paint film composited on top, plus a little sensor noise. */
  function simulatedAfterPhoto() {
    var c = makeCanvas(), ctx = c.getContext('2d');
    ctx.drawImage(applied.before, 0, 0);
    var g = applied.grid, nominal = applied.nominal || filmReference(), rgb = hexToRgb(simColorInput.value);
    var layer = makeCanvas(g.nx, g.ny), lctx = layer.getContext('2d'), img = lctx.createImageData(g.nx, g.ny);
    for (var i = 0; i < g.data.length; i++) {
      var rel = g.data[i] / nominal;
      if (rel <= 0.02) continue;
      img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2];
      img.data[i * 4 + 3] = opacityForFilm(rel) * 255;
    }
    lctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(layer, 0, 0, W, H);
    Vision.applyStress(c, { brightness: 0, contrast: 100, noise: 4, blur: 0, glare: 0, cover: 0 });
    return c;
  }

  function setAfterPhoto(canvas, statusKey) {
    inspection = { after: canvas, result: null };
    inspectCtx.drawImage(canvas, 0, 0);
    inspectRunBtn.disabled = false;
    inspectVerdict.style.display = 'none';
    inspectStats.innerHTML = '';
    setStatus(inspectStatus, statusKey);
  }

  inspectSimBtn.addEventListener('click', function () { if (applied && applied.done) setAfterPhoto(simulatedAfterPhoto(), 'inspect.statusSimulated'); });
  inspectUpload.addEventListener('change', function (evt) {
    var file = evt.target.files && evt.target.files[0];
    if (!file || !applied) return;
    loadFileAsImage(file, function (img) { var c = makeCanvas(); fitImageIntoCanvas(img, c); setAfterPhoto(c, 'inspect.statusUploaded'); });
  });
  inspectThresh.addEventListener('input', function () { inspectThreshVal.textContent = inspectThresh.value; });

  /** Opacity a film of `rel` x target gives in the photo - the same model simulatedAfterPhoto() paints with. */
  function opacityForFilm(rel) { return Math.min(1, rel * 1.1) * PAINT_MAX_OPACITY; }
  var PAINT_MAX_OPACITY = 235 / 255;

  /**
   * Compares the paint opacity measured in the after-photo with what the defect-free program should give:
   * missed = expected paint but (almost) none; thin = clearly less opaque than expected; unexpected = paint where
   * none was planned; plus paint inside keep-outs. Cells whose surface already looks like the paint can't be judged.
   */
  function runInspection() {
    if (!applied || !inspection) return;
    var g = applied.grid, nx = g.nx, ny = g.ny;
    var expectedGrid = makeGrid(applied.recipe.program);
    Core.buildSamples(applied.path, station.mmPerPx, null).forEach(function (s) { expectedGrid.deposit(s); });
    var nominal = applied.nominal || filmReference();
    var alpha = Vision.paintOpacity(applied.before, inspection.after, hexToRgb(simColorInput.value), GRID_CELL, nx, ny);
    var thinFactor = 1 - num(inspectThresh.value, 35) / 100;
    var part = applied.masks.part, keep = applied.masks.keep;
    var expCount = 0, missed = 0, thin = 0, extra = 0, partCount = 0, judged = 0, keepHit = 0, keepCount = 0;
    var overlay = inspectCtx.createImageData(nx, ny);
    for (var i = 0; i < alpha.length; i++) {
      var a = alpha[i], rel = expectedGrid.data[i] / nominal;
      if (keep[i]) { keepCount++; if (a > 0.2) { keepHit++; paintCell(overlay, i, [250, 178, 25]); } continue; }
      if (!part[i]) continue;
      partCount++;
      if (a < 0) continue;
      judged++;
      if (rel >= 0.5) {
        expCount++;
        if (a < 0.2) { missed++; paintCell(overlay, i, [208, 59, 59]); }
        else if (rel >= 0.8 && a < thinFactor * opacityForFilm(rel)) { thin++; paintCell(overlay, i, [236, 131, 90]); }
      } else if (rel < 0.2 && a > 0.3) { extra++; paintCell(overlay, i, [250, 178, 25]); }
    }
    var r = {
      missedPct: expCount ? 100 * missed / expCount : 0,
      thinPct: expCount ? 100 * thin / expCount : 0,
      extraPct: partCount ? 100 * extra / partCount : 0,
      keepPct: keepCount ? 100 * keepHit / keepCount : 0,
      judgedPct: partCount ? 100 * judged / partCount : 0
    };
    r.pass = r.missedPct <= 1 && r.thinPct <= 3 && r.keepPct <= 5;
    inspection.result = r;
    var pass = r.pass, missedPct = r.missedPct;
    var layer = makeCanvas(nx, ny);
    layer.getContext('2d').putImageData(overlay, 0, 0);
    inspectCtx.drawImage(inspection.after, 0, 0);
    inspectCtx.drawImage(layer, 0, 0, nx * GRID_CELL, ny * GRID_CELL);
    renderInspection();
    if (applied.logId != null) updateLogEntry(applied.logId, { inspect: pass ? 'pass' : 'fail', missedPct: missedPct });
  }

  function paintCell(img, i, rgb) { img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = 200; }

  function renderInspection() {
    if (!inspection || !inspection.result) return;
    var r = inspection.result;
    inspectVerdict.style.display = 'flex';
    inspectVerdict.className = 'verdict ' + (r.pass ? 'pass' : 'fail');
    inspectVerdict.textContent = r.pass ? '✓ ' + t('inspect.pass') : '✗ ' + t('inspect.fail');
    inspectStats.innerHTML = [
      stat(t('inspect.missed'), fmt(r.missedPct, 2) + ' %', t('inspect.missedSub')),
      stat(t('inspect.thin'), fmt(r.thinPct, 2) + ' %', t('inspect.thinSub')),
      stat(t('inspect.extra'), fmt(r.extraPct, 2) + ' %', t('inspect.extraSub')),
      stat(t('inspect.keepHit'), fmt(r.keepPct, 2) + ' %', t('inspect.keepHitSub')),
      stat(t('inspect.judged'), fmt(r.judgedPct, 1) + ' %', t('inspect.judgedSub'))
    ].join('');
    setStatus(inspectStatus, r.pass ? 'inspect.statusPass' : 'inspect.statusFail', null, r.pass ? 'ok' : 'err');
  }

  inspectRunBtn.addEventListener('click', runInspection);

  // ---------- accuracy test ----------

  var bench = { running: false, trials: [], stop: false };

  $('benchRunBtn').addEventListener('click', function () {
    if (!preRunRecipe || !Vision.ready() || bench.running) { if (!preRunRecipe) setStatus(matchStatus, 'prerun.matchLoadFirst', null, 'err'); return; }
    var n = Math.max(5, Math.min(500, Math.round(num($('benchTrials').value, 30))));
    var rec = preRunRecipe.rec, img = preRunRecipe.imageObj, tpl = preRunRecipe.template;
    var stress = currentStress(), withScale = $('benchScale').checked, opts = matchOpts();
    var canvas = makeCanvas(), c = Core.rectCenter(recipeRegions(rec)[0]);
    bench = { running: true, trials: [], stop: false, n: n };
    $('benchRunBtn').disabled = true; $('benchStopBtn').disabled = false;
    var prog = $('benchProgress'); prog.style.display = 'block'; prog.max = n; prog.value = 0;
    (function trial(i) {
      if (i >= n || bench.stop) { bench.running = false; $('benchRunBtn').disabled = false; $('benchStopBtn').disabled = true; prog.style.display = 'none'; renderBench(); return; }
      var sx = (Math.random() * 2 - 1) * 70, sy = (Math.random() * 2 - 1) * 50, rot = (Math.random() * 2 - 1) * 35;
      var sc = withScale ? 1 + (Math.random() * 2 - 1) * 0.03 : 1;
      var Ttrue = renderSimulatedInto(canvas, rec, img, sx, sy, rot, sc, stress);
      var t0 = performance.now();
      var res = Vision.matchRecipe(tpl, recipeRegions(rec), canvas, opts);
      var ms = performance.now() - t0;
      var tr = { i: i + 1, sx: sx, sy: sy, rot: rot, scale: sc, ok: res.ok, ms: ms };
      if (res.ok) {
        tr.errMm = Core.dist(Core.applySim(Ttrue, c), Core.applySim(res.T, c)) * station.mmPerPx;
        tr.errRot = res.thetaDeg - rot;
        tr.verify = verifyScore(tpl, rec, canvas, res.T);
        tr.pass = evaluateMatch(res, rec, tr.verify).pass;
        tr.method = res.method;
      }
      bench.trials.push(tr);
      prog.value = i + 1;
      if ((i + 1) % 5 === 0) renderBench();
      setTimeout(function () { trial(i + 1); }, 0);
    })(0);
  });
  $('benchStopBtn').addEventListener('click', function () { bench.stop = true; });

  function renderBench() {
    var tr = bench.trials;
    if (!tr.length) return;
    var ok = tr.filter(function (x) { return x.ok; });
    var errs = ok.map(function (x) { return x.errMm; }), rots = ok.map(function (x) { return Math.abs(x.errRot); });
    var acc = station.tol.accuracyMm;
    var good = ok.filter(function (x) { return x.errMm <= acc && x.pass; }).length;
    $('benchSummary').innerHTML = [
      stat(t('bench.success'), fmt(100 * good / tr.length, 0) + ' %', t('bench.successSub', { acc: acc, good: good, n: tr.length })),
      stat(t('bench.matched'), ok.length + ' / ' + tr.length, t('bench.matchedSub')),
      stat(t('bench.posErr'), errs.length ? fmt(Core.mean(errs), 2) + ' mm' : '—', errs.length ? t('bench.posErrSub', { p95: fmt(Core.percentile(errs, 0.95), 2), max: fmt(Math.max.apply(null, errs), 2) }) : ''),
      stat(t('bench.rotErr'), rots.length ? fmt(Core.mean(rots), 2) + ' °' : '—', rots.length ? t('bench.rotErrSub', { p95: fmt(Core.percentile(rots, 0.95), 2) }) : ''),
      stat(t('bench.time'), fmt(Core.mean(tr.map(function (x) { return x.ms; })), 0) + ' ms', t('bench.timeSub'))
    ].join('');
    $('benchChartWrap').hidden = false;
    drawHistogram($('benchChart'), $('benchTip'), errs, acc);
    $('benchTable').innerHTML = '<table class="data-table"><tr><th>#</th><th>' + t('bench.colShift') + '</th><th>' + t('bench.colRot') + '</th><th>' + t('bench.colErr') + '</th><th>' + t('bench.colRotErr') + '</th><th>' + t('bench.colVerify') + '</th><th>' + t('bench.colResult') + '</th></tr>' +
      tr.map(function (x) {
        var res = !x.ok ? t('bench.resNoMatch') : !x.pass ? t('bench.resRejected') : x.errMm <= acc ? t('bench.resOk') : t('bench.resInaccurate');
        return '<tr><td>' + x.i + '</td><td>' + fmt(x.sx, 0) + ', ' + fmt(x.sy, 0) + '</td><td>' + fmt(x.rot, 1) + '</td><td>' + (x.ok ? fmt(x.errMm, 2) : '—') + '</td><td>' + (x.ok ? fmtSigned(x.errRot, 2) : '—') + '</td><td>' + (x.ok ? fmt(x.verify, 2) : '—') + '</td><td>' + res + '</td></tr>';
      }).join('') + '</table>';
  }

  // ---------- charts (canvas, dark surface) ----------

  var CHART = { ink: '#1B2430', muted: '#5F6B7A', grid: '#E6E9EE', axis: '#C3C7CF', series: '#2A78D6', critical: '#D03B3B' };

  function chartFont(ctx) { ctx.font = '11px -apple-system, Segoe UI, Roboto, Arial, sans-serif'; }

  /** Canvas pixel position of a mouse event (canvases are CSS-scaled to their container). */
  function canvasPoint(canvas, evt) {
    var r = canvas.getBoundingClientRect();
    return { x: (evt.clientX - r.left) * canvas.width / r.width, y: (evt.clientY - r.top) * canvas.height / r.height, cssX: evt.clientX - r.left, cssY: evt.clientY - r.top };
  }

  function showTip(tip, canvas, html, cssX, cssY) {
    tip.innerHTML = html;
    tip.style.display = 'block';
    var wrapW = canvas.parentNode.clientWidth;
    tip.style.left = Math.min(wrapW - tip.offsetWidth - 4, Math.max(4, cssX + 12)) + 'px';
    tip.style.top = Math.max(4, cssY - 30) + 'px';
  }

  function roundTopRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  /** Histogram of position errors with the accuracy target marked; per-bar hover tooltip. */
  function drawHistogram(canvas, tip, errs, acc) {
    var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    var m = { l: 34, r: 10, t: 12, b: 30 };
    ctx.clearRect(0, 0, w, h); chartFont(ctx);
    if (!errs.length) { ctx.fillStyle = CHART.muted; ctx.fillText(t('bench.noData'), m.l, h / 2); canvas._bars = []; return; }
    var maxE = Math.max(acc * 2, Math.max.apply(null, errs)) * 1.0001, bins = 12, bw = maxE / bins;
    var counts = new Array(bins).fill(0);
    errs.forEach(function (e) { counts[Math.min(bins - 1, Math.floor(e / bw))]++; });
    var pw = w - m.l - m.r, ph = h - m.t - m.b;
    var tickStep = Math.max(1, Math.ceil(Math.max.apply(null, counts) / 4));
    var yTicks = Math.ceil(Math.max.apply(null, counts) / tickStep), maxC = tickStep * yTicks;
    ctx.strokeStyle = CHART.grid; ctx.lineWidth = 1; ctx.fillStyle = CHART.muted; ctx.textAlign = 'right';
    for (var k = 0; k <= yTicks; k++) {
      var v = k * tickStep, y = m.t + ph - ph * v / maxC;
      ctx.beginPath(); ctx.moveTo(m.l, y + 0.5); ctx.lineTo(w - m.r, y + 0.5); ctx.stroke();
      ctx.fillText(v, m.l - 6, y + 4);
    }
    var bars = [], slot = pw / bins;
    counts.forEach(function (cnt, i) {
      var x = m.l + i * slot + 1, bwPx = slot - 2, bh = ph * cnt / maxC;
      bars.push({ x: x, w: bwPx, from: i * bw, to: (i + 1) * bw, count: cnt });
      if (!cnt) return;
      ctx.fillStyle = CHART.series;
      roundTopRect(ctx, x, m.t + ph - bh, bwPx, bh, 4); ctx.fill();
    });
    ctx.strokeStyle = CHART.axis; ctx.beginPath(); ctx.moveTo(m.l, m.t + ph + 0.5); ctx.lineTo(w - m.r, m.t + ph + 0.5); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = CHART.muted;
    for (var j = 0; j <= 4; j++) ctx.fillText(fmt(maxE * j / 4, 1), m.l + pw * j / 4, h - 14);
    ctx.fillText(t('bench.axisErr'), m.l + pw / 2, h - 2);
    var ax = m.l + pw * acc / maxE;
    ctx.strokeStyle = CHART.ink; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(ax + 0.5, m.t); ctx.lineTo(ax + 0.5, m.t + ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'left'; ctx.fillStyle = CHART.ink; ctx.fillText(t('bench.target', { acc: acc }), Math.min(ax + 4, w - 90), m.t + 10);
    canvas._bars = bars;
    if (!canvas._hover) {
      canvas._hover = true;
      canvas.addEventListener('mousemove', function (evt) {
        var p = canvasPoint(canvas, evt), hit = (canvas._bars || []).filter(function (b) { return p.x >= b.x - 1 && p.x <= b.x + b.w + 1; })[0];
        if (!hit) { tip.style.display = 'none'; return; }
        showTip(tip, canvas, t('bench.tip', { from: fmt(hit.from, 2), to: fmt(hit.to, 2), n: hit.count }), p.cssX, p.cssY);
      });
      canvas.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
    }
  }

  // ---------- cycle log ----------

  var logEntries = [];
  var LOG_MAX = 500;

  function thumbOf(canvas) {
    var c = makeCanvas(112, 72);
    c.getContext('2d').drawImage(canvas, 0, 0, 112, 72);
    return c.toDataURL('image/jpeg', 0.7);
  }

  function addLogEntry(entry) {
    entry.time = Date.now();
    if (preRunHasCurrent) entry.thumb = thumbOf(preRunCurrentCanvas);
    return store.addLog(entry).then(function (id) {
      entry.id = id;
      logEntries.push(entry);
      if (logEntries.length > LOG_MAX) logEntries.splice(0, logEntries.length - LOG_MAX);
      store.trimLog(LOG_MAX).catch(function () { });
      renderLog();
      return id;
    }, function (e) { console.error('Log write failed:', e); return null; });
  }

  function updateLogEntry(id, fields) {
    var e = logEntries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    Object.keys(fields).forEach(function (k) { e[k] = fields[k]; });
    store.putLog(e).catch(function (err) { console.error(err); });
    renderLog();
  }

  function measured(e) { return e.kind === 'match' || e.kind === 'override'; }

  function verdictTag(v) {
    var cls = v === 'pass' || v === 'confirm' || v === 'inspectPass' ? 'pass' : v === 'override' ? 'warn' : 'fail';
    var icon = cls === 'pass' ? '✓ ' : cls === 'warn' ? '⚠ ' : '✗ ';
    return '<span class="tag ' + cls + '">' + icon + t('log.v_' + v) + '</span>';
  }

  function renderLog() {
    var recent = logEntries.slice(-50);
    var meas = recent.filter(measured);
    document.querySelectorAll('.trend-chart').forEach(function (canvas) {
      var key = canvas.getAttribute('data-series');
      var lim = key === 'rot' ? station.tol.maxRotDeg : station.tol.maxShiftMm;
      drawTrend(canvas, canvas.parentNode.querySelector('.chart-tip'), meas, key, lim);
    });
    renderDrift(meas);
    var table = $('logTable');
    if (!logEntries.length) { table.innerHTML = '<tr><td>' + t('log.empty') + '</td></tr>'; return; }
    var rows = logEntries.slice(-40).reverse().map(function (e) {
      var d = new Date(e.time);
      return '<tr><td>' + (e.thumb ? '<img alt="" src="' + e.thumb + '">' : '') + '</td><td>' + e.id + '</td><td>' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString() +
        '</td><td>' + escapeHtml(e.recipe || '') + '</td><td>' + verdictTag(e.verdict) + '</td><td>' +
        (measured(e) ? fmtSigned(e.shiftX, 1) + ', ' + fmtSigned(e.shiftY, 1) : '—') + '</td><td>' + (measured(e) ? fmtSigned(e.rot, 2) : '—') +
        '</td><td>' + (measured(e) ? fmt(e.score * 100, 0) + ' %' : '—') + '</td><td>' + (e.coverage != null ? fmt(e.coverage, 1) + ' %' : '—') +
        '</td><td>' + (e.inspect ? verdictTag(e.inspect === 'pass' ? 'inspectPass' : 'inspectFail') : '—') + '</td></tr>';
    }).join('');
    table.innerHTML = '<tr><th></th><th>#</th><th>' + t('log.colTime') + '</th><th>' + t('log.colRecipe') + '</th><th>' + t('log.colVerdict') + '</th><th>' +
      t('log.colShift') + '</th><th>' + t('log.colRot') + '</th><th>' + t('log.colScore') + '</th><th>' + t('log.colCoverage') + '</th><th>' + t('log.colInspect') + '</th></tr>' + rows;
  }

  /** Drift = least-squares slope over the last 20 measured cycles, projected 10 cycles ahead and compared with the limit. */
  function renderDrift(meas) {
    var box = $('driftBox'), last = meas.slice(-20), msgs = [];
    if (last.length >= 8) {
      [['x', 'shiftX', station.tol.maxShiftMm, 'mm'], ['y', 'shiftY', station.tol.maxShiftMm, 'mm'], ['rot', 'rot', station.tol.maxRotDeg, '°']].forEach(function (s) {
        var ys = last.map(function (e) { return e[s[1]]; });
        var tr = Core.linearTrend(ys);
        // report only what is both big enough to matter and clearly above the cycle-to-cycle scatter (3 standard errors)
        if (Math.abs(tr.slope) * 10 >= 0.25 * s[2] && Math.abs(tr.slope) >= 3 * tr.slopeSE) msgs.push(t('log.driftSlope', { axis: { k: 'log.axis_' + s[0] }, v: fmtSigned(tr.slope, 2), u: s[3] }));
        else if (Math.abs(tr.mean) >= 0.5 * s[2] && Math.abs(tr.mean) >= 3 * tr.meanSE) msgs.push(t('log.driftOffset', { axis: { k: 'log.axis_' + s[0] }, v: fmtSigned(tr.mean, 1), u: s[3] }));
      });
    }
    if (!meas.length) { box.innerHTML = ''; return; }
    box.innerHTML = msgs.length
      ? '<div class="verdict warn drift">⚠ ' + msgs.map(escapeHtml).join(' · ') + '</div>'
      : '<div class="verdict pass drift">✓ ' + t(last.length >= 8 ? 'log.noDrift' : 'log.needMore', { n: last.length }) + '</div>';
  }

  /** One small-multiple trend line (single series), limit lines dashed, rejected/overridden cycles marked red; crosshair tooltip. */
  function drawTrend(canvas, tip, entries, key, lim) {
    var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    var m = { l: 40, r: 8, t: 8, b: 20 };
    ctx.clearRect(0, 0, w, h); chartFont(ctx);
    var field = key === 'x' ? 'shiftX' : key === 'y' ? 'shiftY' : 'rot';
    canvas._pts = [];
    if (!entries.length) { ctx.fillStyle = CHART.muted; ctx.textAlign = 'left'; ctx.fillText(t('log.noData'), m.l, h / 2); return; }
    var vals = entries.map(function (e) { return e[field]; });
    var ext = Core.niceCeil(Math.max(lim * 1.1, Math.max.apply(null, vals.map(Math.abs)) * 1.1, 1));
    var pw = w - m.l - m.r, ph = h - m.t - m.b;
    function X(i) { return m.l + (entries.length === 1 ? pw / 2 : pw * i / (entries.length - 1)); }
    function Y(v) { return m.t + ph / 2 - (v / ext) * ph / 2; }
    ctx.textAlign = 'right'; ctx.fillStyle = CHART.muted; ctx.lineWidth = 1;
    [-ext, -ext / 2, 0, ext / 2, ext].forEach(function (v) {
      ctx.strokeStyle = v === 0 ? CHART.axis : CHART.grid;
      ctx.beginPath(); ctx.moveTo(m.l, Math.round(Y(v)) + 0.5); ctx.lineTo(w - m.r, Math.round(Y(v)) + 0.5); ctx.stroke();
      ctx.fillText(fmt(v, Math.abs(ext) < 10 ? 1 : 0), m.l - 5, Y(v) + 4);
    });
    ctx.strokeStyle = CHART.muted; ctx.setLineDash([4, 4]);
    [lim, -lim].forEach(function (v) { ctx.beginPath(); ctx.moveTo(m.l, Y(v)); ctx.lineTo(w - m.r, Y(v)); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.strokeStyle = CHART.series; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    entries.forEach(function (e, i) { if (i === 0) ctx.moveTo(X(i), Y(e[field])); else ctx.lineTo(X(i), Y(e[field])); });
    ctx.stroke();
    entries.forEach(function (e, i) {
      var bad = e.verdict !== 'pass';
      ctx.fillStyle = bad ? CHART.critical : CHART.series;
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(i), Y(e[field]), bad ? 5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      canvas._pts.push({ x: X(i), y: Y(e[field]), e: e });
    });
    ctx.textAlign = 'left'; ctx.fillStyle = CHART.muted;
    ctx.fillText('#' + entries[0].id, m.l, h - 4);
    ctx.textAlign = 'right'; ctx.fillText('#' + entries[entries.length - 1].id, w - m.r, h - 4);
    canvas._field = field;
    if (!canvas._hover) {
      canvas._hover = true;
      canvas.addEventListener('mousemove', function (evt) {
        var p = canvasPoint(canvas, evt), pts = canvas._pts || [];
        if (!pts.length) return;
        var best = pts.reduce(function (a, b) { return Math.abs(b.x - p.x) < Math.abs(a.x - p.x) ? b : a; });
        var e = best.e, unit = canvas._field === 'rot' ? '°' : 'mm';
        showTip(tip, canvas, '#' + e.id + ' · ' + new Date(e.time).toLocaleTimeString() + '<br>' + fmtSigned(e[canvas._field], 2) + ' ' + unit + ' · ' + t('log.v_' + e.verdict), p.cssX, p.cssY);
        drawTrend(canvas, tip, canvas._entries, canvas._key, canvas._lim);
        ctx.strokeStyle = CHART.ink; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(best.x + 0.5, m.t); ctx.lineTo(best.x + 0.5, h - m.b); ctx.stroke();
      });
      canvas.addEventListener('mouseleave', function () { tip.style.display = 'none'; drawTrend(canvas, tip, canvas._entries, canvas._key, canvas._lim); });
    }
    canvas._entries = entries; canvas._key = key; canvas._lim = lim;
  }

  $('logExportBtn').addEventListener('click', function () {
    var cols = ['id', 'time', 'recipe', 'kind', 'verdict', 'method', 'shiftX', 'shiftY', 'rot', 'scalePct', 'score', 'inliers', 'verify', 'features', 'coverage', 'inSpec', 'paintMl', 'cycleS', 'inspect', 'missedPct'];
    var lines = [cols.join(',')].concat(logEntries.map(function (e) {
      return cols.map(function (c) {
        var v = c === 'time' ? new Date(e.time).toISOString() : e[c];
        if (v == null) return '';
        if (typeof v === 'number') return Math.round(v * 1000) / 1000;
        return '"' + String(v).replace(/"/g, '""') + '"';
      }).join(',');
    }));
    download('isd-cycle-log-' + new Date().toISOString().slice(0, 10) + '.csv', lines.join('\n') + '\n', 'text/csv');
  });
  $('logClearBtn').addEventListener('click', function () {
    if (!logEntries.length || !confirm(t('log.confirmClear'))) return;
    logEntries = [];
    store.clearLog().catch(function (e) { console.error(e); });
    renderLog();
  });

  // ---------- OpenCV.js readiness ----------

  var cvButtons = [matchBtn, combineFindContoursBtn, runDemoBtn, identifyBtn, $('benchRunBtn')];
  cvButtons.forEach(function (b) { b.disabled = true; });
  setStatus(matchStatus, 'prerun.cvLoadingInitial', null, 'busy');
  var cvPoll = setInterval(function () {
    if (!Vision.ready()) return;
    clearInterval(cvPoll);
    cvButtons.forEach(function (b) { b.disabled = false; });
    setStatus(matchStatus, 'prerun.cvReady', null, 'ok');
    if (combinePrimary >= 0 && !combinePath.length) regenerateCombinePath();
  }, 250);

  // ---------- wizard ----------

  var STEP_COUNT = 6;
  var currentStep = 0;
  var stepButtons = Array.prototype.slice.call(document.querySelectorAll('.stepper .step'));
  var stepPanels = Array.prototype.slice.call(document.querySelectorAll('.step-panel'));
  var backBtn = $('backBtn'), nextBtn = $('nextBtn'), navHint = $('navHint');

  /** Whether each step's job is done - drives the check marks, the hint and how strongly Next is offered. */
  function stepDone(i) {
    switch (i) {
      case 0: return recipeNames().length > 0;
      case 1: return !!preRunRecipe && preRunHasCurrent;
      case 2: return !!applied;
      case 3: return !!(applied && applied.done);
      case 4: return !!(inspection && inspection.result);
      default: return false;
    }
  }

  function renderStepper() {
    stepButtons.forEach(function (b, i) {
      var done = stepDone(i), cur = i === currentStep;
      b.classList.toggle('current', cur);
      b.classList.toggle('done', done && !cur);
      if (cur) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      b.querySelector('.step-num').textContent = done && !cur ? '✓' : String(i + 1);
    });
    var last = currentStep === STEP_COUNT - 1, done = stepDone(currentStep);
    backBtn.disabled = currentStep === 0;
    nextBtn.textContent = last ? t('wiz.nextPart') : t('wiz.next', { step: t('wiz.s' + (currentStep + 1)) });
    nextBtn.className = 'dark' + (done || last ? '' : ' soft');
    navHint.textContent = last ? t('wiz.hDone5') : done ? t('wiz.hDone', { step: t('wiz.s' + (currentStep + 1)) }) : t('wiz.h' + currentStep);
    $('headerRecipe').textContent = preRunRecipe ? preRunRecipe.rec.name : '—';
  }

  /** Shows one step. Steps 2 and 3 share the current-photo canvas, which moves into the shown step. */
  function goStep(i, quiet) {
    currentStep = Math.max(0, Math.min(STEP_COUNT - 1, i));
    stepPanels.forEach(function (p) { p.hidden = Number(p.getAttribute('data-step')) !== currentStep; });
    var slot = currentStep === 1 ? $('loadViewSlot') : currentStep === 2 ? $('alignViewSlot') : null;
    if (slot && $('preRunView').parentNode !== slot) slot.appendChild($('preRunView'));
    renderStepper();
    if (!quiet) $('wizardMain').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (currentStep === 3 && applied && !simRunning) renderResultFrame();
  }

  stepButtons.forEach(function (b, i) { b.addEventListener('click', function () { goStep(i); }); });
  backBtn.addEventListener('click', function () { goStep(currentStep - 1); });
  // the last step loops back to loading the next part - the normal production cycle
  nextBtn.addEventListener('click', function () { goStep(currentStep === STEP_COUNT - 1 ? 1 : currentStep + 1); });

  var settingsDialog = $('settingsDialog');
  $('openSettingsBtn').addEventListener('click', function () {
    if (settingsDialog.showModal) settingsDialog.showModal(); else settingsDialog.setAttribute('open', '');
  });
  $('closeSettingsBtn').addEventListener('click', function () { if (settingsDialog.close) settingsDialog.close(); else settingsDialog.removeAttribute('open'); });
  settingsDialog.addEventListener('click', function (e) { if (e.target === settingsDialog) settingsDialog.close(); });

  // ---------- one-click full demo ----------

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** Walks the whole workflow, showing each wizard step: teach -> load part -> align -> spray -> inspect. */
  function runFullDemo() {
    if (!Vision.ready()) return;
    runDemoBtn.disabled = true;
    stopPathSimulation();
    goStep(0);
    sampleSelect.value = 'A';
    combineRefCanvas = makeWorkpieceCanvas('A');
    combineResetLayout();
    combineContourThreshold.value = 100; combineThresholdVal.textContent = '100';
    combineMinArea.value = 20; combineMinAreaVal.textContent = '20';
    combineProgram = Core.cloneProgram();
    fillProgramInputs();
    runFindContours();
    // also use the A1 marker as a second feature region, to show multi-feature matching
    combineKeeps.forEach(function (i) { if (combineFeatures.indexOf(i) === -1) combineFeatures.push(i); });
    afterRoleChange();

    var name = t('app.demoRecipeName');
    recipeNameInput.value = name;
    function done() { runDemoBtn.disabled = false; }
    saveCurrentRecipe(name, false).then(function (ok) {
      if (!ok) { done(); return; }
      wait(900).then(function () {
        goStep(1);
        loadPreRunRecipe(name, function () {
          randomizeShift(0.6);
          wait(1100).then(function () {
            goStep(2);
            var ev = runMatchAndApply();
            if (ev) renderGroundTruthBox();
            if (!ev || !applied) { done(); return; }
            wait(1400).then(function () {
              goStep(3);
              onSimulationFinished = function () {
                wait(700).then(function () {
                  goStep(4);
                  setAfterPhoto(simulatedAfterPhoto(), 'inspect.statusSimulated');
                  runInspection();
                  done();
                });
              };
              setViewMode('film');
              setTimeout(startPathSimulation, 400);
            });
          });
        });
      });
    });
  }
  runDemoBtn.addEventListener('click', runFullDemo);

  // ---------- language switching ----------

  var langEnBtn = $('langEnBtn'), langZhBtn = $('langZhBtn');

  function applyI18nStatic() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
    document.title = t('app.title');
    document.documentElement.lang = currentLang === 'zh-TW' ? 'zh-Hant' : 'en';
    langEnBtn.classList.toggle('active', currentLang === 'en');
    langZhBtn.classList.toggle('active', currentLang === 'zh-TW');
  }

  /** Re-renders everything demo.js writes itself - static labels are handled by applyI18nStatic(). */
  function refreshDynamicText() {
    statusEls.forEach(function (el) { if (el._st) setStatus(el, el._st.key, el._st.vars, el._st.cls); });
    renderCombineContourList();
    renderCombineCanvas();
    refreshRecipeSelects();
    renderProgramStats();
    if (lastMatch) renderMatchResult();
    if (groundTruthBox.style.display !== 'none') renderGroundTruthBox();
    renderIdentify();
    if (applied) { renderResultFrame(); renderMetrics(); }
    renderInspection();
    renderBench();
    renderLog();
    renderStepper();
  }

  function setLang(lang) {
    if (lang === currentLang) return;
    currentLang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { }
    applyI18nStatic();
    refreshDynamicText();
  }

  langEnBtn.addEventListener('click', function () { setLang('en'); });
  langZhBtn.addEventListener('click', function () { setLang('zh-TW'); });

  // ---------- init ----------

  applyI18nStatic();
  fillProgramInputs();
  renderCombineCanvas();
  renderCombineContourList();
  renderProgramStats();
  renderFilmLegend();
  setStatus(simStatus, 'sim.statusInitial');
  setStatus(preRunFeatureStatus, 'prerun.noRecipeLoaded');
  resetInspection();
  wizardReady = true;
  goStep(0, true);

  Promise.all([store.getSetting('station'), store.getAllRecipes(), store.getLog()]).then(function (r) {
    if (r[0]) {
      var saved = r[0];
      Object.keys(saved).forEach(function (k) {
        if (saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k]) && DEFAULT_STATION[k] && typeof DEFAULT_STATION[k] === 'object' && k !== 'camToRobot') {
          Object.keys(saved[k]).forEach(function (kk) { station[k][kk] = saved[k][kk]; });
        } else station[k] = saved[k];
      });
    }
    (r[1] || []).forEach(function (rec) { recipes[rec.name] = normalizeRecipe(rec); });
    logEntries = (r[2] || []).slice(-LOG_MAX);
    fillStationInputs();
    renderExportHint();
    renderFilmLegend();
    refreshRecipeSelects();
    renderLog();
    renderStepper();
  }).catch(function (e) {
    console.error('Loading saved data failed:', e);
    fillStationInputs();
    refreshRecipeSelects();
    renderLog();
  });

  } // end startApp
})();
