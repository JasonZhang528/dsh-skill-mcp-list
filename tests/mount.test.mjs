// dsh-skill-mcp-list —— 真实 Cordis 挂载测试
//
// 用从 DSH 安装中提取的真实 @deepseek-ai 运行时包，把插件挂到一个真实
// Cordis 应用上，验证：
//   1. 插件能加载并注册 skill_mcp_list 工具（schema 合法）
//   2. 无 Web 宿主时也能加载（可选服务降级）
//   3. 工具 execute 的读路径在真实注册表上跑通
//   4. 工具 execute 的写路径确实改写了 SKILL.md
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

// 这些包都是 ESM-only，且不在本项目的 node_modules 里，因此按绝对路径动态导入。
const RUNTIME = join(import.meta.dirname, '..', '.runtime', 'node_modules');
const runtimeImport = (pkg) => import(pathToFileURL(join(RUNTIME, pkg, 'lib', 'index.js')).href);

// 未执行 scripts/fetch-runtime.mjs 时跳过整个文件，而不是让测试报错。
const RUNTIME_READY = existsSync(join(RUNTIME, '@deepseek-ai', 'cordis', 'lib', 'index.js'));
const suite = RUNTIME_READY ? test : test.skip;

let Context, ToolRuntime, SkillRegistry, createScope, plugin, root;

before(async () => {
  if (!RUNTIME_READY) return;
  ({ Context } = await runtimeImport('@deepseek-ai/cordis'));
  ({ ToolRuntime } = await runtimeImport('@deepseek-ai/dsh-tools'));
  ({ SkillRegistry } = await runtimeImport('@deepseek-ai/dsh-skill'));
  ({ createScope } = await runtimeImport('@deepseek-ai/dsh-scope'));
  plugin = await import(pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.mjs')).href);
  root = await mkdtemp(join(tmpdir(), 'dsh-sml-mount-'));
});

after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

/**
 * 构造一个最小但真实的 Cordis 应用：真实 Service 类 + 假 Loader。
 * @param {object} options 覆盖项
 * @returns {Promise<object>} 应用句柄
 */
async function mount(options = {}) {
  const ctx = new Context();
  // ToolRuntime 在构造时会向 systemPrompt 注册工具目录；这里给一个最小实现，
  // 让真实注册表能在没有完整提示词装配的情况下工作。
  ctx.provide('systemPrompt', {
    tools() {},
    section() {},
    context() {},
    getSectionOrder: () => 0,
    getContextOrder: () => 0,
  });
  // ToolRuntime / SkillRegistry 都继承 Service，构造时已自行 provide，无需重复注册。
  const tools = new ToolRuntime(ctx, { mode: 'native' });
  const skills = new SkillRegistry(ctx, {});
  ctx.provide('loader', {
    entries() {
      return options.entries ?? [];
    },
  });
  if (options.sandboxPolicy) ctx.provide('sandboxPolicy', options.sandboxPolicy);

  const fiber = ctx.plugin(plugin);
  await fiber;
  return { ctx, tools, skills, fiber };
}

suite('插件在真实 Cordis 上加载并注册工具', async () => {
  const app = await mount();
  try {
    const tool = app.tools.get('skill_mcp_list');
    assert.ok(tool, '必须注册 skill_mcp_list 工具');
    assert.equal(tool.name, 'skill_mcp_list');
    assert.match(tool.description, /skills and MCP servers/i);
    assert.ok(tool.parameters, '必须声明参数 schema');
    assert.equal(tool.parameters.type, 'object');
    assert.deepEqual(tool.parameters.required, ['action']);
    assert.deepEqual(
      tool.parameters.properties.action.enum,
      [
        'list',
        'summary',
        'detail',
        'enable_skill',
        'disable_skill',
        'enable_mcp',
        'disable_mcp',
        'install_skill',
        'configure_mcp',
      ],
    );
    // object 参数必须显式声明 additionalProperties，否则官方 schema 编译器拒绝。
    assert.equal(tool.parameters.properties.spec.additionalProperties, true);
    assert.equal(tool.parameters.properties.config.additionalProperties, true);
    assert.deepEqual(tool.parameters.required, ['action']);
    assert.ok(app.ctx.get('skillMcpList'), '必须提供 skillMcpList 服务');
  } finally {
    await app.fiber.dispose();
  }
});

suite('缺少 webServer / pluginManager 时仍能加载（可选服务降级）', async () => {
  const app = await mount({ entries: [{ id: 'mcp-a', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'a', transport: 'stdio' } } }] });
  try {
    const api = app.ctx.get('skillMcpList');
    const snap = await api.snapshot();
    assert.equal(snap.ok, true);
    assert.equal(snap.capabilities.mcpToggle, false, '无 pluginManager 时应降级');
    assert.equal(snap.mcpServers.length, 1);
    assert.equal(snap.mcpServers[0].toggleable, false);
  } finally {
    await app.fiber.dispose();
  }
});

