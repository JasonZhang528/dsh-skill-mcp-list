// dsh-skill-mcp-list —— 宿主侧插件入口（Cordis 接线层）
//
// 本文件只负责与 DSH 运行时接线，业务逻辑在 ./api.mjs（可在纯 Node 下测试）：
//   1. 模型工具 skill_mcp_list —— 查询 / 详情 / 启用 / 禁用
//   2. HTTP API /api/skill-mcp-list —— 供 Web 面板读写
//
// 启用 / 禁用的落点：
//   - skill：改写其 SKILL.md 的 frontmatter（disable-model-invocation /
//     user-invocable），这是 DSH 中唯一可持久化 skill 启停状态的机制。
//   - MCP ：委托官方 ctx.pluginManager.setPluginEnabled()，由它原子地写入
//     profile 的 cordis.patch.yml 并触发 HMR 重载。
//
// 可选服务（pluginManager / webServer / connection / sandboxPolicy / approval）
// 一律用 ctx.get() 读取，因此缺少任一能力时插件仍能加载，只是相应功能降级。
import { defineTool } from '@deepseek-ai/dsh-tools';
import { approveEscalation } from '@deepseek-ai/dsh-sandbox';
import { createApi } from './api.mjs';

/** Cordis 插件身份。 */
export const name = 'skill-mcp-list';

/** 必需服务：skill 注册表、工具注册表、Loader（读取 MCP 条目）。 */
export const inject = ['skills', 'tools', 'loader'];

/** HTTP API 路径：exact 路由，优先级高于 /api prefix 的信任栅栏，需自行过栅栏。 */
const API_PATH = '/api/skill-mcp-list';

/** 模型工具的写入操作所需的权限级别。 */
const WRITE_MODE = 'danger-full-access';

/** 需要权限升级的 action 集合。 */
const WRITE_ACTIONS = new Set([
  'enable_skill',
  'disable_skill',
  'enable_mcp',
  'disable_mcp',
  'install_skill',
  'configure_mcp',
]);

/**
 * 读取并解析 JSON 请求体（上限 256 KiB，避免无界缓冲）。
 * @param {import('node:http').IncomingMessage} req 请求
 * @returns {Promise<object>} 解析后的对象；空体返回 {}
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 262144) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求体必须是 JSON 对象');
  }
  return parsed;
}

/**
 * 向响应写回 JSON。
 * @param {import('node:http').ServerResponse} res 响应
 * @param {number} status HTTP 状态码
 * @param {object} payload 响应体
 */
function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

/**
 * 注册模型工具 skill_mcp_list。
 * 读操作无需额外权限；写操作按 DSH 约定申请 danger-full-access 一次性升级，
 * 与官方 plugin_manager 工具保持同一安全姿态（拒绝即失败，绝不绕过）。
 * @param {object} ctx Cordis 上下文
 * @param {object} api 插件 API
 */
function registerTool(ctx, api) {
  ctx.tools.register(
    defineTool({
      name: 'skill_mcp_list',
      description:
        'List the skills and MCP servers installed in this DSH, show their details, and enable or disable them. ' +
        'Skills come from the skill registry (project, user, bundled and runtime providers); enabling or disabling ' +
        'one rewrites the disable-model-invocation / user-invocable keys in its SKILL.md frontmatter. MCP servers ' +
        'are the @deepseek-ai/dsh-mcp-client entries of the current profile; enabling or disabling one writes the ' +
        'profile configuration and reloads it, so the change affects every session in this profile. Every write ' +
        'requires danger-full-access permission or approval for that call. Credentials in MCP configuration are ' +
        'always redacted. Call action "list" first to obtain exact names.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: [
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
          description:
            'Operation: list everything, read counts only, read one detail, toggle one skill or MCP server, ' +
            'install a new skill, or configure an installed MCP server.',
        },
        target: {
          type: 'string',
          description:
            'Skill name for skill actions, or the MCP entry id (for example "mcp-dbx") for MCP actions. Required except for "list", "summary", and "install_skill".',
        },
        field: {
          type: 'string',
          enum: ['model', 'user'],
          description:
            'For skill toggles: which invocation surface to change. "model" (default) controls the model-facing catalog; "user" controls human-facing commands.',
        },
        spec: {
          type: 'object',
          additionalProperties: true,
          description:
            'For "install_skill": { name, description, whenToUse?, body? }. The skill is created under the user skill root.',
        },
        config: {
          type: 'object',
          additionalProperties: true,
          description:
            'For "configure_mcp": a config patch for an installed MCP server, for example { toolCallTimeoutMs: 120000, ' +
            'failOnStartupError: true } or { url: "http://host:port/mcp" }. Only existing fields are accepted.',
        },
        cwd: {
          type: 'string',
          description:
            'Workspace directory used to discover project-level skills. Defaults to the harness working directory.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        if (WRITE_ACTIONS.has(args.action)) {
          // 写操作会改动 profile 配置或工作区外的 skill 文件；按 DSH 约定显式升级权限。
          const policyService = ctx.get('sandboxPolicy');
          const policy =
            policyService === undefined
              ? { mode: 'read-only' }
              : policyService.resolve(exec.agent === undefined ? {} : { session: exec.agent.session });
          await approveEscalation(
            {
              requestedMode: WRITE_MODE,
              effectiveMode: policy.mode,
              subject: 'skill/MCP management operation',
              justification:
                'skill_mcp_list ' +
                JSON.stringify(args) +
                '. Enabling or disabling a skill rewrites its SKILL.md frontmatter; installing a skill writes a new ' +
                'SKILL.md under the user skill root; enabling or disabling an MCP server rewrites the profile ' +
                'configuration and affects every session in this profile; configuring an MCP server edits its entry ' +
                'config in the profile patch.',
            },
            {
              approver: ctx.get('approval'),
              agent: exec.agent,
              callId: exec.callId,
              toolName: 'skill_mcp_list',
              signal: exec.signal,
            },
          );
          exec.signal.throwIfAborted();
        }

        switch (args.action) {
          case 'list':
            return JSON.stringify(await api.snapshot({ cwd: args.cwd }));
          case 'summary': {
            const snap = await api.snapshot({ cwd: args.cwd });
            return JSON.stringify({ cwd: snap.cwd, summary: snap.summary, capabilities: snap.capabilities });
          }
          case 'detail': {
            if (args.target === undefined) throw new Error('detail 需要 target');
            const skill = await api.getSkillDetail(args.target, { cwd: args.cwd });
            if (skill !== null) return JSON.stringify(skill);
            const servers = await api.listMcpServers();
            const server = servers.find(
              (item) => item.entryId === args.target || item.serverName === args.target,
            );
            if (server === undefined) throw new Error('未找到 skill 或 MCP 条目 "' + args.target + '"');
            return JSON.stringify(server);
          }
          case 'enable_skill':
          case 'disable_skill': {
            if (args.target === undefined) throw new Error(args.action + ' 需要 target');
            return JSON.stringify(
              await api.setSkillEnabled(args.target, {
                enabled: args.action === 'enable_skill',
                field: args.field,
                cwd: args.cwd,
              }),
            );
          }
          case 'enable_mcp':
          case 'disable_mcp': {
            if (args.target === undefined) throw new Error(args.action + ' 需要 target');
            return JSON.stringify(await api.setMcpEnabled(args.target, args.action === 'enable_mcp'));
          }
          case 'install_skill':
            return JSON.stringify(await api.installSkill({ ...(args.spec ?? {}), cwd: args.cwd }));
          case 'configure_mcp': {
            if (args.target === undefined) throw new Error('configure_mcp 需要 target');
            if (args.config === undefined) throw new Error('configure_mcp 需要 config');
            return JSON.stringify(await api.configureMcp(args.target, args.config));
          }
          default:
            throw new Error('未知的 action: ' + String(args.action));
        }
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'Skills & MCP',
        kind: args.action === 'list' || args.action === 'detail' || args.action === 'summary' ? 'read' : 'other',
        rawInput: args,
      }),
    }),
  );
}

