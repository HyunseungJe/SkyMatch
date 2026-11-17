# 툴로 내보내기 (Blender · Godot · Unity)

웹에서 만든 하늘을 각 툴에서 그대로 씁니다. 툴 사이에 오가는 것은 **하늘 JSON(θ)** 하나입니다.
웹 앱 왼쪽 아래의 **하늘 JSON 저장**으로 받은 파일을 각 툴에서 불러옵니다.

```json
{ "schema": "1.0", "params": { "sunElevation": 8, "zenithColor": "#2f6fc4", "...": 0 } }
```

색은 sRGB `#rrggbb`이고 나머지는 숫자입니다. 각 툴의 로더가 색을 선형으로 바꿔 넣습니다.

두 가지 방법이 있습니다.

| | 실시간 셰이더 (툴 안에서 슬라이더 조정) | 구운 EXR 파노라마 |
| --- | --- | --- |
| Blender 5.3 | `blender/skyV1.osl` (Cycles 전용, GPU는 OptiX) | Cycles, EEVEE |
| Godot 4.7 | `godot/sky_match_v1.gdshader` | `PanoramaSkyMaterial` |
| Unity 6 | `unity/SkyMatchV1/` (Built-in RP) | `Skybox/Panoramic` |

## 구운 EXR 파노라마

웹 앱의 **EXR 내보내기**는 지금 하늘을 equirect 선형 HDR(half float, ZIP) 파일로 굽습니다.
노출과 톤매핑은 들어가지 않습니다. 툴의 노출과 뷰 변환을 그대로 쓰면 됩니다.

- 대상은 **Blender · Unity**와 **Godot** 두 가지입니다. 툴마다 파노라마의 북쪽 위치가 달라서 파일이 다릅니다.
- 크기는 8192×4096(장당 20~50 MB, RTX 5060 Ti에서 약 4초) 또는 4096×2048입니다.
- 구름과 별은 내보낸 순간의 모습으로 고정됩니다.

툴별 설정:

- **Blender**: World → Environment Texture에 EXR을 넣습니다. 색 공간은 Linear Rec.709이고, 회전은 필요 없습니다.
- **Godot**: Environment → Sky → `PanoramaSkyMaterial`의 Panorama에 넣습니다. 가져오기 설정은 Lossless 또는 VRAM Compressed(BC6H)입니다. BC6H는 가져오기가 느립니다(8K 한 장에 몇 분).
- **Unity**: `Skybox/Panoramic` 머티리얼에서 Mapping은 Latitude Longitude Layout, Image Type은 360 Degrees, Rotation은 0으로 둡니다. 텍스처 가져오기에서 Max Size는 8192, Wrap U는 Repeat, V는 Clamp입니다.

## Blender (OSL)

```bash
blender -b --factory-startup --python tools/export/blender_world.py -- --theta my_sky.json --noise sky/textures/noise256.png --out my_sky.blend
```

`.blend`를 열면 World에 "Sky Match v1" 노드 그룹이 있습니다. 슬라이더 범위는 스키마와 같습니다. 그 안에 OSL Script 노드가 내부 텍스트로 들어 있습니다.

- `--theta`는 생략할 수 있고, 그러면 스키마 기본값으로 만듭니다. 색 소켓에는 선형 값이 들어갑니다(JSON의 sRGB를 변환).
- 노이즈 텍스처 경로는 `.blend` 기준 상대 경로로 저장됩니다. `.blend`를 다른 곳으로 옮기면 그룹 안 Script 노드의 `noiseTexture` 경로를 다시 지정합니다.
- 그룹의 `exposure` 입력은 하늘에 연결돼 있지 않습니다. 노출은 Color Management의 Exposure로 조정합니다.
- 다른 장면에서 쓰려면 File → Append → World에서 이 World를 가져옵니다.

- 렌더 엔진은 Cycles이고, Render Properties에서 Open Shading Language가 켜져 있어야 합니다.
- OSL은 NVIDIA OptiX GPU에서만 GPU로 돕니다. 그 밖의 GPU에서는 CPU 렌더라 느립니다.
- EEVEE에서는 OSL이 동작하지 않습니다. EEVEE에서는 구운 EXR을 씁니다.