suite('读路径：list / summary 在真实注册表上返回合法 JSON', async () => {
  const dir = join(root, 'sk');
  await mkdir(join(dir, 'demo'), { recursive: true });
  const file = join(dir, 'demo', 'SKILL.md');
  await writeFile(file, '---\nname: demo\ndescription: Demo skill.\n---\n\nBody\n', 'utf8');

  const app = await mount({
    entries: [{ id: 'mcp-a', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'a', transport: 'stdio', env: { TOKEN: 'leak' } } }, disabled: false }],
  });
  try {
    // 注册一个假提供方，模拟 dsh-skill-filesystem 的发现结果。
    app.skills.registerProvider(() => ({
      name: 'filesystem',
      async list() {
        return [{
          name: 'demo', description: 'Demo skill.', source: 'user-dsh', provider: 'filesystem',
          rank: 400, path: file, locator: { path: file },
          invocation: { modelInvocable: true, userInvocable: true },
        }];
      },
      async get(candidate) {
        return {
          name: 'demo', description: 'Demo skill.', source: 'user-dsh', provider: 'filesystem',
          path: file, content: await readFile(file, 'utf8'),
          invocation: { modelInvocable: true, userInvocable: true },
        };
      },
    }));

    const tool = app.tools.get('skill_mcp_list');
    const exec = { signal: new AbortController().signal, callId: 't1' };

    const listOut = await tool.execute({ action: 'list', cwd: dir }, exec);
    const parsed = JSON.parse(listOut);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.summary.skills.total, 1);
    assert.equal(parsed.summary.mcp.total, 1);
    assert.equal(parsed.skills[0].name, 'demo');
    assert.equal(parsed.skills[0].enabled, true);
    assert.equal(JSON.stringify(parsed).includes('leak'), false, '凭据不得出现在工具输出中');

    const sumOut = await tool.execute({ action: 'summary', cwd: dir }, exec);
    assert.equal(JSON.parse(sumOut).summary.skills.total, 1);

    const detailOut = await tool.execute({ action: 'detail', target: 'demo', cwd: dir }, exec);
    assert.match(JSON.parse(detailOut).content, /Body/);
  } finally {
    await app.fiber.dispose();
  }
});

