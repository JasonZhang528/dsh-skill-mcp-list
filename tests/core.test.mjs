// dsh-skill-mcp-list —— 核心逻辑单元测试（node:test，零依赖）
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  KEY_MODEL,
  KEY_USER,
  invocationPatch,
  locateFrontmatter,
  maskSecretText,
  projectMcpServer,
  projectSkills,
  redactRecord,
  sanitizeArgs,
  sanitizeUrl,
  setFrontmatterKey,
  skillToggleability,
  summarize,
} from '../lib/core.mjs';

const SAMPLE = [
  '---',
  'name: demo-skill',
  'description: A demo skill.',
  'whenToUse: when testing',
  '---',
  '',
  '# Demo',
  '',
  'Body text with --- inside.',
  '',
].join('\n');

test('locateFrontmatter 只认文件首行的分隔符', () => {
  assert.notEqual(locateFrontmatter(SAMPLE), null);
  assert.equal(locateFrontmatter('# no frontmatter\n---\n---\n'), null);
  assert.equal(locateFrontmatter('---\nname: x\n'), null, '缺少闭合分隔符应为 null');
  assert.equal(locateFrontmatter(''), null);
  assert.equal(locateFrontmatter(null), null);
});

test('setFrontmatterKey 新增键并保持正文原样', () => {
  const out = setFrontmatterKey(SAMPLE, KEY_MODEL, true);
  assert.equal(out.ok, true);
  assert.equal(out.changed, true);
  assert.match(out.text, /^---\nname: demo-skill\n/m);
  assert.match(out.text, /\ndisable-model-invocation: true\n---\n/);
  assert.match(out.text, /Body text with --- inside\./);
  assert.equal(out.text.split('\n').length, SAMPLE.split('\n').length + 1);
});

test('setFrontmatterKey 覆盖已有键且不重复插入', () => {
  const once = setFrontmatterKey(SAMPLE, KEY_MODEL, true).text;
  const twice = setFrontmatterKey(once, KEY_MODEL, true);
  assert.equal(twice.changed, false, '幂等写入不应报告变更');
  assert.equal(twice.text, once);
  assert.equal(once.split(KEY_MODEL).length - 1, 1);

  const replaced = setFrontmatterKey(once, KEY_USER, false);
  assert.equal(replaced.changed, true);
  assert.match(replaced.text, /\nuser-invocable: false\n/);
});

test('setFrontmatterKey 删除键（启用即恢复默认）', () => {
  const disabled = setFrontmatterKey(SAMPLE, KEY_MODEL, true).text;
  const enabled = setFrontmatterKey(disabled, KEY_MODEL, null);
  assert.equal(enabled.ok, true);
  assert.equal(enabled.changed, true);
  assert.equal(enabled.text.includes(KEY_MODEL), false);
  assert.equal(enabled.text, SAMPLE, '删键后应与原文逐字节一致');
  const noop = setFrontmatterKey(SAMPLE, KEY_MODEL, null);
  assert.equal(noop.changed, false);
  assert.equal(noop.text, SAMPLE);
});

test('setFrontmatterKey 处理重复键与 CRLF', () => {
  const dup = '---\nname: x\ndisable-model-invocation: false\ndisable-model-invocation: false\n---\nbody\n';
  const out = setFrontmatterKey(dup, KEY_MODEL, true);
  assert.equal(out.ok, true);
  assert.equal(out.text.split(KEY_MODEL).length - 1, 1, '重复键应折叠为一');
  assert.match(out.text, /disable-model-invocation: true\n/);

  const crlf = '---\r\nname: x\r\n---\r\nbody\r\n';
  const out2 = setFrontmatterKey(crlf, KEY_MODEL, true);
  assert.match(out2.text, /disable-model-invocation: true\r\n/, 'CRLF 文件应保留 CRLF');
  assert.equal(out2.text.includes('\n\n'), false);
});

test('setFrontmatterKey 对无 frontmatter 文件拒绝写入', () => {
  const out = setFrontmatterKey('plain text\n', KEY_MODEL, true);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-frontmatter');
  assert.equal(out.text, 'plain text\n', '拒绝时不得改动原文');
});

