import { randomUUID } from 'crypto';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { extname, join } from 'path';

export const BUG_SCREENSHOT_ROOT = join(process.cwd(), '.flowx-data', 'bug-screenshots');
export const MAX_BUG_SCREENSHOTS = 8;
export const MAX_BUG_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]);

export interface BugScreenshotRecord {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BugScreenshotUploadInput {
  fileName: string;
  contentType: string;
  dataBase64: string;
}

export function parseBugScreenshots(value: unknown): BugScreenshotRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const record = item as Partial<BugScreenshotRecord>;
    if (
      typeof record.id !== 'string' ||
      typeof record.fileName !== 'string' ||
      typeof record.contentType !== 'string' ||
      typeof record.sizeBytes !== 'number' ||
      typeof record.createdAt !== 'string'
    ) {
      return [];
    }
    return [record as BugScreenshotRecord];
  });
}

export function normalizeScreenshotBase64(value: string): string {
  const trimmed = value.trim();
  const commaIndex = trimmed.indexOf(',');
  if (trimmed.startsWith('data:') && commaIndex >= 0) {
    return trimmed.slice(commaIndex + 1);
  }
  return trimmed;
}

function resolveExtension(fileName: string, contentType: string): string {
  const fromName = extname(fileName).toLowerCase();
  if (fromName) {
    return fromName;
  }

  switch (contentType) {
    case 'image/png':
      return '.png';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'image/jpeg':
    case 'image/jpg':
    default:
      return '.jpg';
  }
}

function screenshotDirectory(bugId: string) {
  return join(BUG_SCREENSHOT_ROOT, bugId);
}

function screenshotFilePath(bugId: string, screenshotId: string, extension: string) {
  return join(screenshotDirectory(bugId), `${screenshotId}${extension}`);
}

export function validateScreenshotUpload(
  upload: BugScreenshotUploadInput,
  options?: { existingCount?: number },
): Buffer {
  const existingCount = options?.existingCount ?? 0;
  if (existingCount >= MAX_BUG_SCREENSHOTS) {
    throw new Error(`最多只能上传 ${MAX_BUG_SCREENSHOTS} 张截图。`);
  }

  const contentType = upload.contentType.trim().toLowerCase();
  if (!ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES.has(contentType)) {
    throw new Error('仅支持 PNG、JPEG、GIF、WebP 图片。');
  }

  const fileName = upload.fileName.trim();
  if (!fileName) {
    throw new Error('截图文件名不能为空。');
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(normalizeScreenshotBase64(upload.dataBase64), 'base64');
  } catch {
    throw new Error('截图内容无效，请重新选择图片。');
  }

  if (buffer.length === 0) {
    throw new Error('截图内容为空。');
  }
  if (buffer.length > MAX_BUG_SCREENSHOT_BYTES) {
    throw new Error(`单张截图不能超过 ${Math.floor(MAX_BUG_SCREENSHOT_BYTES / (1024 * 1024))}MB。`);
  }

  return buffer;
}

export async function persistBugScreenshots(
  bugId: string,
  uploads: BugScreenshotUploadInput[],
  existingRecords: BugScreenshotRecord[] = [],
): Promise<BugScreenshotRecord[]> {
  if (uploads.length === 0) {
    return [];
  }

  if (existingRecords.length + uploads.length > MAX_BUG_SCREENSHOTS) {
    throw new Error(`最多只能上传 ${MAX_BUG_SCREENSHOTS} 张截图。`);
  }

  await mkdir(screenshotDirectory(bugId), { recursive: true });
  const createdRecords: BugScreenshotRecord[] = [];

  for (const upload of uploads) {
    const buffer = validateScreenshotUpload(upload, {
      existingCount: existingRecords.length + createdRecords.length,
    });
    const screenshotId = randomUUID();
    const extension = resolveExtension(upload.fileName, upload.contentType.trim().toLowerCase());
    const absolutePath = screenshotFilePath(bugId, screenshotId, extension);
    await writeFile(absolutePath, buffer);
    createdRecords.push({
      id: screenshotId,
      fileName: upload.fileName.trim(),
      contentType: upload.contentType.trim().toLowerCase(),
      sizeBytes: buffer.length,
      createdAt: new Date().toISOString(),
    });
  }

  return createdRecords;
}

export async function readBugScreenshotFile(
  bugId: string,
  screenshotId: string,
  records: BugScreenshotRecord[],
): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  const record = records.find((item) => item.id === screenshotId);
  if (!record) {
    throw new Error('Screenshot not found.');
  }

  const directory = screenshotDirectory(bugId);
  const candidates = [
    screenshotFilePath(bugId, screenshotId, resolveExtension(record.fileName, record.contentType)),
    ...['.png', '.jpg', '.jpeg', '.gif', '.webp'].map((extension) =>
      join(directory, `${screenshotId}${extension}`),
    ),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      const buffer = await readFile(candidate);
      return {
        buffer,
        contentType: record.contentType,
        fileName: record.fileName,
      };
    } catch {
      // try next candidate
    }
  }

  throw new Error('Screenshot file missing.');
}
