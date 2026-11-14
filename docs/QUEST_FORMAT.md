# `.ezq` quest format (`easyquest/1`)

Write one file per area or chapter: `quests/<id>.ezq` (UTF-8). Lines starting with `//` are comments.
Indentation (any amount of spaces) marks a block's body.

## Header

```ezq
@title ต้นส่งของรอบหมู่บ้าน            // display title (default: file id)
@id village_delivery                   // optional; the file name is used otherwise
@dialogue village_delivery             // link dialogues/village_delivery.ezd (repeatable; optional path after the id)
@flag coins = 0 label="ค่าขนม" icon=coin
@flag reputation = 0 label="ความดี" icon=heart
@item mango "มะม่วง" icon=mango desc="ลุงมีฝากไปให้ตาเพิ่ม"
@event pickup                          // declare extra game events (removes "unknown event" warnings)
```

* **Flags** are numbers, booleans or strings. The `label` and `icon` appear at the top of the quest log.
  Every variable of a linked dialogue becomes a flag automatically (`fromDialogue`). If you declare it again,
  you can only add a label or icon; a different default value triggers a warning.
* **Items** are counted (`give mango 2`). The icon names are the built-in 16px icons (`sticky_rice`,
  `morning_glory`, `balm`, `mango`, `kanom_chan`, `nam_pan`, `coin`, `heart`, `bag`, `scroll`, and for
  Ramadan / Hari Raya `kurma` (dates), `bubur`, `ketupat`, `pelita`). An item
  with no icon gets an icon matching its id, or a bag.

## Quests

```ezq
=== quest_id "ชื่อเควสต์"
giver vendor                           // cast id from a linked dialogue → name, colour, portrait
summary ข้อความ {delivered}/3           // {flag} interpolation
requires done(village_delivery) and reputation >= 1
start on talk vendor                   // or: start when coins >= 5 · several start lines = any of them
fail on end village_delivery           // or: fail when …
on start:
    give sticky_rice
on fail:
    take sticky_rice
step market "ไปตลาดแต่เช้า"
    done on enter market
    hint ตลาดอยู่ทางทิศตะวันออก
    ~ visited_market = true
bonus mango "รับมะม่วง"                  // optional step: never blocks completion
    done when mango
    give mango
reward:
    ~ reputation += 1
    give kanom_chan
    @sfx fanfare                       // fires a quest_event signal for the game
```

**Life cycle**: `locked` → (`requires` true) `available` → (a `start` trigger; no start line = at once)
`active` → (every required step done) `completed`, or (a `fail` trigger) `failed`.

* Steps can complete in any order. The quest log shows the first unfinished required step as *current*,
  with its hint.
* A step's effects run when it completes, `reward:` runs on completion, `on start:` / `on fail:` likewise.
* `take` never goes below 0, and taking an item you don't have is a no-op.

### Triggers

| Form | Meaning |
| --- | --- |
| `on <event> [args…]` | An event with that name and those leading args. `on camera` matches `camera temple`. |
| `when <condition>` | The condition becomes true; re-checked after every event or change. |

**Events** come from:

* Dialogue `@event args` lines (e.g. `@camera temple`, `@sfx fanfare`).
* `end <dialogue>`: the linked conversation finished. The bridge fires it.
* Game events you send with `emit("talk", ["vendor"])`. The built-in names are `talk`, `enter`, `pickup`,
  `use` and `defeat`; declare others with `@event`.

One event completes at most one required step per quest (the first one waiting for it). Bonus steps watch
the same event without using it up.

### Conditions

These use the Easy Dialogue expression syntax (`and or not`, `== != < <= > >=`, `+ - * /`, strings, `true`
and `false`), plus these quest functions:

| Function | True / value when |
| --- | --- |
| `has(item)` · `count(item)` | in the bag · how many |
| `done(q)` `active(q)` `failed(q)` `available(q)` | quest status |
| `step(q, s)` | step `s` of quest `q` is done |
| `seen(event[, arg…])` | how many times that event happened |

### Effects

`~ flag = value` · `~ flag += n` · `~ flag -= n` · `give item [n]` · `take item [n]` · `@event args`

## Diagnostics

**Errors** (the file can't be exported):

* Unknown flag, item, quest, step or function, with *did you mean …?*
* `requires` cycles.
* A step without a `done` line.
* A quest with no required step.
* Duplicate ids.
* Unknown lines.

**Warnings**:

* An event that no linked dialogue fires and that is not a built-in or `@event`.
* `on end <dialogue>` for a dialogue that isn't linked.
* A giver that isn't in the cast.
* A flag default that differs from the dialogue's `@var`.
* A linked dialogue file that can't be found.

Every diagnostic carries the 1-based line (and column when known). `easyquest check` prints them as
`quests/file.ezq:12: message`.

## Easy Dialogue contract

Easy Quest only reads Easy Dialogue files; it never changes them. From `dialogues/<id>.ezd` (or the compiled
`<id>.dialogue.json`) it takes:

| Easy Dialogue | Easy Quest |
| --- | --- |
| `@char id "ชื่อ" portrait=set color=#hex` | `giver id` → name, colour, portrait `portraits/<set>/neutral.png` |
| `@var name = value` and `~ name …` writes | flags (shared namespace, same default) |
| `@event args` inside a node | trigger `on event args` |
| the runner reaching `END` | trigger `on end <id>` |

At runtime, the **bridge** wraps the runner:

* **JS**: `bridgeDialogue(manager, runner, id)` returns a `next()` to call instead of `runner.next()`.
* **Godot**: `QuestManager.connect_dialogue(runner, id)`, then `dialogue_ended(runner, id)` when it finishes.

On every dialogue `@event`, the bridge first copies `runner.vars` into the quest flags, then emits the
event. So `done when delivered >= 2` and `done on camera temple` both resolve at the exact moment the
conversation reaches them. When the runner returns `end`, the bridge syncs vars once more and emits
`end <id>`.

The bridge does not change the dialogue's variables, so a dialogue cannot see quest-only flags that were
set by quest effects. Branch on quest state in the game, or give a value to the dialogue with
`runner.vars.x = manager.vars.x` before `start()`.

`easyquest dialogue <id>` prints the contract it read, and `easyquest triggers <file>` lists the other side.

## Compiled JSON (`easyquest/1`)

`easyquest compile <file>` and the exports write:

```json
{
  "format": "easyquest/1",
  "id": "village_delivery",
  "title": "…",
  "dialogues": [{ "id": "village_delivery", "cast": { "vendor": { "name": "ป้าแดง", "portrait": "town_vendor" } }, "events": [{ "name": "camera", "args": ["temple"], "line": 31 }], "vars": { "delivered": 0 }, "found": true }],
  "flags": { "coins": { "name": "coins", "value": 0, "label": "ค่าขนม", "icon": "coin", "fromDialogue": "village_delivery", "line": 8 } },
  "items": { "mango": { "name": "มะม่วง", "icon": "mango" } },
  "events": [],
  "quests": [{ "id": "…", "title": "…", "giver": "vendor", "requires": null, "start": [{ "on": "camera", "args": ["market"] }], "fail": [], "onStart": [], "onFail": [], "reward": [], "steps": [{ "id": "temple", "title": "…", "optional": false, "done": [{ "on": "camera", "args": ["temple"] }], "effects": [{ "take": "sticky_rice", "n": 1 }] }] }]
}
```

Conditions are pre-parsed expression trees, so the runtimes don't need a parser. Every node keeps its source `line`. Both managers save as
`{ quests: {id: {status, steps[]}}, vars, items, seen }` (`state()` / `get_state()`).
