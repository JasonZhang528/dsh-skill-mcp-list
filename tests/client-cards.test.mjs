// dsh-skill-mcp-list —— 卡片布局与添加/配置弹窗测试
//
// 用最小 React 垫片驱动预构建 bundle，验证：
//   1. 列表改为卡片栅格（sml-grid / sml-item），信息层级四段齐全
//   2. 头部出现「添加」触发入口
//   3. 弹窗可打开：安装 Skill 表单 / 配置 MCP 表单，分段切换
//   4. 表单校验失败时不提交；提交成功调用宿主 API 并反馈
//   5. 弹窗可关闭（取消按钮 / 遮罩点击 / ESC）
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const CLIENT = join(import.meta.dirname, '..', 'lib', 'client.js');

/**
 * 最小 React 垫片：支持函数组件用到的 hook，并允许反复渲染直到输出稳定。
 * @returns {object} 垫片与渲染入口
 */
function createReactShim() {
  let states = [];
  let cursor = 0;
  let effects = [];
  const cleanups = [];

  const reset = () => { cursor = 0; effects = []; };

  // 渲染深度：函数组件要递归展开，否则嵌套组件（Switch、弹窗）只会以
  // 函数引用留在树里，断言永远找不到它们渲染出的 DOM。
  const MAX_DEPTH = 24;

  const renderNode = (node, depth) => {
    if (node === null || node === undefined || node === false || node === true) return null;
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map((c) => renderNode(c, depth)).filter((c) => c !== null);
    if (typeof node.type === 'function' && depth < MAX_DEPTH) {
      const produced = node.type(node.props ?? {});
      return renderNode(produced, depth + 1);
    }
    return {
      type: node.type,
      props: node.props ?? {},
      children: (node.children ?? []).map((c) => renderNode(c, depth + 1)).filter((c) => c !== null),
    };
  };

  const react = {
    createElement(type, props, ...children) {
      const flat = [];
      const push = (c) => {
        if (Array.isArray(c)) c.forEach(push);
        else if (c !== null && c !== undefined && c !== false && c !== true) flat.push(c);
      };
      children.forEach(push);
      return { type, props: props || {}, children: flat };
    },
    useState(init) {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
      return [states[i], (next) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
    },
    useCallback(fn) { cursor++; return fn; },
    useEffect(fn) { cursor++; effects.push(fn); },
    useRef(init) { cursor++; return { current: init }; },
  };

  const collectStatic = (node, out = []) => {
    if (node === null || node === undefined || node === false) return out;
    if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
    if (Array.isArray(node)) { node.forEach((c) => collectStatic(c, out)); return out; }
    if (node.children) node.children.forEach((c) => collectStatic(c, out));
    return out;
  };

  /**
   * 渲染组件并反复执行 effect，直到输出稳定。
   * @param {Function} Component 函数组件
   * @returns {Promise<object>} 收敛后的元素树
   */
  const render = async (Component) => {
    let tree;
    let previous = null;
    for (let i = 0; i < 10; i += 1) {
      reset();
      tree = renderNode(Component(), 0);
      for (const fn of effects) {
        const cleanup = fn();
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      }
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      const text = JSON.stringify(collectStatic(tree));
      if (text === previous) break;
      previous = text;
    }
    return tree;
  };

  return { react, render, reset, cleanups };
}

/**
 * 按 class 词元精确匹配收集节点（"sml-tab" 不应命中 "sml-tabs"）。
 * @param {unknown} node 节点
 * @param {string} token class 词元
 * @param {object[]} out 输出数组
 * @returns {object[]} 匹配节点
 */
function byClass(node, token, out = []) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((c) => byClass(c, token, out)); return out; }
  const cls = node.props && node.props.className;
  if (typeof cls === 'string' && cls.split(/\s+/).includes(token)) out.push(node);
  if (node.children) node.children.forEach((c) => byClass(c, token, out));
  return out;
}

function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((c) => collectText(c, out)); return out; }
  if (node.children) node.children.forEach((c) => collectText(c, out));
  return out;
}

function byId(node, id, out = []) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((c) => byId(c, id, out)); return out; }
  if (node.props && node.props.id === id) out.push(node);
  if (node.children) node.children.forEach((c) => byId(c, id, out));
  return out;
}

