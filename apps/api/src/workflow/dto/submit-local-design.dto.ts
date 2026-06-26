import { IsObject } from 'class-validator';

/**
 * Body for locally (OpenDesign MCP) generated design submitted from the IDE extension.
 * Nested shape is validated in the service via `assertDesignSpecOutput`.
 */
export class SubmitLocalDesignDto {
  @IsObject()
  design!: Record<string, unknown>;

  @IsObject()
  demo!: Record<string, unknown>;

  @IsObject()
  designArtifact!: Record<string, unknown>;
}
