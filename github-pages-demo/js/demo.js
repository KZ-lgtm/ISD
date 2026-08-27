(function () {
  'use strict';

  var W = 560, H = 360;
  var CX = W / 2, CY = H / 2;

  // ---------- synthetic workpiece photo ----------

  function drawWorkpiece(ctx, shiftX, shiftY, rotateDeg) {
    ctx.fillStyle = '#3a4358';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(CX + shiftX, CY + shiftY);
    ctx.rotate(rotateDeg * Math.PI / 180);
    ctx.translate(-CX, -CY);

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
          var rw = cw * 0.5, rh = ch * 0.5;
          var rx = px + c * cw + cw * 0.25, ry = py + r * ch + ch * 0.25;
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = '#2a3550';
          ctx.lineWidth = 1;
          ctx.strokeRect(rx, ry, rw, rh);
        }
      }
    }

    // distinctive asymmetric marker - the natural feature-region target
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(px + 10, py + 10, 46, 46);
    ctx.fillStyle = '#fc8181';
    ctx.beginPath();
    ctx.arc(px + 10 + 14, py + 10 + 14, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('A1', px + 10 + 18, py + 10 + 40);

    ctx.restore();
  }

  function makeWorkpieceCanvas(shiftX, shiftY, rotateDeg) {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    drawWorkpiece(c.getContext('2d'), shiftX, shiftY, rotateDeg);
    return c;
  }

  // ---------- path presets ----------

  var arcPoints = [];
  for (var i = 0; i <= 10; i++) {
    var t = (i / 10) * Math.PI;
    arcPoints.push([40 - 40 * Math.cos(t), -40 * Math.sin(t)]);
  }

  var PATH_PRESETS = {
    line: { label: 'Line', color: '#4fd1c5', points: [[0, 0], [90, 0]] },
    zigzag: { label: 'Zigzag', color: '#f6ad55', points: [[0, 0], [20, -18], [40, 18], [60, -18], [80, 18], [100, 0]] },
    arc: { label: 'Arc', color: '#68d391', points: arcPoints }
  };

  var CONTOUR_PATH_COLOR = '#63b3ed';

  function tileAbsolutePoints(tile) {
    if (tile.preset === 'contour') return tile.points;
    var preset = PATH_PRESETS[tile.preset];
    return preset.points.map(function (p) { return { x: tile.x + p[0], y: tile.y + p[1] }; });
  }

  function tileColor(tile) {
    return tile.preset === 'contour' ? CONTOUR_PATH_COLOR : PATH_PRESETS[tile.preset].color;
  }

  function tileIsClosedLoop(tile) {
    return tile.preset === 'contour';
  }

  function sampleContourPoints(points, count) {
    if (!points || points.length === 0) return [];
    count = Math.max(1, Math.min(count, points.length));
    if (count >= points.length) return points.slice();
    var result = [];
    var step = points.length / count;
    for (var i = 0; i < count; i++) result.push(points[Math.floor(i * step)]);
    return result;
  }

  function drawTilePath(ctx, tile, colorOverride) {
    var color = colorOverride || tileColor(tile);
    var pts = tileAbsolutePoints(tile);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach(function (p, idx) { if (idx === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    if (tileIsClosedLoop(tile)) ctx.closePath();
    ctx.stroke();
    pts.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawTransformedTilePath(ctx, tile, transform, colorOverride) {
    var color = colorOverride || tileColor(tile);
    var rad = transform.thetaDeg * Math.PI / 180;
    var a = Math.cos(rad), b = Math.sin(rad);
    var pts = tileAbsolutePoints(tile).map(function (p) {
      return { x: a * p.x - b * p.y + transform.dx, y: b * p.x + a * p.y + transform.dy };
    });
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach(function (p, idx) { if (idx === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    if (tileIsClosedLoop(tile)) ctx.closePath();
    ctx.stroke();
    pts.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function strokeContourPathOn(ctx, points, color, width) {
    if (!points || points.length === 0) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function loadFileAsImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () { cb(img); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function fitImageIntoCanvas(img, canvas) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a2130';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    var dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  }

  function drawFeatureRect(ctx, fr, color) {
    if (!fr) return;
    ctx.save();
    ctx.strokeStyle = color || '#f6ad55';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(fr.x, fr.y, fr.w, fr.h);
    ctx.restore();
  }

  function canvasPointFromEvent(canvas, evt) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    return { x: (evt.clientX - rect.left) * sx, y: (evt.clientY - rect.top) * sy };
  }

  function normalizeRect(a, b) {
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    var w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    return { x: x, y: y, w: w, h: h };
  }

  /** Draws the fr crop at its native pixel size (no scaling, no aspect-ratio change), centered in previewCanvas. Returns the {dx,dy} offset used, so callers can align overlays in the same coordinate space, or null if nothing was drawn. */
  function drawCropToPreview(sourceCanvasOrImg, fr, previewCanvas) {
    var pctx = previewCanvas.getContext('2d');
    pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    if (!fr || fr.w < 2 || fr.h < 2) return null;
    var dx = (previewCanvas.width - fr.w) / 2;
    var dy = (previewCanvas.height - fr.h) / 2;
    pctx.drawImage(sourceCanvasOrImg, fr.x, fr.y, fr.w, fr.h, dx, dy, fr.w, fr.h);
    return { dx: dx, dy: dy };
  }

  // ---------- recipe storage ----------

  var STORAGE_KEY = 'ispDemoRecipes';

  function loadRecipes() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveRecipes(recipes) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
  }
  function refreshRecipeSelects() {
    var recipes = loadRecipes();
    var names = Object.keys(recipes);
    [combineRecipeSelect, preRunRecipeSelect].forEach(function (sel) {
      var prev = sel.value;
      sel.innerHTML = '';
      if (names.length === 0) {
        var opt = document.createElement('option');
        opt.textContent = '(no saved recipes)';
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

  // ---------- DOM refs ----------

  var combineCanvas = document.getElementById('combineCanvas');
  var combineCtx = combineCanvas.getContext('2d');
  var combineFeaturePreview = document.getElementById('combineFeaturePreview');
  var combineFeatureStatus = document.getElementById('combineFeatureStatus');
  var drawFeatureBtn = document.getElementById('drawFeatureBtn');
  var clearFeatureBtn = document.getElementById('clearFeatureBtn');
  var combineImageUpload = document.getElementById('combineImageUpload');
  var resetSyntheticImageBtn = document.getElementById('resetSyntheticImageBtn');
  var combineContourThreshold = document.getElementById('combineContourThreshold');
  var combineThresholdVal = document.getElementById('combineThresholdVal');
  var combineFindContoursBtn = document.getElementById('combineFindContoursBtn');
  var combineContourList = document.getElementById('combineContourList');
  var recipeNameInput = document.getElementById('recipeNameInput');
  var saveRecipeBtn = document.getElementById('saveRecipeBtn');
  var combineRecipeSelect = document.getElementById('combineRecipeSelect');
  var combineLoadRecipeBtn = document.getElementById('combineLoadRecipeBtn');
  var combineDeleteRecipeBtn = document.getElementById('combineDeleteRecipeBtn');
  var combineStatus = document.getElementById('combineStatus');

  var preRunRecipeCanvas = document.getElementById('preRunRecipeCanvas');
  var preRunRecipeCtx = preRunRecipeCanvas.getContext('2d');
  var preRunFeaturePreview = document.getElementById('preRunFeaturePreview');
  var preRunFeatureStatus = document.getElementById('preRunFeatureStatus');
  var preRunRecipeSelect = document.getElementById('preRunRecipeSelect');
  var preRunLoadRecipeBtn = document.getElementById('preRunLoadRecipeBtn');
  var preRunCurrentCanvas = document.getElementById('preRunCurrentCanvas');
  var preRunCurrentCtx = preRunCurrentCanvas.getContext('2d');

  var simShiftX = document.getElementById('simShiftX'), simShiftXVal = document.getElementById('simShiftXVal');
  var simShiftY = document.getElementById('simShiftY'), simShiftYVal = document.getElementById('simShiftYVal');
  var simRotate = document.getElementById('simRotate'), simRotateVal = document.getElementById('simRotateVal');
  var randomizeShiftBtn = document.getElementById('randomizeShiftBtn');
  var generateCurrentBtn = document.getElementById('generateCurrentBtn');
  var uploadCurrentInput = document.getElementById('uploadCurrentInput');

  var matchBtn = document.getElementById('matchBtn');
  var confirmPathBtn = document.getElementById('confirmPathBtn');
  var matchStatus = document.getElementById('matchStatus');
  var matchResultBox = document.getElementById('matchResultBox');
  var resultDx = document.getElementById('resultDx'), resultDy = document.getElementById('resultDy');
  var resultTheta = document.getElementById('resultTheta'), resultInliers = document.getElementById('resultInliers');
  var resultScore = document.getElementById('resultScore');
  var revealGroundTruthBtn = document.getElementById('revealGroundTruthBtn');
  var groundTruthBox = document.getElementById('groundTruthBox');

  var resultCanvas = document.getElementById('resultCanvas');
  var resultCtx = resultCanvas.getContext('2d');

  function setStatus(el, msg, cls) {
    el.textContent = msg;
    el.className = 'status-line' + (cls ? ' ' + cls : '');
  }

  // ---------- combine state ----------

  var combineRefCanvas = makeWorkpieceCanvas(0, 0, 0);
  var combineTiles = [];
  var combineFeatureRegion = null;
  var combineSelectingFeature = false;
  var combineDragStart = null;
  var combineDragCurrent = null;
  var combineContourData = []; // [{ points:[{x,y}], area, rect:{x,y,w,h} }], largest first
  var combineSelectedContourIndex = -1;

  function combineResetLayout(msg) {
    combineTiles = [];
    combineFeatureRegion = null;
    combineContourData = [];
    combineSelectedContourIndex = -1;
    combineRenderFeaturePreview();
    setStatus(combineFeatureStatus, 'No feature region selected');
    renderCombineContourList();
    if (msg) setStatus(combineStatus, msg);
  }

  /** Draws the current feature-region crop at native size, plus the auto-generated contour path (if any) overlaid in the same coordinate space. */
  function combineRenderFeaturePreview() {
    var offset = drawCropToPreview(combineRefCanvas, combineFeatureRegion, combineFeaturePreview);
    if (!offset || !combineFeatureRegion) return;
    var contourTile = combineTiles.filter(function (t) { return t.preset === 'contour'; })[0];
    if (!contourTile) return;
    var fr = combineFeatureRegion;
    var pctx = combineFeaturePreview.getContext('2d');
    var pts = contourTile.points.map(function (p) { return { x: p.x - fr.x + offset.dx, y: p.y - fr.y + offset.dy }; });
    pctx.strokeStyle = CONTOUR_PATH_COLOR;
    pctx.fillStyle = CONTOUR_PATH_COLOR;
    pctx.lineWidth = 2.5;
    pctx.beginPath();
    pts.forEach(function (p, idx) { if (idx === 0) pctx.moveTo(p.x, p.y); else pctx.lineTo(p.x, p.y); });
    pctx.closePath();
    pctx.stroke();
    pts.forEach(function (p) {
      pctx.beginPath();
      pctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      pctx.fill();
    });
  }

  function renderCombineCanvas() {
    combineCtx.clearRect(0, 0, W, H);
    combineCtx.drawImage(combineRefCanvas, 0, 0);
    combineContourData.forEach(function (c, i) {
      if (i === combineSelectedContourIndex) return;
      strokeContourPathOn(combineCtx, c.points, '#68d391', 1.2);
    });
    if (combineSelectedContourIndex >= 0 && combineContourData[combineSelectedContourIndex]) {
      strokeContourPathOn(combineCtx, combineContourData[combineSelectedContourIndex].points, '#4fd1c5', 2.5);
    }
    combineTiles.forEach(function (tile) { drawTilePath(combineCtx, tile); });
    if (combineSelectingFeature && combineDragStart && combineDragCurrent) {
      drawFeatureRect(combineCtx, normalizeRect(combineDragStart, combineDragCurrent), '#4fd1c5');
    } else if (combineFeatureRegion) {
      drawFeatureRect(combineCtx, combineFeatureRegion, '#f6ad55');
    }
  }

  combineCanvas.addEventListener('mousedown', function (evt) {
    var pt = canvasPointFromEvent(combineCanvas, evt);
    if (combineSelectingFeature) {
      combineDragStart = pt;
      combineDragCurrent = pt;
    }
  });
  combineCanvas.addEventListener('mousemove', function (evt) {
    if (combineSelectingFeature && combineDragStart) {
      combineDragCurrent = canvasPointFromEvent(combineCanvas, evt);
      renderCombineCanvas();
    }
  });
  combineCanvas.addEventListener('mouseup', function (evt) {
    var pt = canvasPointFromEvent(combineCanvas, evt);
    if (combineSelectingFeature && combineDragStart) {
      var rect = normalizeRect(combineDragStart, pt);
      combineDragStart = null; combineDragCurrent = null;
      combineSelectingFeature = false;
      if (rect.w > 8 && rect.h > 8) {
        combineFeatureRegion = rect;
        combineSelectedContourIndex = -1;
        combineTiles = combineTiles.filter(function (t) { return t.preset !== 'contour'; });
        renderCombineContourList();
        combineRenderFeaturePreview();
        setStatus(combineFeatureStatus, 'Feature region set (' + Math.round(rect.w) + '×' + Math.round(rect.h) + ' px)');
        setStatus(combineStatus, 'Feature region saved.', 'ok');
      } else {
        setStatus(combineStatus, 'Region too small, try again.', 'err');
      }
      renderCombineCanvas();
    }
  });

  drawFeatureBtn.addEventListener('click', function () {
    combineSelectingFeature = true;
    setStatus(combineStatus, 'Drag a rectangle over a small, distinctive area of the photo.');
  });
  clearFeatureBtn.addEventListener('click', function () {
    combineFeatureRegion = null;
    combineSelectedContourIndex = -1;
    combineTiles = combineTiles.filter(function (t) { return t.preset !== 'contour'; });
    renderCombineContourList();
    combineRenderFeaturePreview();
    setStatus(combineFeatureStatus, 'No feature region selected');
    renderCombineCanvas();
  });

  function combineApplyContour(index) {
    var c = combineContourData[index];
    if (!c) return;
    combineSelectedContourIndex = index;
    combineFeatureRegion = { x: c.rect.x, y: c.rect.y, w: c.rect.w, h: c.rect.h };
    combineTiles = combineTiles.filter(function (t) { return t.preset !== 'contour'; });
    combineTiles.push({ preset: 'contour', points: sampleContourPoints(c.points, 16) });
    combineRenderFeaturePreview();
    setStatus(combineFeatureStatus, 'Feature region + auto-generated path from contour #' + index + ' (' + Math.round(c.rect.w) + '×' + Math.round(c.rect.h) + ' px)');
    renderCombineContourList();
    renderCombineCanvas();
  }

  function renderCombineContourList() {
    combineContourList.innerHTML = '';
    if (combineContourData.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No contours found yet - click "Find contours".';
      combineContourList.appendChild(empty);
      return;
    }
    combineContourData.forEach(function (c, i) {
      var li = document.createElement('li');
      li.className = i === combineSelectedContourIndex ? 'selected' : '';
      var label = document.createElement('span');
      label.textContent = '#' + i;
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'area ' + Math.round(c.area) + ' px²';
      li.appendChild(label);
      li.appendChild(badge);
      li.addEventListener('click', function () { combineApplyContour(i); });
      combineContourList.appendChild(li);
    });
  }

  combineContourThreshold.addEventListener('input', function () {
    combineThresholdVal.textContent = combineContourThreshold.value;
  });

  combineFindContoursBtn.addEventListener('click', function () {
    if (!isCvReady()) { setStatus(combineStatus, 'OpenCV.js is still loading, please wait.', 'busy'); return; }
    var mats = [];
    function track(m) { mats.push(m); return m; }
    try {
      var src = track(cv.imread(combineRefCanvas));
      var gray = track(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      var binary = track(new cv.Mat());
      var t = parseInt(combineContourThreshold.value, 10);
      cv.threshold(gray, binary, t, 255, cv.THRESH_BINARY);
      var contours = track(new cv.MatVector());
      var hierarchy = track(new cv.Mat());
      cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      combineContourData = [];
      for (var i = 0; i < contours.size(); i++) {
        var c = contours.get(i);
        var area = cv.contourArea(c, false);
        if (area < 20) continue;
        var br = cv.boundingRect(c);
        var points = [];
        for (var j = 0; j < c.data32S.length; j += 2) points.push({ x: c.data32S[j], y: c.data32S[j + 1] });
        combineContourData.push({ points: points, area: area, rect: { x: br.x, y: br.y, w: br.width, h: br.height } });
      }
      combineContourData.sort(function (a, b) { return b.area - a.area; });

      renderCombineContourList();
      if (combineContourData.length > 0) {
        combineApplyContour(0);
        setStatus(combineStatus, combineContourData.length + ' contour(s) found - largest one auto-selected as the feature region. Pick a different row to change it.', 'ok');
      } else {
        combineSelectedContourIndex = -1;
        renderCombineCanvas();
        setStatus(combineStatus, 'No contours found - try a lower or higher threshold.', 'err');
      }
    } catch (ex) {
      setStatus(combineStatus, 'Find contours failed: ' + ex.message, 'err');
    } finally {
      mats.forEach(function (m) { try { m.delete(); } catch (e) { } });
    }
  });

  combineImageUpload.addEventListener('change', function (evt) {
    var file = evt.target.files && evt.target.files[0];
    if (!file) return;
    loadFileAsImage(file, function (img) {
      fitImageIntoCanvas(img, combineRefCanvas);
      combineResetLayout('Loaded your photo. Previous paths and feature region were cleared - place them again on the new photo.');
      renderCombineCanvas();
    });
  });

  resetSyntheticImageBtn.addEventListener('click', function () {
    combineRefCanvas = makeWorkpieceCanvas(0, 0, 0);
    combineResetLayout('Restored the built-in sample photo.');
    renderCombineCanvas();
  });

  saveRecipeBtn.addEventListener('click', function () {
    var name = recipeNameInput.value.trim();
    if (!name) { setStatus(combineStatus, 'Enter a recipe name first.', 'err'); return; }
    if (combineTiles.length === 0) { setStatus(combineStatus, 'Place at least one path before saving.', 'err'); return; }
    var recipes = loadRecipes();
    recipes[name] = {
      image: combineRefCanvas.toDataURL('image/png'),
      featureRegion: combineFeatureRegion,
      tiles: combineTiles
    };
    saveRecipes(recipes);
    refreshRecipeSelects();
    combineRecipeSelect.value = name;
    setStatus(combineStatus, 'Saved recipe "' + name + '".', 'ok');
  });

  combineLoadRecipeBtn.addEventListener('click', function () {
    var name = combineRecipeSelect.value;
    var recipes = loadRecipes();
    var data = recipes[name];
    if (!data) return;
    combineTiles = (data.tiles || []).slice();
    combineFeatureRegion = data.featureRegion || null;
    combineContourData = [];
    combineSelectedContourIndex = -1;
    renderCombineContourList();
    var img = new Image();
    img.onload = function () {
      combineRefCanvas.getContext('2d').clearRect(0, 0, W, H);
      combineRefCanvas.getContext('2d').drawImage(img, 0, 0, W, H);
      renderCombineCanvas();
      if (combineFeatureRegion) {
        combineRenderFeaturePreview();
        setStatus(combineFeatureStatus, 'Feature region set (' + Math.round(combineFeatureRegion.w) + '×' + Math.round(combineFeatureRegion.h) + ' px)');
      } else {
        combineRenderFeaturePreview();
        setStatus(combineFeatureStatus, 'No feature region selected');
      }
    };
    img.src = data.image;
    recipeNameInput.value = name;
    setStatus(combineStatus, 'Loaded recipe "' + name + '".', 'ok');
  });

  combineDeleteRecipeBtn.addEventListener('click', function () {
    var name = combineRecipeSelect.value;
    var recipes = loadRecipes();
    if (!recipes[name]) return;
    delete recipes[name];
    saveRecipes(recipes);
    refreshRecipeSelects();
    setStatus(combineStatus, 'Deleted recipe "' + name + '".');
  });

  // ---------- pre-run state ----------

  var preRunRecipe = null; // { imageObj, featureRegion, tiles }
  var groundTruth = null;
  var lastMatch = null;

  function renderPreRunRecipeCanvas() {
    preRunRecipeCtx.clearRect(0, 0, W, H);
    if (!preRunRecipe) return;
    preRunRecipeCtx.drawImage(preRunRecipe.imageObj, 0, 0, W, H);
    preRunRecipe.tiles.forEach(function (tile) { drawTilePath(preRunRecipeCtx, tile); });
    drawFeatureRect(preRunRecipeCtx, preRunRecipe.featureRegion, '#f6ad55');
  }

  /** Draws the recipe's feature-region crop at native size, plus its saved contour path (if any) overlaid in the same coordinate space. */
  function preRunRenderFeaturePreview() {
    if (!preRunRecipe) { drawCropToPreview(null, null, preRunFeaturePreview); return; }
    var offset = drawCropToPreview(preRunRecipe.imageObj, preRunRecipe.featureRegion, preRunFeaturePreview);
    if (!offset || !preRunRecipe.featureRegion) return;
    var contourTile = preRunRecipe.tiles.filter(function (t) { return t.preset === 'contour'; })[0];
    if (!contourTile) return;
    var fr = preRunRecipe.featureRegion;
    var pctx = preRunFeaturePreview.getContext('2d');
    var pts = contourTile.points.map(function (p) { return { x: p.x - fr.x + offset.dx, y: p.y - fr.y + offset.dy }; });
    pctx.strokeStyle = CONTOUR_PATH_COLOR;
    pctx.fillStyle = CONTOUR_PATH_COLOR;
    pctx.lineWidth = 2.5;
    pctx.beginPath();
    pts.forEach(function (p, idx) { if (idx === 0) pctx.moveTo(p.x, p.y); else pctx.lineTo(p.x, p.y); });
    pctx.closePath();
    pctx.stroke();
    pts.forEach(function (p) {
      pctx.beginPath();
      pctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      pctx.fill();
    });
  }

  preRunLoadRecipeBtn.addEventListener('click', function () {
    var name = preRunRecipeSelect.value;
    var recipes = loadRecipes();
    var data = recipes[name];
    if (!data) return;
    var img = new Image();
    img.onload = function () {
      preRunRecipe = { imageObj: img, featureRegion: data.featureRegion || null, tiles: (data.tiles || []).slice() };
      renderPreRunRecipeCanvas();
      if (preRunRecipe.featureRegion) {
        preRunRenderFeaturePreview();
        setStatus(preRunFeatureStatus, 'Recipe "' + name + '" loaded');
      } else {
        preRunRenderFeaturePreview();
        setStatus(preRunFeatureStatus, 'Recipe has no feature region - matching will fail');
      }
      setStatus(matchStatus, 'Recipe loaded. Generate or upload a current photo, then run the match.');
      matchResultBox.style.display = 'none';
      resultCtx.clearRect(0, 0, W, H);
    };
    img.src = data.image;
  });

  function currentGroundTruthLabel(shiftX, shiftY, rotateDeg) {
    var rad = rotateDeg * Math.PI / 180;
    var a = Math.cos(rad), b = Math.sin(rad);
    var Tx = CX - (a * CX - b * CY) + shiftX;
    var Ty = CY - (b * CX + a * CY) + shiftY;
    return { shiftX: shiftX, shiftY: shiftY, rotateDeg: rotateDeg, Tx: Tx, Ty: Ty };
  }

  [simShiftX, simShiftY, simRotate].forEach(function (input) {
    input.addEventListener('input', function () {
      simShiftXVal.textContent = simShiftX.value;
      simShiftYVal.textContent = simShiftY.value;
      simRotateVal.textContent = simRotate.value;
    });
  });

  function generateCurrent() {
    var sx = parseFloat(simShiftX.value), sy = parseFloat(simShiftY.value), rot = parseFloat(simRotate.value);
    var c = makeWorkpieceCanvas(sx, sy, rot);
    preRunCurrentCtx.clearRect(0, 0, W, H);
    preRunCurrentCtx.drawImage(c, 0, 0);
    groundTruth = currentGroundTruthLabel(sx, sy, rot);
    matchResultBox.style.display = 'none';
    groundTruthBox.style.display = 'none';
    resultCtx.clearRect(0, 0, W, H);
    setStatus(matchStatus, 'Simulated current photo generated. Run the match to measure the deviation.');
  }

  generateCurrentBtn.addEventListener('click', generateCurrent);
  randomizeShiftBtn.addEventListener('click', function () {
    simShiftX.value = Math.round((Math.random() * 2 - 1) * 70);
    simShiftY.value = Math.round((Math.random() * 2 - 1) * 50);
    simRotate.value = Math.round((Math.random() * 2 - 1) * 35);
    simShiftXVal.textContent = simShiftX.value;
    simShiftYVal.textContent = simShiftY.value;
    simRotateVal.textContent = simRotate.value;
    generateCurrent();
  });

  uploadCurrentInput.addEventListener('change', function (evt) {
    var file = evt.target.files && evt.target.files[0];
    if (!file) return;
    loadFileAsImage(file, function (img) {
      fitImageIntoCanvas(img, preRunCurrentCanvas);
      groundTruth = null;
      matchResultBox.style.display = 'none';
      groundTruthBox.style.display = 'none';
      resultCtx.clearRect(0, 0, W, H);
      setStatus(matchStatus, 'Uploaded photo ready (no ground truth available for a real photo). Run the match.');
    });
  });

  // ---------- OpenCV.js readiness ----------

  function isCvReady() {
    return typeof cv !== 'undefined' && !!cv.Mat;
  }

  matchBtn.disabled = true;
  combineFindContoursBtn.disabled = true;
  setStatus(matchStatus, 'Loading OpenCV.js (WebAssembly, ~10 MB) - this can take a few seconds on first load...', 'busy');
  var cvPoll = setInterval(function () {
    if (isCvReady()) {
      clearInterval(cvPoll);
      matchBtn.disabled = false;
      combineFindContoursBtn.disabled = false;
      setStatus(matchStatus, 'OpenCV.js ready. Load a recipe, generate or upload a current photo, then run the match.', 'ok');
    }
  }, 250);

  // ---------- matching ----------

  function solveSimilarity2(p, q) {
    var dx1 = q.x1 - p.x1, dy1 = q.y1 - p.y1;
    var dx2 = q.x2 - p.x2, dy2 = q.y2 - p.y2;
    var denom = dx1 * dx1 + dy1 * dy1;
    if (denom < 1e-6) return null;
    var a = (dx1 * dx2 + dy1 * dy2) / denom;
    var b = (dx1 * dy2 - dy1 * dx2) / denom;
    var tx = p.x2 - (a * p.x1 - b * p.y1);
    var ty = p.y2 - (b * p.x1 + a * p.y1);
    return { a: a, b: b, tx: tx, ty: ty };
  }

  function leastSquaresSimilarity(pairs) {
    var n = pairs.length;
    var sumX1 = 0, sumY1 = 0, sumX2 = 0, sumY2 = 0;
    pairs.forEach(function (p) { sumX1 += p.x1; sumY1 += p.y1; sumX2 += p.x2; sumY2 += p.y2; });
    var mx1 = sumX1 / n, my1 = sumY1 / n, mx2 = sumX2 / n, my2 = sumY2 / n;
    var Sxx = 0, Sxy = 0, Syy = 0;
    pairs.forEach(function (p) {
      var cx1 = p.x1 - mx1, cy1 = p.y1 - my1, cx2 = p.x2 - mx2, cy2 = p.y2 - my2;
      Sxx += cx1 * cx2 + cy1 * cy2;
      Sxy += cx1 * cy2 - cy1 * cx2;
      Syy += cx1 * cx1 + cy1 * cy1;
    });
    if (Syy < 1e-6) return null;
    var a = Sxx / Syy, b = Sxy / Syy;
    var tx = mx2 - (a * mx1 - b * my1);
    var ty = my2 - (b * mx1 + a * my1);
    return { a: a, b: b, tx: tx, ty: ty };
  }

  function ransacSimilarity(pairs) {
    var n = pairs.length;
    var best = null;
    var inlierThresh = 6;
    for (var iter = 0; iter < 300; iter++) {
      var i1 = Math.floor(Math.random() * n);
      var i2 = Math.floor(Math.random() * n);
      if (i2 === i1) continue;
      var model = solveSimilarity2(pairs[i1], pairs[i2]);
      if (!model) continue;
      var inliers = [];
      for (var i = 0; i < n; i++) {
        var pr = pairs[i];
        var px = model.a * pr.x1 - model.b * pr.y1 + model.tx;
        var py = model.b * pr.x1 + model.a * pr.y1 + model.ty;
        if (Math.hypot(px - pr.x2, py - pr.y2) < inlierThresh) inliers.push(pr);
      }
      if (!best || inliers.length > best.inliers.length) best = { inliers: inliers };
    }
    if (!best || best.inliers.length < 2) return null;
    var refit = leastSquaresSimilarity(best.inliers);
    if (!refit) return null;
    var thetaRad = Math.atan2(refit.b, refit.a);
    return {
      tx: refit.tx, ty: refit.ty,
      thetaDeg: thetaRad * 180 / Math.PI,
      inlierCount: best.inliers.length,
      score: best.inliers.length / pairs.length
    };
  }

  function runMatch() {
    if (!isCvReady()) { setStatus(matchStatus, 'OpenCV.js is still loading, please wait.', 'busy'); return null; }
    if (!preRunRecipe) { setStatus(matchStatus, 'Load a recipe first.', 'err'); return null; }
    var fr = preRunRecipe.featureRegion;
    if (!fr) { setStatus(matchStatus, 'This recipe has no feature region.', 'err'); return null; }

    var mats = [];
    function track(m) { mats.push(m); return m; }

    try {
      var tCanvas = document.createElement('canvas');
      tCanvas.width = W; tCanvas.height = H;
      tCanvas.getContext('2d').drawImage(preRunRecipe.imageObj, 0, 0, W, H);

      var srcTemplate = track(cv.imread(tCanvas));
      var srcCurrent = track(cv.imread(preRunCurrentCanvas));
      var grayTemplate = track(new cv.Mat());
      var grayCurrent = track(new cv.Mat());
      cv.cvtColor(srcTemplate, grayTemplate, cv.COLOR_RGBA2GRAY);
      cv.cvtColor(srcCurrent, grayCurrent, cv.COLOR_RGBA2GRAY);

      var rect = new cv.Rect(Math.round(fr.x), Math.round(fr.y), Math.round(fr.w), Math.round(fr.h));
      var templateCrop = track(grayTemplate.roi(rect));

      var edge = Math.max(2, Math.min(15, Math.floor(Math.min(fr.w, fr.h) / 5)));
      var patch = Math.max(9, edge * 2 + 1);
      var orb = new cv.ORB(1500, 1.2, 8, edge, 0, 2, 0, patch, 5);
      var kp1 = track(new cv.KeyPointVector());
      var desc1 = track(new cv.Mat());
      var kp2 = track(new cv.KeyPointVector());
      var desc2 = track(new cv.Mat());
      var emptyMask = track(new cv.Mat());
      orb.detectAndCompute(templateCrop, emptyMask, kp1, desc1);
      orb.detectAndCompute(grayCurrent, emptyMask, kp2, desc2);
      orb.delete();

      if (desc1.rows < 2 || desc2.rows < 2) {
        setStatus(matchStatus, 'Not enough distinctive features found - try a smaller, more detailed feature region.', 'err');
        return null;
      }

      var bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
      var matches = track(new cv.DMatchVectorVector());
      bf.knnMatch(desc1, desc2, matches, 2);
      bf.delete();

      var goodPairs = [];
      for (var i = 0; i < matches.size(); i++) {
        var m = matches.get(i);
        if (m.size() < 2) continue;
        var m0 = m.get(0), m1 = m.get(1);
        if (m0.distance < 0.85 * m1.distance) {
          var p1 = kp1.get(m0.queryIdx).pt;
          var p2 = kp2.get(m0.trainIdx).pt;
          goodPairs.push({ x1: p1.x + fr.x, y1: p1.y + fr.y, x2: p2.x, y2: p2.y });
        }
      }

      if (goodPairs.length < 4) {
        setStatus(matchStatus, 'Too few good matches (' + goodPairs.length + ') to compute a reliable transform.', 'err');
        return null;
      }

      var fit = ransacSimilarity(goodPairs);
      if (!fit || fit.inlierCount < 4 || fit.score < 0.35) {
        setStatus(matchStatus, 'Match confidence too low (inliers ' + (fit ? fit.inlierCount : 0) + ', score ' + (fit ? fit.score.toFixed(2) : '0') + '). Try a more distinctive feature region.', 'err');
        return null;
      }

      return { dx: fit.tx, dy: fit.ty, thetaDeg: fit.thetaDeg, inliers: fit.inlierCount, totalMatches: goodPairs.length, score: fit.score };
    } finally {
      mats.forEach(function (m) { try { m.delete(); } catch (e) { } });
    }
  }

  function applyMatchToPath(match, statusLabel) {
    resultCtx.clearRect(0, 0, W, H);
    resultCtx.drawImage(preRunCurrentCanvas, 0, 0);
    preRunRecipe.tiles.forEach(function (tile) { drawTransformedTilePath(resultCtx, tile, match, '#4fd1c5'); });
    resultCtx.fillStyle = '#e6ebf5';
    resultCtx.font = 'bold 13px sans-serif';
    resultCtx.fillText(statusLabel, 10, 18);
  }

  matchBtn.addEventListener('click', function () {
    if (!preRunRecipe || preRunRecipe.tiles.length === 0) { setStatus(matchStatus, 'Load a recipe with at least one path first.', 'err'); return; }
    setStatus(matchStatus, 'Running ORB detection + RANSAC fit...', 'busy');
    setTimeout(function () {
      var match = runMatch();
      if (!match) return;
      lastMatch = match;
      resultDx.textContent = match.dx.toFixed(1) + ' px';
      resultDy.textContent = match.dy.toFixed(1) + ' px';
      resultTheta.textContent = match.thetaDeg.toFixed(2) + ' deg';
      resultInliers.textContent = match.inliers + ' / ' + match.totalMatches;
      resultScore.textContent = (match.score * 100).toFixed(0) + '%';
      resultInliers.className = 'v ' + (match.inliers >= 8 ? 'good' : '');
      resultScore.className = 'v ' + (match.score >= 0.5 ? 'good' : '');
      matchResultBox.style.display = 'block';
      revealGroundTruthBtn.disabled = !groundTruth;
      groundTruthBox.style.display = 'none';
      applyMatchToPath(match, 'Matched path (deviation applied)');
      setStatus(matchStatus, 'Match applied to the saved path.', 'ok');
    }, 30);
  });

  confirmPathBtn.addEventListener('click', function () {
    if (!preRunRecipe || preRunRecipe.tiles.length === 0) { setStatus(matchStatus, 'Load a recipe with at least one path first.', 'err'); return; }
    applyMatchToPath({ dx: 0, dy: 0, thetaDeg: 0 }, 'Confirmed path (no pattern match)');
    setStatus(matchStatus, 'Path confirmed with no adjustment - use only when you are certain the workpiece has not moved.', 'ok');
  });

  revealGroundTruthBtn.addEventListener('click', function () {
    if (!groundTruth || !lastMatch) return;
    var lines = [];
    lines.push('You dialed in: shift (' + groundTruth.shiftX + ', ' + groundTruth.shiftY + ') px, rotate ' + groundTruth.rotateDeg + ' deg.');
    lines.push('Expected measured translation about the image origin: (' + groundTruth.Tx.toFixed(1) + ', ' + groundTruth.Ty.toFixed(1) + ') px' + (groundTruth.rotateDeg !== 0 ? ' - differs from the raw shift because rotation is measured about the origin, the same convention the production system uses.' : '.'));
    lines.push('Detected: (' + lastMatch.dx.toFixed(1) + ', ' + lastMatch.dy.toFixed(1) + ') px, ' + lastMatch.thetaDeg.toFixed(2) + ' deg.');
    var errX = lastMatch.dx - groundTruth.Tx, errY = lastMatch.dy - groundTruth.Ty, errT = lastMatch.thetaDeg - groundTruth.rotateDeg;
    lines.push('Error: (' + errX.toFixed(1) + ', ' + errY.toFixed(1) + ') px, ' + errT.toFixed(2) + ' deg.');
    groundTruthBox.textContent = lines.join(' ');
    groundTruthBox.style.display = 'block';
  });

  // ---------- init ----------

  renderCombineCanvas();
  drawCropToPreview(combineRefCanvas, null, combineFeaturePreview);
  renderCombineContourList();
  refreshRecipeSelects();
})();
