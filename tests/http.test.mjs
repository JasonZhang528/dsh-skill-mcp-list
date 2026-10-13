// dsh-skill-mcp-list —— HTTP API 层测试
//
// 用真实 Cordis 挂载插件，并注册一个假 webServer 捕获路由，然后直接调用
// handler，验证：信任栅栏、方法分发、错误映射、以及写操作确实落盘。
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

const RUNTIME = join(import.meta.dirname, '..', '.runtime', 'node_modules');
const runtimeImport = (pkg) => import(pathToFileURL(join(RUNTIME, pkg, 'lib', 'index.js')).href);

// 未执行 scripts/fetch-runtime.mjs 时跳过整个文件，而不是让测试报错。
const RUNTIME_READY = existsSync(join(RUNTIME, '@deepseek-ai', 'cordis', 'lib', 'index.js'));
const suite = RUNTIME_READY ? test : test.skip;

let Context, ToolRuntime, SkillRegistry, plugin, root;

before(async () => {
  if (!RUNTIME_READY) return;
  ({ Context } = await runtimeImport('@deepseek-ai/cordis'));
  ({ ToolRuntime } = await runtimeImport('@deepseek-ai/dsh-tools'));
  ({ SkillRegistry } = await runtimeImport('@deepseek-ai/dsh-skill'));
  plugin = await import(pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.mjs')).href);
  root = await mkdtemp(join(tmpdir(), 'dsh-sml-http-'));
});

after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

/**
 * 构造假请求对象。
 * @param {string} method HTTP 方法
 * @param {string} url 请求 URL
 * @param {object} [body] JSON 请求体
 * @returns {object} 请求对象
 */
function makeReq(method, url, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (text.length > 0) yield Buffer.from(text, 'utf8');
    },
  };
}

/**
 * 构造假响应对象，记录状态码与响应体。
 * @returns {object} 响应对象与结果读取器
 */
function makeRes() {
  const res = {
    statusCode: 200,
    headers: null,
    body: '',
    writeHead(status, headers) {
      res.statusCode = status;
      res.headers = headers;
    },
    end(chunk) {
      res.body = chunk ?? '';
    },
  };
  return res;
}

/**
 * 挂载插件并捕获它注册的 HTTP 路由。
 * @param {object} options 覆盖项
 * @returns {Promise<object>} 应用句柄与路由
 */
async function mountHttp(options = {}) {
  const ctx = new Context();
  ctx.provide('systemPrompt', {
    tools() {}, section() {}, context() {}, getSectionOrder: () => 0, getContextOrder: () => 0,
  });
  const tools = new ToolRuntime(ctx, { mode: 'native' });
  const skills = new SkillRegistry(ctx, {});

  const routes = [];
  ctx.provide('webServer', {
    register(route) {
      routes.push(route);
      return () => {};
    },
  });
  if (options.withoutConnection !== true) {
    // requestRejection 缺失用于验证"有 connection 但没有栅栏能力"时的 fail-closed。
    ctx.provide('connection', options.bareConnection === true
      ? {}
      : { requestRejection: options.requestRejection ?? (() => undefined) });
  }
  ctx.provide('loader', { entries: () => options.entries ?? [] });
  if (options.sandboxPolicy) ctx.provide('sandboxPolicy', options.sandboxPolicy);

  const fiber = ctx.plugin(plugin);
  await fiber;

  if (options.withoutConnection === true) {
    assert.equal(routes.length, 0, '缺少 connection 时不得注册路由（fail-closed）');
    return { ctx, tools, skills, fiber, route: null };
  }
  assert.equal(routes.length, 1, '必须注册恰好一条 HTTP 路由');
  const route = routes[0];
  assert.equal(route.kind, 'exact');
  assert.equal(route.path, '/api/skill-mcp-list');

  return { ctx, tools, skills, fiber, route };
}

suite('GET 返回快照', async () => {
  const app = await mountHttp();
  try {
    const res = makeRes();
    await app.route.handler(makeReq('GET', '/api/skill-mcp-list'), res);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.ok(Array.isArray(payload.skills));
    assert.ok(Array.isArray(payload.mcpServers));
    assert.ok(payload.summary);
    assert.match(res.headers['Content-Type'], /application\/json/);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  } finally {
    await app.fiber.dispose();
  }
});

suite('信任栅栏：未通过时拒绝且不泄露数据', async () => {
  for (const [rejection, label] of [[401, 'unauthorized'], [403, 'forbidden']]) {
    const app = await mountHttp({ requestRejection: () => rejection });
    try {
      const res = makeRes();
      await app.route.handler(makeReq('GET', '/api/skill-mcp-list'), res);
      assert.equal(res.statusCode, rejection);
      const payload = JSON.parse(res.body);
      assert.equal(payload.ok, false);
      assert.equal(payload.error, label);
      assert.equal(payload.skills, undefined, '被拒绝时不得返回任何数据');
    } finally {
      await app.fiber.dispose();
    }
  }
});

suite('完全没有 connection 时不注册路由（fail-closed）', async () => {
  // 路由依赖 connection 才能过信任栅栏；缺少它时宁可没有接口，也不暴露裸接口。
  const app = await mountHttp({ withoutConnection: true });
  try {
    assert.equal(app.route, null);
  } finally {
    await app.fiber.dispose();
  }
});

