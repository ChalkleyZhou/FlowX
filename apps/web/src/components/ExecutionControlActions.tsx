import { useRef, useState } from 'react';
import { api } from '../api';
import type { ExecutionCommandType, ExecutionSessionDetail } from '../types';
import { useConfirm } from './ConfirmDialog';
import { ExecutionSessionPanel } from './ExecutionSessionPanel';

export function ExecutionControlActions({ session, onChanged, loading = false }: {
  session: ExecutionSessionDetail;
  onChanged: (newSessionId?: string) => Promise<void> | void;
  loading?: boolean;
}) {
  const confirm = useConfirm();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef<{ sessionId: string; type: ExecutionCommandType; key: string } | null>(null);

  async function command(type: ExecutionCommandType) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (!requestKey.current || requestKey.current.sessionId !== session.id || requestKey.current.type !== type) {
        requestKey.current = { sessionId: session.id, type, key: crypto.randomUUID() };
      }
      await api.requestExecutionCommand(session.id, type, requestKey.current.key);
      requestKey.current = null;
      await onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : '命令发送失败，请重试。');
    } finally { busy.current = false; setPending(false); }
  }

  async function retry() {
    if (busy.current) return;
    busy.current = true;
    const confirmed = await confirm({
      title: '重新交接本地执行',
      description: '请先在旧设备确认本任务及其启动的命令已停止。确认后会创建新执行会话，旧会话的完成报告将被拒绝。',
      confirmLabel: '旧执行已停止，重新交接',
    });
    if (!confirmed) { busy.current = false; return; }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await api.retryExecutionSession(session.id, session.sourceTool === 'cursor' ? 'cursor' : 'codex');
      await onChanged(result.executionSessionId);
    } catch (error) {
      setError(error instanceof Error ? error.message : '重新交接失败，请重试。');
    } finally { busy.current = false; setPending(false); }
  }

  return <ExecutionSessionPanel session={session} evidence={session.evidence ?? []} events={session.syncEvents ?? []}
    loading={loading} actionPending={pending} error={error} onRefresh={() => void onChanged()}
    onCommand={(type) => void command(type)} onRetry={() => void retry()} />;
}
