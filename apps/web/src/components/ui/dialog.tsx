import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-foreground/40 backdrop-blur-[1px]', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const SLOT_CONTAINERS = new Set(['form', 'fieldset', 'div', 'section', 'article', 'label']);

type SlotContext = {
  header: React.ReactNode[];
  footer: React.ReactNode[];
  formId?: string;
  disabled: boolean;
  allocateId: () => string;
};

function isDialogSlot(node: React.ReactNode, name: string): node is React.ReactElement<{ children?: React.ReactNode }> {
  if (!React.isValidElement(node)) return false;
  const type = node.type as { displayName?: string };
  return type.displayName === name;
}

function stampFooterControl(node: React.ReactNode, ctx: SlotContext): React.ReactNode {
  if (!React.isValidElement(node)) return node;
  const props = node.props as { type?: string; form?: string; disabled?: boolean };
  const next: { form?: string; disabled?: boolean } = {};
  if (ctx.formId && props.type === 'submit' && props.form == null) next.form = ctx.formId;
  const isAction = node.type === 'button' || props.type === 'submit' || props.type === 'button';
  if (ctx.disabled && props.disabled == null && isAction) next.disabled = true;
  if (next.form == null && next.disabled == null) return node;
  return React.cloneElement(node, next);
}

function stampFooter(node: React.ReactElement<{ children?: React.ReactNode }>, ctx: SlotContext) {
  if (!ctx.formId && !ctx.disabled) return node;
  return React.cloneElement(
    node,
    undefined,
    React.Children.map(node.props.children, (child) => stampFooterControl(child, ctx)),
  );
}

/** 把任意层级里的标题和底部操作从滚动内容中拆出，提交按钮仍关联原来的 form。 */
function extractDialogSlots(nodes: React.ReactNode, ctx: SlotContext): React.ReactNode[] {
  const body: React.ReactNode[] = [];
  for (const node of React.Children.toArray(nodes)) {
    if (isDialogSlot(node, 'DialogHeader')) {
      ctx.header.push(node);
      continue;
    }
    if (isDialogSlot(node, 'DialogFooter')) {
      ctx.footer.push(stampFooter(node, ctx));
      continue;
    }
    if (React.isValidElement(node) && typeof node.type === 'string' && SLOT_CONTAINERS.has(node.type)) {
      const props = node.props as { children?: React.ReactNode; id?: string; disabled?: boolean };
      const next: SlotContext = { ...ctx };
      const extra: { id?: string } = {};
      if (node.type === 'form') {
        const id = props.id ?? ctx.allocateId();
        if (!props.id) extra.id = id;
        next.formId = id;
      }
      if (node.type === 'fieldset' && props.disabled) next.disabled = true;
      const sizeBefore = ctx.header.length + ctx.footer.length;
      const inner = extractDialogSlots(props.children, next);
      const changed = ctx.header.length + ctx.footer.length !== sizeBefore;
      body.push(changed ? React.cloneElement(node, extra, inner) : node);
      continue;
    }
    body.push(node);
  }
  return body;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const reactId = React.useId();
  const [bodyElement, setBodyElement] = React.useState<HTMLDivElement | null>(null);
  const [scrolls, setScrolls] = React.useState(false);
  let formSequence = 0;
  const slots: SlotContext = {
    header: [],
    footer: [],
    disabled: false,
    allocateId: () => `${reactId}-form-${++formSequence}`,
  };
  const body = extractDialogSlots(children, slots);
  const hasHeader = slots.header.length > 0;
  const hasFooter = slots.footer.length > 0;
  const hasBody = body.length > 0;
  const setBodyNode = React.useCallback((node: HTMLDivElement | null) => {
    setBodyElement(node);
  }, []);

  React.useLayoutEffect(() => {
    if (!bodyElement) return;
    const measure = () => {
      const content = bodyElement.firstElementChild;
      const contentHeight = content instanceof HTMLElement ? content.offsetHeight : 0;
      const next = contentHeight > bodyElement.clientHeight + 1;
      setScrolls((current) => (current === next ? current : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(bodyElement);
    if (bodyElement.firstElementChild) observer.observe(bodyElement.firstElementChild);
    return () => observer.disconnect();
  }, [bodyElement]);

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[50%] z-50 flex w-full max-h-[min(90vh,calc(100dvh-2rem))] max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col rounded-lg border bg-background shadow-lg duration-200',
          className,
          scrolls ? 'overflow-hidden' : 'overflow-visible',
        )}
        {...props}
      >
        {hasHeader ? (
          <div data-dialog-section="header" className={cn('shrink-0 px-6 pr-12 pt-6', !hasBody && 'pb-4')}>
            {slots.header}
          </div>
        ) : null}
        {hasBody ? (
          <div
            ref={setBodyNode}
            data-dialog-section="body"
            className={cn('min-h-0', scrolls ? 'overflow-y-auto' : 'overflow-visible')}
          >
            <div
              className={cn(
                'flex flex-col gap-4 px-6',
                hasHeader ? 'pt-4' : 'pr-12 pt-6',
                hasFooter ? 'pb-4' : 'pb-6',
              )}
            >
              {body}
            </div>
          </div>
        ) : null}
        {hasFooter ? (
          <div data-dialog-section="footer" className="shrink-0 border-t border-border bg-background px-6 py-4">
            {slots.footer}
          </div>
        ) : null}
        <DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-sm opacity-70 transition-opacity hover:opacity-100">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
