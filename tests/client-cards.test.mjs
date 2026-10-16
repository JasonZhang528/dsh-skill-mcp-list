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
  let refs = [];
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
    // ref 必须在多次渲染之间保持同一个对象——真实 React 正是如此，
    // 若每次渲染新建，父组件通过 ref 读到的东西会在下一次渲染时丢掉。
    useRef(init) {
      const i = cursor++;
      if (!(i in refs)) refs[i] = { current: init };
      return refs[i];
    },
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

/**
 * 打开「添加」弹窗并切到「安装 Skill」分段。
 * 默认停在「配置 MCP」，因此需要显式切换后才能测 Skill 表单。
 * @param {object} shim React 垫片
 * @param {Function} Page 页面组件
 * @returns {Promise<object>} 切换后的元素树
 */
async function openInstallModal(shim, Page) {
  let tree = await shim.render(Page);
  byClass(tree, 'sml-btn--primary').find((b) => collectText(b).join('').includes('添加')).props.onClick();
  tree = await shim.render(Page);
  const segs = byClass(tree, 'sml-segBtn');
  segs[0].props.onClick();
  return shim.render(Page);
}

test('bundle 注册工厂并导出 apply / inject', async () => {
  const shim = createReactShim();
  const { exports } = await loadBundle(shim);
  assert.equal(typeof exports.apply, 'function');
  // sessions 用于解析"当前会话视角"：skill 可见性按作用域链合并。
  assert.deepEqual(exports.inject, ['sessions', 'slots']);
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

test('头部「添加」默认停在「配置 MCP」分段', async () => {
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
  assert.ok(collectText(modal[0]).join('').includes('配置 MCP'), '默认标题应为配置 MCP');

  // 默认高亮第二个分段，且渲染的是 MCP 配置表单
  const segs = byClass(withModal, 'sml-segBtn');
  assert.equal(segs.length, 2, '应有「安装 Skill」与「配置 MCP」两个分段');
  assert.ok(collectText(segs[0]).join('').includes('安装 Skill'), '分段顺序保持安装在前');
  assert.ok(collectText(segs[1]).join('').includes('配置 MCP'));
  assert.equal(segs[1].props.className.includes('is-on'), true, '默认应高亮「配置 MCP」');
  assert.equal(segs[0].props.className.includes('is-on'), false);
  // 默认应取第一个 MCP 条目，并渲染其条目名
  assert.ok(collectText(modal[0]).join('').includes('mcp-dbx'), '默认应选中首个 MCP 条目');
  assert.equal(byId(withModal, 'sml-skill-name').length, 0, '默认不应渲染 Skill 表单');
});

test('切到「安装 Skill」分段后渲染 Skill 表单', async () => {
  const shim = createReactShim();
  const { exports } = await loadBundle(shim);
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);
  byClass(tree, 'sml-btn--primary').find((b) => collectText(b).join('').includes('添加')).props.onClick();
  tree = await shim.render(Page);

  const segs = byClass(tree, 'sml-segBtn');
  segs[0].props.onClick();
  tree = await shim.render(Page);

  assert.ok(byClass(tree, 'sml-modal').length >= 1);
  assert.ok(byId(tree, 'sml-skill-name').length === 1, '应有名称输入框');
  assert.ok(byId(tree, 'sml-skill-desc').length === 1, '应有描述输入框');
  const segs2 = byClass(tree, 'sml-segBtn');
  assert.equal(segs2[0].props.className.includes('is-on'), true, '切换后应高亮「安装 Skill」');
});

test('无 MCP 条目时「添加」回退到「安装 Skill」', async () => {
  const shim = createReactShim();
  const empty = snapshot();
  empty.mcpServers = [];
  empty.summary.mcp = { total: 0, enabled: 0, disabled: 0, toggleable: 0, tools: 0, transports: [] };
  const { exports } = await loadBundle(shim, {
    fetch: async () => ({ ok: true, status: 200, async json() { return empty; } }),
  });
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);
  byClass(tree, 'sml-btn--primary').find((b) => collectText(b).join('').includes('添加')).props.onClick();
  tree = await shim.render(Page);

  const segs = byClass(tree, 'sml-segBtn');
  assert.equal(segs[0].props.className.includes('is-on'), true, '无 MCP 时应回退到「安装 Skill」');
  assert.ok(byId(tree, 'sml-skill-name').length === 1, '应渲染 Skill 表单');
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
  let tree = await openInstallModal(shim, Page);

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
  let tree = await openInstallModal(shim, Page);

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
  let tree = await openInstallModal(shim, Page);

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


// ------------------------------------------------------------ 归属标识与 MCP 表单
test('归属徽标：系统与用户分别标注', async () => {
  const shim = createReactShim();
  const base = snapshot();
  const { exports } = await loadBundle(shim, {
    fetch: async () => ({
      ok: true,
      status: 200,
      async json() {
        const data = base;
        data.skills = [
          { name: 'archify', description: 'A', provider: 'filesystem', source: 'user-dsh', origin: 'user', path: 'E:/a/SKILL.md', enabled: true, toggleable: true },
          { name: 'office-docx', description: 'B', provider: 'dsh-office', source: 'bundled', origin: 'system', path: null, enabled: true, toggleable: false, toggleReason: '提供方未暴露指令文件路径' },
        ];
        data.summary.skills = { total: 2, enabled: 2, disabled: 0, toggleable: 1, system: 1, user: 1, providers: ['filesystem', 'dsh-office'], sources: ['user-dsh', 'bundled'] };
        return data;
      },
    }),
  });
  const { Page } = mountPage(exports);
  const tree = await shim.render(Page);

  const userTags = byClass(tree, 'sml-tag--user');
  const sysTags = byClass(tree, 'sml-tag--sys');
  assert.equal(userTags.length, 1, '必须有一张卡片标记为"用户"');
  assert.equal(sysTags.length, 1, '必须有一张卡片标记为"系统"');
  // 徽标文案必须正好是两字术语，不得回退到旧的白话表述
  assert.equal(collectText(userTags[0]).join(''), '用户');
  assert.equal(collectText(sysTags[0]).join(''), '系统');
  // 头部卡片应给出系统 / 用户的拆分
  assert.ok(collectText(tree).join('').includes('系统 1 · 用户 1'), '统计卡必须展示归属拆分');
});

test('归属筛选：可只看用户归属的 Skill', async () => {
  const shim = createReactShim();
  const base = snapshot();
  const { exports } = await loadBundle(shim, {
    fetch: async () => ({
      ok: true,
      status: 200,
      async json() {
        const data = base;
        data.skills = [
          { name: 'archify', description: 'A', provider: 'filesystem', source: 'user-dsh', origin: 'user', enabled: true, toggleable: true },
          { name: 'office-docx', description: 'B', provider: 'dsh-office', source: 'bundled', origin: 'system', enabled: true, toggleable: false },
        ];
        data.summary.skills = { total: 2, enabled: 2, disabled: 0, toggleable: 1, system: 1, user: 1, providers: [], sources: [] };
        return data;
      },
    }),
  });
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);
  assert.equal(byClass(tree, 'sml-item').length, 2, '默认显示全部');

  const select = byClass(tree, 'sml-input').find((n) => n.props && n.props['aria-label'] === '按归属筛选');
  assert.ok(select, '必须有归属筛选下拉');
  select.props.onChange({ target: { value: 'user' } });
  tree = await shim.render(Page);
  assert.equal(byClass(tree, 'sml-item').length, 1, '筛选后只剩用户 Skill');
  assert.match(collectText(byClass(tree, 'sml-item')[0]).join(''), /archify/);
});

test('MCP 表单：勾选框受控、env/headers 可编辑、参数逐行', async () => {
  const shim = createReactShim();
  const { exports } = await loadBundle(shim);
  const { Page } = mountPage(exports);
  const tree = await shim.render(Page);

  // 打开「配置 MCP」弹窗（默认即停在此模式）。
  byClass(tree, 'sml-btn--primary').find((b) => collectText(b).join('').includes('添加')).props.onClick();
  const modal = await shim.render(Page);

  // 快照里的条目是 streamable-http，因此展示 URL 分支而非 stdio 参数；
  // stdio 的参数框由下一条用例（注入 stdio 快照）覆盖。
  assert.ok(byId(modal, 'sml-mcp-url').length >= 1, 'http 条目必须显示 URL 输入');

  // 2) 勾选框必须是受控的：checked 绑定 state，onChange 是真实处理器
  const fail = byId(modal, 'sml-mcp-fail')[0];
  assert.equal(typeof fail.props.onChange, 'function', '勾选框必须有 onChange');
  assert.equal(fail.props.checked, false, '初始值来自快照');
  fail.props.onChange();
  const after = await shim.render(Page);
  assert.equal(byId(after, 'sml-mcp-fail')[0].props.checked, true, '点击后必须真的翻转');

  // 3) http 条目应提供 headers 编辑，且回显已配置的键名
  const map = byId(after, 'sml-mcp-map')[0];
  assert.ok(map, '必须提供 env / headers 编辑框');
  assert.equal(map.type, 'textarea');
  assert.equal(map.props.value, '', '既有值已脱敏，不回显');

  // 4) 重连子字段随开关出现
  assert.ok(byId(after, 'sml-mcp-rc-initial').length >= 1, '开启重连后应显示子字段');
});

test('MCP 表单：提交按行解析 env 并带上重连子字段', async () => {
  const shim = createReactShim();
  const sent = [];
  const { exports } = await loadBundle(shim, {
    fetch: async (url, init) => {
      if (init && init.method === 'POST') {
        sent.push(JSON.parse(init.body));
        return { ok: true, status: 200, async json() { return { changed: true }; } };
      }
      return { ok: true, status: 200, async json() { return snapshot(); } };
    },
  });
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);
  byClass(tree, 'sml-btn--primary').find((b) => collectText(b).join('').includes('添加')).props.onClick();
  tree = await shim.render(Page);

  // stdio 条目才有 env；快照里是 http，这里直接改断言对象不现实，
  // 因此验证 http 分支：填 headers。
  const map = byId(tree, 'sml-mcp-map')[0];
  assert.ok(map, '必须找到 env / headers 输入框');
  map.props.onChange({ target: { value: 'Authorization=Bearer abc\nX-Trace=1' } });
  // 渲染若干轮，让表单的 useEffect 把最新状态同步到 formRef。
  tree = await shim.render(Page);
  assert.equal(byId(tree, 'sml-mcp-map')[0].props.value, 'Authorization=Bearer abc\nX-Trace=1', '输入必须被表单接收');

  const okBtn = byClass(tree, 'sml-btn--primary').filter((b) => collectText(b).join('').includes('确定'))[0];
  await okBtn.props.onClick();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const configure = sent.find((b) => b.action === 'configure_mcp');
  assert.ok(configure, '必须发出 configure_mcp 请求');
  assert.deepEqual(configure.config.headers, { Authorization: 'Bearer abc', 'X-Trace': '1' }, 'headers 必须按行解析');
  assert.equal(configure.config.reconnect.enabled, true, '重连开关必须随表单提交');
  assert.equal(typeof configure.config.reconnect.maxAttempts, 'number');
  assert.equal(configure.config.failOnStartupError, false);
});

