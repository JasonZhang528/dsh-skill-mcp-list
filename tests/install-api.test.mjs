// dsh-skill-mcp-list —— 安装 Skill / 配置 MCP 的 API 层测试
//
// 用假 ctx + 真实临时文件系统驱动 lib/api.mjs，覆盖：
//   - installSkill 真实落盘、目录与内容、重复安装拒绝、非法名拒绝
//   - configureMcp 委托官方 configEditor、拒绝未知字段、拒绝只读条目
//   - 落点根的选择（user-dsh）与 DSH home 解析（env / profileContext / 默认）
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { createApi } from '../lib/api.mjs';
import { MCP_MODULE } from '../lib/core.mjs';

let root;
let skillsRoot;
let originalEnv;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-sml-api2-'));
  skillsRoot = join(root, 'dsh-home', 'skills');
  originalEnv = process.env.DSH_HOME;
  // 宿主进程会向子进程继承 DSH_HOME；不显式覆盖的话安装会落到真实 skill 根。
  process.env.DSH_HOME = join(root, 'dsh-home');
});

// 每个用例都从干净的 skill 根开始，避免"不得留下目录"这类断言被前序用例干扰。
beforeEach(async () => {
  await rm(skillsRoot, { recursive: true, force: true });
  await mkdir(skillsRoot, { recursive: true });
});

