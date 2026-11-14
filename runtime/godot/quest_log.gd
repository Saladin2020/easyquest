extends Control
## Easy Quest log panel for Godot 4.3+ — the same layout as the PNG / web / Pixi quest log
## (480×270 base units; use stretch mode canvas_items so Kanit stays sharp at any window size).
## Redraws whenever QuestManager emits `changed`. Select a quest with `selected = "id"` or ↑/↓.
##
## MIT License. https://github.com/Saladin2020/easyquest

@export var manager_path: NodePath
@export var background: Texture2D
@export var style := "teak"
@export var selected := ""
@export var ui_dir := "res://ui"

const STATUS_TH := {"locked": "ยังไม่ปลดล็อก", "available": "รับเควสต์ได้", "active": "กำลังทำ", "completed": "สำเร็จ", "failed": "ล้มเหลว"}
const ORDER := {"active": 0, "available": 1, "completed": 2, "failed": 3, "locked": 4}
const COLORS := {
	"teak": {"text": Color("#f3e7d3"), "dim": Color("#b49a7c"), "title": Color("#ffd27a"), "accent": Color("#f4ae3d"), "good": Color("#8fd16a"), "bad": Color("#e5806c"), "select": Color(0.957, 0.682, 0.239, 0.16), "inner": Color(0.078, 0.055, 0.039, 0.72), "line": Color("#3a2819"), "plate_text": Color("#0d0906")},
}

var qm: Node
var font: Font
var font_medium: Font
var _box: StyleBoxTexture
var _plate: StyleBoxTexture
var _well: StyleBoxTexture
var _tex := {}


func _ready() -> void:
	qm = get_node(manager_path) if not manager_path.is_empty() else get_node_or_null("/root/QuestManager")
	font = load("res://fonts/Kanit-Regular.ttf")
	font_medium = load("res://fonts/Kanit-Medium.ttf")
	_box = _nine("%s/box_%s.png" % [ui_dir, style], 8)
	_plate = _nine("%s/plate_%s.png" % [ui_dir, style], 5)
	_well = _nine("%s/well_%s.png" % [ui_dir, style], 4)
	if qm:
		qm.changed.connect(queue_redraw)
	focus_mode = Control.FOCUS_ALL
	queue_redraw()


## Follow another QuestManager instance (e.g. one that is not the autoload).
func bind(manager: Node) -> void:
	if qm and qm.changed.is_connected(queue_redraw):
		qm.changed.disconnect(queue_redraw)
	qm = manager
	qm.changed.connect(queue_redraw)
	qm.flag_changed.connect(func(_n, _v): queue_redraw())
	qm.item_changed.connect(func(_n, _c): queue_redraw())
	queue_redraw()


func _nine(path: String, m: int) -> StyleBoxTexture:
	var sb := StyleBoxTexture.new()
	sb.texture = load(path)
	sb.texture_margin_left = m
	sb.texture_margin_top = m
	sb.texture_margin_right = m
	sb.texture_margin_bottom = m
	return sb


func _icon(kind: String, name: String) -> Texture2D:
	var key := kind + ":" + name
	if not _tex.has(key):
		var p := "%s/%s/%s.png" % [ui_dir, kind, name]
		_tex[key] = load(p) if ResourceLoader.exists(p) else load("%s/%s/%s.png" % [ui_dir, kind, "bag" if kind == "icons" else "todo"])
	return _tex[key]


func _portrait(set_id) -> Texture2D:
	if set_id == null or str(set_id) == "":
		return null
	# Cached: a texture that is only referenced while _draw() runs is freed before the frame renders.
	var key := "portrait:" + str(set_id)
	if not _tex.has(key):
		var p := "res://portraits/%s/neutral.png" % set_id
		_tex[key] = load(p) if ResourceLoader.exists(p) else null
	return _tex[key]


func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed):
		return
	var ids := _visible().map(func(q): return str(q["id"]))
	if ids.is_empty():
		return
	var i := ids.find(_selected_id())
	if event.keycode == KEY_DOWN:
		selected = ids[(i + 1) % ids.size()]
		queue_redraw()
	elif event.keycode == KEY_UP:
		selected = ids[(i - 1 + ids.size()) % ids.size()]
		queue_redraw()


func _visible() -> Array:
	var out: Array = []
	if qm == null or qm.doc.is_empty():
		return out
	for q in qm.doc["quests"]:
		if qm.status(str(q["id"])) != "locked":
			out.append(q)
	out.sort_custom(func(a, b): return ORDER[qm.status(str(a["id"]))] < ORDER[qm.status(str(b["id"]))])
	return out


func _selected_id() -> String:
	var vis := _visible()
	for q in vis:
		if str(q["id"]) == selected:
			return selected
	for q in vis:
		if qm.status(str(q["id"])) == "active":
			return str(q["id"])
	return str(vis[0]["id"]) if vis.size() > 0 else ""


