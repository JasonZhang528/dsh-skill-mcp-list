// dsh-skill-mcp-list —— 新 action 的 HTTP 层测试
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

const RUNTIME = join(import.meta.dirname, '..', '.runtime', 'node_modules');
const runtimeImport = (pkg) => import(pathToFileURL(join(RUNTIME, pkg, 'lib', 'index.js')).href);

const RUNTIME_READY = existsSync(join(RUNTIME, '@deepseek-ai', 'cordis', 'lib', 'index.js'));
const suite = RUNTIME_READY ? test : test.skip;

let Context, ToolRuntime, SkillRegistry, plugin, root;
let savedDshHome;

before(async () => {
  if (!RUNTIME_READY) return;
  ({ Context } = await runtimeImport('@deepseek-ai/cordis'));
  ({ ToolRuntime } = await runtimeImport('@deepseek-ai/dsh-tools'));
  ({ SkillRegistry } = await runtimeImport('@deepseek-ai/dsh-skill'));
  plugin = await import(pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.mjs')).href);
  root = await mkdtemp(join(tmpdir(), 'dsh-sml-http2-'));
  // 关键隔离：宿主进程会把 DSH_HOME 继承给子进程，不覆盖就会写进真实 skill 根。
  savedDshHome = process.env.DSH_HOME;
  process.env.DSH_HOME = join(root, 'dsh-home');
});

after(async () => {
  if (savedDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedDshHome;
  if (root) await rm(root, { recursive: true, force: true });
});

function makeReq(method, url, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    method, url, headers: {},
    async *[Symbol.asyncIterator]() { if (text.length > 0) yield Buffer.from(text, 'utf8'); },
  };
}

function makeRes() {
  const res = { statusCode: 200, headers: null, body: '', writeHead(s, h) { res.statusCode = s; res.headers = h; }, end(c) { res.body = c ?? ''; } };
  return res;
}

async function mountHttp(options = {}) {
  const ctx = new Context();
  ctx.provide('systemPrompt', {
    tools() {}, section() {}, context() {}, getSectionOrder: () => 0, getContextOrder: () => 0,
  });
  const tools = new ToolRuntime(ctx, { mode: 'native' });
  const skills = new SkillRegistry(ctx, {});
  const routes = [];
  ctx.provide('webServer', { register(route) { routes.push(route); return () => {}; } });
  if (options.withoutConnection !== true) {
    ctx.provide('connection', { requestRejection: options.requestRejection ?? (() => undefined) });
  }
  ctx.provide('loader', { entries: () => options.entries ?? [] });
  if (options.configEditor) ctx.provide('configEditor', options.configEditor);
  ctx.provide('profileContext', { dir: join(root, 'dsh-home', 'profiles', 'desktop'), patchPath: join(root, 'cordis.patch.yml') });

  const fiber = ctx.plugin(plugin);
  await fiber;
  const route = routes[0];
  return { ctx, tools, skills, fiber, route };
}

suite('POST install_skill 真实落盘并返回新状态', async () => {
  const skillsRoot = join(root, 'dsh-home', 'skills');
  await rm(skillsRoot, { recursive: true, force: true });
  await mkdir(skillsRoot, { recursive: true });

  const app = await mountHttp();
  try {
    // 让注册表从刚写入的根发现新 skill。
    app.skills.registerProvider(() => ({
      name: 'filesystem',
      async list() {
        const { readdir, readFile: rf } = await import('node:fs/promises');
        const names = await readdir(skillsRoot).catch(() => []);
        const out = [];
        for (const name of names) {
          const file = join(skillsRoot, name, 'SKILL.md');
          if (!existsSync(file)) continue;
          const text = await rf(file, 'utf8');
          out.push({
            name: /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? name,
            description: /^description:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '',
            source: 'user-dsh', provider: 'filesystem', rank: 400,
            path: file, locator: { path: file },
            invocation: { modelInvocable: true, userInvocable: true },
          });
        }
        return out;
      },
      async get(candidate) {
        const { readFile: rf } = await import('node:fs/promises');
        const file = join(skillsRoot, candidate.name, 'SKILL.md');
        if (!existsSync(file)) return undefined;
        const text = await rf(file, 'utf8');
        return {
          name: candidate.name, description: candidate.description, source: 'user-dsh', provider: 'filesystem',
          path: file, content: text, invocation: { modelInvocable: true, userInvocable: true },
        };
      },
    }));

    const res = makeRes();
    await app.route.handler(
      makeReq('POST', '/api/skill-mcp-list', {
        action: 'install_skill',
        spec: { name: 'http-skill', description: 'Installed via HTTP.', body: 'Body here.' },
      }),
      res,
    );
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.target, 'http-skill');
    assert.equal(payload.action, 'install');
    // 收尾防线：安装路径必须落在本次测试的临时根内，绝不触及真实 skill 根。
    assert.ok(payload.path.startsWith(root), '安装路径必须位于测试根内，实际: ' + payload.path);
    assert.equal(payload.root, skillsRoot);
    assert.match(await readFile(payload.path, 'utf8'), /^name: http-skill$/m);
    assert.match(await readFile(payload.path, 'utf8'), /Body here\./);

    // 安装后应出现在快照里。
    const list = makeRes();
    await app.route.handler(makeReq('GET', '/api/skill-mcp-list'), list);
    const snap = JSON.parse(list.body);
    assert.ok(snap.skills.some((s) => s.name === 'http-skill'), '安装后必须出现在列表中');
  } finally {
    await app.fiber.dispose();
  }
});

