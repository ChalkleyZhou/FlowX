import { useEffect, useState, type ChangeEvent } from 'react';
import { Download } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useToast } from '../../components/ui/toast';
import type { TestCaseLibrary } from '../../types';
import {
  downloadTestCaseImportTemplate,
  parseTestCaseImportCsv,
  type TestCaseImportPreview,
} from '../../utils/test-case-import';
import { Field } from './quality-ui';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function QualityCaseImportDialog({
  open,
  onOpenChange,
  libraries,
  defaultLibraryId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraries: TestCaseLibrary[];
  defaultLibraryId?: string;
  onImported: () => Promise<void>;
}) {
  const toast = useToast();
  const [libraryId, setLibraryId] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileInputKey, setFileInputKey] = useState(0);
  const [preview, setPreview] = useState<TestCaseImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initialLibraryId = libraries.some((item) => item.id === defaultLibraryId)
      ? defaultLibraryId!
      : libraries[0]?.id ?? '';
    setLibraryId(initialLibraryId);
    setFileName('');
    setPreview(null);
    setFileInputKey((current) => current + 1);
  }, [defaultLibraryId, libraries, open]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setFileName(file?.name ?? '');
    setPreview(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setPreview({ rows: [], sourceRowCount: 0, errors: [{ row: 1, message: '仅支持 CSV 文件' }] });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setPreview({ rows: [], sourceRowCount: 0, errors: [{ row: 1, message: '文件不能超过 5 MB' }] });
      return;
    }

    setParsing(true);
    try {
      setPreview(parseTestCaseImportCsv(await file.text()));
    } catch {
      setPreview({ rows: [], sourceRowCount: 0, errors: [{ row: 1, message: '无法读取该文件' }] });
    } finally {
      setParsing(false);
    }
  }

  async function submit() {
    if (!libraryId || !preview || preview.errors.length || !preview.rows.length) return;
    setImporting(true);
    try {
      const result = await api.importTestCases(libraryId, preview.rows);
      toast.success(`已导入 ${result.imported} 条测试用例`);
      await onImported();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '批量导入失败');
    } finally {
      setImporting(false);
    }
  }

  function changeOpen(nextOpen: boolean) {
    if (!importing) onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>批量导入用例</DialogTitle>
          <DialogDescription>选择目标用例库并上传填写完成的 CSV 模板。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <Field label="目标用例库">
            <Select value={libraryId} onValueChange={setLibraryId} disabled={importing}>
              <SelectTrigger aria-label="目标用例库"><SelectValue placeholder="选择用例库" /></SelectTrigger>
              <SelectContent>
                {libraries.map((library) => (
                  <SelectItem key={library.id} value={library.id}>{library.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="CSV 文件">
            <Input
              key={fileInputKey}
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              aria-label="选择 CSV 文件"
              onChange={(event) => void handleFileChange(event)}
            />
          </Field>

          {parsing ? (
            <div className="rounded-md border border-border bg-surface-subtle px-4 py-3 text-sm text-muted-foreground">
              正在校验文件...
            </div>
          ) : null}

          {preview?.errors.length ? (
            <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              <p className="font-medium">校验未通过，共 {preview.errors.length} 项</p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs leading-5">
                {preview.errors.slice(0, 20).map((error, index) => (
                  <li key={`${error.row}-${index}`}>第 {error.row} 行：{error.message}</li>
                ))}
                {preview.errors.length > 20 ? <li>其余 {preview.errors.length - 20} 项请修正后重新上传</li> : null}
              </ul>
            </div>
          ) : null}

          {preview && !preview.errors.length ? (
            <div className="rounded-md border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
              校验通过，共 {preview.sourceRowCount} 条用例
            </div>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between sm:space-x-0">
          <Button type="button" variant="ghost" onClick={downloadTestCaseImportTemplate}>
            <Download aria-hidden="true" className="h-4 w-4" />下载模板
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={importing} onClick={() => changeOpen(false)}>取消</Button>
            <Button
              type="button"
              disabled={importing || parsing || !libraryId || !preview?.rows.length || Boolean(preview.errors.length)}
              onClick={() => void submit()}
            >
              {importing ? '导入中...' : fileName ? `导入 ${preview?.rows.length ?? 0} 条` : '开始导入'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