test('invocationPatch 语义：启用=删键，禁用=显式值', () => {
  assert.deepEqual(invocationPatch('model', true), { key: KEY_MODEL, value: null });
  assert.deepEqual(invocationPatch('model', false), { key: KEY_MODEL, value: true });
  assert.deepEqual(invocationPatch('user', true), { key: KEY_USER, value: null });
  assert.deepEqual(invocationPatch('user', false), { key: KEY_USER, value: false });
  assert.throws(() => invocationPatch('bogus', true));
});

test('maskSecretText 遮蔽 Bearer 与键值凭据', () => {
  assert.equal(maskSecretText('Bearer abcdef123456'), 'Bearer [redacted]');
  assert.equal(maskSecretText('api_key=supersecret'), 'api_key=[redacted]');
  assert.equal(maskSecretText('token: abc123'), 'token: [redacted]');
  assert.equal(maskSecretText('plain command --flag'), 'plain command --flag');
});

test('sanitizeUrl 移除用户信息并遮蔽敏感查询参数', () => {
  const out = sanitizeUrl('https://user:pw@example.com/mcp?token=abc&keep=1');
  assert.equal(out.includes('pw'), false);
  assert.equal(out.includes('abc'), false);
  // 回归：遮蔽敏感参数不得吞掉其后的普通参数。
  assert.match(out, /keep=1/, '非敏感查询参数必须保留');
  assert.match(out, /token=\[redacted\]/, '敏感参数值必须被遮蔽');
  assert.equal(/abc/.test(out), false);
  assert.match(out, /example\.com/);
  assert.equal(sanitizeUrl('not a url token=abc'), 'not a url token=[redacted]');
});

test('maskSecretText 不吞掉后续的普通参数', () => {
  // 回归：值类曾包含 &，导致 a=1 被一并删除。
  assert.equal(maskSecretText('token=abc&keep=1'), 'token=[redacted]&keep=1');
  assert.equal(maskSecretText('token=abc#frag'), 'token=[redacted]#frag');
});

test('redactRecord 只暴露键名，值一律遮蔽', () => {
  const rows = redactRecord({ Authorization: 'Bearer xyz', 'X-Plain': 'value' });
  assert.deepEqual(rows, [
    { name: 'Authorization', value: '[redacted]' },
    { name: 'X-Plain', value: '[redacted]' },
  ]);
  assert.deepEqual(redactRecord(null), []);
  assert.deepEqual(redactRecord([1, 2]), []);
});

test('sanitizeArgs 遮蔽参数中的凭据', () => {
  assert.deepEqual(sanitizeArgs(['--token=abc', '--isolated']), ['--token=[redacted]', '--isolated']);
  assert.deepEqual(sanitizeArgs(undefined), []);
});

test('skillToggleability 只放行有指令文件路径的 skill', () => {
  assert.deepEqual(skillToggleability({ provider: 'filesystem', path: 'C:/x/SKILL.md' }), { toggleable: true });
  assert.equal(skillToggleability({ provider: 'runtime', path: 'C:/x/SKILL.md' }).toggleable, false);
  assert.equal(skillToggleability({ provider: 'filesystem' }).toggleable, false);
  assert.equal(skillToggleability(null).toggleable, false);
});

test('projectSkills 归一化调用面并按名排序', () => {
  const out = projectSkills([
    { name: 'b', description: 'B', provider: 'filesystem', source: 'user-dsh', path: '/b/SKILL.md', invocation: { modelInvocable: false, userInvocable: true } },
    { name: 'a', description: 'A', provider: 'filesystem', source: 'user-dsh', path: '/a/SKILL.md', invocation: { modelInvocable: true, userInvocable: false } },
    { name: '' },
  ]);
  assert.deepEqual(out.map((s) => s.name), ['a', 'b']);
  assert.equal(out[0].enabled, true);
  assert.equal(out[0].userInvocable, false);
  assert.equal(out[1].enabled, false);
  assert.equal(out[1].toggleable, true);
});

