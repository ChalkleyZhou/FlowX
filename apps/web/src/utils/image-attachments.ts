export const MAX_IMAGE_ATTACHMENTS = 8;
export const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

export interface PendingImageAttachment {
  id: string;
  fileName: string;
  contentType: string;
  previewUrl: string;
  dataBase64: string;
}

export interface ImageAttachmentPayload {
  fileName: string;
  contentType: string;
  dataBase64: string;
}

function createAttachmentId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function stripDataUrlPrefix(value: string) {
  const trimmed = value.trim();
  const commaIndex = trimmed.indexOf(',');
  if (trimmed.startsWith('data:') && commaIndex >= 0) {
    return trimmed.slice(commaIndex + 1);
  }
  return trimmed;
}

export async function readImageAttachment(file: File): Promise<PendingImageAttachment> {
  const contentType = file.type.trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new Error('仅支持 PNG、JPEG、GIF、WebP 图片。');
  }
  if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new Error('单张图片不能超过 5MB。');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });

  return {
    id: createAttachmentId(),
    fileName: file.name,
    contentType,
    previewUrl: dataUrl,
    dataBase64: stripDataUrlPrefix(dataUrl),
  };
}

export async function buildImageAttachmentsFromFiles(
  files: File[],
  currentCount: number,
): Promise<PendingImageAttachment[]> {
  if (currentCount + files.length > MAX_IMAGE_ATTACHMENTS) {
    throw new Error(`最多只能上传 ${MAX_IMAGE_ATTACHMENTS} 张图片。`);
  }

  return Promise.all(files.map((file) => readImageAttachment(file)));
}

export function toImageAttachmentPayload(
  attachments: PendingImageAttachment[],
): ImageAttachmentPayload[] {
  return attachments.map((attachment) => ({
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    dataBase64: attachment.dataBase64,
  }));
}

export function releaseImageAttachmentPreviews(attachments: PendingImageAttachment[]) {
  for (const attachment of attachments) {
    if (attachment.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}
