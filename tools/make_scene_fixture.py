"""Generate the original, dependency-free glTF scene fixture (no third-party art).

Run from the repository root: python tools/make_scene_fixture.py
"""
import json
from pathlib import Path
import struct

faces = [
    ((1, 0, 0), [(1,-1,-1),(1,1,-1),(1,1,1),(1,-1,1)]),
    ((-1, 0, 0), [(-1,-1,1),(-1,1,1),(-1,1,-1),(-1,-1,-1)]),
    ((0, 1, 0), [(-1,1,-1),(-1,1,1),(1,1,1),(1,1,-1)]),
    ((0,-1,0), [(-1,-1,1),(-1,-1,-1),(1,-1,-1),(1,-1,1)]),
    ((0,0,1), [(1,-1,1),(1,1,1),(-1,1,1),(-1,-1,1)]),
    ((0,0,-1), [(-1,-1,-1),(-1,1,-1),(1,1,-1),(1,-1,-1)]),
]
positions = [component / 2 for _, vertices in faces for vertex in vertices for component in vertex]
normals = [component for normal, _ in faces for _ in range(4) for component in normal]
indices = [face * 4 + index for face in range(6) for index in [0,1,2,0,2,3]]
binary = struct.pack('<72f72f36H', *positions, *normals, *indices)
doc = {
    'asset': {'version': '2.0', 'generator': 'Sky Match original procedural fixture'},
    'scene': 0, 'scenes': [{'nodes': [0,1]}],
    'nodes': [
        {'name': 'Test cube', 'mesh': 0, 'translation': [0,0.9,0], 'scale': [1.8,1.8,1.8]},
        {'name': 'Test ground', 'mesh': 1, 'translation': [0,-0.05,0], 'scale': [8,0.1,8]},
    ],
    'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1}, 'indices': 2, 'material': material}]} for material in [0,1]],
    'materials': [
        {'name': 'Cyan', 'pbrMetallicRoughness': {'baseColorFactor': [0.04,0.5,0.65,1], 'metallicFactor': 0.15, 'roughnessFactor': 0.45}},
        {'name': 'Ground', 'pbrMetallicRoughness': {'baseColorFactor': [0.25,0.25,0.25,1], 'metallicFactor': 0, 'roughnessFactor': 0.9}},
    ],
    'buffers': [{'byteLength': len(binary)}],
    'bufferViews': [
        {'buffer': 0, 'byteOffset': 0, 'byteLength': 288, 'target': 34962},
        {'buffer': 0, 'byteOffset': 288, 'byteLength': 288, 'target': 34962},
        {'buffer': 0, 'byteOffset': 576, 'byteLength': 72, 'target': 34963},
    ],
    'accessors': [
        {'bufferView': 0, 'componentType': 5126, 'count': 24, 'type': 'VEC3', 'min': [-0.5]*3, 'max': [0.5]*3},
        {'bufferView': 1, 'componentType': 5126, 'count': 24, 'type': 'VEC3'},
        {'bufferView': 2, 'componentType': 5123, 'count': 36, 'type': 'SCALAR'},
    ],
}
json_chunk = json.dumps(doc, separators=(',', ':')).encode()
json_chunk += b' ' * (-len(json_chunk) % 4)
binary += b'\x00' * (-len(binary) % 4)
size = 12 + 8 + len(json_chunk) + 8 + len(binary)
glb = struct.pack('<III', 0x46546C67, 2, size) + struct.pack('<II', len(json_chunk), 0x4E4F534A) + json_chunk + struct.pack('<II', len(binary), 0x004E4942) + binary
target = Path(__file__).resolve().parents[1] / 'web/public/scenes/gltf-test/fixture.glb'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(glb)
print(f'{target}: {len(glb)} bytes')
