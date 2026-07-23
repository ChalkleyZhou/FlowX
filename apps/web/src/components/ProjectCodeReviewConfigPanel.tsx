import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { SectionHeader } from './SectionHeader';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { useToast } from './ui/toast';
import { formatBeijingDateTime } from '../utils/datetime';
import type { ProjectCodeReviewConfig } from '../types';

export function ProjectCodeReviewConfigPanel({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<ProjectCodeReviewConfig | null>(null);
  const [dailyHourInput, setDailyHourInput] = useState('22');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.getProjectCodeReviewConfig(projectId)
      .then((loaded) => {
        setConfig(loaded);
        setDailyHourInput(String(loaded.dailyHour ?? 22));
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载代码审查配置失败'));
  }, [projectId]);

  async function save(next: Partial<ProjectCodeReviewConfig>) {
    const merged = { ...config, ...next };
    setConfig(merged as ProjectCodeReviewConfig);
    setSaving(true);
    try {
      const updated = await api.updateProjectCodeReviewConfig(projectId, next);
      setConfig(updated);
      setDailyHourInput(String(updated.dailyHour ?? 22));
      toast.success('代码审查配置已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存代码审查配置失败');
    } finally {
      setSaving(false);
    }
  }

  async function toggleScheduledReview() {
    const nextEnabled = !config?.enabled;
    await save({ enabled: nextEnabled, autoSend: nextEnabled });
  }

  async function generateCodeReviewToday() {
    const review = await api.generateProjectDailyCodeReview(projectId, {
      regenerate: true,
    });
    toast.success(
      review.status === 'GENERATING'
        ? '每日代码审查已开始生成，可在代码审查历史中查看'
        : '每日代码审查已生成，可在代码审查历史中查看',
    );
  }

  return (
    <Card className="rounded-md border border-border bg-card">
      <CardHeader className="pb-4">
        <SectionHeader
          eyebrow="代码审查"
          title="代码审查配置"
          description={
            config?.enabled
              ? '到点会按仓库内的 review skill 自动执行每日代码审查，并投递到本项目的投递目标。'
              : '开启后按下方时刻自动执行每日代码审查并投递；也可随时手动触发一次。'
          }
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-5 pt-0">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={config?.enabled ? 'default' : 'outline'}
            onClick={() => void toggleScheduledReview()}
            disabled={saving}
          >
            {config?.enabled ? '定时代码审查已开启' : '开启定时代码审查'}
          </Button>
          <label className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>北京时间每日</span>
            <Input
              className="w-20"
              type="number"
              min={0}
              max={23}
              value={dailyHourInput}
              onChange={(event) => setDailyHourInput(event.target.value)}
              onBlur={() => {
                const hour = Number(dailyHourInput);
                if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
                  setDailyHourInput(String(config?.dailyHour ?? 22));
                  toast.error('请输入 0–23 之间的整点小时');
                  return;
                }
                if (hour === (config?.dailyHour ?? 22)) {
                  return;
                }
                void save({ dailyHour: hour });
              }}
            />
            <span>时自动执行（整点；该时刻–24:00 的变更计入次日审查）</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void generateCodeReviewToday()} disabled={saving}>
            生成今日代码审查
          </Button>
          <Button variant="outline" asChild>
            <Link to="/code-reviews">查看历史</Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          代码审查由各仓库内的 review skill（如 `.cursor/skills/code-review/SKILL.md`）主导审查重点；若仓库未配置 review
          skill，本次审查会跳过并在报告中提示需要添加。
        </p>
        {config?.enabled ? (
          <p className="text-sm text-muted-foreground">
            上次定时执行：{formatBeijingDateTime(config.lastSchedulerRunAt)}
            {config.lastSchedulerMessage ? ` · ${config.lastSchedulerMessage}` : ''}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