test('提示文案：宿主报告未变更时不谎称"已更新"', async () => {
  const shim = createReactShim();
  const { exports } = await loadBundle(shim, {
    fetch: async (url, init) => {
      if (init && init.method === 'POST') return { ok: true, status: 200, async json() { return { changed: false }; } };
      return { ok: true, status: 200, async json() { return snapshot(); } };
    },
  });
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);

  const sw = byClass(tree, 'sml-sw')[0];
  assert.equal(typeof sw.props.onClick, 'function', '开关必须有 onClick 处理器');
  await sw.props.onClick();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  tree = await shim.render(Page);

  const ok = byClass(tree, 'sml-ok')[0];
  assert.ok(ok, '必须显示成功提示条');
  assert.match(collectText(ok).join(''), /无需改动/, 'changed=false 时必须如实说明，而不是显示已更新');
});


test('MCP 表单（stdio）：参数逐行编辑且不拆散含空格的参数', async () => {
  const shim = createReactShim();
  const sent = [];
  const stdioSnapshot = {
    ok: true,
    generatedAt: Date.now(),
    cwd: 'E:/WorkSpace/Projects/dsh',
    summary: { skills: { total: 0, enabled: 0, disabled: 0, toggleable: 0, system: 0, user: 0, providers: [], sources: [] }, mcp: { total: 1, enabled: 1, disabled: 0, toggleable: 1, tools: 0, transports: ['stdio'] } },
    skills: [],
    mcpServers: [{
      entryId: 'mcp-ct', serverName: 'chrome-devtools', transport: 'stdio', enabled: true, fiberPhase: 'active', toggleable: true,
      toolCount: 0, toolNames: [], toolCallTimeoutMs: 120000, failOnStartupError: false,
      connection: { kind: 'stdio', command: 'node', args: ['a b', '-y', 'C:/path with space/x.js'], cwd: 'D:/w', env: [{ name: 'TOKEN', value: '[redacted]' }] },
    }],
    capabilities: { skillToggle: true, skillInstall: true, mcpToggle: true, mcpConfigure: true, detail: true },
  };
  const { exports } = await loadBundle(shim, {
    fetch: async (url, init) => {
      if (init && init.method === 'POST') {
        sent.push(JSON.parse(init.body));
        return { ok: true, status: 200, async json() { return { changed: true }; } };
      }
      return { ok: true, status: 200, async json() { return stdioSnapshot; } };
    },
  });
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);
  byClass(tree, 'sml-btn--primary').find((b) => collectText(b).join('').includes('添加')).props.onClick();
  tree = await shim.render(Page);

  // 参数逐行回显：含空格的参数必须完整保留在一行里。
  const args = byId(tree, 'sml-mcp-args')[0];
  assert.ok(args, 'stdio 条目必须有参数输入');
  assert.equal(args.type, 'textarea', '参数必须逐行编辑');
  assert.equal(args.props.value, 'a b\n-y\nC:/path with space/x.js', '既有参数按行回显');

  // 填一个环境变量，验证 stdio 分支走 env 而非 headers。
  byId(tree, 'sml-mcp-map')[0].props.onChange({ target: { value: 'NEW_KEY=abc' } });
  // 勾上"启动失败即拒绝"，验证受控勾选框真的进入提交体。
  byId(tree, 'sml-mcp-fail')[0].props.onChange();
  tree = await shim.render(Page);

  const okBtn = byClass(tree, 'sml-btn--primary').filter((b) => collectText(b).join('').includes('确定'))[0];
  await okBtn.props.onClick();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const configure = sent.find((b) => b.action === 'configure_mcp');
  assert.ok(configure, '必须发出 configure_mcp 请求');
  assert.deepEqual(configure.config.args, ['a b', '-y', 'C:/path with space/x.js'], '含空格的参数不得被拆散');
  assert.deepEqual(configure.config.env, { NEW_KEY: 'abc' }, 'stdio 条目必须提交 env');
  assert.equal(configure.config.headers, undefined, '不得写入 headers');
  assert.equal(configure.config.failOnStartupError, true, '勾选框状态必须进入提交体');
});