suite('写路径：disable_skill 真实改写文件，enable_skill 还原', async () => {
  const dir = join(root, 'wr');
  await mkdir(join(dir, 'demo'), { recursive: true });
  const file = join(dir, 'demo', 'SKILL.md');
  const original = '---\nname: demo\ndescription: Demo skill.\n---\n\nBody\n';
  await writeFile(file, original, 'utf8');

  // 权限升级：danger-full-access 等于当前模式时 approveEscalation 直接放行，无需审批通道。
  const app = await mount({ sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) } });
  try {
    app.skills.registerProvider(() => ({
      name: 'filesystem',
      async list() {
        const text = await readFile(file, 'utf8');
        return [{
          name: 'demo', description: 'Demo skill.', source: 'user-dsh', provider: 'filesystem',
          rank: 400, path: file, locator: { path: file },
          invocation: {
            modelInvocable: !/^disable-model-invocation:[ \t]*true[ \t]*$/m.test(text),
            userInvocable: !/^user-invocable:[ \t]*false[ \t]*$/m.test(text),
          },
        }];
      },
      async get() {
        const text = await readFile(file, 'utf8');
        return {
          name: 'demo', description: 'Demo skill.', source: 'user-dsh', provider: 'filesystem',
          path: file, content: text,
          invocation: {
            modelInvocable: !/^disable-model-invocation:[ \t]*true[ \t]*$/m.test(text),
            userInvocable: !/^user-invocable:[ \t]*false[ \t]*$/m.test(text),
          },
        };
      },
    }));

    const tool = app.tools.get('skill_mcp_list');
    const exec = { signal: new AbortController().signal, callId: 't2' };

    const offOut = await tool.execute({ action: 'disable_skill', target: 'demo', cwd: dir }, exec);
    const off = JSON.parse(offOut);
    assert.equal(off.changed, true);
    assert.equal(off.state.enabled, false);
    assert.match(await readFile(file, 'utf8'), /^disable-model-invocation: true$/m);

    const onOut = await tool.execute({ action: 'enable_skill', target: 'demo', cwd: dir }, exec);
    assert.equal(JSON.parse(onOut).state.enabled, true);
    assert.equal(await readFile(file, 'utf8'), original, '启用后应逐字节还原');
  } finally {
    await app.fiber.dispose();
  }
});

suite('权限不足时写操作被拒绝（不绕过沙箱）', async () => {
  const dir = join(root, 'deny');
  await mkdir(join(dir, 'demo'), { recursive: true });
  const file = join(dir, 'demo', 'SKILL.md');
  const original = '---\nname: demo\ndescription: D.\n---\n\nB\n';
  await writeFile(file, original, 'utf8');

  // read-only 模式且没有审批通道 → approveEscalation 必须抛错。
  const app = await mount({ sandboxPolicy: { resolve: () => ({ mode: 'read-only' }) } });
  try {
    app.skills.registerProvider(() => ({
      name: 'filesystem',
      async list() { return []; },
      async get() {
        return {
          name: 'demo', description: 'D.', source: 'user-dsh', provider: 'filesystem',
          path: file, content: await readFile(file, 'utf8'),
          invocation: { modelInvocable: true, userInvocable: true },
        };
      },
    }));

    const tool = app.tools.get('skill_mcp_list');
    const exec = { signal: new AbortController().signal, callId: 't3' };
    await assert.rejects(
      () => tool.execute({ action: 'disable_skill', target: 'demo', cwd: dir }, exec),
      /approval/i,
      '缺少审批通道时必须拒绝，而不是静默写入',
    );
    assert.equal(await readFile(file, 'utf8'), original, '被拒绝时文件不得改动');
  } finally {
    await app.fiber.dispose();
  }
});

// ---------------------------------------------------------------- 安装 Skill
suite('install_skill 真实 Cordis 上落盘并注册', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-sml-mount-home-'));
  const saved = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  let app;
  try {
    app = await mount({ sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) } });
    app.skills.registerProvider(() => ({
      name: 'filesystem',
      async list() { return []; },
      async get() { return undefined; },
    }));
    const tool = app.tools.get('skill_mcp_list');
    const exec = { signal: new AbortController().signal, callId: 'inst1' };

    const out = await tool.execute(
      { action: 'install_skill', spec: { name: 'mounted-skill', description: 'Mounted.', body: '# M' } },
      exec,
    );
    const result = JSON.parse(out);
    assert.equal(result.target, 'mounted-skill');
    assert.equal(result.action, 'install');
    assert.equal(result.path, join(home, 'skills', 'mounted-skill', 'SKILL.md'));
    assert.match(await readFile(result.path, 'utf8'), /^name: mounted-skill$/m);

    // 重复安装必须被拒。
    await assert.rejects(
      () => tool.execute({ action: 'install_skill', spec: { name: 'mounted-skill', description: 'X' } }, exec),
      /已存在/,
    );

    // 非法名必须被拒。
    await assert.rejects(
      () => tool.execute({ action: 'install_skill', spec: { name: 'BAD', description: 'X' } }, exec),
      /kebab-case/,
    );
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = saved;
    if (app !== undefined) await app.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

