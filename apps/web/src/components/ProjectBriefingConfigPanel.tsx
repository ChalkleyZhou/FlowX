import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { SectionHeader } from './SectionHeader';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { useToast } from './ui/toast';
import type { ProjectBriefingConfig } from '../types';

export function ProjectBriefingConfigPanel({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<ProjectBriefingConfig | null>(null);
  const [dailyHourInput, setDailyHourInput] = useState('22');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.getProjectBriefingConfig(projectId)
      .then((loaded) => {
        setConfig(loaded);
        setDailyHourInput(String(loaded.dailyHour ?? 22));
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载简报配置失败'));
  }, [projectId]);

  async function save(next: Partial<ProjectBriefingConfig>) {
    const merged = { ...config, ...next };
    setConfig(merged as ProjectBriefingConfig);
    setSaving(true);
    try {
      const updated = await api.updateProjectBriefingConfig(projectId, next);
      setConfig(updated);
      setDailyHourInput(String(updated.dailyHour ?? 22));
      toast.success('简报配置已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存简报配置失败');
    } finally {
      setSaving(false);
    }
  }

  async function generateToday() {
    await api.generateProjectBriefing(projectId, {
      regenerate: true,
    });
    toast.success('当前周期简报已生成');
  }

  return (
    <Card className="rounded-2xl border border-border bg-card shadow-sm">
      <CardHeader className="pb-4">
        <SectionHeader eyebrow="Briefings" title="简报配置" />
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3 p-5 pt-0">
        <Button variant={config?.enabled ? 'default' : 'outline'} onClick={() => void save({ enabled: !config?.enabled })} disabled={saving}>
          {config?.enabled ? '已启用' : '启用简报'}
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
          <span>
            时发送（整点；该时刻–24:00 的活动计入次日简报）
          </span>
        </label>
        <Button variant={config?.autoSend ? 'default' : 'outline'} onClick={() => void save({ autoSend: !config?.autoSend })} disabled={saving}>
          {config?.autoSend ? '自动发送' : '手动发送'}
        </Button>
        <Button variant="outline" onClick={() => void generateToday()}>生成当前周期简报</Button>
        <Button variant="outline" asChild>
          <Link to={`/briefings`}>查看历史</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

