using UnityEditor;
using UnityEngine;

// Imports the Sky Match noise texture (any "noise256.png" inside a SkyMatchV1 folder) as data:
// sRGB off, no mipmaps, bilinear, repeat, uncompressed. The sky reads exact texel values.
public class SkyMatchV1Import : AssetPostprocessor
{
    void OnPreprocessTexture()
    {
        if (!assetPath.Contains("SkyMatchV1/") || !assetPath.EndsWith("noise256.png")) return;
        var t = (TextureImporter)assetImporter;
        t.textureType = TextureImporterType.Default;
        t.sRGBTexture = false;
        t.mipmapEnabled = false;
        t.filterMode = FilterMode.Bilinear;
        t.wrapMode = TextureWrapMode.Repeat;
        t.npotScale = TextureImporterNPOTScale.None;
        t.textureCompression = TextureImporterCompression.Uncompressed;
        t.alphaSource = TextureImporterAlphaSource.FromInput;
    }
}
