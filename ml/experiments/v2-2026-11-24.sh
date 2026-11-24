#!/usr/bin/env bash
# Dataset v2 (night-effect visibility rule, ml/DATASET.md 6.1) and the matching training run.
# Same training settings as overnight-2026-11-18/r18-e30 on v1, so the two compare one change.
#
#   ml/experiments/v2-2026-11-24.sh   (in tmux; each step is skipped when its output exists)
#
# Headless Linux needs EGL: if the system libGL/libEGL are missing, point LD_LIBRARY_PATH at a
# directory with libGL.so / libEGL.so and __EGL_VENDOR_LIBRARY_FILENAMES at the NVIDIA vendor json.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
ML=$REPO/ml
PY=$ML/.venv/bin/python
DATA=${DATA:-$HOME/work/skymatch-data/v2}
REAL=${REAL:-$HOME/work/skymatch-data/real-v1}
OUT=${OUT:-$HOME/work/skymatch-runs/v2-2026-11-24}
mkdir -p "$OUT"
now() { date '+%F %T'; }

if [ ! -f "$DATA/manifest.json" ]; then
  echo "$(now) generate v2 -> $DATA" | tee -a "$OUT/queue.log"
  (cd "$ML" && "$PY" -u -m skymatch_ml.generate --config datasets/v2.toml --out "$DATA" --backend egl --preview 64) \
    > "$OUT/generate.log" 2>&1
fi

run=$OUT/r18-e30
if [ ! -f "$run/model.onnx" ]; then
  mkdir -p "$run"
  echo "$(now) train $run" | tee -a "$OUT/queue.log"
  (cd "$ML" && "$PY" -u -m skymatch_ml.train --data "$DATA" --out "$run" --epochs 30) > "$run/train.log" 2>&1
fi
if [ ! -f "$run/eval.json" ]; then
  echo "$(now) evaluate $run" | tee -a "$OUT/queue.log"
  (cd "$ML" && "$PY" -u -m skymatch_ml.evaluate --run "$run" --data "$DATA" --real "$REAL") > "$run/eval.log" 2>&1
fi
echo "$(now) done" | tee -a "$OUT/queue.log"