suite('install_skill 缺 spec 时报可读错误', async () => {
  const app = await mount({ sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) } });
  try {
    const tool = app.tools.get('skill_mcp_list');
    const exec = { signal: new AbortController().signal, callId: 'inst2' };
    await assert.rejects(
      () => tool.execute({ action: 'install_skill', spec: { name: 'ok-name', description: '' } }, exec),
      /描述不能为空/,
    );
  } finally {
    await app.fiber.dispose();
  }
});

// ---------------------------------------------------------------- 配置 MCP
suite('configure_mcp 走 configEditor 并返回规范化补丁', async () => {
  const edits = [];
  const app = await mount({
    entries: [{ id: 'mcp-a', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'a', transport: 'stdio', command: 'node' } }, disabled: false }],
    sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  });
  app.ctx.provide('configEditor', {
    async edit(entry, change) { edits.push({ id: entry.id, next: change(entry.options.config ?? {}, {}) }); },
  });
  try {
    const tool = app.tools.get('skill_mcp_list');
    const exec = { signal: new AbortController().signal, callId: 'cfg1' };

    const out = await tool.execute(
      { action: 'configure_mcp', target: 'mcp-a', config: { toolCallTimeoutMs: 120000, failOnStartupError: true } },
      exec,
    );
    const result = JSON.parse(out);
    assert.equal(result.action, 'configure');
    assert.equal(result.serverName, 'a');
    assert.equal(result.changed, true);
    assert.deepEqual(result.patch, { toolCallTimeoutMs: 120000, failOnStartupError: true });
    assert.equal(edits.length, 1);
    assert.equal(edits[0].next.command, 'node', '既有字段不得丢失');
    assert.equal(edits[0].next.toolCallTimeoutMs, 120000);

    // 非法补丁必须被拒且不触发写盘：headers 对 stdio 条目无意义（应改用 env）。
    await assert.rejects(
      () => tool.execute({ action: 'configure_mcp', target: 'mcp-a', config: { headers: { X: 'y' } } }, exec),
      /stdio 传输不支持 headers/,
    );
    assert.equal(edits.length, 1, '非法补丁不得触发 configEditor');
  } finally {
    await app.fiber.dispose();
  }
});

suite('configure_mcp 缺 configEditor 时拒绝', async () => {
  // 先放行权限升级，才能验证到 configEditor 缺失这一层。
  const app = await mount({
    entries: [{ id: 'mcp-a', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'a', transport: 'stdio', command: 'node' } } }],
    sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  });
  try {
    const tool = app.tools.get('skill_mcp_list');
    await assert.rejects(
      () => tool.execute({ action: 'configure_mcp', target: 'mcp-a', config: { toolCallTimeoutMs: 1 } }, { signal: new AbortController().signal, callId: 'cfg2' }),
      /configEditor 服务不可用/,
    );
  } finally {
    await app.fiber.dispose();
  }
});

suite('install_skill / configure_mcp 需要权限升级', async () => {
  const app = await mount({ sandboxPolicy: { resolve: () => ({ mode: 'read-only' }) } });
  try {
    const tool = app.tools.get('skill_mcp_list');
    const exec = { signal: new AbortController().signal, callId: 'cfg3' };
    for (const args of [
      { action: 'install_skill', spec: { name: 'x', description: 'y' } },
      { action: 'configure_mcp', target: 'mcp-a', config: { toolCallTimeoutMs: 1 } },
    ]) {
      await assert.rejects(() => tool.execute(args, exec), /approval/i);
    }
  } finally {
    await app.fiber.dispose();
  }
});

