# /// script
# requires-python = ">=3.10"
# dependencies = ["matplotlib>=3.8"]
# ///
"""Report figure: learning curves of the final candidates (validation loss per epoch).

    uv run ml/experiments/bench-2026-11-24/learning_curve.py --logs ml/experiments/bench-2026-11-24/results/logs --out learning-curve.png

Reads the train.py logs (one JSON line per epoch) copied into results/logs/: r50-aug3 (final), r50
and r18-e30. Loss = regress + classify, the same validation loss train.py selects the model by.
The marked point is the lowest validation loss of the final run, i.e. the epoch of its best.pt.
Epochs are drawn 1-based (log epoch 0 = epoch 1).

matplotlib is not a dependency of the ml package; `uv run` installs it for this script only.
Korean labels need a Korean font (Malgun Gothic on Windows, NanumGothic or Noto Sans CJK KR on Linux).
"""
import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--logs', type=Path, required=True)
ap.add_argument('--out', type=Path, required=True)
a = ap.parse_args()

installed = {f.name for f in font_manager.fontManager.ttflist}
korean = next((n for n in ('Malgun Gothic', 'NanumGothic', 'Noto Sans CJK KR') if n in installed), None)
if korean is None:
    print('warning: no Korean font found; labels will not render')
else:
    plt.rcParams['font.family'] = korean
plt.rcParams['axes.unicode_minus'] = False


def load(name):
    rows = [json.loads(l) for l in (a.logs / f'{name}.jsonl').read_text(encoding='utf-8').splitlines() if l.strip()]
    x = [r['epoch'] + 1 for r in rows]
    val = [r['val_loss_regress'] + r['val_loss_classify'] for r in rows]
    train = [r['train_loss_regress'] + r['train_loss_classify'] for r in rows]
    return x, val, train


final_x, final_val, final_train = load('r50-aug3')
r50_x, r50_val, _ = load('r50')
r18_x, r18_val, _ = load('r18-e30')

BLUE, ORANGE, GRAY = '#1f6fe5', '#e07b10', '#8a8a8a'
fig, ax = plt.subplots(figsize=(5.2, 3.6), dpi=200)
ax.plot(final_x, final_train, '--', color=BLUE, lw=1.4, label='ResNet-50+증강 훈련')
ax.plot(final_x, final_val, '-', color=BLUE, lw=2.2, label='ResNet-50+증강 검증')
ax.plot(r50_x, r50_val, '-', color=ORANGE, lw=1.4, label=f'ResNet-50 검증 ({len(r50_x)}에폭 조기 종료)')
ax.plot(r18_x, r18_val, '-', color=GRAY, lw=1.4, label='ResNet-18 검증')

best = min(range(len(final_val)), key=final_val.__getitem__)
ax.plot([final_x[best]], [final_val[best]], 'o', color=BLUE, ms=6)
ax.annotate(f'선택: {final_x[best]}에폭, {final_val[best]:.3f}', (final_x[best], final_val[best]),
            xytext=(15.3, 0.103), textcoords='data', color=BLUE, fontsize=9,
            arrowprops=dict(arrowstyle='-', color=BLUE, lw=0.8))

ax.set_title('학습 곡선', fontsize=11)
ax.set_xlabel('에폭', fontsize=10)
ax.set_ylabel('손실 (회귀 + 분류)', fontsize=10)
ax.set_xlim(-0.5, max(final_x) + 1)
ax.set_ylim(0.08, 0.6)
ax.grid(alpha=0.3)
ax.legend(fontsize=8.5, frameon=False, loc='upper right')
ax.tick_params(labelsize=9)
fig.tight_layout()
fig.savefig(a.out)
print(f'best {final_x[best]} epoch, val loss {final_val[best]:.4f} -> {a.out}')
