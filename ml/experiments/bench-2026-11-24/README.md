# 최종 모델 비교 실험 (2026-11-24)

최종 보고서의 베이스라인 비교와 예시 그림을 다시 만드는 스크립트입니다. 비교 대상 모델은 `final-2026-11-24/r50-aug3`(ResNet-50 + 뒤집기·흐림·잡음 증강, 데이터셋 v2, 검증 손실 최저 28에폭)입니다.

## 결과 요약

**베이스라인 ① 평균값** (`results/baseline-mean.json`): 사진을 보지 않고 학습 데이터의 평균값을 답합니다. 밤 효과는 학습 데이터의 클래스 비율을 답하고, 가장 큰 쪽은 "없음"입니다. 학습과 같은 손실 함수로 계산했습니다.

| | 검증 손실 (회귀 + 분류) | 태양 고도 오차 | 밤 효과 정답률 |
|---|---|---|---|
| 평균값 | 1.162 (0.225 + 0.937) | 15.6° | 61.1% |
| 최종 모델 | 0.159 (0.080 + 0.080) | 3.9° | 98.2% |

두 줄 모두 합성 검증 1만 장 기준입니다. 보고서의 합성 시험 수치(3.8°, 97.3%)는 시험 분할 기준이라 조금 다릅니다.

**베이스라인 ② CMA-ES** (웹 앱의 수치 최적화, `web/src/match/fit.ts`, 900번 렌더): 합성 시험 이미지 200장(시험 분할의 처음 200장)에서 비교했습니다.

| | 태양 고도 오차 | 구름량 오차 | 밤 효과 정답률 | 다시 그린 그림 SSIM (0.9 이상 비율) | 1장 처리 시간 |
|---|---|---|---|---|---|
| CMA-ES | 14.7° | 0.340 | 64.7% | 0.893 (58%) | 1.7초 |
| CMA-ES + 정답 카메라 | 13.9° | 0.289 | 51.0% | 0.915 (69%) | 1.7초 |
| 최종 모델 | 3.8° | 0.062 | 96.1% | 0.947 (81%) | 0.018초 |

- 오차 정의는 `train.evaluate`와 같습니다(`results/param_result.json`). 밤 효과 정답률은 밤 효과가 보이는 51장 기준입니다.
- SSIM: 각 방법이 추정한 15개 값을 정답 카메라로 다시 그려 원본과 비교합니다(`results/look_result.json`).
- 시간은 같은 PC에서 쟀습니다. CMA-ES는 브라우저(WebGL, GPU), 모델은 ONNX Runtime CPU 1스레드입니다.

## 다시 실행하기

```sh
D=~/work/skymatch-data/v2; RUN=~/work/skymatch-runs/final-2026-11-24/r50-aug3; B=<비교 폴더>
python ml/experiments/bench-2026-11-24/baseline_loss.py --data $D --out results/baseline-mean.json
python ml/experiments/bench-2026-11-24/export.py --data $D --run $RUN --out $B
# web/public/_bench/에 $B/images와 labels.jsonl을 복사하고 npm run dev → 브라우저 콘솔에 cmaes_browser.js
# 내려받은 cmaes_pred.json, cmaes_cam_pred.json을 $B에 두기 (끝나면 web/public/_bench 삭제)
python ml/experiments/bench-2026-11-24/score.py --bench $B --out results/param_result.json
python ml/experiments/bench-2026-11-24/look.py --bench $B --out results/look_result.json       # EGL 필요
# 보고서 결과 표: 평균값·ResNet-18·ResNet-50·최종·CMA-ES를 같은 200장에서 SSIM·평균 색 차이로 채점 (EGL 필요)
python ml/experiments/bench-2026-11-24/look_all.py --bench $B --data $D \
  --run resnet18=~/work/skymatch-runs/v2-2026-11-24/r18-e30 --run resnet50=~/work/skymatch-runs/final-2026-11-24/r50 \
  --run final=$RUN --out results/look_all_result.json
python ml/experiments/bench-2026-11-24/ml_time.py --model $RUN/model.onnx --bench $B
python ml/experiments/bench-2026-11-24/examples.py --real ~/work/skymatch-data/real-v1 --run $RUN --out <그림 폴더>
```

`examples.py`는 보고서 그림 1(실사진 6장과 추정한 하늘)을 만듭니다. 사진은 모두 위키미디어 공용의 CC0 사진입니다(`docs/images/CREDITS.md`).
