// Reference sky (skyV1 atmosphere + R8 soft clouds). This file and sky_schema_v1.json are
// the single source of the sky: every tool-specific shader is generated from this file.
// Needs the shared noise texture (textures/noise256.png) bound to skyV1_noiseTexture.
// Uniform initializers are the schema defaults; the web loader strips them (GLSL ES 3.00).
uniform float iTime=0.0;
uniform float u_sky_sunElevation=8.000000000;
uniform float u_sky_sunAzimuth=20.000000000;
uniform float u_sky_turbidity=1.400000000;
uniform float u_sky_haze=0.000000000;
uniform float u_sky_horizonWarmth=0.000000000;
uniform float u_sky_tintHue=0.330000000;
uniform float u_sky_tintStrength=0.000000000;
uniform float u_sky_cloudCover=0.400000000;
uniform float u_sky_cloudDensity=1.200000000;
uniform float u_sky_cloudScale=2.400000000;
uniform float u_sky_cloudSoftness=0.000000000;
uniform float u_sky_storm=0.000000000;
uniform float u_sky_stars=0.800000000;
uniform float u_sky_moonElevation=25.000000000;
uniform float u_sky_moonAzimuth=-150.000000000;
uniform float u_sky_moonBrightness=0.000000000;
uniform int u_sky_nightEffect=0;
uniform float u_sky_milkyWayBrightness=1.000000000;
uniform float u_sky_auroraIntensity=1.200000000;
uniform float u_sky_auroraHue=0.500000000;
uniform float u_sky_milkyWayTilt=58.000000000;
uniform float u_sky_milkyWayAzimuth=12.000000000;
uniform float u_sky_milkyWayWidth=1.000000000;
uniform float u_sky_auroraAzimuth=0.000000000;
uniform float u_sky_auroraSpread=360.000000000;
uniform float u_sky_auroraHeight=0.450000000;
uniform float u_sky_auroraSpeed=0.350000000;
uniform float u_sky_cloudSpeed=0.120000000;
uniform float u_sky_cloudWindDirection=0.000000000;
uniform sampler2D skyV1_noiseTexture;