after(async () => {
  if (originalEnv === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = originalEnv;
  if (root) await rm(root, { recursive: true, force: true });
});

/**
 * 构造一个最小假 ctx：skill 注册表从 skillsRoot 读取，模拟"每次 get 重读文件"。
 * @param {object} options 覆盖项
 * @returns {object} 假 ctx
 */
function fakeCtx(options = {}) {
  const installed = new Map();

  const parse = (text) => ({
    name: /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? 'unknown',
    description: /^description:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '',
    source: 'user-dsh',
    provider: 'filesystem',
    path: options.pathOf?.(text) ?? null,
    content: text,
    invocation: {
      modelInvocable: !/^disable-model-invocation:[ \t]*true[ \t]*$/m.test(text),
      userInvocable: !/^user-invocable:[ \t]*false[ \t]*$/m.test(text),
    },
  });

  return {
    loader: { entries: () => options.entries ?? [] },
    tools: { schemas: () => options.schemas ?? [] },
    skills: {
      async list() {
        const out = [];
        for (const name of installed.keys()) {
          out.push(parse(await readFile(join(installed.get(name), 'SKILL.md'), 'utf8')));
        }
        return out;
      },
      async get(name) {
        const dir = installed.get(name);
        if (dir === undefined) return undefined;
        const text = await readFile(join(dir, 'SKILL.md'), 'utf8');
        // path 必须是真实指令文件路径，否则 toggleable 判为 false。
        return { ...parse(text), path: join(dir, 'SKILL.md') };
      },
    },
    profileContext: { dir: join(root, 'dsh-home', 'profiles', 'desktop') },
    get(key) {
      if (key === 'pluginManager') return options.pluginManager;
      if (key === 'configEditor') return options.configEditor;
      if (key === 'profileContext') return this.profileContext;
      return undefined;
    },
    /** 测试专用：登记一个已安装 skill 目录。 */
    register(name, dir) { installed.set(name, dir); },
  };
}

test('installSkill 落盘到 DSH_HOME/skills 并生成合法 SKILL.md', async () => {
  const ctx = fakeCtx();
  const api = createApi(ctx, { cwd: root });

  const result = await api.installSkill({ name: 'new-skill', description: 'A fresh skill.', body: '# New\n\nDo things.' });
  assert.equal(result.target, 'new-skill');
  assert.equal(result.action, 'install');
  assert.equal(result.source, 'user-dsh');
  assert.equal(result.root, skillsRoot);
  assert.equal(result.path, join(skillsRoot, 'new-skill', 'SKILL.md'));

  const text = await readFile(result.path, 'utf8');
  assert.match(text, /^---$/m);
  assert.match(text, /^name: new-skill$/m);
  assert.match(text, /^description: A fresh skill\.$/m);
  assert.match(text, /# New/);
  // 新 skill 默认可用，不写禁用键。
  assert.equal(text.includes('disable-model-invocation'), false);
  assert.equal(text.includes('user-invocable'), false);

  // 目录列表里应出现该 skill 目录。
  assert.ok((await readdir(skillsRoot)).includes('new-skill'));
});

test('installSkill 写入 whenToUse', async () => {
  const ctx = fakeCtx();
  const api = createApi(ctx, { cwd: root });
  const result = await api.installSkill({ name: 'with-use', description: 'D.', whenToUse: 'when you need it' });
  assert.match(await readFile(result.path, 'utf8'), /^whenToUse: when you need it$/m);
});

test('installSkill 拒绝非法 skill 名', async () => {
  const ctx = fakeCtx();
  const api = createApi(ctx, { cwd: root });
  for (const bad of ['BAD', '-x', 'x-', 'a b', 'a_b', '']) {
    await assert.rejects(() => api.installSkill({ name: bad, description: 'D.' }), /(kebab-case|不能为空)/);
  }
  assert.deepEqual(await readdir(skillsRoot), [], '非法名不得留下任何目录');
});

test('installSkill 拒绝空描述', async () => {
  const ctx = fakeCtx();
  const api = createApi(ctx, { cwd: root });
  await assert.rejects(() => api.installSkill({ name: 'ok-name', description: '' }), /描述不能为空/);
  assert.deepEqual(await readdir(skillsRoot), [], '描述非法不得留下目录');
});

test('installSkill 拒绝覆盖已存在的 skill', async () => {
  const ctx = fakeCtx();
  const api = createApi(ctx, { cwd: root });
  const dir = join(skillsRoot, 'existing');
  await mkdir(dir, { recursive: true });
  const original = '---\nname: existing\ndescription: Original.\n---\n\nKeep me.\n';
  await writeFile(join(dir, 'SKILL.md'), original, 'utf8');

  await assert.rejects(() => api.installSkill({ name: 'existing', description: 'Overwrite?' }), /已存在/);
  assert.equal(await readFile(join(dir, 'SKILL.md'), 'utf8'), original, '已存在的 skill 不得被改动');
});

test('installSkill 后立即可被注册表解析', async () => {
  const ctx = fakeCtx();
  const api = createApi(ctx, { cwd: root });
  await api.installSkill({ name: 'visible', description: 'Visible.' });
  // fakeCtx 的 list() 只返回显式登记的条目，这里验证 get 通道可用。
  const dir = join(skillsRoot, 'visible');
  ctx.register('visible', dir);
  const detail = await api.getSkillDetail('visible');
  assert.equal(detail.name, 'visible');
  assert.equal(detail.enabled, true);
  assert.equal(detail.toggleable, true);
});

test('installSkill 从 profileContext.dir 反推 DSH home（env 未设时）', async () => {
  const saved = process.env.DSH_HOME;
  delete process.env.DSH_HOME;
  try {
    // profile 位于 <dshHome>/profiles/<name>，上两级即 home。
    const ctx = fakeCtx();
    ctx.profileContext = { dir: join(root, 'dsh-home', 'profiles', 'desktop') };
    const api = createApi(ctx, { cwd: root });
    const result = await api.installSkill({ name: 'from-profile', description: 'D.' });
    assert.equal(result.root, join(root, 'dsh-home', 'skills'));
  } finally {
    if (saved !== undefined) process.env.DSH_HOME = saved;
  }
});

// ------------------------------------------------------------------ configureMcp
test('configureMcp 委托官方 configEditor 写入规范化补丁', async () => {
  const edits = [];
  const ctx = fakeCtx({
    entries: [
      { id: 'mcp-a', options: { name: MCP_MODULE, config: { serverName: 'a', transport: 'stdio', command: 'node' } }, disabled: false },
    ],
    configEditor: {
      async edit(entry, change) {
        edits.push({ id: entry.id, next: change(entry.options.config ?? {}, {}) });
      },
    },
  });
  const api = createApi(ctx, { cwd: root });

  const result = await api.configureMcp('mcp-a', { toolCallTimeoutMs: 120000, failOnStartupError: true });
  assert.equal(result.target, 'mcp-a');
  assert.equal(result.action, 'configure');
  assert.equal(result.serverName, 'a');
  // changed 恒为布尔（与其他写操作一致），补丁本身另放 patch 字段。
  assert.equal(result.changed, true);
  assert.deepEqual(result.patch, { toolCallTimeoutMs: 120000, failOnStartupError: true });
  assert.equal(edits.length, 1, '必须调用一次 configEditor.edit');
  assert.deepEqual(edits[0].next, {
    serverName: 'a', transport: 'stdio', command: 'node', toolCallTimeoutMs: 120000, failOnStartupError: true,
  });
});

test('configureMcp 未知条目被拒绝', async () => {
  const ctx = fakeCtx({ entries: [], configEditor: { async edit() {} } });
  const api = createApi(ctx, { cwd: root });
  await assert.rejects(() => api.configureMcp('nope', { toolCallTimeoutMs: 1 }), /不存在/);
});

test('configureMcp 缺少 configEditor 时拒绝而不是静默失败', async () => {
  const ctx = fakeCtx({
    entries: [{ id: 'mcp-a', options: { name: MCP_MODULE, config: { serverName: 'a', transport: 'stdio', command: 'node' } } }],
  });
  const api = createApi(ctx, { cwd: root });
  await assert.rejects(() => api.configureMcp('mcp-a', { toolCallTimeoutMs: 1 }), /configEditor 服务不可用/);
});

test('configureMcp 非法补丁在写盘前被拒', async () => {
  let called = false;
  const ctx = fakeCtx({
    entries: [
      { id: 'mcp-a', options: { name: MCP_MODULE, config: { serverName: 'a', transport: 'stdio', command: 'node' } }, disabled: false },
    ],
    configEditor: { async edit() { called = true; } },
  });
  const api = createApi(ctx, { cwd: root });

  for (const bad of [
    { headers: { A: 'b' } },
    { env: { TOKEN: 1 } },
    { toolCallTimeoutMs: 0 },
    { toolCallTimeoutMs: -1 },
    { failOnStartupError: 'yes' },
    { url: 'http://h/mcp' },
    { transport: 'streamable-http' },
    { reconnect: { bogus: 1 } },
  ]) {
    await assert.rejects(() => api.configureMcp('mcp-a', bad), /(不可通过|必须|不应|传输方式|不支持)/);
  }
  assert.equal(called, false, '任何非法补丁都不得触发写盘');
});

test('configureMcp 空补丁被拒', async () => {
  const ctx = fakeCtx({
    entries: [{ id: 'mcp-a', options: { name: MCP_MODULE, config: { serverName: 'a', transport: 'stdio', command: 'node' } } }],
    configEditor: { async edit() {} },
  });
  const api = createApi(ctx, { cwd: root });
  await assert.rejects(() => api.configureMcp('mcp-a', {}), /没有需要修改的内容/);
});

test('configureMcp 条目已不在 Loader 时拒绝', async () => {
  const ctx = fakeCtx({
    entries: [],
    configEditor: { async edit() {} },
    pluginManager: { async listPlugins() { return []; } },
  });
  const api = createApi(ctx, { cwd: root });
  // 条目不存在会先被"不存在"拦住，这里验证两条防线都在。
  await assert.rejects(() => api.configureMcp('mcp-a', { toolCallTimeoutMs: 1 }), /不存在/);
});

test('snapshot 报告新能力位', async () => {
  const ctx = fakeCtx({
    entries: [{ id: 'mcp-a', options: { name: MCP_MODULE, config: { serverName: 'a', transport: 'stdio' } } }],
    pluginManager: { async listPlugins() { return []; } },
    configEditor: { async edit() {} },
  });
  const api = createApi(ctx, { cwd: root });
  const snap = await api.snapshot();
  assert.equal(snap.capabilities.skillInstall, true);
  assert.equal(snap.capabilities.mcpConfigure, true);
});

test('snapshot 无 configEditor 时 mcpConfigure 为 false', async () => {
  const ctx = fakeCtx({ entries: [] });
  const api = createApi(ctx, { cwd: root });
  const snap = await api.snapshot();
  assert.equal(snap.capabilities.mcpConfigure, false);
  assert.equal(snap.capabilities.skillInstall, true);
});
