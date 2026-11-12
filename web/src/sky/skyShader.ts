// Loads the reference sky GLSL unchanged and wraps it for WebGL2.
// The sky itself stays in ../sky/skyV1.glsl; exposure, tone mapping and the sRGB
// transfer live here, outside the sky (shader contract).
import skySource from '../../../sky/skyV1.glsl?raw';
import { paramDefs } from './schema';

export interface SkyUniform {
  /** Schema param name, e.g. "sunElevation". */
  param: string;
  /** GLSL uniform name, e.g. "u_sky_sunElevation". */
  uniform: string;
  type: 'float' | 'int';
}

// GLSL ES 3.00 does not allow uniform initializers; the reference file keeps them
// as documentation of the schema defaults (and for generators that can use them).
const sky = skySource.replace(/^(\s*uniform\s+\w+\s+\w+)\s*=[^;]*;/gm, '$1;');

export const skyUniforms: SkyUniform[] = [...sky.matchAll(/^\s*uniform\s+(float|int)\s+u_sky_(\w+)\s*;/gm)].map(
  (m) => ({ param: m[2], uniform: `u_sky_${m[2]}`, type: m[1] as 'float' | 'int' }),
);

for (const u of skyUniforms) {
  if (!(u.param in paramDefs)) throw new Error(`GLSL uniform ${u.uniform} is not in the schema`);
}

export const vertexShader = /* glsl */ `
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const fragmentShader = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

${sky}

// ---- Web display wrapper (not part of the sky) ------------------------------
uniform vec2 u_resolution;   // render target size in pixels
uniform mat3 u_camera;       // columns: right, up, forward (sky space, Y-up)
uniform float u_tanHalfFov;  // tan(vertical FOV / 2)
uniform float u_exposure;    // schema "exposure" (nuisance), applied outside the sky
out vec4 outColor;

vec3 display_transform(vec3 color) {
  color = max(color * u_exposure, 0.0);
  color = color / (1.0 + color);
  // Exact linear -> sRGB transfer.
  return mix(color * 12.92, 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), color));
}

// 8-bit output dither: hides banding in smooth sky gradients.
float display_dither(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z) - 0.5;
}

void main() {
  vec2 ndc = gl_FragCoord.xy / u_resolution * 2.0 - 1.0;
  float aspect = u_resolution.x / u_resolution.y;
  vec3 rd = normalize(u_camera * vec3(ndc.x * aspect * u_tanHalfFov, ndc.y * u_tanHalfFov, 1.0));
  vec3 color = display_transform(skyV1_radiance(rd));
  outColor = vec4(color + display_dither(gl_FragCoord.xy) / 255.0, 1.0);
}
`;