// ---------------------------------------------- 前后端版本错配（旧宿主 + 新面板）
// 真实故障复现：客户端 bundle 的 rev 由文件 mtime/size 推导，改动后浏览器立即生效；
// 宿主模块只在进程启动时导入，未重启则不更新。于是"新面板 + 旧宿主"这一窗口期内，
// 宿主快照里没有 origin / system / user 字段——面板必须自行兜底，而不是显示 undefined。
test('版本错配：旧宿主不提供 origin / system / user 时不得显示 undefined', async () => {
  const shim = createReactShim();
  const legacy = {
    ok: true,
    generatedAt: Date.now(),
    cwd: 'E:/WorkSpace/Projects/dsh',
    // 故意使用旧版宿主的 summary：没有 system / user 计数。
    summary: {
      skills: { total: 2, enabled: 2, disabled: 0, toggleable: 1, providers: ['filesystem', 'dsh-office'], sources: ['user-dsh', 'bundled'] },
      mcp: { total: 0, enabled: 0, disabled: 0, toggleable: 0, tools: 0, transports: [] },
    },
    // 故意使用旧版宿主的 skill 投影：没有 origin 字段。
    skills: [
      { name: 'archify', description: 'A', provider: 'filesystem', source: 'user-dsh', path: 'E:/a/SKILL.md', enabled: true, toggleable: true },
      { name: 'office-docx', description: 'B', provider: 'dsh-office', source: 'bundled', path: null, enabled: true, toggleable: false },
    ],
    mcpServers: [],
    capabilities: { skillToggle: true, skillInstall: true, mcpToggle: true, mcpConfigure: true, detail: true },
  };
  const { exports } = await loadBundle(shim, {
    fetch: async () => ({ ok: true, status: 200, async json() { return legacy; } }),
  });
  const { Page } = mountPage(exports);
  const tree = await shim.render(Page);

  const all = collectText(tree).join('');
  assert.equal(all.includes('undefined'), false, '面板不得出现 undefined');
  assert.ok(all.includes('系统 1 · 用户 1'), '缺失计数时必须就地推导：' + all.slice(0, 200));

  // 徽标与筛选同样要兜底
  assert.equal(byClass(tree, 'sml-tag--user').length, 1, 'user-dsh 必须判为用户');
  assert.equal(byClass(tree, 'sml-tag--sys').length, 1, 'bundled 必须判为系统');
});

