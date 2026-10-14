// dsh-skill-mcp-list —— 宿主侧 API 层
//
// 本模块刻意只依赖 node: 内置模块与 ./core.mjs，不导入任何 @deepseek-ai/*
// 运行时包。因此它可以在纯 Node 下用假 ctx 完整测试，也让 index.mjs 专注于
// Cordis 接线（工具注册、HTTP 路由、权限升级）。
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  MCP_MODULE,
  invocationPatch,
  projectMcpServer,
  projectSkills,
  setFrontmatterKey,
  summarize,
} from './core.mjs';
import {
  applyMcpPatch,
  normalizeMcpPatch,
  renderSkillMarkdown,
  validateSkillName,
} from './install.mjs';

/** Loader 的 Fiber 状态码 → 可读阶段（与官方 host-plugin-inventory 一致）。 */
const FIBER_PHASE = ['pending', 'loading', 'active', 'failed', null, 'unloading'];

/**
 * 校验目标文件确实是 skill 指令文件，避免越界写入。
 * 仅允许 SKILL.md 或以 .md 结尾的平铺 skill 文件。
 * @param {string} path 候选路径
 * @returns {boolean} 是否允许写入
 */
export function isSkillInstructionFile(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  const base = basename(path);
  return base === 'SKILL.md' || /\.md$/i.test(base);
}

/**
 * 原子写入文本：先写同目录临时文件，再 rename 覆盖，避免半截文件被
 * skill 监视器读到后误判为无效 skill。
 * @param {string} path 目标文件
 * @param {string} content 新内容
 */
