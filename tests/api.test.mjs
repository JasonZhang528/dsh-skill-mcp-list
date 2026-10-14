// dsh-skill-mcp-list —— API 层集成测试
//
// 用假 ctx + 真实临时文件系统驱动 lib/api.mjs，覆盖：
//   - skill 列表投影、详情、启用/禁用对 SKILL.md 的真实改写
//   - 只读 skill（无路径 / runtime 提供方）必须拒绝写入
//   - MCP 列表、只读条目拒绝切换、可写条目委托 pluginManager
//   - 端到端：改写后的文件能被"重新发现"（模拟监视器失效后的重新读取）
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createApi, isSkillInstructionFile, writeFileAtomic } from '../lib/api.mjs';
import { KEY_MODEL, MCP_MODULE } from '../lib/core.mjs';

let root;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-sml-'));
});

after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

/**
 * 构造一个最小假 ctx：只实现 api.mjs 实际用到的接口。
 * @param {object} options 覆盖项
 * @returns {object} 假 ctx
 */
function fakeCtx(options = {}) {
  const skills = options.skills ?? new Map();
  return {
    loader: {
      entries() {
        return options.entries ?? [];
      },
    },
    tools: {
      schemas() {
        return options.schemas ?? [];
      },
    },
    skills: {
      async list() {
        return [...skills.values()].map((s) => s.summary);
      },
      async get(name) {
        return skills.get(name)?.detail;
      },
    },
    get(name) {
      if (name === 'pluginManager') return options.pluginManager;
      return undefined;
    },
  };
}

test('isSkillInstructionFile 只接受 .md 指令文件', () => {
  assert.equal(isSkillInstructionFile('C:/x/SKILL.md'), true);
  assert.equal(isSkillInstructionFile('C:/x/foo.md'), true);
  assert.equal(isSkillInstructionFile('C:/x/foo.txt'), false);
  assert.equal(isSkillInstructionFile('C:/x/package.json'), false);
  assert.equal(isSkillInstructionFile(''), false);
  assert.equal(isSkillInstructionFile(undefined), false);
});

test('writeFileAtomic 覆盖写入且不留临时文件', async () => {
  const dir = join(root, 'atomic');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  await writeFile(file, 'old', 'utf8');
  await writeFileAtomic(file, 'new');
  assert.equal(await readFile(file, 'utf8'), 'new');
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(dir), ['SKILL.md'], '临时文件必须被清理');
});

test('setSkillEnabled 真实改写 SKILL.md 并立即反映状态', async () => {
  const dir = join(root, 'skills', 'demo');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  const original = [
    '---',
    'name: demo',
    'description: Demo skill.',
    '---',
    '',
    '# Demo body',
    '',
  ].join('\n');
  await writeFile(file, original, 'utf8');

  // 假注册表：get() 每次重新解析文件，模拟官方 filesystem 提供方的"每次加载都重读"契约。
  const parse = (text) => ({
    name: 'demo',
    description: 'Demo skill.',
    source: 'user-dsh',
    provider: 'filesystem',
    path: file,
    content: text,
    invocation: {
      modelInvocable: !/^disable-model-invocation:[ \t]*true[ \t]*$/m.test(text),
      userInvocable: !/^user-invocable:[ \t]*false[ \t]*$/m.test(text),
    },
  });
  const ctx = fakeCtx({
    skills: new Map([
      ['demo', {
        summary: { name: 'demo', description: 'Demo skill.', source: 'user-dsh', provider: 'filesystem', path: file, invocation: { modelInvocable: true, userInvocable: true } },
        get detail() { return undefined; },
      }],
    ]),
  });
  // detail 需要动态解析，改用 getter 覆盖。
  ctx.skills.get = async (n) => (n === 'demo' ? parse(await readFile(file, 'utf8')) : undefined);
  ctx.skills.list = async () => [parse(await readFile(file, 'utf8'))].map((d) => ({
    name: d.name, description: d.description, source: d.source, provider: d.provider, path: d.path, invocation: d.invocation,
  }));

  const api = createApi(ctx, { cwd: root });

  const listed = await api.listSkills();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].enabled, true);
  assert.equal(listed[0].toggleable, true);

  // 禁用
  const off = await api.setSkillEnabled('demo', { enabled: false });
  assert.equal(off.changed, true);
  assert.equal(off.state.enabled, false);
  const afterOff = await readFile(file, 'utf8');
  assert.match(afterOff, /^disable-model-invocation: true$/m);
  assert.match(afterOff, /# Demo body/, '正文必须保留');

  // 重新列出应显示为禁用
  const listed2 = await api.listSkills();
  assert.equal(listed2[0].enabled, false);

  // 启用 = 删键，文件必须回到原文
  const on = await api.setSkillEnabled('demo', { enabled: true });
  assert.equal(on.state.enabled, true);
  assert.equal(await readFile(file, 'utf8'), original, '启用后文件应与原始内容逐字节一致');

  // user 面
  const userOff = await api.setSkillEnabled('demo', { enabled: false, field: 'user' });
  assert.equal(userOff.state.userInvocable, false);
  assert.match(await readFile(file, 'utf8'), /^user-invocable: false$/m);
});