suite('POST install_skill 缺 spec 字段时返回可读错误', async () => {
  const app = await mountHttp();
  try {
    const res = makeRes();
    await app.route.handler(makeReq('POST', '/api/skill-mcp-list', { action: 'install_skill', spec: { name: 'BAD' } }), res);
    assert.equal(res.statusCode, 500);
    assert.match(JSON.parse(res.body).error, /(kebab-case|描述)/);
  } finally {
    await app.fiber.dispose();
  }
});

suite('POST configure_mcp 走 configEditor 并返回变更', async () => {
  const edits = [];
  const app = await mountHttp({
    entries: [{ id: 'mcp-a', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'a', transport: 'stdio', command: 'node' } }, disabled: false }],
    configEditor: { async edit(entry, change) { edits.push(change(entry.options.config ?? {}, {})); } },
  });
  try {
    const res = makeRes();
    await app.route.handler(
      makeReq('POST', '/api/skill-mcp-list', { action: 'configure_mcp', target: 'mcp-a', config: { toolCallTimeoutMs: 90000 } }),
      res,
    );
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.action, 'configure');
    assert.equal(payload.changed, true);
    assert.deepEqual(payload.patch, { toolCallTimeoutMs: 90000 });
    assert.equal(edits.length, 1);
    assert.equal(edits[0].toolCallTimeoutMs, 90000);
    // 既有字段不得丢失。
    assert.equal(edits[0].command, 'node');
  } finally {
    await app.fiber.dispose();
  }
});

suite('POST configure_mcp 缺 configEditor 时返回 500 而非静默成功', async () => {
  const app = await mountHttp({
    entries: [{ id: 'mcp-a', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'a', transport: 'stdio', command: 'node' } } }],
  });
  try {
    const res = makeRes();
    await app.route.handler(
      makeReq('POST', '/api/skill-mcp-list', { action: 'configure_mcp', target: 'mcp-a', config: { toolCallTimeoutMs: 1 } }),
      res,
    );
    assert.equal(res.statusCode, 500);
    assert.match(JSON.parse(res.body).error, /configEditor 服务不可用/);
  } finally {
    await app.fiber.dispose();
  }
});

suite('POST configure_mcp 非法补丁在写盘前被拒', async () => {
  let called = false;
  const app = await mountHttp({
    entries: [{ id: 'mcp-a', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'a', transport: 'stdio', command: 'node' } } }],
    configEditor: { async edit() { called = true; } },
  });
  try {
    const res = makeRes();
    await app.route.handler(
      makeReq('POST', '/api/skill-mcp-list', { action: 'configure_mcp', target: 'mcp-a', config: { headers: { X: 'y' } } }),
      res,
    );
    assert.equal(res.statusCode, 500);
    assert.equal(called, false, '非法补丁不得触发 configEditor');
  } finally {
    await app.fiber.dispose();
  }
});

suite('信任栅栏仍然拦截新 action', async () => {
  const app = await mountHttp({ requestRejection: () => 401 });
  try {
    for (const body of [
      { action: 'install_skill', spec: { name: 'x', description: 'd' } },
      { action: 'configure_mcp', target: 'mcp-a', config: { toolCallTimeoutMs: 1 } },
    ]) {
      const res = makeRes();
      await app.route.handler(makeReq('POST', '/api/skill-mcp-list', body), res);
      assert.equal(res.statusCode, 401);
      assert.equal(JSON.parse(res.body).error, 'unauthorized');
    }
  } finally {
    await app.fiber.dispose();
  }
});
