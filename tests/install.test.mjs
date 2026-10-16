// dsh-skill-mcp-list —— Skill 安装 / MCP 配置纯逻辑测试
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  applyMcpPatch,
  normalizeMcpPatch,
  readDeclaredName,
  renderSkillMarkdown,
  validateSkillDescription,
  validateSkillName,
} from '../lib/install.mjs';

let root;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-sml-install-'));
});

after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------- skill 名校验
test('validateSkillName 只接受 kebab-case', () => {
  assert.deepEqual(validateSkillName('my-skill'), { ok: true, name: 'my-skill' });
  assert.deepEqual(validateSkillName('skill2'), { ok: true, name: 'skill2' });
  assert.deepEqual(validateSkillName('  spaced  '), { ok: true, name: 'spaced' });
  assert.equal(validateSkillName('').ok, false);
  assert.equal(validateSkillName('   ').ok, false);
  assert.equal(validateSkillName(undefined).ok, false);
  assert.equal(validateSkillName(42).ok, false);
  assert.equal(validateSkillName('My-Skill').ok, false, '不允许大写');
  assert.equal(validateSkillName('-lead').ok, false, '不允许连字符开头');
  assert.equal(validateSkillName('trail-').ok, false, '不允许连字符结尾');
  assert.equal(validateSkillName('a--b').ok, false, '不允许连续连字符');
  assert.equal(validateSkillName('under_score').ok, false, '不允许下划线');
  assert.equal(validateSkillName('dot.name').ok, false, '不允许点号');
  assert.equal(validateSkillName('x'.repeat(65)).ok, false, '超过 64 字符');
  assert.equal(validateSkillName('x'.repeat(64)).ok, true, '恰好 64 字符放行');
});

test('validateSkillDescription 要求非空且有上限', () => {
  assert.deepEqual(validateSkillDescription('does something'), { ok: true, description: 'does something' });
  assert.equal(validateSkillDescription('').ok, false);
  assert.equal(validateSkillDescription('  ').ok, false);
  assert.equal(validateSkillDescription(null).ok, false);
  assert.equal(validateSkillDescription('d'.repeat(501)).ok, false);
  assert.equal(validateSkillDescription('d'.repeat(500)).ok, true);
});

