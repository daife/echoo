import { fogHarborLettersFixture } from "@echoo/shared";
import type { PrimeWorldDetail } from "@echoo/shared";

/**
 * A complete, runnable story world is a more useful starting point than an
 * empty graph. Authors can play it immediately, then replace one part at a
 * time while learning how triggers, history, LLM output and views fit together.
 */
const createDefaultPrimeWorld = (): PrimeWorldDetail => {
  const detail = structuredClone(fogHarborLettersFixture);
  detail.definitionRevision = 0;
  detail.workflow.editor.positions = {
    start: { x: 40, y: 20 },
    opening: { x: 300, y: 20 },

    "text-input": { x: 40, y: 210 },
    "choice-input": { x: 40, y: 340 },
    action: { x: 300, y: 270 },
    "action-text": { x: 560, y: 190 },
    "append-user": { x: 560, y: 350 },
    history: { x: 820, y: 350 },
    messages: { x: 1080, y: 350 },
    llm: { x: 1340, y: 350 },

    "pick-patch": { x: 1600, y: 70 },
    "patch-state": { x: 1860, y: 70 },
    "pick-narrative": { x: 1600, y: 260 },
    "narrative-patch": { x: 1860, y: 260 },
    "show-narrative": { x: 2120, y: 260 },
    "pick-choices": { x: 1600, y: 460 },
    "show-choices": { x: 2380, y: 350 },
    "append-narrator": { x: 2640, y: 350 },

    "needs-summary": { x: 2900, y: 350 },
    summarize: { x: 3160, y: 280 },
    "save-summary": { x: 3420, y: 280 },
    "summary-failed": { x: 3420, y: 440 },
    "output-invalid": { x: 1600, y: 620 },
    "model-failed": { x: 1860, y: 620 },
  };
  return detail;
};

export const DEFAULT_PRIME_WORLD_DETAIL = createDefaultPrimeWorld();
