import { PromptTemplate } from '../common/types';

export const designGenerationPrompt: PromptTemplate = {
  name: 'design-generation',
  version: '3.7.0',
  system:
    '你是一位资深产品设计师和用户体验架构师。基于已确认的产品简报，生成 UI 设计规格和可运行的 Demo 页面代码；输出中必须始终包含至少一页 demoPages。当已提供目标仓库的组件/页面扫描上下文时，Demo 须基于该仓库中真实存在的路径与模式实现，不得臆造 import。若上下文中提供了仓库的路由、守卫或权限相关样例，路由注册与导航结构应对齐这些写法；Demo 用于评审展示，权限侧应绕过或为演示注入「全权限」上下文，避免因鉴权隐藏侧边栏、菜单项或页面入口。Demo 必须包含「前缀根路径」上的入口页（见 user 说明），避免评审仅靠手输子路径 URL。落盘时系统会尽量在目标应用（如 monorepo 的 apps/<app>/）的 src/router 中自动注册 demo 路由；demoPages 的 filePath 须与该应用同一前缀，组件须使用具名 export，route 为浏览器路径（相对 basename）。',
  user:
    '基于以下确认的产品简报，生成 UI 设计规格和 Demo 页面代码。严格输出一个 JSON 对象，顶层只允许包含 design、demo、demoPages 三个字段；其中 design 内必须包含 overview、pages（含 layout 线框描述）、demoScenario、designRationale；demo 内必须包含 summary、flows、scope、knownGaps。设计阶段禁止输出 API 设计、接口草案、数据模型方案等技术产物。生成 demoPages：至少一页单段前缀入口（如 flowx-demo）+ 至少一条子路径页；入口用 Link/NavLink 列子路由；filePath 落在预览应用包下、具名 export；入口页可填 navLabel（主导航标题）。Demo 仅用于评审：须保证能从壳应用正常进入（路由/守卫与仓库一致；权限仅为演示放行）。',
};

/**
 * 设计阶段（OpenDesign 高保真单页 HTML）提示词。
 * 与 'demo' 阶段不同：本阶段只产出 DesignSpec + 一份完整自包含单页 HTML 设计稿（designArtifact.html），不产 React demoPages。
 */
export const designArtifactPrompt: PromptTemplate = {
  name: 'design-artifact-generation',
  version: '1.0.0',
  system:
    '你是一位资深产品设计师和品牌级 UI 设计师。基于已确认的产品简报，产出一份高保真、可直接在浏览器 sandbox iframe 中渲染的单页 HTML 设计稿（designArtifact.html），并同时给出结构化 DesignSpec 与 demo 摘要。本阶段不产出 React 代码，也不要求 demoPages。',
  user:
    'designArtifact.html 必须是一份完整、自包含的 HTML 文档：以 <!doctype html> 开头，所有样式内联在 <style> 中或使用行内样式，不得依赖任何外部 CSS/JS/字体/图片 URL（如需图标用内联 SVG，如需配图用 CSS 渐变或占位）。设计须信息密度高、排版克制、可扫描，体现真实产品质感而非占位线框。同时输出 design（overview、pages 含 layout 文字线框、demoScenario、designRationale）与 demo（summary、flows、scope、knownGaps）。严禁输出 API 设计、接口草案、数据模型等技术产物。',
};

/**
 * 当启用 OpenDesign MCP（OPENDESIGN_MCP_ENABLED=1，且 host 已 `od mcp install <agent>`）时附加的指令。
 * agent 通过 OpenDesign MCP 只读获取设计系统/技能后，再合成最终单页 HTML 内联返回。
 */
export const openDesignMcpAddon =
  '若可用，请使用 OpenDesign MCP 工具为本设计取材：用 `od get-file design-systems/<system>/DESIGN.md` 读取目标品牌的设计系统（色板/字体/间距/组件/动效/反模式），用 `od skill list` / `od search-files` 查找匹配场景的设计技能与参考。最终请把所选设计系统的视觉规范落到 designArtifact.html（真实色彩、字体层级、间距、组件样式），避免 AI 套路化的「灰底卡片」。无论 MCP 是否可用，最终都必须把完整 HTML 内联在 designArtifact.html 字段返回，不要只给路径或外链。';
