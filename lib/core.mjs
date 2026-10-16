// dsh-skill-mcp-list —— 纯逻辑核心（零外部依赖，便于单元测试）
//
// 职责：
//   1. SKILL.md frontmatter 的定位与键值改写
//      —— 这是 DSH 中"启用/禁用 skill"的唯一持久化机制：
//         disable-model-invocation: true  → 模型侧不可见/不可加载
//         user-invocable: false           → 用户侧命令不可见
//      两个键缺省即"允许"，因此"启用"= 删除该键行（恢复默认），而不是写 false。
//   2. MCP 配置的脱敏投影 —— env / headers / url / args 中的凭据一律不外泄。
//   3. 列表排序、过滤与统计。

/** frontmatter 中控制"模型可调用"的键。 */
export const KEY_MODEL = 'disable-model-invocation';
/** frontmatter 中控制"用户可调用"的键。 */
export const KEY_USER = 'user-invocable';

/** 需要反斜杠转义的 YAML 键元字符（逐字符构造，避免正则字面量中的插值歧义）。 */
const REGEX_META = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\', '-']);

/**
 * 转义正则元字符。
 * @param {string} key 原始键名
 * @returns {string} 可安全嵌入正则的键名
 */
function escapeKey(key) {
  let out = '';
  for (const ch of key) out += REGEX_META.has(ch) ? '\\' + ch : ch;
  return out;
}

/**
 * 定位文件头部的 YAML frontmatter 区块。
 * 仅按行判断，不做 YAML 解析——改写只需要行级精度，且必须原样保留其余字节。
 * @param {string} text 文件全文
 * @returns {{lines: string[], openIndex: number, closeIndex: number}|null}
 */
export function locateFrontmatter(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const lines = text.split('\n');
  if (lines[0].replace(/\r$/, '') !== '---') return null;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '') === '---') {
      return { lines, openIndex: 0, closeIndex: i };
    }
  }
  return null;
}

/**
 * 收集 frontmatter 中某键所在的所有行号（处理重复键：保留首个，其余删除）。
 * @param {string[]} lines 全文行数组
 * @param {number} openIndex 区块起始行
 * @param {number} closeIndex 区块结束行
 * @param {string} key 顶层键名
 * @returns {number[]} 行号升序列表
 */
function keyLineIndexes(lines, openIndex, closeIndex, key) {
  const re = new RegExp('^' + escapeKey(key) + '[ \\t]*:');
  const found = [];
  for (let i = openIndex + 1; i < closeIndex; i += 1) {
    if (re.test(lines[i])) found.push(i);
  }
  return found;
}

/**
 * 设置或删除 frontmatter 顶层键。
 * @param {string} text 文件全文
 * @param {string} key 顶层键名
 * @param {string|number|boolean|null} value 目标值；null 表示删除该键行
 * @returns {{ok: boolean, text: string, changed: boolean, reason?: string}}
 */
export function setFrontmatterKey(text, key, value) {
  const fm = locateFrontmatter(text);
  if (fm === null) return { ok: false, text, changed: false, reason: 'no-frontmatter' };
  const { lines, openIndex, closeIndex } = fm;
  const eol = lines.some((line) => line.endsWith('\r')) ? '\r' : '';
  const hits = keyLineIndexes(lines, openIndex, closeIndex, key);

  if (value === null) {
    if (hits.length === 0) return { ok: true, text, changed: false };
    for (let i = hits.length - 1; i >= 0; i -= 1) lines.splice(hits[i], 1);
    return { ok: true, text: lines.join('\n'), changed: true };
  }

  const rendered = key + ': ' + String(value) + eol;
  if (hits.length === 0) {
    lines.splice(closeIndex, 0, rendered);
    return { ok: true, text: lines.join('\n'), changed: true };
  }
  let changed = false;
  if (lines[hits[0]] !== rendered) {
    lines[hits[0]] = rendered;
    changed = true;
  }
  for (let i = hits.length - 1; i >= 1; i -= 1) {
    lines.splice(hits[i], 1);
    changed = true;
  }
  return { ok: true, text: lines.join('\n'), changed };
}

/**
 * 把"启用/禁用某个调用面"翻译成 frontmatter 键值操作。
 * 启用 = 删除键行（恢复 DSH 默认的"允许"），禁用 = 写入显式值。
 * @param {'model'|'user'} field 调用面
 * @param {boolean} enabled 是否启用
 * @returns {{key: string, value: string|boolean|null}}
 */
export function invocationPatch(field, enabled) {
  if (field === 'model') return { key: KEY_MODEL, value: enabled ? null : true };
  if (field === 'user') return { key: KEY_USER, value: enabled ? null : false };
  throw new Error('未知的调用面: ' + String(field));
}

