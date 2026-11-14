import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileQuests, questDeps, suggest, triggerToString } from "../src/shared/parser.js";
import { scanEzd } from "../src/shared/ezd.js";
import { parseExpr } from "../src/shared/expr.js";

const samples = path.resolve(import.meta.dirname, "../samples");
const ezd = readFileSync(path.join(samples, "dialogues/village_delivery.ezd"), "utf8");
const ezq = readFileSync(path.join(samples, "quests/village_delivery.ezq"), "utf8");
const dialogue = () => scanEzd(ezd, "village_delivery");

describe("parser", () => {
  it("compiles the village_delivery sample cleanly against its Easy Dialogue script", () => {
    const r = compileQuests(ezq, { id: "village_delivery", dialogue });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const doc = r.doc!;
    expect(doc.format).toBe("easyquest/1");
    expect(doc.quests.map((q) => q.id)).toEqual(["village_delivery", "snack_money", "help_tomorrow"]);
    const vd = doc.quests[0]!;
    expect(vd.giver).toBe("vendor");
    expect(vd.start.map(triggerToString)).toEqual(["on camera market"]);
    expect(vd.steps.map((s) => s.id)).toEqual(["accept", "temple", "farm", "mango", "elder", "report"]);
    expect(vd.steps.find((s) => s.id === "mango")!.optional).toBe(true);
    // dialogue vars become flags; quest flags keep their labels
    expect(Object.keys(doc.flags)).toEqual(expect.arrayContaining(["coins", "reputation", "delivered", "mango"]));
    expect(doc.flags.coins!.label).toBe("ค่าขนม");
    expect(doc.flags.delivered!.fromDialogue).toBe("village_delivery");
    expect(doc.dialogues[0]!.cast.vendor!.name).toBe("ป้าแดง");
    expect(questDeps(doc)).toEqual([{ from: "village_delivery", to: "help_tomorrow" }]);
  });

  it("reports unknown names with line numbers and did-you-mean", () => {
    const src = `@item mango "มะม่วง"
=== q "Q"
requires done(qq)
step a "A"
  done when has(mangoo)
  give mangp
`;
    const r = compileQuests(src, { id: "t" });
    expect(r.doc).toBeNull();
    const msgs = r.errors.map((e) => `${e.line}: ${e.message}`);
    expect(msgs.some((m) => m.startsWith("3:") && /qq/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith("5:") && /mangoo/.test(m) && /mango/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith("6:") && /mangp/.test(m))).toBe(true);
  });

  it("finds prerequisite cycles and steps without a done line", () => {
    const src = `=== a "A"
requires done(b)
step s "S"
  done on talk x
=== b "B"
requires done(a)
step t "T"
  hint never finishes
`;
    const r = compileQuests(src, { id: "t" });
    const all = r.errors.map((e) => e.message).join("\n");
    expect(all).toMatch(/cycle/i);
    expect(r.errors.some((e) => e.line === 7)).toBe(true);
  });

  it("warns when a step waits for an event the dialogue never fires", () => {
    const src = ezq.replace("done on camera temple", "done on camera tempel");
    const r = compileQuests(src, { id: "village_delivery", dialogue });
    expect(r.errors).toEqual([]);
    const w = r.warnings.find((x) => /tempel/.test(x.message));
    expect(w).toBeDefined();
    expect(src.split("\n")[w!.line - 1]).toMatch(/tempel/);
  });

  it("suggest() and quest functions in expressions", () => {
    expect(suggest("mangoo", ["mango", "balm"])).toBe("mango");
    const e = parseExpr("done(village_delivery) and reputation >= 1");
    expect(JSON.stringify(e)).toMatch(/"call"/);
  });
});

describe("Easy Dialogue scan", () => {
  it("reads cast, vars and @events from an .ezd", () => {
    const d = dialogue();
    expect(Object.keys(d.cast)).toEqual(expect.arrayContaining(["kid", "vendor", "monk", "farmer", "elder"]));
    expect(Object.keys(d.vars)).toEqual(expect.arrayContaining(["delivered", "coins", "mango"]));
    const sigs = d.events.map((e) => [e.name, ...e.args].join(" "));
    expect(sigs).toEqual(expect.arrayContaining(["camera market", "camera temple", "camera elder_house", "sfx fanfare"]));
    expect(d.events.every((e) => e.line > 0)).toBe(true);
  });

  it("the compiled .dialogue.json gives the same contract", async () => {
    const { scanCompiled } = await import("../src/shared/ezd.js");
    const json = JSON.parse(readFileSync(path.join(samples, "dialogues/village_delivery.dialogue.json"), "utf8"));
    const c = scanCompiled(json);
    const s = dialogue();
    expect(Object.keys(c.vars).sort()).toEqual(Object.keys(s.vars).sort());
    expect(new Set(c.events.map((e) => [e.name, ...e.args].join(" ")))).toEqual(new Set(s.events.map((e) => [e.name, ...e.args].join(" "))));
  });
});
