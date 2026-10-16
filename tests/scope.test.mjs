// dsh-skill-mcp-list —— skill 作用域视角回归测试
//
// 背景：官方把每个 agent preset 的 skill-filesystem 注册在该 preset 的
// **作用域层**里（见 @deepseek-ai/dsh-web-app 的 cordis.patch.yml：宿主平面的
// skill-filesystem 行被 disabled，presets/*.patch.yml 各自重新挂载）。
// 注册表的读取是"全局层 + 调用方作用域链"的合并，因此**不带 scope 的 list()
// 只看得到 bundled 等部署级提供方**，用户 / 项目级 skill 会整体消失。
//
// 本文件锁定修复后的视角契约，防止再次退化为"只读全局层"。
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createApi } from '../lib/api.mjs';

/** 一条最小 skill 摘要。 */
function summary(name, source) {
  return {
    name,
    description: name + ' skill.',
    source,
    provider: 'filesystem',
    path: '/skills/' + name + '/SKILL.md',
    invocation: { modelInvocable: true, userInvocable: true },
  };
}

/**
 * 构造假 ctx，记录每次 skills 调用收到的 scope。
 * @param {object} options 覆盖项
 * @returns {object} 假 ctx 与调用记录
 */
function fakeCtx(options = {}) {
  const calls = [];
  const disposed = [];
  const agentSkills = {
    async list(params) {
      calls.push({ registry: 'scoped', method: 'list', params });
      return [summary('agent-visible', 'user-dsh')];
    },
    async get(name, params) {
      calls.push({ registry: 'scoped', method: 'get', params });
      return name === 'agent-visible'
        ? { ...summary('agent-visible', 'user-dsh'), content: 'body' }
        : undefined;
    },
  };
  const globalSkills = {
    async list(params) {
      calls.push({ registry: 'global', method: 'list', params });
      return [summary('bundled-only', 'bundled')];
    },
    async get(name, params) {
      calls.push({ registry: 'global', method: 'get', params });
      return name === 'bundled-only'
        ? { ...summary('bundled-only', 'bundled'), content: 'body' }
        : undefined;
    },
  };
  const agent = { id: 'session-1', ctx: { tag: 'agent-scope' } };
  const lease = {
    key: { tag: 'preset-scope' },
    async [Symbol.asyncDispose]() {
      disposed.push(true);
    },
  };

  const ctx = {
    loader: { entries: () => options.entries ?? [] },
    tools: { schemas: () => options.schemas ?? [] },
    skills: globalSkills,
    get(name) {
      if (name === 'pluginManager') return options.pluginManager;
      if (name === 'agents') {
        return options.hasAgents === false
          ? undefined
          : {
              get(id) {
                return id === 'session-1' ? agent : undefined;
              },
            };
      }
      if (name === 'agentPresets') {
        return options.hasPresets === false
          ? undefined
          : {
              serviceFor(target, serviceName) {
                if (target !== agent || serviceName !== 'skills') return undefined;
                return agentSkills;
              },
              async acquireScope() {
                return options.acquireThrows === true ? undefined : lease;
              },
            };
      }
      return undefined;
    },
  };
  return { ctx, calls, disposed, agent, agentSkills, globalSkills };
}

test('无任何视角提示时退回全局层（不报错，仅 bundled）', async () => {
  const { ctx, calls } = fakeCtx({ hasAgents: false, hasPresets: false });
  const api = createApi(ctx, { cwd: '/w' });
  const skills = await api.listSkills({ cwd: '/w' });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'bundled-only');
  assert.equal(calls[0].registry, 'global');
  assert.equal(calls[0].params.scope, undefined, '全局视角不得伪造 scope');
});

test('给定 agent 时使用其 preset 内的 skills 实例，并传入该 agent 作为 scope', async () => {
  const { ctx, calls, agent, agentSkills } = fakeCtx();
  const api = createApi(ctx, { cwd: '/w' });
  const skills = await api.listSkills({ cwd: '/w', agent });

  assert.equal(skills[0].name, 'agent-visible', '必须读到 preset 作用域内的 skill');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].registry, 'scoped', '必须使用该 agent 视角的注册表实例');
  assert.equal(calls[0].params.scope, agent, 'scope 必须是 agent 自身（即作用域键）');
});

test('给定 sessionId 时经 agents 注册表解析到活跃 agent', async () => {
  const { ctx, calls, agent } = fakeCtx();
  const api = createApi(ctx, { cwd: '/w' });
  const skills = await api.listSkills({ cwd: '/w', sessionId: 'session-1' });

  assert.equal(skills[0].name, 'agent-visible');
  assert.equal(calls[0].registry, 'scoped');
  assert.equal(calls[0].params.scope, agent);
});

test('sessionId 未命中活跃 agent 时退回默认 preset 的 standing 作用域', async () => {
  const { ctx, calls, disposed } = fakeCtx();
  const api = createApi(ctx, { cwd: '/w' });
  const skills = await api.listSkills({ cwd: '/w', sessionId: 'unknown-session' });

  // 没有 agent 命中 → acquireScope() 提供 preset standing key
  assert.equal(skills[0].name, 'bundled-only');
  assert.equal(calls[0].registry, 'global');
  assert.notEqual(calls[0].params.scope, undefined, '必须带上 preset standing scope');
  assert.equal(disposed.length, 1, '租约必须归还');
});

test('getSkillDetail 也走同一视角（详情不得读全局层）', async () => {
  const { ctx, calls, agent } = fakeCtx();
  const api = createApi(ctx, { cwd: '/w' });
  const detail = await api.getSkillDetail('agent-visible', { cwd: '/w', agent });

  assert.ok(detail, 'preset 作用域内的 skill 必须能取到详情');
  assert.equal(detail.name, 'agent-visible');
  assert.equal(calls[0].registry, 'scoped');
  assert.equal(calls[0].params.scope, agent);
});

test('setSkillEnabled 的解析与复核都在同一视角内', async () => {
  const { ctx, calls, agent } = fakeCtx();
  const api = createApi(ctx, { cwd: '/w' });
  // 关键断言：不含 agent 时该 skill 不可见（证明视角确实是必要前提）
  await assert.rejects(
    () => api.setSkillEnabled('agent-visible', { enabled: false, cwd: '/w' }),
    /不存在/,
  );
  assert.equal(calls.at(-1).registry, 'global', '无视角时只能读全局层');
});

test('acquireScope 失败时安静退回全局视角', async () => {
  const { ctx, calls } = fakeCtx({ acquireThrows: true });
  const api = createApi(ctx, { cwd: '/w' });
  const skills = await api.listSkills({ cwd: '/w' });
  assert.equal(skills[0].name, 'bundled-only');
  assert.equal(calls[0].params.scope, undefined);
});

test('snapshot 披露本次读取的视角，全局层会被标记', async () => {
  const { ctx } = fakeCtx({ hasAgents: false, hasPresets: false });
  const api = createApi(ctx, { cwd: '/w' });
  const snap = await api.snapshot({ cwd: '/w' });
  assert.equal(snap.view.scopeKind, 'preset');
  assert.equal(snap.view.globalOnly, true, '只有 bundled 时必须标记为全局层');

  const { ctx: ctx2, agent } = fakeCtx();
  const snap2 = await createApi(ctx2, { cwd: '/w' }).snapshot({ cwd: '/w', agent });
  assert.equal(snap2.view.scopeKind, 'agent');
  assert.equal(snap2.view.globalOnly, false);
});
