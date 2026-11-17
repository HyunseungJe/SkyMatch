# Sky Match

Turn a photo of the sky into the **parameters (θ) of a procedural sky shader**. You can then look at the sky on the web, and use it in Blender, Godot and Unity.

**Live demo:** https://hyunseungje.github.io/SkyMatch/

![Real photos (left) and the sky the ML model estimated from each, rendered by the shader (right)](docs/images/photo-vs-ml.jpg)

```
photo ──► estimate (ML model or optimiser) ──► θ (sky JSON) ──► web preview
                                                         ├─► Blender · Godot · Unity (real-time shader)
                                                         └─► EXR panorama
```

## Features

![The web app: a photo matched by the ML model, with the estimated parameters on the right](docs/images/app.jpg)

- **Edit the sky.** Sliders set sun elevation, three sky colours (zenith, horizon, sun glow), haze, clouds, storm, stars, the Milky Way and aurora. Presets are included.
- **Match a photo.** Pick, drop or paste a photo, and the app estimates the sky parameters. **The photo never leaves the browser.** There are two methods:
  - **ML model (default):** a neural network trained on synthetic images estimates the sky in one pass, about 0.05 s per photo.
  - **Optimiser (CMA-ES):** renders hundreds of candidate skies and fits them to the photo. It takes a few seconds.
- **Scene preview.** Walk around a simple scene under the sky.
- **Export.**
  - **Sky JSON:** one small file that Blender, Godot and Unity load.
  - **EXR:** a linear HDR equirectangular panorama.

The web UI is in Korean.

## Repository layout

| Folder | Contents |
|---|---|
| [`sky/`](sky) | Sky shader source (`skyV1.glsl`), parameter schema (`sky_schema_v1.json`, frozen at 1.0), presets, noise texture |
| [`web/`](web) | Web app (Vite, TypeScript, three.js): photo matching, in-browser ML inference (onnxruntime-web), export |
| [`ports/`](ports) | Shaders and loaders for Blender (OSL), Godot and Unity; how to use them: [`ports/README.md`](ports/README.md) |
| [`ml/`](ml) | Synthetic dataset generation and model training (Python, PyTorch) |
| [`tools/`](tools) | Engine shader generation, building a Blender `.blend`, noise texture generation |

## The ML model

- **Training data:** 200,000 synthetic images rendered with the shader itself (180,000 train, 10,000 validation, 10,000 test). Real photos are never used for training, only for evaluation.
  - The dataset is defined by one config file, [`ml/datasets/v1.toml`](ml/datasets/v1.toml). The same config always gives the same data.
  - How it is made, step by step (in Korean): [`ml/DATASET.md`](ml/DATASET.md)
- **Model:** ResNet-18 starting from ImageNet weights. It takes a 128×96 image, regresses the sky parameters and classifies the night effect.
  - Loss, augmentation and run records (in Korean): [`ml/TRAINING.md`](ml/TRAINING.md)
- **Current web model:** `demo-r18-128`, the first demo model (10 epochs, about 10 minutes of training).
  - Error on the synthetic test set: sun elevation about 6°, zenith colour about 18/255 per channel, night effect accuracy about 85 %.
  - Known weakness: it often fails to recognise real night photos as night.

## Running it yourself

Web app (Node 24):

```sh
cd web
npm ci
npm run dev        # http://localhost:5173
npm run build      # dist/
```

Dataset generation and training (Python 3.12+, [uv](https://docs.astral.sh/uv/)):

```sh
cd ml
uv sync --group train
uv run python -m skymatch_ml.generate --config datasets/v1.toml --out <data dir> --preview 64
uv run python -m skymatch_ml.train --data <data dir> --out <run dir> --epochs 10
```

Put the resulting `model.onnx` and `model.json` in `web/public/models/sky-v1/` and the web app uses them.

Every push to `main` is built by GitHub Actions and deployed to GitHub Pages.

## License

MIT ([`LICENSE`](LICENSE)). Parts of `sky/skyV1.glsl` and of the engine shaders generated from it are adapted from "Fast semi-physical atmosphere" by Felix Westin (MIT); each of those files keeps its notice. The photos in the README images are CC0, from Wikimedia Commons: [`docs/images/CREDITS.md`](docs/images/CREDITS.md).