/** 页面快照数据。 */
function snapshot() {
  return {
    ok: true,
    generatedAt: Date.now(),
    cwd: 'E:/WorkSpace/Projects/dsh',
    summary: {
      skills: { total: 2, enabled: 1, disabled: 1, toggleable: 2, providers: ['filesystem'], sources: ['user-dsh'] },
      mcp: { total: 1, enabled: 1, disabled: 0, toggleable: 1, tools: 3, transports: ['stdio'] },
    },
    skills: [
      { name: 'archify', description: 'Architecture diagrams.', provider: 'filesystem', source: 'user-dsh', path: 'E:/a/SKILL.md', enabled: true, toggleable: true, modelInvocable: true, userInvocable: true },
      { name: 'fnos', description: 'fnOS device management.', provider: 'filesystem', source: 'user-dsh', path: 'E:/b/SKILL.md', enabled: false, toggleable: true, modelInvocable: false, userInvocable: true },
    ],
    mcpServers: [
      { entryId: 'mcp-dbx', serverName: 'dbx-mcp', moduleName: '@deepseek-ai/dsh-mcp-client', transport: 'streamable-http', enabled: true, fiberPhase: 'active', toggleable: true, toolCount: 3, toolNames: ['mcp__dbx-mcp__a', 'mcp__dbx-mcp__b', 'mcp__dbx-mcp__c'], connection: { kind: 'streamable-http', url: 'http://192.168.0.100:9005/mcp', headers: [] }, toolCallTimeoutMs: 60000 },
    ],
    capabilities: { skillToggle: true, skillInstall: true, mcpToggle: true, mcpConfigure: true, detail: true },
  };
}

/**
 * 加载 bundle 并返回其导出。
 * @param {object} shim React 垫片
 * @param {object} handlers fetch 行为覆盖
 * @returns {Promise<{exports: object, injected: object[], calls: object[], elements: object}>}
 */
async function loadBundle(shim, handlers = {}) {
  const injected = [];
  const calls = [];
  const elements = {};
  let registration = null;

  globalThis.window = {
    __ModuleLoader__: { load(reg) { registration = reg; } },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    createElement() { return { dataset: {}, textContent: '', remove() {} }; },
    head: { appendChild(el) { injected.push(el); } },
    getElementById(id) { return elements[id] ?? null; },
  };

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    if (handlers.fetch) return handlers.fetch(url, init);
    return { ok: true, status: 200, async json() { return snapshot(); } };
  };

  await import(pathToFileURL(CLIENT).href + '?v=' + Date.now());
  const exports = registration.factory((spec) => {
    if (spec === 'react') return shim.react;
    throw new Error('测试垫片未提供模块: ' + spec);
  });
  return { exports, injected, calls, elements };
}

/**
 * 挂载页面并返回组件与注册表。
 * @param {object} exports bundle 导出
 * @returns {{Page: Function, regs: object[]}}
 */
function mountPage(exports) {
  const regs = [];
  exports.apply({
    effect(fn) { fn(); },
    slots: { inject(_n, fn) { fn(); }, register(options, component) { regs.push({ options, component }); } },
  });
  const found = regs.find((r) => r.options.name === 'main');
  assert.ok(found, '必须注册 main 槽位');
  assert.equal(typeof found.component, 'function', 'main 组件必须是函数');
  return { Page: found.component, regs };
}

test('bundle 注册工厂并导出 apply / inject', async () => {
  const shim = createReactShim();
  const { exports } = await loadBundle(shim);
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(exports.inject, ['slots']);
});

test('卡片栅格：列表改为 sml-grid + sml-item，四段层级齐全', async () => {
  const shim = createReactShim();
  const { exports } = await loadBundle(shim);
  const { Page } = mountPage(exports);
  const tree = await shim.render(Page);

  const grid = byClass(tree, 'sml-grid');
  assert.equal(grid.length, 1, '必须渲染一个卡片栅格');
  const items = byClass(tree, 'sml-item');
  assert.equal(items.length, 2, '两个 skill 应渲染两张卡片');

  const first = items[0];
  // 一级：名称 + 状态
  assert.equal(byClass(first, 'sml-itemTop').length, 1);
  assert.ok(byClass(first, 'sml-itemName').some((n) => collectText(n).join('') === 'archify'));
  assert.ok(collectText(first).includes('已启用'));
  // 二级：来源标签
  assert.equal(byClass(first, 'sml-tags').length, 1);
  // 三级：描述
  assert.equal(byClass(first, 'sml-itemDesc').length, 1);
  assert.ok(collectText(first).includes('Architecture diagrams.'));
  // 四级：路径 + 操作
  const foot = byClass(first, 'sml-itemFoot');
  assert.equal(foot.length, 1);
  assert.ok(byClass(first, 'sml-itemPath').length === 1, '卡片底部必须显示路径');
  assert.ok(byClass(first, 'sml-sw').length === 1, '卡片底部必须有开关');
  assert.ok(collectText(first).includes('详情'));

  // 禁用态卡片带 is-off
  assert.ok(byClass(tree, 'is-off').length >= 1, '禁用的 skill 应有 is-off 标记');
});

