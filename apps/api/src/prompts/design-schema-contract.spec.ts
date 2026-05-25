import { describe, expect, it } from 'vitest';
import designSchema from '../ai/design-generation.output.schema.json';
import {
  getDesignJsonSchemaContractBlock,
  getDesignJsonSchemaSummaryContractBlock,
} from './design-schema-contract';

describe('getDesignJsonSchemaContractBlock', () => {
  it('embeds the same schema as design-generation.output.schema.json', () => {
    const block = getDesignJsonSchemaContractBlock();
    const lastLine = block.split('\n').pop() ?? '';
    expect(JSON.parse(lastLine)).toEqual(designSchema);
    expect(lastLine).toContain('"required":["design","demo","demoPages"]');
    expect(lastLine).toContain('"minItems":2');
  });
});

describe('getDesignJsonSchemaSummaryContractBlock', () => {
  it('stays compact (Cursor prompt) and forbids ellipsis placeholders', () => {
    const block = getDesignJsonSchemaSummaryContractBlock();
    expect(block.length).toBeLessThan(1400);
    expect(block).toContain('demoPages');
    expect(block).toContain('省略');
    expect(block).not.toContain('"properties"');
  });
});
