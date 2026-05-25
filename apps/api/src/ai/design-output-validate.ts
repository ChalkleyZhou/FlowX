import type { DemoArtifact, DemoPage, DesignSpec, GenerateDesignOutput } from '../common/types';

/** Validates executor JSON for generateDesign (workflow + ideation). Legacy DB rows may omit demo — use extract helpers separately. */
export function assertStrictGenerateDesignOutput(raw: unknown): GenerateDesignOutput {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    const kind =
      raw === null ? 'null' : raw === undefined ? 'undefined' : Array.isArray(raw) ? 'array' : typeof raw;
    throw new Error(
      `DESIGN_OUTPUT_INVALID: Expected a single JSON object with "design", "demo", and non-empty "demoPages", got ${kind}. If using Cursor, ensure the agent returns JSON in the tool envelope (not raw prose).`,
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (!candidate.design || typeof candidate.design !== 'object' || Array.isArray(candidate.design)) {
    throw new Error('DESIGN_OUTPUT_INVALID: Missing required top-level object "design".');
  }

  const design = candidate.design as DesignSpec;
  if (typeof design.overview !== 'string' || design.overview.trim().length === 0) {
    throw new Error('DESIGN_OUTPUT_INVALID: design.overview must be a non-empty string.');
  }

  if (!Array.isArray(design.pages) || design.pages.length < 1) {
    throw new Error('DESIGN_OUTPUT_INVALID: design.pages must contain at least one page.');
  }

  if (typeof design.demoScenario !== 'string' || design.demoScenario.trim().length === 0) {
    throw new Error('DESIGN_OUTPUT_INVALID: design.demoScenario must be a non-empty string.');
  }

  if (typeof design.designRationale !== 'string' || design.designRationale.trim().length === 0) {
    throw new Error('DESIGN_OUTPUT_INVALID: design.designRationale must be a non-empty string.');
  }

  if (!candidate.demo || typeof candidate.demo !== 'object' || Array.isArray(candidate.demo)) {
    throw new Error('DESIGN_OUTPUT_INVALID: Missing required top-level object "demo".');
  }

  const demo = candidate.demo as DemoArtifact;
  if (typeof demo.summary !== 'string' || demo.summary.trim().length === 0) {
    throw new Error('DESIGN_OUTPUT_INVALID: demo.summary must be a non-empty string.');
  }

  if (!Array.isArray(candidate.demoPages) || candidate.demoPages.length < 2) {
    throw new Error(
      'DESIGN_OUTPUT_INVALID: demoPages must include at least an entry hub page and one scenario page (minimum 2 items).',
    );
  }

  return {
    design,
    demo,
    demoPages: candidate.demoPages as DemoPage[],
  };
}
