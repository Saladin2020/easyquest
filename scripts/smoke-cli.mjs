/** CLI smoke test: init a temp workspace, check, play, render and export through the real CLI. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ws = mkdtempSync(path.join(os.tmpdir(), "easyquest-cli-"));
const cli = (...args) => execFileSync("npx", ["tsx", "src/cli.ts", ...args, "--workspace", ws], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let failed = false;
const ok = (cond, label) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failed = true;
};

cli("init");
ok(existsSync(path.join(ws, "quests", "village_delivery.ezq")) && existsSync(path.join(ws, "dialogues", "village_delivery.ezd")), "init copies the demo quest + dialogue");
const check = JSON.parse(cli("check", "village_delivery", "--json"));
ok(check.errors.length === 0 && check.warnings.length === 0, "check: demo is clean");
const play = JSON.parse(cli("play", "village_delivery", "--picks", "0,0", "--json"));
ok(play.state.quests.village_delivery.status === "completed" && play.state.quests.help_tomorrow.status === "available", "play --picks 0,0 completes the delivery");
const fail = JSON.parse(cli("play", "village_delivery", "--picks", "2", "--json"));
ok(fail.state.quests.village_delivery.status === "failed", "play --picks 2 fails it");
const ev = JSON.parse(cli("play", "village_delivery", "--events", "camera market; camera temple", "--json"));
ok(ev.state.quests.village_delivery.status === "active", "play --events drives triggers by hand");
const contract = cli("dialogue", "village_delivery");
ok(/camera temple/.test(contract) && /delivered/.test(contract), "dialogue shows the Easy Dialogue contract");

writeFileSync(path.join(ws, "quests", "broken.ezq"), `@item mango "มะม่วง"\n=== q "Q"\nstep a "A"\n  done when has(mangoo)\n`);
let out = "";
try {
  cli("check", "broken");
} catch (e) {
  out = String(e.stdout) + String(e.stderr);
}
ok(/broken\.ezq:4/.test(out) && /did you mean "mango"/.test(out), "check reports file:line and a suggestion");

const png = path.join(ws, "log.png");
cli("render", "village_delivery", "--picks", "0,0", "--scale", "3", "--out", png);
const b = readFileSync(png);
ok(b.readUInt32BE(16) === 1440 && b.readUInt32BE(20) === 810, "render --scale 3 → 1440×810 PNG");

cli("export", "village_delivery", "--preset", "all");
for (const f of ["exports/village_delivery-pixi/index.html", "exports/village_delivery-godot/project.godot", "exports/village_delivery-json/village_delivery.quests.json"]) {
  ok(existsSync(path.join(ws, f)), `export → ${f}`);
}

rmSync(ws, { recursive: true, force: true });
console.log(failed ? "CLI smoke FAILED" : "CLI smoke OK");
process.exit(failed ? 1 : 0);