/**
 * 注册 Web 面板的数据通道。
 * @param {object} ctx Cordis 上下文
 * @param {object} api 插件 API
 */
function registerHttpApi(ctx, api) {
  // webServer / connection 是可选服务：没有 Web 宿主时模型工具照常工作。
  ctx.inject(['webServer', 'connection'], (inner) => {
    inner.effect(
      () =>
        inner.webServer.register({
          kind: 'exact',
          path: API_PATH,
          handler: async (req, res) => {
            // 本路由挂在 /api 下且为 exact，优先于 dsh-client-connection 在 /api
            // prefix 上的信任栅栏，因此必须自行执行同一栅栏（同源 + 浏览器认证）。
            // 拿不到栅栏服务时拒绝服务，而不是放行。
            const rejection =
              typeof inner.connection?.requestRejection === 'function'
                ? inner.connection.requestRejection(req)
                : 503;
            if (rejection !== undefined) {
              sendJson(res, rejection, {
                ok: false,
                error: rejection === 401 ? 'unauthorized' : rejection === 403 ? 'forbidden' : 'unavailable',
              });
              return;
            }
            try {
              const url = new URL(req.url ?? API_PATH, 'http://localhost');
              if (req.method === 'GET') {
                sendJson(res, 200, await api.snapshot({ cwd: url.searchParams.get('cwd') ?? undefined }));
                return;
              }
              if (req.method === 'POST') {
                const body = await readJsonBody(req);
                switch (body.action) {
                  case 'set_skill':
                    sendJson(
                      res,
                      200,
                      await api.setSkillEnabled(String(body.target), {
                        enabled: body.enabled === true,
                        field: body.field === 'user' ? 'user' : 'model',
                        cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
                      }),
                    );
                    return;
                  case 'set_mcp':
                    sendJson(res, 200, await api.setMcpEnabled(String(body.target), body.enabled === true));
                    return;
                  case 'install_skill':
                    sendJson(
                      res,
                      200,
                      await api.installSkill({
                        ...(body.spec ?? {}),
                        cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
                      }),
                    );
                    return;
                  case 'configure_mcp':
                    sendJson(res, 200, await api.configureMcp(String(body.target), body.config ?? {}));
                    return;
                  case 'detail': {
                    const skill = await api.getSkillDetail(String(body.target), {
                      cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
                    });
                    if (skill !== null) {
                      sendJson(res, 200, skill);
                      return;
                    }
                    const servers = await api.listMcpServers();
                    const server = servers.find(
                      (item) => item.entryId === body.target || item.serverName === body.target,
                    );
                    sendJson(
                      res,
                      server === undefined ? 404 : 200,
                      server === undefined ? { ok: false, error: 'not-found' } : server,
                    );
                    return;
                  }
                  default:
                    sendJson(res, 400, { ok: false, error: '未知的 action: ' + String(body.action) });
                    return;
                }
              }
              sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
            } catch (error) {
              sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
          },
        }),
      'skill-mcp-list: http api',
    );
  });
}

/**
 * 插件入口。
 * @param {object} ctx Cordis 上下文
 * @param {object} config 插件配置
 */
export function apply(ctx, config = {}) {
  const api = createApi(ctx, { cwd: config.cwd });
  // ctx.provide 由当前 fiber 持有生命周期，卸载时自动注销服务。
  ctx.provide('skillMcpList', api);

  registerTool(ctx, api);
  registerHttpApi(ctx, api);
}
