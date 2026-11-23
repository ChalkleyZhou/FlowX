// @vitest-environment jsdom
import { act } from 'react';import {createRoot,type Root} from 'react-dom/client';import {MemoryRouter,Route,Routes} from 'react-router-dom';import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {api} from '../api';import type {WorkItem} from '../types';import {BugDetailPage} from './BugDetailPage';import {IssueDetailPage} from './IssueDetailPage';import {WorkItemDetailPage} from './WorkItemDetailPage';
vi.mock('../api',()=>({api:{getBug:vi.fn(),updateBug:vi.fn(),getIssue:vi.fn(),updateIssue:vi.fn(),getWorkItem:vi.fn(),updateWorkItem:vi.fn(),listProjectLabels:vi.fn()},getBugScreenshotUrl:()=>''}));
vi.mock('../components/ExecutionPlanPanel',()=>({ExecutionPlanPanel:()=>null}));
vi.mock('../components/ui/toast',()=>({useToast:()=>({error:vi.fn(),success:vi.fn()})}));
vi.mock('../online-ai',()=>({useOnlineAiProviders:()=>null,ONLINE_AI_UNAVAILABLE_MESSAGE:'不可用'}));
const item={id:'i1',projectId:'p1',workspaceId:'w1',kind:'ISSUE',title:'标题',description:'描述',remark:'',status:'OPEN',priority:'MEDIUM',severity:'MEDIUM',updatedAt:'v1',labels:[{id:'l1',name:'前端',color:'BLUE'}],project:{id:'p1',name:'项目'},workspace:{id:'w1',name:'工作区'}} as WorkItem;
let root:Root,container:HTMLDivElement;
beforeEach(()=>{(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container);vi.mocked(api.listProjectLabels).mockResolvedValue({items:[],total:0,page:1,pageSize:20,totalPages:1});vi.mocked(api.getBug).mockResolvedValue({...item,kind:'BUG',severity:'MEDIUM'});vi.mocked(api.getIssue).mockResolvedValue(item);vi.mocked(api.getWorkItem).mockResolvedValue(item);vi.mocked(api.updateBug).mockRejectedValue(new Error('标签已删除，请刷新标签'));vi.mocked(api.updateIssue).mockRejectedValue(new Error('标签已删除，请刷新标签'));vi.mocked(api.updateWorkItem).mockRejectedValue(new Error('标签已删除，请刷新标签'));});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.clearAllMocks();});
it.each([['BUG',BugDetailPage,'bugId','updateBug'],['ISSUE',IssueDetailPage,'issueId','updateIssue'],['WORK_ITEM',WorkItemDetailPage,'id','updateWorkItem']] as const)('%s 详情回填标签，失败保留草稿且请求完整标签ID',async(kind,Page,param,method)=>{
 await act(async()=>root.render(<MemoryRouter initialEntries={['/items/i1']}><Routes><Route path={`/items/:${param}`} element={<Page/>}/></Routes></MemoryRouter>));
 expect(container.textContent).toContain('前端');
 if(kind==='WORK_ITEM') await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='编辑内容')!.click();});
 const scope=kind==='WORK_ITEM'?document.body:container;
 const input=scope.querySelector<HTMLInputElement>('input')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'修改标题');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>{const form=scope.querySelector<HTMLFormElement>('form');if(form)form.requestSubmit();else Array.from(scope.querySelectorAll('button')).find(x=>x.textContent==='保存')!.click();});
 expect(api[method]).toHaveBeenCalledWith('i1',expect.objectContaining({labelIds:['l1'],title:'修改标题',updatedAt:'v1'}));expect(input.value).toBe('修改标题');expect(scope.textContent).toContain('前端');
 if(kind==='WORK_ITEM') expect(scope.textContent).toContain('标签已删除，请刷新标签');
});
