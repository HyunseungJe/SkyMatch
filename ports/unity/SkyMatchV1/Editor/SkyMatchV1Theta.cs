using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

// Applies a Sky Match θ JSON file ({"schema": "1.0", "params": {...}}, exported by the web app)
// to the selected "Skybox/Sky Match v1" material. Colours in θ are sRGB "#rrggbb"; Unity converts
// Color properties to linear in a Linear colour space project.
public static class SkyMatchV1Theta
{
    [MenuItem("Assets/Sky Match/Apply Sky JSON to Material")]
    static void ApplyToSelection()
    {
        var mat = Selection.activeObject as Material;
        if (mat == null) { EditorUtility.DisplayDialog("Sky Match", "Select a Skybox/Sky Match v1 material first.", "OK"); return; }
        var path = EditorUtility.OpenFilePanel("Sky Match sky JSON", "", "json");
        if (string.IsNullOrEmpty(path)) return;
        Undo.RecordObject(mat, "Apply Sky Match JSON");
        int n = Apply(mat, File.ReadAllText(path));
        EditorUtility.SetDirty(mat);
        Debug.Log($"Sky Match: applied {n} parameters from {Path.GetFileName(path)} to {mat.name}");
    }

    [MenuItem("Assets/Sky Match/Apply Sky JSON to Material", true)]
    static bool CanApply() => Selection.activeObject is Material;

    /// <summary>Sets every θ parameter the material has; returns how many were set.</summary>
    public static int Apply(Material mat, string json)
    {
        var schema = Regex.Match(json, @"""schema""\s*:\s*""([^""]+)""");
        if (schema.Success && !schema.Groups[1].Value.StartsWith("1."))
            throw new System.Exception("Sky JSON schema " + schema.Groups[1].Value + " is not supported (expected 1.x)");
        int start = json.IndexOf("\"params\"");
        if (start < 0) throw new System.Exception("Sky JSON has no \"params\" object");
        int n = 0;
        foreach (Match m in Regex.Matches(json.Substring(start), @"""(\w+)""\s*:\s*(""#[0-9a-fA-F]{6}""|-?[0-9.]+(?:[eE][-+]?[0-9]+)?)"))
        {
            string key = m.Groups[1].Value, v = m.Groups[2].Value;
            // exposure is a display value outside the sky; time is a start offset (time_seconds).
            string prop = key == "exposure" ? "exposure" : key == "time" ? "time_seconds" : "u_sky_" + key;
            if (!mat.HasProperty(prop)) { Debug.LogWarning("Sky Match: material has no parameter " + key); continue; }
            if (v.StartsWith("\""))
            {
                ColorUtility.TryParseHtmlString(v.Trim('"'), out var c);
                mat.SetColor(prop, c);
            }
            else mat.SetFloat(prop, float.Parse(v, CultureInfo.InvariantCulture));
            n++;
        }
        return n;
    }
}
