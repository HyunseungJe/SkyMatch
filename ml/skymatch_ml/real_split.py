"""Build the real-photo evaluation set (real-dev / real-test) from the collected photo manifest.

    python -m skymatch_ml.real_split --manifest <broad/manifest.csv> --out <real-v1 dir> [--seed 20261117]

Real photos are used only for evaluation, never for training. Steps (all deterministic):
  1. Keep every photo of every set (A, B, old) except those with an unknown licence.
  2. Group photos that must stay on the same side: same author (after cleaning the author
     text), or perceptual hashes (64-bit DCT pHash) within Hamming distance PHASH_GROUP.
     Groups are connected components, so a chain of near-duplicates is one group.
  3. Assign whole groups to dev or test, largest first. Each group goes to the side that keeps
     the strata (set x time_of_day x expressible) and the per-set totals closest to 50/50;
     ties are broken by a seeded random draw.
Output (<out>): split.csv (one row per photo), images/<id>.<ext> (copies), summary.json.
Photos are not part of the repository; split.csv lists only ids, provenance and licences.
"""
from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import re
import shutil
from pathlib import Path

import numpy as np

PHASH_GROUP = 10
FIELDS = ['id', 'set', 'split', 'group', 'file', 'sha256', 'time_of_day', 'expressible', 'sky_fraction', 'foreground',
          'phenomena', 'author', 'licence', 'licence_url', 'source_page', 'file_url']


def clean_author(text: str) -> str:
    """Commons creator templates leak their CSS into the scraped text: keep what follows it."""
    text = re.sub(r'^.*\}', '', text, flags=re.S) if '{' in text else text
    return re.sub(r'\s+', ' ', text).strip()


def build(manifest: Path, out: Path, seed: int) -> dict:
    base = manifest.parent
    rows = [r for r in csv.DictReader(manifest.open(encoding='utf-8-sig'))]
    dropped = [r['file'] for r in rows if r['licence'].strip().lower() in ('', 'unknown')]
    rows = [r for r in rows if r['licence'].strip().lower() not in ('', 'unknown')]
    for r in rows:
        r['author'] = clean_author(r['author'])
        r['id'] = Path(r['file']).stem
    assert len({r['id'] for r in rows}) == len(rows), 'photo ids must be unique'

    # ---- groups: union-find over author and near-duplicate hashes ----
    parent = list(range(len(rows)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        parent[find(i)] = find(j)

    by_author = collections.defaultdict(list)
    for i, r in enumerate(rows):
        by_author[r['author'].lower()].append(i)
    for members in by_author.values():
        for j in members[1:]:
            union(members[0], j)
    hashes = np.array([int(r['phash'], 16) for r in rows], dtype=np.uint64)
    for i in range(len(rows)):
        x = np.bitwise_xor(hashes[i + 1:], hashes[i])
        dist = np.array([bin(int(v)).count('1') for v in x])
        for j in np.nonzero(dist <= PHASH_GROUP)[0]:
            union(i, i + 1 + int(j))
    groups = collections.defaultdict(list)
    for i in range(len(rows)):
        groups[find(i)].append(i)
    group_list = sorted(groups.values(), key=lambda g: (-len(g), min(rows[i]['id'] for i in g)))
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(group_list))  # tie-break order among equal sizes
    group_list = [group_list[k] for k in sorted(range(len(group_list)), key=lambda k: (-len(group_list[k]), order[k]))]

    # ---- balanced assignment ----
    def stratum(r):
        return (r['set'], r['time_of_day'], r['expressible'])

    counts = {'dev': collections.Counter(), 'test': collections.Counter()}
    sets = {'dev': collections.Counter(), 'test': collections.Counter()}

    def imbalance(side, g):
        c = {s: counts[s].copy() for s in counts}
        t = {s: sets[s].copy() for s in sets}
        for i in g:
            c[side][stratum(rows[i])] += 1
            t[side][rows[i]['set']] += 1
        keys = set(c['dev']) | set(c['test'])
        return sum(abs(c['dev'][k] - c['test'][k]) for k in keys) + 2 * sum(abs(t['dev'][k] - t['test'][k]) for k in t['dev'] | t['test'])

    for gid, g in enumerate(group_list):
        a, b = imbalance('dev', g), imbalance('test', g)
        side = 'dev' if a < b else 'test' if b < a else ('dev' if rng.random() < 0.5 else 'test')
        for i in g:
            rows[i]['split'] = side
            rows[i]['group'] = f'g{gid:04d}'
            counts[side][stratum(rows[i])] += 1
            sets[side][rows[i]['set']] += 1

    # ---- write ----
    (out / 'images').mkdir(parents=True, exist_ok=True)
    for r in rows:
        src = (base / r['file']).resolve()
        data = src.read_bytes()
        r['sha256'] = hashlib.sha256(data).hexdigest()
        dst = out / 'images' / f'{r["id"]}{src.suffix.lower()}'
        if not dst.exists():
            shutil.copyfile(src, dst)
        r['file'] = f'images/{dst.name}'
    rows.sort(key=lambda r: (r['split'], r['set'], r['id']))
    with (out / 'split.csv').open('w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, FIELDS, extrasaction='ignore', lineterminator='\n')
        w.writeheader()
        w.writerows(rows)

    def table(key):
        t = collections.defaultdict(lambda: {'dev': 0, 'test': 0})
        for r in rows:
            t[r[key] if isinstance(key, str) else key(r)][r['split']] += 1
        return dict(sorted(t.items()))

    summary = {'seed': seed, 'phash_group_distance': PHASH_GROUP, 'photos': len(rows),
               'dropped_unknown_licence': dropped, 'groups': len(group_list),
               'largest_groups': [len(g) for g in group_list[:5]],
               'by_set': table('set'), 'by_time_of_day': table('time_of_day'), 'by_expressible': table('expressible'),
               'source_manifest_sha256': hashlib.sha256(manifest.read_bytes()).hexdigest()}
    (out / 'summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--manifest', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--seed', type=int, default=20261117)
    a = ap.parse_args()
    print(json.dumps(build(a.manifest, a.out, a.seed), indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
