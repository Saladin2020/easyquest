/** Re-export of the shipped JS runtime so the CLI, API, web editor, tests and exports share one implementation. */
export * from "../../runtime/pixi/easyquest-manager.js";
export type { QuestState, QuestSignal, SimInput, DialogueRunnerLike } from "../../runtime/pixi/easyquest-manager.js";
