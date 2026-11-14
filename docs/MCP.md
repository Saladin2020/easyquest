# Easy Quest MCP server

Seven tools for an AI assistant (or any MCP client) to read, write, check, simulate, render and export quests.

```bash
npm run mcp                         # stdio
npm run mcp:http                    # Streamable HTTP → http://127.0.0.1:8819/mcp
```

Client config (stdio):

```json
{
  "mcpServers": {
    "easyquest": {
      "command": "npx",
      "args": ["tsx", "/path/to/easyquest/src/mcp/server.ts"],
      "env": { "EASYQUEST_WORKSPACE": "/path/to/my-game-quests" }
    }
  }
}
```

| Tool | Input | Returns |
| --- | --- | --- |
| `workspace_info` | none | Quest files, linked dialogues (events and vars), backgrounds, styles, built-in events, export presets, the `.ezq` cheat sheet. Call this first. |
| `list_quests` | none | Each `.ezq` with quest and step counts, dialogues, error and warning counts |
| `get_quest` | `id`, `includeSource?` | Source, line-numbered errors and warnings, quests with their steps and triggers, `requires` edges, flags, items, the dialogue contract |
| `write_quest` | `id`, `source`, `dryRun?`, `force?` | Validates and saves `quests/<id>.ezq`. Refuses to save with errors unless `force`. |
| `simulate_quest` | `id`, `inputs`, `source?` | Event log, quest statuses and steps, vars, items, dialogue transcript, warnings |
| `render_quest_log` | `id`, `inputs?`, `selected?`, `style?`, `background?`, `scale?`, `showLocked?` | A PNG of the quest log after the inputs (image content), saved under `exports/previews/` |
| `export_quests` | `id`, `preset?` (`json` \| `godot` \| `pixi` \| `all`), `style?`, `picks?`, `out?` | Output folders and file count |

Inputs go one per line or are separated by `;`:

* `play village_delivery 0,0` plays the linked dialogue with picks, using exact event and variable ordering.
* `camera temple` or `@camera temple` is an event.
* `talk vendor` / `enter market` are game events.
* `~ coins = 5` and `vars {"coins":5}` set flags.
* `give mango`, `take mango 2` change items.

## Example session

1. `workspace_info` shows the cheat sheet, plus `village_delivery.ezd`, which fires `camera temple` and
   writes `delivered`.
2. `write_quest` saves `{ id: "fetch_mango", source: "@dialogue village_delivery\n=== fetch_mango \"…\"\n…" }`.
   If the source has errors it is not saved, and the response gives `line 6: unknown item "mangoo" (did you mean "mango"?)`.
3. `simulate_quest` with `{ id: "fetch_mango", inputs: "play village_delivery 0,0" }` returns
   `fetch_mango: completed`.
4. `render_quest_log` returns the Thai quest-log image.
5. `export_quests` with `{ preset: "godot" }` writes `exports/fetch_mango-godot/`.

## Security

* Paths (`out`) stay inside the workspace plus `EASYQUEST_ALLOWED_DIRS`.
* The HTTP transport binds to `127.0.0.1`. A non-loopback `--host` requires the token printed at startup
  (or `EASYQUEST_TOKEN`), sent as `Authorization: Bearer …`.
* Cross-origin browser requests are rejected.
