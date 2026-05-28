import { rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUG_SCREENSHOT_ROOT,
  MAX_BUG_SCREENSHOT_BYTES,
  normalizeScreenshotBase64,
  parseBugScreenshots,
  persistBugScreenshots,
  readBugScreenshotFile,
  validateScreenshotUpload,
} from './bug-screenshot.storage';

const bugId = 'bug_test_storage';

afterEach(async () => {
  await rm(join(BUG_SCREENSHOT_ROOT, bugId), { recursive: true, force: true });
});

describe('bug-screenshot.storage', () => {
  it('normalizes data URL base64 payloads', () => {
    expect(normalizeScreenshotBase64('data:image/png;base64,abc123')).toBe('abc123');
    expect(normalizeScreenshotBase64('abc123')).toBe('abc123');
  });

  it('parses stored screenshot metadata', () => {
    const parsed = parseBugScreenshots([
      {
        id: 'shot-1',
        fileName: 'error.png',
        contentType: 'image/png',
        sizeBytes: 12,
        createdAt: '2026-05-27T00:00:00.000Z',
      },
      { id: 'invalid' },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.fileName).toBe('error.png');
  });

  it('rejects oversized uploads', () => {
    const oversized = Buffer.alloc(MAX_BUG_SCREENSHOT_BYTES + 1).toString('base64');
    expect(() =>
      validateScreenshotUpload({
        fileName: 'big.png',
        contentType: 'image/png',
        dataBase64: oversized,
      }),
    ).toThrow(/不能超过/);
  });

  it('persists and reads screenshot files', async () => {
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const records = await persistBugScreenshots(bugId, [
      {
        fileName: 'pixel.png',
        contentType: 'image/png',
        dataBase64: pngBytes.toString('base64'),
      },
    ]);

    expect(records).toHaveLength(1);
    const file = await readBugScreenshotFile(bugId, records[0]!.id, records);
    expect(file.contentType).toBe('image/png');
    expect(file.buffer.equals(pngBytes)).toBe(true);
  });
});
