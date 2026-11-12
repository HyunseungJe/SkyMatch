// Typed access to the sky source of truth in ../sky (schema v1 and presets).
import schemaJson from '../../../sky/sky_schema_v1.json';
import presetsJson from '../../../sky/presets.json';

export type ParamRole = 'regress' | 'classify' | 'artist' | 'nuisance';

export interface ParamDef {
  role: ParamRole;
  default: number;
  label: string;
  min?: number;
  max?: number;
  unit?: string;
  scale?: 'log';
  type?: 'categorical';
  values?: Record<string, string>;
  /** Condition under which the param has no visible effect (excluded from loss and evaluation). */
  mask?: string;
  /** Condition under which the param has any effect at all. */
  activeWhen?: string;
  note?: string;
}

// ---- Conditions ("activeWhen" / "mask") -------------------------------------
// Grammar: comparisons joined by &&, e.g. "nightEffect == 1 && sunElevation < -6".
type Comparison = { param: string; op: '<' | '<=' | '>' | '>=' | '=='; value: number };
type Condition = Comparison[];

function parseCondition(expression: string): Condition {
  return expression.split('&&').map((part) => {
    const match = /^\s*(\w+)\s*(<=|>=|==|<|>)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(part);
    if (!match) throw new Error(`Cannot parse schema condition: "${expression}"`);
    return { param: match[1], op: match[2] as Comparison['op'], value: Number(match[3]) };
  });
}

function holds(condition: Condition, theta: SkyParams): boolean {
  return condition.every(({ param, op, value }) => {
    const x = theta[param];
    if (op === '<') return x < value;
    if (op === '<=') return x <= value;
    if (op === '>') return x > value;
    if (op === '>=') return x >= value;
    return x === value;
  });
}

interface EffectDef {
  id: number;
  artistParams: string[];
}

/** A full sky parameter set θ: every schema param by name. */
export type SkyParams = Record<string, number>;

export const schemaVersion: string = schemaJson.version;
export const paramDefs = schemaJson.params as unknown as Record<string, ParamDef>;
export const paramNames = Object.keys(paramDefs);

export const presets = presetsJson.presets as Record<string, Partial<SkyParams>>;
export const presetNames = Object.keys(presets);

const activeConditions: Record<string, Condition> = {};
const maskConditions: Record<string, Condition> = {};
for (const name of paramNames) {
  const def = paramDefs[name];
  if (def.activeWhen) activeConditions[name] = parseCondition(def.activeWhen);
  if (def.mask) maskConditions[name] = parseCondition(def.mask);
}
// An effect's geometry params (artist) only matter while that effect is selected.
const selector = schemaJson.effects.selector;
for (const effect of Object.values(schemaJson.effects.list) as EffectDef[]) {
  const condition = parseCondition(`${selector} == ${effect.id} && ${paramDefs[selector].activeWhen}`);
  for (const name of effect.artistParams) activeConditions[name] = condition;
}
for (const condition of [...Object.values(activeConditions), ...Object.values(maskConditions)]) {
  for (const { param } of condition) {
    if (!(param in paramDefs)) throw new Error(`Schema condition refers to unknown param "${param}"`);
  }
}

/** False when the param cannot affect the sky at this θ (wrong time of day, effect not selected, masked). */
export function isParamActive(name: string, theta: SkyParams): boolean {
  const active = activeConditions[name];
  if (active && !holds(active, theta)) return false;
  const mask = maskConditions[name];
  return !(mask && holds(mask, theta));
}

export function defaultParams(): SkyParams {
  const theta: SkyParams = {};
  for (const name of paramNames) theta[name] = paramDefs[name].default;
  return theta;
}

/** Presets list only differences from the defaults. */
export function presetParams(name: string): SkyParams {
  const preset = presets[name];
  if (!preset) throw new Error(`Unknown preset: ${name}`);
  for (const key of Object.keys(preset)) {
    if (!(key in paramDefs)) throw new Error(`Preset "${name}" has unknown param "${key}"`);
  }
  return { ...defaultParams(), ...(preset as SkyParams) };
}
