#!/usr/bin/env bash
# Overnight experiment queue, 2026-11-18. One training at a time on the single GPU.
#
#   tmux new -d -s skymatch-queue 'bash ml/experiments/overnight-2026-11-18.sh'
#
# For every experiment: train (log: <run>/train.log) -> skymatch_ml.evaluate (eval.json,
# real-dev.jsonl; log: <run>/eval.log) -> rewrite STATUS.md and SUMMARY.md in $OUT.
# A failed experiment is recorded and the queue moves on. On GPU out-of-memory the experiment
# is retried once with --batch 128 (the failed attempt is kept as <run>.oom-batch256).
# Restart-safe: finished experiments (eval.json present) are skipped, a trained but not yet
# evaluated one is only evaluated, a half-trained one is moved aside to <run>.incomplete-<time>.
set -u

REPO=$(cd "$(dirname "$0")/../.." && pwd)
ML=$REPO/ml
PY=$ML/.venv/bin/python
DATA=${DATA:-$HOME/work/skymatch-data/v1}
REAL=${REAL:-$HOME/work/skymatch-data/real-v1}
OUT=${OUT:-$HOME/work/skymatch-runs/overnight-2026-11-18}
BASELINE=${BASELINE:-$HOME/work/skymatch-runs/demo-r18-128}
EXTRA_OPTS=${EXTRA_OPTS:-}   # smoke test of the queue itself, e.g. "--limit 2048 --epochs 1"
ONLY=${ONLY:-0}              # smoke test: run only the first N experiments (0 = all)
export PYTHONUNBUFFERED=1

# name | train options | what changed (Korean, for SUMMARY.md). All 128x96 unless stated.
EXPERIMENTS=(
  "r18-e30|--epochs 30|ResNet-18, 30에폭"
  "r18-e30-seed1|--epochs 30 --seed 1 --aug-seed 2|30에폭, 다른 시드(seed 1, aug-seed 2)"
  "r18-e30-noise|--epochs 30 --aug noise|30에폭 + 잡음 증강"
  "r18-e30-aug3|--epochs 30 --aug noise,flip,blur|30에폭 + 뒤집기·흐림·잡음 증강"
  "r18-e30-nosil|--epochs 30 --no-silhouette|30에폭, 실루엣 증강 끔"
  "r18-e30-scratch|--epochs 30 --no-pretrained|30에폭, ImageNet 가중치 없이"
  "r34-e30|--epochs 30 --arch resnet34|ResNet-34, 30에폭"
  "mnv3-e30|--epochs 30 --arch mobilenet_v3_large|MobileNetV3-Large, 30에폭"
  "r18-e30-data20k|--epochs 30 --limit 20000|30에폭, 학습 데이터 2만 장"
  "r18-e30-data60k|--epochs 30 --limit 60000|30에폭, 학습 데이터 6만 장"
  "r18-e30-64x48|--epochs 30 --size 64x48|30에폭, 입력 64×48"
  "r18-e60|--epochs 60|60에폭"
  "r18-e30-lr3e-4|--epochs 30 --lr 3e-4|30에폭, 학습률 3e-4"
  "r18-e30-lr3e-3|--epochs 30 --lr 3e-3|30에폭, 학습률 3e-3"
  "r50-e30|--epochs 30 --arch resnet50|ResNet-50, 30에폭"
)

mkdir -p "$OUT"
STATE=$OUT/queue-state.tsv
now() { date '+%m-%d %H:%M'; }
event() { printf '%s\t%s\t%s\t%s\n' "$(now)" "$1" "$2" "${3:-}" >> "$STATE"; summarize; }
summarize() {
  (cd "$ML" && "$PY" -m skymatch_ml.summarize --dir "$OUT" --baseline "$BASELINE") \
    >> "$OUT/summarize.log" 2>&1 || echo "$(now) summarize failed" >> "$OUT/summarize.log"
}
last_error() { grep -E 'Error|error' "$1" 2>/dev/null | tail -1 | cut -c1-200 | tr '\t|' '  '; }

: > "$OUT/plan.tsv"
for e in "${EXPERIMENTS[@]}"; do
  IFS='|' read -r name opts change <<< "$e"
  printf '%s\t%s\t%s\n' "$name" "$opts" "$change" >> "$OUT/plan.tsv"
done

cd "$REPO"
commit=$(git rev-parse --short HEAD)
dirty=$(git status --porcelain -- ml sky web/src/sky | head -1)
event - queue-start "$(basename "$0"), commit $commit${dirty:+ (경고: 커밋되지 않은 변경 있음)}"

if [ ! -f "$BASELINE/eval.json" ]; then
  (cd "$ML" && "$PY" -m skymatch_ml.evaluate --run "$BASELINE" --data "$DATA" --real "$REAL") \
    > "$BASELINE/eval.log" 2>&1 || echo "$(now) baseline eval failed" >> "$OUT/summarize.log"
fi

train() {  # run dir, options...
  local run=$1; shift
  mkdir -p "$run"
  (cd "$ML" && "$PY" -m skymatch_ml.train --data "$DATA" --out "$run" "$@") > "$run/train.log" 2>&1
}

count=0
for e in "${EXPERIMENTS[@]}"; do
  IFS='|' read -r name opts change <<< "$e"
  count=$((count + 1))
  if [ "$ONLY" -gt 0 ] && [ $count -gt "$ONLY" ]; then
    break
  fi
  opts="$opts $EXTRA_OPTS"
  run=$OUT/$name
  if [ -f "$run/eval.json" ]; then
    continue
  fi
  trained=0
  if [ -f "$run/model.json" ] && [ -f "$run/best.pt" ]; then
    trained=1
  elif [ -e "$run" ]; then
    mv "$run" "$run.incomplete-$(date +%H%M%S)"
  fi
  if [ $trained = 0 ]; then
    event "$name" started
    # shellcheck disable=SC2086
    if train "$run" $opts; then
      trained=1
    elif grep -qE 'OutOfMemoryError|CUDA out of memory' "$run/train.log" && [[ "$opts" != *--batch* ]]; then
      mv "$run" "$run.oom-batch256"
      event "$name" retry "GPU 메모리 부족 → --batch 128로 재시도 (실패한 시도: $name.oom-batch256)"
      # shellcheck disable=SC2086
      if train "$run" $opts --batch 128; then
        trained=1
      else
        event "$name" failed "batch 128도 실패(exit $?): $(last_error "$run/train.log")"
      fi
    else
      event "$name" failed "학습 실패: $(last_error "$run/train.log")"
    fi
  fi
  if [ $trained = 1 ]; then
    event "$name" evaluating
    if (cd "$ML" && "$PY" -m skymatch_ml.evaluate --run "$run" --data "$DATA" --real "$REAL") > "$run/eval.log" 2>&1; then
      event "$name" done
    else
      event "$name" eval-failed "평가 실패: $(last_error "$run/eval.log")"
    fi
  fi
done

event - queue-done