export async function writeFileAtomic(path, content) {
  const tmp = path + '.dsh-skill-mcp-list.tmp';
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

/**
 * 探测路径是否存在。
 * @param {string} path 目标路径
 * @returns {Promise<boolean>} 是否存在
 */
async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析 DSH home 目录。
 *
 * 优先级以**活动 profile** 为先，其次才是 $DSH_HOME：
 * profile 位于 <dshHome>/profiles/<name>，其上两级即 home。宿主进程与环境变量
 * 都可能指向别的 home（例如子进程继承了父进程的 DSH_HOME），而安装落点必须与
 * 当前正在运行的 skill 提供方一致，否则会把 skill 写到一个不被扫描的根里。
 * 都没有时退回 ~/.dsh，与官方 dsh-home-paths 的兜底一致。
 * @param {object} ctx Cordis 上下文
 * @returns {string} 绝对路径
 */
function resolveDshHome(ctx) {
  // 必须走 ctx.get()：直接读 ctx.profileContext 在未 inject 时会被 Cordis
  // 代理拒绝（抛 "cannot get property without inject"），而不是返回 undefined。
  let profileDir;
  try {
    profileDir = ctx?.get?.('profileContext')?.dir;
  } catch {
    profileDir = undefined;
  }
  if (typeof profileDir === 'string' && profileDir.trim().length > 0) {
    return dirname(dirname(resolve(profileDir)));
  }
  const fromEnv = process.env.DSH_HOME?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return resolve(fromEnv);
  return join(homedir(), '.dsh');
}

/**
 * 解析 skill 扫描根列表，与 dsh-skill-filesystem 的默认根保持一致。
 *
 * 这里不复用提供方内部实现（其 watch 管理器与 fiber 生命周期耦合），
 * 只重建"路径 + source"这一最小投影，用于确定安装落点。
 * @param {object} ctx Cordis 上下文
 * @param {string} cwd 工作目录（决定项目级根）
 * @returns {Promise<{path: string, source: string}[]>} 根列表
 */
async function resolveSkillRoots(ctx, cwd) {
  const roots = [];
  const dshHome = resolveDshHome(ctx);
  const agentsHome = process.env.DSH_AGENTS_HOME?.trim() || join(homedir(), '.agents');

  if (cwd !== undefined) {
    const projectRoot = await findProjectRoot(resolve(cwd));
    roots.push({ path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh' });
    roots.push({ path: join(projectRoot, '.agents', 'skills'), source: 'project-agents' });
  }
  roots.push({ path: join(dshHome, 'skills'), source: 'user-dsh' });
  roots.push({ path: join(agentsHome, 'skills'), source: 'user-agents' });
  return roots;
}

/**
 * 向上查找最近的 .git 祖先作为项目根。
 * @param {string} start 起始目录
 * @returns {Promise<string>} 项目根；无 .git 时返回起始目录
 */
async function findProjectRoot(start) {
  let current = start;
  while (true) {
    if (await pathExists(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

/**
 * 从 Loader 读取 MCP 客户端条目的运行时状态。
 * @param {object} ctx Cordis 上下文
 * @returns {object[]} 条目列表（含 config / entryId / enabled / fiberPhase）
 */
export function readMcpEntries(ctx) {
  const entries = [];
  let rows;
  try {
    rows = [...ctx.loader.entries()];
  } catch {
    return entries;
  }
  for (const entry of rows) {
    const options = entry.options ?? {};
    if (options.group) continue;
    if (options.name !== MCP_MODULE) continue;
    const state = entry.fiber === undefined ? null : entry.fiber.state;
    entries.push({
      entryId: entry.id,
      moduleName: options.name,
      config: options.config ?? {},
      enabled: entry.disabled !== true,
      fiberPhase: state === null ? null : FIBER_PHASE[state] ?? null,
    });
  }
  return entries;
}

/**
 * 读取某个 MCP 服务器已注册到工具注册表的工具名。
 * 命名契约：mcp__<serverName>__<rawName>（见官方 mcp-client 的命名不变量）。
 * @param {object} ctx Cordis 上下文
 * @param {string} serverName 服务器命名空间
 * @returns {string[]} 工具名列表
 */
export function readMcpToolNames(ctx, serverName) {
  const prefix = 'mcp__' + serverName + '__';
  try {
    return ctx.tools
      .schemas()
      .map((schema) => schema.name)
      .filter((toolName) => typeof toolName === 'string' && toolName.startsWith(prefix));
  } catch {
    return [];
  }
}

/**
 * 构造插件对外 API。所有方法都是显式的"读—改—校验"操作，便于独立测试。
 * @param {object} ctx Cordis 上下文
 * @param {{cwd?: string}} options 默认工作目录
 * @returns {object} API 方法集合
 */
export function createApi(ctx, options = {}) {
  const defaultCwd = options.cwd ?? process.cwd();

  /**
   * 解析查询用 cwd：项目级 skill 根依赖 cwd 才能被发现。
   * @param {unknown} raw 调用方传入的 cwd
   * @returns {string} 工作目录
   */
  const resolveCwd = (raw) => (typeof raw === 'string' && raw.trim().length > 0 ? raw : defaultCwd);

  /**
   * 列出全部 skill。
   * @param {{cwd?: string}} params 查询参数
   * @returns {Promise<object[]>} 投影后的 skill 列表
   */
  async function listSkills(params = {}) {
    const cwd = resolveCwd(params.cwd);
    const summaries = await ctx.skills.list({ cwd });
    return projectSkills(summaries);
  }

  /**
   * 列出全部 MCP 服务器，附带官方 pluginManager 给出的可写目标与只读原因。
   * @returns {Promise<object[]>} 投影后的服务器列表
   */
  async function listMcpServers() {
    const entries = readMcpEntries(ctx);
    const manager = ctx.get('pluginManager');
    let rows = [];
    if (manager !== undefined) {
      try {
        rows = await manager.listPlugins();
      } catch {
        rows = [];
      }
    }
    const byEntryId = new Map(rows.map((row) => [String(row.entryId), row]));
    return entries
      .map((entry) => {
        const row = byEntryId.get(String(entry.entryId));
        const serverName =
          typeof entry.config?.serverName === 'string' ? entry.config.serverName : entry.entryId;
        return projectMcpServer({
          ...entry,
          patchId: row?.patchId ?? null,
          readOnlyReason: row?.readOnlyReason ?? (manager === undefined ? 'plugin-manager-unavailable' : null),
          toolNames: readMcpToolNames(ctx, serverName),
        });
      })
      .sort((a, b) => (a.serverName < b.serverName ? -1 : a.serverName > b.serverName ? 1 : 0));
  }

  /**
   * 读取单个 skill 的完整详情（含指令正文，用于详情面板）。
   * @param {string} skillName skill 名
   * @param {{cwd?: string}} params 查询参数
   * @returns {Promise<object|null>} 详情对象；不存在时返回 null
   */
  async function getSkillDetail(skillName, params = {}) {
    const cwd = resolveCwd(params.cwd);
    const definition = await ctx.skills.get(skillName, { cwd });
    if (definition === undefined) return null;
    const projected = projectSkills([definition])[0] ?? null;
    return {
      ...(projected ?? {}),
      content: typeof definition.content === 'string' ? definition.content : '',
      contentBytes:
        typeof definition.content === 'string' ? Buffer.byteLength(definition.content, 'utf8') : 0,
      metadata: definition.metadata ?? null,
    };
  }

  /**
   * 启用 / 禁用某个 skill 的调用面，持久化到其 SKILL.md frontmatter。
   * @param {string} skillName skill 名
   * @param {{enabled: boolean, field?: 'model'|'user', cwd?: string}} params 变更参数
   * @returns {Promise<object>} 变更结果与变更后的状态
   */
  async function setSkillEnabled(skillName, params) {
    const field = params.field === 'user' ? 'user' : 'model';
    const enabled = params.enabled === true;
    const cwd = resolveCwd(params.cwd);

    // 先经注册表解析：保证改的是"当前生效的那个" skill，而不是同名文件。
    const definition = await ctx.skills.get(skillName, { cwd });
    if (definition === undefined) throw new Error('skill "' + skillName + '" 不存在');
    const path = definition.path;
    if (!isSkillInstructionFile(path)) {
      throw new Error('skill "' + skillName + '" 没有可写的指令文件路径，无法持久化启停状态');
    }

    const before = await readFile(path, 'utf8');
    const patch = invocationPatch(field, enabled);
    const patched = setFrontmatterKey(before, patch.key, patch.value);
    if (!patched.ok) {
      throw new Error('skill "' + skillName + '" 的指令文件缺少 YAML frontmatter，无法写入 ' + patch.key);
    }
    if (patched.changed) await writeFileAtomic(path, patched.text);

    // get() 每次都会重新读取正文，因此这里立即反映新状态，无需等待监视器。
    const after = await ctx.skills.get(skillName, { cwd });
    return {
      target: skillName,
      kind: 'skill',
      field,
      enabled,
      path,
      changed: patched.changed,
      state: after === undefined ? null : projectSkills([after])[0] ?? null,
    };
  }

  /**
   * 启用 / 禁用某个 MCP 服务器，委托官方 pluginManager 原子写入 profile 配置。
   * @param {string} entryId Loader 条目 id
   * @param {boolean} enabled 目标状态
   * @returns {Promise<object>} 变更结果
   */
  async function setMcpEnabled(entryId, enabled) {
    const manager = ctx.get('pluginManager');
    if (manager === undefined) throw new Error('pluginManager 服务不可用，无法持久化 MCP 启停状态');
    const servers = await listMcpServers();
    const target = servers.find((server) => server.entryId === entryId);
    if (target === undefined) throw new Error('MCP 条目 "' + entryId + '" 不存在');
    if (!target.toggleable) {
      throw new Error('MCP 条目 "' + entryId + '" 不可切换：' + (target.readOnlyReason ?? '未知原因'));
    }
    const result = await manager.setPluginEnabled(entryId, enabled === true);
    return { target: entryId, kind: 'mcp', serverName: target.serverName, enabled: enabled === true, result };
  }

  /**
   * 汇总快照：列表 + 统计 + 能力可用性。
   * @param {{cwd?: string}} params 查询参数
   * @returns {Promise<object>} 快照
   */
  async function snapshot(params = {}) {
    const [skills, servers] = await Promise.all([listSkills(params), listMcpServers()]);
    return {
      ok: true,
      generatedAt: Date.now(),
      cwd: resolveCwd(params.cwd),
      summary: summarize(skills, servers),
      skills,
      mcpServers: servers,
      capabilities: {
        skillToggle: true,
        skillInstall: true,
        mcpToggle: ctx.get('pluginManager') !== undefined,
        mcpConfigure: ctx.get('configEditor') !== undefined,
        detail: true,
      },
    };
  }

  /**
   * 安装一个新 skill：在指定根下创建 <name>/SKILL.md。
   *
   * 落点是用户 skill 根（source 为 user-dsh），这是 DSH 中用户自有 skill 的
   * 规范位置；dsh-skill-filesystem 会通过监视器自动发现新目录，无需手动刷新。
   * @param {{name: string, description: string, whenToUse?: string, body?: string, cwd?: string}} params 新建参数
   * @returns {Promise<object>} 安装结果
   */
  async function installSkill(params) {
    const name = validateSkillName(params?.name);
    if (!name.ok) throw new Error(name.reason);

    // 目标根：用户 skill 根（source 为 user-dsh）。
    const cwd = resolveCwd(params?.cwd);
    const roots = await resolveSkillRoots(ctx, cwd);
    const target = roots.find((root) => root.source === 'user-dsh') ?? roots[0];
    if (target === undefined) {
      throw new Error('未找到可写的 skill 根目录（user-dsh）');
    }

    const skillDir = join(target.path, name.name);
    const skillFile = join(skillDir, 'SKILL.md');

    // 收尾防线：目标必须严格落在所选根之内。名字已过 kebab-case 校验，
    // 这里再确认一次，避免任何路径穿越把文件写到根之外。
    const rootResolved = resolve(target.path);
    if (resolve(skillFile) !== join(rootResolved, name.name, 'SKILL.md')) {
      throw new Error('skill 安装路径校验失败：' + name.name);
    }

    if (await pathExists(skillFile)) {
      throw new Error('skill "' + name.name + '" 已存在于 ' + target.path + '，请换个名称或直接编辑现有文件');
    }

    const markdown = renderSkillMarkdown({
      name: name.name,
      description: params?.description,
      whenToUse: params?.whenToUse,
      body: params?.body,
    });

    await mkdir(skillDir, { recursive: true });
    await writeFileAtomic(skillFile, markdown);

    // get() 每次重读文件，因此新 skill 立即可见。
    const after = await ctx.skills.get(name.name, { cwd });
    return {
      target: name.name,
      kind: 'skill',
      action: 'install',
      root: target.path,
      source: target.source,
      path: skillFile,
      state: after === undefined ? null : projectSkills([after])[0] ?? null,
    };
  }

  /**
   * 配置一个已安装的 MCP 服务器：通过官方 configEditor 校验并持久化。
   *
   * 只走官方路径——configEditor 会用条目自身的 Config schema 校验完整候选值，
   * 保留注释与 !!js 表达式，并在写盘失败时回滚到旧补丁。
   * @param {string} entryId Loader 条目 id
   * @param {object} patch 配置补丁
   * @returns {Promise<object>} 变更结果与变更后的详情
   */
  async function configureMcp(entryId, patch) {
    const editor = ctx.get('configEditor');
    if (editor === undefined) throw new Error('configEditor 服务不可用，无法持久化 MCP 配置');

    const servers = await listMcpServers();
    const target = servers.find((server) => server.entryId === entryId);
    if (target === undefined) throw new Error('MCP 条目 "' + entryId + '" 不存在');

    // 取当前原始配置做补丁规范化与自洽校验。
    const current = readMcpEntries(ctx).find((entry) => entry.entryId === entryId)?.config ?? {};
    const normalized = normalizeMcpPatch(patch, current);
    if (!normalized.ok) throw new Error(normalized.reason);

    // 定位 Loader 条目本体，configEditor.edit 需要它。
    let entry;
    try {
      entry = [...ctx.loader.entries()].find((row) => row.id === entryId);
    } catch {
      entry = undefined;
    }
    if (entry === undefined) throw new Error('MCP 条目 "' + entryId + '" 已不在 Loader 中');

    await editor.edit(entry, (currentConfig) => {
      const merged = applyMcpPatch(currentConfig, normalized.patch);
      // 端口/超时等数值字段由 configEditor 的 resolveConfig 校验，这里只保证形态。
      return merged;
    });

    const after = (await listMcpServers()).find((server) => server.entryId === entryId);
    return {
      target: entryId,
      kind: 'mcp',
      action: 'configure',
      serverName: target.serverName,
      changed: normalized.patch,
      state: after ?? null,
    };
  }

  return {
    snapshot,
    listSkills,
    listMcpServers,
    getSkillDetail,
    setSkillEnabled,
    setMcpEnabled,
    installSkill,
    configureMcp,
  };
}
