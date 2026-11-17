"""Build a schema 1.0 Sky Match Cycles/OSL World.

blender -b --factory-startup --python tools/export/blender_world.py -- \
    --theta theta.json --noise sky/textures/noise256.png --out sky.blend

The three colour sockets contain scene-linear Rec.709 values. The schema's
exposure socket is display metadata only; Blender's view exposure controls display.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "sky/sky_schema_v1.json"
OSL_PATH = ROOT / "ports/blender/skyV1.osl"


def linear_color(value):
    """Convert an sRGB #rrggbb theta colour using the standard sRGB EOTF."""
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ValueError(f"Expected an sRGB #rrggbb colour, got {value!r}")
    srgb = [int(value[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def read_params(theta_path=None):
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf8"))
    params = schema["params"]
    theta = {}
    if theta_path is not None:
        document = json.loads(Path(theta_path).read_text(encoding="utf8"))
        if document.get("schema") != schema["version"]:
            raise ValueError(f"Theta schema must be {schema['version']!r}")
        theta = document.get("params")
        if not isinstance(theta, dict):
            raise ValueError("Theta must contain a params object")
        unknown = sorted(set(theta) - set(params))
        if unknown:
            raise ValueError("Unknown theta parameters: " + ", ".join(unknown))
    values = {}
    for name, spec in params.items():
        value = theta.get(name, spec["default"])
        if spec.get("type") == "color":
            value = (*linear_color(value), 1.0)
        else:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"{name} must be a finite number")
            if name == "nightEffect":
                if value not in (0, 1, 2):
                    raise ValueError("nightEffect must be 0, 1 or 2")
                value = int(value)
            if ("min" in spec and value < spec["min"]) or ("max" in spec and value > spec["max"]):
                raise ValueError(f"{name} is outside its schema range")
        values[name] = value
    return schema, values


def build_world(noise_path, values, schema=None):
    """Create and return the World group instance; leave the scene otherwise intact."""
    if schema is None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf8"))
    noise_path = Path(noise_path).resolve()
    if not noise_path.is_file():
        raise FileNotFoundError(noise_path)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.shading_system = True
    world = bpy.data.worlds.new("Sky Match v1")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    group = bpy.data.node_groups.new("Sky Match v1", "ShaderNodeTree")
    group["schema"] = "1.0"
    gin = group.nodes.new("NodeGroupInput")
    gin.location = (-600, 0)
    gout = group.nodes.new("NodeGroupOutput")
    gout.location = (400, 0)
    for name, spec in schema["params"].items():
        kind = "NodeSocketColor" if spec.get("type") == "color" else "NodeSocketInt" if name == "nightEffect" else "NodeSocketFloat"
        sock = group.interface.new_socket(name=name, in_out="INPUT", socket_type=kind)
        sock.description = spec.get("label", name) + " (" + spec["role"] + ")"
        if name == "exposure":
            sock.description += "; display metadata, use Blender View Exposure"
        if kind == "NodeSocketColor":
            sock.default_value = (*linear_color(spec["default"]), 1.0)
        else:
            sock.default_value = spec["default"]
            if "min" in spec:
                sock.min_value = spec["min"]
            if "max" in spec:
                sock.max_value = spec["max"]
            if name == "nightEffect":
                sock.min_value, sock.max_value = 0, 2
    group.interface.new_socket(name="World", in_out="OUTPUT", socket_type="NodeSocketShader")
    group.interface.new_socket(name="Radiance", in_out="OUTPUT", socket_type="NodeSocketColor")
    script = group.nodes.new("ShaderNodeScript")
    script.name = "skyV1.osl"
    script.mode = "INTERNAL"
    script.location = (-300, 0)
    text = bpy.data.texts.new("skyV1.osl")
    text.write(OSL_PATH.read_text(encoding="utf8"))
    script.script = text
    from cycles import osl
    errors = []
    osl.update_script_node(script, lambda level, message: errors.append(message))
    if "Radiance" not in script.outputs:
        raise RuntimeError("OSL compilation failed: " + " | ".join(errors))
    # Filename lookups are data reads. Also mark the image Non-Color for inspection
    # and for Blender's image cache if it is shared with an image texture node.
    image = bpy.data.images.load(str(noise_path), check_existing=True)
    image.colorspace_settings.name = "Non-Color"
    script.inputs["noiseTexture"].default_value = str(noise_path)
    for name in schema["params"]:
        if name in script.inputs:
            group.links.new(gin.outputs[name], script.inputs[name])
    background = group.nodes.new("ShaderNodeBackground")
    background.location = (80, 80)
    background.inputs["Strength"].default_value = 1.0
    group.links.new(script.outputs["Radiance"], background.inputs["Color"])
    group.links.new(background.outputs["Background"], gout.inputs["World"])
    group.links.new(script.outputs["Radiance"], gout.inputs["Radiance"])
    instance = nt.nodes.new("ShaderNodeGroup")
    instance.node_tree = group
    instance.name = "Sky Match v1"
    instance.label = "Sky Match v1 | linear Rec.709"
    instance.location = (0, 0)
    for name, value in values.items():
        instance.inputs[name].default_value = value
    output = nt.nodes.new("ShaderNodeOutputWorld")
    output.location = (320, 0)
    nt.links.new(instance.outputs["World"], output.inputs["Surface"])
    return instance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--theta", type=Path)
    parser.add_argument("--noise", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    schema, values = read_params(args.theta)
    node = build_world(args.noise, values, schema)
    scene = bpy.context.scene
    # Ordinary editable scene settings; comparison renders use a separate script.
    scene.cycles.samples = 128
    scene.cycles.preview_samples = 32
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"
    args.out = args.out.resolve()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    script = node.node_tree.nodes["skyV1.osl"]
    try:
        script.inputs["noiseTexture"].default_value = bpy.path.relpath(str(args.noise.resolve()), start=str(args.out.parent))
    except ValueError:  # Different Windows drives cannot have relative paths.
        pass
    for image in bpy.data.images:
        if Path(bpy.path.abspath(image.filepath)).resolve() == args.noise.resolve():
            try:
                image.filepath = bpy.path.relpath(str(args.noise.resolve()), start=str(args.out.parent))
            except ValueError:
                pass
    bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
    print(f"Saved Sky Match v1 World: {args.out}")


if __name__ == "__main__":
    main()
