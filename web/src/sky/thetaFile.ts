// θ JSON: the one file every tool reads (web, Blender, Godot, Unity).
// {"schema": "1.0", "params": {"sunElevation": 8, "zenithColor": "#2f6fc4", ...}}
// Colours are sRGB "#rrggbb"; every other value is a number. All schema params are written.
import { defaultParams, formatColor, paramDefs, paramNames, parseColor, schemaVersion, type SkyParams } from './schema';

export function thetaToJson(theta: SkyParams): string {
  const params: Record<string, number | string> = {};
  for (const name of paramNames) {
    const value = theta[name];
    params[name] = paramDefs[name].type === 'color' ? formatColor(value) : Number(value.toFixed(6));
  }
  return JSON.stringify({ schema: schemaVersion, params }, null, 2) + '\n';
}

/** Reads a θ file; missing params take schema defaults, unknown params or a newer schema are errors. */
export function thetaFromJson(text: string): SkyParams {
  const data = JSON.parse(text) as { schema?: unknown; params?: Record<string, unknown> };
  if (typeof data.schema !== 'string' || data.schema.split('.')[0] !== schemaVersion.split('.')[0]) {
    throw new Error(`스키마 버전이 맞지 않습니다: ${String(data.schema)} (이 앱은 ${schemaVersion})`);
  }
  if (!data.params || typeof data.params !== 'object') throw new Error('"params" 항목이 없습니다.');
  const theta = defaultParams();
  for (const [name, raw] of Object.entries(data.params)) {
    const def = paramDefs[name];
    if (!def) throw new Error(`알 수 없는 파라미터: ${name}`);
    if (def.type === 'color') {
      if (typeof raw !== 'string') throw new Error(`${name}은(는) "#rrggbb" 색이어야 합니다.`);
      theta[name] = parseColor(raw);
    } else {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`${name}은(는) 숫자여야 합니다.`);
      if (def.type === 'categorical' && !(String(raw) in def.values!)) throw new Error(`${name}에 없는 값입니다: ${raw}`);
      const lo = def.min ?? -Infinity;
      const hi = def.max ?? Infinity;
      theta[name] = Math.min(hi, Math.max(lo, raw));
    }
  }
  return theta;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
