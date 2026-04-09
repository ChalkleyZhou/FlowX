import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { IdeationBrainstormPanel } from '../components/IdeationBrainstormPanel';
import { IdeationDesignPanel } from '../components/IdeationDesignPanel';
import type { Requirement } from '../types';

export function RequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);

  const fetchRequirement = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getRequirement(id);
      setRequirement(data);
    } catch (err) {
      console.error('Failed to fetch requirement:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchRequirement();
  }, [fetchRequirement]);

  // Auto-refresh when ideation session is running
  useEffect(() => {
    if (!requirement) return;

    const hasRunningSession = requirement.ideationSessions?.some(
      (s) => s.status === 'RUNNING',
    );
    if (!hasRunningSession) return;

    const interval = setInterval(fetchRequirement, 2500);
    return () => clearInterval(interval);
  }, [requirement, fetchRequirement]);

  async function handleFinalize() {
    if (!id) return;
    setFinalizing(true);
    try {
      await api.finalizeIdeation(id);
      await fetchRequirement();
    } catch (err) {
      alert(err instanceof Error ? err.message : '定稿失败');
    } finally {
      setFinalizing(false);
    }
  }

  async function handleLaunchWorkflow() {
    if (!id) return;
    try {
      const workflow = await api.createWorkflowRun(id);
      navigate(`/workflow-runs/${workflow.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '启动工作流失败');
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-500">加载中...</div>;
  }

  if (!requirement) {
    return <div className="p-6 text-gray-500">需求未找到</div>;
  }

  const ideationStatus = requirement.ideationStatus || 'NONE';
  const sessions = requirement.ideationSessions ?? [];
  const canFinalize = ideationStatus === 'DESIGN_CONFIRMED';
  const isFinalized = ideationStatus === 'FINALIZED';

  const ideationStatusLabels: Record<string, string> = {
    NONE: '未开始',
    BRAINSTORM_PENDING: '头脑风暴中',
    BRAINSTORM_WAITING_CONFIRMATION: '头脑风暴待确认',
    BRAINSTORM_CONFIRMED: '简报已确认',
    DESIGN_PENDING: '设计生成中',
    DESIGN_WAITING_CONFIRMATION: '设计待确认',
    DESIGN_CONFIRMED: '设计已确认',
    FINALIZED: '已定稿',
  };

  const ideationSteps = [
    { key: 'brainstorm', label: '头脑风暴', active: ideationStatus !== 'NONE' },
    { key: 'design', label: 'UI 设计', active: ideationStatus === 'DESIGN_PENDING' || ideationStatus === 'DESIGN_WAITING_CONFIRMATION' || ideationStatus === 'DESIGN_CONFIRMED' || isFinalized },
    { key: 'finalize', label: '定稿', active: isFinalized },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/requirements')}
          className="mb-3 text-sm text-gray-500 hover:text-gray-700"
        >
          ← 返回需求列表
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{requirement.title}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                {requirement.project?.name}
              </span>
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800">
                构思: {ideationStatusLabels[ideationStatus] ?? ideationStatus}
              </span>
            </div>
          </div>
          {isFinalized && (
            <button
              onClick={handleLaunchWorkflow}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
            >
              启动研发工作流
            </button>
          )}
        </div>
      </div>

      {/* Requirement Info */}
      <div className="mb-6 rounded-md border p-4 space-y-3">
        <div>
          <h3 className="mb-1 text-sm font-medium text-gray-700">需求描述</h3>
          <p className="whitespace-pre-line text-sm text-gray-600">{requirement.description}</p>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-medium text-gray-700">验收标准</h3>
          <p className="whitespace-pre-line text-sm text-gray-600">{requirement.acceptanceCriteria}</p>
        </div>
      </div>

      {/* Ideation Steps Indicator */}
      <div className="mb-6 flex items-center gap-2">
        {ideationSteps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                step.active
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-sm ${step.active ? 'font-medium text-gray-900' : 'text-gray-400'}`}>
              {step.label}
            </span>
            {i < ideationSteps.length - 1 && (
              <div className={`h-0.5 w-8 ${step.active ? 'bg-blue-600' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Brainstorm Panel */}
      <div className="mb-6 rounded-md border p-4">
        <IdeationBrainstormPanel
          requirementId={id!}
          ideationStatus={ideationStatus}
          sessions={sessions}
          onUpdated={fetchRequirement}
        />
      </div>

      {/* Design Panel */}
      {(ideationStatus === 'BRAINSTORM_CONFIRMED' ||
        ideationStatus === 'DESIGN_PENDING' ||
        ideationStatus === 'DESIGN_WAITING_CONFIRMATION' ||
        ideationStatus === 'DESIGN_CONFIRMED' ||
        isFinalized) && (
        <div className="mb-6 rounded-md border p-4">
          <IdeationDesignPanel
            requirementId={id!}
            ideationStatus={ideationStatus}
            sessions={sessions}
            onUpdated={fetchRequirement}
          />
        </div>
      )}

      {/* Finalize */}
      {canFinalize && (
        <div className="mb-6 rounded-md border border-green-200 bg-green-50 p-4">
          <p className="mb-3 text-sm text-green-800">
            头脑风暴和设计方案已确认。点击定稿将产品简报内容合并到需求描述中，然后即可启动研发工作流。
          </p>
          <button
            onClick={handleFinalize}
            disabled={finalizing}
            className="rounded-md bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
          >
            {finalizing ? '处理中...' : '定稿并合并到需求'}
          </button>
        </div>
      )}
    </div>
  );
}
