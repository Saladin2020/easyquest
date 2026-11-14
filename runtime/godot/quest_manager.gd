extends Node
## Easy Quest manager for Godot 4.3+ — runs a compiled `easyquest/1` JSON file.
## Mirrors runtime/pixi/easyquest-manager.js line for line (same states, log and rewards).
## Add it as an autoload named QuestManager (the exported project already does):
##
##   QuestManager.load_file("res://quests/village_delivery.quests.json")
##   QuestManager.quest_completed.connect(func(id): print("done ", id))
##   QuestManager.emit_event("talk", ["vendor"])           # game events
##   QuestManager.connect_dialogue(runner, "village_delivery")  # Easy Dialogue runner: @events + end
##
## MIT License. https://github.com/Saladin2020/easyquest

signal quest_available(id: String)
signal quest_started(id: String)
signal step_completed(quest_id: String, step_id: String)
signal quest_completed(id: String)
signal quest_failed(id: String)
signal item_changed(id: String, count: int)
signal flag_changed(name: String, value)
signal quest_event(name: String, args: Array)
signal changed

const MAX_PASSES := 64

var doc: Dictionary = {}
var vars: Dictionary = {}
var items: Dictionary = {}
var quests: Dictionary = {}
var seen: Dictionary = {}
var history: Array = []  ## same lines as the JS manager's `log`


func load_file(path: String, initial_vars: Dictionary = {}) -> bool:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("Easy Quest: cannot open %s" % path)
		return false
	var d = JSON.parse_string(f.get_as_text())
	if typeof(d) != TYPE_DICTIONARY or str(d.get("format", "")) != "easyquest/1":
		push_error("Easy Quest: %s is not an easyquest/1 document" % path)
		return false
	setup(d, initial_vars)
	return true


func setup(d: Dictionary, initial_vars: Dictionary = {}) -> void:
	doc = d
	vars = {}
	for f in doc["flags"].values():
		vars[str(f["name"])] = f["value"]
	for k in initial_vars:
		vars[k] = initial_vars[k]
	items = {}
	quests = {}
	for q in doc["quests"]:
		quests[str(q["id"])] = {"status": "locked", "steps": {}}
	seen = {}
	history = []
	update({})


# ---------------------------------------------------------------- queries

func status(id: String) -> String:
	return str(quests[id]["status"]) if quests.has(id) else "locked"


func step_done(q: String, s: String) -> bool:
	return quests.has(q) and quests[q]["steps"].has(s)


func count(item: String) -> int:
	return int(items.get(item, 0))


func quest(id: String) -> Dictionary:
	for q in doc["quests"]:
		if str(q["id"]) == id:
			return q
	return {}


## First required step that is not done (what the quest log points at), or {}.
func current_step(id: String) -> Dictionary:
	var q := quest(id)
	if q.is_empty():
		return {}
	for s in q["steps"]:
		if not bool(s["optional"]) and not step_done(id, str(s["id"])):
			return s
	return {}


static func format_value(v) -> String:
	if typeof(v) == TYPE_FLOAT:
		if is_equal_approx(v, round(v)) and absf(v) < 1e15:
			return str(int(round(v)))
		return str(snappedf(v, 0.001))
	if typeof(v) == TYPE_BOOL:
		return "true" if v else "false"
	return str(v)


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


static func _arg_name(e) -> String:
	if typeof(e) != TYPE_DICTIONARY:
		return ""
	match str(e["k"]):
		"var":
			return str(e["n"])
		"str":
			return str(e["v"])
		"num":
			return format_value(e["v"])
	return ""


func evaluate(e: Dictionary):
	match str(e["k"]):
		"num", "str", "bool":
			return e["v"]
		"var":
			return vars.get(str(e["n"]), 0)
		"call":
			var args: Array = e["args"]
			var a0 := _arg_name(args[0]) if args.size() > 0 else ""
			match str(e["f"]):
				"has":
					return count(a0) >= (_num(evaluate(args[1])) if args.size() > 1 else 1.0)
				"count":
					return count(a0)
				"done":
					return status(a0) == "completed"
				"active":
					return status(a0) == "active"
				"failed":
					return status(a0) == "failed"
				"available":
					return status(a0) == "available"
				"step":
					return step_done(a0, _arg_name(args[1]) if args.size() > 1 else "")
				"seen":
					var parts: Array = []
					for a in args:
						parts.append(_arg_name(a))
					return int(seen.get(" ".join(parts), 0))
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
	push_error("Easy Quest: bad expression %s" % JSON.stringify(e))
	return 0


