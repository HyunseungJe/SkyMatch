"""Generate a synthetic sky dataset from a config.

    python -m skymatch_ml.generate --config ml/datasets/v1.toml --out <dir> [--limit N] [--preview 64]

Output (<dir>):
  manifest.json                 config (verbatim), git commit, shader/schema hashes, renderer, versions, counts
  <split>/images-NNNNN.npy      uint8 [n, H, W, 3] sRGB, top row first (numpy .npy, memory-mappable)
  <split>/labels-NNNNN.jsonl    one JSON line per image, same order: index, θ (thetaFile.ts params),
                                camera, active targets, colour mode
  preview-<split>.png           optional contact sheet of the first images
Shards are written atomically and skipped on rerun, so an interrupted run resumes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
import tomllib
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .render import Renderer, source_hashes
from .sampler import SPLIT_STREAM, sample_item
from .schema import REPO, Schema


def git_state() -> dict:
    def run(*args):
        return subprocess.run(['git', *args], cwd=REPO, capture_output=True, text=True, timeout=30).stdout.strip()
    return {'commit': run('rev-parse', 'HEAD'), 'dirty': bool(run('status', '--porcelain', '--', 'ml', 'sky', 'web/src/sky'))}


def versions() -> dict:
    import moderngl
    import PIL
    return {'python': platform.python_version(), 'numpy': np.__version__, 'moderngl': moderngl.__version__,
            'pillow': PIL.__version__, 'platform': platform.platform()}


def write_shard(renderer, config, schema, split, split_id, start, count, out_dir: Path) -> None:
    w, h = config['render']['width'], config['render']['height']
    stem = f'{start // config["render"]["shard_size"]:05d}'
    images_path, labels_path = out_dir / f'images-{stem}.npy', out_dir / f'labels-{stem}.jsonl'
    if images_path.exists() and labels_path.exists():
        return
    tmp_images = out_dir / f'images-{stem}.tmp.npy'
    images = np.lib.format.open_memmap(tmp_images, mode='w+', dtype=np.uint8, shape=(count, h, w, 3))
    lines = []
    for k in range(count):
        item = sample_item(config, schema, split_id, start + k)
        images[k] = renderer.render(item['params'], item['camera'], w, h)
        lines.append(json.dumps({'split': split, 'index': start + k, 'params': schema.to_json_params(item['params']),
                                 'camera': item['camera'], 'active': item['active'], 'color_mode': item['color_mode']}))
    images.flush()
    del images
    os.replace(tmp_images, images_path)
    tmp_labels = out_dir / f'labels-{stem}.tmp.jsonl'
    tmp_labels.write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')  # same bytes on every OS
    os.replace(tmp_labels, labels_path)  # labels last: a shard counts as done only when both exist


def preview(out: Path, split: str, n: int, cols: int = 8) -> None:
    from PIL import Image
    images = []
    for path in sorted((out / split).glob('images-*.npy')):
        images.extend(np.load(path, mmap_mode='r')[: n - len(images)])
        if len(images) >= n:
            break
    if not images:
        return
    h, w, _ = images[0].shape
    rows = (len(images) + cols - 1) // cols
    sheet = np.zeros((rows * (h + 4), cols * (w + 4), 3), np.uint8)
    for i, im in enumerate(images):
        y, x = divmod(i, cols)
        sheet[y * (h + 4): y * (h + 4) + h, x * (w + 4): x * (w + 4) + w] = im
    Image.fromarray(sheet).save(out / f'preview-{split}.png')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--config', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--splits', default='train,val,test')
    ap.add_argument('--limit', type=int, default=None, help='at most N images per split (smoke tests)')
    ap.add_argument('--backend', default='auto', choices=['auto', 'egl', 'wgl'])
    ap.add_argument('--preview', type=int, default=0, help='also write a contact sheet of the first N images per split')
    a = ap.parse_args()

    config_text = a.config.read_text(encoding='utf-8')
    config = tomllib.loads(config_text)
    schema = Schema()
    if config['schema'] != schema.version:
        sys.exit(f'Config is for schema {config["schema"]}, repository has {schema.version}')
    a.out.mkdir(parents=True, exist_ok=True)
    shard = config['render']['shard_size']
    started = time.time()
    counts = {}
    with Renderer(a.backend) as renderer:
        print(json.dumps(renderer.info), flush=True)
        for split in a.splits.split(','):
            spec = config['splits'][split]
            total = spec['count'] if a.limit is None else min(spec['count'], a.limit)
            (a.out / split).mkdir(exist_ok=True)
            split_started = time.time()
            for start in range(0, total, shard):
                write_shard(renderer, config, schema, split, spec['id'], start, min(shard, total - start), a.out / split)
                done = min(start + shard, total)
                rate = done / max(1e-9, time.time() - split_started)
                print(f'{split}: {done}/{total} ({rate:.0f} img/s, includes skipped shards)', flush=True)
            counts[split] = total
        info = renderer.info
    manifest = {
        'name': config['name'], 'created': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'config_file': str(a.config), 'config_sha256': hashlib.sha256(config_text.encode()).hexdigest(),
        'config': config_text, 'seed_streams': SPLIT_STREAM, 'counts': counts, 'limit': a.limit,
        'image': {'width': config['render']['width'], 'height': config['render']['height'], 'dtype': 'uint8',
                  'encoding': 'sRGB, AgX display transform at exposure 1, no dither, top row first'},
        'git': git_state(), 'sources': source_hashes(), 'renderer': info, 'versions': versions(),
        'seconds': round(time.time() - started, 1),
    }
    (a.out / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    for split in counts:
        if a.preview:
            preview(a.out, split, a.preview)
    print(f'done in {manifest["seconds"]} s -> {a.out}', flush=True)


if __name__ == '__main__':
    main()