// ---------------------------------------------------------------- 渲染
test('renderSkillMarkdown 生成合法 frontmatter，默认两个调用面都可用', () => {
  const text = renderSkillMarkdown({
    name: 'demo-skill',
    description: 'A demo skill.',
    body: '# Demo\n\nHello.',
  });
  assert.match(text, /^---\n/);
  assert.match(text, /\n---\n/);
  assert.match(text, /^name: demo-skill$/m);
  assert.match(text, /^description: A demo skill\.$/m);
  assert.match(text, /# Demo/);
  // 关键：不写禁用键，让新 skill 默认可被模型与用户调用。
  assert.equal(text.includes('disable-model-invocation'), false);
  assert.equal(text.includes('user-invocable'), false);
  assert.equal(readDeclaredName(text), 'demo-skill');
});

test('renderSkillMarkdown 无正文时不留空行垃圾', () => {
  const text = renderSkillMarkdown({ name: 'bare', description: 'Bare.' });
  assert.equal(text, '---\nname: bare\ndescription: Bare.\n---\n');
});

test('renderSkillMarkdown 含特殊字符的值加引号转义', () => {
  const text = renderSkillMarkdown({
    name: 'quoted',
    description: 'Has: colon # hash "quote" and \\ backslash',
  });
  assert.match(text, /^description: "/m);
  assert.match(text, /\\"/);
  // 引号内的值必须能原样读回。
  const declared = readDeclaredName(text);
  assert.equal(declared, 'quoted');
  assert.equal(text.includes('\\n'), false, '无换行不应出现转义换行');
});

test('renderSkillMarkdown 拒绝非法输入且不产出文件内容', () => {
  assert.throws(() => renderSkillMarkdown({ name: 'BAD', description: 'x' }), /kebab-case/);
  assert.throws(() => renderSkillMarkdown({ name: 'ok', description: '' }), /描述不能为空/);
  assert.throws(() => renderSkillMarkdown({ name: 'ok' }), /描述不能为空/);
  assert.throws(() => renderSkillMarkdown(null), /名称不能为空/);
});

test('renderSkillMarkdown 正文统一为 LF 且去除尾部空白', () => {
  const text = renderSkillMarkdown({
    name: 'lf',
    description: 'LF.',
    body: 'line1\r\nline2\r\n\r\n\r\n',
  });
  assert.equal(text.includes('\r'), false);
  assert.match(text, /line1\nline2\n/);
  assert.equal(/\n\n$/.test(text), false, '结尾不应有连续空行');
});

test('readDeclaredName 处理引号与缺失', () => {
  assert.equal(readDeclaredName('---\nname: "quoted-name"\n---\n'), 'quoted-name');
  assert.equal(readDeclaredName("---\nname: 'single'\n---\n"), 'single');
  assert.equal(readDeclaredName('---\ndescription: no name\n---\n'), null);
  assert.equal(readDeclaredName('no frontmatter'), null);
  assert.equal(readDeclaredName(''), null);
  assert.equal(readDeclaredName(null), null);
});

// ---------------------------------------------------------------- MCP 补丁校验
test('normalizeMcpPatch 接受常见配置字段', () => {
  const out = normalizeMcpPatch({ toolCallTimeoutMs: 120000, failOnStartupError: true }, { transport: 'stdio', command: 'node' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.patch, { toolCallTimeoutMs: 120000, failOnStartupError: true });
});

test('normalizeMcpPatch 拒绝未知字段', () => {
  const out = normalizeMcpPatch({ bogusField: 'x' }, { transport: 'stdio', command: 'node' });
  assert.equal(out.ok, false);
  assert.match(out.reason, /不可通过此界面修改/);
});

test('normalizeMcpPatch 接受 env / headers 映射并按传输校验', () => {
  // stdio 用 env，http 用 headers；值必须是字符串，null 表示删除该键。
  const stdio = normalizeMcpPatch({ env: { API_KEY: 'k' } }, { transport: 'stdio', command: 'node' });
  assert.equal(stdio.ok, true);
  assert.deepEqual(stdio.patch, { env: { API_KEY: 'k' } });

  const http = normalizeMcpPatch({ headers: { Authorization: 'Bearer t' } }, { transport: 'streamable-http', url: 'http://h/mcp' });
  assert.equal(http.ok, true);

  // 交叉使用会被拒，否则写出的条目加载即失败。
  assert.equal(normalizeMcpPatch({ headers: { A: 'b' } }, { transport: 'stdio', command: 'node' }).ok, false);
  assert.equal(normalizeMcpPatch({ env: { A: 'b' } }, { transport: 'streamable-http', url: 'http://h/mcp' }).ok, false);
  // 非字符串值被拒；null 是删除语义，必须放行。
  assert.equal(normalizeMcpPatch({ env: { A: 1 } }, { transport: 'stdio', command: 'node' }).ok, false);
  assert.deepEqual(
    normalizeMcpPatch({ env: { A: null } }, { transport: 'stdio', command: 'node' }).patch,
    { env: { A: null } },
  );
});

test('normalizeMcpPatch 拒绝非对象输入', () => {
  assert.equal(normalizeMcpPatch(null).ok, false);
  assert.equal(normalizeMcpPatch([1]).ok, false);
  assert.equal(normalizeMcpPatch('str').ok, false);
});

test('normalizeMcpPatch 空补丁被拒绝', () => {
  assert.equal(normalizeMcpPatch({}, {}).ok, false);
  assert.equal(normalizeMcpPatch({ cwd: undefined }, {}).ok, false);
});

test('normalizeMcpPatch 数值字段必须为正整数', () => {
  for (const bad of [0, -1, 1.5, '120', null, Number.NaN]) {
    const out = normalizeMcpPatch({ toolCallTimeoutMs: bad }, { transport: 'stdio', command: 'node' });
    assert.equal(out.ok, false, 'toolCallTimeoutMs=' + String(bad));
  }
  const ok = normalizeMcpPatch({ maxInstructionBytes: 65536 }, { transport: 'stdio', command: 'node' });
  assert.deepEqual(ok.patch, { maxInstructionBytes: 65536 });
});

test('normalizeMcpPatch 布尔字段必须是布尔值', () => {
  const base = { transport: 'stdio', command: 'node' };
  assert.equal(normalizeMcpPatch({ failOnStartupError: 'yes' }, base).ok, false);
  assert.equal(normalizeMcpPatch({ failOnStartupError: 1 }, base).ok, false);
  assert.deepEqual(normalizeMcpPatch({ failOnStartupError: false }, base).patch, { failOnStartupError: false });
});

test('normalizeMcpPatch 传输方式不可跨类型切换', () => {
  const out = normalizeMcpPatch({ transport: 'streamable-http' }, { transport: 'stdio' });
  assert.equal(out.ok, false);
  assert.match(out.reason, /传输方式不可在此弹窗切换/);
  // 相同传输方式允许原样提交。
  const same = normalizeMcpPatch({ transport: 'stdio' }, { transport: 'stdio', command: 'node' });
  assert.deepEqual(same.patch, { transport: 'stdio' });
});

test('normalizeMcpPatch stdio 与 url 互斥', () => {
  assert.equal(normalizeMcpPatch({ url: 'http://h/mcp' }, { transport: 'stdio' }).ok, false);
  assert.match(normalizeMcpPatch({ url: 'http://h/mcp' }, { transport: 'stdio' }).reason, /stdio 传输不应设置 url/);
});

test('normalizeMcpPatch streamable-http 与 command 互斥', () => {
  assert.equal(normalizeMcpPatch({ command: 'node' }, { transport: 'streamable-http' }).ok, false);
  assert.match(normalizeMcpPatch({ command: 'node' }, { transport: 'streamable-http' }).reason, /不应设置 command/);
});

test('normalizeMcpPatch URL 仅接受 http/https', () => {
  const http = { transport: 'streamable-http', url: 'http://h/mcp' };
  assert.equal(normalizeMcpPatch({ url: 'ftp://h/mcp' }, http).ok, false);
  assert.equal(normalizeMcpPatch({ url: 'not-a-url' }, http).ok, false);
  assert.equal(normalizeMcpPatch({ url: 'https://h/mcp' }, http).ok, true);
  assert.equal(normalizeMcpPatch({ url: 'http://h:9005/mcp' }, http).ok, true);
});

test('normalizeMcpPatch command 不能以 - 开头', () => {
  assert.equal(normalizeMcpPatch({ command: '--evil' }, { transport: 'stdio' }).ok, false);
  assert.equal(normalizeMcpPatch({ command: 'node' }, { transport: 'stdio', command: 'node' }).ok, true);
});

test('normalizeMcpPatch serverName 必须匹配官方命名约束', () => {
  const stdio = { transport: 'stdio', command: 'node' };
  assert.equal(normalizeMcpPatch({ serverName: 'good-name_1' }, stdio).ok, true);
  assert.equal(normalizeMcpPatch({ serverName: 'bad name!' }, stdio).ok, false);
  // 空字符串走 optional 分支被忽略，最终因无变更被拒，同样阻止非法写入。
  assert.equal(normalizeMcpPatch({ serverName: '' }, stdio).ok, false);
});

test('normalizeMcpPatch args 必须是最多 128 项的字符串数组', () => {
  const stdioEntry = { transport: 'stdio', command: 'node' };
  assert.equal(normalizeMcpPatch({ args: ['a', 'b'] }, stdioEntry).ok, true);
  assert.equal(normalizeMcpPatch({ args: 'not-array' }, stdioEntry).ok, false);
  assert.equal(normalizeMcpPatch({ args: [1] }, stdioEntry).ok, false);
  assert.equal(normalizeMcpPatch({ args: new Array(129).fill('x') }, stdioEntry).ok, false);
  assert.equal(normalizeMcpPatch({ args: new Array(128).fill('x') }, stdioEntry).ok, true);
});

test('normalizeMcpPatch reconnect 只接受白名单字段', () => {
  // current 带 command，否则条目本身缺 command 会先被自洽检查拦下。
  const entry = { transport: 'stdio', command: 'node' };
  const ok = normalizeMcpPatch(
    { reconnect: { enabled: false, initialDelayMs: 1000, maxDelayMs: 60000, maxAttempts: 5 } },
    entry,
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.patch.reconnect, { enabled: false, initialDelayMs: 1000, maxDelayMs: 60000, maxAttempts: 5 });

  assert.equal(normalizeMcpPatch({ reconnect: { bogus: 1 } }, entry).ok, false);
  assert.equal(normalizeMcpPatch({ reconnect: { enabled: 'yes' } }, entry).ok, false);
  assert.equal(normalizeMcpPatch({ reconnect: { initialDelayMs: 0 } }, entry).ok, false);
  assert.equal(normalizeMcpPatch({ reconnect: { maxDelayMs: -1 } }, entry).ok, false);
  assert.equal(normalizeMcpPatch({ reconnect: {} }, entry).ok, false);
  assert.equal(normalizeMcpPatch({ reconnect: null }, entry).ok, false);
  assert.equal(normalizeMcpPatch({ reconnect: [1] }, entry).ok, false);
});

test('normalizeMcpPatch reconnect 初始延迟不能大于最大延迟', () => {
  const entry = { transport: 'stdio', command: 'node' };
  const out = normalizeMcpPatch(
    { reconnect: { initialDelayMs: 60000, maxDelayMs: 1000 } },
    entry,
  );
  assert.equal(out.ok, false);
  assert.match(out.reason, /初始延迟不能大于最大延迟/);

  // 只改一侧时用当前值兜底比较。
  const current = { transport: 'stdio', command: 'node', reconnect: { initialDelayMs: 1000, maxDelayMs: 30000 } };
  assert.equal(normalizeMcpPatch({ reconnect: { initialDelayMs: 500 } }, current).ok, true);
  assert.equal(normalizeMcpPatch({ reconnect: { maxDelayMs: 500 } }, current).ok, false);
});

test('applyMcpPatch 合并而不丢失既有字段', () => {
  const merged = applyMcpPatch(
    { transport: 'stdio', command: 'node', args: ['s.js'], toolCallTimeoutMs: 60000 },
    { toolCallTimeoutMs: 120000 },
  );
  assert.deepEqual(merged, {
    transport: 'stdio',
    command: 'node',
    args: ['s.js'],
    toolCallTimeoutMs: 120000,
  });
  // 输入不得被改动。
  const base = { transport: 'stdio' };
  applyMcpPatch(base, { toolCallTimeoutMs: 1 });
  assert.deepEqual(base, { transport: 'stdio' });
  assert.deepEqual(applyMcpPatch(undefined, { a: 1 }), { a: 1 });
  assert.deepEqual(applyMcpPatch({ a: 1 }, undefined), { a: 1 });
});
