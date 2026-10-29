https://kz-lgtm.github.io/ISD/github-pages-demo/
# Intelligent Spray — GitHub Pages Demo

This folder is a complete, self-contained static website. It walks through the
whole Intelligent Spray workflow in the browser: build a recipe from a photo,
find how far the part moved, correct the spray path, simulate the spray film,
inspect the result and log every cycle. Click **Run full demo** at the top of
the page to see every step run once.

## What the page does

| Section | What you can do |
|---|---|
| **0 Station setup** | Camera scale (mm/px) from a known part width, or a camera → robot alignment fitted from 3+ point pairs (handles the image/robot axis flip). Pass/fail limits (shift, rotation, scale, confidence, inliers, verification). Matching method (ORB, template, auto) and CLAHE contrast normalisation. Gun flow, standoff height, target film. |
| **1 Combine** | Load a sample (A panel, B bracket) or your own photo, find contours and give them roles: **outline** (the part to spray, also the main feature), extra **feature** regions for matching, **keep-outs** (holes are added automatically). Spray program: spray width + overlap → row spacing, edge offset, lead-in/out, fill direction, and edge / fill / cross-hatch passes with their own speed and flow. The gun is turned off over keep-outs and during lead-in/out and travel moves. Recipes are saved in the browser and can be exported / imported as JSON files. |
| **2 Pre-run** | Shift, rotate and scale the part (ground truth stays hidden until you reveal it), add stress (brightness, contrast, noise, blur, glare, covered feature) or upload a real photo. **Run pattern match** checks the result against the station limits: a pass applies the corrected path, a reject doesn't (an override is possible and is logged). **Identify part** tries every recipe on the current photo. The **accuracy test** runs many random shifts and reports success rate, position/rotation error, a histogram and a table. |
| **3 Corrected path & simulation** | The corrected path next to the original one, then an animated spray pass with Gaussian paint deposition: paint view or film-thickness map. Coverage, in-spec area, mean film, non-uniformity, paint on part / overspray, paint in keep-outs, paint used and cycle time. Export the corrected path as CSV, JSON, ABB RAPID, KUKA KRL or FANUC .LS. |
| **4 Post-spray inspection** | A simulated after-photo (optionally with a clogged nozzle) or an uploaded one is compared with the before-photo. The paint opacity it measures is checked against the planned film: missed, thin, unexpected paint, paint in keep-outs. |
| **5 Cycle log & trend** | Every pre-run is logged with a thumbnail. X / Y / rotation trend charts, warnings for drift or a steady offset (only when it stands clearly above the cycle-to-cycle scatter), CSV export. |

The page is in English and Traditional Chinese (switch at the top right).

## How the matching works

1. ORB keypoints from every feature region of the recipe photo are matched
   into the current photo (ratio test).
2. A similarity transform (shift, rotation, scale) is fitted with MSAC plus
   local optimisation. Plain RANSAC can let slightly wrong models tie with the
   right one on repetitive patterns, such as rows of identical squares; MSAC
   tells those models apart.
3. If ORB fails, the auto method falls back to template matching with a
   coarse-to-fine rotation search.
4. **Verification:** the current photo is warped back onto the recipe and
   correlated with each feature region. This catches matches that look
   confident but are wrong, for example when the part is covered. Part
   identification ranks recipes by this score.
5. The path is moved by the rigid part of the transform (rotation + shift at
   the main feature). A scale change is reported and checked against the
   limits but not applied, because it usually means a different camera
   distance or the wrong part.

## Limits of the simulation

- Paint is modelled as a circular Gaussian spot (σ = spray width / 4), with
  film proportional to flow ÷ speed. Real fan patterns, gun on/off delays,
  robot acceleration and transfer efficiency are not modelled.
- Film thickness in µm assumes the program's fill passes give the target film
  (the "100 %" reference).
- Inspection of uploaded photos assumes the same camera position as the
  before-photo, opaque paint, and that the **Paint colour** setting matches
  the real paint. Areas whose colour is already close to the paint can't be
  judged and are reported as not inspectable.
- Robot programs are templates. Tool orientation, frames, I/O and blending
  must be verified on a simulator before running on a real robot.

## Folder contents

```
github-pages-demo/
  index.html            the page
  css/style.css         styling
  js/core.js            pure logic: transforms, robust fitting, calibration,
                        spray path generation, paint deposition, coverage
                        metrics, statistics, robot program export
  js/vision.js          OpenCV.js parts: contours, polygon offsets, matching,
                        verification, stress effects, paint opacity
  js/store.js           IndexedDB storage for recipes, the cycle log and settings
  js/demo.js            the page logic (UI, simulation, charts, i18n)
  i18n/en.json          English strings
  i18n/zh-TW.json       Traditional Chinese strings
  lib/opencv/opencv.js  OpenCV.js (WebAssembly build), ~10.5 MB
```

## Try it locally

Any static file server works. For example, with Python installed:

```bash
cd github-pages-demo
python -m http.server 8090
```

Then open `http://localhost:8090`. Opening `index.html` directly via `file://`
usually fails, because browsers block WebAssembly/fetch from `file://` URLs.

## Publishing on GitHub Pages

This repository already publishes it: Pages serves the repository root of
`main`, so this folder is live at
`https://<user>.github.io/<repo>/github-pages-demo/`. A subfolder works as-is;
a separate repository is not needed. Every push to `main` redeploys within
about a minute (see the "pages build and deployment" run under Actions).

**When you change any file, bump the version** in two places so browsers
don't combine cached old files with new ones:

- the `?v=` on the CSS and JS links in `index.html`
- `ASSET_VERSION` in `js/demo.js`, which is used for the language files

## Privacy

Everything runs in the visitor's own browser. Photos, recipes and logs are
never uploaded. They are stored in that browser's IndexedDB for this site.
Recipes saved by older versions in `localStorage` are moved over
automatically.