/** 敏感键名特征：命中即认为其值不可外泄。 */
const SECRET_KEY = /(?:token|secret|password|passwd|api[-_]?key|apikey|auth|credential|bearer|session|cookie|private)/i;
/** 文本中的 Bearer 令牌。 */
const BEARER = /(bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi;
/**
 * 文本中的 key=value / key: value 形式凭据。
 * 值类刻意排除 & 与 #：在 URL 查询串中它们是参数分隔符，吞掉它们会把
 * 后续的普通参数（如 keep=1）一并误删，既丢失信息又不增加安全性。
 */
const KV_SECRET = /((?:token|secret|password|passwd|api[-_]?key|apikey|auth)\s*[=:]\s*)([^\s,;'"&#]+)/gi;

/**
 * 对任意字符串做凭据遮蔽（用于 command / args / url 等自由文本）。
 * @param {unknown} value 原始值
 * @returns {string} 遮蔽后的文本
 */
export function maskSecretText(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.replace(BEARER, '$1[redacted]').replace(KV_SECRET, '$1[redacted]');
}

/**
 * 遮蔽 URL 中的用户信息与敏感查询参数，保留可运维的主机/路径信息。
 * @param {unknown} raw URL 文本
 * @returns {string} 遮蔽后的 URL；无法解析时退化为文本遮蔽
 */
export function sanitizeUrl(raw) {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  if (text.length === 0) return text;
  let url;
  try {
    url = new URL(text);
  } catch {
    return maskSecretText(text);
  }
  if (url.username !== '' || url.password !== '') {
    url.username = '';
    url.password = '';
  }
  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_KEY.test(name)) url.searchParams.set(name, 'REDACTED');
  }
  // 再走一次文本级遮蔽，兜住未被参数名规则识别、但值形如凭据的情况。
  return maskSecretText(url.toString());
}

/**
 * 把键值映射投影为"仅键名可见、值一律遮蔽"的列表。
 * 凭据可能藏在任意键名之下，因此这里不做白名单——值永远不外传。
 * @param {unknown} record 原始映射
 * @returns {{name: string, value: string}[]} 按名排序的脱敏条目
 */
export function redactRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return [];
  return Object.keys(record)
    .sort()
    .map((name) => ({ name, value: '[redacted]' }));
}

/**
 * 对命令行参数做凭据遮蔽。
 * @param {unknown} args 参数数组
 * @returns {string[]} 遮蔽后的参数
 */
export function sanitizeArgs(args) {
  if (!Array.isArray(args)) return [];
  return args.map((arg) => maskSecretText(arg));
}

/** 明确属于"用户 / 项目"来源的 skill。 */
const USER_SOURCES = new Set(['project-dsh', 'project-agents', 'custom', 'user-dsh', 'user-agents']);

/**
 * 判定 skill 归属"系统"还是"用户"。
 *
 * 依据提供方给出的 `source`，而不是路径猜测：
 *   - `bundled`：随 DSH 发行版分发（含内置 office / windows-acl 技能）→ 系统；
 *   - `runtime` 提供方注册的技能同样没有磁盘文件 → 系统；
 *   - `project-dsh` / `project-agents` / `custom` / `user-dsh` / `user-agents`
 *     都是用户或项目自己在 SKILL.md 里写下的 → 用户。
 *
 * 未知 source 保守判为系统：面板把"不确定"显示成系统，比把内置技能误标成
 * 用户更不容易误导运维判断。
 * @param {{provider?: string, source?: string}} skill skill 摘要
 * @returns {'system'|'user'} 归属
 */
export function skillOrigin(skill) {
  if (skill !== null && typeof skill === 'object') {
    if (skill.provider === 'runtime') return 'system';
    const source = typeof skill.source === 'string' ? skill.source : '';
    if (source === 'bundled') return 'system';
    if (USER_SOURCES.has(source)) return 'user';
  }
  return 'system';
}

/**
 * 计算 skill 的可切换性：只有落在地面文件系统、且能定位到指令文件的 skill
 * 才能通过改写 frontmatter 持久化启停状态。bundled / runtime 提供方只读。
 * @param {{provider?: string, source?: string, path?: string}} skill 目录摘要
 * @returns {{toggleable: boolean, reason?: string}}
 */
export function skillToggleability(skill) {
  if (skill === null || typeof skill !== 'object') return { toggleable: false, reason: '无效的 skill' };
  if (skill.provider === 'runtime') return { toggleable: false, reason: '运行时注册的 skill 没有磁盘文件' };
  if (typeof skill.path !== 'string' || skill.path.length === 0) {
    return { toggleable: false, reason: '提供方未暴露指令文件路径' };
  }
  return { toggleable: true };
}

/**
 * 汇总 skill 目录，附加可切换性与调用面状态。
 * @param {object[]} summaries ctx.skills.list() 的结果
 * @returns {object[]} 按名称排序的投影
 */