## `{flag}` in titles and summaries.
func interpolate(text: String) -> String:
	var re := RegEx.create_from_string("(?<!\\\\)\\{\\s*\\$?([^}\\s]+)\\s*\\}")
	var out := ""
	var last := 0
	for m in re.search_all(text):
		out += text.substr(last, m.get_start() - last)
		out += format_value(vars.get(m.get_string(1), 0))
		last = m.get_end()
	out += text.substr(last)
	return out.replace("\\{", "{").replace("\\}", "}")


# ---------------------------------------------------------------- input

## Feed a game or dialogue event. `with_vars` (e.g. the Easy Dialogue runner's vars) are adopted first.
func emit_event(name: String, args: Array = [], with_vars = null) -> void:
	if typeof(with_vars) == TYPE_DICTIONARY:
		sync_vars(with_vars)
	var key: Array = [name]
	for a in args:
		key.append(str(a))
	for i in range(1, key.size() + 1):
		var k := " ".join(key.slice(0, i))
		seen[k] = int(seen.get(k, 0)) + 1
	history.append("event " + " ".join(key))
	update({"name": name, "args": key.slice(1)})


func sync_vars(v: Dictionary) -> void:
	for k in v:
		if not vars.has(k) or not _same_strict(vars[k], v[k]):
			vars[k] = v[k]
			flag_changed.emit(k, v[k])


static func _same_strict(a, b) -> bool:
	return _kind(a) == _kind(b) and _same(a, b)


func set_flag(name: String, value) -> void:
	vars[name] = value
	flag_changed.emit(name, value)
	update({})


func give(item: String, n: int = 1) -> void:
	_give(item, n)
	update({})


func take(item: String, n: int = 1) -> void:
	_take(item, n)
	update({})


func _give(item: String, n: int) -> void:
	items[item] = count(item) + n
	history.append("give %s %d" % [item, n])
	item_changed.emit(item, items[item])


func _take(item: String, n: int) -> void:
	if count(item) == 0:
		return
	var left := maxi(0, count(item) - n)
	if left == 0:
		items.erase(item)
	else:
		items[item] = left
	history.append("take %s %d" % [item, n])
	item_changed.emit(item, left)


func _run(effects: Array) -> void:
	for fx in effects:
		if fx.has("set"):
			var name := str(fx["set"])
			var v = evaluate(fx["value"])
			var cur = vars.get(name, 0)
			var nv = v
			if str(fx["op"]) == "+=":
				if typeof(cur) == TYPE_STRING or typeof(v) == TYPE_STRING:
					nv = format_value(cur) + format_value(v)
				else:
					nv = _num(cur) + _num(v)
			elif str(fx["op"]) == "-=":
				nv = _num(cur) - _num(v)
			vars[name] = nv
			history.append("set %s %s" % [name, format_value(nv)])
			flag_changed.emit(name, nv)
		elif fx.has("give"):
			_give(str(fx["give"]), int(fx["n"]))
		elif fx.has("take"):
			_take(str(fx["take"]), int(fx["n"]))
		elif fx.has("event"):
			var parts: Array = [str(fx["event"])]
			parts.append_array(fx["args"])
			history.append("fire " + " ".join(parts))
			quest_event.emit(str(fx["event"]), fx["args"])


func _fires(triggers: Array, ev: Dictionary, ctx: Dictionary, consume: bool) -> bool:
	for t in triggers:
		if t.has("when"):
			if _truthy(evaluate(t["when"])):
				return true
		elif not ev.is_empty() and not bool(ctx["consumed"]) and str(t["on"]) == str(ev["name"]):
			var ok := true
			var targs: Array = t["args"]
			var eargs: Array = ev["args"]
			for i in targs.size():
				if str(targs[i]) != "*" and (i >= eargs.size() or str(targs[i]) != str(eargs[i])):
					ok = false
					break
			if ok:
				if consume:
					ctx["consumed"] = true
				return true
	return false


