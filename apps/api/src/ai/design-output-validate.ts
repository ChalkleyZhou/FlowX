import type {
  DemoArtifact,
  DemoPage,
  DesignPhaseOutput,
  DesignSpec,
  DesignSurfaceInput,
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

function assertSurfaces(raw: unknown): DesignSurfaceInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('DESIGN_OUTPUT_INVALID: Missing required non-empty array "surfaces".');
  }

  return raw.map((item, surfaceIndex) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`DESIGN_OUTPUT_INVALID: surfaces[${surfaceIndex}] must be an object.`);
    }
    const surface = item as Record<string, unknown>;
    const id = typeof surface.id === 'string' ? surface.id.trim() : '';
    if (!id) {
      throw new Error(`DESIGN_OUTPUT_INVALID: surfaces[${surfaceIndex}].id must be a non-empty string.`);
    }
    if (!Array.isArray(surface.pages) || surface.pages.length === 0) {
      throw new Error(
        `DESIGN_OUTPUT_INVALID: surfaces[${surfaceIndex}].pages must be a non-empty array.`,
      );
    }
    const pages = surface.pages.map((pageItem, pageIndex) => {
      if (!pageItem || typeof pageItem !== 'object' || Array.isArray(pageItem)) {
        throw new Error(
          `DESIGN_OUTPUT_INVALID: surfaces[${surfaceIndex}].pages[${pageIndex}] must be an object.`,
        );
      }
      const page = pageItem as Record<string, unknown>;
      const pageId = typeof page.id === 'string' ? page.id.trim() : '';
      if (!pageId) {
        throw new Error(
          `DESIGN_OUTPUT_INVALID: surfaces[${surfaceIndex}].pages[${pageIndex}].id must be a non-empty string.`,
        );
      }
      if (typeof page.html !== 'string' || page.html.trim().length === 0) {
        throw new Error(
          `DESIGN_OUTPUT_INVALID: surfaces[${surfaceIndex}].pages[${pageIndex}].html must be a non-empty HTML document string.`,
        );
      }
      const title = typeof page.title === 'string' && page.title.trim() ? page.title.trim() : undefined;
      return { id: pageId, title, html: page.html };
    });
    return { id, pages };
  });
}

/**
 * Validates the design phase executor JSON.
 * Requires design + demo + non-empty surfaces[]; demoPages are optional in this phase.
 */
export function assertDesignSpecOutput(raw: unknown): DesignPhaseOutput {
  const candidate = asObject(raw, '"design", "demo", and "surfaces"');

  if (candidate.designArtifact && !candidate.surfaces) {
    throw new Error(
      'DESIGN_OUTPUT_INVALID: designArtifact is removed; submit surfaces[{ id, pages[{ id, html }] }] instead.',
    );
  }

  const { design, demo } = validateDesignAndDemo(candidate);
  const surfaces = assertSurfaces(candidate.surfaces);

  const demoPages =
    Array.isArray(candidate.demoPages) && candidate.demoPages.length > 0
      ? (candidate.demoPages as DemoPage[])
      : undefined;

  return { design, demo, surfaces, demoPages };
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

  return {
    design,
    demo,
    demoPages: candidate.demoPages as DemoPage[],
  };
}