test('统计卡与标签页存在', async () => {
  const shim = createReactShim();
  const { exports } = await loadBundle(shim);
  const { Page } = mountPage(exports);
  const tree = await shim.render(Page);

  assert.equal(byClass(tree, 'sml-stat').length, 4, '应有四张统计卡');
  const tabs = byClass(tree, 'sml-tab');
  assert.equal(tabs.length, 2);
  assert.ok(collectText(tabs[0]).join('').includes('Skill（2）'));
  assert.ok(collectText(tabs[1]).join('').includes('MCP（1）'));
  assert.ok(byClass(tree, 'sml-cards').length === 1);
});

test('头部有「添加」触发入口，点击后打开弹窗', async () => {
  const shim = createReactShim();
  const { exports } = await loadBundle(shim);
  const { Page } = mountPage(exports);
  const tree = await shim.render(Page);

  const primary = byClass(tree, 'sml-btn--primary');
  assert.ok(primary.length >= 1, '必须有主按钮');
  const addBtn = primary.find((b) => collectText(b).join('').includes('添加'));
  assert.ok(addBtn, '必须有「添加」按钮');
  assert.equal(typeof addBtn.props.onClick, 'function');

  addBtn.props.onClick();
  const withModal = await shim.render(Page);
  assert.ok(byClass(withModal, 'sml-mask').length >= 1, '点击添加后必须出现弹窗');
  const modal = byClass(withModal, 'sml-modal');
  assert.ok(modal.length >= 1);
  assert.ok(collectText(modal[0]).join('').includes('安装 Skill'), '弹窗标题应为安装 Skill');

  // 弹窗内应有表单字段与两个分段按钮
  assert.ok(byId(withModal, 'sml-skill-name').length === 1, '应有名称输入框');
  assert.ok(byId(withModal, 'sml-skill-desc').length === 1, '应有描述输入框');
  const segs = byClass(withModal, 'sml-segBtn');
  assert.equal(segs.length, 2, '应有「安装 Skill」与「配置 MCP」两个分段');
  assert.ok(collectText(segs[0]).join('').includes('安装 Skill'));
  assert.ok(collectText(segs[1]).join('').includes('配置 MCP'));
});

test('弹窗可取消关闭', async () => {
  const shim = createReactShim();
  const { exports } = await loadBundle(shim);
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);
  byClass(tree, 'sml-btn--primary').find((b) => collectText(b).join('').includes('添加')).props.onClick();
  tree = await shim.render(Page);
  assert.ok(byClass(tree, 'sml-modal').length >= 1);

  const cancel = byClass(tree, 'sml-modalFoot')[0].children.find((c) => c && c.props && collectText(c).join('') === '取消');
  assert.ok(cancel, '应有取消按钮');
  cancel.props.onClick();
  tree = await shim.render(Page);
  assert.equal(byClass(tree, 'sml-modal').length, 0, '取消后弹窗必须关闭');
});

test('MCP 卡片有「配置」按钮并打开配置弹窗', async () => {
  const shim = createReactShim();
  const { exports } = await loadBundle(shim);
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);

  // 切到 MCP 标签页
  const tabs = byClass(tree, 'sml-tab');
  tabs[1].props.onClick();
  tree = await shim.render(Page);

  const cfgBtn = byClass(tree, 'sml-btn--sm').find((b) => collectText(b).join('') === '配置');
  assert.ok(cfgBtn, 'MCP 卡片必须有「配置」按钮');
  cfgBtn.props.onClick();
  tree = await shim.render(Page);

  const modal = byClass(tree, 'sml-modal');
  assert.ok(modal.length >= 1, '点击配置后必须打开弹窗');
  assert.ok(collectText(modal[0]).join('').includes('配置 MCP'));
  assert.ok(collectText(modal[0]).join('').includes('mcp-dbx'), '配置弹窗应显示 Loader 条目');
  // http 条目显示 URL 字段而非命令字段
  assert.ok(byId(tree, 'sml-mcp-url').length === 1, 'http 条目应显示 URL 输入框');
  assert.equal(byId(tree, 'sml-mcp-cmd').length, 0, 'http 条目不应显示命令输入框');
});

test('安装表单校验失败时不调用宿主 API', async () => {
  const shim = createReactShim();
  const handlers = {
    fetch: async (url, init) => {
      if (init && init.method === 'POST') return { ok: true, status: 200, async json() { return { ok: true }; } };
      return { ok: true, status: 200, async json() { return snapshot(); } };
    },
  };
  const { exports, calls } = await loadBundle(shim, handlers);
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);
  byClass(tree, 'sml-btn--primary').find((b) => collectText(b).join('').includes('添加')).props.onClick();
  tree = await shim.render(Page);

  // 表单为空 → 点确定 → 应出现错误提示且不发请求
  const okBtn = byClass(tree, 'sml-btn--primary').filter((b) => collectText(b).join('').includes('确定'))[0];
  assert.ok(okBtn, '应有确定按钮');
  await okBtn.props.onClick();
  await new Promise((r) => setTimeout(r, 0));
  tree = await shim.render(Page);

  const errs = byClass(tree, 'sml-err');
  assert.ok(errs.length >= 1, '校验失败必须显示错误');
  assert.ok(collectText(errs[0]).join('').includes('kebab-case') || collectText(errs[0]).join('').includes('描述'));
  assert.equal(calls.filter((c) => c.init && c.init.method === 'POST').length, 0, '校验失败不得提交');
});

