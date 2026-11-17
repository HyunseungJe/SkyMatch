class_name SkyMatchTheta
## Applies a Sky Match sky JSON ({"schema": "1.0", "params": {...}}, saved by the web app) to a
## ShaderMaterial that uses sky_match_v1.gdshader. Colours in the JSON are sRGB "#rrggbb"; the
## shader's source_color uniforms convert them to linear. Example:
##     SkyMatchTheta.apply($WorldEnvironment.environment.sky.sky_material, "res://my_sky.json")
## "exposure" is a display value outside the sky: set Environment.tonemap_exposure yourself if wanted.


## Returns the number of parameters set, or -1 when the file cannot be read.
static func apply(material: ShaderMaterial, path: String) -> int:
	var data = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (data is Dictionary) or not data.has("params"):
		push_error("Sky Match: %s is not a sky JSON file" % path)
		return -1
	var schema := str(data.get("schema", ""))
	if not schema.begins_with("1."):
		push_error("Sky Match: schema %s is not supported (expected 1.x)" % schema)
		return -1
	var count := 0
	var params: Dictionary = data["params"]
	for key in params:
		var value = params[key]
		var uniform := "u_sky_" + str(key)
		if key == "exposure":
			continue
		elif key == "time":
			uniform = "time_seconds"
		if value is String:
			value = Color.html(value)
		elif key == "nightEffect":
			value = int(value)
		material.set_shader_parameter(uniform, value)
		count += 1
	return count