## Godot 4.7

1. `godot/` 폴더의 파일을 프로젝트에 복사합니다. `sky_match_v1.gdshader`, `noise256.png`, `noise256.png.import`, `sky_match_theta.gd`입니다.
2. WorldEnvironment → Environment → Background를 Sky로 두고, Sky → Sky Material에 새 `ShaderMaterial`을 만들어 `sky_match_v1.gdshader`를 넣습니다.
3. 셰이더 파라미터 `skyV1_noiseTexture`에 `noise256.png`를 넣습니다. 이 텍스처는 데이터 텍스처라서 함께 준 `.import` 설정(Lossless, mipmap 없음)을 그대로 씁니다.
4. 하늘 JSON은 스크립트에서 불러옵니다.

   ```gdscript
   SkyMatchTheta.apply($WorldEnvironment.environment.sky.sky_material, "res://my_sky.json")
   ```

- `use_engine_time`이 켜져 있으면 구름·별·오로라가 움직입니다. 이때 Godot는 반사·환경광 큐브맵을 다시 계산합니다. 정지된 하늘이면 끄고 `time_seconds`를 고정합니다.
- 화면이 웹보다 어둡거나 밝으면 Environment의 Tonemap(AgX 권장)과 Exposure로 맞춥니다.

## Unity 6 (Built-in RP)

1. `unity/SkyMatchV1/` 폴더를 통째로 `Assets/` 아래에 복사합니다. 폴더 이름을 바꾸면 `noise256.png` 자동 설정이 적용되지 않습니다.
2. Project Settings → Player → Color Space를 **Linear**로 둡니다. 그래야 색이 맞습니다.
3. 셰이더 `Skybox/Sky Match v1`로 머티리얼을 만들고, Noise 슬롯에 `noise256.png`를 넣습니다. 그 머티리얼을 Window → Rendering → Lighting → Skybox Material에 지정합니다.
4. 하늘 JSON은 머티리얼을 선택하고 **Assets → Sky Match → Apply Sky JSON to Material**로 불러옵니다.

- URP·HDRP는 확인하지 않았습니다.
- `exposure` 슬라이더는 하늘 밖의 표시 값입니다. 하늘 JSON의 `exposure`도 여기에 들어갑니다.

## 생성과 검증

- Godot·Unity 셰이더는 `sky/skyV1.glsl`에서 기계적으로 생성합니다. `sky/skyV1.glsl`을 바꾸면 `uv run tools/export/make_engine_shaders.py`를 다시 돌려 함께 커밋합니다. 손으로 고치지 않습니다.
- OSL(`blender/skyV1.osl`)은 손 포팅입니다. `sky/skyV1.glsl`이 바뀌면 같이 고쳐야 합니다.
- 검증 방법(2026-11-17): 같은 θ와 카메라(세로 FOV 60°, 1280×720)로 각 툴에서 렌더해 기준 GLSL 렌더와 비교했습니다. 아래 수치는 표시 이미지의 평균 차이입니다.

  | 경로 | 장면 | 평균 차이 |
  | --- | --- | --- |
  | Blender OSL (Cycles OptiX) | 14개 | 0.000~0.005% |
  | Godot 셰이더 | 14개 | 0.004~0.022% (은하수 0.08%) |
  | Unity 셰이더 | 14개 | 0.000~0.039% (은하수 0.15%) |
  | Blender EXR (Cycles / EEVEE) | 5개 | 0.01~0.06% (은하수 0.13~0.25%) |
  | Unity EXR | 5개 | 0.22~0.37% |
  | Godot EXR | 5개 | 0.29~0.74% (은하수 1.4%) |

  은하수 장면의 차이는 한 픽셀 크기의 별입니다. 셰이더 경로에서는 GPU마다 해시 계산이 미세하게 달라 생기고, EXR 경로에서는 파노라마 샘플링으로 흐려져서 생깁니다. 1080p 하늘 비용은 Godot 1.7~3.1 ms, Unity 1.9~3.3 ms입니다(RTX 5060 Ti).