export function projectSkills(summaries) {
  const list = Array.isArray(summaries) ? summaries : [];
  return list
    .map((skill) => {
      const invocation = skill?.invocation ?? { modelInvocable: true, userInvocable: true };
      const toggle = skillToggleability(skill);
      return {
        name: String(skill?.name ?? ''),
        description: String(skill?.description ?? ''),
        whenToUse: typeof skill?.whenToUse === 'string' ? skill.whenToUse : null,
        source: String(skill?.source ?? ''),
        provider: String(skill?.provider ?? ''),
        // 系统 / 用户归属：面板与模型据此区分，避免把内置技能当成用户安装的。
        origin: skillOrigin(skill),
        path: typeof skill?.path === 'string' ? skill.path : null,
        resourceBase: skill?.resourceBase ?? null,
        modelInvocable: invocation.modelInvocable !== false,
        userInvocable: invocation.userInvocable !== false,
        enabled: invocation.modelInvocable !== false,
        toggleable: toggle.toggleable,
        toggleReason: toggle.reason ?? null,
      };
    })
    .filter((skill) => skill.name.length > 0)
    // 排序：系统自带在前、用户自装在后，组内再按名称升序。
    // 这样面板与模型工具返回的清单都是"内置先、自装后"，便于从上往下扫。
    .sort((a, b) => {
      if (a.origin !== b.origin) return a.origin === 'system' ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
}

/** MCP 客户端插件模块名——profile 中每个 MCP 服务器都是它的一个实例。 */
export const MCP_MODULE = '@deepseek-ai/dsh-mcp-client';

/**
 * 把一个 MCP 客户端条目投影成对外详情（凭据一律脱敏）。
 * @param {object} input 条目运行时状态与配置
 * @returns {object} 脱敏后的详情
 */
export function projectMcpServer(input) {
  const config = input?.config !== null && typeof input?.config === 'object' ? input.config : {};
  const transport = typeof config.transport === 'string' ? config.transport : 'unknown';
  const serverName = typeof config.serverName === 'string' && config.serverName.length > 0
    ? config.serverName
    : String(input?.entryId ?? '');
  const connection = transport === 'stdio'
    ? {
        kind: 'stdio',
        command: typeof config.command === 'string' ? maskSecretText(config.command) : null,
        args: sanitizeArgs(config.args),
        cwd: typeof config.cwd === 'string' && config.cwd.length > 0 ? config.cwd : null,
        env: redactRecord(config.env),
      }
    : {
        kind: transport,
        url: typeof config.url === 'string' ? sanitizeUrl(config.url) : null,
        headers: redactRecord(config.headers),
      };
  const readOnlyReason = typeof input?.readOnlyReason === 'string' ? input.readOnlyReason : null;
  const patchId = typeof input?.patchId === 'string' ? input.patchId : null;
  return {
    entryId: String(input?.entryId ?? ''),
    serverName,
    moduleName: String(input?.moduleName ?? MCP_MODULE),
    transport,
    enabled: input?.enabled === true,
    fiberPhase: input?.fiberPhase ?? null,
    patchId,
    readOnlyReason,
    toggleable: patchId !== null && readOnlyReason === null,
    connection,
    toolCallTimeoutMs: typeof config.toolCallTimeoutMs === 'number' ? config.toolCallTimeoutMs : null,
    failOnStartupError: config.failOnStartupError === true,
    reconnect: config.reconnect ?? null,
    maxInstructionBytes: typeof config.maxInstructionBytes === 'number' ? config.maxInstructionBytes : null,
    toolCount: Array.isArray(input?.toolNames) ? input.toolNames.length : 0,
    toolNames: Array.isArray(input?.toolNames) ? [...input.toolNames].sort() : [],
  };
}

/**
 * 汇总统计，供 UI 头部与模型快速判读。
 * @param {object[]} skills 已投影的 skill 列表
 * @param {object[]} servers 已投影的 MCP 服务器列表
 * @returns {object} 统计结果
 */
export function summarize(skills, servers) {
  const skillList = Array.isArray(skills) ? skills : [];
  const serverList = Array.isArray(servers) ? servers : [];
  return {
    skills: {
      total: skillList.length,
      enabled: skillList.filter((skill) => skill.enabled).length,
      disabled: skillList.filter((skill) => !skill.enabled).length,
      toggleable: skillList.filter((skill) => skill.toggleable).length,
      // 系统 vs 用户：头部卡片与模型判读都依赖这一分组。
      system: skillList.filter((skill) => skill.origin === 'system').length,
      user: skillList.filter((skill) => skill.origin === 'user').length,
      providers: [...new Set(skillList.map((skill) => skill.provider))].sort(),
      sources: [...new Set(skillList.map((skill) => skill.source))].sort(),
    },
    mcp: {
      total: serverList.length,
      enabled: serverList.filter((server) => server.enabled).length,
      disabled: serverList.filter((server) => !server.enabled).length,
      toggleable: serverList.filter((server) => server.toggleable).length,
      tools: serverList.reduce((sum, server) => sum + server.toolCount, 0),
      transports: [...new Set(serverList.map((server) => server.transport))].sort(),
    },
  };
}
