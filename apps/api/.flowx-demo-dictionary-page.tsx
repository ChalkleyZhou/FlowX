import { useMemo, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { ListToolbar } from '../../components/ListToolbar';
import { MetricCard } from '../../components/MetricCard';
import { PageHeader } from '../../components/PageHeader';
import { RecordListItem } from '../../components/RecordListItem';
import { SectionHeader } from '../../components/SectionHeader';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { useToast } from '../../components/ui/toast';

type DictStatus = '启用' | '停用';

export interface DictionaryDemoCategory {
  id: string;
  name: string;
  code: string;
  status: DictStatus;
  description: string;
}

export interface DictionaryDemoItem {
  id: string;
  categoryId: string;
  label: string;
  value: string;
  code: string;
  sort: number;
  status: DictStatus;
  remark: string;
}

export interface DictionaryDemoMock {
  categories: DictionaryDemoCategory[];
  items: DictionaryDemoItem[];
  canManage: boolean;
}

export const dictionaryDemoMockData: DictionaryDemoMock = {
  categories: [
    {
      id: 'cat-source',
      name: '来源渠道',
      code: 'lead_source',
      status: '启用',
      description: '线索与客户来源的标准分类，用于报表对齐口径。',
    },
    {
      id: 'cat-priority',
      name: '处理优先级',
      code: 'ticket_priority',
      status: '启用',
      description: '工单与缺陷的优先级枚举，供列表筛选与 SLA 规则引用。',
    },
  ],
  items: [
    {
      id: 'item-wechat',
      categoryId: 'cat-source',
      label: '企业微信',
      value: 'wecom',
      code: 'SRC_WECOM',
      sort: 10,
      status: '启用',
      remark: '销售侧主要获客渠道。',
    },
    {
      id: 'item-portal',
      categoryId: 'cat-source',
      label: '官网表单',
      value: 'portal',
      code: 'SRC_PORTAL',
      sort: 20,
      status: '启用',
      remark: '',
    },
    {
      id: 'item-legacy',
      categoryId: 'cat-source',
      label: '历史导入',
      value: 'legacy',
      code: 'SRC_LEGACY',
      sort: 30,
      status: '停用',
      remark: '历史数据保留展示；新业务不应再选择。',
    },
    {
      id: 'item-p0',
      categoryId: 'cat-priority',
      label: '紧急',
      value: 'p0',
      code: 'PRIO_P0',
      sort: 10,
      status: '启用',
      remark: '需要 2 小时内响应。',
    },
    {
      id: 'item-p1',
      categoryId: 'cat-priority',
      label: '高',
      value: 'p1',
      code: 'PRIO_P1',
      sort: 20,
      status: '启用',
      remark: '',
    },
  ],
  canManage: true,
};

function statusBadgeVariant(status: DictStatus): 'success' | 'warning' {
  return status === '启用' ? 'success' : 'warning';
}

export function FlowxDemoDictionaryAdminPage() {
  const toast = useToast();
  const [categories, setCategories] = useState<DictionaryDemoCategory[]>(() => dictionaryDemoMockData.categories);
  const [items, setItems] = useState<DictionaryDemoItem[]>(() => dictionaryDemoMockData.items);
  const canManage = dictionaryDemoMockData.canManage;

  const [selectedId, setSelectedId] = useState<string>(() => dictionaryDemoMockData.categories[0]?.id ?? '');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DictStatus>('all');

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState({ name: '', code: '', description: '' });

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DictionaryDemoItem | null>(null);
  const [itemDraft, setItemDraft] = useState({
    label: '',
    value: '',
    code: '',
    sort: 10,
    status: '启用' as DictStatus,
    remark: '',
  });

  const selected = categories.find((c) => c.id === selectedId) ?? null;

  const metrics = useMemo(() => {
    const enabledItems = items.filter((i) => i.status === '启用').length;
    const disabledItems = items.length - enabledItems;
    return {
      categoryCount: categories.length,
      itemCount: items.length,
      enabledItems,
      disabledItems,
    };
  }, [categories.length, items]);

  const filteredCategories = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return categories.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
      );
    });
  }, [categories, keyword, statusFilter]);

  const visibleItems = useMemo(() => {
    if (!selectedId) {
      return [];
    }
    const q = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (item.categoryId !== selectedId) {
        return false;
      }
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        item.label.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q) ||
        item.value.toLowerCase().includes(q) ||
        item.remark.toLowerCase().includes(q)
      );
    });
  }, [items, keyword, selectedId, statusFilter]);

  function openCreateCategory() {
    setCategoryDraft({ name: '', code: '', description: '' });
    setCategoryDialogOpen(true);
  }

  function saveCategory() {
    const name = categoryDraft.name.trim();
    const code = categoryDraft.code.trim().toLowerCase();
    if (!name || !code) {
      toast.error('请填写分类名称与编码');
      return;
    }
    const dup = categories.some((c) => c.code.toLowerCase() === code || c.name === name);
    if (dup) {
      toast.error('名称或编码与已有字典分类重复，请修改后再保存');
      return;
    }
    const id = `cat-${Date.now()}`;
    setCategories((prev) => [
      ...prev,
      {
        id,
        name,
        code,
        status: '启用',
        description: categoryDraft.description.trim(),
      },
    ]);
    setSelectedId(id);
    setCategoryDialogOpen(false);
    toast.success('已新增字典分类');
  }

  function openCreateItem() {
    if (!selectedId) {
      toast.error('请先选择一个字典分类');
      return;
    }
    setEditingItem(null);
    setItemDraft({
      label: '',
      value: '',
      code: '',
      sort: (items.filter((i) => i.categoryId === selectedId).length + 1) * 10,
      status: '启用',
      remark: '',
    });
    setItemDialogOpen(true);
  }

  function openEditItem(item: DictionaryDemoItem) {
    setEditingItem(item);
    setItemDraft({
      label: item.label,
      value: item.value,
      code: item.code,
      sort: item.sort,
      status: item.status,
      remark: item.remark,
    });
    setItemDialogOpen(true);
  }

  function saveItem() {
    if (!selectedId) {
      return;
    }
    const label = itemDraft.label.trim();
    const value = itemDraft.value.trim();
    const code = itemDraft.code.trim();
    if (!label || !value || !code) {
      toast.error('请填写显示名称、取值与项编码');
      return;
    }
    const siblings = items.filter((i) => i.categoryId === selectedId && (!editingItem || i.id !== editingItem.id));
    const dup = siblings.some((i) => i.code === code || i.value.toLowerCase() === value.toLowerCase());
    if (dup) {
      toast.error('同一分类下编码或取值重复，请修改后再保存');
      return;
    }
    if (editingItem) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === editingItem.id
            ? {
                ...i,
                label,
                value,
                code,
                sort: itemDraft.sort,
                status: itemDraft.status,
                remark: itemDraft.remark.trim(),
              }
            : i,
        ),
      );
      toast.success('字典项已更新');
    } else {
      const id = `item-${Date.now()}`;
      setItems((prev) => [
        ...prev,
        {
          id,
          categoryId: selectedId,
          label,
          value,
          code,
          sort: itemDraft.sort,
          status: itemDraft.status,
          remark: itemDraft.remark.trim(),
        },
      ]);
      toast.success('已新增字典项');
    }
    setItemDialogOpen(false);
  }

  function removeItem(item: DictionaryDemoItem) {
    if (!canManage) {
      return;
    }
    if (!window.confirm(`确认删除字典项「${item.label}」？删除后历史数据仍应能展示，但不应再被新业务选择。`)) {
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast.success('字典项已删除（演示）');
  }

  function removeCategory(cat: DictionaryDemoCategory) {
    if (!canManage) {
      return;
    }
    const childCount = items.filter((i) => i.categoryId === cat.id).length;
    if (childCount > 0) {
      toast.error('该分类下仍有字典项：请先清理或迁移后再删除，以避免误伤业务引用。');
      return;
    }
    if (
      !window.confirm(
        `确认删除字典分类「${cat.name}」？若该字典仍被业务使用，生产环境应改为限制删除或二次确认策略。`,
      )
    ) {
      return;
    }
    const nextCategories = categories.filter((c) => c.id !== cat.id);
    setCategories(nextCategories);
    if (selectedId === cat.id) {
      setSelectedId(nextCategories[0]?.id ?? '');
    }
    toast.success('字典分类已删除（演示）');
  }

  return (
    <>
      <PageHeader
        eyebrow="Dictionary Center"
        title="字典管理"
        description="集中维护标准化选项，降低口径不一致与分散配置成本。本页为交互演示：校验、空状态与删除限制与产品简报中的边界一致。"
        actions={
          canManage ? (
            <Button type="button" onClick={openCreateCategory}>
              新建字典分类
            </Button>
          ) : null
        }
      />

      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard label="字典分类" value={metrics.categoryCount} />
        <MetricCard label="字典项总数" value={metrics.itemCount} />
        <MetricCard label="启用项" value={metrics.enabledItems} />
        <MetricCard label="停用项" value={metrics.disabledItems} />
      </div>

      <Alert>
        <AlertTitle>审阅提示</AlertTitle>
        <AlertDescription>
          关键字段：分类编码、项编码与状态。编码变更可能影响历史识别：生产环境需单独策略；此处仅演示提示与阻断重复保存。
        </AlertDescription>
      </Alert>

      <div className="grid gap-5 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <Card className="rounded-2xl border border-border bg-card shadow-sm">
          <CardHeader className="pb-3">
            <SectionHeader
              eyebrow="Categories"
              title="字典分类"
              description="左侧主索引：选择分类后在右侧维护字典项。"
            />
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <ListToolbar
              search={
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索分类名称、编码或描述"
                  aria-label="搜索字典"
                />
              }
              filters={
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as 'all' | DictStatus)}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="启用">启用</SelectItem>
                    <SelectItem value="停用">停用</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            {filteredCategories.length === 0 ? (
              <EmptyState
                title="没有匹配的分类"
                description="调整关键词或筛选条件；若确实尚未创建，请先新建字典分类。"
                action={
                  canManage ? (
                    <Button type="button" onClick={openCreateCategory}>
                      新建字典分类
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ScrollArea className="h-[min(520px,calc(100vh-320px))] pr-3">
                <div className="flex flex-col gap-3">
                  {filteredCategories.map((cat) => {
                    const active = cat.id === selectedId;
                    const count = items.filter((i) => i.categoryId === cat.id).length;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedId(cat.id)}
                        className={[
                          'rounded-2xl border px-4 py-3 text-left transition-colors',
                          active
                            ? 'border-primary/40 bg-primary-soft/90 shadow-sm'
                            : 'border-border bg-card hover:bg-muted/50',
                        ].join(' ')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground">{cat.name}</div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">{cat.code}</div>
                          </div>
                          <Badge variant={statusBadgeVariant(cat.status)}>{cat.status}</Badge>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground line-clamp-2">{cat.description}</div>
                        <div className="mt-2 text-xs text-muted-foreground">{count} 个字典项</div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border bg-card shadow-sm">
          <CardHeader className="pb-4">
            <SectionHeader
              eyebrow="Entries"
              title={selected ? `${selected.name} · 字典项` : '字典项'}
              description={
                selected
                  ? '维护显示名称、取值、排序与启停；停用项仍可被历史数据展示引用。'
                  : '请先在左侧选择一个字典分类。'
              }
              extra={
                canManage && selected ? (
                  <Button type="button" onClick={openCreateItem}>
                    新建字典项
                  </Button>
                ) : null
              }
            />
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {!selected ? (
              <EmptyState description="左侧列表为空或未选择分类时，这里会保持空状态以避免误以为加载失败。" />
            ) : visibleItems.length === 0 ? (
              <EmptyState
                title="暂无字典项"
                description="当前筛选条件下没有结果；或该分类尚未配置项。可以尝试清空搜索或调整状态筛选。"
                action={
                  canManage ? (
                    <Button type="button" onClick={openCreateItem}>
                      新建字典项
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="flex flex-col gap-3.5">
                {visibleItems
                  .slice()
                  .sort((a, b) => a.sort - b.sort)
                  .map((item) => (
                    <RecordListItem
                      key={item.id}
                      title={<span className="text-base font-semibold text-foreground">{item.label}</span>}
                      badges={
                        <>
                          <Badge variant="outline">{item.code}</Badge>
                          <Badge variant="secondary">取值 {item.value}</Badge>
                          <Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
                          <Badge variant="outline">排序 {item.sort}</Badge>
                        </>
                      }
                      description={<p className="leading-6">{item.remark || '—'}</p>}
                      actions={
                        canManage ? (
                          <>
                            <Button type="button" variant="outline" onClick={() => openEditItem(item)}>
                              编辑
                            </Button>
                            <Button type="button" variant="outline" onClick={() => removeItem(item)}>
                              删除
                            </Button>
                          </>
                        ) : (
                          <Badge variant="secondary">仅查看</Badge>
                        )
                      }
                    />
                  ))}
              </div>
            )}
            {canManage && selected ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <Button type="button" variant="outline" onClick={() => removeCategory(selected)}>
                  删除当前分类（演示）
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建字典分类</DialogTitle>
            <DialogDescription>名称与编码在全局范围内需唯一；重复时应阻止保存并提示原因。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="dc-name">
                分类名称
              </label>
              <Input
                id="dc-name"
                value={categoryDraft.name}
                onChange={(e) => setCategoryDraft((s) => ({ ...s, name: e.target.value }))}
                placeholder="例如：来源渠道"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="dc-code">
                分类编码
              </label>
              <Input
                id="dc-code"
                value={categoryDraft.code}
                onChange={(e) => setCategoryDraft((s) => ({ ...s, code: e.target.value }))}
                placeholder="例如：lead_source"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="dc-desc">
                说明
              </label>
              <Textarea
                id="dc-desc"
                rows={3}
                value={categoryDraft.description}
                onChange={(e) => setCategoryDraft((s) => ({ ...s, description: e.target.value }))}
                placeholder="用于帮助运营/配置同学理解该字典的业务含义与使用边界。"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCategoryDialogOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={saveCategory}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={itemDialogOpen}
        onOpenChange={(open) => {
          setItemDialogOpen(open);
          if (!open) {
            setEditingItem(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? '编辑字典项' : '新建字典项'}</DialogTitle>
            <DialogDescription>
              同一分类内编码与取值需唯一；停用后新业务不应再选择该项，但历史展示仍需正常。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="di-label">
                显示名称
              </label>
              <Input
                id="di-label"
                value={itemDraft.label}
                onChange={(e) => setItemDraft((s) => ({ ...s, label: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="di-value">
                取值（value）
              </label>
              <Input
                id="di-value"
                value={itemDraft.value}
                onChange={(e) => setItemDraft((s) => ({ ...s, value: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="di-code">
                项编码
              </label>
              <Input
                id="di-code"
                value={itemDraft.code}
                onChange={(e) => setItemDraft((s) => ({ ...s, code: e.target.value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="di-sort">
                  排序
                </label>
                <Input
                  id="di-sort"
                  type="number"
                  value={itemDraft.sort}
                  onChange={(e) => setItemDraft((s) => ({ ...s, sort: Number(e.target.value) || 0 }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-foreground">状态</span>
                <Select
                  value={itemDraft.status}
                  onValueChange={(v) => setItemDraft((s) => ({ ...s, status: v as DictStatus }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="启用">启用</SelectItem>
                    <SelectItem value="停用">停用</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="di-remark">
                备注
              </label>
              <Textarea
                id="di-remark"
                rows={3}
                value={itemDraft.remark}
                onChange={(e) => setItemDraft((s) => ({ ...s, remark: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setItemDialogOpen(false);
                setEditingItem(null);
              }}
            >
              取消
            </Button>
            <Button type="button" onClick={saveItem}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
