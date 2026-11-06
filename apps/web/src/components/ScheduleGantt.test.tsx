// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ScheduleGantt } from './ScheduleGantt';
vi.mock('../api', () => ({api:{getScheduleGantt:vi.fn()}}));
let host:HTMLDivElement;let root:Root;
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.mocked(api.getScheduleGantt).mockImplementation(async query => ({view:'member',range:{from:query.from,to:query.to},lanes:[],bars:[],pagination:{page:query.page ?? 1,pageSize:20,total:45,totalPages:3}}));
});
afterEach(async () => {await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
it('从URL读取需求页码，空排期页也可继续翻页', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/schedule?ganttPage=2']}><ScheduleGantt query={{projectId:'p1',from:'2026-11-01',to:'2026-11-02'}} /></MemoryRouter>));
  expect(api.getScheduleGantt).toHaveBeenLastCalledWith(expect.objectContaining({page:2,pageSize:20,projectId:'p1'}));
  await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='下一页')!.click());
  expect(api.getScheduleGantt).toHaveBeenLastCalledWith(expect.objectContaining({page:3,pageSize:20}));
});
