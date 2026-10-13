// dsh-skill-mcp-list —— 客户端 bundle 契约测试
//
// 在不启动浏览器、不安装 jsdom 的前提下，用最小 React/DOM 垫片验证：
//   1. bundle 按 DSH 模块系统约定注册工厂（id 正确、factory 可调用）
//   2. 导出 apply / inject 两个契约字段
//   3. apply() 只注册两个槽位：sidebar.panellist 与 main
//   4. 页面组件能渲染「加载中」与「已加载」两种状态而不抛错
//   5. 数据来自 /api/skill-mcp-list，启停走 POST
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const CLIENT = join(import.meta.dirname, '..', 'lib', 'client.js');

/**
 * 最小 React 垫片：支持函数组件里用到的 5 个 hook，并允许重复渲染。
 * @returns {object} 垫片与渲染入口
 */
function createReactShim() {
  let states = [];
  let cursor = 0;
  let effects = [];

  const reset = () => {
    cursor = 0;
    effects = [];
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
      return [
        states[i],
        (next) => {
          states[i] = typeof next === 'function' ? next(states[i]) : next;
        },
      ];
    },
    useCallback(fn) {
      cursor++;
      return fn;
    },
    useEffect(fn) {
      cursor++;
      effects.push(fn);
    },
    useRef(init) {
      cursor++;
      return { current: init };
    },
  };

  /**
   * 渲染组件并反复执行 effect，直到输出稳定。
   * React 在 setState 后会重新渲染，这里用"文本不再变化"作为收敛条件，
   * 并设迭代上限，避免 effect 里重新取数造成无限循环。
   * @param {Function} Component 函数组件
   * @returns {Promise<object>} 收敛后的元素树
   */
  const render = async (Component) => {
    let tree;
    let previous = null;
    for (let i = 0; i < 8; i += 1) {
      reset();
      tree = Component();
      for (const fn of effects) {
        const cleanup = fn();
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      }
      // 让 effect 内发起的异步加载完成
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const text = JSON.stringify(collectTextStatic(tree));
      if (text === previous) break;
      previous = text;
    }
    return tree;
  };

  const cleanups = [];
  return { react, render, reset, get cleanups() { return cleanups; } };
}

/**
 * 收集元素树中的静态文本（供收敛判断使用）。
 * @param {unknown} node 节点
 * @param {string[]} out 输出数组
 * @returns {string[]} 文本片段
 */
function collectTextStatic(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectTextStatic(child, out));
    return out;
  }
  if (node.children) node.children.forEach((child) => collectTextStatic(child, out));
  return out;
}

/**
 * 递归收集元素树中的文本。
 * @param {unknown} node 节点
 * @param {string[]} out 输出数组
 * @returns {string[]} 文本片段
 */
function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, out));
    return out;
  }
  if (node.children) node.children.forEach((child) => collectText(child, out));
  return out;
}

/**
 * 递归收集 className 含指定片段的所有节点。
 * @param {unknown} node 节点
 * @param {string} fragment className 片段
 * @param {object[]} out 输出数组
 * @returns {object[]} 匹配节点
 */
function findByClass(node, fragment, out = []) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => findByClass(child, fragment, out));
    return out;
  }
  // 按 class 词元精确匹配："sml-tab" 不应命中 "sml-tabs" 容器。
  const cls = node.props && node.props.className;
  if (typeof cls === 'string' && cls.split(/\s+/).includes(fragment)) out.push(node);
  if (node.children) node.children.forEach((child) => findByClass(child, fragment, out));
  return out;
}

/**
 * 加载 bundle，捕获其工厂注册。
 * @param {object} reactShim React 垫片
 * @returns {Promise<{registration: object, exports: object}>}
 */
