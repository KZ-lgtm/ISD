(function () {
  'use strict';

  // ---------- i18n ----------

  var LANG_KEY = 'ispDemoLang';
  var dictionaries = {};
  var currentLang = localStorage.getItem(LANG_KEY) ||
    ((navigator.language || '').indexOf('zh') === 0 ? 'zh-TW' : 'en');

  function t(key, vars) {
    var dict = dictionaries[currentLang] || {};
    var str = dict[key] || (dictionaries.en && dictionaries.en[key]) || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        str = str.split('{' + k + '}').join(vars[k]);
      });
    }
    return str;
  }

  function loadDictionaries() {
    return Promise.all([
      fetch('i18n/en.json').then(function (r) { return r.json(); }),
      fetch('i18n/zh-TW.json').then(function (r) { return r.json(); })
    ]).then(function (results) {
      dictionaries.en = results[0];
      dictionaries['zh-TW'] = results[1];
    });
  }

  loadDictionaries().then(startApp).catch(function (err) {
    console.error('Failed to load i18n dictionaries, falling back to raw keys:', err);
    dictionaries.en = dictionaries.en || {};
    dictionaries['zh-TW'] = dictionaries['zh-TW'] || {};
    startApp();
  });

  function startApp() {

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
    var arcAngle = (i / 10) * Math.PI;
    arcPoints.push([40 - 40 * Math.cos(arcAngle), -40 * Math.sin(arcAngle)]);
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
    if (tile.preset !== 'contour') return false;
    return tile.closed !== false; // old saved contour tiles predate this flag - default to the closed outline they always were
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

  function currentPathLineWidth() {
    return parseFloat(pathLineWidthInput.value) || 3;
  }

  function currentPathPointSize() {
    return parseFloat(pathPointSizeInput.value) || 3.5;
  }

  function drawTilePath(ctx, tile, colorOverride) {
    var color = colorOverride || tileColor(tile);
    var pts = tileAbsolutePoints(tile);
    var pointSize = currentPathPointSize();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = currentPathLineWidth();
    ctx.beginPath();
    pts.forEach(function (p, idx) { if (idx === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    if (tileIsClosedLoop(tile)) ctx.closePath();
    ctx.stroke();
    pts.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, pointSize, 0, Math.PI * 2);
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
    var pointSize = currentPathPointSize();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = currentPathLineWidth();
    ctx.beginPath();
    pts.forEach(function (p, idx) { if (idx === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    if (tileIsClosedLoop(tile)) ctx.closePath();
    ctx.stroke();
    pts.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, pointSize, 0, Math.PI * 2);
      ctx.fill();
    });
    return pts;
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

  /** Draws img into a WxH canvas, fitted and centered as usual, then nudged by (shiftX,shiftY) and rotated by rotateDeg about the canvas center - the same transform drawWorkpiece() uses, generalized to any image. */
  function drawShiftedImage(ctx, img, shiftX, shiftY, rotateDeg) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1a2130';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(CX + shiftX, CY + shiftY);
    ctx.rotate(rotateDeg * Math.PI / 180);
    ctx.translate(-CX, -CY);
    var scale = Math.min(W / img.width, H / img.height);
    var dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
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

  // ---------- DOM refs ----------

  var combineCanvas = document.getElementById('combineCanvas');
  var combineCtx = combineCanvas.getContext('2d');
  var combineFeaturePreview = document.getElementById('combineFeaturePreview');
  var combineFeatureStatus = document.getElementById('combineFeatureStatus');
  var combineImageUpload = document.getElementById('combineImageUpload');
  var resetSyntheticImageBtn = document.getElementById('resetSyntheticImageBtn');
  var combineContourThreshold = document.getElementById('combineContourThreshold');
  var combineThresholdVal = document.getElementById('combineThresholdVal');
  var combineMinArea = document.getElementById('combineMinArea');
  var combineMinAreaVal = document.getElementById('combineMinAreaVal');
  var combineFindContoursBtn = document.getElementById('combineFindContoursBtn');
  var combineContourList = document.getElementById('combineContourList');
  var pathModeFollowBtn = document.getElementById('pathModeFollowBtn');
  var pathModeFillBtn = document.getElementById('pathModeFillBtn');
  var fillDistanceRow = document.getElementById('fillDistanceRow');
  var combineFillDistanceInput = document.getElementById('combineFillDistance');
  var combineFillDistanceVal = document.getElementById('combineFillDistanceVal');
  var pathPointSizeInput = document.getElementById('pathPointSizeInput');
  var pathPointSizeVal = document.getElementById('pathPointSizeVal');
  var pathLineWidthInput = document.getElementById('pathLineWidthInput');
  var pathLineWidthVal = document.getElementById('pathLineWidthVal');
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

  var simShiftX = document.getElementById('simShiftX'), simShiftXVal = document.getElementById('simShiftXVal');
  var simShiftY = document.getElementById('simShiftY'), simShiftYVal = document.getElementById('simShiftYVal');
  var simRotate = document.getElementById('simRotate'), simRotateVal = document.getElementById('simRotateVal');
  var randomizeShiftBtn = document.getElementById('randomizeShiftBtn');
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

  var simColorInput = document.getElementById('simColorInput');
  var simSizeInput = document.getElementById('simSizeInput');
  var simSizeVal = document.getElementById('simSizeVal');
  var simTransparencyInput = document.getElementById('simTransparencyInput');
  var simTransparencyVal = document.getElementById('simTransparencyVal');
  var simSpeedInput = document.getElementById('simSpeedInput');
  var simSpeedVal = document.getElementById('simSpeedVal');
  var simPlayBtn = document.getElementById('simPlayBtn');
  var simStopBtn = document.getElementById('simStopBtn');
  var simStatus = document.getElementById('simStatus');

  function setStatus(el, msg, cls) {
    el.textContent = msg;
    el.className = 'status-line' + (cls ? ' ' + cls : '');
  }

  // ---------- combine state ----------

  var combineRefCanvas = makeWorkpieceCanvas(0, 0, 0);
  var combineTiles = [];
  var combineFeatureRegion = null;
  var combineContourData = []; // [{ points:[{x,y}], area, rect:{x,y,w,h} }], largest first
  var combineSelectedContourIndex = -1;
  var combinePathMode = 'follow'; // 'follow' | 'fill'
  var combineFillSpacing = 20;

  function combineResetLayout(msg) {
    combineTiles = [];
    combineFeatureRegion = null;
    combineContourData = [];
    combineSelectedContourIndex = -1;
    combineRenderFeaturePreview();
    setStatus(combineFeatureStatus, t('combine.noFeatureRegion'));
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
    pctx.lineWidth = currentPathLineWidth();
    pctx.beginPath();
    pts.forEach(function (p, idx) { if (idx === 0) pctx.moveTo(p.x, p.y); else pctx.lineTo(p.x, p.y); });
    pctx.closePath();
    pctx.stroke();
    pts.forEach(function (p) {
      pctx.beginPath();
      pctx.arc(p.x, p.y, currentPathPointSize(), 0, Math.PI * 2);
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
    if (combineFeatureRegion) {
      drawFeatureRect(combineCtx, combineFeatureRegion, '#f6ad55');
    }
  }

  /** Even-odd scanline fill of a closed polygon, walked as a continuous zigzag (boustrophedon) path spaced `spacing` px apart - "Fill (zigzag)" path generation. */
  function scanlineFillPath(polygon, spacing) {
    var minY = Math.min.apply(null, polygon.map(function (p) { return p.y; }));
    var maxY = Math.max.apply(null, polygon.map(function (p) { return p.y; }));
    var path = [];
    var leftToRight = true;
    for (var y = minY + spacing / 2; y < maxY; y += spacing) {
      var xs = [];
      for (var i = 0; i < polygon.length; i++) {
        var p1 = polygon[i], p2 = polygon[(i + 1) % polygon.length];
        if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
          xs.push(p1.x + (y - p1.y) / (p2.y - p1.y) * (p2.x - p1.x));
        }
      }
      xs.sort(function (a, b) { return a - b; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        var a = { x: xs[k], y: y }, b = { x: xs[k + 1], y: y };
        if (leftToRight) { path.push(a, b); } else { path.push(b, a); }
      }
      leftToRight = !leftToRight;
    }
    return path;
  }

  function combineApplyContour(index) {
    var c = combineContourData[index];
    if (!c) return;
    combineSelectedContourIndex = index;
    combineFeatureRegion = { x: c.rect.x, y: c.rect.y, w: c.rect.w, h: c.rect.h };
    combineTiles = combineTiles.filter(function (t) { return t.preset !== 'contour'; });
    var pathLabel;
    if (combinePathMode === 'fill') {
      combineTiles.push({ preset: 'contour', points: scanlineFillPath(c.points, combineFillSpacing), closed: false });
      pathLabel = t('combine.pathLabelFill');
    } else {
      combineTiles.push({ preset: 'contour', points: sampleContourPoints(c.points, 16), closed: true });
      pathLabel = t('combine.pathLabelFollow');
    }
    combineRenderFeaturePreview();
    setStatus(combineFeatureStatus, t('combine.featureAndPath', { pathLabel: pathLabel, index: index, w: Math.round(c.rect.w), h: Math.round(c.rect.h) }));
    renderCombineContourList();
    renderCombineCanvas();
  }

  function setPathMode(mode) {
    combinePathMode = mode;
    pathModeFollowBtn.classList.toggle('active', mode === 'follow');
    pathModeFillBtn.classList.toggle('active', mode === 'fill');
    fillDistanceRow.style.display = mode === 'fill' ? 'block' : 'none';
    if (combineSelectedContourIndex >= 0) combineApplyContour(combineSelectedContourIndex);
  }

  pathModeFollowBtn.addEventListener('click', function () { setPathMode('follow'); });
  pathModeFillBtn.addEventListener('click', function () { setPathMode('fill'); });
  combineFillDistanceInput.addEventListener('input', function () {
    combineFillDistanceVal.textContent = combineFillDistanceInput.value;
    combineFillSpacing = parseInt(combineFillDistanceInput.value, 10);
    if (combinePathMode === 'fill' && combineSelectedContourIndex >= 0) combineApplyContour(combineSelectedContourIndex);
  });

  /** Redraws every canvas currently showing a generated path, so the point/line style controls apply live everywhere at once. */
  function refreshAllPathRendering() {
    renderCombineCanvas();
    combineRenderFeaturePreview();
    if (preRunRecipe) {
      renderPreRunRecipeCanvas();
      preRunRenderFeaturePreview();
    }
    if (lastAppliedMatch) renderResultBase();
  }

  pathPointSizeInput.addEventListener('input', function () {
    pathPointSizeVal.textContent = pathPointSizeInput.value;
    refreshAllPathRendering();
  });
  pathLineWidthInput.addEventListener('input', function () {
    pathLineWidthVal.textContent = pathLineWidthInput.value;
    refreshAllPathRendering();
  });

  function renderCombineContourList() {
    combineContourList.innerHTML = '';
    if (combineContourData.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = t('combine.contourEmpty');
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
      badge.textContent = t('combine.contourArea', { area: Math.round(c.area) });
      li.appendChild(label);
      li.appendChild(badge);
      li.addEventListener('click', function () { combineApplyContour(i); });
      combineContourList.appendChild(li);
    });
  }

  function runFindContours() {
    if (!isCvReady()) { setStatus(combineStatus, t('combine.statusCvLoading'), 'busy'); return; }
    var mats = [];
    function track(m) { mats.push(m); return m; }
    try {
      var src = track(cv.imread(combineRefCanvas));
      var gray = track(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      var binary = track(new cv.Mat());
      var thresholdVal = parseInt(combineContourThreshold.value, 10);
      cv.threshold(gray, binary, thresholdVal, 255, cv.THRESH_BINARY);
      var contours = track(new cv.MatVector());
      var hierarchy = track(new cv.Mat());
      cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      combineContourData = [];
      var minArea = parseInt(combineMinArea.value, 10);
      for (var i = 0; i < contours.size(); i++) {
        var c = contours.get(i);
        var area = cv.contourArea(c, false);
        if (area < minArea) continue;
        var br = cv.boundingRect(c);
        var points = [];
        for (var j = 0; j < c.data32S.length; j += 2) points.push({ x: c.data32S[j], y: c.data32S[j + 1] });
        combineContourData.push({ points: points, area: area, rect: { x: br.x, y: br.y, w: br.width, h: br.height } });
      }
      combineContourData.sort(function (a, b) { return b.area - a.area; });

      renderCombineContourList();
      if (combineContourData.length > 0) {
        combineApplyContour(0);
        setStatus(combineStatus, t('combine.statusContoursFound', { count: combineContourData.length }), 'ok');
      } else {
        combineSelectedContourIndex = -1;
        renderCombineCanvas();
        setStatus(combineStatus, t('combine.statusNoContours'), 'err');
      }
    } catch (ex) {
      setStatus(combineStatus, t('combine.statusFindFailed', { msg: ex.message }), 'err');
    } finally {
      mats.forEach(function (m) { try { m.delete(); } catch (e) { } });
    }
  }

  var findContoursDebounce = null;
  function scheduleFindContours() {
    if (findContoursDebounce) clearTimeout(findContoursDebounce);
    findContoursDebounce = setTimeout(runFindContours, 80);
  }
  combineContourThreshold.addEventListener('input', function () {
    combineThresholdVal.textContent = combineContourThreshold.value;
    scheduleFindContours();
  });
  combineMinArea.addEventListener('input', function () {
    combineMinAreaVal.textContent = combineMinArea.value;
    scheduleFindContours();
  });

  combineFindContoursBtn.addEventListener('click', runFindContours);

  combineImageUpload.addEventListener('change', function (evt) {
    var file = evt.target.files && evt.target.files[0];
    if (!file) return;
    loadFileAsImage(file, function (img) {
      fitImageIntoCanvas(img, combineRefCanvas);
      combineResetLayout(t('combine.statusPhotoLoaded'));
      renderCombineCanvas();
    });
  });

  resetSyntheticImageBtn.addEventListener('click', function () {
    combineRefCanvas = makeWorkpieceCanvas(0, 0, 0);
    combineResetLayout(t('combine.statusSampleRestored'));
    renderCombineCanvas();
  });

  saveRecipeBtn.addEventListener('click', function () {
    var name = recipeNameInput.value.trim();
    if (!name) { setStatus(combineStatus, t('combine.statusEnterName'), 'err'); return; }
    if (combineTiles.length === 0) { setStatus(combineStatus, t('combine.statusNeedPath'), 'err'); return; }
    var recipes = loadRecipes();
    recipes[name] = {
      image: combineRefCanvas.toDataURL('image/png'),
      featureRegion: combineFeatureRegion,
      tiles: combineTiles
    };
    saveRecipes(recipes);
    refreshRecipeSelects();
    combineRecipeSelect.value = name;
    setStatus(combineStatus, t('combine.statusSaved', { name: name }), 'ok');
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
        setStatus(combineFeatureStatus, t('combine.featureRegionSet', { w: Math.round(combineFeatureRegion.w), h: Math.round(combineFeatureRegion.h) }));
      } else {
        combineRenderFeaturePreview();
        setStatus(combineFeatureStatus, t('combine.noFeatureRegion'));
      }
    };
    img.src = data.image;
    recipeNameInput.value = name;
    setStatus(combineStatus, t('combine.statusLoaded', { name: name }), 'ok');
  });

  combineDeleteRecipeBtn.addEventListener('click', function () {
    var name = combineRecipeSelect.value;
    var recipes = loadRecipes();
    if (!recipes[name]) return;
    delete recipes[name];
    saveRecipes(recipes);
    refreshRecipeSelects();
    setStatus(combineStatus, t('combine.statusDeleted', { name: name }));
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
    pctx.lineWidth = currentPathLineWidth();
    pctx.beginPath();
    pts.forEach(function (p, idx) { if (idx === 0) pctx.moveTo(p.x, p.y); else pctx.lineTo(p.x, p.y); });
    pctx.closePath();
    pctx.stroke();
    pts.forEach(function (p) {
      pctx.beginPath();
      pctx.arc(p.x, p.y, currentPathPointSize(), 0, Math.PI * 2);
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
        setStatus(preRunFeatureStatus, t('prerun.featureRecipeLoaded', { name: name }));
      } else {
        preRunRenderFeaturePreview();
        setStatus(preRunFeatureStatus, t('prerun.featureNoRegion'));
      }
      setStatus(matchStatus, t('prerun.matchRecipeLoaded'));
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

  var generateCurrentDebounce = null;
  [simShiftX, simShiftY, simRotate].forEach(function (input) {
    input.addEventListener('input', function () {
      simShiftXVal.textContent = simShiftX.value;
      simShiftYVal.textContent = simShiftY.value;
      simRotateVal.textContent = simRotate.value;
      if (!preRunRecipe) return;
      if (generateCurrentDebounce) clearTimeout(generateCurrentDebounce);
      generateCurrentDebounce = setTimeout(generateCurrent, 80);
    });
  });

  function generateCurrent() {
    if (!preRunRecipe) { setStatus(matchStatus, t('prerun.matchLoadFirst'), 'err'); return; }
    var sx = parseFloat(simShiftX.value), sy = parseFloat(simShiftY.value), rot = parseFloat(simRotate.value);
    drawShiftedImage(preRunRecipeCtx, preRunRecipe.imageObj, sx, sy, rot);
    groundTruth = currentGroundTruthLabel(sx, sy, rot);
    matchResultBox.style.display = 'none';
    groundTruthBox.style.display = 'none';
    resultCtx.clearRect(0, 0, W, H);
    setStatus(matchStatus, t('prerun.matchSimGenerated'));
  }

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
      fitImageIntoCanvas(img, preRunRecipeCanvas);
      groundTruth = null;
      matchResultBox.style.display = 'none';
      groundTruthBox.style.display = 'none';
      resultCtx.clearRect(0, 0, W, H);
      setStatus(matchStatus, t('prerun.matchUploaded'));
    });
  });

  // ---------- OpenCV.js readiness ----------

  function isCvReady() {
    return typeof cv !== 'undefined' && !!cv.Mat;
  }

  matchBtn.disabled = true;
  combineFindContoursBtn.disabled = true;
  setStatus(matchStatus, t('prerun.cvLoadingInitial'), 'busy');
  var cvPoll = setInterval(function () {
    if (isCvReady()) {
      clearInterval(cvPoll);
      matchBtn.disabled = false;
      combineFindContoursBtn.disabled = false;
      setStatus(matchStatus, t('prerun.cvReady'), 'ok');
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
    if (!isCvReady()) { setStatus(matchStatus, t('combine.statusCvLoading'), 'busy'); return null; }
    if (!preRunRecipe) { setStatus(matchStatus, t('prerun.matchLoadFirst'), 'err'); return null; }
    var fr = preRunRecipe.featureRegion;
    if (!fr) { setStatus(matchStatus, t('prerun.matchNoFeatureRegion'), 'err'); return null; }

    var mats = [];
    function track(m) { mats.push(m); return m; }

    try {
      var tCanvas = document.createElement('canvas');
      tCanvas.width = W; tCanvas.height = H;
      tCanvas.getContext('2d').drawImage(preRunRecipe.imageObj, 0, 0, W, H);

      var srcTemplate = track(cv.imread(tCanvas));
      var srcCurrent = track(cv.imread(preRunRecipeCanvas));
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
        setStatus(matchStatus, t('prerun.matchTooFewFeatures'), 'err');
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
        setStatus(matchStatus, t('prerun.matchTooFewMatches', { count: goodPairs.length }), 'err');
        return null;
      }

      var fit = ransacSimilarity(goodPairs);
      if (!fit || fit.inlierCount < 4 || fit.score < 0.35) {
        setStatus(matchStatus, t('prerun.matchLowConfidence', { inliers: fit ? fit.inlierCount : 0, score: fit ? fit.score.toFixed(2) : '0' }), 'err');
        return null;
      }

      return { dx: fit.tx, dy: fit.ty, thetaDeg: fit.thetaDeg, inliers: fit.inlierCount, totalMatches: goodPairs.length, score: fit.score };
    } finally {
      mats.forEach(function (m) { try { m.delete(); } catch (e) { } });
    }
  }

  var lastAppliedMatch = null;
  var lastAppliedStatusLabelKey = '';
  var lastAppliedPathPoints = [];

  /** Redraws the current photo + transformed path + label from the last applied match - the "clean" (no spray) view, reused both right after a match/confirm, to reset the trail before each simulation run, and to redraw the label in a newly selected language. */
  function renderResultBase() {
    resultCtx.clearRect(0, 0, W, H);
    resultCtx.drawImage(preRunRecipeCanvas, 0, 0);
    var pts = [];
    preRunRecipe.tiles.forEach(function (tile) {
      pts = pts.concat(drawTransformedTilePath(resultCtx, tile, lastAppliedMatch, '#4fd1c5'));
    });
    resultCtx.fillStyle = '#e6ebf5';
    resultCtx.font = 'bold 13px sans-serif';
    resultCtx.fillText(t(lastAppliedStatusLabelKey), 10, 18);
    return pts;
  }

  function applyMatchToPath(match, statusLabelKey) {
    stopPathSimulation();
    lastAppliedMatch = match;
    lastAppliedStatusLabelKey = statusLabelKey;
    lastAppliedPathPoints = renderResultBase();
    var enough = lastAppliedPathPoints.length >= 2;
    simPlayBtn.disabled = !enough;
    setStatus(simStatus, enough ? t('sim.statusReady') : t('sim.statusTooFew'));
  }

  // ---------- Path Simulation: animate a spray circle along the applied path ----------

  var SPRAY_RADIUS = 14;
  var simAnimationId = null;
  var simRunning = false;

  function pointDistance(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pathTotalLength(points) {
    var total = 0;
    for (var i = 1; i < points.length; i++) total += pointDistance(points[i - 1], points[i]);
    return total;
  }

  /** Walks the path by cumulative segment length to find the point at `dist` px along it - smooth continuous motion rather than jumping vertex to vertex. */
  function pointAtDistance(points, dist) {
    if (points.length === 1) return points[0];
    var remaining = dist;
    for (var i = 1; i < points.length; i++) {
      var segLen = pointDistance(points[i - 1], points[i]);
      if (remaining <= segLen || i === points.length - 1) {
        var t = segLen === 0 ? 0 : Math.min(1, remaining / segLen);
        return {
          x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
          y: points[i - 1].y + (points[i].y - points[i - 1].y) * t
        };
      }
      remaining -= segLen;
    }
    return points[points.length - 1];
  }

  function startPathSimulation() {
    if (!lastAppliedPathPoints || lastAppliedPathPoints.length < 2) return;
    if (simRunning) return;

    renderResultBase(); // fresh canvas first, so this run's spray trail doesn't mix with a previous run's
    simRunning = true;
    simPlayBtn.disabled = true;
    simStopBtn.disabled = false;

    var points = lastAppliedPathPoints;
    var totalLength = pathTotalLength(points);
    var speed = parseFloat(simSpeedInput.value) || 200;
    var transparency = (parseFloat(simTransparencyInput.value) || 35) / 100;
    var color = simColorInput.value || '#f6ad55';
    var sprayRadius = parseFloat(simSizeInput.value) || SPRAY_RADIUS;
    var startTime = null;

    function frame(timestamp) {
      if (!simRunning) return;
      if (startTime === null) startTime = timestamp;
      var dist = ((timestamp - startTime) / 1000) * speed;
      var pos = pointAtDistance(points, Math.min(dist, totalLength));

      // Deliberately not clearing between frames - overlapping passes blend via ordinary
      // canvas alpha compositing, while gaps in coverage keep showing the photo through.
      resultCtx.save();
      resultCtx.globalAlpha = transparency;
      resultCtx.fillStyle = color;
      resultCtx.beginPath();
      resultCtx.arc(pos.x, pos.y, sprayRadius, 0, Math.PI * 2);
      resultCtx.fill();
      resultCtx.restore();

      if (dist >= totalLength) {
        stopPathSimulation(true);
        return;
      }
      simAnimationId = requestAnimationFrame(frame);
    }

    setStatus(simStatus, t('sim.statusSimulating'), 'busy');
    simAnimationId = requestAnimationFrame(frame);
  }

  function stopPathSimulation(finished) {
    if (!simRunning) return;
    simRunning = false;
    if (simAnimationId) cancelAnimationFrame(simAnimationId);
    simAnimationId = null;
    simPlayBtn.disabled = false;
    simStopBtn.disabled = true;
    setStatus(simStatus, finished ? t('sim.statusFinished') : t('sim.statusStopped'), finished ? 'ok' : '');
  }

  simPlayBtn.addEventListener('click', startPathSimulation);
  simStopBtn.addEventListener('click', function () { stopPathSimulation(false); });
  simSizeInput.addEventListener('input', function () { simSizeVal.textContent = simSizeInput.value; });
  simTransparencyInput.addEventListener('input', function () { simTransparencyVal.textContent = simTransparencyInput.value; });
  simSpeedInput.addEventListener('input', function () { simSpeedVal.textContent = simSpeedInput.value; });

  matchBtn.addEventListener('click', function () {
    if (!preRunRecipe || preRunRecipe.tiles.length === 0) { setStatus(matchStatus, t('prerun.matchNeedPath'), 'err'); return; }
    setStatus(matchStatus, t('prerun.matchRunning'), 'busy');
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
      applyMatchToPath(match, 'prerun.pathLabelMatched');
      setStatus(matchStatus, t('prerun.matchApplied'), 'ok');
    }, 30);
  });

  confirmPathBtn.addEventListener('click', function () {
    if (!preRunRecipe || preRunRecipe.tiles.length === 0) { setStatus(matchStatus, t('prerun.matchNeedPath'), 'err'); return; }
    applyMatchToPath({ dx: 0, dy: 0, thetaDeg: 0 }, 'prerun.pathLabelConfirmed');
    setStatus(matchStatus, t('prerun.matchConfirmed'), 'ok');
  });

  function renderGroundTruthBox() {
    if (!groundTruth || !lastMatch) return;
    var lines = [];
    lines.push(t('prerun.groundDialedIn', { sx: groundTruth.shiftX, sy: groundTruth.shiftY, rot: groundTruth.rotateDeg }));
    lines.push(t('prerun.groundExpected', { tx: groundTruth.Tx.toFixed(1), ty: groundTruth.Ty.toFixed(1) }) +
      (groundTruth.rotateDeg !== 0 ? t('prerun.groundExpectedNote') : '.'));
    lines.push(t('prerun.groundDetected', { dx: lastMatch.dx.toFixed(1), dy: lastMatch.dy.toFixed(1), theta: lastMatch.thetaDeg.toFixed(2) }));
    var errX = lastMatch.dx - groundTruth.Tx, errY = lastMatch.dy - groundTruth.Ty, errT = lastMatch.thetaDeg - groundTruth.rotateDeg;
    lines.push(t('prerun.groundError', { ex: errX.toFixed(1), ey: errY.toFixed(1), et: errT.toFixed(2) }));
    groundTruthBox.textContent = lines.join(' ');
    groundTruthBox.style.display = 'block';
  }

  revealGroundTruthBtn.addEventListener('click', renderGroundTruthBox);

  // ---------- language switching ----------

  var langEnBtn = document.getElementById('langEnBtn');
  var langZhBtn = document.getElementById('langZhBtn');

  function applyI18nStatic() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    document.title = t('app.title');
    langEnBtn.classList.toggle('active', currentLang === 'en');
    langZhBtn.classList.toggle('active', currentLang === 'zh-TW');
  }

  /** Re-renders every piece of dynamically-generated text on the page in the newly selected language - static labels are handled by applyI18nStatic(), this covers everything demo.js writes into the DOM/canvas itself. */
  function refreshDynamicText() {
    renderCombineContourList();
    refreshRecipeSelects();

    if (combineSelectedContourIndex >= 0 && combineContourData[combineSelectedContourIndex]) {
      var c = combineContourData[combineSelectedContourIndex];
      var pathLabel = combinePathMode === 'fill' ? t('combine.pathLabelFill') : t('combine.pathLabelFollow');
      setStatus(combineFeatureStatus, t('combine.featureAndPath', { pathLabel: pathLabel, index: combineSelectedContourIndex, w: Math.round(c.rect.w), h: Math.round(c.rect.h) }));
    } else if (combineFeatureRegion) {
      setStatus(combineFeatureStatus, t('combine.featureRegionSet', { w: Math.round(combineFeatureRegion.w), h: Math.round(combineFeatureRegion.h) }));
    } else {
      setStatus(combineFeatureStatus, t('combine.noFeatureRegion'));
    }
    if (combineContourData.length > 0) {
      setStatus(combineStatus, t('combine.statusContoursFound', { count: combineContourData.length }), 'ok');
    }

    if (preRunRecipe) {
      setStatus(preRunFeatureStatus, preRunRecipe.featureRegion ? t('prerun.featureRecipeLoaded', { name: preRunRecipeSelect.value }) : t('prerun.featureNoRegion'));
    } else {
      setStatus(preRunFeatureStatus, t('prerun.noRecipeLoaded'));
    }
    setStatus(matchStatus, isCvReady() ? t('prerun.cvReady') : t('prerun.cvLoadingInitial'), isCvReady() ? 'ok' : 'busy');

    if (lastAppliedMatch) {
      renderResultBase();
      setStatus(simStatus, lastAppliedPathPoints.length >= 2 ? t('sim.statusReady') : t('sim.statusTooFew'));
    } else {
      setStatus(simStatus, t('sim.statusInitial'));
    }

    if (groundTruthBox.style.display !== 'none') renderGroundTruthBox();
  }

  function setLang(lang) {
    if (lang === currentLang) return;
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    applyI18nStatic();
    refreshDynamicText();
  }

  langEnBtn.addEventListener('click', function () { setLang('en'); });
  langZhBtn.addEventListener('click', function () { setLang('zh-TW'); });

  // ---------- init ----------

  applyI18nStatic();
  renderCombineCanvas();
  drawCropToPreview(combineRefCanvas, null, combineFeaturePreview);
  renderCombineContourList();
  refreshRecipeSelects();
  setStatus(simStatus, t('sim.statusInitial'));

  } // end startApp
})();
