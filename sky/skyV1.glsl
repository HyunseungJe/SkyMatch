// Reference sky (three direct sky colours + R8 soft clouds). This file and sky_schema_v1.json are
// the single source of the sky: every tool-specific shader is generated from this file.
// Needs the shared noise texture (textures/noise256.png) bound to skyV1_noiseTexture.
// Uniform initializers are the schema defaults; the web loader strips them (GLSL ES 3.00).
uniform float iTime=0.0;
uniform float u_sky_sunElevation=8.000000000;
uniform float u_sky_sunAzimuth=20.000000000;
uniform float u_sky_haze=0.000000000;
uniform float u_sky_horizonWarmth=0.000000000;
uniform vec3 u_sky_zenithColor=vec3(0.078187,0.212231,0.479320);
uniform vec3 u_sky_horizonColor=vec3(0.871367,0.564712,0.278894);
uniform vec3 u_sky_sunGlowColor=vec3(1.000000,0.450786,0.063010);
uniform float u_sky_cloudCover=0.400000000;
uniform float u_sky_cloudDensity=1.200000000;
uniform float u_sky_cloudScale=1.000000000;
uniform float u_sky_cloudSoftness=0.000000000;
uniform float u_sky_storm=0.000000000;
uniform float u_sky_stars=0.800000000;
uniform float u_sky_moonElevation=25.000000000;
uniform float u_sky_moonAzimuth=-150.000000000;
uniform float u_sky_moonBrightness=0.000000000;
uniform float u_sky_nightBrightness=1.000000000;
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
const float SKYV1_CLOUD_HEIGHT = 0.8;
const float SKYV1_TURBIDITY = 1.4;   // fixed: only dims the sun disk and cloud light near the horizon
const float SKYV1_GLOW_GAIN = 2.0;   // sunGlowColor is a display colour; the glow itself is brighter
const float SKYV1_CLOUD_PLANET = 150.0; // planet radius in cloud units (stylized curvature)
// Fixed-width replacements for fwidth(): angular sizes assume roughly one
// pixel at a 60 deg vertical FOV on a ~900 px viewport (0.0012 rad).
const float SKYV1_PIXEL_ANGLE = 0.0012;
const float SKYV1_STAR_ANGLE = 0.0011;  // rad, star radius (about one pixel at 1080p)
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

// ---- horizonWarmth (schema role: artist) ------------------------------------
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