## Re-evaluate every quest until nothing changes.
func update(ev: Dictionary) -> void:
	var ctx := {}
	for q in doc["quests"]:
		ctx[str(q["id"])] = {"consumed": false}
	var did_change := true
	var any := false
	var pass_i := 0
	while did_change and pass_i < MAX_PASSES:
		pass_i += 1
		did_change = false
		for q in doc["quests"]:
			var id := str(q["id"])
			var st: Dictionary = quests[id]
			var c: Dictionary = ctx[id]
			if st["status"] == "locked" and (q.get("requires") == null or _truthy(evaluate(q["requires"]))):
				st["status"] = "available"
				history.append("available " + id)
				quest_available.emit(id)
				did_change = true
			if st["status"] == "available" and ((q["start"] as Array).is_empty() or _fires(q["start"], ev, c, true)):
				st["status"] = "active"
				history.append("start " + id)
				quest_started.emit(id)
				_run(q["onStart"])
				did_change = true
			if st["status"] != "active":
				continue
			if _fires(q["fail"], ev, c, false):
				st["status"] = "failed"
				history.append("fail " + id)
				quest_failed.emit(id)
				_run(q["onFail"])
				did_change = true
				continue
			for s in q["steps"]:
				if not bool(s["optional"]) or st["steps"].has(str(s["id"])):
					continue
				if _fires(s["done"], ev, {"consumed": c["consumed"]}, false):
					st["steps"][str(s["id"])] = true
					history.append("bonus %s.%s" % [id, s["id"]])
					step_completed.emit(id, str(s["id"]))
					_run(s["effects"])
					did_change = true
			var cur := current_step(id)
			if not cur.is_empty() and _fires(cur["done"], ev, c, true):
				st["steps"][str(cur["id"])] = true
				history.append("step %s.%s" % [id, cur["id"]])
				step_completed.emit(id, str(cur["id"]))
				_run(cur["effects"])
				did_change = true
			if current_step(id).is_empty():
				st["status"] = "completed"
				history.append("complete " + id)
				quest_completed.emit(id)
				_run(q["reward"])
				did_change = true
		if did_change:
			any = true
	if any:
		changed.emit()


# ---------------------------------------------------------------- save / load

func get_state() -> Dictionary:
	var qs := {}
	for q in doc["quests"]:
		var id := str(q["id"])
		var done: Array = []
		for s in q["steps"]:
			if quests[id]["steps"].has(str(s["id"])):
				done.append(str(s["id"]))
		qs[id] = {"status": quests[id]["status"], "steps": done}
	return {"quests": qs, "vars": vars.duplicate(), "items": items.duplicate(), "seen": seen.duplicate()}


func load_state(state: Dictionary) -> void:
	for k in state.get("vars", {}):
		vars[k] = state["vars"][k]
	items = state.get("items", {}).duplicate()
	seen = state.get("seen", {}).duplicate()
	for q in doc["quests"]:
		var id := str(q["id"])
		var s: Dictionary = state.get("quests", {}).get(id, {})
		var steps := {}
		for sid in s.get("steps", []):
			steps[str(sid)] = true
		quests[id] = {"status": str(s.get("status", "locked")), "steps": steps}
	changed.emit()


# ---------------------------------------------------------------- Easy Dialogue bridge

var _bridged: Dictionary = {}

## Connect an Easy Dialogue runner (addons/easydialogue/dialogue_runner.gd): the runner gets the quest
## flags, each @event is forwarded with the runner's vars, rewards are written back into the runner.
## Call dialogue_ended(runner, id) when runner.next() returns {type="end"} (DialogueBox: dialogue_finished).
func connect_dialogue(runner, dialogue_id: String) -> void:
	for k in vars:
		runner.vars[k] = vars[k]
	var cb := func(name: String, args: Array) -> void:
		emit_event(name, args, runner.vars)
		for k in vars:
			runner.vars[k] = vars[k]
	_bridged[runner.get_instance_id()] = cb
	runner.event_fired.connect(cb)


func dialogue_ended(runner, dialogue_id: String) -> void:
	emit_event("end", [dialogue_id], runner.vars)
	var id: int = runner.get_instance_id()
	if _bridged.has(id):
		runner.event_fired.disconnect(_bridged[id])
		_bridged.erase(id)


## Play a compiled dialogue with scripted picks through the bridge (tests / demos). Returns the transcript.
func play_dialogue(runner, dialogue_id: String, picks: Array = []) -> Array:
	connect_dialogue(runner, dialogue_id)
	runner.start()
	var out: Array = []
	var pi := 0
	for _i in 10000:
		var ev: Dictionary = runner.next()
		if ev["type"] == "end":
			break
		if ev["type"] == "line":
			var who = ev.get("name")
			out.append(("%s: %s" % [who, ev["text"]]) if who != null and str(who) != "" else str(ev["text"]))
		elif ev["type"] == "choices":
			var live: Array = []
			for o in ev["options"]:
				if not bool(o.get("disabled", false)):
					live.append(o)
			var want: int = int(picks[pi]) if pi < picks.size() else 0
			pi += 1
			var pick: Dictionary = live[mini(want, live.size() - 1)]
			out.append("> " + str(pick["text"]))
			runner.choose(int(pick["index"]))
	dialogue_ended(runner, dialogue_id)
	return out
