// Types for the vendored Easy Dialogue runner (https://github.com/Saladin2020/easydialogue, MIT).
export declare function graphemes(text: string): string[];
export declare function wordSegments(text: string, lang?: string): string[];
export declare function wrapText(text: string, maxWidth: number, measure: (s: string) => number, lang?: string): string[];
export declare function formatValue(v: unknown): string;
export declare class DialogueRunner {
  constructor(doc: any, opts?: { variables?: Record<string, unknown>; disabledChoices?: "hide" | "grey"; onEvent?: (name: string, args: string[], runner: DialogueRunner) => void });
  doc: any;
  vars: Record<string, any>;
  node: string | null;
  ended: boolean;
  onEvent: ((name: string, args: string[], runner: DialogueRunner) => void) | null;
  start(node?: string): this;
  next(): { type: string; [k: string]: any };
  choose(index: number): unknown;
}
export declare function autoplay(doc: any, picks?: number[], opts?: { variables?: Record<string, unknown>; node?: string }): { transcript: string[]; vars: Record<string, any>; events: string[] };
