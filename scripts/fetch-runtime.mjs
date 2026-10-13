#!/usr/bin/env node
// dsh-skill-mcp-list —— 提取测试所需的 DSH 运行时包
//
// mount / http 两个测试文件需要真实的 @deepseek-ai 运行时包（cordis、dsh-tools、
// dsh-skill、dsh-sandbox 等）。这些包随 DSH 安装分发、不在 npm 上单独发布，因此本
// 脚本从本机安装的 app.asar 中按依赖闭包把它们提取到 .runtime/。
//
// 用法：
//   node scripts/fetch-runtime.mjs [--asar <path>] [--out <dir>]
//
// 未安装 DSH 时脚本会给出提示并退出；此时 mount / http 用例自动跳过，其余测试照常运行。
import { closeSync, existsSync, mkdirSync, openSync, readSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '..');

/** 默认的 asar 路径：随 DSH 桌面版安装。 */
const DEFAULT_ASAR = 'D:\\Program Files\\DeepSeek Harness\\resources\\app.asar';

/** 需要提取的入口包；其余依赖按 package.json 的 dependencies 递归补齐。 */
const ENTRIES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-skill',
];

/** asar 内 DSH 包所在的目录前缀。 */
const ROOT = 'dsh/node_modules';

/**
 * 解析命令行参数。
 * @returns {{asar: string, out: string}} 解析结果
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  let asar = DEFAULT_ASAR;
  let out = join(PROJECT, '.runtime', 'node_modules');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--asar' && argv[i + 1] !== undefined) { asar = argv[i + 1]; i += 1; }
    else if (argv[i] === '--out' && argv[i + 1] !== undefined) { out = resolve(argv[i + 1]); i += 1; }
  }
  return { asar, out };
}

/**
 * 读取 asar 归档头，返回 { header, base }。
 * asar 格式：8 字节 pickle 头 + JSON 目录表；数据区紧随其后。
 * @param {number} fd 已打开的文件描述符
 * @returns {{header: object, base: number}} 目录表与数据区起始偏移
 */
function readAsarHeader(fd) {
  const head = Buffer.alloc(16);
  readSync(fd, head, 0, 16, 0);
  const jsonLength = head.readUInt32LE(12);
  const jsonBuffer = Buffer.alloc(jsonLength);
  readSync(fd, jsonBuffer, 0, jsonLength, 16);
  return { header: JSON.parse(jsonBuffer.toString('utf8')), base: 16 + jsonLength };
}

/**
 * 按路径取 asar 目录树中的节点。
 * @param {object} header 目录表根节点
 * @param {string} rel 以 / 分隔的相对路径
 * @returns {object|null} 节点，不存在时为 null
 */
function nodeAt(header, rel) {
  let node = header;
  for (const segment of rel.split('/')) {
    if (!node.files || !node.files[segment]) return null;
    node = node.files[segment];
  }
  return node;
}

/**
 * 读取 asar 中一个普通文件的文本内容。
 * @param {number} fd 文件描述符
 * @param {object} header 目录表
 * @param {number} base 数据区偏移
 * @param {string} rel 相对路径
 * @returns {string|null} 文本内容，不存在时为 null
 */
function readText(fd, header, base, rel) {
  const node = nodeAt(header, rel);
  if (!node || node.files) return null;
  const buffer = Buffer.alloc(node.size);
  readSync(fd, buffer, 0, node.size, base + Number(node.offset));
  return buffer.toString('utf8');
}

/**
 * 递归把一个 asar 子树写盘。
 * @param {number} fd 文件描述符
 * @param {object} node 子树根节点
 * @param {number} base 数据区偏移
 * @param {string} dest 目标目录
 */
function extractNode(fd, node, base, dest) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const target = join(dest, name);
    if (entry.files) {
      mkdirSync(target, { recursive: true });
      extractNode(fd, entry, base, target);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      const buffer = Buffer.alloc(entry.size);
      readSync(fd, buffer, 0, entry.size, base + Number(entry.offset));
      writeFileSync(target, buffer);
    }
  }
}

const { asar, out } = parseArgs();

if (!existsSync(asar)) {
  console.error('[fetch-runtime] 未找到 DSH 安装：' + asar);
  console.error('[fetch-runtime] 请用 --asar <path> 指定 app.asar，或安装 DSH 桌面版。');
  console.error('[fetch-runtime] 跳过提取：mount / http 用例将自动跳过。');
  process.exit(0);
}

const fd = openSync(asar, 'r');
let header; let base;
try {
  ({ header, base } = readAsarHeader(fd));

  const seen = new Set();
  const queue = [...ENTRIES];
  let extracted = 0;

  while (queue.length > 0) {
    const pkg = queue.shift();
    if (seen.has(pkg)) continue;
    seen.add(pkg);

    const node = nodeAt(header, ROOT + '/' + pkg);
    if (!node) {
      console.error('[fetch-runtime] 缺少包：' + pkg);
      continue;
    }
    const dest = join(out, pkg);
    if (!existsSync(dest)) {
      extractNode(fd, node, base, dest);
      extracted += 1;
    }

    const manifestText = readText(fd, header, base, ROOT + '/' + pkg + '/package.json');
    if (manifestText === null) continue;
    let manifest;
    try { manifest = JSON.parse(manifestText); } catch { continue; }
    for (const dep of Object.keys(manifest.dependencies || {})) {
      if (dep.startsWith('@deepseek-ai/')) queue.push(dep);
    }
  }

  console.log('[fetch-runtime] 提取 ' + extracted + ' 个包，共处理 ' + seen.size + ' 个，输出到 ' + out);

  // 让项目根能解析这些包（插件源码 import @deepseek-ai/* 时使用）。
  const linkPath = join(PROJECT, 'node_modules');
  if (!existsSync(linkPath)) {
    try {
      symlinkSync(out, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      console.log('[fetch-runtime] 已创建 node_modules 链接 -> ' + out);
    } catch (error) {
      console.error('[fetch-runtime] 创建链接失败（不影响测试）：' + String(error.message || error));
    }
  }
} finally {
  closeSync(fd);
}
