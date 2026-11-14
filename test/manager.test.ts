import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QuestManager } from "../src/shared/manager.js";
import { parseInputs, runSimulation } from "../src/lib/sim.js";
import { compileById } from "../src/lib/workspace.js";
import { compileQuests } from "../src/shared/parser.js";
import { parseExpr } from "../src/shared/expr.js";
import type { QuestDoc } from "../src/shared/types.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
let doc: QuestDoc;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
  doc = await compileById(root, "village_delivery");
});
afterAll(() => cleanup());

const statuses = (s: { quests: Record<string, { status: string }> }) => Object.fromEntries(Object.entries(s.quests).map(([k, v]) => [k, v.status]));
const play = (text: string) => runSimulation(root, doc, parseInputs(text).inputs);

describe("QuestManager + Easy Dialogue bridge", () => {
  it("picks 0,0: delivery and snack money complete, help_tomorrow unlocks", async () => {
    const r = await play("play village_delivery 0,0");
    expect(statuses(r.state)).toEqual({ village_delivery: "completed", snack_money: "completed", help_tomorrow: "available" });
    expect(r.state.quests.village_delivery!.steps).toContain("mango");
    expect(r.state.vars).toMatchObject({ delivered: 3, coins: 15, reputation: 1, mango: true });
    expect(r.state.items).toMatchObject({ kanom_chan: 1, nam_pan: 1 });
    expect(r.state.items.sticky_rice ?? 0).toBe(0);
    expect(r.log).toContain("complete village_delivery");
    expect(r.transcript.length).toBeGreaterThan(5);
  });

  it("picks 1,1: completed without the bonus mango", async () => {
    const r = await play("play village_delivery 1,1");
    expect(r.state.quests.village_delivery!.status).toBe("completed");
    expect(r.state.quests.village_delivery!.steps).not.toContain("mango");
    expect(r.state.vars.coins).toBe(5);
  });

  it("picks 2: the dialogue ends before delivering → quest fails and items are taken back", async () => {
    const r = await play("play village_delivery 2");
    expect(r.state.quests.village_delivery!.status).toBe("failed");
    expect(r.state.items.sticky_rice ?? 0).toBe(0);
  });

  it("help_tomorrow needs talk vendor + enter market after the delivery", async () => {
    const r = await play("play village_delivery 0,0; talk vendor; enter market; talk vendor");
    expect(r.state.quests.help_tomorrow!.status).toBe("completed");
    expect(r.state.vars.reputation).toBe(2);
  });

  it("an event is consumed by one step per quest; bonus steps do not consume", () => {
    const src = `=== q "Q"
step a "A"
  done on ring
step b "B"
  done on ring
`;
    const m = new QuestManager(compileQuests(src, { id: "t" }).doc!);
    m.emit("ring");
    expect(m.state().quests.q!.steps).toEqual(["a"]);
    m.emit("ring");
    expect(m.status("q")).toBe("completed");
  });

  it("save / load round-trips and seen() counts events", () => {
    const m = new QuestManager(doc);
    m.emit("camera", ["market"]);
    m.emit("camera", ["market"]);
    const saved = JSON.parse(JSON.stringify(m.state()));
    const m2 = new QuestManager(doc).load(saved);
    expect(m2.state()).toEqual(m.state());
    expect(m2.status("village_delivery")).toBe("active");
    expect(m2.evaluate(parseExpr("seen(camera, market)"))).toBe(2);
    expect(m2.evaluate(parseExpr("seen(camera)"))).toBe(2);
  });
});

describe("sim inputs", () => {
  it("parses events, sets, items, vars json and play lines", () => {
    const { inputs, ignored } = parseInputs('camera temple; @talk vendor\n~ coins = 5\nvars {"a":1}\ngive mango 2; take balm\nplay village_delivery 0,1\n=== nope');
    expect(inputs).toEqual([
      { event: "camera temple" },
      { event: "talk vendor" },
      { set: { coins: 5 } },
      { set: { a: 1 } },
      { give: "mango", n: 2 },
      { take: "balm", n: 1 },
      { play: "village_delivery", picks: [0, 1] },
    ]);
    expect(ignored).toBe(1);
  });
});
