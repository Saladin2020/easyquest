import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QuestManager } from "../src/shared/manager.js";
import { compileById } from "../src/lib/workspace.js";
import { compileQuests } from "../src/shared/parser.js";
import type { QuestDoc } from "../src/shared/types.js";
import { tempWorkspace } from "./helpers.js";

let doc: QuestDoc;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  const ws = await tempWorkspace();
  cleanup = ws.cleanup;
  doc = await compileById(ws.root, "village_delivery");
});
afterAll(() => cleanup());

describe("achievements", () => {
  it("compiles @achievement lines with icon, desc and hidden", () => {
    expect(doc.achievements?.map((a) => [a.id, a.icon, Boolean(a.hidden)])).toEqual([
      ["first_job", "star", false],
      ["pocket_money", "coin", false],
      ["village_helper", "heart", true],
    ]);
  });

  it("unlock once, in order, with a signal, and survive save / load", () => {
    const m = new QuestManager(doc);
    const got: string[] = [];
    m.on((name, id) => name === "achievement_unlocked" && got.push(String(id)));
    m.setFlag("coins", 5);
    expect(got).toEqual([]);
    m.emit("camera", ["market"]);
    expect(got).toEqual(["first_job"]);
    m.setFlag("coins", 20);
    m.setFlag("coins", 25);
    expect(got).toEqual(["first_job", "pocket_money"]);
    expect(m.log.filter((l: string) => l.startsWith("achievement"))).toEqual(["achievement first_job", "achievement pocket_money"]);
    const st = m.state();
    expect(st.achievements).toEqual(["first_job", "pocket_money"]);
    const m2 = new QuestManager(doc).load(JSON.parse(JSON.stringify(st)));
    expect(m2.achievements().filter((a: { unlocked: boolean }) => a.unlocked).map((a: { id: string }) => a.id)).toEqual(["first_job", "pocket_money"]);
  });

  it("reports bad conditions and syntax", () => {
    const r = compileQuests('@flag x = 0\n@achievement a "A" when nope > 1\n@achievement b "B"\n=== q "Q"\nstep s "S"\n    done when x > 1\n', { id: "t" });
    const msgs = r.errors.map((d) => d.message).join("\n");
    expect(msgs).toMatch(/unknown flag "nope"/);
    expect(msgs).toMatch(/Expected @achievement/);
  });
});
