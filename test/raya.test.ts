import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInputs, runSimulation } from "../src/lib/sim.js";
import { compileById, listQuests } from "../src/lib/workspace.js";
import { hasIcon } from "../src/shared/icons.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => ({ root, cleanup } = await tempWorkspace()));
afterAll(() => cleanup());

const run = async (inputs: string) => runSimulation(root, await compileById(root, "ramadan_raya"), parseInputs(inputs).inputs);
const play = async (inputs: string) => (await run(inputs)).state;

describe("ramadan_raya questline (multicultural village)", () => {
  it("ships clean, linked to its .ezd, with Ramadan / Raya icons", async () => {
    const q = await listQuests(root);
    expect(q.find((x) => x.id === "ramadan_raya")).toMatchObject({ quests: 3, errors: 0, warnings: 0, dialogues: ["ramadan_raya"] });
    for (const icon of ["kurma", "bubur", "ketupat", "pelita"]) expect(hasIcon(icon), icon).toBe(true);
  });

  it("iftar sharing → Raya prep → Raya day, driven by the dialogue's events", async () => {
    const r = await run("play ramadan_raya 0,0,0,0");
    const s = r.state;
    expect(s.quests.iftar_share!.status).toBe("completed");
    expect(s.quests.raya_prep!.status).toBe("completed");
    expect(s.quests.raya_visit!.status).toBe("completed");
    expect(s.quests.raya_prep!.steps).toContain("neat");
    expect(s.vars.kindness).toBe(4);
    expect(s.items).toEqual({ ketupat_shell: 1, pelita: 1 });
    expect(r.log).toContain("fire sfx raya_loop");
  });

  it("Raya prep stays locked until the iftar quest is done; leaving early fails it", async () => {
    const early = await play("camera tadika; raya prep; ~ ketupat = 3");
    expect(early.quests.raya_prep!.status).toBe("locked");
    const left = await play("play ramadan_raya 1");
    expect(left.quests.iftar_share!.status).toBe("failed");
  });
});
