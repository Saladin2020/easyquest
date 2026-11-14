"""Headless Chrome check of a PixiJS export: no console errors, quest log renders, dialogue drives quests.

  python3 scripts/check-pixi.py <pixi-export-dir> [shots-prefix]

Serves the folder on 127.0.0.1:8978, screenshots the start, presses A (auto-play the export's picks),
checks the first quest completed, screenshots the final quest log and prints the quest log + state.
The optional local ./pixi.min.js 404 is ignored (the page falls back to the CDN build).
"""
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

DIR = sys.argv[1]
PREFIX = sys.argv[2] if len(sys.argv) > 2 else "/tmp/eq-pixi"
PORT = 8978
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"), args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await b.new_page(viewport={"width": 1500, "height": 960})
        errs = []
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("requestfailed", lambda r: errs.append(f"requestfailed: {r.url}"))
        await pg.goto(f"http://127.0.0.1:{PORT}/index.html")
        await pg.wait_for_function("window.__ready === true", timeout=30000)
        await pg.wait_for_timeout(400)
        await pg.locator("canvas").screenshot(path=f"{PREFIX}-start.png")
        await pg.keyboard.press("a")
        await pg.wait_for_function("window.__eq.ended === true", timeout=10000)
        await pg.wait_for_timeout(400)
        await pg.locator("canvas").screenshot(path=f"{PREFIX}-end.png")
        state = await pg.evaluate("window.__eq.state()")
        log = await pg.evaluate("window.__eq.manager.log")
        real = [e for e in errs if "GL Driver Message" not in e and "pixi.min.js" not in e and "404 (File not found)" not in e]
        first = next(iter(state["quests"]))
        ok = state["quests"][first]["status"] == "completed" and not real
        print(json.dumps({"ok": ok, "quests": {k: v["status"] for k, v in state["quests"].items()}, "vars": state["vars"], "items": state["items"], "log": log, "errors": real, "ignored": len(errs) - len(real)}, ensure_ascii=False, indent=1))
        await b.close()
        if not ok:
            sys.exit(1)


try:
    asyncio.run(main())
finally:
    srv.terminate()
