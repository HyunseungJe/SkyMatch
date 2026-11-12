// Parameter controls generated from the schema: one row per param, grouped by
// role, dimmed while the schema says the param has no effect at the current θ.
import { isParamActive, paramDefs, paramNames, type ParamDef, type ParamRole, type SkyParams } from '../sky/schema';

const SLIDER_STEPS = 1000;

const sections: { title: string; hint: string; roles: ParamRole[] }[] = [
  { title: '분위기', hint: '사진에서 추정하는 값 (회귀·분류)', roles: ['regress', 'classify'] },
  { title: '배치와 움직임', hint: '사용자가 정하는 값', roles: ['artist'] },
  { title: '표시', hint: '하늘 밖에서 곱하는 값', roles: ['nuisance'] },
];

const roleBadge: Record<ParamRole, string> = { regress: '회귀', classify: '분류', artist: '사용자', nuisance: '표시' };

export interface ParamPanel {
  /** Refreshes every control from θ (after a preset or a JSON load). */
  sync(theta: SkyParams): void;
}

interface Row {
  name: string;
  element: HTMLElement;
  write(value: number): void;
}

function formatValue(def: ParamDef, value: number): string {
  const span = (def.max ?? 1) - (def.min ?? 0);
  const digits = span >= 100 ? 1 : 2;
  return value.toFixed(digits) + (def.unit === 'deg' ? '°' : '');
}

// Slider position 0..SLIDER_STEPS <-> value; log params are linear in log(value).
function toPosition(def: ParamDef, value: number): number {
  const min = def.min!;
  const max = def.max!;
  const t = def.scale === 'log' ? Math.log(value / min) / Math.log(max / min) : (value - min) / (max - min);
  return Math.round(Math.min(1, Math.max(0, t)) * SLIDER_STEPS);
}

function fromPosition(def: ParamDef, position: number): number {
  const min = def.min!;
  const max = def.max!;
  const t = position / SLIDER_STEPS;
  return def.scale === 'log' ? min * Math.pow(max / min, t) : min + (max - min) * t;
}

export function createParamPanel(
  container: HTMLElement,
  theta: SkyParams,
  onChange: (name: string, value: number) => void,
): ParamPanel {
  const rows: Row[] = [];

  const refreshActive = () => {
    for (const row of rows) row.element.classList.toggle('inactive', !isParamActive(row.name, theta));
  };

  const commit = (name: string, value: number) => {
    theta[name] = value;
    onChange(name, value);
    refreshActive();
  };

  const buildRow = (name: string, def: ParamDef): Row | null => {
    const categorical = def.type === 'categorical' && def.values;
    // Params without a range (time) are driven by the app, not by a slider.
    if (!categorical && (def.min === undefined || def.max === undefined)) return null;

    const element = document.createElement('div');
    element.className = 'param';
    if (def.note) element.title = def.note;

    const head = document.createElement('div');
    head.className = 'param-head';
    const label = document.createElement('label');
    label.textContent = def.label;
    label.htmlFor = `param-${name}`;
    const badge = document.createElement('span');
    badge.className = `badge ${def.role}`;
    badge.textContent = roleBadge[def.role];
    const readout = document.createElement('output');
    head.append(label, badge, readout);
    element.append(head);

    if (categorical) {
      const select = document.createElement('select');
      select.id = `param-${name}`;
      for (const [value, text] of Object.entries(def.values!)) select.add(new Option(text, value));
      select.addEventListener('change', () => commit(name, Number(select.value)));
      element.append(select);
      readout.hidden = true;
      return { name, element, write: (value) => (select.value = String(Math.round(value))) };
    }

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `param-${name}`;
    slider.min = '0';
    slider.max = String(SLIDER_STEPS);
    slider.step = '1';
    slider.addEventListener('input', () => {
      const value = fromPosition(def, Number(slider.value));
      readout.textContent = formatValue(def, value);
      commit(name, value);
    });
    // Double-click returns one param to its schema default.
    slider.addEventListener('dblclick', () => {
      slider.value = String(toPosition(def, def.default));
      readout.textContent = formatValue(def, def.default);
      commit(name, def.default);
    });
    element.append(slider);
    return {
      name,
      element,
      write: (value) => {
        slider.value = String(toPosition(def, value));
        readout.textContent = formatValue(def, value);
      },
    };
  };

  for (const section of sections) {
    const names = paramNames.filter((name) => section.roles.includes(paramDefs[name].role));
    const built = names.map((name) => buildRow(name, paramDefs[name])).filter((row): row is Row => row !== null);
    if (!built.length) continue;
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.innerHTML = `<span class="section-title"></span><span class="section-hint"></span>`;
    summary.querySelector('.section-title')!.textContent = section.title;
    summary.querySelector('.section-hint')!.textContent = section.hint;
    details.append(summary, ...built.map((row) => row.element));
    container.append(details);
    rows.push(...built);
  }

  const sync = (next: SkyParams) => {
    theta = next;
    for (const row of rows) row.write(theta[row.name]);
    refreshActive();
  };
  sync(theta);
  return { sync };
}
