extends RefCounted
## Easy Dialogue runner for Godot 4.3+ — plays a compiled `easydialogue/1` JSON file.
## Mirrors runtime/pixi/easydialogue-runner.js line for line (same choices, variables and output).
##
##   var Runner = preload("res://addons/easydialogue/dialogue_runner.gd")
##   var r = Runner.new()
##   r.load_file("res://dialogue/village_delivery.dialogue.json")
##   r.start()
##   var ev = r.next()   # {type="line", name, text, emotion, portrait, ...} | {type="choices", options} | {type="end"}
##   r.choose(ev.options[0].index)
##
## MIT License. https://github.com/Saladin2020/easydialogue

signal event_fired(name: String, args: Array)

const MAX_STEPS := 10000

var doc: Dictionary = {}
var vars: Dictionary = {}
var stack: Array = []
var pending = null
var node_id: String = ""
var ended := true
var visited: Dictionary = {}
var disabled_choices := "hide"

var _interp := RegEx.create_from_string("(?<!\\\\)\\{\\s*\\$?([^}\\s]+)\\s*\\}")
var _unescape := RegEx.create_from_string("\\\\([{}])")


func load_file(path: String, initial: Dictionary = {}) -> bool:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("Easy Dialogue: cannot open %s" % path)
		return false
	var data = JSON.parse_string(f.get_as_text())
	if typeof(data) != TYPE_DICTIONARY or data.get("format", "") != "easydialogue/1":
		push_error("Easy Dialogue: %s is not an easydialogue/1 file" % path)
		return false
	setup(data, initial)
	return true


func setup(d: Dictionary, initial: Dictionary = {}) -> void:
	doc = d
	vars = (d.get("variables", {}) as Dictionary).duplicate(true)
	for k in initial:
		vars[k] = initial[k]
	disabled_choices = str(d.get("disabledChoices", "hide"))


func start(node: String = "") -> void:
	jump(node if node != "" else str(doc.get("start", "")))


func jump(id: String) -> void:
	if id == "END":
		stack.clear()
		ended = true
		return
	var nodes: Dictionary = doc.get("nodes", {})
	if not nodes.has(id):
		push_error("Easy Dialogue: unknown node %s" % id)
		stack.clear()
		ended = true
		return
	node_id = id
	visited[id] = int(visited.get(id, 0)) + 1
	stack = [{"body": nodes[id]["body"], "i": 0}]
	pending = null
	ended = false


## Advance to the next line / choice set / end. Events fire through `event_fired` on the way.
func next() -> Dictionary:
	if pending != null:
		return pending
	for _step in MAX_STEPS:
		if stack.is_empty():
			ended = true
			return {"type": "end"}
		var top: Dictionary = stack[stack.size() - 1]
		var body: Array = top["body"]
		if int(top["i"]) >= body.size():
			stack.pop_back()
			continue
		var s: Dictionary = body[int(top["i"])]
		top["i"] = int(top["i"]) + 1
		match str(s["t"]):
			"line":
				return _line_event(s)
			"choice":
				var options: Array = []
				var all: Array = s["options"]
				for idx in all.size():
					var o: Dictionary = all[idx]
					var ok: bool = not o.has("cond") or _truthy(evaluate(o["cond"]))
					var mode := str(o.get("disabled", disabled_choices))
					if ok:
						options.append({"index": idx, "id": o["id"], "text": interpolate(str(o["text"])), "disabled": false})
					elif mode == "grey":
						options.append({"index": idx, "id": o["id"], "text": interpolate(str(o["text"])), "disabled": true})
				if options.is_empty():
					continue
				pending = {"type": "choices", "options": options, "src": s.get("src", 0), "_stmt": s}
				return pending
			"if":
				for br in s["branches"]:
					if not br.has("cond") or _truthy(evaluate(br["cond"])):
						if (br["body"] as Array).size() > 0:
							stack.append({"body": br["body"], "i": 0})
						break
			"set":
				_apply_set(s)
			"jump":
				jump(str(s["target"]))
			"end":
				stack.clear()
				ended = true
				return {"type": "end"}
			"event":
				event_fired.emit(str(s["name"]), s.get("args", []))
	push_error("Easy Dialogue: loop without any line (check jumps)")
	return {"type": "end"}


## Pick a choice by its original `index` (as given in the options list).
func choose(index: int) -> void:
	if pending == null:
		push_error("Easy Dialogue: no choice is waiting")
		return
	var stmt: Dictionary = pending["_stmt"]
	var ok := false
	var shown = null
	for o in pending["options"]:
		if int(o["index"]) == index:
			shown = o
			ok = true
	if not ok:
		push_error("Easy Dialogue: choice %d is not available" % index)
		return
	if shown != null and shown.get("disabled", false):
		push_error("Easy Dialogue: choice %d is disabled" % index)
		return
	pending = null
	var opt: Dictionary = stmt["options"][index]
	if (opt["body"] as Array).size() > 0:
		stack.append({"body": opt["body"], "i": 0})


