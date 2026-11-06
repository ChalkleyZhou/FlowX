// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { WorkflowRunsPage } from './WorkflowRunsPage';
import type { PageResult, WorkflowRun } from '../types';

vi.mock('../api',()=>({api:{getWorkflowRuns:vi.fn(),getWorkspace:vi.fn(),getRequirement:vi.fn(),getWorkspaces:vi.fn(),getRequirements:vi.fn(),deleteWorkflowRun:vi.fn()}}));
vi.mock('../components/ui/toast',()=>({useToast:()=>({success:vi.fn(),error:vi.fn()})}));
vi.mock('../components/ConfirmDialog',()=>({useConfirm:()=>vi.fn(async()=>true)}));
const run = (id:string):WorkflowRun => ({id,status:'EXECUTION_PENDING',runType:'FULL',requirement:{id:'r',title:`流程 ${id}`,description:'说明',project:{id:'p',name:'项目',workspace:{id:'w',name:'工作区'}}},workflowRepositories:[]} as unknown as WorkflowRun);
const page = (items:WorkflowRun[], current=1):PageResult<WorkflowRun> => ({items,total:21,page:current,pageSize:20,totalPages:2,summary:{total:60,visible:21,runningCount:15,pendingCount:30}});

describe('工作流服务端分页',()=>{
 let container:HTMLDivElement; let root:Root;
 beforeEach(()=>{ window.localStorage.clear(); (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true; container=document.createElement('div');document.body.append(container);root=createRoot(container);
   vi.mocked(api.getWorkflowRuns).mockImplementation(async query=>page([run(query?.page===2?'later':'first')],Number(query?.page??1)));
   vi.mocked(api.getRequirement).mockResolvedValue({id:'off-page',title:'跨页已选需求'} as never);
 });
 afterEach(()=>{act(()=>root.unmount());document.body.innerHTML='';vi.clearAllMocks();});
 it('按项目和筛选查询当前页，指标采用全范围汇总',async()=>{
   await act(async()=>root.render(<MemoryRouter initialEntries={['/workflow-runs?projectId=p&requirementId=off-page&runType=FULL']}><WorkflowRunsPage/></MemoryRouter>));
   expect(api.getWorkflowRuns).toHaveBeenLastCalledWith(expect.objectContaining({projectId:'p',requirementId:'off-page',runType:'FULL',page:1,pageSize:20}));
   expect(container.textContent).toContain('跨页已选需求');
   expect(container.textContent).toContain('共 21 条');
   expect(container.textContent).toContain('15');
   expect(api.getRequirements).not.toHaveBeenCalled();
   await act(async()=>{Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='下一页')?.click();});
   expect(api.getWorkflowRuns).toHaveBeenLastCalledWith(expect.objectContaining({page:2}));
   expect(container.textContent).toContain('流程 later');expect(container.textContent).not.toContain('流程 first');
 });
 it('没有当前项目时不发起无范围的列表请求',async()=>{
   await act(async()=>root.render(<MemoryRouter initialEntries={['/workflow-runs']}><WorkflowRunsPage/></MemoryRouter>));
   expect(api.getWorkflowRuns).not.toHaveBeenCalled();
 });
});