test('projectSkills 对缺省 invocation 视为启用', () => {
  const out = projectSkills([{ name: 'x', description: 'X', provider: 'filesystem', path: '/x/SKILL.md' }]);
  assert.equal(out[0].modelInvocable, true);
  assert.equal(out[0].userInvocable, true);
  assert.equal(out[0].enabled, true);
});

test('projectMcpServer 遮蔽 stdio 环境变量与参数', () => {
  const out = projectMcpServer({
    entryId: 'mcp-x',
    enabled: true,
    fiberPhase: 'active',
    patchId: 'mcp-x',
    config: {
      serverName: 'x',
      transport: 'stdio',
      command: 'node',
      args: ['--token=abc', 'server.js'],
      cwd: 'D:/mcp',
      env: { API_TOKEN: 'secret' },
      toolCallTimeoutMs: 120000,
    },
    toolNames: ['mcp__x__b', 'mcp__x__a'],
  });
  assert.equal(out.transport, 'stdio');
  assert.equal(out.toggleable, true);
  assert.deepEqual(out.connection.args, ['--token=[redacted]', 'server.js']);
  assert.deepEqual(out.connection.env, [{ name: 'API_TOKEN', value: '[redacted]' }]);
  assert.deepEqual(out.toolNames, ['mcp__x__a', 'mcp__x__b']);
  assert.equal(out.toolCount, 2);
  assert.equal(JSON.stringify(out).includes('secret'), false, '任何凭据都不得出现在输出中');
});

test('projectMcpServer 遮蔽 http 头与 URL 凭据', () => {
  const out = projectMcpServer({
    entryId: 'mcp-dbx',
    enabled: false,
    readOnlyReason: null,
    patchId: 'mcp-dbx',
    config: {
      serverName: 'dbx-mcp',
      transport: 'streamable-http',
      url: 'http://192.168.0.100:9005/mcp?token=leak',
      headers: { Authorization: 'Bearer 13470383b6f245239d67b8152df18b3a4cdfb274b5a248af81a75f1ed30cd351' },
    },
  });
  const json = JSON.stringify(out);
  assert.equal(json.includes('13470383b6f245239d67b8152df18b3a4cdfb274b5a248af81a75f1ed30cd351'), false);
  assert.equal(json.includes('leak'), false);
  assert.deepEqual(out.connection.headers, [{ name: 'Authorization', value: '[redacted]' }]);
  assert.equal(out.enabled, false);
});

test('projectMcpServer 无 patchId 时不可切换', () => {
  const out = projectMcpServer({ entryId: 'mcp-y', config: { serverName: 'y', transport: 'stdio' }, readOnlyReason: 'unaddressable' });
  assert.equal(out.toggleable, false);
  assert.equal(out.readOnlyReason, 'unaddressable');
});

test('summarize 统计启停与工具数', () => {
  const skills = projectSkills([
    { name: 'a', description: 'A', provider: 'filesystem', source: 'user-dsh', path: '/a/SKILL.md' },
    { name: 'b', description: 'B', provider: 'filesystem', source: 'user-dsh', path: '/b/SKILL.md', invocation: { modelInvocable: false, userInvocable: true } },
  ]);
  const servers = [
    projectMcpServer({ entryId: 'm1', enabled: true, patchId: 'm1', config: { serverName: 'm1', transport: 'stdio' }, toolNames: ['t1', 't2'] }),
    projectMcpServer({ entryId: 'm2', enabled: false, patchId: 'm2', config: { serverName: 'm2', transport: 'streamable-http' } }),
  ];
  const out = summarize(skills, servers);
  assert.deepEqual(out.skills, {
    total: 2, enabled: 1, disabled: 1, toggleable: 2,
    providers: ['filesystem'], sources: ['user-dsh'],
  });
  assert.equal(out.mcp.total, 2);
  assert.equal(out.mcp.enabled, 1);
  assert.equal(out.mcp.tools, 2);
  assert.deepEqual(out.mcp.transports, ['stdio', 'streamable-http']);
});
