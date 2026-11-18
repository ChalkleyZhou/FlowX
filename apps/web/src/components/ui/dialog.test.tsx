// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';

describe('DialogContent', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
  });

  it('keeps the title and footer outside the scrolling body', () => {
    act(() => {
      root.render(
        <Dialog open>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>编辑需求</DialogTitle>
              <DialogDescription>修改需求内容</DialogDescription>
            </DialogHeader>
            <input aria-label="需求名称" />
            <DialogFooter>
              <Button type="button">取消</Button>
              <Button type="button">保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>,
      );
    });

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const header = dialog.querySelector('[data-dialog-section="header"]') as HTMLElement;
    const body = dialog.querySelector('[data-dialog-section="body"]') as HTMLElement;
    const footer = dialog.querySelector('[data-dialog-section="footer"]') as HTMLElement;

    expect(header.textContent).toContain('编辑需求');
    expect(body.querySelector('[aria-label="需求名称"]')).toBeTruthy();
    expect(header.contains(body.querySelector('[aria-label="需求名称"]'))).toBe(false);
    expect(footer.textContent).toContain('保存');
    expect(body.contains(footer)).toBe(false);
    expect(dialog.className).toContain('max-h-');
    expect(dialog.className).not.toContain('overflow-y-auto');
    expect(dialog.querySelector('.sr-only')?.textContent).toBe('Close');
  });

  it('pins a footer nested in a form and keeps submit associated with that form', () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    act(() => {
      root.render(
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>编辑需求</DialogTitle>
              <DialogDescription>修改需求内容</DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit}>
              <fieldset disabled>
                <input aria-label="需求名称" />
                <DialogFooter>
                  <Button type="button">取消</Button>
                  <Button type="submit">保存</Button>
                </DialogFooter>
              </fieldset>
            </form>
          </DialogContent>
        </Dialog>,
      );
    });

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const form = dialog.querySelector('form') as HTMLFormElement;
    const fieldset = form.querySelector('fieldset') as HTMLFieldSetElement;
    const input = dialog.querySelector('[aria-label="需求名称"]') as HTMLInputElement;
    const submit = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === '保存') as HTMLButtonElement;
    const cancel = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === '取消') as HTMLButtonElement;
    const footer = dialog.querySelector('[data-dialog-section="footer"]') as HTMLElement;

    expect(form.contains(input)).toBe(true);
    expect(fieldset.contains(input)).toBe(true);
    expect(fieldset.disabled).toBe(true);
    expect(form.contains(submit)).toBe(false);
    expect(footer.contains(submit)).toBe(true);
    expect(submit.getAttribute('form')).toBe(form.id);
    expect(submit.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);

    input.disabled = false;
    submit.disabled = false;
    act(() => {
      submit.click();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