#define PI 3.14159265359
struct Material { vec3 albedo; float roughness; float metallic; vec3 emission; };
float world_hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float world_hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float world_noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(world_hash12(i), world_hash12(i + vec2(1,0)), f.x),
    mix(world_hash12(i + vec2(0,1)), world_hash12(i + vec2(1,1)), f.x), f.y);
}
float world_noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(world_hash13(i), world_hash13(i + vec3(1,0,0)), f.x),
                 mix(world_hash13(i + vec3(0,1,0)), world_hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(world_hash13(i + vec3(0,0,1)), world_hash13(i + vec3(1,0,1)), f.x),
                 mix(world_hash13(i + vec3(0,1,1)), world_hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float world_fbm2(vec2 p, int octaves) {
  float value = 0.0, weight = 0.5, total = 0.0;
  for (int i = 0; i < 8; ++i) { if (i >= octaves) break;
    value += weight * world_noise2(p); total += weight; p = p * 2.03 + 17.1; weight *= 0.5;
  }
  return value / max(total, 0.0001);
}
float world_fbm3(vec3 p, int octaves) {
  float value = 0.0, weight = 0.5, total = 0.0;
  for (int i = 0; i < 8; ++i) { if (i >= octaves) break;
    value += weight * world_noise3(p); total += weight; p = p * 2.03 + 17.1; weight *= 0.5;
  }
  return value / max(total, 0.0001);
}


// Copyright (c) 2024 Felix Westin
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// ---- Schema v1 "fixed" values -----------------------------------------------
// v0 fixed values are unchanged (see skyV0.js; folded away as identities).
const float SKYV1_CLOUD_HEIGHT = 0.8;
// Fixed-width replacements for fwidth(): angular sizes assume roughly one
// pixel at a 60 deg vertical FOV on a ~900 px viewport (0.0012 rad).
const float SKYV1_PIXEL_ANGLE = 0.0012;
const float SKYV1_STAR_SPREAD = 0.012; // squared star radius in star-cell units
const float SKYV1_SUN_RADIUS = 0.00436;
// v1 additions.
const float SKYV1_MOON_RADIUS = 0.009;      // rad, about 2x the real moon (stylized)
const float SKYV1_HAZE_ISO = 0.55;          // isotropic aerosol radiance per unit sunlight
const float SKYV1_HAZE_HALO = 0.55;         // broad forward-scattering halo gain
const float SKYV1_EFFECT_FADE_LO = -8.0;    // night effects fully on below (deg)
const float SKYV1_EFFECT_FADE_HI = -3.0;    // night effects off above (deg)
// Milky Way tilt/azimuth/width and aurora azimuth/spread/height/speed are
// artist uniforms (u_sky_*), not constants.
const float SKYV1_GALAXY_STAR_FOOTPRINT = 0.12; // was max(fwidth, 0.12) in milkyWay
const float SKYV1_AURORA_DENSITY = 1.15;
const vec3 SKYV1_LUMA = vec3(0.2126,0.7152,0.0722);

// ---- horizonWarmth (schema role: artist since v1; unchanged from v0) -------
float skyV1_sq(float x) { return x*x; }
float skyV1_warmFill() {
  return (1.0-smoothstep(1.0,22.0,u_sky_sunElevation))
    *smoothstep(-9.0,-1.0,u_sky_sunElevation);
}
float skyV1_pink() { return 0.35*u_sky_horizonWarmth; }
vec3 skyV1_horizonTint(float facing) {
  float k = u_sky_horizonWarmth*skyV1_warmFill()*(0.35+0.65*skyV1_sq(0.5+0.5*facing));
  return mix(vec3(1.0),vec3(1.0,0.80,0.58),k);
}
vec3 skyV1_palette(float up, float facing) {
  return mix(skyV1_horizonTint(facing),vec3(1.0),smoothstep(0.0,0.35,up));
}

// ---- Atmosphere (adapted from lcfSRl Common via twilightSky/skyV0) ---------
float skyV1_phaseR(float costh) { return (1.0+costh*costh)*0.06; }
float skyV1_phaseM(float costh, float g) {
  g = min(g, 0.9381);
  float k = 1.55*g-0.55*g*g*g;
  return (1.0-k*k)/(12.57*skyV1_sq(1.0-k*costh));
}
vec3 skyV1_betaR() { return vec3(5.802,13.558,33.100)*1e-6; }
vec3 skyV1_betaM() { return vec3(3.996e-6*u_sky_turbidity); }
vec3 skyV1_betaO() { return vec3(0.650,1.881,0.085)*1e-6; }
vec3 skyV1_solarDir() {
  float e = radians(u_sky_sunElevation), a = radians(u_sky_sunAzimuth);
  return vec3(sin(a)*cos(e), sin(e), cos(a)*cos(e));
}
float skyV1_night() { return 1.0-smoothstep(-10.0,-2.0,u_sky_sunElevation); }
float skyV1_daylight() { return exp(min(u_sky_sunElevation,0.0)*0.32); }
vec3 skyV1_lightTransmittance(float elevation, float multiplier, float ozoneMultiplier) {
  float extinction = exp(-clamp(elevation+0.05,0.0,1.0)*40.0)
    + exp(-clamp(elevation+0.5,0.0,1.0)*5.0)*0.4
    + skyV1_sq(clamp(1.0-elevation,0.0,1.0))*0.02+0.002;
  return exp(-(skyV1_betaR()+skyV1_betaM()+skyV1_betaO()*ozoneMultiplier)*extinction*multiplier*1e6);
}
vec3 skyV1_warmColor() {
  float sunset = 1.0-smoothstep(-1.0,7.0,u_sky_sunElevation);
  vec3 warm = mix(vec3(1.0,0.63,0.23),vec3(1.0,0.23,0.065),sunset);
  return mix(warm,vec3(1.0,0.30,0.43),skyV1_pink());
}
void skyV1_rayleighMie(float depth, float densityR, float densityM, out vec3 R, out vec3 M) {
  float molecularColumn = depth/(1.0+depth/180000.0);
  float aerosolColumn = depth/(1.0+depth/110000.0);
  R = (1.0-exp(-molecularColumn*densityR*skyV1_betaR()/2.5))*2.5;
  M = (1.0-exp(-aerosolColumn*densityM*skyV1_betaM()/0.5))*0.5;
}
float skyV1_lightElevation(vec3 sun) {
  return sun.y+clamp(-sun.y+0.02,0.0,1.0)*clamp(sun.y+0.7,0.0,1.0);
}
vec3 skyV1_atmosphere(vec3 rd, vec3 sun) {
  float up = max(rd.y,0.0);
  float b = 6371000.0*up;
  float delta = 100000.0*(2.0*6371000.0+100000.0);
  float depth = delta/(sqrt(b*b+delta)+b);
  float hbias = 1.0-1.0/(2.0+depth*depth*1e-12);
  float densityR = hbias*hbias, densityM = pow(hbias,5.0);
  vec3 light = skyV1_lightTransmittance(skyV1_lightElevation(sun),hbias,5.0)*28.0*skyV1_daylight();
  vec3 R, M;
  skyV1_rayleighMie(depth,densityR,densityM,R,M);
  float mu = dot(rd,sun), phaseR = skyV1_phaseR(mu);
  vec3 rayleigh = phaseR*1.3*light;
  vec3 mie = (skyV1_phaseM(mu,0.88)+phaseR*0.3)*light*vec3(0.95,0.85,0.75);
  return (rayleigh*R+mie*M)*0.23;
}
float skyV1_facing(vec3 rd, vec3 sun) {
  return dot(normalize(vec3(rd.x,0.0001,rd.z)),normalize(vec3(sun.x,0.0001,sun.z)));
}
// v0 base sky, unchanged: blue-hour closure, warm band, earth-shadow belt.
vec3 skyV1_base(vec3 rd) {
  float up = max(rd.y,0.0), e = u_sky_sunElevation;
  vec3 sun = skyV1_solarDir();
  float facing = skyV1_facing(rd,sun);
  float dusk = (1.0-smoothstep(0.0,16.0,e))*exp(-skyV1_sq(min(e,0.0)/4.0));
  float blue = exp(-skyV1_sq((e+5.0)/4.8));
  float night = skyV1_night();
  float warmFill = skyV1_warmFill();
  vec3 color = skyV1_atmosphere(rd,sun);
  float toward = pow(max(dot(rd,sun),0.0),2.0);
  float warmFalloff = exp(-up*1.8);
  float golden = warmFill*toward*warmFalloff;
  color *= mix(vec3(1.0),vec3(1.0,0.66,0.32),golden);
  color += skyV1_warmColor()*golden*0.13;
  color += vec3(0.018,0.055,0.125)*blue*(0.38+0.62*sqrt(up));
  float band = exp(-up/(0.028+0.002*max(0.0,6.0+e)));
  color += mix(vec3(0.35,0.052,0.009),vec3(0.35,0.075,0.070),skyV1_pink())
    *dusk*band*pow(0.5+0.5*facing,2.0)*(1.0+1.2*u_sky_horizonWarmth);
  float beltHeight = 0.045+max(-e,0.0)*0.012;
  float belt = exp(-skyV1_sq((up-beltHeight)/0.075));
  float away = pow(0.5-0.5*facing,2.0);
  color *= 1.0-0.38*blue*away*exp(-up/0.065);
  color += vec3(0.055,0.012,0.055)*belt*blue*away;
  color += mix(vec3(0.006,0.012,0.028),vec3(0.0025,0.005,0.018),sqrt(up))*night;
  return color*skyV1_palette(up,facing);
}

// ---- Moon (artist params; moonBrightness = 0 is off) -----------------------
vec3 skyV1_moonDir() {
  float e = radians(u_sky_moonElevation), a = radians(u_sky_moonAzimuth);
  return vec3(sin(a)*cos(e), sin(e), cos(a)*cos(e));
}
float skyV1_moonLight() { return u_sky_moonBrightness*smoothstep(-3.0,3.0,u_sky_moonElevation); }
// Scattered moonlight: a faint Rayleigh-blue lift of the whole night sky plus
// an aureole around the moon. Only at night (the daytime sky swamps it).
vec3 skyV1_moonSky(vec3 rd) {
  float k = skyV1_moonLight()*skyV1_night();
  vec3 m = skyV1_moonDir();
  float up = max(rd.y,0.0), mu = dot(rd,m);
  float separation = sqrt(max(2.0*(1.0-mu),0.0));
  vec3 sky = vec3(0.0035,0.0075,0.018)*(0.75+0.25*mu*mu)*(0.6+0.4*exp(-up*2.5));
  vec3 aureole = vec3(0.010,0.013,0.018)*(1.5*exp(-separation/0.06)+1.0*exp(-separation/0.35));
  return (sky+aureole)*k;
}
vec3 skyV1_moonDisk(vec3 rd) {
  vec3 m = skyV1_moonDir();
  float angle = acos(clamp(dot(rd,m),-1.0,1.0));
  float disk = 1.0-smoothstep(SKYV1_MOON_RADIUS-SKYV1_PIXEL_ANGLE,SKYV1_MOON_RADIUS+SKYV1_PIXEL_ANGLE,angle);
  float maria = 0.72+0.36*world_noise3(rd*420.0+vec3(3.0,7.0,1.0));
  return vec3(1.0,1.04,1.10)*1.3*maria*disk*skyV1_moonLight();
}

// ---- Stars (v0) --------------------------------------------------------------
vec3 skyV1_stars(vec3 rd) {
  vec2 p = vec2(atan(rd.x,rd.z),asin(clamp(rd.y,-1.0,1.0)))*150.0;
  vec2 cell = floor(p);
  vec2 local = fract(p)-vec2(world_hash12(cell+11.0),world_hash12(cell-19.0));
  float point = exp(-dot(local,local)/SKYV1_STAR_SPREAD)*0.005/SKYV1_STAR_SPREAD;
  float selection = step(0.982,world_hash12(cell+63.0));
  return vec3(0.6,0.75,1.0)*point*selection*12.0*u_sky_stars
    *skyV1_sq(skyV1_night())*smoothstep(0.0,0.15,rd.y);
}

// ---- Tint (tintHue, tintStrength) --------------------------------------------
// One hue scalar along a fixed ramp: 0 cyan, 1/3 gold, 2/3 rose, 1 violet.
// Neutral is tintStrength = 0 (not a point on the ramp), so hue and strength
// are not degenerate around neutral; hue is masked when strength < 0.05.
// Horizon and zenith keys differ (warm horizon, cooler partner overhead), so
// a tint is spatially structured and not just camera white balance.
vec3 skyV1_ramp(float h, vec3 a, vec3 b, vec3 c, vec3 d) {
  h = clamp(h,0.0,1.0)*3.0;
  vec3 color = mix(a,b,smoothstep(0.0,1.0,h));
  color = mix(color,c,smoothstep(1.0,2.0,h));
  return mix(color,d,smoothstep(2.0,3.0,h));
}
vec3 skyV1_tintColor(float up) {
  float h = u_sky_tintHue;
  vec3 horizon = skyV1_ramp(h,vec3(0.62,1.02,1.25),vec3(1.38,0.97,0.50),vec3(1.38,0.76,0.86),vec3(1.00,0.76,1.45));
  vec3 zenith = skyV1_ramp(h,vec3(0.70,0.98,1.25),vec3(1.22,0.90,0.88),vec3(1.06,0.84,1.28),vec3(0.88,0.80,1.40));
  vec3 t = mix(horizon,zenith,smoothstep(0.0,0.55,up));
  return t/max(dot(t,SKYV1_LUMA),0.0001);
}
// Luminance-keeping recolour: half multiplicative, half chroma replacement.
vec3 skyV1_tint(vec3 c, float up) {
  vec3 t = skyV1_tintColor(up);
  vec3 target = mix(c*t,vec3(dot(c,SKYV1_LUMA))*t,0.55);
  return mix(c,target,u_sky_tintStrength);
}

// ---- Haze (aerosol whitening, broad halo, luminous horizon) ------------------
// turbidity only changes the Mie extinction that reddens sunlight (sunset
// colour); haze is a grey, optically thick aerosol veil lit by that sunlight,
// so it whitens the day sky, widens the solar halo and makes the horizon glow
// (gold at low sun because the light reaching it is already reddened).
float skyV1_hazeVeil(float up) {
  return 1.0-exp(-u_sky_haze*(0.24+2.2*exp(-up*4.5)));
}
vec3 skyV1_hazeColor(vec3 rd, vec3 sun) {
  float mu = clamp(dot(rd,sun),-1.0,1.0);
  float separation = sqrt(max(2.0*(1.0-mu),0.0));
  float halo = 1.4*exp(-separation/0.10)+0.45*exp(-separation*separation/0.30)+0.50*exp(-separation/0.7);
  vec3 light = skyV1_lightTransmittance(skyV1_lightElevation(sun),1.0,1.0)*skyV1_daylight();
  // Multiple scattering inside the aerosol layer desaturates the reddened light.
  light = mix(light,vec3(dot(light,SKYV1_LUMA)),0.3);
  vec3 lit = light*vec3(1.0,0.95,0.88)*(SKYV1_HAZE_ISO+SKYV1_HAZE_HALO*halo*(0.6+0.4*u_sky_haze));
  lit += vec3(0.004,0.008,0.016)*skyV1_night();
  return lit+skyV1_moonSky(rd)*2.0;
}

// ---- Storm and clouds -------------------------------------------------------
float skyV1_cloudLight() {
  return smoothstep(-10.0,8.0,u_sky_sunElevation)*mix(0.20,1.0,smoothstep(-3.0,18.0,u_sky_sunElevation));
}
// Open sky under a storm turns pale grey-blue.
vec3 skyV1_stormOpen(vec3 c) {
  return mix(c,vec3(dot(c,SKYV1_LUMA))*vec3(0.90,0.98,1.10)*1.1,0.5*u_sky_storm);
}
// Rain / mist colour for the horizon band below the deck.
vec3 skyV1_mist() {
  return vec3(0.16,0.185,0.215)*skyV1_cloudLight()*(1.0-0.4*u_sky_storm)
    +vec3(0.004,0.007,0.014)*skyV1_night()+skyV1_moonSky(vec3(0,0.05,0.9987))*1.5;
}
// R8 soft, sky-lit clouds (original code; R7 noise layout, public techniques:
// iq "directional derivative" article, Schneider 2015, Hillaire 2016).
// One texture read = eight lattice corners using paired adjacent z slices.
// PNG row zero stays GL row zero (no upload flip); no colour conversion.
float skyV1_noiseTex3(vec3 p) {
  vec3 c = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  vec2 uv = (c.xy+vec2(37.0,17.0)*c.z+f.xy+0.5)/256.0;
  vec2 slices = textureLod(skyV1_noiseTexture,uv,0.0).gr;
  return mix(slices.x,slices.y,f.z);
}
// fBm with distance LOD: missing octaves fall back to their mean (0.5).
float skyV1_cloudField(vec3 p, float lod) {
  float v = 0.52*skyV1_noiseTex3(p);
  p = p*2.07+vec3(13.1,5.7,19.3);
  v += 0.26*skyV1_noiseTex3(p);
  p = p*2.13+vec3(7.7,23.3,3.1);
  float l3 = clamp(lod*3.0-0.0,0.0,1.0);
  v += 0.13*(l3 > 0.0 ? mix(0.5,skyV1_noiseTex3(p),l3) : 0.5);
  p = p*2.03+vec3(17.9,9.3,11.1);
  float l4 = clamp(lod*3.0-1.0,0.0,1.0)*(1.0-0.5*u_sky_cloudSoftness);
  v += 0.065*(l4 > 0.0 ? mix(0.5,skyV1_noiseTex3(p),l4) : 0.5);
  p = p*2.09+vec3(2.7,29.1,5.3);
  float l5 = clamp(lod*3.0-2.0,0.0,1.0)*(1.0-0.7*u_sky_cloudSoftness);
  v += 0.035*(l5 > 0.0 ? mix(0.5,skyV1_noiseTex3(p),l5) : 0.5);
  return v;
}
// Large-scale weather: where clouds gather and where the sky stays open.
float skyV1_cloudWeather(vec2 xz) {
  float w = 0.65*skyV1_noiseTex3(vec3(xz*0.11,4.3))+0.35*skyV1_noiseTex3(vec3(xz*0.29,9.7));
  return w;
}
// Density 0..~1 (soft ramp, no hard cut). h = 0 at cloud base, 1 at top.
float skyV1_cloudDensityAt(vec3 p, float lod, vec2 drift, float bottom, float thickness, float weather) {
  float soft = u_sky_cloudSoftness, storm = u_sky_storm;
  // Lumpy base for grey decks: the base dips where the weather is heavy.
  float deck = max(storm,soft*smoothstep(0.8,1.0,u_sky_cloudCover));
  float h = (p.y-bottom+deck*0.2*thickness*(weather-0.5)*2.0)/thickness;
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec3 q = vec3(p.x,p.y*1.3,p.z)*(u_sky_cloudScale*0.42);
  q.xz += drift+vec2(7.2,-2.6);
  q.y *= mix(1.0,0.45,soft); // stratus: stretched, layered
  float field = skyV1_cloudField(q,lod);
  // Local coverage: global cover modulated by the weather map.
  float cover = clamp(u_sky_cloudCover+(weather-0.5)*mix(0.9,0.35,max(soft,storm))*(1.0-smoothstep(0.75,1.0,u_sky_cloudCover)),0.0,1.0);
  // Cumulus profile: flat base, rounded tops (threshold rises with height).
  // Stratus: thin uniform slab.
  float baseRamp = smoothstep(0.0,mix(0.06,0.25,soft),h);
  float topErode = mix(h*h*0.55,smoothstep(0.55,1.0,h)*0.5,soft);
  float threshold = mix(0.66,0.30,cover)+topErode;
  float d = (field-threshold)*mix(4.2,2.4,soft);
  d = clamp(d,0.0,1.0)*baseRamp*(1.0-smoothstep(0.92,1.0,h));
  return d;
}
float skyV1_cloudHG(float mu, float g) {
  return (1.0-g*g)/pow(max(1.0+g*g-2.0*g*mu,1e-3),1.5);
}
// Ground observer: intersect a finite altitude band, then march only inside.
vec4 skyV1_clouds(vec3 rd, vec3 sun) {
  if (rd.y <= 0.008) return vec4(0.0);
  float storm = u_sky_storm, soft = u_sky_cloudSoftness;
  float bottom = mix(1.55,1.10,storm);
  float thickness = mix(2.2,0.9,soft)+0.8*storm;
  float t = bottom/rd.y, end = min((bottom+thickness)/rd.y,60.0);
  if (t >= end) return vec4(0.0);
  float wind = radians(u_sky_cloudWindDirection);
  vec2 drift = vec2(0.028,0.009);
  drift = vec2(drift.x*cos(wind)-drift.y*sin(wind),drift.x*sin(wind)+drift.y*cos(wind));
  drift *= iTime*u_sky_cloudSpeed;
  float jitter = world_hash13(floor(rd*16384.0));

  // ---- Light from the actual sky ---------------------------------------
  float night = skyV1_night();
  float moon = skyV1_moonLight()*night;
  vec3 lightDir = normalize(mix(sun,skyV1_moonDir(),night*step(0.001,moon)));
  lightDir.y = max(lightDir.y,0.03); // low sun still grazes cloud sides
  lightDir = normalize(lightDir);
  // Direct light reaching the cloud layer, same transmittance as the sky uses.
  vec3 sunLight = skyV1_lightTransmittance(skyV1_lightElevation(sun),1.0,1.0)*skyV1_daylight();
  sunLight = mix(sunLight,skyV1_warmColor()*dot(sunLight,SKYV1_LUMA)*1.4,skyV1_warmFill()*0.5);
  sunLight *= smoothstep(-6.0,-0.5,u_sky_sunElevation)*1.15;
  vec3 moonLight = vec3(0.020,0.028,0.045)*moon;
  vec3 keyLight = mix(sunLight,moonLight,night)*(1.0-0.6*storm);
  // Ambient = what the sky dome actually looks like (zenith above, horizon around).
  vec3 skyUp = skyV1_base(vec3(0.0,1.0,0.0))+skyV1_moonSky(vec3(0.0,1.0,0.0));
  vec3 skyAround = 0.5*(skyV1_base(normalize(vec3(sun.x,0.12,sun.z)))+skyV1_base(normalize(vec3(-sun.x,0.12,-sun.z))));
  float twilight = 1.0-smoothstep(-4.0,4.0,u_sky_sunElevation);
  vec3 ambTop = (skyUp*0.9+skyAround*0.35)*(1.0-0.35*twilight);
  vec3 ambBottom = (skyAround*0.22+skyUp*0.08)*(1.0-0.45*twilight); // underside: horizon ring and ground
  ambTop = skyV1_stormOpen(ambTop); ambBottom = skyV1_stormOpen(ambBottom);
  // Sky directly behind the cloud, for aerial perspective.
  vec3 behind = skyV1_stormOpen(skyV1_base(rd)+skyV1_moonSky(rd));
  float mu = dot(rd,lightDir);
  float phase = 0.75*skyV1_cloudHG(mu,0.55)+0.25*skyV1_cloudHG(mu,-0.25); // ~1 on average
  float sigma = (1.0+1.2*storm)*2.3*pow(u_sky_cloudDensity,1.35);

  vec3 sum = vec3(0.0); float trans = 1.0;
  float step0 = 0.035+0.012*t;
  t += step0*jitter;
  for (int i=0; i<96; ++i) {
    if (t >= end || trans < 0.01) break;
    float stepLength = min(0.035+0.012*t,end-t);
    vec3 p = rd*(t+0.5*stepLength);
    float lod = 1.0-smoothstep(4.0,30.0,t*max(u_sky_cloudScale/2.4,0.5));
    float weather = skyV1_cloudWeather((p.xz+drift)*u_sky_cloudScale*0.42);
    float density = skyV1_cloudDensityAt(p,lod,drift,bottom,thickness,weather);
    if (density > 0.002) {
      // Two taps toward the light: optical depth to the sun through the cloud.
      // Taps reach well into the layer so whole cloud bodies shadow their bases.
      float ls1 = thickness*0.16, ls2 = thickness*0.5;
      float d1 = skyV1_cloudDensityAt(p+lightDir*ls1,lod*0.5,drift,bottom,thickness,weather);
      float d2 = skyV1_cloudDensityAt(p+lightDir*ls2,0.0,drift,bottom,thickness,weather);
      float tau = 1.5*sigma*(density*ls1*0.5+d1*ls1*1.0+d2*(ls2-ls1));
      // Single scattering keeps the forward peak (silver edges); the multiple-
      // scattering tail is nearly isotropic, so thick backlit cores stay dark.
      float single = exp(-tau)*phase;
      float multi = 0.14*exp(-tau*0.35);
      float powder = mix(1.0,1.0-exp(-density*sigma*0.8),0.6);
      float h = clamp((p.y-bottom)/thickness,0.0,1.0);
      // Sky light reaching this point is dimmed by the cloud column above it.
      // Diffusion keeps even a thick deck's base grey, never black.
      float column = sigma*thickness*(1.0-h)*(0.15+0.35*u_sky_cloudCover);
      float through = mix(0.32,1.0,exp(-column*0.35));
      vec3 ambient = mix(ambBottom,ambTop,h*h*(3.0-2.0*h))*through*(1.0-0.3*density);
      // Sunlight diffusing down through a closed deck (what lights overcast bases).
      ambient += keyLight*0.10*mix(0.35,1.0,exp(-column*0.2))*max(storm,soft)*smoothstep(0.7,1.0,u_sky_cloudCover);
      vec3 S = keyLight*(single+multi)*powder+ambient;
      // Low sun: light from the bright horizon reaches cloud bases from below.
      S += sunLight*skyV1_warmFill()*(1.0-h)*(1.0-h)*0.55*exp(-density*sigma*0.15)*(1.0-storm);
      // Storm: dark cells and lighter gaps in the base.
      // Grey decks (storm, overcast): broad darker cells and lighter thin patches.
      float deck = max(storm,soft*smoothstep(0.8,1.0,u_sky_cloudCover));
      vec2 cq = (p.xz+drift)*u_sky_cloudScale;
      float cellField = 0.4*weather+0.4*skyV1_noiseTex3(vec3(cq*0.55,7.0))+0.2*skyV1_noiseTex3(vec3(cq*1.4,11.0));
      float cellDark = smoothstep(0.30,0.58,cellField);
      S *= 1.0-deck*(0.40+0.40*storm)*cellDark;
      // Aerial perspective: distant clouds melt into the sky behind them.
      float fog = 1.0-exp(-t*(0.020+0.020*u_sky_haze+0.004*u_sky_turbidity));
      S = mix(S,behind,fog);
      // Energy-conserving integration of a slab (albedo 1).
      float ext = sigma*density;
      float a = exp(-ext*stepLength);
      sum += trans*S*(1.0-a);
      trans *= a;
    }
    t += stepLength;
  }
  float opacity = 1.0-trans;
  return vec4(sum/max(opacity,1e-5),opacity*smoothstep(0.008,0.045,rd.y));
}

// ---- Night effects (categorical nightEffect; added radiance) ---------------
float skyV1_effectFade() {
  return 1.0-smoothstep(SKYV1_EFFECT_FADE_LO,SKYV1_EFFECT_FADE_HI,u_sky_sunElevation);
}
// Fixed-octave fBm (world_fbm2/3 unrolled so ports need no loop).
float skyV1_fbm2(vec2 p) {
  float v = 0.5*world_noise2(p); p = p*2.03+17.1;
  v += 0.25*world_noise2(p); p = p*2.03+17.1;
  v += 0.125*world_noise2(p);
  return v/0.875;
}
float skyV1_fbm3(vec3 p) {
  float v = 0.5*world_noise3(p); p = p*2.03+17.1;
  v += 0.25*world_noise3(p); p = p*2.03+17.1;
  v += 0.125*world_noise3(p); p = p*2.03+17.1;
  v += 0.0625*world_noise3(p);
  return v/0.9375;
}
// Six fixed celestial cube faces avoid the polar crowding of longitude grids.
vec2 skyV1_face(vec3 rd, out float seed) {
  vec3 a = abs(rd);
  if (a.x >= a.y && a.x >= a.z) { seed = rd.x > 0.0 ? 13.0 : 31.0; return rd.yz/a.x; }
  if (a.y >= a.z) { seed = rd.y > 0.0 ? 47.0 : 61.0; return rd.xz/a.y; }
  seed = rd.z > 0.0 ? 79.0 : 97.0; return rd.xy/a.z;
}
// Stars clustered along the galactic band (on top of the base stars).
vec3 skyV1_galaxyStars(vec3 rd, float latitude) {
  float seed;
  vec2 face = skyV1_face(rd,seed);
  float clustering = exp(-latitude*latitude/0.035);
  vec3 stars = vec3(0.0);
  for (int j = 0; j < 2; ++j) {
    float layer = float(j), scale = 115.0+layer*118.0;
    vec2 p = (face*0.5+0.5)*scale;
    vec2 cell = floor(p)+seed*19.0+layer*307.0;
    float h = world_hash12(cell);
    vec2 center = 0.18+0.64*vec2(world_hash12(cell+7.0),world_hash12(cell+23.0));
    vec2 delta = fract(p)-center;
    float footprint = SKYV1_GALAXY_STAR_FOOTPRINT;
    float area = 0.0035+footprint*footprint*0.12;
    float point = exp(-dot(delta,delta)/area)*0.0035/area;
    point *= step(h,0.7*(0.012+0.14*clustering)*(1.0+layer*0.5));
    vec3 tint = mix(vec3(0.56,0.72,1.0),vec3(1.0,0.78,0.53),world_hash12(cell+41.0));
    float luminosity = world_hash12(cell+67.0);
    stars += tint*point*(0.035+3.5*pow(luminosity,10.0));
  }
  return stars*1.35;
}
// Effect 1: Milky Way band with dust lanes (fixed tilt/rotation).
vec3 skyV1_milkyWay(vec3 rd) {
  float t = radians(u_sky_milkyWayTilt), a = radians(u_sky_milkyWayAzimuth);
  vec3 forward = vec3(sin(a),0.0,cos(a));
  vec3 side = vec3(cos(a),0.0,-sin(a));
  vec3 normal = side*sin(t)+vec3(0,1,0)*cos(t);
  vec3 across = cross(normal,forward);
  // milkyWayWidth scales every across-band structure (band, rifts, stars).
  float latitude = dot(rd,normal)/max(u_sky_milkyWayWidth,0.05);
  float along = dot(rd,forward);
  vec3 p = vec3(dot(rd,side),rd.y,along)*8.0+vec3(21.0,8.0,3.0);
  float grain = skyV1_fbm3(p);
  float ribbon = latitude+(grain-0.5)*0.13;
  float band = exp(-ribbon*ribbon/0.018);
  float core = pow(max(dot(rd,normalize(forward+across*0.24)),0.0),14.0);
  vec2 track = vec2(along,dot(rd,across));
  track = track/max(length(track),0.001)*3.0+vec2(23.0,11.0);
  float slow = world_noise2(track);
  float curl = world_noise2(track*2.7+21.0);
  float center = (slow-0.5)*0.28+(curl-0.5)*0.07;
  float width = 0.012+0.060*pow(world_noise2(track*1.6-4.0),1.8);
  float segment = smoothstep(0.28,0.56,world_noise2(track*2.1+32.0));
  float mottling = skyV1_fbm2(track*2.2+vec2(latitude*19.0,latitude*7.0)+vec2(3.0,7.0));
  float rift = latitude-center+(mottling-0.5)*0.045;
  float mainDust = (1.0-smoothstep(width*0.30,width*1.45,abs(rift)))*segment;
  float branchCenter = center+(world_noise2(track*1.3+37.0)-0.5)*0.24;
  float branchWidth = width*0.50+0.008;
  float branchDust = (1.0-smoothstep(branchWidth*0.25,branchWidth*1.5,
    abs(latitude-branchCenter+(mottling-0.5)*0.03)))*smoothstep(0.50,0.70,curl);
  float patches = smoothstep(0.54,0.72,mottling)*exp(-latitude*latitude/0.020);
  float dust = clamp(mainDust*(0.55+0.45*mottling)+branchDust*0.65+patches*0.75,0.0,0.92);
  vec3 milk = mix(vec3(0.026,0.036,0.075),vec3(0.15,0.105,0.065),core);
  milk *= band*(0.35+1.6*grain)*(1.0-0.88*dust);
  milk += vec3(0.04,0.025,0.023)*core*exp(-latitude*latitude/0.06)*(1.0-0.7*dust);
  vec3 radiance = milk+skyV1_galaxyStars(rd,latitude);
  // Moonlight washes the faint band out.
  float wash = 1.0/(1.0+skyV1_moonLight()*0.6);
  return radiance*u_sky_milkyWayBrightness*wash*smoothstep(0.0,0.12,rd.y);
}
// auroraHue: 0 green, 0.5 green with violet tops, 1 red/magenta.
void skyV1_auroraColors(out vec3 lower, out vec3 upper) {
  float h = clamp(u_sky_auroraHue,0.0,1.0);
  lower = mix(mix(vec3(0.20,1.0,0.30),vec3(0.10,1.0,0.55),smoothstep(0.0,0.5,h)),vec3(1.0,0.16,0.32),smoothstep(0.5,1.0,h));
  upper = mix(mix(vec3(0.10,0.85,0.45),vec3(0.50,0.24,1.0),smoothstep(0.0,0.5,h)),vec3(0.80,0.06,0.38),smoothstep(0.5,1.0,h));
}
// Effect 2: aurora as four analytic angular curtains (no raymarch): each
// layer is a folded base line in (azimuth, elevation) with a sharp lower edge,
// exponential upward fade and fine vertical rays.
vec3 skyV1_aurora(vec3 rd) {
  vec3 lower, upper;
  skyV1_auroraColors(lower,upper);
  // Azimuth relative to auroraAzimuth, wrapped to [-pi, pi): the curtain seam
  // sits opposite the centre, where auroraSpread < 360 masks it out.
  float angle = atan(rd.x,rd.z)-radians(u_sky_auroraAzimuth);
  angle = mod(angle+3.14159265,6.28318531)-3.14159265;
  float halfSpread = radians(u_sky_auroraSpread)*0.5;
  float sector = u_sky_auroraSpread >= 359.5 ? 1.0
    : 1.0-smoothstep(halfSpread*0.6,halfSpread,abs(angle));
  float elev = asin(clamp(rd.y,-1.0,1.0));
  float time = iTime*u_sky_auroraSpeed*0.12;
  vec3 curtains = vec3(0.0);
  for (int j = 0; j < 4; ++j) {
    float layer = float(j);
    float a = angle*(1.6+layer*0.29)+layer*2.3;
    float fold = sin(a*2.1+time+sin(a*1.3-time*0.7))*0.12;
    fold += (world_noise2(vec2(a*2.7+time,layer*8.0))-0.5)*0.17;
    float base = u_sky_auroraHeight*(0.43+layer*0.22)+fold;
    float h = elev-base;
    float rise = smoothstep(-0.025,0.025,h);
    float fade = exp(-max(h,0.0)*(6.5+layer));
    float ray = pow(0.5+0.5*sin(a*39.0*SKYV1_AURORA_DENSITY+sin(a*8.0+time)*4.0+time*1.5),3.0);
    float veil = rise*fade*(0.28+0.72*ray);
    veil *= 0.55+0.45*sin(a*1.7+layer+time*0.4);
    vec3 hue = mix(lower,upper,clamp(h*3.5+layer*0.1,0.0,1.0));
    curtains += hue*veil*(0.34/(1.0+layer*0.2));
  }
  float up = max(rd.y,0.0);
  curtains += lower*0.03*exp(-up*6.0);
  return curtains*sector*u_sky_auroraIntensity*smoothstep(0.0,0.09,rd.y);
}
vec3 skyV1_effects(vec3 rd) {
  float fade = skyV1_effectFade();
  if (fade <= 0.0) return vec3(0.0);
  if (u_sky_nightEffect == 1) return skyV1_milkyWay(rd)*fade;
  if (u_sky_nightEffect == 2) return skyV1_aurora(rd)*fade;
  return vec3(0.0);
}

// ---- Aerial terms applied over sky and clouds ------------------------------
vec3 skyV1_aerial(vec3 color, vec3 rd, vec3 sun) {
  float up = max(rd.y,0.0);
  if (u_sky_haze > 0.0) {
    vec3 haze = skyV1_tint(skyV1_hazeColor(rd,sun),up);
    color = mix(color,haze,skyV1_hazeVeil(up));
    color += haze*u_sky_haze*0.4*exp(-up/0.045);
  }
  if (u_sky_storm > 0.0) {
    float rain = u_sky_storm*(1.0-exp(-exp(-up*7.0)*1.8));
    color = mix(color,skyV1_tint(skyV1_mist(),up),rain*0.85);
  }
  return color;
}

// ---- Portable entry point --------------------------------------------------
// rd: unit view direction in sky space (Y-up). Returns linear HDR radiance.
// Order: base (+moon sky, storm grey) + sun disk -> tint -> + stars, moon disk,
// night effect -> clouds over that (so clouds hide effects) -> haze/rain.
vec3 skyV1_radiance(vec3 rd) {
  vec3 sun = skyV1_solarDir();
  vec3 color = skyV1_stormOpen(skyV1_base(rd)+skyV1_moonSky(rd));
  if (rd.y < 0.0) {
    // Below the horizon: fade to the diffuse ground-facing fill.
    vec3 upper = skyV1_base(vec3(0,1,0));
    vec3 horizonDir = normalize(vec3(-sun.z,0.18,sun.x));
    vec3 horizon = skyV1_base(horizonDir);
    vec3 ground = mix(horizon*0.34,(upper+horizon)*0.32,u_sky_cloudCover*0.4);
    ground += mix(vec3(0.095,0.035,0.019),vec3(0.095,0.027,0.050),skyV1_pink())
      *skyV1_horizonTint(0.0)*skyV1_warmFill()*(0.4+0.6*u_sky_cloudCover);
    ground += vec3(0.035,0.055,0.09)*skyV1_night();
    ground = skyV1_stormOpen(ground+skyV1_moonSky(horizonDir)*0.6);
    color = mix(color,ground,smoothstep(0.0,0.2,-rd.y));
    return max(skyV1_aerial(skyV1_tint(color,0.0),normalize(vec3(rd.x+0.0001,0.0,rd.z)),sun),vec3(0.0));
  }
  float up = rd.y;
  if (u_sky_sunElevation >= 0.0) {
    float angle = acos(clamp(dot(rd,sun),-1.0,1.0));
    float disk = 1.0-smoothstep(SKYV1_SUN_RADIUS-SKYV1_PIXEL_ANGLE,SKYV1_SUN_RADIUS+SKYV1_PIXEL_ANGLE,angle);
    color += skyV1_lightTransmittance(sun.y,1.0,1.0)*disk*28.0*exp(-2.2*u_sky_haze);
  }
  color = skyV1_tint(color,up);
  color += skyV1_stars(rd)/(1.0+skyV1_moonLight()*0.9*skyV1_night());
  color += skyV1_moonDisk(rd);
  color += skyV1_effects(rd);
  if (u_sky_cloudCover > 0.0) {
    vec4 cloud = skyV1_clouds(rd,sun);
    color = mix(color,skyV1_tint(cloud.rgb,up),cloud.a);
  }
  return max(skyV1_aerial(color,rd,sun),vec3(0.0));
}

// ---- Web composer interface (not part of the portable sky) -----------------
vec3 sky_color(vec3 ro, vec3 rd) { return skyV1_radiance(rd); }
vec3 sky_sunDir() {
  vec3 sun = skyV1_solarDir();
  vec3 fakeMoon = normalize(vec3(-sun.x,0.6,-sun.z));
  vec3 moonDir = skyV1_moonDir();
  vec3 realMoon = normalize(vec3(moonDir.x,max(moonDir.y,0.08),moonDir.z));
  vec3 moon = normalize(mix(fakeMoon,realMoon,smoothstep(0.0,0.15,skyV1_moonLight())));
  vec3 key = normalize(vec3(sun.x,max(sun.y,0.04),sun.z));
  return normalize(mix(key,moon,skyV1_night()));
}
vec3 sky_sunColor() {
  vec3 solar = skyV1_lightTransmittance(skyV1_solarDir().y,1.0,1.0)
    *3.0*smoothstep(-0.8,3.0,u_sky_sunElevation);
  solar *= mix(vec3(1.0),vec3(1.0,0.64,0.28),skyV1_warmFill());
  solar *= exp(-u_sky_cloudCover*u_sky_cloudDensity*0.5);
  solar += vec3(0.16,0.045,0.012)*skyV1_warmFill()*smoothstep(-4.0,0.0,u_sky_sunElevation);
  solar *= mix(vec3(1.0),vec3(1.0,0.85,1.6),skyV1_pink()*skyV1_warmFill());
  solar *= exp(-0.7*u_sky_haze)*(1.0-0.75*u_sky_storm);
  vec3 moon = vec3(0.07,0.11,0.21)*skyV1_night()*(1.0+1.2*skyV1_moonLight())*(1.0-0.6*u_sky_storm);
  return skyV1_tint(solar*skyV1_horizonTint(1.0)+moon,0.15);
}
vec3 sky_ambient(vec3 n) {
  vec3 sun = skyV1_solarDir();
  vec3 upper = skyV1_base(vec3(0,1,0));
  vec3 horizonDir = normalize(vec3(-sun.z,0.18,sun.x));
  vec3 horizon = skyV1_base(horizonDir);
  vec3 fill = mix(horizon*0.34,upper*0.7+horizon*0.18,clamp(n.y*0.5+0.5,0.0,1.0));
  fill = mix(fill,(upper+horizon)*0.32,u_sky_cloudCover*0.4);
  fill += mix(vec3(0.095,0.035,0.019),vec3(0.095,0.027,0.050),skyV1_pink())
    *skyV1_horizonTint(0.0)*skyV1_warmFill()*(0.4+0.6*u_sky_cloudCover);
  fill += vec3(0.035,0.055,0.09)*skyV1_night();
  fill = mix(fill,skyV1_hazeColor(horizonDir,sun)*0.45,skyV1_hazeVeil(0.3)*0.6);
  fill += skyV1_moonSky(vec3(0,1,0))*0.8;
  fill = skyV1_stormOpen(fill)*(1.0-0.3*u_sky_storm);
  if (u_sky_nightEffect == 2) {
    vec3 lower, upperColor;
    skyV1_auroraColors(lower,upperColor);
    fill += lower*u_sky_auroraIntensity*0.03*skyV1_effectFade();
  }
  return skyV1_tint(fill,0.3);
}
