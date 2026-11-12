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
  mask?: string;
  activeWhen?: string;
  note?: string;
}

/** A full sky parameter set θ: every schema param by name. */
export type SkyParams = Record<string, number>;

export const schemaVersion: string = schemaJson.version;
export const paramDefs = schemaJson.params as unknown as Record<string, ParamDef>;
export const paramNames = Object.keys(paramDefs);

export const presets = presetsJson.presets as Record<string, Partial<SkyParams>>;
export const presetNames = Object.keys(presets);

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