test('setSkillEnabled 拒绝不可写目标', async () => {
  const ctx = fakeCtx();
  ctx.skills.get = async (n) => {
    if (n === 'no-path') return { name: 'no-path', description: 'x', provider: 'filesystem', content: '', invocation: { modelInvocable: true, userInvocable: true } };
    if (n === 'weird') return { name: 'weird', description: 'x', provider: 'filesystem', path: join(root, 'not-md.txt'), content: '', invocation: { modelInvocable: true, userInvocable: true } };
    return undefined;
  };
  const api = createApi(ctx, { cwd: root });

  await assert.rejects(() => api.setSkillEnabled('missing', { enabled: false }), /不存在/);
  await assert.rejects(() => api.setSkillEnabled('no-path', { enabled: false }), /没有可写的指令文件路径/);
  await assert.rejects(() => api.setSkillEnabled('weird', { enabled: false }), /没有可写的指令文件路径/);
});

test('setSkillEnabled 对无 frontmatter 的文件拒绝写入且不改动文件', async () => {
  const dir = join(root, 'nofm');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  await writeFile(file, 'just text\n', 'utf8');
  const ctx = fakeCtx();
  ctx.skills.get = async () => ({
    name: 'nofm', description: 'x', provider: 'filesystem', path: file, content: 'just text', invocation: { modelInvocable: true, userInvocable: true },
  });
  const api = createApi(ctx, { cwd: root });
  await assert.rejects(() => api.setSkillEnabled('nofm', { enabled: false }), /缺少 YAML frontmatter/);
  assert.equal(await readFile(file, 'utf8'), 'just text\n', '拒绝时必须保持原文件不变');
});

test('listMcpServers 合并 pluginManager 的可写目标', async () => {
  const ctx = fakeCtx({
    entries: [
      { id: 'mcp-a', options: { name: MCP_MODULE, config: { serverName: 'a', transport: 'stdio', command: 'node', env: { TOKEN: 'x' } } }, disabled: false, fiber: { state: 2 } },
      { id: 'mcp-b', options: { name: MCP_MODULE, config: { serverName: 'b', transport: 'streamable-http', url: 'http://h/mcp?token=leak', headers: { Authorization: 'Bearer zzz' } } }, disabled: true },
      { id: 'other', options: { name: 'some-other-plugin' } },
      { id: 'grp', options: { group: true, name: MCP_MODULE } },
    ],
    schemas: [{ name: 'mcp__a__ping' }, { name: 'mcp__a__list' }, { name: 'mcp__b__x' }, { name: 'read_file' }],
    pluginManager: {
      async listPlugins() {
        return [
          { entryId: 'mcp-a', patchId: 'mcp-a', moduleName: MCP_MODULE, enabled: true },
          { entryId: 'mcp-b', readOnlyReason: 'unaddressable', moduleName: MCP_MODULE, enabled: false },
        ];
      },
      async setPluginEnabled(id, enabled) {
        return { stage: 'enable', target: id, enabled };
      },
    },
  });
  const api = createApi(ctx, { cwd: root });
  const servers = await api.listMcpServers();

  assert.equal(servers.length, 2, '只收录 mcp-client 条目，跳过 group 与其他插件');
  assert.deepEqual(servers.map((s) => s.serverName), ['a', 'b']);

  const a = servers[0];
  assert.equal(a.toggleable, true);
  assert.equal(a.enabled, true);
  assert.equal(a.fiberPhase, 'active');
  assert.deepEqual(a.toolNames, ['mcp__a__list', 'mcp__a__ping']);
  assert.equal(a.toolCount, 2);

  const b = servers[1];
  assert.equal(b.toggleable, false);
  assert.equal(b.readOnlyReason, 'unaddressable');

  const json = JSON.stringify(servers);
  assert.equal(json.includes('leak'), false, 'URL 中的令牌不得外泄');
  assert.equal(json.includes('Bearer zzz'), false, '请求头凭据不得外泄');
  assert.equal(json.includes('"x"'), false, 'env 值不得外泄');
});