func _apply_set(s: Dictionary) -> void:
	var name := str(s["var"])
	var cur = vars.get(name, 0)
	var v = evaluate(s["value"])
	match str(s["op"]):
		"=":
			vars[name] = v
		"+=":
			if typeof(cur) == TYPE_STRING or typeof(v) == TYPE_STRING:
				vars[name] = format_value(cur) + format_value(v)
			else:
				vars[name] = _num(cur) + _num(v)
		"-=":
			vars[name] = _num(cur) - _num(v)
		"*=":
			vars[name] = _num(cur) * _num(v)
		"/=":
			vars[name] = 0.0 if _num(v) == 0.0 else _num(cur) / _num(v)


func _line_event(s: Dictionary) -> Dictionary:
	var chars: Dictionary = doc.get("characters", {})
	var sp = s.get("speaker", null)
	var c: Dictionary = chars.get(sp, {}) if sp != null else {}
	return {
		"type": "line",
		"id": s["id"],
		"speaker": sp,
		"name": c.get("name", sp if sp != null else ""),
		"emotion": s.get("emotion", "neutral"),
		"portrait": c.get("portrait", null),
		"color": c.get("color", null),
		"side": c.get("side", "left"),
		"voice": c.get("voice", null),
		"text": interpolate(str(s["text"])),
		"tags": s.get("tags", []),
		"src": s.get("src", 0),
		"node": node_id,
	}


static func format_value(v) -> String:
	if typeof(v) == TYPE_FLOAT:
		if is_equal_approx(v, round(v)) and absf(v) < 1e15:
			return str(int(round(v)))
		return str(snappedf(v, 0.001))
	if typeof(v) == TYPE_BOOL:
		return "true" if v else "false"
	return str(v)


func interpolate(text: String) -> String:
	var out := ""
	var last := 0
	for m in _interp.search_all(text):
		out += text.substr(last, m.get_start() - last)
		var key := m.get_string(1)
		out += format_value(vars.get(key, 0))
		last = m.get_end()
	out += text.substr(last)
	return _unescape.sub(out, "$1", true)


static func _truthy(v) -> bool:
	match typeof(v):
		TYPE_NIL:
			return false
		TYPE_BOOL:
			return v
		TYPE_INT, TYPE_FLOAT:
			return v != 0
		TYPE_STRING:
			return v != ""
	return true


static func _num(v) -> float:
	match typeof(v):
		TYPE_INT, TYPE_FLOAT:
			return float(v)
		TYPE_BOOL:
			return 1.0 if v else 0.0
		TYPE_STRING:
			return float(v) if (v as String).is_valid_float() else 0.0
	return 0.0


func evaluate(e: Dictionary):
	match str(e["k"]):
		"num", "str", "bool":
			return e["v"]
		"var":
			return vars.get(str(e["n"]), 0)
		"un":
			var a = evaluate(e["a"])
			if str(e["op"]) == "not":
				return not _truthy(a)
			return -_num(a)
		"bin":
			var op := str(e["op"])
			if op == "and":
				return _truthy(evaluate(e["b"])) if _truthy(evaluate(e["a"])) else false
			if op == "or":
				return true if _truthy(evaluate(e["a"])) else _truthy(evaluate(e["b"]))
			var a = evaluate(e["a"])
			var b = evaluate(e["b"])
			match op:
				"+":
					if typeof(a) == TYPE_STRING or typeof(b) == TYPE_STRING:
						return format_value(a) + format_value(b)
					return _num(a) + _num(b)
				"-":
					return _num(a) - _num(b)
				"*":
					return _num(a) * _num(b)
				"/":
					return 0.0 if _num(b) == 0.0 else _num(a) / _num(b)
				"%":
					return 0.0 if _num(b) == 0.0 else fmod(_num(a), _num(b))
				"==":
					return _same(a, b)
				"!=":
					return not _same(a, b)
				"<":
					return _num(a) < _num(b)
				"<=":
					return _num(a) <= _num(b)
				">":
					return _num(a) > _num(b)
				">=":
					return _num(a) >= _num(b)
	push_error("Easy Dialogue: bad expression %s" % JSON.stringify(e))
	return 0


static func _kind(v) -> String:
	match typeof(v):
		TYPE_INT, TYPE_FLOAT:
			return "number"
		TYPE_BOOL:
			return "bool"
		TYPE_STRING:
			return "string"
	return "other"


static func _same(a, b) -> bool:
	if _kind(a) == _kind(b):
		if _kind(a) == "number":
			return is_equal_approx(_num(a), _num(b))
		return a == b
	return format_value(a) == format_value(b)


## Play through with scripted picks (positions in the visible option list). Returns transcript lines.
func autoplay(picks: Array = [], node: String = "") -> Array:
	var transcript: Array = []
	start(node)
	var p := 0
	for _guard in 5000:
		var ev := next()
		if ev["type"] == "end":
			break
		if ev["type"] == "line":
			var nm := str(ev["name"])
			transcript.append(("%s: " % nm if nm != "" else "") + str(ev["text"]))
			continue
		var opts: Array = ev["options"]
		var want := int(picks[p]) if p < picks.size() else 0
		p += 1
		var opt: Dictionary = opts[min(want, opts.size() - 1)]
		transcript.append("> " + str(opt["text"]))
		choose(int(opt["index"]))
	return transcript
