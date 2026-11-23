// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ProjectLabelsPanel } from './ProjectLabelsPanel';
import { ToastProvider } from './ui/toast';
vi.mock('../api',()=>({api:{listProjectLabels:vi.fn(),createProjectLabel:vi.fn(),updateProjectLabel:vi.fn(),deleteProjectLabel:vi.fn()}}));
const label={id:'l1',projectId:'p1',name:'前端',color:'BLUE' as const,updatedAt:'v1',workItemCount:12};
describe('项目标签管理',()=>{
 let root:Root;let container:HTMLDivElement;
 beforeEach(()=>{(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container);vi.mocked(api.listProjectLabels).mockResolvedValue({items:[label],page:1,pageSize:20,total:1,totalPages:1});});
 afterEach(()=>{act(()=>root.unmount());container.remove();vi.clearAllMocks();});
 async function render(){await act(async()=>{root.render(<MemoryRouter><ToastProvider><ProjectLabelsPanel projectId="p1"/></ToastProvider></MemoryRouter>);});}
 it('显示使用数、独立搜索分页；保存失败保留名称和颜色',async()=>{
  await render();expect(container.textContent).toContain('12');expect(container.querySelector('nav')).toBeNull();
  act(()=>Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='编辑')!.click());
  vi.mocked(api.updateProjectLabel).mockRejectedValue(new Error('同项目标签名称已存在'));
  const input=document.querySelector<HTMLInputElement>('input[aria-label="标签名称"]')!;
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'新名称');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>document.querySelector<HTMLFormElement>('form')!.requestSubmit());
  expect(api.updateProjectLabel).toHaveBeenCalledWith('p1','l1',{name:'新名称',color:'BLUE',updatedAt:'v1'});
  expect(document.body.textContent).toContain('同项目标签名称已存在');expect(input.value).toBe('新名称');
 });
 it('加载错误显示重试，不伪装成暂无标签',async()=>{
  vi.mocked(api.listProjectLabels).mockRejectedValue(new Error('网络故障'));await render();expect(container.textContent).toContain('网络故障');expect(container.textContent).not.toContain('暂无标签');expect(container.textContent).toContain('重试');
 });
});
