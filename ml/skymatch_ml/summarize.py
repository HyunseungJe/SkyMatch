"""Write STATUS.md and SUMMARY.md (Korean) for an experiment queue (ml/experiments/*.sh).

    python -m skymatch_ml.summarize --dir <queue dir> --baseline <run dir> [--reference <experiment>]
        [--seed-pair <experiment> <experiment>]

<queue dir>/plan.tsv           name \\t options \\t what changed      (written by the queue script)
<queue dir>/queue-state.tsv    time \\t name \\t event \\t note        (appended by the queue script)
<queue dir>/<name>/eval.json   from skymatch_ml.evaluate
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

# (key, Korean label, getter, lower is better, unit format)
METRICS = [
    ('sun', '해 고도 오차(°)', lambda e: e['synthetic_test']['mae']['sunElevation'], True, '{:.2f}'),
    ('zen', '천정색 오차', lambda e: e['synthetic_test']['mae']['zenithColor'], True, '{:.1f}'),
    ('hor', '지평선색 오차', lambda e: e['synthetic_test']['mae']['horizonColor'], True, '{:.1f}'),
    ('cloud', '구름 양 오차', lambda e: e['synthetic_test']['mae']['cloudCover'], True, '{:.4f}'),
    ('acc', '밤 효과 정확도', lambda e: e['synthetic_test']['mae']['nightEffect_acc'], False, '{:.3f}'),
    ('n2n', '밤 사진→밤', lambda e: e['real_dev']['key']['night_as_night'], False, '{:d}'),
    ('d2n', '낮 사진→밤', lambda e: e['real_dev']['key']['day_as_night'], True, '{:d}'),
]
TIMES = [('day', '낮'), ('low-sun', '해 낮음'), ('twilight', '박명'), ('night', '밤')]


def read_tsv(p: Path) -> list[list[str]]:
    if not p.exists():
        return []
    return [l.split('\t') for l in p.read_text(encoding='utf-8').splitlines() if l.strip()]


def load_eval(run: Path):
    p = run / 'eval.json'
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else None


def epochs_done(run: Path) -> int:
    p = run / 'log.jsonl'
    return sum(1 for l in p.read_text(encoding='utf-8').splitlines() if l.strip()) if p.exists() else 0


def status_md(d: Path, plan, events) -> str:
    last: dict[str, list] = {}
    for ev in events:
        last.setdefault(ev[1], []).append(ev)
    queue = [ev for ev in events if ev[1] == '-']
    lines = ['# 밤샘 실험 진행 상황 (자동 갱신)', '']
    if queue:
        lines += [f'- 대기열: {queue[0][3] if len(queue[0]) > 3 else ""}', f'- 대기열 시작: {queue[0][0]}']
        if queue[-1][2] == 'queue-done':
            lines.append(f'- **대기열 끝남: {queue[-1][0]}**')
    lines.append('')
    running = [n for n, *_ in plan if last.get(n) and last[n][-1][2] in ('started', 'retry', 'evaluating')]
    lines.append('## 지금 도는 실험')
    if running:
        for n in running:
            st = [e for e in last[n] if e[2] in ('started', 'retry')][-1]
            opts = dict((p[0], p[1]) for p in plan)[n]
            run = d / n
            ep = epochs_done(run)
            lines.append(f'- **{n}** (`{opts}`) — 시작 {st[0]}, 단계 `{last[n][-1][2]}`, 끝난 에폭 {ep}')
    else:
        lines.append('- 없음')
    lines += ['', '## 실험별 상태', '', '| 순서 | 실험 | 옵션 | 상태 | 시작 | 끝 | 메모 |', '|---|---|---|---|---|---|---|']
    names = {'started': '학습 중', 'retry': '재시도 중', 'evaluating': '평가 중', 'done': '완료',
             'failed': '실패', 'eval-failed': '평가 실패', 'skipped': '건너뜀'}
    for i, (n, opts, _) in enumerate(plan, 1):
        evs = last.get(n, [])
        if not evs:
            lines.append(f'| {i} | {n} | `{opts}` | 대기 | | | |')
            continue
        start = next((e[0] for e in evs if e[2] == 'started'), '')
        end = evs[-1][0] if evs[-1][2] in ('done', 'failed', 'eval-failed', 'skipped') else ''
        notes = '; '.join(e[3] for e in evs if len(e) > 3 and e[3])
        lines.append(f'| {i} | {n} | `{opts}` | {names.get(evs[-1][2], evs[-1][2])} | {start} | {end} | {notes} |')
    lines += ['', '실패 이유는 각 실행 폴더의 `train.log` / `eval.log` 끝부분에 있습니다.', '']
    return '\n'.join(lines)


def fmt(v, f):
    return '' if v is None else f.format(v)


def summary_md(d: Path, plan, baseline: Path, reference: str, seed_pair) -> str:
    rows = []  # (name, change, eval)
    b = load_eval(baseline)
    if b:
        rows.append((f'{baseline.name} (기준선, 웹 모델)', '10에폭, 기존 설정', b))
    for n, opts, change in plan:
        e = load_eval(d / n)
        if e:
            rows.append((n, change, e))
    out = ['# 밤샘 실험 결과 요약 (자동 갱신)', '',
           '- 합성 test: 생성 평가용 10,000장(증강 없음). 오차는 평균 절대 오차, 색은 채널당 0~255.',
           '- real-dev: 실사진 dev 555장(밤 64장, 낮 394장). 「→밤」은 추정 해 고도 < −6°로 본 사진 수. real-test는 쓰지 않았습니다.',
           '- 최고 에폭은 검증 손실이 가장 낮은 에폭(1부터 셈) / 전체 에폭.', '']
    head = ['실험', '바뀐 점', '학습 시간(분)', '최고 에폭'] + [m[1] for m in METRICS] + ['모델 크기(MB)']
    out += ['| ' + ' | '.join(head) + ' |', '|' + '---|' * len(head)]
    for name, change, e in rows:
        cells = [name, change, f"{e['train_seconds'] / 60:.0f}", f"{e['best_epoch'] + 1}/{e['epochs_logged']}"]
        for key, _, get, _, f in METRICS:
            v = get(e)
            if key == 'n2n':
                cells.append(f"{v}/{e['real_dev']['key']['night_n']}")
            elif key == 'd2n':
                cells.append(f"{v}/{e['real_dev']['key']['day_n']}")
            else:
                cells.append(fmt(v, f))
        mb = e.get('model_onnx_bytes')
        cells.append(f'{mb / 1e6:.1f}' if mb else '')
        out.append('| ' + ' | '.join(cells) + ' |')

    out += ['', '## real-dev 시간대별 추정 해 고도 중앙값(°) / 10° 이상으로 본 비율', '',
            '| 실험 | ' + ' | '.join(t for _, t in TIMES) + ' |', '|---|' + '---|' * len(TIMES)]
    for name, _, e in rows:
        by = e['real_dev']['by_time_of_day']
        out.append(f'| {name} | ' + ' | '.join(
            f"{by[k]['median_sun_elevation']:.1f} / {by[k]['seen_high_frac'] * 100:.0f}%" if k in by else ''
            for k, _ in TIMES) + ' |')

    # automatic reading: differences against the reference run, compared with the seed spread
    ev = {n: load_eval(d / n) for n, _, _ in plan}
    ref = ev.get(reference)
    a, b2 = (ev.get(seed_pair[0]), ev.get(seed_pair[1]))
    out += ['', '## 자동 해석', '']
    if not ref:
        out.append(f'- 비교 기준 `{reference}`가 아직 끝나지 않았습니다.')
        return '\n'.join(out) + '\n'
    if a and b2:
        spread = {k: abs(get(a) - get(b2)) for k, _, get, _, _ in METRICS}
        out.append(f'- 시드 차이(`{seed_pair[0]}` vs `{seed_pair[1]}`, 같은 설정·다른 시드): ' + ', '.join(
            f'{label} {f.format(spread[k])}'
            for k, label, _, _, f in METRICS))
        out.append('- 아래에서 「의미 있음」은 기준 대비 차이가 시드 차이의 2배보다 크고, 최소 폭(해 고도 0.1°, 색 0.3, '
                   '구름 0.002, 정확도 0.005, 사진 2장)도 넘는 경우입니다. 시드 쌍이 하나뿐이라 대략적인 기준입니다.')
    else:
        spread = None
        out.append('- 시드 비교 실험이 아직 끝나지 않아 차이의 의미를 판단하지 못했습니다(아래는 단순 차이).')
    floor = {'sun': 0.1, 'zen': 0.3, 'hor': 0.3, 'cloud': 0.002, 'acc': 0.005, 'n2n': 2, 'd2n': 2}
    out.append(f'- 기준: `{reference}` (ResNet-18, 30에폭, 기본 설정)')
    for n, _, change in plan:
        e = ev.get(n)
        if not e or n == reference:
            continue
        better, worse = [], []
        for k, label, get, low, f in METRICS:
            diff = get(e) - get(ref)
            thr = max(floor[k], 2 * spread[k]) if spread else floor[k]
            if abs(diff) <= thr:
                continue
            txt = f'{label} {get(ref):{f[2:-1]}}→{get(e):{f[2:-1]}}'
            (better if (diff < 0) == low else worse).append(txt)
        verdict = []
        if better:
            verdict.append('나아짐: ' + ', '.join(better))
        if worse:
            verdict.append('나빠짐: ' + ', '.join(worse))
        out.append(f'- **{n}** ({change}): ' + ('; '.join(verdict) if verdict else '기준과 차이 없음(시드 차이 범위 안)'))
    return '\n'.join(out) + '\n'


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dir', type=Path, required=True)
    ap.add_argument('--baseline', type=Path, required=True)
    ap.add_argument('--reference', default='r18-e30')
    ap.add_argument('--seed-pair', nargs=2, default=['r18-e30', 'r18-e30-seed1'])
    a = ap.parse_args()
    plan = [r[:3] for r in read_tsv(a.dir / 'plan.tsv')]
    events = read_tsv(a.dir / 'queue-state.tsv')
    (a.dir / 'STATUS.md').write_text(status_md(a.dir, plan, events), encoding='utf-8')
    (a.dir / 'SUMMARY.md').write_text(summary_md(a.dir, plan, a.baseline, a.reference, a.seed_pair), encoding='utf-8')


if __name__ == '__main__':
    main()
