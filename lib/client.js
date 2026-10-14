// dsh-skill-mcp-list —— Web 客户端插件
//
// 侧边栏注册一个「Skill 与 MCP」入口（与原生「插件」「定时任务」同级），
// 点击后在主区域渲染管理页面：列表、搜索、启停开关、详情面板。
//
// 数据通道：宿主侧 /api/skill-mcp-list（GET 快照 / POST 变更）。
// 说明：本文件是预构建的浏览器 bundle，按 DSH 模块系统约定用
// window.__ModuleLoader__.load({ id, factory }) 注册工厂；为避免构建链，
// 这里直接手写 React.createElement，不依赖 JSX 运行时。
window.__ModuleLoader__.load({
	id: "dsh-skill-mcp-list",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const h = react.createElement;

		const inject = ["slots"];

		const PANEL_ID = "skill-mcp-list";
		const API = "/api/skill-mcp-list";

		// ---------------------------------------------------------------
		// 样式：复用 DSH 设计令牌（--dsw-alias-*），自动跟随明暗主题
		// ---------------------------------------------------------------

		const CSS = [
			".sml-page{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);}",
			".sml-head{display:flex;align-items:flex-start;gap:16px;padding:20px 24px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap;}",
			".sml-title{font-size:18px;font-weight:600;margin:0 0 4px;}",
			".sml-sub{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary);}",
			".sml-headActions{margin-left:auto;display:flex;gap:8px;align-items:center;}",
			".sml-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;font-family:inherit;white-space:nowrap;}",
			".sml-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}",
			".sml-btn:disabled{opacity:.5;cursor:default;}",
			".sml-btn--primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);}",
			".sml-btn--primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);}",
			".sml-btn--sm{height:26px;padding:0 9px;font-size:12px;}",
			".sml-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:1px;}",
			".sml-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;padding:16px 24px 4px;}",
			".sml-stat{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);padding:12px 14px;background:var(--dsw-alias-bg-layer-1);}",
			".sml-cardK{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-bottom:6px;}",
			".sml-cardV{font-size:22px;font-weight:600;line-height:1.1;}",
			".sml-cardX{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:4px;}",
			".sml-tabs{display:flex;gap:4px;padding:12px 24px 0;border-bottom:1px solid var(--dsw-alias-border-l2);}",
			".sml-tab{height:34px;padding:0 12px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit;}",
			".sml-tab:hover{color:var(--dsw-alias-label-primary);}",
			".sml-tab.is-on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);}",
			".sml-tools{display:flex;gap:8px;align-items:center;padding:12px 24px 8px;flex-wrap:wrap;}",
			".sml-input{flex:1;max-width:320px;min-width:180px;height:30px;padding:0 10px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;}",
			".sml-input:focus{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:1px;}",
			".sml-body{flex:1;min-height:0;overflow:auto;padding:4px 24px 24px;}",
			// 卡片栅格：auto-fill 在宽屏铺三列以上，窄屏自然收窄到单列。
			".sml-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;align-items:stretch;}",
			".sml-item{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);min-width:0;}",
			".sml-item.is-off{opacity:.66;}",
			".sml-item:hover{border-color:var(--dsw-alias-border-l3);}",
			// 一级：名称 + 状态
			".sml-itemTop{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
			".sml-itemName{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}",
			// 二级：来源标签
			".sml-tags{display:flex;gap:6px;flex-wrap:wrap;}",
			".sml-tag{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:var(--dsw-radius-xs);font-size:11px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);white-space:nowrap;}",
			".sml-tag--ok{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary);}",
			".sml-tag--off{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);}",
			".sml-tag--err{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground);}",
			// 三级：描述
			".sml-itemDesc{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}",
			// 四级：路径 + 操作
			".sml-itemFoot{margin-top:auto;display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap;}",
			".sml-itemPath{flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-markdown-code-font-family);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
			".sml-sw{position:relative;width:36px;height:20px;flex:none;border-radius:10px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-3);cursor:pointer;padding:0;transition:background var(--ds-transition-duration,140ms) var(--ds-ease-in-out,ease);}",
			".sml-sw:disabled{opacity:.45;cursor:default;}",
			".sml-sw.is-on{background:var(--dsw-alias-brand-primary);border-color:transparent;}",
			".sml-sw::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-switch-thumb,#fff);transition:transform var(--ds-transition-duration,140ms) var(--ds-ease-in-out,ease);}",
			".sml-sw.is-on::after{transform:translateX(16px);}",
			".sml-sw:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:2px;}",
			".sml-empty{padding:40px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;grid-column:1/-1;}",
			// 反馈条
			".sml-err{margin:0 24px 12px;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground);font-size:12px;word-break:break-word;}",
			".sml-ok{margin:0 24px 12px;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary-foreground);font-size:12px;word-break:break-word;}",
			// 弹窗
			".sml-mask{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1);display:flex;align-items:center;justify-content:center;z-index:60;padding:24px;overflow:auto;}",
			".sml-modal{width:min(620px,100%);max-height:min(86vh,900px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-panel);box-shadow:var(--dsw-elevation-panel);overflow:hidden;}",
			".sml-modalHead{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-border-l2);}",
			".sml-modalTitle{font-size:15px;font-weight:600;margin:0;}",
			".sml-modalSub{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:2px 0 0;}",
			".sml-modalBody{overflow:auto;padding:16px 20px;}",
			".sml-modalFoot{display:flex;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--dsw-alias-border-l2);}",
			".sml-seg{display:inline-flex;padding:3px;gap:3px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);margin-bottom:16px;}",
			".sml-segBtn{height:26px;padding:0 12px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;font-family:inherit;}",
			".sml-segBtn.is-on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-soft);}",
			".sml-field{margin-bottom:14px;}",
			".sml-label{display:block;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:6px;}",
			".sml-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:4px;line-height:1.5;}",
			".sml-ta{width:100%;min-height:96px;padding:8px 10px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:var(--dsw-font-markdown-code-font-family);resize:vertical;box-sizing:border-box;}",
			".sml-ta:focus{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:1px;}",
			".sml-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}",
			".sml-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;}",
			".sml-kv{display:grid;grid-template-columns:130px 1fr;gap:8px 12px;font-size:13px;margin-bottom:16px;}",
			".sml-k{color:var(--dsw-alias-label-tertiary);}",
			".sml-v{color:var(--dsw-alias-label-primary);word-break:break-word;font-family:var(--dsw-font-markdown-code-font-family);font-size:12px;}",
			".sml-sect{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:16px 0 8px;text-transform:uppercase;letter-spacing:.04em;}",
			".sml-pre{margin:0;padding:12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-markdown-code-block);font-family:var(--dsw-font-markdown-code-font-family);font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:340px;overflow:auto;color:var(--dsw-alias-label-primary);}",
			".sml-list{margin:0;padding-left:18px;font-size:12px;font-family:var(--dsw-font-markdown-code-font-family);color:var(--dsw-alias-label-secondary);}",
			".sml-spin{display:inline-block;animation:smlSpin 1s linear infinite;}",
			// 响应式：窄屏收窄弹窗栅格与统计卡。
			"@media (max-width:680px){",
			"  .sml-grid{grid-template-columns:1fr;}",
			"  .sml-head{padding:16px;}",
			"  .sml-cards{padding:12px 16px 4px;grid-template-columns:repeat(2,1fr);}",
			"  .sml-tabs,.sml-tools,.sml-body{padding-left:16px;padding-right:16px;}",
			"  .sml-err,.sml-ok{margin-left:16px;margin-right:16px;}",
			"  .sml-row2{grid-template-columns:1fr;}",
			"  .sml-kv{grid-template-columns:1fr;gap:2px 0;}",
			"  .sml-kv .sml-k{margin-top:8px;}",
			"}",
			"@keyframes smlSpin{to{transform:rotate(360deg);}}",
		].join("\n");

		// ---------------------------------------------------------------
		// 图标
		// ---------------------------------------------------------------
		function IconBlocks(props) {
			const s = props && props.size ? props.size : 16;
			return h(
				"svg",
				{ width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
				h("rect", { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }),
				h("rect", { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }),
				h("rect", { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }),
				h("rect", { x: 14, y: 14, width: 7, height: 7, rx: 1.5 }),
			);
		}

		function IconClose(props) {
			const s = props && props.size ? props.size : 16;
			return h(
				"svg",
				{ width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", "aria-hidden": "true" },
				h("path", { d: "M6 6l12 12M18 6L6 18" }),
			);
		}

		function IconRefresh(props) {
			const s = props && props.size ? props.size : 15;
			return h(
				"svg",
				{ width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
				h("path", { d: "M20 11a8 8 0 1 0-2.3 5.7" }),
				h("path", { d: "M20 5v6h-6" }),
			);
		}

		function IconPlus(props) {
			const s = props && props.size ? props.size : 15;
			return h(
				"svg",
				{ width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", "aria-hidden": "true" },
				h("path", { d: "M12 5v14M5 12h14" }),
			);
		}

		// ---------------------------------------------------------------
		// 数据访问
		// ---------------------------------------------------------------
		function readError(payload, fallback) {
			if (payload && typeof payload.error === "string" && payload.error.length > 0) return payload.error;
			return fallback;
		}

		async function fetchSnapshot() {
			const res = await fetch(API, { credentials: "same-origin", headers: { Accept: "application/json" } });
			const payload = await res.json().catch(() => null);
			if (!res.ok) throw new Error(readError(payload, "读取失败（HTTP " + res.status + "）"));
			return payload;
		}

		async function post(body) {
			const res = await fetch(API, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify(body),
			});
			const payload = await res.json().catch(() => null);
			if (!res.ok) throw new Error(readError(payload, "操作失败（HTTP " + res.status + "）"));
			return payload;
		}

		// ---------------------------------------------------------------
		// 展示辅助
		// ---------------------------------------------------------------
		function phaseTag(phase) {
			if (phase === "active") return h("span", { className: "sml-tag sml-tag--ok" }, "运行中");
			if (phase === "failed") return h("span", { className: "sml-tag sml-tag--err" }, "加载失败");
			if (phase === null || phase === undefined) return h("span", { className: "sml-tag" }, "未加载");
			return h("span", { className: "sml-tag" }, String(phase));
		}

		function bytes(n) {
			const v = Number(n) || 0;
			if (v >= 1048576) return (v / 1048576).toFixed(1) + " MB";
			if (v >= 1024) return (v / 1024).toFixed(1) + " KB";
			return v + " B";
		}

		function shortPath(p) {
			if (typeof p !== "string" || p.length === 0) return "—";
			return p.length > 70 ? "…" + p.slice(p.length - 69) : p;
		}

		/** skill 名的前端预校验：与宿主 validateSkillName 同一规则。 */
		const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
		function checkSkillForm(form) {
			const errors = [];
			if (!form.name || !SKILL_NAME_RE.test(form.name.trim())) {
				errors.push("名称必须为 kebab-case（小写字母、数字与连字符，且不能以连字符开头或结尾）");
			}
			if (!form.description || form.description.trim().length === 0) errors.push("描述不能为空");
			if (form.description && form.description.length > 500) errors.push("描述不能超过 500 个字符");
			if (form.whenToUse && form.whenToUse.length > 500) errors.push("whenToUse 不能超过 500 个字符");
			return errors;
		}

		// ---------------------------------------------------------------
		// 开关
		// ---------------------------------------------------------------
		function Switch(props) {
			const on = props.on === true;
			const label = props.label || (on ? "禁用" : "启用");
			return h("button", {
				type: "button",
				className: "sml-sw" + (on ? " is-on" : ""),
				role: "switch",
				"aria-checked": on,
				"aria-label": label,
				title: label,
				disabled: props.disabled === true,
				onClick: props.onToggle,
			});
		}


		// ---------------------------------------------------------------
		// 安装 Skill 表单
		// ---------------------------------------------------------------
		/**
		 * 安装 Skill 表单。
		 * @returns {object} React 元素
		 */
		function InstallSkillForm() {
			const [form, setForm] = react.useState({ name: "", description: "", whenToUse: "", body: "" });
			const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
			const errors = checkSkillForm(form);

			return h("div", null,
				h("div", { className: "sml-field" },
					h("label", { className: "sml-label", htmlFor: "sml-skill-name" }, "名称"),
					h("input", { id: "sml-skill-name", className: "sml-input", style: { maxWidth: "none" }, value: form.name, onChange: set("name"), placeholder: "my-new-skill", autoComplete: "off" }),
					h("div", { className: "sml-hint" }, "kebab-case：小写字母、数字与连字符，最长 64 字符。"),
				),
				h("div", { className: "sml-field" },
					h("label", { className: "sml-label", htmlFor: "sml-skill-desc" }, "描述"),
					h("input", { id: "sml-skill-desc", className: "sml-input", style: { maxWidth: "none" }, value: form.description, onChange: set("description"), placeholder: "这个 skill 做什么", autoComplete: "off" }),
					h("div", { className: "sml-hint" }, "模型据此判断何时使用该 skill，请写清楚触发条件。"),
				),
				h("div", { className: "sml-field" },
					h("label", { className: "sml-label", htmlFor: "sml-skill-when" }, "whenToUse（可选）"),
					h("input", { id: "sml-skill-when", className: "sml-input", style: { maxWidth: "none" }, value: form.whenToUse, onChange: set("whenToUse"), placeholder: "当用户要求……时使用", autoComplete: "off" }),
				),
				h("div", { className: "sml-field" },
					h("label", { className: "sml-label", htmlFor: "sml-skill-body" }, "指令正文（可选）"),
					h("textarea", { id: "sml-skill-body", className: "sml-ta", value: form.body, onChange: set("body"), placeholder: "# 我的 skill\n\n在这里写具体步骤……" }),
					h("div", { className: "sml-hint" }, "将原样写入 SKILL.md 正文；留空则只创建 frontmatter。"),
				),
				errors.length > 0
					? h("div", { className: "sml-err", style: { margin: "0 0 12px" } }, errors[0])
					: null,
			);
		}

		// ---------------------------------------------------------------
		// MCP 配置表单
		// ---------------------------------------------------------------
		/**
		 * MCP 配置表单：只编辑已安装条目的既有字段。
		 * @param {object} props 组件属性
		 * @returns {object} React 元素
		 */
		function ConfigureMcpForm(props) {
			const server = props.server;
			const cfg = server.connection || {};
			const [form, setForm] = react.useState({
				serverName: server.serverName || "",
				command: cfg.command || "",
				args: (cfg.args || []).join(" "),
				cwd: cfg.cwd || "",
				url: cfg.url || "",
				toolCallTimeoutMs: String(server.toolCallTimeoutMs ?? ""),
				maxInstructionBytes: String(server.maxInstructionBytes ?? ""),
			});
			const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
			const isStdio = server.transport === "stdio";

			return h("div", null,
				h("div", { className: "sml-field" },
					h("label", { className: "sml-label" }, "Loader 条目"),
					h("div", { className: "sml-v" }, server.entryId),
					h("div", { className: "sml-hint" }, "传输方式：" + server.transport + "。传输方式需重新配置条目，不能在此切换。"),
				),
				h("div", { className: "sml-field" },
					h("label", { className: "sml-label", htmlFor: "sml-mcp-name" }, "服务器名（serverName）"),
					h("input", { id: "sml-mcp-name", className: "sml-input", style: { maxWidth: "none" }, value: form.serverName, onChange: set("serverName"), autoComplete: "off" }),
					h("div", { className: "sml-hint" }, "决定工具命名空间：mcp__<serverName>__<tool>。"),
				),
				isStdio
					? h("div", null,
						h("div", { className: "sml-row2" },
							h("div", { className: "sml-field" },
								h("label", { className: "sml-label", htmlFor: "sml-mcp-cmd" }, "命令"),
								h("input", { id: "sml-mcp-cmd", className: "sml-input", style: { maxWidth: "none" }, value: form.command, onChange: set("command"), autoComplete: "off" }),
							),
							h("div", { className: "sml-field" },
								h("label", { className: "sml-label", htmlFor: "sml-mcp-cwd" }, "工作目录"),
								h("input", { id: "sml-mcp-cwd", className: "sml-input", style: { maxWidth: "none" }, value: form.cwd, onChange: set("cwd"), autoComplete: "off" }),
							),
						),
						h("div", { className: "sml-field" },
							h("label", { className: "sml-label", htmlFor: "sml-mcp-args" }, "参数（空格分隔）"),
							h("input", { id: "sml-mcp-args", className: "sml-input", style: { maxWidth: "none" }, value: form.args, onChange: set("args"), autoComplete: "off" }),
							h("div", { className: "sml-hint" }, "环境变量中的凭据不会在此显示；保存后仍以原值生效。"),
						),
					)
					: h("div", { className: "sml-field" },
						h("label", { className: "sml-label", htmlFor: "sml-mcp-url" }, "URL"),
						h("input", { id: "sml-mcp-url", className: "sml-input", style: { maxWidth: "none" }, value: form.url, onChange: set("url"), autoComplete: "off" }),
						h("div", { className: "sml-hint" }, "仅支持 http 或 https。请求头中的凭据不会在此显示。"),
					),
				h("div", { className: "sml-row2" },
					h("div", { className: "sml-field" },
						h("label", { className: "sml-label", htmlFor: "sml-mcp-timeout" }, "工具调用超时（ms）"),
						h("input", { id: "sml-mcp-timeout", className: "sml-input", style: { maxWidth: "none" }, value: form.toolCallTimeoutMs, onChange: set("toolCallTimeoutMs"), inputMode: "numeric", autoComplete: "off" }),
					),
					h("div", { className: "sml-field" },
						h("label", { className: "sml-label", htmlFor: "sml-mcp-instr" }, "指令上限（字节）"),
						h("input", { id: "sml-mcp-instr", className: "sml-input", style: { maxWidth: "none" }, value: form.maxInstructionBytes, onChange: set("maxInstructionBytes"), inputMode: "numeric", autoComplete: "off" }),
					),
				),
				h("div", { className: "sml-field" },
					h("label", { className: "sml-check" },
						h("input", { id: "sml-mcp-fail", type: "checkbox", checked: server.failOnStartupError === true, onChange: () => {} }),
						"启动失败即拒绝激活",
					),
				),
				h("div", { className: "sml-field" },
					h("label", { className: "sml-check" },
						h("input", { id: "sml-mcp-reconnect", type: "checkbox", checked: server.reconnect ? server.reconnect.enabled !== false : true, onChange: () => {} }),
						"连接断开后自动重连",
					),
				),
			);
		}

		// ---------------------------------------------------------------
		// 添加 / 配置弹窗
		// ---------------------------------------------------------------
		/**
		 * 添加 / 配置弹窗：按 mode 渲染表单，提交时调用宿主 API 并给出反馈。
		 * @param {object} props 组件属性
		 * @returns {object} React 元素
		 */
		function AddModal(props) {
			const mode = props.mode;
			const server = props.server;
			const [submitting, setSubmitting] = react.useState(false);
			const [error, setError] = react.useState(null);

			react.useEffect(() => {
				const onKey = (e) => { if (e.key === "Escape" && !submitting) props.onClose(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [props.onClose, submitting]);

			// 从表单 DOM 读回当前值（表单各自持有 state，这里统一收集）。
			const collect = () => {
				const get = (id) => { const el = document.getElementById(id); return el ? el.value : ""; };
				if (mode === "install") {
					return {
						name: get("sml-skill-name").trim(),
						description: get("sml-skill-desc").trim(),
						whenToUse: get("sml-skill-when").trim(),
						body: get("sml-skill-body"),
					};
				}
				const num = (v) => { const n = Number(String(v).trim()); return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined; };
				const patch = { serverName: get("sml-mcp-name").trim() };
				if (server.transport === "stdio") {
					patch.command = get("sml-mcp-cmd").trim();
					patch.args = get("sml-mcp-args").split(/\s+/).filter((s) => s.length > 0);
					const cwd = get("sml-mcp-cwd").trim();
					if (cwd.length > 0) patch.cwd = cwd;
				} else {
					patch.url = get("sml-mcp-url").trim();
				}
				const timeout = num(get("sml-mcp-timeout"));
				if (timeout !== undefined) patch.toolCallTimeoutMs = timeout;
				const instr = num(get("sml-mcp-instr"));
				if (instr !== undefined) patch.maxInstructionBytes = instr;
				const fail = document.getElementById("sml-mcp-fail");
				if (fail) patch.failOnStartupError = fail.checked;
				const rc = document.getElementById("sml-mcp-reconnect");
				if (rc) patch.reconnect = { enabled: rc.checked };
				return patch;
			};

			const submit = async () => {
				setError(null);
				const body = collect();
				if (mode === "install") {
					const problems = checkSkillForm(body);
					if (problems.length > 0) { setError(problems[0]); return; }
				}
				setSubmitting(true);
				try {
					if (mode === "install") await post({ action: "install_skill", spec: body });
					else await post({ action: "configure_mcp", target: server.entryId, config: body });
					props.onDone(mode === "install" ? "已安装 " + body.name : "已保存 " + server.serverName + " 的配置");
				} catch (e) {
					setError(e && e.message ? e.message : String(e));
				} finally {
					setSubmitting(false);
				}
			};

			const title = mode === "install" ? "安装 Skill" : "配置 MCP";
			const sub = mode === "install"
				? "在用户 skill 根创建新的 SKILL.md"
				: "编辑已安装 MCP 条目的配置";

			return h("div", {
				className: "sml-mask",
				onClick: (e) => { if (e.target === e.currentTarget && !submitting) props.onClose(); },
			}, h("div", { className: "sml-modal", role: "dialog", "aria-modal": "true", "aria-label": title },
				h("div", { className: "sml-modalHead" },
					h("div", null,
						h("h2", { className: "sml-modalTitle" }, title),
						h("p", { className: "sml-modalSub" }, sub),
					),
					h("div", { style: { marginLeft: "auto" } }),
					h("button", { type: "button", className: "sml-btn", onClick: props.onClose, disabled: submitting, "aria-label": "关闭" }, h(IconClose, { size: 14 })),
				),
				h("div", { className: "sml-modalBody" },
					h("div", { className: "sml-seg" },
						h("button", {
							type: "button",
							className: "sml-segBtn" + (mode === "install" ? " is-on" : ""),
							onClick: () => props.onModeChange("install"),
							disabled: submitting,
						}, "安装 Skill"),
						h("button", {
							type: "button",
							className: "sml-segBtn" + (mode === "configure" ? " is-on" : ""),
							onClick: () => props.onModeChange("configure"),
							disabled: submitting,
						}, "配置 MCP"),
					),
					mode === "configure"
						? (server
							? h(ConfigureMcpForm, { server: server })
							: h("div", { className: "sml-empty" }, "当前没有已安装的 MCP 条目可配置。"))
						: h(InstallSkillForm, null),
					error ? h("div", { className: "sml-err", style: { margin: "12px 0 0" } }, error) : null,
				),
				h("div", { className: "sml-modalFoot" },
					h("button", { type: "button", className: "sml-btn", onClick: props.onClose, disabled: submitting }, "取消"),
					h("button", {
						type: "button",
						className: "sml-btn sml-btn--primary",
						onClick: submit,
						disabled: submitting || (mode === "configure" && !server),
					}, submitting ? h("span", { className: "sml-spin" }, h(IconRefresh, { size: 14 })) : null, submitting ? "提交中…" : "确定"),
				),
			));
		}


		// ---------------------------------------------------------------
		// 详情弹窗（只读）
		// ---------------------------------------------------------------
		/**
		 * 详情弹窗：展示 Skill 或 MCP 的完整字段。
		 * @param {object} props 组件属性
		 * @returns {object} React 元素
		 */
		function DetailModal(props) {
			const item = props.item;
			react.useEffect(() => {
				const onKey = (e) => { if (e.key === "Escape") props.onClose(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [props.onClose]);

			const rows = [];
			const push = (k, v) => {
				rows.push(h("div", { className: "sml-k", key: "k" + rows.length }, k));
				rows.push(h("div", { className: "sml-v", key: "v" + rows.length }, v === null || v === undefined || v === "" ? "—" : String(v)));
			};

			if (item.kind === "skill") {
				push("名称", item.name);
				push("提供方", item.provider);
				push("来源", item.source);
				push("指令文件", item.path);
				push("资源目录", item.resourceBase && item.resourceBase.kind === "directory" ? item.resourceBase.path : null);
				push("模型可调用", item.modelInvocable ? "是" : "否");
				push("用户可调用", item.userInvocable ? "是" : "否");
				if (item.contentBytes) push("正文大小", bytes(item.contentBytes));
				if (item.toggleReason) push("不可切换原因", item.toggleReason);
			} else {
				push("服务器名", item.serverName);
				push("Loader 条目", item.entryId);
				push("模块", item.moduleName);
				push("传输方式", item.transport);
				push("配置目标", item.patchId || (item.readOnlyReason ? "只读（" + item.readOnlyReason + "）" : "—"));
				push("工具调用超时", item.toolCallTimeoutMs ? item.toolCallTimeoutMs + " ms" : null);
				push("启动失败即拒绝", item.failOnStartupError ? "是" : "否");
				push("指令上限", item.maxInstructionBytes ? bytes(item.maxInstructionBytes) : null);
				if (item.connection && item.connection.kind === "stdio") {
					push("命令", item.connection.command);
					push("参数", (item.connection.args || []).join(" ") || "—");
					push("工作目录", item.connection.cwd);
				} else if (item.connection) {
					push("URL", item.connection.url);
				}
			}

			const children = [
				h("div", { className: "sml-modalHead", key: "head" },
					h("div", null,
						h("h2", { className: "sml-modalTitle" }, item.kind === "skill" ? item.name : item.serverName),
						h("p", { className: "sml-modalSub" }, item.kind === "skill" ? "Skill 详情" : "MCP 服务器详情"),
					),
					h("div", { style: { marginLeft: "auto" } }),
					h("button", { type: "button", className: "sml-btn", onClick: props.onClose, "aria-label": "关闭" }, h(IconClose, { size: 14 })),
				),
				h("div", { className: "sml-modalBody", key: "body" },
					h("div", { className: "sml-kv" }, rows),
					item.kind === "mcp" && item.connection && item.connection.env && item.connection.env.length > 0
						? h("div", null, h("div", { className: "sml-sect" }, "环境变量（值已脱敏）"), h("ul", { className: "sml-list" }, item.connection.env.map((e, i) => h("li", { key: i }, e.name + " = " + e.value))))
						: null,
					item.kind === "mcp" && item.connection && item.connection.headers && item.connection.headers.length > 0
						? h("div", null, h("div", { className: "sml-sect" }, "请求头（值已脱敏）"), h("ul", { className: "sml-list" }, item.connection.headers.map((e, i) => h("li", { key: i }, e.name + ": " + e.value))))
						: null,
					item.kind === "mcp" && item.toolNames && item.toolNames.length > 0
						? h("div", null, h("div", { className: "sml-sect" }, "已注册工具（" + item.toolNames.length + "）"), h("ul", { className: "sml-list" }, item.toolNames.map((n, i) => h("li", { key: i }, n))))
						: null,
					item.kind === "skill" && item.content
						? h("div", null, h("div", { className: "sml-sect" }, "指令正文"), h("pre", { className: "sml-pre" }, item.content))
						: null,
				),
			];

			return h("div", {
				className: "sml-mask",
				onClick: (e) => { if (e.target === e.currentTarget) props.onClose(); },
			}, h("div", { className: "sml-modal", role: "dialog", "aria-modal": "true", "aria-label": "详情" }, children));
		}

		// ---------------------------------------------------------------
		// 主页面：统计卡、标签页、搜索、卡片栅格、弹窗
		// ---------------------------------------------------------------
		/**
		 * Skill / MCP 管理页。
		 * @returns {object} React 元素
		 */
		function Page() {
			const [state, setState] = react.useState({ loading: true, error: null, data: null });
			const [tab, setTab] = react.useState("skills");
			const [query, setQuery] = react.useState("");
			const [detail, setDetail] = react.useState(null);
			const [modal, setModal] = react.useState(null);
			const [busy, setBusy] = react.useState("");
			const [notice, setNotice] = react.useState(null);

			const load = react.useCallback(async () => {
				setState((s) => ({ loading: true, error: null, data: s.data }));
				try {
					const data = await fetchSnapshot();
					setState({ loading: false, error: null, data: data });
				} catch (e) {
					setState({ loading: false, error: e && e.message ? e.message : String(e), data: null });
				}
			}, []);

			react.useEffect(() => { load(); }, [load]);

			const data = state.data;
			const skills = (data && data.skills) || [];
			const servers = (data && data.mcpServers) || [];
			const summary = (data && data.summary) || null;
			const caps = (data && data.capabilities) || {};

			const run = react.useCallback(async (key, body, done) => {
				setBusy(key);
				setNotice(null);
				try {
					await post(body);
					await load();
					setNotice({ kind: "ok", text: done });
				} catch (e) {
					setNotice({ kind: "err", text: e && e.message ? e.message : String(e) });
				} finally {
					setBusy("");
				}
			}, [load]);

			const q = query.trim().toLowerCase();
			const match = (text) => q.length === 0 || String(text || "").toLowerCase().indexOf(q) >= 0;
			const shownSkills = skills.filter((s) => match(s.name) || match(s.description) || match(s.provider) || match(s.source));
			const shownServers = servers.filter((s) => match(s.serverName) || match(s.transport) || match(s.entryId));

			// 打开详情：skill 走宿主 detail 拿正文；MCP 直接用手上的快照数据。
			const openSkillDetail = async (name) => {
				setBusy("detail:" + name);
				try {
					const res = await fetch(API, {
						method: "POST",
						credentials: "same-origin",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ action: "detail", target: name }),
					});
					const payload = await res.json().catch(() => null);
					if (!res.ok) throw new Error(readError(payload, "读取详情失败"));
					setDetail(Object.assign({ kind: "skill" }, payload));
				} catch (e) {
					setNotice({ kind: "err", text: e && e.message ? e.message : String(e) });
				} finally {
					setBusy("");
				}
			};

			const head = h("div", { className: "sml-head" },
				h("div", null,
					h("h1", { className: "sml-title" }, "Skill 与 MCP"),
					h("p", { className: "sml-sub" }, "查看当前 DSH 已安装的 Skill 与 MCP 服务器，并启用、禁用、安装或配置它们"),
				),
				h("div", { className: "sml-headActions" },
					h("button", { type: "button", className: "sml-btn", onClick: load, disabled: state.loading },
						h("span", { className: state.loading ? "sml-spin" : "" }, h(IconRefresh, { size: 14 })), "刷新",
					),
					h("button", {
						type: "button",
						className: "sml-btn sml-btn--primary",
						onClick: () => setModal({ mode: "install", server: null }),
						disabled: caps.skillInstall === false && caps.mcpConfigure === false,
					}, h(IconPlus, { size: 14 }), "添加"),
				),
			);

			if (state.loading && data === null) {
				return h("div", { className: "sml-page" }, head, h("div", { className: "sml-body" }, h("div", { className: "sml-empty" }, "正在加载…")));
			}
			if (state.error !== null && data === null) {
				return h("div", { className: "sml-page" }, head, h("div", { className: "sml-err" }, state.error));
			}

			const stats = h("div", { className: "sml-cards" },
				h("div", { className: "sml-stat" }, h("div", { className: "sml-cardK" }, "Skill 总数"), h("div", { className: "sml-cardV" }, summary ? summary.skills.total : 0), h("div", { className: "sml-cardX" }, summary ? "启用 " + summary.skills.enabled + " · 禁用 " + summary.skills.disabled : "")),
				h("div", { className: "sml-stat" }, h("div", { className: "sml-cardK" }, "MCP 服务器"), h("div", { className: "sml-cardV" }, summary ? summary.mcp.total : 0), h("div", { className: "sml-cardX" }, summary ? "启用 " + summary.mcp.enabled + " · 禁用 " + summary.mcp.disabled : "")),
				h("div", { className: "sml-stat" }, h("div", { className: "sml-cardK" }, "MCP 工具"), h("div", { className: "sml-cardV" }, summary ? summary.mcp.tools : 0), h("div", { className: "sml-cardX" }, "已注册到工具表")),
				h("div", { className: "sml-stat" }, h("div", { className: "sml-cardK" }, "工作目录"), h("div", { className: "sml-cardV", style: { fontSize: "12px", fontWeight: 400, fontFamily: "var(--dsw-font-markdown-code-font-family)", wordBreak: "break-all" } }, data ? shortPath(data.cwd) : "—"), h("div", { className: "sml-cardX" }, "项目级 Skill 的发现根")),
			);

			const tabs = h("div", { className: "sml-tabs", role: "tablist" },
				h("button", { type: "button", role: "tab", "aria-selected": tab === "skills", className: "sml-tab" + (tab === "skills" ? " is-on" : ""), onClick: () => setTab("skills") }, "Skill（" + skills.length + "）"),
				h("button", { type: "button", role: "tab", "aria-selected": tab === "mcp", className: "sml-tab" + (tab === "mcp" ? " is-on" : ""), onClick: () => setTab("mcp") }, "MCP（" + servers.length + "）"),
			);

			const tools = h("div", { className: "sml-tools" },
				h("input", { className: "sml-input", type: "search", placeholder: "搜索名称 / 描述 / 来源…", value: query, onChange: (e) => setQuery(e.target.value), "aria-label": "搜索" }),
			);

			let body;
			if (tab === "skills") {
				body = h("div", { className: "sml-grid" },
					shownSkills.length === 0
						? h("div", { className: "sml-empty" }, skills.length === 0 ? "当前没有发现任何 Skill。" : "没有匹配的 Skill。")
						: shownSkills.map((s) => h("div", { className: "sml-item" + (s.enabled ? "" : " is-off"), key: s.name },
							// 一级：名称 + 状态
							h("div", { className: "sml-itemTop" },
								h("span", { className: "sml-itemName", title: s.name }, s.name),
								s.enabled ? h("span", { className: "sml-tag sml-tag--ok" }, "已启用") : h("span", { className: "sml-tag sml-tag--off" }, "已禁用"),
							),
							// 二级：来源标签
							h("div", { className: "sml-tags" },
								h("span", { className: "sml-tag" }, s.provider || "unknown"),
								h("span", { className: "sml-tag" }, s.source || "unknown"),
								s.toggleable ? null : h("span", { className: "sml-tag", title: s.toggleReason || "" }, "只读"),
							),
							// 三级：描述
							h("div", { className: "sml-itemDesc", title: s.description }, s.description || "（无描述）"),
							// 四级：路径 + 操作
							h("div", { className: "sml-itemFoot" },
								h("span", { className: "sml-itemPath", title: s.path || "" }, shortPath(s.path)),
								h("button", { type: "button", className: "sml-btn sml-btn--sm", onClick: () => openSkillDetail(s.name), disabled: busy === "detail:" + s.name }, "详情"),
								h(Switch, {
									on: s.enabled,
									disabled: !s.toggleable || busy === "skill:" + s.name,
									label: (s.enabled ? "禁用 " : "启用 ") + s.name,
									onToggle: () => run("skill:" + s.name, { action: "set_skill", target: s.name, enabled: !s.enabled, field: "model" }, (s.enabled ? "已禁用 " : "已启用 ") + s.name),
								}),
							),
						)),
				);
			} else {
				body = h("div", { className: "sml-grid" },
					shownServers.length === 0
						? h("div", { className: "sml-empty" }, servers.length === 0 ? "当前 profile 未配置任何 MCP 服务器。" : "没有匹配的 MCP 服务器。")
						: shownServers.map((s) => h("div", { className: "sml-item" + (s.enabled ? "" : " is-off"), key: s.entryId },
							h("div", { className: "sml-itemTop" },
								h("span", { className: "sml-itemName", title: s.serverName }, s.serverName),
								s.enabled ? h("span", { className: "sml-tag sml-tag--ok" }, "已启用") : h("span", { className: "sml-tag sml-tag--off" }, "已禁用"),
							),
							h("div", { className: "sml-tags" },
								h("span", { className: "sml-tag" }, s.transport),
								h("span", { className: "sml-tag" }, s.toolCount + " 个工具"),
								phaseTag(s.fiberPhase),
								s.toggleable ? null : h("span", { className: "sml-tag", title: s.readOnlyReason || "" }, "只读"),
							),
							h("div", { className: "sml-itemDesc", title: s.connection && (s.connection.url || s.connection.command) },
								s.connection && s.connection.kind === "stdio"
									? (s.connection.command || "") + " " + (s.connection.args || []).join(" ")
									: (s.connection && s.connection.url) || s.entryId,
							),
							h("div", { className: "sml-itemFoot" },
								h("span", { className: "sml-itemPath", title: s.entryId }, s.entryId),
								h("button", { type: "button", className: "sml-btn sml-btn--sm", onClick: () => setDetail(Object.assign({ kind: "mcp" }, s)) }, "详情"),
								caps.mcpConfigure
									? h("button", { type: "button", className: "sml-btn sml-btn--sm", onClick: () => setModal({ mode: "configure", server: s }) }, "配置")
									: null,
								h(Switch, {
									on: s.enabled,
									disabled: !s.toggleable || !caps.mcpToggle || busy === "mcp:" + s.entryId,
									label: (s.enabled ? "禁用 " : "启用 ") + s.serverName,
									onToggle: () => run("mcp:" + s.entryId, { action: "set_mcp", target: s.entryId, enabled: !s.enabled }, (s.enabled ? "已禁用 " : "已启用 ") + s.serverName),
								}),
							),
						)),
				);
			}

			return h("div", { className: "sml-page" },
				head,
				notice ? h("div", { className: notice.kind === "ok" ? "sml-ok" : "sml-err" }, notice.text) : null,
				stats,
				tabs,
				tools,
				h("div", { className: "sml-body" }, body),
				detail ? h(DetailModal, { item: detail, onClose: () => setDetail(null) }) : null,
				modal
					? h(AddModal, {
						mode: modal.mode,
						server: modal.server,
						onModeChange: (next) => setModal({ mode: next, server: next === "configure" ? (servers[0] ?? null) : null }),
						onClose: () => setModal(null),
						onDone: (text) => { setModal(null); setNotice({ kind: "ok", text }); load(); },
					})
					: null,
			);
		}

		// ---------------------------------------------------------------
		// 侧边栏入口图标
		// ---------------------------------------------------------------
		/**
		 * 侧边栏图标组件。
		 * @param {object} props 组件属性
		 * @returns {object} React 元素
		 */
		function PanelIcon(props) {
			const s = props && props.size ? props.size : 16;
			return h("span", { style: { display: "inline-flex", width: s + "px", height: s + "px", alignItems: "center", justifyContent: "center" } }, h(IconBlocks, { size: s }));
		}

		/**
		 * 注册样式、侧边栏入口与主区域页面。
		 * @param {object} ctx 客户端插件上下文
		 */
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-skill-mcp-list";
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			});

			// 侧边栏菜单项：与「插件」「定时任务」同级（插件 order 0，本项 21）
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: 21,
						label: () => "Skill 与 MCP",
					},
					PanelIcon,
				),
			);

			// 主区域页面：点击菜单后渲染的内容（keyed by PANEL_ID）
			ctx.slots.inject("main", () =>
				ctx.slots.register(
					{
						name: "main",
						key: PANEL_ID,
					},
					Page,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