// ---- Scattering terms (adapted from lcfSRl Common, MIT notice above) -------
// Used for the shape of the sun glow and for the light that reaches the clouds.
float skyV1_phaseM(float costh, float g) {
  g = min(g, 0.9381);
  float k = 1.55*g-0.55*g*g*g;
  return (1.0-k*k)/(12.57*skyV1_sq(1.0-k*costh));
}
vec3 skyV1_betaR() { return vec3(5.802,13.558,33.100)*1e-6; }
vec3 skyV1_betaM() { return vec3(3.996e-6*SKYV1_TURBIDITY); }
vec3 skyV1_betaO() { return vec3(0.650,1.881,0.085)*1e-6; }
vec3 skyV1_solarDir() {
  float e = radians(u_sky_sunElevation), a = radians(u_sky_sunAzimuth);
  return vec3(sin(a)*cos(e), sin(e), cos(a)*cos(e));
}
float skyV1_night() { return 1.0-smoothstep(-10.0,-2.0,u_sky_sunElevation); }
// Night glow of the sky itself (not stars, moon or night effects).
float skyV1_nightGlow() { return skyV1_night()*u_sky_nightBrightness; }
float skyV1_daylight() { return exp(min(u_sky_sunElevation,0.0)*0.32); }
vec3 skyV1_lightTransmittance(float elevation, float multiplier, float ozoneMultiplier) {
  float extinction = exp(-clamp(elevation+0.05,0.0,1.0)*40.0)
    + exp(-clamp(elevation+0.5,0.0,1.0)*5.0)*0.4
    + skyV1_sq(clamp(1.0-elevation,0.0,1.0))*0.02+0.002;
  return exp(-(skyV1_betaR()+skyV1_betaM()+skyV1_betaO()*ozoneMultiplier)*extinction*multiplier*1e6);
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
// How sunlight spreads through the air, as a weight without colour: forward
// scattering by haze particles (tight round the sun) times how much air the
// view crosses (most along the horizon). About 1 near a sun on the horizon.
float skyV1_glowShape(vec3 rd, vec3 sun) {
  float up = max(rd.y,0.0);
  float b = 6371000.0*up;
  float delta = 100000.0*(2.0*6371000.0+100000.0);
  float depth = delta/(sqrt(b*b+delta)+b);
  float hbias = 1.0-1.0/(2.0+depth*depth*1e-12);
  vec3 R, M;
  skyV1_rayleighMie(depth,hbias*hbias,pow(hbias,5.0),R,M);
  float mu = dot(rd,sun);
  float phase = skyV1_phaseM(mu,0.76)+0.6*skyV1_phaseM(mu,0.40);
  return phase*M.x/0.08*skyV1_daylight();
}
float skyV1_facing(vec3 rd, vec3 sun) {
  return dot(normalize(vec3(rd.x,0.0001,rd.z)),normalize(vec3(sun.x,0.0001,sun.z)));
}
// Colour of the light arriving from the sun's side: the chroma of sunGlowColor
// (white while the glow is black, as at night).
vec3 skyV1_sunTint() {
  float l = dot(u_sky_sunGlowColor,SKYV1_LUMA);
  vec3 chroma = min(u_sky_sunGlowColor/max(l,1e-4),vec3(3.0));
  return mix(vec3(1.0),chroma,smoothstep(0.0,0.02,l));
}
// Base sky from three colours (linear Rec.709): zenith, horizon and the glow on
// the sun's side. The colours are set directly; sun elevation only places the
// glow and shapes it (see skyV1_glowShape).
vec3 skyV1_base(vec3 rd) {
  float up = max(rd.y,0.0);
  vec3 sun = skyV1_solarDir();
  float facing = skyV1_facing(rd,sun);
  // Most of the change happens close to the horizon, the rest climbs slowly.
  float low = 0.60*exp(-up*9.0)+0.32*exp(-up*2.4);
  vec3 color = mix(u_sky_zenithColor,u_sky_horizonColor,low);
  // The glow's shape comes from the scattering model, its colour from the param.
  color += u_sky_sunGlowColor*(SKYV1_GLOW_GAIN*skyV1_glowShape(rd,sun));
  return color*skyV1_palette(up,facing)*mix(1.0,u_sky_nightBrightness,skyV1_night());
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

// ---- Haze (aerosol whitening, broad halo, luminous horizon) ------------------
// A grey, optically thick aerosol veil lit by sunlight: it whitens the day sky,
// widens the solar halo and makes the horizon glow. Its colour follows
// sunGlowColor (see skyV1_sunTint).
float skyV1_hazeVeil(float up) {
  return 1.0-exp(-u_sky_haze*(0.24+2.2*exp(-up*4.5)));
}
vec3 skyV1_hazeColor(vec3 rd, vec3 sun) {
  float mu = clamp(dot(rd,sun),-1.0,1.0);
  float separation = sqrt(max(2.0*(1.0-mu),0.0));
  float halo = 1.4*exp(-separation/0.10)+0.45*exp(-separation*separation/0.30)+0.50*exp(-separation/0.7);
  vec3 light = skyV1_lightTransmittance(skyV1_lightElevation(sun),1.0,1.0)*skyV1_daylight();
  // Multiple scattering inside the aerosol layer desaturates the reddened light.
  light = mix(vec3(dot(light,SKYV1_LUMA))*skyV1_sunTint(),vec3(dot(light,SKYV1_LUMA)),0.3);
  vec3 lit = light*vec3(1.0,0.95,0.88)*(SKYV1_HAZE_ISO+SKYV1_HAZE_HALO*halo*(0.6+0.4*u_sky_haze));
  lit += vec3(0.004,0.008,0.016)*skyV1_nightGlow();
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
    +vec3(0.004,0.007,0.014)*skyV1_nightGlow()+skyV1_moonSky(vec3(0,0.05,0.9987))*1.5;
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
  float cover = clamp(u_sky_cloudCover+(weather-0.5)*mix(0.6,0.3,max(soft,storm))*(1.0-smoothstep(0.75,1.0,u_sky_cloudCover)),0.0,1.0);
  // Cumulus profile: flat base, rounded tops (threshold rises with height).
  // Stratus: thin uniform slab.
  float baseRamp = smoothstep(0.0,mix(0.06,0.25,soft),h);
  float topErode = mix(h*h*0.55,smoothstep(0.55,1.0,h)*0.5,soft);
  float threshold = mix(0.66,0.30,cover)+topErode;
  float d = (field-threshold)*mix(4.2,2.4,soft);
  d = clamp(d,0.0,1.0)*baseRamp*(1.0-smoothstep(0.92,1.0,h));
  return d;
}
// Distance along a ray (sine of elevation mu) to altitude h above a round planet.
float skyV1_cloudShell(float mu, float h) {
  float r = SKYV1_CLOUD_PLANET;
  return sqrt(r*r*mu*mu+2.0*r*h+h*h)-r*mu;
}
float skyV1_cloudHG(float mu, float g) {
  return (1.0-g*g)/pow(max(1.0+g*g-2.0*g*mu,1e-3),1.5);
}
// Ground observer: intersect a finite altitude band, then march only inside.
vec4 skyV1_clouds(vec3 rd, vec3 sun) {
  if (rd.y <= 0.008) return vec4(0.0);
  float storm = u_sky_storm, soft = u_sky_cloudSoftness;
  float bottom = mix(2.6,1.9,storm);
  float thickness = mix(2.2,0.9,soft)+0.8*storm;
  // The layer follows the planet's curve: distant clouds sink toward the
  // horizon at a finite distance instead of running on forever.
  float t = skyV1_cloudShell(rd.y,bottom), end = skyV1_cloudShell(rd.y,bottom+thickness);
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
  sunLight = vec3(dot(sunLight,SKYV1_LUMA))*skyV1_sunTint();
  sunLight *= smoothstep(-6.0,-0.5,u_sky_sunElevation)*1.15;
  vec3 moonLight = vec3(0.020,0.028,0.045)*moon;
  vec3 keyLight = mix(sunLight,moonLight,night)*(1.0-0.6*storm);
  // Ambient = what the sky dome actually looks like (zenith above, horizon around).
  vec3 skyUp = skyV1_base(vec3(0.0,1.0,0.0))+skyV1_moonSky(vec3(0.0,1.0,0.0));
  vec3 skyAround = 0.5*(skyV1_base(normalize(vec3(sun.x,0.12,sun.z)))+skyV1_base(normalize(vec3(-sun.x,0.12,-sun.z))));
  float twilight = 1.0-smoothstep(-4.0,4.0,u_sky_sunElevation);
  vec3 ambTop = (skyUp*0.9+skyAround*0.35)*(1.0-0.35*twilight);
  vec3 ambBottom = (skyAround*0.22+skyUp*0.08)*(1.0-0.45*twilight); // underside: horizon ring and ground
  // A cloud gathers light from the whole dome and the sunlit ground, so its
  // shade is paler and less blue than the sky itself.
  ambTop = mix(ambTop,vec3(dot(ambTop,SKYV1_LUMA))*1.25,0.5);
  ambBottom = mix(ambBottom,vec3(dot(ambBottom,SKYV1_LUMA)),0.5)+sunLight*0.10*max(lightDir.y,0.0)*(1.0-night);
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
    // Work in layer coordinates: y = altitude above the curved ground.
    p.y = length(p+vec3(0.0,SKYV1_CLOUD_PLANET,0.0))-SKYV1_CLOUD_PLANET;
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
      // Bright fair-weather clouds glow from within; grey decks do not.
      float grey = max(storm,soft*smoothstep(0.8,1.0,u_sky_cloudCover));
      float multi = mix(1.25,0.14,grey)*exp(-tau*mix(0.16,0.35,grey));
      float powder = mix(1.0,1.0-exp(-density*sigma*0.8),0.3);
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
      float fog = 1.0-exp(-t*(0.032+0.020*u_sky_haze+0.004*SKYV1_TURBIDITY));
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
// Scintillation: each star flickers at its own pace, more near the horizon
// where its light crosses more air.
float skyV1_twinkle(float id, float up) {
  float depth = mix(0.10,0.55,exp(-max(up,0.0)*3.5));
  float a = sin(iTime*(2.3+5.1*id)+id*61.0), b = sin(iTime*(6.7+7.9*fract(id*7.3))+id*17.0);
  return 1.0+depth*(0.6*a+0.4*b);
}
// ---- Stars ---------------------------------------------------------------
// Three fixed layers: many faint stars, fewer bright ones with a soft glow.
// Star size is a fixed angle (about one pixel at 1080p / 60 deg), no fwidth.
vec3 skyV1_stars(vec3 rd) {
  if (rd.y <= 0.0 || u_sky_stars <= 0.0 || skyV1_night() <= 0.0) return vec3(0.0);
  float seed;
  vec2 face = skyV1_face(rd,seed);
  float amount = clamp(u_sky_stars,0.0,2.0);
  vec3 stars = vec3(0.0);
  for (int j = 0; j < 3; ++j) {
    float layer = float(j), scale = 46.0+layer*62.0;
    vec2 p = (face*0.5+0.5)*scale;
    vec2 cell = floor(p)+seed*23.0+layer*211.0;
    float id = world_hash12(cell+5.0);
    // More of the faint stars come out as the stars value rises.
    float present = step(world_hash12(cell+63.0),(0.045+0.01*layer)*(0.45+0.55*min(amount,1.5)));
    vec2 delta = fract(p)-(0.25+0.5*vec2(world_hash12(cell+11.0),world_hash12(cell-19.0)));
    float r2 = dot(delta,delta)/skyV1_sq(scale*SKYV1_STAR_ANGLE*0.5);
    float luminosity = pow(world_hash12(cell+89.0),2.5+layer*2.5);
    float energy = mix(0.06,1.0,luminosity)*(3.0-layer*1.1);
    // Brighter stars are slightly larger; the halo reaches barely past the core.
    float bright = smoothstep(0.5,2.0,energy);
    r2 /= 1.0+0.7*bright;
    float point = exp(-r2)+0.12*bright*exp(-r2/1.5);
    float heat = world_hash12(cell+41.0);
    vec3 tint = mix(mix(vec3(0.62,0.76,1.0),vec3(1.0,0.97,0.92),smoothstep(0.0,0.55,heat)),
      vec3(1.0,0.76,0.50),smoothstep(0.65,1.0,heat));
    stars += tint*(point*energy*present*skyV1_twinkle(id,rd.y));
  }
  return stars*2.2*u_sky_stars*skyV1_sq(skyV1_night())*smoothstep(0.0,0.15,rd.y);
}
// Stars clustered along the galactic band (on top of the base stars).
// g is the direction in the galactic frame, so they turn with the band.
vec3 skyV1_galaxyStars(vec3 g, float latitude, float richness) {
  float seed;
  vec2 face = skyV1_face(g,seed);
  // Dense in the band, thinning out gradually far from it (never empty).
  float clustering = (0.75*exp(-latitude*latitude/0.035)+0.40*exp(-abs(latitude)/0.40))*richness+0.10;
  vec3 stars = vec3(0.0);
  for (int j = 0; j < 3; ++j) {
    float layer = float(j), scale = 115.0+layer*118.0;
    vec2 p = (face*0.5+0.5)*scale;
    vec2 cell = floor(p)+seed*19.0+layer*307.0;
    float h = world_hash12(cell);
    vec2 center = 0.18+0.64*vec2(world_hash12(cell+7.0),world_hash12(cell+23.0));
    vec2 delta = fract(p)-center;
    float footprint = SKYV1_GALAXY_STAR_FOOTPRINT;
    float area = 0.0035+footprint*footprint*0.12;
    float point = exp(-dot(delta,delta)/area)*0.0035/area;
    point *= step(h,0.7*(0.012+0.20*clustering)*(1.0+layer*0.5));
    vec3 tint = mix(vec3(0.56,0.72,1.0),vec3(1.0,0.78,0.53),world_hash12(cell+41.0));
    float luminosity = world_hash12(cell+67.0);
    stars += tint*point*(0.035+3.5*pow(luminosity,10.0))*skyV1_twinkle(h*37.0+luminosity,0.5);
  }
  return stars*1.35;
}
// Four fixed octaves of the shared texture noise.
float skyV1_galaxyFbm(vec3 p) {
  float v = 0.5*skyV1_noiseTex3(p); p = p*2.03+vec3(17.1,3.3,9.7);
  v += 0.25*skyV1_noiseTex3(p); p = p*2.07+vec3(5.9,21.3,13.1);
  v += 0.125*skyV1_noiseTex3(p); p = p*2.11+vec3(11.7,7.1,29.3);
  v += 0.0625*skyV1_noiseTex3(p);
  return v/0.9375;
}
// Effect 1: Milky Way (original code). Everything is computed in a galactic
// frame (x toward the core, z = galactic pole), so tilt/azimuth turn the band,
// its dust and its stars together. A band that swells into a warm bulge at the
// core, star clouds, a meandering central rift with dust filaments that redden
// what shines through, and a grain of unresolved stars.
vec3 skyV1_milkyWay(vec3 rd) {
  float t = radians(u_sky_milkyWayTilt), a = radians(u_sky_milkyWayAzimuth);
  vec3 forward = vec3(sin(a),0.0,cos(a));
  vec3 side = vec3(cos(a),0.0,-sin(a));
  vec3 normal = side*sin(t)+vec3(0,1,0)*cos(t);
  vec3 across = cross(normal,forward);
  vec3 g = vec3(dot(rd,forward),dot(rd,across),dot(rd,normal));
  // milkyWayWidth scales every across-band structure (band, rift, stars).
  float latitude = g.z/max(u_sky_milkyWayWidth,0.05);
  vec3 gw = vec3(g.xy,latitude);
  float toCore = g.x/max(length(g.xy),0.001); // cos(galactic longitude)
  float inner = 0.5+0.5*toCore;               // 1 toward the core, 0 opposite
  float bulge = pow(max(toCore,0.0),9.0)*exp(-latitude*latitude/0.05);
  // Band: ragged edges, thicker and brighter toward the core.
  float coarse = skyV1_galaxyFbm(gw*2.6+vec3(21.0,8.0,3.0));
  float clouds = skyV1_galaxyFbm(gw*6.5+vec3(4.0,31.0,12.0));
  float sigma = mix(0.075,0.150,inner*inner);
  float ribbon = latitude+(coarse-0.5)*0.16;
  float band = 0.72*exp(-ribbon*ribbon/(2.0*sigma*sigma))+0.28*exp(-ribbon*ribbon/(13.0*sigma*sigma));
  float along = mix(0.20,1.0,pow(inner,1.6));
  float starClouds = smoothstep(0.30,0.72,clouds);
  float glow = band*along*(0.30+1.55*starClouds*starClouds);
  // Dust: a central rift that wanders, plus filaments stretched along the band.
  vec3 gd = vec3(g.xy,latitude*3.4);
  float lanes = skyV1_galaxyFbm(gd*4.2+vec3(9.0,2.0,17.0));
  float wisps = skyV1_galaxyFbm(gd*10.5+vec3(33.0,14.0,6.0));
  float riftCentre = (coarse-0.5)*0.22+(lanes-0.5)*0.10;
  float riftWidth = 0.022+0.050*inner*smoothstep(0.25,0.75,lanes);
  float rift = exp(-skyV1_sq((latitude-riftCentre)/riftWidth));
  float filaments = smoothstep(0.52,0.74,0.6*lanes+0.4*wisps)*exp(-latitude*latitude/(5.0*sigma*sigma));
  float dust = clamp(rift*(0.55+0.75*wisps)+filaments*0.9,0.0,1.0);
  dust *= smoothstep(0.05,0.45,inner); // little dust toward the anticentre
  // Dust removes blue first, so thin dust reddens and thick dust blacks out.
  vec3 through = exp(-dust*vec3(2.1,2.7,3.6));
  // Cool arms, warm core.
  vec3 hue = mix(vec3(0.040,0.056,0.105),vec3(0.150,0.108,0.068),clamp(bulge*1.6+0.25*inner*inner,0.0,1.0));
  hue = mix(hue,hue*vec3(1.25,0.95,0.85),smoothstep(0.55,0.85,wisps)*0.5);
  vec3 milk = hue*glow*1.5+vec3(0.070,0.046,0.030)*bulge;
  // Faint wide halo so the band does not end in a hard edge.
  milk += vec3(0.006,0.008,0.014)*along*exp(-latitude*latitude/0.10);
  // Far from the band the sky still carries a mottled glow of distant stars.
  milk += vec3(0.0045,0.0060,0.0105)*(0.45+0.55*inner)*exp(-abs(latitude)/0.42)*(0.35+2.6*coarse*clouds);
  // Unresolved stars: fine grain that follows the brightness.
  float grain = world_noise3(g*430.0);
  milk *= 0.82+0.60*grain*grain;
  milk *= through;
  vec3 radiance = milk+skyV1_galaxyStars(g,latitude,along*(0.5+starClouds))*mix(vec3(1.0),through,0.7);
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
// Draw emission in sky angles. Sampling around a unit circle keeps the pattern
// continuous across north and gives the horizon the same spacing as the upper sky.
vec3 skyV1_aurora(vec3 rd) {
  if (rd.y <= 0.0 || u_sky_auroraIntensity <= 0.0) return vec3(0.0);
  float heading = atan(rd.x,rd.z+1e-8)-radians(u_sky_auroraAzimuth);
  vec2 arc = vec2(cos(heading),sin(heading));
  float spread = radians(u_sky_auroraSpread)*0.5;
  float sector = u_sky_auroraSpread >= 359.5 ? 1.0 :
      1.0-smoothstep(0.6*spread,spread,acos(clamp(arc.x,-1.0,1.0)));
  if (sector <= 0.0) return vec3(0.0);

  float time = iTime*u_sky_auroraSpeed*0.08;
  float altitude = asin(clamp(rd.y,0.0,1.0));
  float drift = heading + 0.18*sin(time);
  vec2 path = vec2(cos(drift),sin(drift));
  float undulation = skyV1_noiseTex3(vec3(path*2.8+8.1,time));
  // A low sweeping band with a soft underside and a much wider colored veil.
  float edge = u_sky_auroraHeight-0.22 + 0.14*sin(1.0*drift-0.9)
      + 0.065*sin(3.0*drift+0.5) + 0.055*(undulation-0.5);
  float above = altitude-edge;
  float rise = max(0.0,above);
  float rayAngle = drift-0.45*rise+0.09*sin(3.0*drift+time+rise);
  vec2 rayDir = vec2(cos(rayAngle),sin(rayAngle));
  float body = skyV1_noiseTex3(vec3(rayDir*3.4+17.5,time));
  float grain = skyV1_noiseTex3(vec3(rayDir*17.0*SKYV1_AURORA_DENSITY+7.8,time*1.4));
  float width = 0.125+0.16*body;
  float veil = smoothstep(-0.075,0.035,above)*exp(-rise*rise/(width*width));
  vec3 lower, upper;
  skyV1_auroraColors(lower,upper);
  float spectrum = 1.0-abs(2.0*u_sky_auroraHue-1.0);
  float blush = smoothstep(-0.15,0.80,sin(drift+0.15));
  upper = mix(upper,vec3(0.98,0.12,0.56),spectrum*blush);
  vec3 color = mix(lower,upper,smoothstep(0.018,0.28,rise));
  vec3 light = color*veil*(0.08+0.64*body)*(0.42+0.72*grain);

  // A wide turning fold sweeps up from the band. Its angular footprint
  // broadens towards the crown and fades gently into the surrounding sky.
  float h = altitude-u_sky_auroraHeight+0.45;
  float turn = 0.02+0.46*sin(3.6*h-0.8)+0.065*sin(6.0*h+time);
  float across = 2.0*sin(0.5*(drift-turn));
  float span = 0.065+0.20*smoothstep(0.08,0.92,h);
  float core = across/span;
  float fold = exp(-core*core)*smoothstep(0.12,0.38,h);
  float fringe = (across+span*0.80)/(span*1.8);
  vec3 crest = mix(lower,vec3(0.012,1.0,0.53),spectrum);
  float spine = core+0.42+0.12*sin(9.0*h+time);
  light += (crest*fold*(0.36+0.78*exp(-6.0*spine*spine))
      + mix(crest,upper,0.57)*exp(-fringe*fringe)*smoothstep(0.14,0.47,h)*0.08)
      *(0.72+0.28*grain);
  return light*sector*u_sky_auroraIntensity*smoothstep(0.0,0.08,altitude)
      *(1.0-smoothstep(1.22,1.55,altitude));
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
    vec3 haze = skyV1_hazeColor(rd,sun);
    color = mix(color,haze,skyV1_hazeVeil(up));
    color += haze*u_sky_haze*0.4*exp(-up/0.045);
  }
  if (u_sky_storm > 0.0) {
    float rain = u_sky_storm*(1.0-exp(-exp(-up*7.0)*1.8));
    color = mix(color,skyV1_mist(),rain*0.85);
  }
  return color;
}

// ---- Portable entry point --------------------------------------------------
// rd: unit view direction in sky space (Y-up). Returns linear HDR radiance.
// Order: base (+moon sky, storm grey) + sun disk -> + stars, moon disk,
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
    ground = skyV1_stormOpen(ground+skyV1_moonSky(horizonDir)*0.6);
    color = mix(color,ground,smoothstep(0.0,0.2,-rd.y));
    return max(skyV1_aerial(color,normalize(vec3(rd.x+0.0001,0.0,rd.z)),sun),vec3(0.0));
  }
  if (u_sky_sunElevation >= 0.0) {
    float angle = acos(clamp(dot(rd,sun),-1.0,1.0));
    float disk = 1.0-smoothstep(SKYV1_SUN_RADIUS-SKYV1_PIXEL_ANGLE,SKYV1_SUN_RADIUS+SKYV1_PIXEL_ANGLE,angle);
    color += skyV1_lightTransmittance(sun.y,1.0,1.0)*disk*28.0*exp(-2.2*u_sky_haze);
  }
  vec3 stars = skyV1_stars(rd)/(1.0+skyV1_moonLight()*0.9*skyV1_night());
  color += skyV1_moonDisk(rd);
  color += skyV1_effects(rd);
  if (u_sky_cloudCover > 0.0) {
    vec4 cloud = skyV1_clouds(rd,sun);
    color = mix(color,cloud.rgb,cloud.a);
    // Point lights are far brighter than the sky, so even thin cloud must hide them.
    stars *= skyV1_sq(skyV1_sq(1.0-cloud.a));
  }
  color += stars;
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
  vec3 moon = vec3(0.07,0.11,0.21)*skyV1_night()*(u_sky_nightBrightness+1.2*skyV1_moonLight())*(1.0-0.6*u_sky_storm);
  return solar*skyV1_horizonTint(1.0)+moon;
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
  fill += vec3(0.035,0.055,0.09)*skyV1_nightGlow();
  fill = mix(fill,skyV1_hazeColor(horizonDir,sun)*0.45,skyV1_hazeVeil(0.3)*0.6);
  fill += skyV1_moonSky(vec3(0,1,0))*0.8;
  fill = skyV1_stormOpen(fill)*(1.0-0.3*u_sky_storm);
  if (u_sky_nightEffect == 2) {
    vec3 lower, upperColor;
    skyV1_auroraColors(lower,upperColor);
    fill += lower*u_sky_auroraIntensity*0.03*skyV1_effectFade();
  }
  return fill;
}
