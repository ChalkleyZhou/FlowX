// @vitest-environment jsdom
import { act } from 'react';import {createRoot,type Root} from 'react-dom/client';import {MemoryRouter,useSearchParams} from 'react-router-dom';import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {api} from '../api';import {useProjectLabelFilter} from './use-project-label-filter';
vi.mock('../api',()=>({api:{listProjectLabels:vi.fn()}}));
let root:Root,container:HTMLDivElement;
beforeEach(()=>{(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container);vi.mocked(api.listProjectLabels).mockResolvedValue({items:[{id:'l1',projectId:'p1',name:'前端',color:'BLUE',updatedAt:'',workItemCount:0}],page:1,pageSize:20,total:1,totalPages:1});});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.clearAllMocks();});
function Demo(){const [params,setParams]=useSearchParams();const filter=useProjectLabelFilter('p1');return <><button onClick={()=>filter.clear()}>清空</button><button onClick={()=>filter.setDraft([{id:'l2',name:'后选标签',color:'RED'}])}>改选</button><output>{JSON.stringify({ids:filter.labelIds,names:filter.draft.map(x=>x.name),error:filter.error})}</output><button onClick={()=>{const next=new URLSearchParams(params);filter.write(next);setParams(next);}}>查询</button></>;}
it('URL的失效标签保留ID并明确提示，不扩大范围',async()=>{await act(async()=>root.render(<MemoryRouter initialEntries={['/?labelIds=l1,deleted']}><Demo/></MemoryRouter>));expect(container.textContent).toContain('部分筛选标签已失效');expect(container.textContent).toContain('deleted');expect(container.textContent).toContain('前端');});
it('权限失败不能伪装失效或空筛选',async()=>{vi.mocked(api.listProjectLabels).mockRejectedValue(new Error('没有权限'));await act(async()=>root.render(<MemoryRouter initialEntries={['/?labelIds=l1']}><Demo/></MemoryRouter>));expect(container.textContent).toContain('没有权限');expect(container.textContent).not.toContain('已失效');expect(container.textContent).toContain('l1');});

it.each(['清空','改选'])('摘要请求晚到不能覆盖用户%s的筛选草稿',async(action)=>{
 let resolve: ((value: Awaited<ReturnType<typeof api.listProjectLabels>>) => void) | undefined;
 vi.mocked(api.listProjectLabels).mockImplementation(()=>new Promise(done=>{resolve=done;}));
 await act(async()=>root.render(<MemoryRouter initialEntries={['/?labelIds=l1']}><Demo/></MemoryRouter>));
 act(()=>Array.from(container.querySelectorAll('button')).find(x=>x.textContent===action)!.click());
 await act(async()=>resolve!({items:[{id:'l1',projectId:'p1',name:'前端',color:'BLUE',updatedAt:'',workItemCount:0}],page:1,pageSize:20,total:1,totalPages:1}));
 const output=JSON.parse(container.querySelector('output')!.textContent!);
 expect(output.names).toEqual(action==='清空'?[]:['后选标签']);
});
