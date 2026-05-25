import { describe, expect, it } from 'vitest';
import brainstormSchema from '../ai/brainstorm.output.schema.json';
import { getBrainstormJsonSchemaContractBlock } from './brainstorm-schema-contract';

describe('getBrainstormJsonSchemaContractBlock', () => {
  it('embeds the same schema object as brainstorm.output.schema.json (single source of truth)', () => {
    const block = getBrainstormJsonSchemaContractBlock();
    const lastLine = block.split('\n').pop() ?? '';
    expect(JSON.parse(lastLine)).toEqual(brainstormSchema);
    expect(lastLine).toContain('"title":"BrainstormOutput"');
    expect(lastLine).toContain('"minItems":3');
  });
});
