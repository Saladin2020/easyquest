# Credits

## Fonts

* **Kanit** (Regular, Medium): Copyright 2020 The Kanit Project Authors (https://github.com/cadsondemak/kanit).
  Licensed under the SIL Open Font License 1.1 (see `assets/fonts/OFL.txt`). It is bundled unmodified in
  `assets/fonts/` and copied into the Pixi and Godot exports.

## Art made for Easy Quest (CC0 1.0)

* The quest-log panels, plate and portrait well for the `teak`, `lantern`, `paper` and `night` styles are
  drawn procedurally in `src/shared/frames.ts`, shared with Easy Dialogue.
* The 16px item icons (sticky rice, morning glory, balm, mango, kanom chan, nam pan, coin, heart, bag,
  scroll) and the 10px quest-state icons are drawn in `src/shared/icons.ts`.
* The app icons come from `scripts/write-icons.mjs`.

These are dedicated to the public domain under CC0 1.0. Use them in any project; no attribution is required.

## Sample content

* **Thai town cast** (`samples/portraits/town_*`): the Easy Dialogue sample portraits, cropped from
  [Easy Sprite](https://github.com/Saladin2020/easysprite) sheets. They carry the same licence as Easy
  Sprite's parts.
* **Background** (`samples/backgrounds/thai_village_topdown.png`): rendered from Easy Tilemap's
  `thai_village_topdown` demo map.
* **Dialogue** `samples/dialogues/village_delivery.ezd` (and its compiled JSON): the Easy Dialogue demo
  script, MIT.
* **Demo quests** `samples/quests/village_delivery.ezq`: MIT, like the code.

## Runtimes

* `runtime/pixi/easydialogue-runner.js` and `runtime/godot/dialogue_runner.gd` are vendored from
  [Easy Dialogue](https://github.com/Saladin2020/easydialogue) (MIT, same author). Re-copy them when the
  upstream runner changes.
* PixiJS v8 is **not** bundled. The exported `index.html` loads `./pixi.min.js` if you drop it next to the
  file; otherwise it loads the jsDelivr CDN build (`pixi.js@8`, MIT).