test('旧宿主的真实字段形态：reconnect 为 null、env / headers 为 {name,value} 数组', async () => {
  const shim = createReactShim();
  // 与线上旧宿主真实返回完全一致：stdio 条目 env 是数组、reconnect 是 null、
  // maxInstructionBytes 是 null；http 条目 headers 是数组且不含 env 键。
  const real = {
    ok: true,
    generatedAt: Date.now(),
    cwd: 'D:/ProgramData/DeepSeek/.dsh/profiles/desktop',
    summary: {
      skills: { total: 0, enabled: 0, disabled: 0, toggleable: 0, providers: [], sources: [] },
      mcp: { total: 2, enabled: 2, disabled: 0, toggleable: 2, tools: 53, transports: ['stdio', 'streamable-http'] },
    },
    skills: [],
    mcpServers: [
      {
        entryId: 'include:mcp-chrome-devtools', serverName: 'chrome-devtools', transport: 'stdio', enabled: true,
        fiberPhase: 'active', toggleable: true, toolCount: 30, toolNames: [],
        toolCallTimeoutMs: 120000, failOnStartupError: false, reconnect: null, maxInstructionBytes: null,
        connection: { kind: 'stdio', command: 'node', args: ['a b'], cwd: 'D:/w', env: [] },
      },
      {
        entryId: 'include:mcp-siyuan', serverName: 'siyuan', transport: 'streamable-http', enabled: true,
        fiberPhase: 'active', toggleable: true, toolCount: 30, toolNames: [],
        toolCallTimeoutMs: 60000, failOnStartupError: false, reconnect: null, maxInstructionBytes: null,
        connection: { kind: 'streamable-http', url: 'http://h/mcp', headers: [{ name: 'Authorization', value: '[redacted]' }] },
      },
    ],
    capabilities: { skillToggle: true, skillInstall: true, mcpToggle: true, mcpConfigure: true, detail: true },
  };
  const { exports } = await loadBundle(shim, {
    fetch: async () => ({ ok: true, status: 200, async json() { return real; } }),
  });
  const { Page } = mountPage(exports);
  let tree = await shim.render(Page);
  assert.equal(collectText(tree).join('').includes('undefined'), false, '列表不得出现 undefined');

  // 打开配置 MCP：默认选中第一个条目（chrome-devtools，stdio）
  byClass(tree, 'sml-btn--primary').find((b) => collectText(b).join('').includes('添加')).props.onClick();
  tree = await shim.render(Page);
  assert.ok(byId(tree, 'sml-mcp-args').length >= 1, 'stdio 条目必须渲染参数框');
  assert.ok(byId(tree, 'sml-mcp-map').length >= 1, 'stdio 条目必须渲染 env 框');
  assert.equal(byId(tree, 'sml-mcp-fail')[0].props.checked, false, 'reconnect=null 不得影响渲染');
  assert.equal(collectText(tree).join('').includes('undefined'), false, 'stdio 表单不得出现 undefined');

  // 切到 http 条目（siyuan）：应显示 headers 且列出现有键名
  const closeBtn = byClass(tree, 'sml-btn').find((b) => (b.props['aria-label'] || '') === '关闭');
  if (closeBtn) closeBtn.props.onClick();
  tree = await shim.render(Page);
  // 默认停在 Skill 标签页，切到 MCP 才能看到服务器卡片。
  byClass(tree, 'sml-tab').find((b) => collectText(b).join('').includes('MCP')).props.onClick();
  tree = await shim.render(Page);
  const siyuanRow = byClass(tree, 'sml-item').find((n) => collectText(n).join('').includes('siyuan'));
  assert.ok(siyuanRow, '必须找到 siyuan 卡片');
  byClass(siyuanRow, 'sml-btn').find((b) => collectText(b).join('') === '配置').props.onClick();
  tree = await shim.render(Page);
  assert.ok(byId(tree, 'sml-mcp-url').length >= 1, 'http 条目必须渲染 URL');
  assert.match(collectText(tree).join(''), /已配置的键：Authorization/, '必须列出现有键名且不回显值');
  assert.equal(collectText(tree).join('').includes('undefined'), false, 'http 表单不得出现 undefined');
});