async function loadBundle(reactShim) {
  let registration = null;
  const injected = [];

  globalThis.window = {
    __ModuleLoader__: {
      load(reg) {
        registration = reg;
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    createElement() {
      return { dataset: {}, textContent: '', remove() {} };
    },
    head: {
      appendChild(el) {
        injected.push(el);
      },
    },
  };

  // 重新导入以触发顶层的 __ModuleLoader__.load 调用
  const url = pathToFileURL(CLIENT).href + '?v=' + Date.now();
  await import(url);

  assert.ok(registration !== null, 'bundle 必须调用 window.__ModuleLoader__.load');
  const requireShim = (spec) => {
    if (spec === 'react') return reactShim.react;
    throw new Error('测试垫片未提供模块: ' + spec);
  };
  const exports = registration.factory(requireShim);
  return { registration, exports, injected };
}

test('client bundle 注册工厂并导出 apply / inject', async () => {
  const shim = createReactShim();
  const { registration, exports, injected } = await loadBundle(shim);

  assert.equal(registration.id, 'dsh-skill-mcp-list', 'id 必须与 package.json 名称一致');
  assert.equal(typeof registration.factory, 'function');
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(exports.inject, ['slots']);

  // apply() 应注入样式
  const registrations = [];
  const ctx = {
    effect(fn) {
      const cleanup = fn();
      assert.equal(typeof cleanup, 'function', 'effect 必须返回清理函数');
      return cleanup;
    },
    slots: {
      inject(name, fn) {
        assert.ok(typeof name === 'string' && name.length > 0, '槽位名必须非空');
        fn();
      },
      register(options, component) {
        registrations.push({ options, component });
      },
    },
  };
  exports.apply(ctx);

  assert.equal(injected.length, 1, '必须注入一份样式');
  assert.equal(injected[0].dataset.plugin, 'dsh-skill-mcp-list');

  assert.equal(registrations.length, 2, '应只注册两个槽位');
  const panel = registrations.find((r) => r.options.name === 'sidebar.panellist');
  const main = registrations.find((r) => r.options.name === 'main');
  assert.ok(panel, '必须注册 sidebar.panellist');
  assert.ok(main, '必须注册 main');

  assert.equal(panel.options.id, 'skill-mcp-list');
  assert.equal(typeof panel.options.order, 'number');
  assert.equal(panel.options.label(), 'Skill 与 MCP');
  assert.equal(typeof panel.component, 'function');

  assert.equal(main.options.key, 'skill-mcp-list', 'main 的 key 必须与面板 id 一致');
  assert.equal(typeof main.component, 'function');
});

test('页面组件渲染加载态与数据态', async () => {
  const shim = createReactShim();
  const { exports } = await loadBundle(shim);

  const snapshot = {
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
      { entryId: 'mcp-dbx', serverName: 'dbx-mcp', moduleName: '@deepseek-ai/dsh-mcp-client', transport: 'streamable-http', enabled: true, fiberPhase: 'active', toggleable: true, toolCount: 3, toolNames: ['mcp__dbx-mcp__a', 'mcp__dbx-mcp__b', 'mcp__dbx-mcp__c'], connection: { kind: 'streamable-http', url: 'http://192.168.0.100:9005/mcp', headers: [] } },
    ],
    capabilities: { skillToggle: true, mcpToggle: true, detail: true },
  };

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async json() { return snapshot; } };
  };

  const registrations = [];
  exports.apply({
    effect(fn) { fn(); },
    slots: {
      inject(_name, fn) { fn(); },
      register(options, component) { registrations.push({ options, component }); },
    },
  });
  const Page = registrations.find((r) => r.options.name === 'main').component;

  // 首帧：加载中
  shim.reset();
  const first = Page();
  const firstText = collectText(first).join(' ');
  assert.match(firstText, /Skill 与 MCP/);
  assert.match(firstText, /正在加载/);

  // 第二帧：数据已到位
  const tree = await shim.render(Page);
  const text = collectText(tree).join(' ');
  assert.match(text, /archify/, '应渲染 skill 名称');
  assert.match(text, /fnos/);
  assert.match(text, /已启用/);
  assert.match(text, /已禁用/);
  // 切到 MCP 标签页：列表在独立 tab 下，需真实触发 onClick 才能验证。
  const tabs = findByClass(tree, 'sml-tab');
  const mcpTab = tabs.find((t) => collectText(t).join('').includes('MCP'));
  assert.ok(mcpTab, '应渲染 MCP 标签页');
  assert.equal(typeof mcpTab.props.onClick, 'function', '标签页必须可点击');
  mcpTab.props.onClick();
  const mcpTree = await shim.render(Page);
  const mcpText = collectText(mcpTree).join(' ');
  assert.match(mcpText, /dbx-mcp/, '应渲染 MCP 服务器名');
  assert.match(mcpText, /运行中/, '应渲染 fiber 阶段');
  assert.match(mcpText, /streamable-http/, '应渲染传输方式');
  assert.match(mcpText, /3 个工具/, '应渲染工具数量');

  // 统计卡片
  const cards = findByClass(mcpTree, 'sml-cardV');
  assert.ok(cards.length >= 4, '应渲染统计卡片');
  assert.ok(cards.some((c) => collectText(c).join('') === '2'), 'Skill 总数为 2');
  assert.ok(cards.some((c) => collectText(c).join('') === '3'), 'MCP 工具数为 3');

  // 数据来源
  assert.ok(calls.some((c) => c.url === '/api/skill-mcp-list'), '必须请求宿主 API');
  assert.equal(calls[0].init.credentials, 'same-origin', '必须带同源凭据');
});
