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
  type: 'float' | 'int' | 'vec3';
}

// GLSL ES 3.00 does not allow uniform initializers; the reference file keeps them
// as documentation of the schema defaults (and for generators that can use them).
const sky = skySource.replace(/^(\s*uniform\s+\w+\s+\w+)\s*=[^;]*;/gm, '$1;');

export const skyUniforms: SkyUniform[] = [...sky.matchAll(/^\s*uniform\s+(float|int|vec3)\s+u_sky_(\w+)\s*;/gm)].map(
  (m) => ({ param: m[2], uniform: `u_sky_${m[2]}`, type: m[1] as 'float' | 'int' | 'vec3' }),
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
uniform float u_exposure;    // schema "exposure" (display), applied outside the sky
out vec4 outColor;

// AgX base look, the view transform Blender uses, so the web matches Blender.
// Fitted approximation after Benjamin Wrensch's "minimal AgX" (MIT licence,
// https://iolite-engine.com/blog_posts/minimal_agx_implementation).
// Input: linear Rec.709. Output: display-encoded, ready for an sRGB screen.
vec3 display_transform(vec3 color) {
  const mat3 toAgx = mat3(
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 fromAgx = mat3(
    1.19687900512017, -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393, maxEv = 4.026069;
  color = toAgx * max(color * u_exposure, 0.0);
  color = clamp(log2(max(color, 1e-10)), minEv, maxEv);
  color = (color - minEv) / (maxEv - minEv);
  // Sigmoid contrast curve (polynomial fit).
  vec3 x2 = color * color, x4 = x2 * x2;
  color = 15.5 * x4 * x2 - 40.14 * x4 * color + 31.96 * x4 - 6.868 * x2 * color
    + 0.4298 * x2 + 0.1191 * color - 0.00232;
  return clamp(fromAgx * color, 0.0, 1.0);
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
