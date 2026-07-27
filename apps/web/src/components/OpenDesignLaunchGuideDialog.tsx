import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';

type OpenDesignLaunchGuideDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
};

export function OpenDesignLaunchGuideDialog({
  open,
  onOpenChange,
  onConfirm,
  confirmDisabled = false,
}: OpenDesignLaunchGuideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>如何在 OpenDesign 中获取 FlowX 任务</DialogTitle>
          <DialogDescription>按下面两步操作，再继续打开 OpenDesign</DialogDescription>
        </DialogHeader>

        <ol className="space-y-5 text-sm text-foreground">
          <li className="space-y-2">
            <p className="font-medium">1. 选择项目目录（根据实际情况按需选择）</p>
            <img
              src="/open-design-guide-step1.png"
              alt="OpenDesign 中选择项目目录"
              className="w-full rounded-md border border-border"
            />
          </li>
          <li className="space-y-2">
            <p className="font-medium">2. 输入“获取FlowX任务”并发送</p>
            <img
              src="/open-design-guide-step2.png"
              alt="OpenDesign 中输入获取FlowX任务并发送"
              className="w-full rounded-md border border-border"
            />
          </li>
        </ol>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={confirmDisabled} onClick={onConfirm}>
            继续打开 OpenDesign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
