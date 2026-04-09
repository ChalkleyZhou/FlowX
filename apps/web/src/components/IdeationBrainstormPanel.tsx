import { useState } from 'react';
import { api } from '../api';
import type { IdeationSession } from '../types';

interface BrainstormBrief {
  expandedDescription: string;
  userStories: Array<{ role: string; action: string; benefit: string }>;
  edgeCases: string[];
  successMetrics: string[];
  openQuestions: string[];
  assumptions: string[];
  outOfScope: string[];
}

interface Props {
  requirementId: string;
  ideationStatus: string;
  sessions: IdeationSession[];
  onUpdated: () => void;
}

export function IdeationBrainstormPanel({ requirementId, ideationStatus, sessions, onUpdated }: Props) {
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  const brainstormSessions = sessions.filter((s) => s.stage === 'BRAINSTORM');
  const latestSession = brainstormSessions[brainstormSessions.length - 1];
  const isRunning = latestSession?.status === 'RUNNING';
  const isWaitingConfirmation = latestSession?.status === 'WAITING_CONFIRMATION';
  const canStart = ideationStatus === 'NONE';
  const canRevise = ideationStatus === 'BRAINSTORM_WAITING_CONFIRMATION';
  const isConfirmed = ideationStatus === 'BRAINSTORM_CONFIRMED' || ideationStatus === 'DESIGN_PENDING' || ideationStatus === 'DESIGN_WAITING_CONFIRMATION' || ideationStatus === 'DESIGN_CONFIRMED' || ideationStatus === 'FINALIZED';

  const brief: BrainstormBrief | null = latestSession?.output
    ? (latestSession.output as { brief?: BrainstormBrief }).brief ?? null
    : null;

  async function handleRun() {
    setLoading(true);
    try {
      await api.startBrainstorm(requirementId);
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : '启动头脑风暴失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleRevise() {
    if (!feedback.trim()) return;
    setLoading(true);
    try {
      await api.reviseBrainstorm(requirementId, feedback);
      setFeedback('');
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : '修订失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setLoading(true);
    try {
      await api.confirmBrainstorm(requirementId);
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : '确认失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">头脑风暴</h3>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-1 text-sm text-blue-600">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              AI 思考中...
            </span>
          )}
          {isWaitingConfirmation && (
            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">待确认</span>
          )}
          {isConfirmed && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">已确认</span>
          )}
        </div>
      </div>

      {canStart && !brief && (
        <p className="text-sm text-gray-500">
          点击下方按钮，AI 将把简短的需求扩展为完整的产品简报。
        </p>
      )}

      {brief && (
        <div className="space-y-3 rounded-md border p-4">
          <div>
            <h4 className="mb-1 text-sm font-medium text-gray-700">扩展描述</h4>
            <p className="whitespace-pre-line text-sm text-gray-600">{brief.expandedDescription}</p>
          </div>

          {brief.userStories.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-gray-700">用户故事</h4>
              <ul className="space-y-1">
                {brief.userStories.map((story, i) => (
                  <li key={i} className="text-sm text-gray-600">
                    作为<strong>{story.role}</strong>，我希望<strong>{story.action}</strong>，以便<strong>{story.benefit}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.edgeCases.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-gray-700">边界情况</h4>
              <ul className="list-inside list-disc space-y-0.5">
                {brief.edgeCases.map((item, i) => (
                  <li key={i} className="text-sm text-gray-600">{item}</li>
                ))}
              </ul>
            </div>
          )}

          {brief.successMetrics.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-gray-700">成功指标</h4>
              <ul className="list-inside list-disc space-y-0.5">
                {brief.successMetrics.map((item, i) => (
                  <li key={i} className="text-sm text-gray-600">{item}</li>
                ))}
              </ul>
            </div>
          )}

          {brief.openQuestions.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-gray-700">待确认问题</h4>
              <ul className="list-inside list-disc space-y-0.5">
                {brief.openQuestions.map((item, i) => (
                  <li key={i} className="text-sm text-orange-600">{item}</li>
                ))}
              </ul>
            </div>
          )}

          {brief.assumptions.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-gray-700">假设</h4>
              <ul className="list-inside list-disc space-y-0.5">
                {brief.assumptions.map((item, i) => (
                  <li key={i} className="text-sm text-gray-500">{item}</li>
                ))}
              </ul>
            </div>
          )}

          {brief.outOfScope.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-gray-700">不在范围内</h4>
              <ul className="list-inside list-disc space-y-0.5">
                {brief.outOfScope.map((item, i) => (
                  <li key={i} className="text-sm text-gray-400">{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {latestSession?.status === 'FAILED' && latestSession.errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {latestSession.errorMessage}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2">
        {canStart && (
          <button
            onClick={handleRun}
            disabled={loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '处理中...' : '启动头脑风暴'}
          </button>
        )}

        {canRevise && isWaitingConfirmation && (
          <>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="输入修改意见，AI 将据此重新生成..."
              className="w-full rounded-md border p-2 text-sm"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="rounded-md bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? '处理中...' : '确认简报'}
              </button>
              <button
                onClick={handleRevise}
                disabled={loading || !feedback.trim()}
                className="rounded-md bg-yellow-500 px-4 py-2 text-sm text-white hover:bg-yellow-600 disabled:opacity-50"
              >
                {loading ? '处理中...' : '修改并重新生成'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