suite('有 connection 但无栅栏能力时返回 503 而不是放行', async () => {
  const app = await mountHttp({ bareConnection: true });
  try {
    const res = makeRes();
    await app.route.handler(makeReq('GET', '/api/skill-mcp-list'), res);
    assert.equal(res.statusCode, 503, '无栅栏必须返回 503');
    assert.equal(JSON.parse(res.body).ok, false);
    assert.equal(JSON.parse(res.body).skills, undefined, '被拒绝时不得泄露数据');
  } finally {
    await app.fiber.dispose();
  }
});

suite('POST set_skill 真实改写并返回新状态', async () => {
  const dir = join(root, 'http-skill');
  await mkdir(join(dir, 'demo'), { recursive: true });
  const file = join(dir, 'demo', 'SKILL.md');
  const original = '---\nname: demo\ndescription: D.\n---\n\nBody\n';
  await writeFile(file, original, 'utf8');

  const app = await mountHttp();
  try {
    // 候选必须携带 rank 与 locator，否则注册表会按无效候选拒绝（与真实提供方一致）。
    const parse = (text) => ({
      name: 'demo', description: 'D.', source: 'user-dsh', provider: 'filesystem',
      rank: 400, path: file, locator: { path: file }, content: text,
      invocation: {
        modelInvocable: !/^disable-model-invocation:[ \t]*true[ \t]*$/m.test(text),
        userInvocable: !/^user-invocable:[ \t]*false[ \t]*$/m.test(text),
      },
    });
    app.skills.registerProvider(() => ({
      name: 'filesystem',
      async list() { return [parse(await readFile(file, 'utf8'))]; },
      async get() { return parse(await readFile(file, 'utf8')); },
    }));

    const res = makeRes();
    await app.route.handler(
      makeReq('POST', '/api/skill-mcp-list', { action: 'set_skill', target: 'demo', enabled: false }),
      res,
    );
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.changed, true);
    assert.equal(payload.state.enabled, false);
    assert.match(await readFile(file, 'utf8'), /^disable-model-invocation: true$/m);
  } finally {
    await app.fiber.dispose();
  }
});

suite('POST 未知 action → 400，异常 → 500', async () => {
  const app = await mountHttp();
  try {
    const res400 = makeRes();
    await app.route.handler(makeReq('POST', '/api/skill-mcp-list', { action: 'nope' }), res400);
    assert.equal(res400.statusCode, 400);
    assert.match(JSON.parse(res400.body).error, /未知的 action/);

    const res500 = makeRes();
    await app.route.handler(makeReq('POST', '/api/skill-mcp-list', { action: 'set_skill', target: 'missing', enabled: false }), res500);
    assert.equal(res500.statusCode, 500, '业务异常应映射为 500 并带可读消息');
    assert.match(JSON.parse(res500.body).error, /不存在/);
  } finally {
    await app.fiber.dispose();
  }
});

suite('POST detail：命中 skill 返回 200，未命中返回 404', async () => {
  const app = await mountHttp();
  try {
    // get() 只能解析 list() 中登记过的候选，因此 list() 必须返回该候选。
    app.skills.registerProvider(() => ({
      name: 'filesystem',
      async list() {
        return [{
          name: 'demo', description: 'D.', source: 'user-dsh', provider: 'filesystem',
          rank: 400, locator: { path: join(root, 'x/SKILL.md') },
          invocation: { modelInvocable: true, userInvocable: true },
        }];
      },
      async get(candidate) {
        if (candidate.name !== 'demo') return undefined;
        return { name: 'demo', description: 'D.', provider: 'filesystem', source: 'user-dsh', path: join(root, 'x/SKILL.md'), content: '# Hi', invocation: { modelInvocable: true, userInvocable: true } };
      },
    }));

    const ok = makeRes();
    await app.route.handler(makeReq('POST', '/api/skill-mcp-list', { action: 'detail', target: 'demo' }), ok);
    assert.equal(ok.statusCode, 200);
    assert.equal(JSON.parse(ok.body).content, '# Hi');

    const miss = makeRes();
    await app.route.handler(makeReq('POST', '/api/skill-mcp-list', { action: 'detail', target: 'nope' }), miss);
    assert.equal(miss.statusCode, 404);
  } finally {
    await app.fiber.dispose();
  }
});

suite('其他方法 → 405', async () => {
  const app = await mountHttp();
  try {
    const res = makeRes();
    await app.route.handler(makeReq('DELETE', '/api/skill-mcp-list'), res);
    assert.equal(res.statusCode, 405);
  } finally {
    await app.fiber.dispose();
  }
});

suite('超大请求体被拒绝', async () => {
  const app = await mountHttp();
  try {
    const huge = { action: 'set_skill', target: 'x', pad: 'y'.repeat(300000) };
    const res = makeRes();
    await app.route.handler(makeReq('POST', '/api/skill-mcp-list', huge), res);
    assert.equal(res.statusCode, 500);
    assert.match(JSON.parse(res.body).error, /过大/);
  } finally {
    await app.fiber.dispose();
  }
});

suite('畸形 JSON 请求体被拒绝且不崩溃', async () => {
  const app = await mountHttp();
  try {
    const req = {
      method: 'POST',
      url: '/api/skill-mcp-list',
      headers: {},
      async *[Symbol.asyncIterator]() { yield Buffer.from('{not json', 'utf8'); },
    };
    const res = makeRes();
    await app.route.handler(req, res);
    assert.equal(res.statusCode, 500);
    assert.ok(JSON.parse(res.body).error.length > 0);
  } finally {
    await app.fiber.dispose();
  }
});
