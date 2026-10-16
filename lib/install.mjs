// dsh-skill-mcp-list —— Skill 安装与 MCP 配置的纯逻辑（零外部依赖）
//
// 职责：
//   1. 生成新 skill 的 SKILL.md（frontmatter + 正文），保持与 dsh-skill-filesystem
//      的解析契约一致：name 必填且 kebab-case、description 必填且非空。
//   2. 校验 skill 名与目标路径，避免越界写入或覆盖既有 skill。
//   3. 校验 MCP 配置变更：只放行 dsh-mcp-client 的既有字段，且保持 transport
//      自洽（stdio 需 command，streamable-http 需 url），防止把配置写坏。
//
// 本模块刻意只依赖 node: 内置模块，不导入任何 @deepseek-ai/* 或 yaml，
// 因此可在纯 Node 下完整单测，也让 host 接线层（lib/index.mjs）只负责编排。

/** skill 名的合法形态：kebab-case，与官方注册表一致。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 校验 skill 名是否符合 DSH 契约。
 * @param {unknown} name 候选名
 * @returns {{ok: boolean, name?: string, reason?: string}} 校验结果
 */
export function validateSkillName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, reason: 'skill 名称不能为空' };
  }
  const trimmed = name.trim();
  if (!SKILL_NAME.test(trimmed)) {
    return {
      ok: false,
      reason: 'skill 名称必须为 kebab-case（小写字母、数字与连字符，且不能以连字符开头或结尾）',
    };
  }
  if (trimmed.length > 64) {
    return { ok: false, reason: 'skill 名称长度不能超过 64 个字符' };
  }
  return { ok: true, name: trimmed };
}

/**
 * 校验 skill 描述。
 * @param {unknown} description 候选描述
 * @returns {{ok: boolean, description?: string, reason?: string}} 校验结果
 */
export function validateSkillDescription(description) {
  if (typeof description !== 'string' || description.trim().length === 0) {
    return { ok: false, reason: 'skill 描述不能为空' };
  }
  const trimmed = description.trim();
  if (trimmed.length > 500) {
    return { ok: false, reason: 'skill 描述长度不能超过 500 个字符' };
  }
  return { ok: true, description: trimmed };
}

/**
 * 需要给 YAML 标量加引号的字符集合。
 * 反引号（U+0060）用码点表示，避免源码中出现裸反引号。
 * @type {Set<string>}
 */
const YAML_SPECIAL = new Set([
  ':', '#', '[', ']', '{', '}', '&', '*', '!', '|', '>', "'", '"', '%', '@', ',', String.fromCodePoint(96), '\n',
]);

/**
 * 渲染 YAML 字符串标量：含特殊字符时加双引号并转义。
 * @param {string} value 原始值
 * @returns {string} YAML 标量
 */
function yamlScalar(value) {
  let needsQuote = value !== value.trim();
  if (!needsQuote) {
    for (const ch of value) {
      if (YAML_SPECIAL.has(ch)) { needsQuote = true; break; }
    }
  }
  if (!needsQuote) return value;
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

/**
 * 生成新 skill 的 SKILL.md 全文。
 * 生成的 frontmatter 刻意不写 disable-model-invocation / user-invocable，
 * 让新 skill 默认在两个调用面都可用，与官方缺省语义一致。
 * @param {{name: string, description: string, whenToUse?: string, body?: string}} spec 新建参数
 * @returns {string} SKILL.md 内容
 */
export function renderSkillMarkdown(spec) {
  const name = validateSkillName(spec?.name);
  if (!name.ok) throw new Error(name.reason);
  const description = validateSkillDescription(spec?.description);
  if (!description.ok) throw new Error(description.reason);

  const whenToUse = typeof spec?.whenToUse === 'string' ? spec.whenToUse.trim() : '';
  if (whenToUse.length > 500) throw new Error('whenToUse 长度不能超过 500 个字符');

  const body = typeof spec?.body === 'string' ? spec.body.replace(/\r\n/g, '\n').replace(/\s+$/, '') : '';

  const lines = ['---', 'name: ' + yamlScalar(name.name), 'description: ' + yamlScalar(description.description)];
  if (whenToUse.length > 0) lines.push('whenToUse: ' + yamlScalar(whenToUse));
  lines.push('---', '');
  if (body.length > 0) lines.push(body, '');
  return lines.join('\n');
}

/**
 * 在给定正文中定位 frontmatter 区块（与 lib/core.mjs 同规则，独立实现以保持零依赖）。
 * @param {string} text 文件全文
 * @returns {{lines: string[], openIndex: number, closeIndex: number}|null}
 */
function locateFrontmatter(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const lines = text.split('\n');
  if (lines[0].replace(/\r$/, '') !== '---') return null;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '') === '---') return { lines, openIndex: 0, closeIndex: i };
  }
  return null;
}

