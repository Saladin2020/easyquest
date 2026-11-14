"""Headless Chrome screenshot of the web editor (README image) + console error check.

  python3 scripts/capture-ui.py [url] [out.png]

Needs Playwright for Python and Chrome (CHROME_PATH or /usr/bin/google-chrome).
Plays the sample with picks 0,0, selects the finished delivery quest, and saves the page.
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8818/"
OUT = sys.argv[2] if len(sys.argv) > 2 else "docs/assets/ui-editor.png"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"))
        pg = await b.new_page(viewport={"width": 1640, "height": 1180}, device_scale_factor=1)
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(URL)
        await pg.evaluate("localStorage.clear()")
        await pg.reload()
        await pg.wait_for_selector(".qgraph")
        await pg.click("text=play village_delivery 0,0")
        await pg.wait_for_selector(".qchip.qs-completed")
        await pg.click(".qchip.qs-completed >> nth=0")
        await pg.evaluate("window.scrollTo(0, 0)")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=OUT)
        print("saved", OUT)
        print("console errors:", errs)
        await b.close()
        if errs:
            sys.exit(1)


asyncio.run(main())
