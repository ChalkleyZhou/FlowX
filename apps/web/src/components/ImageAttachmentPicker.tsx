import { useId, useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Button as UiButton } from './ui/button';
import {
  MAX_IMAGE_ATTACHMENTS,
  type PendingImageAttachment,
  buildImageAttachmentsFromFiles,
} from '../utils/image-attachments';

interface ImageAttachmentPickerProps {
  attachments: PendingImageAttachment[];
  onChange: (attachments: PendingImageAttachment[]) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  existingCount?: number;
  label?: string;
  description?: string;
}

export function ImageAttachmentPicker({
  attachments,
  onChange,
  onError,
  disabled = false,
  existingCount = 0,
  label = '截图',
  description = '支持选择或粘贴图片，最多 8 张，每张不超过 5MB。',
}: ImageAttachmentPickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const totalCount = existingCount + attachments.length;
  const reachedLimit = totalCount >= MAX_IMAGE_ATTACHMENTS;

  async function appendFiles(files: File[]) {
    if (files.length === 0 || disabled) {
      return;
    }

    try {
      const nextAttachments = await buildImageAttachmentsFromFiles(files, totalCount);
      onChange([...attachments, ...nextAttachments]);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '添加图片失败');
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    await appendFiles(files);
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }

    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null);

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    await appendFiles(imageFiles);
  }

  function removeAttachment(attachmentId: string) {
    onChange(attachments.filter((attachment) => attachment.id !== attachmentId));
  }

  return (
    <div className="flex flex-col gap-2" onPaste={(event) => void handlePaste(event)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <label className="text-sm font-semibold text-foreground" htmlFor={inputId}>
            {label}
          </label>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <UiButton
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || reachedLimit}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus className="h-4 w-4" />
          添加图片
        </UiButton>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        disabled={disabled || reachedLimit}
        onChange={(event) => void handleFileChange(event)}
      />
      {attachments.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="relative overflow-hidden rounded-xl border border-border bg-muted/30"
            >
              <img
                src={attachment.previewUrl}
                alt={attachment.fileName}
                className="h-40 w-full object-cover"
              />
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                <span className="truncate text-sm text-muted-foreground">{attachment.fileName}</span>
                <UiButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={disabled}
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`移除 ${attachment.fileName}`}
                >
                  <X className="h-4 w-4" />
                </UiButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          可点击「添加图片」，或在当前区域直接粘贴截图。
        </div>
      )}
    </div>
  );
}
