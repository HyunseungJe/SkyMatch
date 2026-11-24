#!/usr/bin/env bash
# Final-model candidates on dataset v2. Model selection follows one rule throughout: lowest
# validation loss (regress + classify) within a run (best.pt, early stopping with --patience 5),
# and between candidates. real-test is NOT read here; only the chosen model gets
# `evaluate --real-split test`, once.
#
# Candidates (all v2, 128x96, 30 epochs max, patience 5):
#   r18        = v2-2026-11-24/r18-e30 (already trained, same rule without early stopping)
#   r50        ResNet-50: best v1 overnight run on most metrics
#   r50-aug3   ResNet-50 + flip, blur, noise augmentation (DATASET.md 7)
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
ML=$REPO/ml
PY=$ML/.venv/bin/python
DATA=${DATA:-$HOME/work/skymatch-data/v2}
REAL=${REAL:-$HOME/work/skymatch-data/real-v1}
OUT=${OUT:-$HOME/work/skymatch-runs/final-2026-11-24}
mkdir -p "$OUT"
now() { date '+%F %T'; }

run_one() {  # name, options...
  local name=$1; shift
  local run=$OUT/$name
  if [ ! -f "$run/model.onnx" ]; then
    rm -rf "$run"; mkdir -p "$run"
    echo "$(now) train $name $*" | tee -a "$OUT/queue.log"
    (cd "$ML" && "$PY" -u -m skymatch_ml.train --data "$DATA" --out "$run" --epochs 30 --patience 5 "$@") \
      > "$run/train.log" 2>&1 || { echo "$(now) FAILED $name" | tee -a "$OUT/queue.log"; return 0; }
  fi
  if [ ! -f "$run/eval.json" ]; then
    (cd "$ML" && "$PY" -u -m skymatch_ml.evaluate --run "$run" --data "$DATA" --real "$REAL") > "$run/eval.log" 2>&1 \
      || echo "$(now) eval FAILED $name" | tee -a "$OUT/queue.log"
  fi
  echo "$(now) finished $name" | tee -a "$OUT/queue.log"
}

run_one r50 --arch resnet50
run_one r50-aug3 --arch resnet50 --aug noise,flip,blur
echo "$(now) done" | tee -a "$OUT/queue.log"
