// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { ProjectLabelSummary } from '../types';
import { ProjectLabelSelect } from './ProjectLabelSelect';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
vi.mock('../api', () => ({ api: { listProjectLabels: vi.fn() } }));
const selected: ProjectLabelSummary = { id: 'old', name: '已有标签', color: 'RED' };
describe('项目标签多选', () => {
 let root: Root; let container: HTMLDivElement;
 beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div');document.body.append(container);root=createRoot(container);vi.mocked(api.listProjectLabels).mockResolvedValue({items:[{id:'new',projectId:'p1',name:'新标签',color:'BLUE',updatedAt:'',workItemCount:0}],total:21,page:1,pageSize:20,totalPages:2}); });
 afterEach(() => { act(()=>root.unmount()); container.remove(); vi.clearAllMocks(); });
 const settle = async () => { await act(async()=> { await new Promise(resolve=>setTimeout(resolve,10)); }); };
 function Demo({projectId='p1'}:{projectId?:string}) { const [value,setValue]=useState([selected]);return <><ProjectLabelSelect projectId={projectId} value={value} onChange={setValue}/><output>{value.map(x=>x.id).join(',')}</output></>; }
 it('保留不在分页选项里的已选摘要，多选后保持展开，并可新窗口管理', async()=>{
  act(()=>root.render(<Demo/>));act(()=>container.querySelector<HTMLButtonElement>('button[aria-label="标签（可选）"]')!.click());await settle();
  expect(container.textContent).toContain('已有标签');
  act(()=>container.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  expect(container.querySelector('output')?.textContent).toBe('old,new');expect(container.querySelector('[role="checkbox"]')).not.toBeNull();
  const link=container.querySelector<HTMLAnchorElement>('a');expect(link?.target).toBe('_blank');expect(link?.href).toContain('tab=labels');
  act(()=>Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='下一页')!.click());await settle();expect(container.querySelector('output')?.textContent).toBe('old,new');
 });
 it('失败展示重试并保留已选，刷新不静默清空',async()=>{
  vi.mocked(api.listProjectLabels).mockRejectedValue(new Error('没有权限'));
  act(()=>root.render(<Demo/>));act(()=>container.querySelector<HTMLButtonElement>('button[aria-label="标签（可选）"]')!.click());await settle();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('没有权限');expect(container.querySelector('output')?.textContent).toBe('old');expect(container.textContent).not.toContain('此项目暂无标签');
 });
 it('手动切换项目清空旧选择并提示，Esc关闭',async()=>{
  act(()=>root.render(<Demo/>));act(()=>root.render(<Demo projectId="p2"/>));await settle();
  expect(container.querySelector('output')?.textContent).toBe('');expect(container.textContent).toContain('已切换项目，请重新选择标签');
  act(()=>container.querySelector<HTMLButtonElement>('button[aria-label="标签（可选）"]')!.click());await settle();act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(container.querySelector('[role="checkbox"]')).toBeNull();
 });
 it('真实 Radix 父对话框中首次 Escape 只关闭标签面板并保留标题和所选标签', async () => {
  function NestedDialog() {
   const [open, setOpen] = useState(true);
   const [labels, setLabels] = useState([selected]);
   const [title, setTitle] = useState('未保存的需求');
   return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent>
     <DialogHeader><DialogTitle>创建需求</DialogTitle><DialogDescription>保存前保留草稿</DialogDescription></DialogHeader>
     <Input aria-label="需求标题" value={title} onChange={event => setTitle(event.target.value)} />
     <ProjectLabelSelect projectId="p1" value={labels} onChange={setLabels} />
     <output aria-label="草稿标签">{labels.map(label => label.id).join(',')}</output>
    </DialogContent>
   </Dialog>;
  }
  act(() => root.render(<NestedDialog />));
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="标签（可选）"]')!.click(); });
  await settle();
  const checkbox = document.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
  act(() => { checkbox.click(); checkbox.focus(); });
  expect(document.querySelector('output')?.textContent).toBe('old,new');
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  expect(document.querySelector('[role="dialog"][aria-label="选择项目标签"]')).toBeNull();
  expect(document.querySelector<HTMLInputElement>('input[aria-label="需求标题"]')?.value).toBe('未保存的需求');
  expect(document.querySelector('output')?.textContent).toBe('old,new');
  expect(document.querySelector<HTMLButtonElement>('button[aria-label="标签（可选）"]')?.getAttribute('aria-expanded')).toBe('false');
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
 });

});
