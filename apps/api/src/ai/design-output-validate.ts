import type {
  DemoArtifact,
  DemoPage,
  DesignArtifactRef,
  DesignPhaseOutput,
  DesignSpec,
  GenerateDesignOutput,
} from '../common/types';

function asObject(raw: unknown, label: string): Record<string, unknown> {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    const kind =
      raw === null ? 'null' : raw === undefined ? 'undefined' : Array.isArray(raw) ? 'array' : typeof raw;
    throw new Error(
      `DESIGN_OUTPUT_INVALID: Expected a single JSON object for ${label}, got ${kind}. If using Cursor, ensure the agent returns JSON in the tool envelope (not raw prose).`,
    );
  }
  return raw as Record<string, unknown>;
}

/** Shared design + demo validation used by both the design-spec phase and the strict demo phase. */
function validateDesignAndDemo(candidate: Record<string, unknown>): { design: DesignSpec; demo: DemoArtifact } {
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

  return { design, demo };
}

/**
 * Validates the design phase (OpenDesign HTML artifact) executor JSON.
 * Requires design + demo + a non-empty designArtifact.html; demoPages are optional in this phase.
 */
export function assertDesignSpecOutput(raw: unknown): DesignPhaseOutput {
  const candidate = asObject(raw, '"design", "demo", and "designArtifact"');
  const { design, demo } = validateDesignAndDemo(candidate);

  if (
    !candidate.designArtifact ||
    typeof candidate.designArtifact !== 'object' ||
    Array.isArray(candidate.designArtifact)
  ) {
    throw new Error('DESIGN_OUTPUT_INVALID: Missing required top-level object "designArtifact".');
  }

  const artifact = candidate.designArtifact as DesignArtifactRef;
  if (typeof artifact.html !== 'string' || artifact.html.trim().length === 0) {
    throw new Error(
      'DESIGN_OUTPUT_INVALID: designArtifact.html must be a non-empty single-page HTML document string.',
    );
  }

  const demoPages =
    Array.isArray(candidate.demoPages) && candidate.demoPages.length > 0
      ? (candidate.demoPages as DemoPage[])
      : undefined;

  return { design, demo, designArtifact: artifact, demoPages };
}

/** Validates executor JSON for generateDesign (workflow + ideation). Legacy DB rows may omit demo — use extract helpers separately. */
export function assertStrictGenerateDesignOutput(raw: unknown): GenerateDesignOutput {
  const candidate = asObject(raw, '"design", "demo", and non-empty "demoPages"');
  const { design, demo } = validateDesignAndDemo(candidate);

  if (!Array.isArray(candidate.demoPages) || candidate.demoPages.length < 2) {
    throw new Error(
      'DESIGN_OUTPUT_INVALID: demoPages must include at least an entry hub page and one scenario page (minimum 2 items).',
    );
  }

  const designArtifact =
    candidate.designArtifact && typeof candidate.designArtifact === 'object' && !Array.isArray(candidate.designArtifact)
      ? (candidate.designArtifact as DesignArtifactRef)
      : undefined;

  return {
    design,
    demo,
    demoPages: candidate.demoPages as DemoPage[],
    ...(designArtifact ? { designArtifact } : {}),
  };
}