test('安装成功：调用宿主 API 并显示成功反馈', async () => {
  const shim = createReactShim();
  const posted = [];
  const handlers = {
    fetch: async (url, init) => {
      if (init && init.method === 'POST') {
        posted.push(JSON.parse(init.body));
        return { ok: true, status: 200, async json() { return { target: 'demo-skill', action: 'install' }; } };
      }
      return { ok: true, status: 200, async json() { return snapshot(); } };
    },
  };
  const { exports, elements } = await loadBundle(shim, handlers);
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);
  byClass(tree, 'sml-btn--primary').find((b) => collectText(b).join('').includes('添加')).props.onClick();
  tree = await shim.render(Page);

  // 通过 DOM 注入表单值（弹窗从 DOM 读回）
  const setVal = (id, v) => { elements[id] = { value: v, checked: false }; };
  setVal('sml-skill-name', 'demo-skill');
  setVal('sml-skill-desc', 'A demo skill.');
  setVal('sml-skill-when', '');
  setVal('sml-skill-body', '# Demo');

  const okBtn = byClass(tree, 'sml-btn--primary').filter((b) => collectText(b).join('').includes('确定'))[0];
  await okBtn.props.onClick();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  tree = await shim.render(Page);

  assert.equal(posted.length, 1, '必须提交一次');
  assert.deepEqual(posted[0], {
    action: 'install_skill',
    spec: { name: 'demo-skill', description: 'A demo skill.', whenToUse: '', body: '# Demo' },
  });
  // 成功后弹窗关闭并显示成功反馈
  assert.equal(byClass(tree, 'sml-modal').length, 0, '成功后弹窗应关闭');
  const oks = byClass(tree, 'sml-ok');
  assert.ok(oks.length >= 1, '应显示成功反馈');
  assert.ok(collectText(oks[0]).join('').includes('已安装 demo-skill'));
});

test('安装失败：显示宿主返回的错误并保留弹窗', async () => {
  const shim = createReactShim();
  const handlers = {
    fetch: async (url, init) => {
      if (init && init.method === 'POST') {
        return { ok: false, status: 500, async json() { return { ok: false, error: 'skill "demo" 已存在' }; } };
      }
      return { ok: true, status: 200, async json() { return snapshot(); } };
    },
  };
  const { exports, elements } = await loadBundle(shim, handlers);
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);
  byClass(tree, 'sml-btn--primary').find((b) => collectText(b).join('').includes('添加')).props.onClick();
  tree = await shim.render(Page);

  const setVal = (id, v) => { elements[id] = { value: v, checked: false }; };
  setVal('sml-skill-name', 'demo');
  setVal('sml-skill-desc', 'dup');
  setVal('sml-skill-when', '');
  setVal('sml-skill-body', '');

  const okBtn = byClass(tree, 'sml-btn--primary').filter((b) => collectText(b).join('').includes('确定'))[0];
  await okBtn.props.onClick();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  tree = await shim.render(Page);

  const errs = byClass(tree, 'sml-err');
  assert.ok(errs.some((e) => collectText(e).join('').includes('已存在')), '必须显示宿主返回的错误');
  assert.ok(byClass(tree, 'sml-modal').length >= 1, '失败后弹窗应保留，便于修改重试');
});

test('样式表包含卡片栅格与响应式断点', async () => {
  const shim = createReactShim();
  const { exports, injected } = await loadBundle(shim);
  mountPage(exports);
  assert.equal(injected.length, 1, '必须注入一份样式');
  const css = injected[0].textContent;
  assert.match(css, /\.sml-grid\{[^}]*repeat\(auto-fill,minmax\(300px,1fr\)\)/, '卡片栅格必须用 auto-fill 300px');
  assert.match(css, /@media \(max-width:680px\)/, '必须有 680px 响应式断点');
  assert.match(css, /\.sml-itemDesc\{[^}]*-webkit-line-clamp:2/, '描述必须两行截断');
  assert.match(css, /\.sml-itemFoot\{[^}]*margin-top:auto/, '操作区应贴底对齐');
  assert.match(css, /\.sml-mask\{/, '必须有弹窗遮罩样式');
  assert.match(css, /--dsw-alias-/, '必须复用 DSH 设计令牌');
});
