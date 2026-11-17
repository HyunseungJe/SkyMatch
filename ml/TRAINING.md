# 모델 학습

사진 한 장을 넣으면 하늘 파라미터 θ를 내는 모델을 [합성 데이터셋](DATASET.md)으로 학습합니다. 코드는 [`skymatch_ml/train.py`](skymatch_ml/train.py)입니다.

## 모델

- **구조:** 기본은 torchvision ResNet-18입니다. ImageNet으로 미리 학습된 가중치(`IMAGENET1K_V1`, BSD 라이선스)에서 시작합니다.
  - `--arch`로 `resnet18`, `resnet34`, `resnet50`, `mobilenet_v3_large`를 고를 수 있습니다. 모두 `IMAGENET1K_V1` 가중치를 씁니다(`--no-pretrained`면 무작위 초기화).
  - 쓴 구조는 `run.json`(`arch`, `model`)과 `model.json`(`arch`)에 남습니다.
- **출력:** 마지막 분류 층만 선형 층 하나로 바꿨습니다(ResNet은 `fc`, MobileNetV3는 `classifier`의 마지막 층). 회귀 출력 20개와 밤 효과 로짓 3개가 나옵니다.
- **입력:** sRGB [0, 1], 4:3 비율, 기본 128×96입니다. ImageNet 정규화는 모델 안에서 합니다.

## 학습 대상의 표현

[`skymatch_ml/targets.py`](skymatch_ml/targets.py)가 θ를 출력으로 바꿉니다. 스키마의 회귀 파라미터는 범위가 대략 [0, 1]이 되도록 바꿉니다.
- 선형 파라미터: (v − min) / (max − min)
- 로그 척도 파라미터(구름 밀도, 크기): (ln v − ln min) / (ln max − ln min)
- 색: sRGB 채널 3개를 각각 255로 나눔

추정할 때는 이 변환을 거꾸로 하고, 결과를 [0, 1]로 자른 뒤 되돌립니다. 웹은 같은 설명을 `model.json`에서 읽어 똑같이 되돌립니다.

## 손실

다음 두 가지를 1:1로 더합니다. 다른 항, 범위 제한, 사전 지식은 넣지 않습니다.
- **회귀:** Smooth L1(beta 0.05)입니다. 라벨의 `active`가 거짓인 값(이미지에 보이지 않는 값)은 뺍니다. 파라미터마다 비중은 1이고, 색은 채널 3개가 그 1을 나눠 가집니다.
- **분류:** 밤 효과의 교차 엔트로피입니다. 밤 효과가 보이는 표본(해 고도 < −6°)에서만 계산합니다.

## 학습 설정 (기본값)

- AdamW, 학습률 1e-3, weight decay 1e-4
- 처음 500단계는 학습률을 선형으로 올리고, 이후 코사인으로 줄임
- 배치 256, bf16 혼합 정밀도
- 증강: [DATASET.md 7절](DATASET.md#7-증강-학습할-때-적용). 실루엣은 기본으로 켜지고(`--no-silhouette`로 끔), 뒤집기·흐림·잡음은 `--aug flip,blur,noise`로 켬
- 에폭마다 검증 세트로 평가하고, 검증 손실이 가장 낮은 가중치를 남김

## 기록

실행 폴더에는 다음이 남습니다.
- `run.json`: 인자, Git 커밋, 데이터셋 manifest 요약, 라이브러리 버전, GPU
- `log.jsonl`: 에폭마다 학습/검증 손실과 파라미터별 검증 오차
  - 일반 파라미터: 원래 단위의 평균 절대 오차
  - 로그 척도 파라미터: |Δ ln v|
  - 색: 채널당 평균 절대 오차(0~255)
  - 밤 효과: 정확도
- `best.pt`: 가장 좋은 가중치
- `model.onnx`, `model.json`: 웹 추론용

## 실행

```sh
cd ml
uv sync --group train
uv run python -m skymatch_ml.train --data <데이터셋 폴더> --out <실행 폴더> --epochs 10
# 시험: --limit 8192 --epochs 1
```

처음 실행하면 학습 크기로 줄인 이미지 캐시(`<데이터셋>/cache/`)를 만듭니다. v1 학습용은 약 6.6GB이고, 이후 실행에서는 다시 쓰입니다. 학습 데이터 전체를 GPU 메모리에 올리므로, 12GB GPU에서는 128×96까지 가능합니다.

## 평가

```sh
uv run python -m skymatch_ml.evaluate --run <실행 폴더> --data <데이터셋 폴더> --real <실사진 평가 세트 폴더>
```

- **합성 test:** `best.pt`로 test 분할 전체를 증강 없이 평가합니다(학습 중 검증과 같은 오차).
- **real-dev:** 실사진 평가 세트에서 `split == dev`인 사진만 씁니다. test 분할은 읽지 않습니다. 전처리는 웹과 같습니다: EXIF 방향 적용 → 긴 변 1024 이하로 축소 → 가운데 4:3 자르기 → 입력 크기로 면적 평균 축소.
  - 사진별 추정은 `real-dev.jsonl`에 남습니다.
  - `time_of_day`(낮, 해 낮음, 박명, 밤)별로 추정 해 고도 중앙값, 밤(< −6°)으로 본 비율, 10° 이상으로 본 비율, 밤으로 본 밤 사진의 밤 효과 분포를 계산합니다.
- 결과는 `eval.json`에 남습니다.
- 웹 모델(`demo-r18-128`)에서 Python 전처리와 브라우저의 결과는 조금 다릅니다(밤 사진 64장 중 밤으로 본 사진: Python 12장, 브라우저 10장. 낮 사진 394장 중 3장은 같음). 축소 필터가 달라서 생기는 차이입니다.

실험 묶음은 `experiments/` 아래의 셸 스크립트로 돌립니다. 각 실험이 끝나면 평가하고, `skymatch_ml.summarize`로 진행 상황(`STATUS.md`)과 비교표(`SUMMARY.md`)를 다시 씁니다.

## 웹에서 쓰기

`model.onnx`와 `model.json`을 `web/public/models/sky-v1/`에 두면, 웹의 「사진으로 맞추기」에서 「ML 모델」 방식으로 씁니다. 사진은 브라우저 밖으로 나가지 않습니다.
