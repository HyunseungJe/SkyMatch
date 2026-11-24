// CMA-ES vs ML, step 2: run the web app's optimiser (web/src/match/fit.ts, default budget 900
// renders, seed 1) on the exported images, in the browser.
//
// 1. Copy <bench dir>/images and labels.jsonl to web/public/_bench/ (temporary; delete afterwards).
// 2. cd web && npm run dev, open http://localhost:5173 (the dev build exposes window.__skyMatch).
// 3. Paste this file into the browser console. Two files are downloaded:
//      cmaes_pred.json      camera estimated from the horizon, as in the app
//      cmaes_cam_pred.json  the image's true camera given (pitch / fov from labels.jsonl)
//    Put both into <bench dir>. Each image takes about 1.7 s, so a run of 200 takes about 6 min.
(async () => {
  const N = 200;
  const labels = (await (await fetch('/_bench/labels.jsonl')).text()).trim().split('\n').map((l) => JSON.parse(l));
  const pixels = async (i) => {
    const img = new Image();
    img.src = `/_bench/images/${String(i).padStart(4, '0')}.png`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, d: Array.from(g.getImageData(0, 0, img.width, img.height).data) };
  };
  const save = (name, data) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = name;
    a.click();
  };
  for (const [name, trueCamera] of [['cmaes_pred.json', false], ['cmaes_cam_pred.json', true]]) {
    const out = [];
    for (let i = 0; i < N; i++) {
      const p = await pixels(i);
      const options = { seed: 1 };
      if (trueCamera) options.camera = { pitch: labels[i].camera.pitch, fov: labels[i].camera.fov };
      const t0 = performance.now();
      const r = await window.__skyMatch.match(p.d, p.w, p.h, options);
      out.push({ i, ms: performance.now() - t0, renders: r.renders, theta: r.theta, camera: r.camera });
      console.log(name, i + 1, '/', N);
    }
    save(name, out);
  }
})();
