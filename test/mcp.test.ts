import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { access } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES, createEasyQuestMcp } from "../src/mcp/server.js";
import { createApp } from "../src/server/app.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
let client: Client;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
  const server = createEasyQuestMcp(root);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(b);
});
afterAll(async () => {
  await client.close();
  await cleanup();
});

const body = (res: unknown) => JSON.parse(((res as { content: Array<{ text: string }> }).content[0]!).text);

describe("MCP server", () => {
  it("lists the seven tools", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([...MCP_TOOL_NAMES].sort());
    expect(tools).toHaveLength(7);
  });

  it("writes, simulates, renders and exports a quest file end to end", async () => {
    const info = body(await client.callTool({ name: "workspace_info", arguments: {} }));
    expect(info.quests.map((d: { id: string }) => d.id)).toContain("village_delivery");
    expect(info.dialogues.map((d: { id: string }) => d.id)).toContain("village_delivery");
    expect(info.syntax).toMatch(/===/);

    const got = body(await client.callTool({ name: "get_quest", arguments: { id: "village_delivery", includeSource: false } }));
    expect(got.quests).toHaveLength(3);
    expect(got.triggers).toContain("camera temple");

    const bad = body(await client.callTool({ name: "write_quest", arguments: { id: "mcp_test", source: `=== q "Q"\nstep a "A"\n  done when has(ghost)\n` } }));
    expect(bad.saved).toBe(false);
    expect(bad.errors[0].line).toBe(3);

    const src = `@dialogue village_delivery
@item mango "มะม่วง"
=== fetch_mango "เอามะม่วงไปให้ตาเพิ่ม"
giver farmer
start on camera temple
step get "ได้มะม่วง"
  done when mango
step bring "ส่งให้ตาเพิ่ม"
  done on camera elder_house
reward:
  give mango
`;
    const good = body(await client.callTool({ name: "write_quest", arguments: { id: "mcp_test", source: src } }));
    expect(good.saved).toBe(true);
    const sim = body(await client.callTool({ name: "simulate_quest", arguments: { id: "mcp_test", inputs: "play village_delivery 0,0" } }));
    expect(sim.quests.fetch_mango.status).toBe("completed");
    expect(sim.items.mango).toBe(1);

    const shot = await client.callTool({ name: "render_quest_log", arguments: { id: "mcp_test", inputs: "play village_delivery 0,0", scale: 1 } });
    const content = shot.content as Array<{ type: string; mimeType?: string }>;
    expect(content.some((c) => c.type === "image" && c.mimeType === "image/png")).toBe(true);

    const exported = body(await client.callTool({ name: "export_quests", arguments: { id: "mcp_test", preset: "pixi" } }));
    for (const d of exported.dirs) await access(d);
    const escape = await client.callTool({ name: "export_quests", arguments: { id: "mcp_test", preset: "json", out: "../../outside" } });
    expect((escape as { isError?: boolean }).isError).toBe(true);
  });
});

describe("HTTP API", () => {
  it("serves quests, compile, simulate and render; blocks cross-origin writes", async () => {
    const app = createApp({ workspaceRoot: root, webRoot: "/nonexistent" });
    const h = { host: "127.0.0.1:8818" };
    const json = { ...h, "content-type": "application/json" };
    expect((await app.request("/api/health", { headers: h })).status).toBe(200);
    const list = await (await app.request("/api/quests", { headers: h })).json();
    expect(JSON.stringify(list)).toMatch(/village_delivery/);
    const comp = (await (await app.request("/api/compile", { method: "POST", headers: json, body: JSON.stringify({ source: `=== q "Q"\nrequires done(zz)\n` }) })).json()) as { errors: { line: number }[] };
    expect(comp.errors.some((e) => e.line === 2)).toBe(true);
    const sim = (await (await app.request("/api/simulate", { method: "POST", headers: json, body: JSON.stringify({ id: "village_delivery", inputs: "play village_delivery 2" }) })).json()) as { state: { quests: Record<string, { status: string }> } };
    expect(sim.state.quests.village_delivery!.status).toBe("failed");
    const png = await app.request("/api/render", { method: "POST", headers: json, body: JSON.stringify({ id: "village_delivery", inputs: "", scale: 1 }) });
    expect(png.headers.get("content-type")).toBe("image/png");
    const cross = await app.request("/api/quests/x", { method: "POST", headers: { ...json, origin: "https://evil.example" }, body: "{}" });
    expect(cross.status).toBe(403);
  });
});