/**
 * 从 SKILL.md 中读取 name，用于校验目录名与声明名一致。
 * @param {string} text 文件全文
 * @returns {string|null} 声明名，无法解析时为 null
 */
export function readDeclaredName(text) {
  const fm = locateFrontmatter(text);
  if (fm === null) return null;
  for (let i = fm.openIndex + 1; i < fm.closeIndex; i += 1) {
    const match = /^name\s*:\s*(.*)$/.exec(fm.lines[i]);
    if (match === null) continue;
    const raw = match[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    return raw.length > 0 ? raw : null;
  }
  return null;
}

/** MCP 配置中允许通过弹窗修改的字段及其校验规则。 */
const MCP_EDITABLE = {
  serverName: { type: 'string', pattern: /^[A-Za-z0-9_-]{1,32}$/, label: '服务器名' },
  transport: { type: 'enum', values: ['stdio', 'streamable-http'], label: '传输方式' },
  command: { type: 'string', optional: true, label: '命令' },
  args: { type: 'string-array', optional: true, label: '参数' },
  cwd: { type: 'string', optional: true, label: '工作目录' },
  url: { type: 'string', optional: true, label: 'URL' },
  env: { type: 'string-map', optional: true, label: '环境变量' },
  headers: { type: 'string-map', optional: true, label: '请求头' },
  toolCallTimeoutMs: { type: 'number', optional: true, min: 1, label: '工具调用超时' },
  failOnStartupError: { type: 'boolean', optional: true, label: '启动失败即拒绝' },
  maxInstructionBytes: { type: 'number', optional: true, min: 1, label: '指令上限' },
  reconnect: { type: 'reconnect', optional: true, label: '自动重连策略' },
};

/**
 * 校验 MCP 配置补丁，返回规范化后的变更集合。
 * 只放行白名单字段；transport 与对应传输参数必须自洽，否则写进去会让条目加载失败。
 * @param {object} patch 前端提交的补丁
 * @param {object} current 当前已生效配置（用于补齐 transport 判断）
 * @returns {{ok: boolean, patch?: object, reason?: string}} 规范化结果
 */
export function normalizeMcpPatch(patch, current = {}) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, reason: '配置必须是对象' };
  }
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const rule = MCP_EDITABLE[key];
    if (rule === undefined) {
      return { ok: false, reason: '字段 "' + key + '" 不可通过此界面修改' };
    }
    if (rule.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        return { ok: false, reason: rule.label + ' 必须是整数' };
      }
      if (value < rule.min) return { ok: false, reason: rule.label + ' 必须不小于 ' + rule.min };
      next[key] = value;
      continue;
    }
    if (rule.type === 'boolean') {
      if (typeof value !== 'boolean') return { ok: false, reason: rule.label + ' 必须是布尔值' };
      next[key] = value;
      continue;
    }
    if (rule.type === 'enum') {
      if (!rule.values.includes(value)) {
        return { ok: false, reason: rule.label + ' 必须是 ' + rule.values.join(' 或 ') };
      }
      // 传输方式决定 config union 分支；本弹窗仅编辑现有条目，不支持跨传输切换。
      if (key === 'transport' && current.transport !== undefined && value !== current.transport) {
        return { ok: false, reason: '传输方式不可在此弹窗切换，请通过官方插件管理流程重新配置条目' };
      }
      next[key] = value;
      continue;
    }
    if (rule.type === 'string-map') {
      // 映射语义：值为 null 表示**删除该键**，其余必须是字符串。
      // 这样面板可以在不重建整个映射的前提下增删单条键值。
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, reason: rule.label + '必须是键值映射' };
      }
      const map = {};
      const keys = Object.keys(value);
      if (keys.length > 128) return { ok: false, reason: rule.label + '最多 128 项' };
      for (const name of keys) {
        const item = value[name];
        if (item === null) { map[name] = null; continue; }
        if (typeof item !== 'string') return { ok: false, reason: rule.label + '的值必须是字符串' };
        if (item.length > 8192) return { ok: false, reason: rule.label + '的值不能超过 8192 字符' };
        map[name] = item;
      }
      next[key] = map;
      continue;
    }
    if (rule.type === 'string-array') {
      if (!Array.isArray(value) || value.length > 128 || value.some((item) => typeof item !== 'string' || item.length > 4096)) {
        return { ok: false, reason: rule.label + ' 必须是最多 128 项的字符串数组（每项不超过 4096 字符）' };
      }
      next[key] = [...value];
      continue;
    }
    if (rule.type === 'reconnect') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, reason: '自动重连策略必须是对象' };
      }
      const reconnect = {};
      const allowed = new Set(['enabled', 'initialDelayMs', 'maxDelayMs', 'maxAttempts']);
      for (const [field, item] of Object.entries(value)) {
        if (!allowed.has(field)) return { ok: false, reason: '不支持的重连字段：' + field };
        if (field === 'enabled') {
          if (typeof item !== 'boolean') return { ok: false, reason: '重连 enabled 必须是布尔值' };
          reconnect[field] = item;
        } else {
          if (!Number.isInteger(item) || item <= 0 || item > 2147483647) {
            return { ok: false, reason: '重连 ' + field + ' 必须为 1 到 2147483647 的整数' };
          }
          reconnect[field] = item;
        }
      }
      if (Object.keys(reconnect).length === 0) return { ok: false, reason: '重连策略没有可修改字段' };
      const initial = reconnect.initialDelayMs ?? current.reconnect?.initialDelayMs ?? 500;
      const max = reconnect.maxDelayMs ?? current.reconnect?.maxDelayMs ?? 30000;
      if (initial > max) return { ok: false, reason: '重连初始延迟不能大于最大延迟' };
      next[key] = reconnect;
      continue;
    }
    if (typeof value !== 'string') return { ok: false, reason: rule.label + ' 必须是字符串' };
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      if (rule.optional) continue;
      return { ok: false, reason: rule.label + ' 不能为空' };
    }
    if (rule.pattern !== undefined && !rule.pattern.test(trimmed)) {
      return { ok: false, reason: rule.label + ' 格式不合法' };
    }
    next[key] = trimmed;
  }

  // transport 与传输参数必须自洽：换 transport 时旧字段要一并清掉，
  // 否则 stdio 条目会残留 url、http 条目会残留 command，导致加载失败。
  // 互斥检查先于"必须提供"检查：用户填错传输参数时，报错应指向他真正填的那个字段。
  const transport = next.transport ?? current.transport;
  if (transport === 'stdio' && next.url !== undefined) {
    return { ok: false, reason: 'stdio 传输不应设置 url' };
  }
  if (transport === 'streamable-http' && next.command !== undefined) {
    return { ok: false, reason: 'streamable-http 传输不应设置 command' };
  }
  // env 只对 stdio 有意义，headers 只对 http 有意义；写错分支会让配置加载失败。
  if (transport === 'stdio' && next.headers !== undefined) {
    return { ok: false, reason: 'stdio 传输不支持 headers，请改用环境变量 env' };
  }
  if (transport === 'streamable-http' && next.env !== undefined) {
    return { ok: false, reason: 'streamable-http 传输不支持 env，请改用请求头 headers' };
  }
  if (transport === 'stdio' && next.command === undefined && typeof current.command !== 'string') {
    return { ok: false, reason: 'stdio 传输必须提供 command' };
  }
  if (transport === 'streamable-http' && next.url === undefined && typeof current.url !== 'string') {
    return { ok: false, reason: 'streamable-http 传输必须提供 url' };
  }
  if (next.command !== undefined && next.command.startsWith('-')) {
    return { ok: false, reason: '命令不能以 - 开头' };
  }
  if (next.url !== undefined) {
    let parsed;
    try { parsed = new URL(next.url); } catch { return { ok: false, reason: 'URL 格式不合法' }; }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, reason: 'MCP URL 仅支持 http 或 https' };
    }
  }

  if (Object.keys(next).length === 0) return { ok: false, reason: '没有需要修改的内容' };
  return { ok: true, patch: next };
}

/**
 * 计算一次 MCP 配置变更后的完整配置（供预览与写入）。
 * @param {object} current 当前配置
 * @param {object} patch 规范化补丁
 * @returns {object} 合并后的配置
 */
export function applyMcpPatch(current, patch) {
  const merged = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    // 映射字段按键合并：null 删除该键，字符串覆盖该键，其余键原样保留。
    // 若整体替换，面板就无法在不知道既有凭据的前提下修改其中一个变量。
    if (value !== null && typeof value === 'object' && !Array.isArray(value)
      && merged[key] !== null && typeof merged[key] === 'object' && !Array.isArray(merged[key])) {
      const base = { ...merged[key] };
      for (const [name, item] of Object.entries(value)) {
        if (item === null) delete base[name];
        else base[name] = item;
      }
      merged[key] = base;
      continue;
    }
    if (value === null) { delete merged[key]; continue; }
    merged[key] = value;
  }
  return merged;
}
