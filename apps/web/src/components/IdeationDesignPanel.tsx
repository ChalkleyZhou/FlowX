import { useState } from 'react';
import { api } from '../api';
import type { IdeationSession } from '../types';

interface DesignSpec {
  overview: string;
  pages: Array<{
    name: string;
    route: string;
    layout: string;
    keyComponents: string[];
    interactions: string[];
  }>;
  demoScenario: string;
  dataModels: string[];
  apiEndpoints: Array<{
    method: string;
    path: string;
    purpose: string;
  }>;
  designRationale: string;
}

interface Props {
  requirementId: string;
  ideationStatus: string;
  sessions: IdeationSession[];
  onUpdated: () => void;
}

export function IdeationDesignPanel({ requirementId, ideationStatus, sessions, onUpdated }: Props) {
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedPage, setExpandedPage] = useState<number | null>(null);

  const designSessions = sessions.filter((s) => s.stage === 'DESIGN');
  const latestSession = designSessions[designSessions.length - 1];
  const isRunning = latestSession?.status === 'RUNNING';
  const isWaitingConfirmation = latestSession?.status === 'WAITING_CONFIRMATION';
  const canStart = ideationStatus === 'BRAINSTORM_CONFIRMED';
  const canRevise = ideationStatus === 'DESIGN_WAITING_CONFIRMATION';
  const isConfirmed = ideationStatus === 'DESIGN_CONFIRMED' || ideationStatus === 'FINALIZED';

  const design: DesignSpec | null = latestSession?.output
    ? (latestSession.output as { design?: DesignSpec }).design ?? null
    : null;

  async function handleRun() {
    setLoading(true);
    try {
      await api.startDesign(requirementId);
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : '启动设计失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleRevise() {
    if (!feedback.trim()) return;
    setLoading(true);
    try {
      await api.reviseDesign(requirementId, feedback);
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
      await api.confirmDesign(requirementId);
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : '确认失败');
    } finally {
      setLoading(false);
    }
  }

  const methodColors: Record<string, string> = {
    GET: 'bg-green-100 text-green-800',
    POST: 'bg-blue-100 text-blue-800',
    PUT: 'bg-yellow-100 text-yellow-800',
    PATCH: 'bg-orange-100 text-orange-800',
    DELETE: 'bg-red-100 text-red-800',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">UI 设计 & Demo</h3>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-1 text-sm text-blue-600">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              AI 生成中...
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

      {canStart && !design && (
        <p className="text-sm text-gray-500">
          确认产品简报后，点击下方按钮生成 UI 设计规格和 Demo 场景。
        </p>
      )}

      {design && (
        <div className="space-y-3 rounded-md border p-4">
          <div>
            <h4 className="mb-1 text-sm font-medium text-gray-700">设计概述</h4>
            <p className="whitespace-pre-line text-sm text-gray-600">{design.overview}</p>
          </div>

          {design.pages.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium text-gray-700">页面设计</h4>
              <div className="space-y-2">
                {design.pages.map((page, i) => (
                  <div key={i} className="rounded border bg-gray-50">
                    <button
                      onClick={() => setExpandedPage(expandedPage === i ? null : i)}
                      className="flex w-full items-center justify-between p-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span>{page.name} <span className="font-normal text-gray-400">{page.route}</span></span>
                      <span className="text-gray-400">{expandedPage === i ? '▲' : '▼'}</span>
                    </button>
                    {expandedPage === i && (
                      <div className="space-y-2 border-t p-3">
                        <div>
                          <p className="mb-1 text-xs font-medium text-gray-500">布局线框</p>
                          <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs text-gray-600 border font-mono">
                            {page.layout}
                          </pre>
                        </div>
                        {page.keyComponents.length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-medium text-gray-500">关键组件</p>
                            <div className="flex flex-wrap gap-1">
                              {page.keyComponents.map((comp, j) => (
                                <span key={j} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{comp}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {page.interactions.length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-medium text-gray-500">交互</p>
                            <ul className="list-inside list-disc space-y-0.5">
                              {page.interactions.map((interaction, j) => (
                                <li key={j} className="text-xs text-gray-600">{interaction}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {design.demoScenario && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-gray-700">Demo 场景</h4>
              <pre className="whitespace-pre-wrap rounded bg-gray-50 p-2 text-sm text-gray-600 border font-mono">
                {design.demoScenario}
              </pre>
            </div>
          )}

          {design.dataModels.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-gray-700">数据模型</h4>
              <ul className="list-inside list-disc space-y-0.5">
                {design.dataModels.map((model, i) => (
                  <li key={i} className="font-mono text-xs text-gray-600">{model}</li>
                ))}
              </ul>
            </div>
          )}

          {design.apiEndpoints.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-gray-700">API 端点</h4>
              <div className="space-y-1">
                {design.apiEndpoints.map((endpoint, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`rounded px-1.5 py-0.5 font-mono ${methodColors[endpoint.method] ?? 'bg-gray-100 text-gray-800'}`}>
                      {endpoint.method}
                    </span>
                    <span className="font-mono text-gray-600">{endpoint.path}</span>
                    <span className="text-gray-400">— {endpoint.purpose}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {design.designRationale && (
            <div>
              <h4 className="mb-1 text-sm font-medium text-gray-700">设计理由</h4>
              <p className="text-sm text-gray-600">{design.designRationale}</p>
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
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {loading ? '处理中...' : '生成设计方案'}
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
                className="rounded-md bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {loading ? '处理中...' : '确认设计'}
              </button>
              <button
                onClick={handleRevise}
                disabled={loading || !feedback.trim()}
                className="rounded-md bg-yellow-500 px-4 py-2 text-sm text-white hover:bg-yellow-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