test('setMcpEnabled 委托 pluginManager 并拒绝只读目标', async () => {
  const calls = [];
  const ctx = fakeCtx({
    entries: [
      { id: 'mcp-a', options: { name: MCP_MODULE, config: { serverName: 'a', transport: 'stdio' } }, disabled: false },
      { id: 'mcp-b', options: { name: MCP_MODULE, config: { serverName: 'b', transport: 'stdio' } }, disabled: false },
    ],
    pluginManager: {
      async listPlugins() {
        return [
          { entryId: 'mcp-a', patchId: 'mcp-a', moduleName: MCP_MODULE, enabled: true },
          { entryId: 'mcp-b', readOnlyReason: 'management-required', moduleName: MCP_MODULE, enabled: true },
        ];
      },
      async setPluginEnabled(id, enabled) {
        calls.push([id, enabled]);
        return { stage: 'enable', target: id, enabled };
      },
    },
  });
  const api = createApi(ctx, { cwd: root });

  const ok = await api.setMcpEnabled('mcp-a', false);
  assert.equal(ok.enabled, false);
  assert.deepEqual(calls, [['mcp-a', false]]);

  await assert.rejects(() => api.setMcpEnabled('mcp-b', false), /不可切换/);
  await assert.rejects(() => api.setMcpEnabled('nope', false), /不存在/);
  assert.deepEqual(calls, [['mcp-a', false]], '只读目标不得触发任何写入');
});

test('缺少 pluginManager 时降级而不是崩溃', async () => {
  const ctx = fakeCtx({
    entries: [{ id: 'mcp-a', options: { name: MCP_MODULE, config: { serverName: 'a', transport: 'stdio' } }, disabled: false }],
  });
  const api = createApi(ctx, { cwd: root });
  const servers = await api.listMcpServers();
  assert.equal(servers.length, 1);
  assert.equal(servers[0].toggleable, false);
  assert.equal(servers[0].readOnlyReason, 'plugin-manager-unavailable');

  const snap = await api.snapshot();
  assert.equal(snap.capabilities.mcpToggle, false);
  assert.equal(snap.ok, true);
  await assert.rejects(() => api.setMcpEnabled('mcp-a', false), /pluginManager 服务不可用/);
});

test('snapshot 汇总结构完整', async () => {
  const ctx = fakeCtx({
    entries: [{ id: 'mcp-a', options: { name: MCP_MODULE, config: { serverName: 'a', transport: 'stdio' } }, disabled: false }],
    schemas: [{ name: 'mcp__a__ping' }],
    pluginManager: { async listPlugins() { return [{ entryId: 'mcp-a', patchId: 'mcp-a', moduleName: MCP_MODULE, enabled: true }]; } },
  });
  ctx.skills.list = async () => [
    { name: 's1', description: 'one', provider: 'filesystem', source: 'user-dsh', path: join(root, 'a/SKILL.md'), invocation: { modelInvocable: true, userInvocable: true } },
  ];
  const api = createApi(ctx, { cwd: root });
  const snap = await api.snapshot({ cwd: root });
  assert.equal(snap.ok, true);
  assert.equal(snap.cwd, root);
  assert.equal(snap.summary.skills.total, 1);
  assert.equal(snap.summary.mcp.total, 1);
  assert.equal(snap.summary.mcp.tools, 1);
  assert.deepEqual(snap.capabilities, {
    skillToggle: true,
    skillInstall: true,
    mcpToggle: true,
    mcpConfigure: false,
    detail: true,
  });
  assert.equal(typeof snap.generatedAt, 'number');
});

test('getSkillDetail 返回正文与元数据', async () => {
  const ctx = fakeCtx();
  // 假注册表必须按名解析，否则"不存在"用例无法被真正验证。
  ctx.skills.get = async (n) =>
    n === 'demo'
      ? {
          name: 'demo',
          description: 'Demo.',
          provider: 'filesystem',
          source: 'user-dsh',
          path: join(root, 'demo/SKILL.md'),
          content: '# Body',
          invocation: { modelInvocable: true, userInvocable: true },
          metadata: { version: '1' },
        }
      : undefined;
  const api = createApi(ctx, { cwd: root });
  const detail = await api.getSkillDetail('demo');
  assert.equal(detail.content, '# Body');
  assert.equal(detail.contentBytes, 6);
  assert.deepEqual(detail.metadata, { version: '1' });
  assert.equal(await api.getSkillDetail('missing'), null);
});
