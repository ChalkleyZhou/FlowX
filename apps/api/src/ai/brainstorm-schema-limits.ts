import schema from './brainstorm.output.schema.json';

type SchemaShape = {
  properties?: {
    brief?: {
      properties?: Record<string, { minItems?: number }>;
    };
  };
};

const briefProps = (schema as SchemaShape).properties?.brief?.properties;

/** Aligned with brainstorm.output.schema.json brief.properties.userStories.minItems */
export const BRAINSTORM_MIN_USER_STORIES = briefProps?.userStories?.minItems ?? 1;

/** Aligned with brainstorm.output.schema.json brief.properties.edgeCases.minItems */
export const BRAINSTORM_MIN_EDGE_CASES = briefProps?.edgeCases?.minItems ?? 0;
