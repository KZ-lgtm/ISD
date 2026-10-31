/* Intelligent Spray demo - live 3D view of the spray cell (three.js r128, global THREE).
   World units are metres; image pixels map onto the fixture as x -> X and y -> Z through the camera
   calibration (mm/px), with the camera's view centre at the world origin and the fixture top at Y = 0.
   The page drives it: the active work order, the part pose the camera measured, the gun position from the
   spray simulation, and the paint film. Nothing here decides anything - it only shows the cell's state. */
(function (root) {
  'use strict';

  var Cell3D = {};

  Cell3D.available = function () { return !!(root.THREE && root.THREE.WebGLRenderer); };

  var PART_THICK = 0.006, TABLE_H = 0.75, GANTRY_H = 0.9;
  var COLORS = { part: 0xc7cedd, partEdge: 0x5a6478, table: 0x4b5263, floor: 0xe9edf2, steel: 0x8792a2, rail: 0x5c6675,
    gun: 0x2b3240, good: 0x2e9e5b, bad: 0xd03b3b, blank: 0xb9c2d0, cone: 0x9fd3b3, camera: 0x1f2937 };

  /**
   * create(container, imgW, imgH) -> cell with setCalibration(mmPerPx, standoffMm, sprayWidthMm),
   * setPart(outline, holes), setPose(T), setFilm(canvas), setGun(p | null), setOrder(o | null), resize(), dispose().
   * T is the image-space similarity {a,b,tx,ty} from the taught photo to the current one.
   */
  Cell3D.create = function (container, imgW, imgH) {
    if (!Cell3D.available()) return null;
    var THREE = root.THREE;
    var mmPerPx = 1.25, standoff = 0.2, sprayWidth = 0.04;
    function px2w(x, y) { return { x: (x - imgW / 2) * mmPerPx / 1000, z: (y - imgH / 2) * mmPerPx / 1000 }; }

    var renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); } catch (e) { return null; }
    renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    renderer.setClearColor(0xf3f5f8);
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(32, 2, 0.05, 30);
    var HOME_TARGET = new THREE.Vector3(0.05, -0.2, 0.05);
    camera.position.set(0.55, 2.0, 2.35);
    var controls = THREE.OrbitControls ? new THREE.OrbitControls(camera, renderer.domElement) : null;
    if (controls) {
      controls.target.copy(HOME_TARGET);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.minDistance = 0.8; controls.maxDistance = 6;
      controls.addEventListener('change', requestRender);
    }
    camera.lookAt(HOME_TARGET);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3b1, 0.85));
    var sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.position.set(1.5, 3, 1.2);
    scene.add(sun);

    function mat(color, opts) { var m = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7, metalness: 0.1 }); if (opts) Object.assign(m, opts); return m; }
    function box(w, h, d, color, x, y, z) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); m.position.set(x, y, z); scene.add(m); return m; }

    // floor + fixture table (top at Y = 0)
    var grid = new THREE.GridHelper(6, 24, 0xc9d1dc, 0xdde2ea);
    grid.position.y = -TABLE_H;
    scene.add(grid);
    var tableW = 1.0, tableD = 0.7;
    box(tableW, 0.04, tableD, COLORS.table, 0, -0.02, 0);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) { box(0.05, TABLE_H - 0.04, 0.05, COLORS.steel, s[0] * (tableW / 2 - 0.05), -TABLE_H / 2 - 0.02, s[1] * (tableD / 2 - 0.05)); });
    // camera field of view, outlined on the table
    var fov = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0x93a0bd }));
    fov.rotation.x = -Math.PI / 2; fov.position.y = 0.001;
    scene.add(fov);

    // gantry: two rails along X, a bridge moving in X, a carriage moving in Z, a column with the gun
    var railZ = tableD / 2 + 0.12, railLen = 1.5;
    [-1, 1].forEach(function (s) {
      box(railLen, 0.06, 0.06, COLORS.rail, 0, GANTRY_H, s * railZ);
      [-1, 1].forEach(function (e) { box(0.06, GANTRY_H + TABLE_H, 0.06, COLORS.steel, e * (railLen / 2 - 0.03), (GANTRY_H - TABLE_H) / 2, s * railZ); });
    });
    var bridge = box(0.09, 0.08, railZ * 2 + 0.06, COLORS.steel, 0, GANTRY_H - 0.07, 0);
    var carriage = new THREE.Group(); scene.add(carriage);
    var carBox = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), mat(COLORS.rail)); carBox.position.y = GANTRY_H - 0.16; carriage.add(carBox);
    var column = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.05), mat(COLORS.steel)); carriage.add(column);
    var gun = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.02, 0.09, 16), mat(COLORS.gun, { metalness: 0.4 })); carriage.add(gun);
    var nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.03, 12), mat(0x111827)); carriage.add(nozzle);
    var cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 1, true), new THREE.MeshBasicMaterial({ color: COLORS.cone, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    cone.visible = false; carriage.add(cone);

    // overhead vision camera with its viewing frustum
    var visCam = box(0.12, 0.08, 0.16, COLORS.camera, 0, GANTRY_H + 0.35, 0);
    var frustum = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x93a0bd, transparent: true, opacity: 0.6 }));
    scene.add(frustum);

    // the part (rebuilt when the recipe or the measured pose changes) and the paint film above it
    var partGroup = new THREE.Group(); scene.add(partGroup);
    var outline = null, holes = [], pose = null;
    var filmTex = null, filmMesh = null;

    // infeed blanks and outfeed stacks (good / rejected) beside the table
    var stacks = new THREE.Group(); scene.add(stacks);
    function stackAt(x, z, standColor) {
      box(0.36, 0.5, 0.26, standColor, x, -TABLE_H + 0.25, z);
      var g = new THREE.Group(); g.position.set(x, -TABLE_H + 0.5, z); stacks.add(g);
      return g;
    }
    var infeed = stackAt(-tableW / 2 - 0.42, 0, COLORS.steel);
    var outGood = stackAt(tableW / 2 + 0.42, -0.17, COLORS.steel);
    var outBad = stackAt(tableW / 2 + 0.42, 0.2, 0x8b5a5a);
    function fillStack(g, n, color) {
      while (g.children.length) { var c = g.children.pop(); c.geometry.dispose(); }
      var shown = Math.min(n, 20), m = mat(color);
      for (var i = 0; i < shown; i++) {
        var plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.2), m);
        plate.position.y = 0.006 + i * 0.016;
        plate.rotation.y = (i % 2 ? 1 : -1) * 0.02;
        g.add(plate);
      }
    }

    function updateFov() {
      var w = imgW * mmPerPx / 1000, d = imgH * mmPerPx / 1000;
      fov.scale.set(w, d, 1);
      var top = GANTRY_H + 0.31, c = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], pts = [];
      c.forEach(function (p, i) {
        pts.push(0, top, 0, p[0], 0.002, p[1]);
        var q = c[(i + 1) % 4]; pts.push(p[0], 0.002, p[1], q[0], 0.002, q[1]);
      });
      frustum.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      if (filmMesh) filmMesh.scale.set(w, d, 1);
    }

    function applyPose(p) {
      if (!pose) return p;
      return { x: pose.a * p.x - pose.b * p.y + pose.tx, y: pose.b * p.x + pose.a * p.y + pose.ty };
    }

    function rebuildPart() {
      while (partGroup.children.length) { var c = partGroup.children.pop(); if (c.geometry) c.geometry.dispose(); }
      if (!outline || outline.length < 3) { requestRender(); return; }
      function toShapePts(pts) { return pts.map(function (p) { var q = px2w(applyPose(p).x, applyPose(p).y); return new THREE.Vector2(q.x, -q.z); }); }
      var shape = new THREE.Shape(toShapePts(outline));
      holes.forEach(function (h) { if (h.length >= 3) shape.holes.push(new THREE.Path(toShapePts(h))); });
      var geo = new THREE.ExtrudeGeometry(shape, { depth: PART_THICK, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      var mesh = new THREE.Mesh(geo, mat(COLORS.part, { roughness: 0.55 }));
      partGroup.add(mesh);
      var edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: COLORS.partEdge }));
      partGroup.add(edges);
      requestRender();
    }

    var gunTarget = null, gunPos = new THREE.Vector3(0, 0, -railZ * 0.9), parked = new THREE.Vector3(-0.62, 0, -railZ * 0.75);
    function placeGun(x, z, on) {
      bridge.position.x = x;
      carriage.position.set(x, 0, z);
      var tipY = PART_THICK + standoff;
      column.scale.y = Math.max(0.05, GANTRY_H - 0.21 - tipY - 0.075);
      column.position.y = tipY + 0.075 + column.scale.y / 2;
      gun.position.y = tipY + 0.045;
      nozzle.position.y = tipY + 0.002;
      cone.visible = !!on;
      cone.scale.set(sprayWidth / 2, standoff, sprayWidth / 2);
      cone.position.y = PART_THICK + standoff / 2;
    }

    var needsRender = true, raf = null, visible = true;
    function requestRender() { needsRender = true; }
    function loop() {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
      if (controls && controls.enableDamping) controls.update();
      var target = gunTarget || parked;
      if (gunPos.distanceTo(target) > 0.0005) {
        // the sim jumps a few mm per frame; when idle the gun glides home instead of teleporting
        gunPos.lerp(target, gunTarget ? 1 : 0.12);
        placeGun(gunPos.x, gunPos.z, gunTarget && gunTarget.on);
        needsRender = true;
      }
      if (!needsRender) return;
      needsRender = false;
      renderer.render(scene, camera);
    }

    var cell = {
      setCalibration: function (mm, standoffMm, sprayWidthMm) {
        mmPerPx = mm || 1.25; standoff = (standoffMm || 200) / 1000; sprayWidth = (sprayWidthMm || 40) / 1000;
        updateFov(); rebuildPart(); placeGun(gunPos.x, gunPos.z, gunTarget && gunTarget.on); requestRender();
      },
      setPart: function (o, h) { outline = o; holes = h || []; rebuildPart(); },
      setPose: function (T) { pose = T; rebuildPart(); },
      /** canvas: an image-sized (or grid-sized) RGBA canvas laid over the camera's field of view, or null. */
      setFilm: function (canvas) {
        if (!canvas) { if (filmMesh) filmMesh.visible = false; requestRender(); return; }
        if (!filmMesh || filmTex.image !== canvas) {
          if (filmMesh) { scene.remove(filmMesh); filmMesh.geometry.dispose(); filmTex.dispose(); }
          filmTex = new THREE.CanvasTexture(canvas);
          filmMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: filmTex, transparent: true, depthWrite: false }));
          filmMesh.rotation.x = -Math.PI / 2;
          filmMesh.position.y = PART_THICK + 0.0008;
          scene.add(filmMesh);
          updateFov();
        }
        filmMesh.visible = true;
        filmTex.needsUpdate = true;
        requestRender();
      },
      /** p: {x, y, on} in current-image px while spraying, or null to park the gun. */
      setGun: function (p) {
        if (!p) { gunTarget = null; requestRender(); return; }
        var w = px2w(p.x, p.y);
        gunTarget = new THREE.Vector3(w.x, 0, w.z); gunTarget.on = !!p.on;
      },
      /** o: { qty, done, rejected } or null. */
      setOrder: function (o) {
        var remaining = o ? Math.max(0, o.qty - o.done - o.rejected) : 0;
        fillStack(infeed, remaining, COLORS.blank);
        fillStack(outGood, o ? o.done : 0, COLORS.good);
        fillStack(outBad, o ? o.rejected : 0, COLORS.bad);
        requestRender();
      },
      resize: function () {
        var w = container.clientWidth || 600, h = container.clientHeight || 320;
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
        camera.aspect = w / h; camera.updateProjectionMatrix();
        requestRender();
      },
      setVisible: function (v) { visible = !!v; if (visible) { cell.resize(); requestRender(); } },
      dispose: function () { cancelAnimationFrame(raf); renderer.dispose(); container.removeChild(renderer.domElement); }
    };

    updateFov();
    placeGun(parked.x, parked.z, false);
    gunPos.copy(parked);
    cell.setOrder(null);
    if (root.ResizeObserver) new ResizeObserver(function () { cell.resize(); }).observe(container);
    cell.resize();
    loop();
    return cell;
  };

  root.ISDCell3D = Cell3D;
})(window);
