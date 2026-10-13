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
			".sml-head{display:flex;align-items:flex-start;gap:16px;padding:20px 24px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);}",
			".sml-title{font-size:18px;font-weight:600;margin:0 0 4px;}",
			".sml-sub{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary);}",
			".sml-headActions{margin-left:auto;display:flex;gap:8px;align-items:center;}",
			".sml-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;font-family:inherit;}",
			".sml-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}",
			".sml-btn:disabled{opacity:.5;cursor:default;}",
			".sml-btn--primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);}",
			".sml-btn--primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);}",
			".sml-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:1px;}",
			".sml-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;padding:16px 24px;}",
			".sml-card{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);padding:12px 14px;background:var(--dsw-alias-bg-layer-1);}",
			".sml-cardK{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-bottom:6px;}",
			".sml-cardV{font-size:22px;font-weight:600;line-height:1.1;}",
			".sml-cardX{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:4px;}",
			".sml-tabs{display:flex;gap:4px;padding:0 24px;border-bottom:1px solid var(--dsw-alias-border-l2);}",
			".sml-tab{height:34px;padding:0 12px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit;}",
			".sml-tab:hover{color:var(--dsw-alias-label-primary);}",
			".sml-tab.is-on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);}",
			".sml-tools{display:flex;gap:8px;align-items:center;padding:12px 24px 8px;}",
			".sml-input{flex:1;max-width:320px;height:30px;padding:0 10px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;}",
			".sml-input:focus{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:1px;}",
			".sml-body{flex:1;min-height:0;overflow:auto;padding:4px 24px 24px;}",
			".sml-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);margin-bottom:8px;background:var(--dsw-alias-bg-layer-1);}",
			".sml-row.is-off{opacity:.62;}",
			".sml-rowMain{min-width:0;flex:1;}",
			".sml-name{font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
			".sml-code{font-family:var(--dsw-font-markdown-code-font-family);font-size:12px;color:var(--dsw-alias-label-secondary);}",
			".sml-desc{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}",
			".sml-tag{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:var(--dsw-radius-xs);font-size:11px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);white-space:nowrap;}",
			".sml-tag--ok{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary);}",
			".sml-tag--off{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);}",
			".sml-tag--err{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground);}",
			".sml-sw{position:relative;width:36px;height:20px;flex:none;border-radius:10px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-3);cursor:pointer;padding:0;transition:background var(--ds-transition-duration,140ms) var(--ds-ease-in-out,ease);}",
			".sml-sw:disabled{opacity:.45;cursor:default;}",
			".sml-sw.is-on{background:var(--dsw-alias-brand-primary);border-color:transparent;}",
			".sml-sw::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-switch-thumb,#fff);transition:transform var(--ds-transition-duration,140ms) var(--ds-ease-in-out,ease);}",
			".sml-sw.is-on::after{transform:translateX(16px);}",
			".sml-sw:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:2px;}",
			".sml-empty{padding:32px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;}",
			".sml-err{margin:0 24px 12px;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground);font-size:12px;word-break:break-word;}",
			".sml-mask{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1);display:flex;align-items:center;justify-content:center;z-index:60;padding:24px;}",
			".sml-modal{width:min(760px,100%);max-height:min(80vh,900px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-panel);box-shadow:var(--dsw-elevation-panel);overflow:hidden;}",
			".sml-modalHead{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-border-l2);}",
			".sml-modalTitle{font-size:15px;font-weight:600;margin:0;}",
			".sml-modalBody{overflow:auto;padding:16px 20px;}",
			".sml-kv{display:grid;grid-template-columns:130px 1fr;gap:8px 12px;font-size:13px;margin-bottom:16px;}",
			".sml-k{color:var(--dsw-alias-label-tertiary);}",
			".sml-v{color:var(--dsw-alias-label-primary);word-break:break-word;font-family:var(--dsw-font-markdown-code-font-family);font-size:12px;}",
			".sml-sect{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:16px 0 8px;text-transform:uppercase;letter-spacing:.04em;}",
			".sml-pre{margin:0;padding:12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-markdown-code-block);font-family:var(--dsw-font-markdown-code-font-family);font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:340px;overflow:auto;color:var(--dsw-alias-label-primary);}",
			".sml-list{margin:0;padding-left:18px;font-size:12px;font-family:var(--dsw-font-markdown-code-font-family);color:var(--dsw-alias-label-secondary);}",
			".sml-spin{display:inline-block;animation:smlSpin 1s linear infinite;}",
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
		// 详情弹窗
		// ---------------------------------------------------------------
		function DetailModal(props) {
			const item = props.item;
			react.useEffect(() => {
				const onKey = (e) => {
					if (e.key === "Escape") props.onClose();
				};
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
				h(
					"div",
					{ className: "sml-modalHead", key: "head" },
					h("h2", { className: "sml-modalTitle" }, item.kind === "skill" ? item.name : item.serverName),
					h("span", { className: "sml-tag" }, item.kind === "skill" ? "Skill" : "MCP"),
					h("div", { style: { marginLeft: "auto" } }),
					h("button", { type: "button", className: "sml-btn", onClick: props.onClose, "aria-label": "关闭" }, h(IconClose, { size: 14 })),
				),
				h(
					"div",
					{ className: "sml-modalBody", key: "body" },
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

			return h(
				"div",
				{ className: "sml-mask", onClick: (e) => { if (e.target === e.currentTarget) props.onClose(); } },
				h("div", { className: "sml-modal", role: "dialog", "aria-modal": "true", "aria-label": "详情" }, children),
			);
		}

		// ---------------------------------------------------------------
		// 主页面
		// ---------------------------------------------------------------
		function Page() {
			const [state, setState] = react.useState({ loading: true, error: null, data: null });
			const [tab, setTab] = react.useState("skills");
			const [query, setQuery] = react.useState("");
			const [detail, setDetail] = react.useState(null);
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

			const data = state.data;
			const skills = (data && data.skills) || [];
			const servers = (data && data.mcpServers) || [];
			const summary = (data && data.summary) || null;
			const caps = (data && data.capabilities) || {};

			const q = query.trim().toLowerCase();
			const match = (text) => q.length === 0 || String(text || "").toLowerCase().indexOf(q) >= 0;
			const shownSkills = skills.filter((s) => match(s.name) || match(s.description) || match(s.provider) || match(s.source));
			const shownServers = servers.filter((s) => match(s.serverName) || match(s.transport) || match(s.entryId));

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

			const head = h(
				"div",
				{ className: "sml-head" },
				h(
					"div",
					null,
					h("h1", { className: "sml-title" }, "Skill 与 MCP"),
					h("p", { className: "sml-sub" }, "查看当前 DSH 已安装的 Skill 与 MCP 服务器，并启用或禁用它们"),
				),
				h(
					"div",
					{ className: "sml-headActions" },
					h("button", { type: "button", className: "sml-btn", onClick: load, disabled: state.loading }, h("span", { className: state.loading ? "sml-spin" : "" }, h(IconRefresh, { size: 14 })), "刷新"),
				),
			);

			if (state.loading && data === null) {
				return h("div", { className: "sml-page" }, head, h("div", { className: "sml-empty" }, "正在加载…"));
			}
			if (state.error !== null && data === null) {
				return h("div", { className: "sml-page" }, head, h("div", { className: "sml-err" }, state.error));
			}

			const cards = h(
				"div",
				{ className: "sml-cards" },
				h("div", { className: "sml-card" }, h("div", { className: "sml-cardK" }, "Skill 总数"), h("div", { className: "sml-cardV" }, summary ? summary.skills.total : 0), h("div", { className: "sml-cardX" }, summary ? "启用 " + summary.skills.enabled + " · 禁用 " + summary.skills.disabled : "")),
				h("div", { className: "sml-card" }, h("div", { className: "sml-cardK" }, "MCP 服务器"), h("div", { className: "sml-cardV" }, summary ? summary.mcp.total : 0), h("div", { className: "sml-cardX" }, summary ? "启用 " + summary.mcp.enabled + " · 禁用 " + summary.mcp.disabled : "")),
				h("div", { className: "sml-card" }, h("div", { className: "sml-cardK" }, "MCP 工具"), h("div", { className: "sml-cardV" }, summary ? summary.mcp.tools : 0), h("div", { className: "sml-cardX" }, "已注册到工具表")),
				h("div", { className: "sml-card" }, h("div", { className: "sml-cardK" }, "工作目录"), h("div", { className: "sml-cardV", style: { fontSize: "12px", fontWeight: 400, fontFamily: "var(--dsw-font-markdown-code-font-family)", wordBreak: "break-all" } }, data ? shortPath(data.cwd) : "—"), h("div", { className: "sml-cardX" }, "项目级 Skill 的发现根")),
			);

			const tabs = h(
				"div",
				{ className: "sml-tabs", role: "tablist" },
				h("button", { type: "button", role: "tab", "aria-selected": tab === "skills", className: "sml-tab" + (tab === "skills" ? " is-on" : ""), onClick: () => setTab("skills") }, "Skill（" + skills.length + "）"),
				h("button", { type: "button", role: "tab", "aria-selected": tab === "mcp", className: "sml-tab" + (tab === "mcp" ? " is-on" : ""), onClick: () => setTab("mcp") }, "MCP（" + servers.length + "）"),
			);

			const tools = h(
				"div",
				{ className: "sml-tools" },
				h("input", { className: "sml-input", type: "search", placeholder: "搜索名称 / 描述 / 来源…", value: query, onChange: (e) => setQuery(e.target.value), "aria-label": "搜索" }),
			);

			let body;
			if (tab === "skills") {
				body = shownSkills.length === 0
					? h("div", { className: "sml-empty" }, skills.length === 0 ? "当前没有发现任何 Skill。" : "没有匹配的 Skill。")
					: shownSkills.map((s) =>
						h(
							"div",
							{ className: "sml-row" + (s.enabled ? "" : " is-off"), key: s.name },
							h(
								"div",
								{ className: "sml-rowMain" },
								h(
									"div",
									{ className: "sml-name" },
									s.name,
									h("span", { className: "sml-tag" }, s.provider || "unknown"),
									h("span", { className: "sml-tag" }, s.source || "unknown"),
									s.enabled ? h("span", { className: "sml-tag sml-tag--ok" }, "已启用") : h("span", { className: "sml-tag sml-tag--off" }, "已禁用"),
									s.toggleable ? null : h("span", { className: "sml-tag", title: s.toggleReason || "" }, "只读"),
								),
								h("div", { className: "sml-desc", title: s.description }, s.description || "（无描述）"),
							),
							h("button", { type: "button", className: "sml-btn", onClick: () => openSkillDetail(s.name), disabled: busy === "detail:" + s.name }, "详情"),
							h(Switch, {
								on: s.enabled,
								disabled: !s.toggleable || busy === "skill:" + s.name,
								label: (s.enabled ? "禁用 " : "启用 ") + s.name,
								onToggle: () => run("skill:" + s.name, { action: "set_skill", target: s.name, enabled: !s.enabled, field: "model" }, (s.enabled ? "已禁用 " : "已启用 ") + s.name),
							}),
						),
					);
			} else {
				body = shownServers.length === 0
					? h("div", { className: "sml-empty" }, servers.length === 0 ? "当前 profile 未配置任何 MCP 服务器。" : "没有匹配的 MCP 服务器。")
					: shownServers.map((s) =>
						h(
							"div",
							{ className: "sml-row" + (s.enabled ? "" : " is-off"), key: s.entryId },
							h(
								"div",
								{ className: "sml-rowMain" },
								h(
									"div",
									{ className: "sml-name" },
									s.serverName,
									h("span", { className: "sml-tag" }, s.transport),
									h("span", { className: "sml-tag" }, s.toolCount + " 个工具"),
									phaseTag(s.fiberPhase),
									s.toggleable ? null : h("span", { className: "sml-tag", title: s.readOnlyReason || "" }, "只读"),
								),
								h("div", { className: "sml-desc", title: s.connection && (s.connection.url || s.connection.command) }, s.connection && s.connection.kind === "stdio" ? (s.connection.command || "") + " " + (s.connection.args || []).join(" ") : (s.connection && s.connection.url) || s.entryId),
							),
							h("button", { type: "button", className: "sml-btn", onClick: () => setDetail(Object.assign({ kind: "mcp" }, s)) }, "详情"),
							h(Switch, {
								on: s.enabled,
								disabled: !s.toggleable || !caps.mcpToggle || busy === "mcp:" + s.entryId,
								label: (s.enabled ? "禁用 " : "启用 ") + s.serverName,
								onToggle: () => run("mcp:" + s.entryId, { action: "set_mcp", target: s.entryId, enabled: !s.enabled }, (s.enabled ? "已禁用 " : "已启用 ") + s.serverName),
							}),
						),
					);
			}

			return h(
				"div",
				{ className: "sml-page" },
				head,
				notice ? h("div", { className: "sml-err", style: notice.kind === "ok" ? { background: "var(--dsw-alias-state-success-primary)" } : undefined }, notice.text) : null,
				cards,
				tabs,
				tools,
				h("div", { className: "sml-body" }, body),
				detail ? h(DetailModal, { item: detail, onClose: () => setDetail(null) }) : null,
			);
		}

		// ---------------------------------------------------------------
		// 侧边栏入口图标
		// ---------------------------------------------------------------
		function PanelIcon(props) {
			const s = props && props.size ? props.size : 16;
			return h("span", { style: { display: "inline-flex", width: s + "px", height: s + "px", alignItems: "center", justifyContent: "center" } }, h(IconBlocks, { size: s }));
		}

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