suite('插件卸载后工具与服务一并注销', async () => {
  const app = await mount();
  assert.ok(app.tools.get('skill_mcp_list'));
  await app.fiber.dispose();
  assert.equal(app.tools.get('skill_mcp_list'), undefined, '卸载后工具必须注销');
  assert.equal(app.ctx.get('skillMcpList'), undefined, '卸载后服务必须注销');
});

// ------------------------------------------------- 作用域视角（真实 Cordis）
// 回归：官方把每个 preset 的 skill-filesystem 注册在**该 preset 的作用域层**，
// 注册表读取是"全局层 + 调用方作用域链"的合并。因此不带 scope 的 list() 只看得到
// 全局层的提供方；本用例在真实 SkillRegistry 上验证两条路径的差异与工具接线。
suite('作用域视角：preset 层的 skill 必须可见，全局层不得冒充全量', async () => {
  const dir = join(root, 'scope');
  await mkdir(dir, { recursive: true });

  const app = await mount();
  try {
    // 全局层提供方：模拟 bundled 部署级 skill。
    app.skills.registerProvider(() => ({
      name: 'global-provider',
      async list() {
        return [{
          name: 'bundled-only', description: 'Bundled.', source: 'bundled', provider: 'global-provider',
          rank: 600, path: join(dir, 'bundled.md'), invocation: { modelInvocable: true, userInvocable: true },
        }];
      },
      async get() { return undefined; },
    }));

    // 作用域层提供方：挂在 scopeCtx 上，模拟 preset 内的 skill-filesystem。
    // 真实契约：agent 对象本身就是它的作用域键
    // （dsh-agent-loop: createScope(loopCtx, this)；dsh-tool-skill 传 scope: exec.agent）。
    const agent = { id: 'session-1' };
    const scoped = createScope(app.ctx, agent);
    scoped.ctx.skills.registerProvider(() => ({
      name: 'filesystem',
      async list() {
        return [{
          name: 'user-skill', description: 'User.', source: 'user-dsh', provider: 'filesystem',
          rank: 400, path: join(dir, 'user.md'), invocation: { modelInvocable: true, userInvocable: true },
        }];
      },
      async get() {
        return {
          name: 'user-skill', description: 'User.', source: 'user-dsh', provider: 'filesystem',
          path: join(dir, 'user.md'), content: '---\nname: user-skill\ndescription: User.\n---\n\nScoped body\n',
          invocation: { modelInvocable: true, userInvocable: true },
        };
      },
    }));

    const tool = app.tools.get('skill_mcp_list');
    const exec = { signal: new AbortController().signal, callId: 'scope1' };

    // 1) 全局视角：只看得到全局层提供方 —— 正是修复前的症状。
    const globalOut = JSON.parse(await tool.execute({ action: 'list', cwd: dir }, exec));
    assert.deepEqual(globalOut.skills.map((s) => s.name), ['bundled-only'], '无 scope 时只能看到全局层');

    // 2) 带 agent 视角：preset 层与全局层合并 —— 修复后的正确结果。
    const scopedOut = JSON.parse(await tool.execute({ action: 'list', cwd: dir, sessionId: 'n/a' }, { ...exec, agent }));
    assert.deepEqual(
      scopedOut.skills.map((s) => s.name).sort(),
      ['bundled-only', 'user-skill'],
      '带 agent 视角时必须合并 preset 层',
    );

    // 3) 详情也必须在同一视角内可取到。
    const detail = JSON.parse(await tool.execute({ action: 'detail', target: 'user-skill', cwd: dir }, { ...exec, agent }));
    assert.match(detail.content, /Scoped body/);

    // 4) 无视角时同一 skill 不可见 —— 证明视角是必要条件而非装饰。
    await assert.rejects(
      () => tool.execute({ action: 'detail', target: 'user-skill', cwd: dir }, exec),
      /未找到/,
    );
  } finally {
    await app.fiber.dispose();
  }
});
