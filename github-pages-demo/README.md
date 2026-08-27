# Intelligent Spray — GitHub Pages Demo

This folder is a complete, self-contained, static website. It reproduces the
"Combine" and "Pre-run" steps of the Intelligent Spray feature as a real,
interactive demo — not screenshots. It runs **real ORB feature detection +
BFMatcher matching** and a hand-written RANSAC-fit rigid-transform solver,
all client-side in the browser via OpenCV.js (WebAssembly). Nothing is faked;
every image is drawn live on `<canvas>` and every match runs fresh.

What it deliberately leaves out: real robot motion (RAPID writes, mastership,
read-back verification) and the live camera feed, since there is no robot or
camera to demo against on a public static site. The "How this demo is built"
section on the page itself explains this to visitors.

## Folder contents

```
github-pages-demo/
  index.html          the whole demo (one page)
  css/style.css        styling
  js/demo.js            all demo logic: image synthesis, recipe storage,
                         ORB/BFMatcher matching, RANSAC fit, rendering
  lib/opencv/opencv.js  OpenCV.js (WebAssembly build), ~10.5 MB
```

## Try it locally first (optional)

Any static file server works. For example, with Python installed:

```bash
cd github-pages-demo
python -m http.server 8090
```

Then open `http://localhost:8090` in a browser. Opening `index.html` directly
via `file://` will usually fail, because browsers block WebAssembly/fetch
loading from `file://` URLs — always serve it over `http://`/`https://`.

## Publish on GitHub Pages

1. **Create a new GitHub repository** (public — GitHub Pages on the free
   tier requires a public repo unless you have GitHub Pro/Enterprise).
   Name it anything, e.g. `intelligent-spray-demo`.

2. **Push just this folder's contents to the repo root.** From inside
   `github-pages-demo/`:

   ```bash
   git init
   git add .
   git commit -m "Intelligent Spray interactive demo"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

   (If you'd rather keep this demo inside your existing MES repo, push it as
   a subfolder and set the Pages "publish source" folder to that subfolder
   in the next step — GitHub Pages supports serving from `/docs` on `main`
   but not from an arbitrary nested path, so a dedicated repo is simplest.)

3. **Enable Pages**: on GitHub, go to the repo's **Settings → Pages**. Under
   "Build and deployment", set **Source** to "Deploy from a branch", pick
   branch **main** and folder **/ (root)**, then Save.

4. **Wait ~1 minute**, then refresh that same Settings → Pages screen — it
   will show your live URL, typically:

   ```
   https://<your-username>.github.io/<your-repo>/
   ```

5. Open that URL and confirm the demo loads (OpenCV.js is ~10.5 MB, so first
   load can take a few seconds — this is normal and the page shows a
   "Loading OpenCV.js..." status until it's ready).

## Updating the demo later

Edit the files, commit, and push to `main` — GitHub Pages redeploys
automatically within about a minute of every push.

## Notes

- Everything runs in the visitor's own browser. No images, recipes, or match
  results are ever sent anywhere — recipes are saved to that browser's own
  `localStorage`, scoped to your GitHub Pages domain.
- The reference "workpiece" photo is drawn synthetically on `<canvas>` so the
  demo works standalone with no sample-image files to manage. Visitors can
  also upload their own photo for the "current" side of the match (there is
  no ground-truth comparison for an uploaded photo, since the actual shift
  isn't known).