test('排序：系统 Skill 排在用户 Skill 之前（旧宿主无 origin 亦成立）', async () => {
  const shim = createReactShim();
  // 故意把用户 Skill 放在第一位，且不给 origin 字段（模拟旧宿主）
  const legacy = {
    ok: true,
    generatedAt: Date.now(),
    cwd: 'E:/WorkSpace/Projects/dsh',
    summary: {
      skills: { total: 3, enabled: 3, disabled: 0, toggleable: 1, providers: [], sources: [] },
      mcp: { total: 0, enabled: 0, disabled: 0, toggleable: 0, tools: 0, transports: [] },
    },
    skills: [
      { name: 'archify', description: 'A', provider: 'filesystem', source: 'user-dsh', enabled: true, toggleable: true },
      { name: 'office-docx', description: 'B', provider: 'dsh-office', source: 'bundled', enabled: true, toggleable: false },
      { name: 'office-pptx', description: 'C', provider: 'dsh-office', source: 'bundled', enabled: true, toggleable: false },
    ],
    mcpServers: [],
    capabilities: { skillToggle: true, skillInstall: true, mcpToggle: true, mcpConfigure: true, detail: true },
  };
  const { exports } = await loadBundle(shim, {
    fetch: async () => ({ ok: true, status: 200, async json() { return legacy; } }),
  });
  const { Page } = mountPage(exports);
  const tree = await shim.render(Page);

  const names = byClass(tree, 'sml-item').map((c) => collectText(byClass(c, 'sml-itemName')[0]).join(''));
  assert.deepEqual(names, ['office-docx', 'office-pptx', 'archify'], '系统两项在前且按名称升序，用户 Skill 在后');
});