func _text(t: String, pos: Vector2, size: int, color: Color, medium := false, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0) -> void:
	var f := font_medium if medium else font
	if align == HORIZONTAL_ALIGNMENT_RIGHT:
		pos.x -= f.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	elif align == HORIZONTAL_ALIGNMENT_CENTER:
		pos.x -= f.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x / 2.0
	draw_string(f, pos, t, HORIZONTAL_ALIGNMENT_LEFT, width, size, color, TextServer.JUSTIFICATION_NONE, TextServer.DIRECTION_AUTO, TextServer.ORIENTATION_HORIZONTAL)


func _w(t: String, size: int, medium := false) -> float:
	return (font_medium if medium else font).get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x


func _ellipsis(t: String, w: float, size: int, medium := false) -> String:
	if _w(t, size, medium) <= w:
		return t
	var s := t
	while s.length() > 1 and _w(s + "…", size, medium) > w:
		s = s.substr(0, s.length() - 1)
	return s + "…"


func _cast() -> Dictionary:
	var out := {}
	for d in qm.doc["dialogues"]:
		for k in d["cast"]:
			out[k] = d["cast"][k]
	return out


func _draw() -> void:
	var C: Dictionary = COLORS.get(style, COLORS["teak"])
	if background:
		draw_texture_rect(background, Rect2(0, 0, 480, 270), false)
		draw_rect(Rect2(0, 0, 480, 270), Color(0.04, 0.027, 0.02, 0.45))
	else:
		draw_rect(Rect2(0, 0, 480, 270), Color("#1a1410"))
	var px := 12.0
	var py := 10.0
	var pw := 456.0
	var ph := 250.0
	draw_rect(Rect2(px + 4, py + 4, pw - 8, ph - 8), C["inner"])
	_box.draw(get_canvas_item(), Rect2(px, py, pw, ph))
	if qm == null or qm.doc.is_empty():
		return
	var head := "สมุดภารกิจ"
	var plate_w := ceilf(_w(head, 9, true)) + 16
	_plate.draw(get_canvas_item(), Rect2(px + 10, py - 4, plate_w, 16))
	_text(head, Vector2(px + 10 + plate_w / 2.0, py + 8), 9, C["plate_text"], true, HORIZONTAL_ALIGNMENT_CENTER)
	_text(_ellipsis(str(qm.doc["title"]), 180, 8), Vector2(px + 16 + plate_w, py + 9), 8, C["dim"])
	var flags: Array = []
	for f in qm.doc["flags"].values():
		if f.has("label"):
			flags.append(f)
	flags.reverse()
	var fx := px + pw - 12
	for f in flags:
		var label := "%s %s" % [f["label"], qm.format_value(qm.vars.get(str(f["name"]), f["value"]))]
		fx -= _w(label, 8, true)
		_text(label, Vector2(fx, py + 9), 8, C["text"], true)
		fx -= 14
		draw_texture_rect(_icon("icons", str(f.get("icon", "scroll"))), Rect2(fx, py - 1, 12, 12), false)
		fx -= 8
	var top := py + 18
	draw_rect(Rect2(px + 8, top, pw - 16, 1), C["line"])

	var lx := px + 8
	var lw := 144.0
	var ly := top + 5
	var sel := _selected_id()
	var vis := _visible()
	if vis.is_empty():
		_text("ยังไม่มีภารกิจ", Vector2(lx + 6, ly + 14), 8, C["dim"])
	for q in vis:
		var id := str(q["id"])
		var st: String = qm.status(id)
		if id == sel:
			draw_rect(Rect2(lx, ly, lw, 28), C["select"])
			draw_rect(Rect2(lx, ly, 2, 28), C["accent"])
		draw_texture_rect(_icon("state", st), Rect2(lx + 5, ly + 4, 10, 10), false)
		var done_c := st == "completed" or st == "failed"
		_text(_ellipsis(qm.interpolate(str(q["title"])), lw - 22, 9, true), Vector2(lx + 18, ly + 12), 9, C["dim"] if done_c else C["text"], true)
		var req := 0
		var got := 0
		for s in q["steps"]:
			if not bool(s["optional"]):
				req += 1
				if qm.step_done(id, str(s["id"])):
					got += 1
		var sub_c: Color = C["bad"] if st == "failed" else (C["good"] if st == "completed" else (C["accent"] if st == "available" else C["dim"]))
		_text("%s · %d/%d" % [STATUS_TH[st], got, req], Vector2(lx + 18, ly + 23), 7, sub_c)
		ly += 31
		if ly > py + ph - 50:
			break
	draw_rect(Rect2(lx + lw + 5, top + 5, 1, ph - 56), C["line"])

	var dx := lx + lw + 13
	var dw := px + pw - 10 - dx
	var q: Dictionary = qm.quest(sel) if sel != "" else {}
	if not q.is_empty():
		var st: String = qm.status(sel)
		var y := top + 5
		_well.draw(get_canvas_item(), Rect2(dx, y, 36, 36))
		var giver = q.get("giver")
		var cast := _cast()
		var g: Dictionary = cast.get(giver, {}) if giver != null else {}
		var portrait := _portrait(g.get("portrait"))
		if portrait:
			draw_texture_rect(portrait, Rect2(dx + 2, y + 2, 32, 32), false)
		else:
			draw_texture_rect(_icon("icons", "scroll"), Rect2(dx + 10, y + 10, 16, 16), false)
		var tx := dx + 43
		_text(_ellipsis(qm.interpolate(str(q["title"])), dw - 43, 11, true), Vector2(tx, y + 12), 11, C["title"], true)
		if giver != null:
			_text("ผู้ให้ภารกิจ: %s" % g.get("name", giver), Vector2(tx, y + 23), 8, Color(str(g["color"])) if g.has("color") else C["dim"])
		var badge_c: Color = C["bad"] if st == "failed" else (C["good"] if st == "completed" else C["accent"])
		_text(STATUS_TH[st], Vector2(px + pw - 12, y + 23), 8, badge_c, true, HORIZONTAL_ALIGNMENT_RIGHT)
		if q.has("summary"):
			draw_multiline_string(font, Vector2(tx, y + 33), qm.interpolate(str(q["summary"])), HORIZONTAL_ALIGNMENT_LEFT, dw - 43, 8, 2, C["text"])
		y += 48
		var current_marked := false
		for s in q["steps"]:
			var done: bool = qm.step_done(sel, str(s["id"]))
			var state := "done" if done else "todo"
			if not done and st == "failed":
				state = "failed"
			elif not done and st == "active" and not bool(s["optional"]) and not current_marked:
				state = "current"
				current_marked = true
			var icon := "completed" if state == "done" else ("current" if state == "current" else ("failed" if state == "failed" else ("bonus" if bool(s["optional"]) else "todo")))
			draw_texture_rect(_icon("state", icon), Rect2(dx + 2, y + 2, 10, 10), false)
			var label: String = qm.interpolate(str(s["title"]))
			if bool(s["optional"]):
				label = "โบนัส · " + label
			var col: Color = C["text"] if state == "current" else (C["bad"] if state == "failed" else C["dim"])
			label = _ellipsis(label, dw - 18, 8, state == "current")
			_text(label, Vector2(dx + 16, y + 10), 8, col, state == "current")
			if state == "done":
				draw_rect(Rect2(dx + 16, y + 6.5, minf(_w(label, 8), dw - 18), 0.6), C["dim"])
			y += 13
			if state == "current" and s.has("hint"):
				_text(_ellipsis("› " + str(s["hint"]), dw - 22, 7), Vector2(dx + 20, y + 6), 7, C["accent"])
				y += 10
			if y > py + ph - 62:
				break
		var rewards: Array = []
		for e in q["reward"]:
			if e.has("give"):
				var it: Dictionary = qm.doc["items"].get(str(e["give"]), {})
				rewards.append([str(it.get("icon", e["give"])), str(it.get("name", e["give"])) + (" ×%d" % int(e["n"]) if int(e["n"]) > 1 else "")])
			elif e.has("set") and str(e["op"]) == "+=" and str(e["value"]["k"]) == "num":
				var fl: Dictionary = qm.doc["flags"].get(str(e["set"]), {})
				rewards.append([str(fl.get("icon", "scroll")), "%s +%s" % [fl.get("label", e["set"]), qm.format_value(e["value"]["v"])]])
		if rewards.size() > 0:
			var ry := py + ph - 48
			_text("รางวัล", Vector2(dx, ry + 9), 8, C["dim"], true)
			var rx := dx + 30
			for r in rewards:
				draw_texture_rect(_icon("icons", r[0]), Rect2(rx, ry - 1, 12, 12), false)
				_text(r[1], Vector2(rx + 14, ry + 9), 8, C["text"])
				rx += 20 + _w(r[1], 8)

	var by := py + ph - 32
	draw_rect(Rect2(px + 8, by, pw - 16, 1), C["line"])
	_text("ย่าม", Vector2(px + 12, by + 17), 8, C["dim"], true)
	var ix := px + 40
	if qm.items.is_empty():
		_text("ว่างเปล่า", Vector2(ix, by + 17), 8, C["dim"])
	for id in qm.items:
		var it: Dictionary = qm.doc["items"].get(id, {})
		draw_texture_rect(_icon("icons", str(it.get("icon", id))), Rect2(ix, by + 5, 16, 16), false)
		var n := int(qm.items[id])
		var label := str(it.get("name", id)) + (" ×%d" % n if n > 1 else "")
		_text(label, Vector2(ix + 18, by + 17), 8, C["text"])
		ix += 26 + _w(label, 8)
