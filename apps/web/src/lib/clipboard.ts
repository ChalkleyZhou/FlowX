export async function copyToClipboard(text: string): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('Clipboard is unavailable.');
  }

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for browsers that expose clipboard API but reject writes.
    }
  }

  copyWithExecCommand(text);
}

function copyWithExecCommand(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    const copied = document.execCommand('copy');
    if (!copied) {
      throw new Error('Copy command was rejected.');
    }
  } finally {
    document.body.removeChild(textarea);
  }
}
