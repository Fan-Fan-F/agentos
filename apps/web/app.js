/* AgentOS Web UI（M1 Minimal，ADR-008）：原生 JS，零构建、零 CDN、可离线。 */
'use strict';

const state = {
  agents: [],
  projects: [],
  tasks: [],
  currentTaskId: null,
  ws: null,
  events: [],
};

const main = document.getElementById('main');

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || data.raw || `HTTP ${res.status}`);
  return data;
}

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.borderColor = isError ? 'var(--err)' : 'var(--accent)';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(ts) { return (ts || '').replace('T', ' ').slice(5, 19); }

/* ---------------- Agents ---------------- */

async function renderAgents() {
  main.innerHTML = '<h1>🤖 Agents</h1><div class="sub">本机自动发现（只读扫描：PATH / npm 全局 / 家目录标记）。绝不读取凭据、不执行你的 agent。</div><div id="agentGrid" class="grid"></div><div class="row" style="margin-top:14px"><button id="deepScan">🔍 深度检测（执行 --version，需你点击才发生）</button><span id="scanNote" class="muted"></span></div>';
  await loadAgents(false);
  document.getElementById('deepScan').onclick = async () => {
    document.getElementById('scanNote').textContent = '检测中…';
    await loadAgents(true);
    document.getElementById('scanNote').textContent = '完成';
  };
}

async function loadAgents(probe) {
  state.agents = await api(`/api/agents?refresh=1${probe ? '&probe=1' : ''}`);
  const grid = document.getElementById('agentGrid');
  if (!grid) return;
  grid.innerHTML = state.agents.map((a) => {
    const installed = a.status === 'installed';
    const authBadge = a.auth === 'ok' ? '<span class="badge ok">已登录标记</span>' : a.auth === 'required' ? '<span class="badge err">需要登录</span>' : '<span class="badge mut">登录未知</span>';
    return `<div class="card">
      <div class="row" style="justify-content:space-between">
        <strong>${esc(a.name)}</strong>
        ${installed ? '<span class="badge ok">Installed</span>' : '<span class="badge err">Not Installed</span>'}
      </div>
      <div class="muted" style="margin:8px 0">
        ${a.version ? `v${esc(a.version)} · ` : ''}${a.npmPackage ? `npm: ${esc(a.npmPackage)}` : ''}
      </div>
      <div class="muted">协议: ${a.protocols.join(' / ')} · 能力: ${Object.entries(a.capabilities).filter(([, v]) => v).map(([k]) => k).join(', ') || '—'}</div>
      <div class="row" style="margin-top:10px">${authBadge}
        ${installed ? '' : `<button data-install="${esc(a.id)}">查看安装方案</button>`}
      </div>
      ${a.binaries.length ? `<div class="muted" style="margin-top:6px;word-break:break-all">${esc(a.binaries[0])}</div>` : ''}
    </div>`;
  }).join('');
  grid.querySelectorAll('[data-install]').forEach((btn) => {
    btn.onclick = async () => {
      const plan = await api(`/api/agents/${btn.dataset.install}/install`, { method: 'POST', body: {} });
      toast(`官方安装方案（需你在终端手动执行）：\n${plan.command}`, false);
      alert(`官方来源: ${plan.source}\n\n命令:\n${plan.command}\n\n说明: ${plan.note}\n\n（AgentOS 不自动执行、不使用第三方镜像）`);
    };
  });
}

/* ---------------- Projects ---------------- */

async function renderProjects() {
  state.projects = await api('/api/projects');
  main.innerHTML = `<h1>📁 Projects</h1><div class="sub">登记一个真实 Git 仓库（AgentOS 在独立 worktree/分支上工作，不碰你的主工作区）。</div>
    <div class="card">
      <label>仓库绝对路径</label>
      <div class="row"><input id="projPath" placeholder="例如 D:\\code\\my-project" style="flex:1" /><button class="primary" id="addProj">登记</button></div>
      <div id="projErr" class="err-text"></div>
    </div>
    <div class="card"><table><thead><tr><th>名称</th><th>路径</th><th></th></tr></thead><tbody>
      ${state.projects.length ? state.projects.map((p) => `<tr><td><strong>${esc(p.name)}</strong></td><td class="muted">${esc(p.path)}</td><td><button data-open="${esc(p.id)}">创建任务 →</button></td></tr>`).join('') : '<tr><td colspan="3" class="muted">还没有登记项目</td></tr>'}
    </tbody></table></div>`;
  document.getElementById('addProj').onclick = async () => {
    const path = document.getElementById('projPath').value.trim();
    try {
      await api('/api/projects', { method: 'POST', body: { path } });
      toast('项目已登记');
      renderProjects();
    } catch (e) { document.getElementById('projErr').textContent = e.message; }
  };
  document.querySelectorAll('[data-open]').forEach((btn) => {
    btn.onclick = () => { location.hash = `#/task/new?project=${btn.dataset.open}`; };
  });
}

/* ---------------- Tasks ---------------- */

async function renderTasks() {
  state.tasks = await api('/api/tasks');
  state.projects = await api('/api/projects');
  main.innerHTML = `<h1>🗂️ Tasks</h1><div class="sub">创建任务 → Agent 工作 → Capsule → 一键换人 / Fork / 请求评审。</div>
    <div class="card">
      <label>项目</label>
      <select id="tProject">${state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.path)}</option>`).join('') || '<option value="">（先登记项目）</option>'}</select>
      <label>任务目标</label>
      <textarea id="tObjective" placeholder="例如：为 utils/date.ts 补充时区转换函数并添加单元测试"></textarea>
      <label>约束（每行一条，可选）</label>
      <textarea id="tConstraints" style="min-height:48px" placeholder="不引入新依赖"></textarea>
      <div class="row" style="margin-top:12px"><button class="primary" id="createTask">创建任务</button><span id="tErr" class="err-text"></span></div>
    </div>
    <div class="card"><table><thead><tr><th>任务</th><th>状态</th><th>最近 agent</th><th>创建时间</th><th></th></tr></thead><tbody>
      ${state.tasks.map((t) => `<tr>
        <td>${esc(t.objective.slice(0, 60))}${t.objective.length > 60 ? '…' : ''}</td>
        <td><span class="badge ${t.status === 'done' ? 'ok' : t.status === 'failed' ? 'err' : 'warn'}">${esc(t.status)}</span></td>
        <td class="muted">${esc(t.runs.length ? t.runs[t.runs.length - 1].agentId : '—')}</td>
        <td class="muted">${fmtTime(t.createdAt)}</td>
        <td><button data-task="${esc(t.id)}">打开</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">还没有任务</td></tr>'}
    </tbody></table></div>
    <h2>导入既有会话（只读）</h2>
    <div class="card">
      <div class="sub">把你在裸 Claude Code / Codex CLI 里产生的会话转换为 Capsule，让任意 agent 接管历史工作。全程只读，绝不改动你的会话文件。</div>
      <div class="row">
        <select id="impSource" style="width:140px"><option value="claude">Claude Code</option><option value="codex">Codex CLI</option></select>
        <input id="impDir" placeholder="留空 = 默认目录（~/.claude/projects 或 ~/.codex/sessions）" style="flex:1" />
        <button id="impList">列出会话</button>
      </div>
      <div id="impErr" class="err-text"></div>
      <div id="impResults" style="margin-top:10px"></div>
    </div>`;
  document.getElementById('createTask').onclick = async () => {
    const constraints = document.getElementById('tConstraints').value.split('\n').map((s) => s.trim()).filter(Boolean);
    try {
      const task = await api('/api/tasks', {
        method: 'POST',
        body: {
          projectId: document.getElementById('tProject').value || undefined,
          objective: document.getElementById('tObjective').value,
          constraints,
        },
      });
      toast(`任务已创建: ${task.id}`);
      location.hash = `#/task/${task.id}`;
    } catch (e) { document.getElementById('tErr').textContent = e.message; }
  };
  document.querySelectorAll('[data-task]').forEach((btn) => { btn.onclick = () => { location.hash = `#/task/${btn.dataset.task}`; }; });
  document.getElementById('impList').onclick = async () => {
    const err = document.getElementById('impErr');
    err.textContent = '';
    const src = document.getElementById('impSource').value;
    const dir = document.getElementById('impDir').value.trim();
    try {
      const sessions = await api(`/api/imports/${src}${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`);
      const box = document.getElementById('impResults');
      box.innerHTML = sessions.length
        ? `<table><thead><tr><th>时间</th><th>预览</th><th>cwd</th><th></th></tr></thead><tbody>${sessions.slice(0, 20).map((s) => `<tr>
            <td class="muted">${new Date(s.mtimeMs).toLocaleString()}</td>
            <td>${esc(s.preview) || '<span class="muted">（无文本）</span>'}</td>
            <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc(s.cwd || '—')}</td>
            <td><button data-import="${esc(s.file)}" data-src="${esc(src)}">导入并创建任务</button></td>
          </tr>`).join('')}</tbody></table>`
        : '<div class="muted">未找到会话文件</div>';
      box.querySelectorAll('[data-import]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            const capsule = await api('/api/imports/save', { method: 'POST', body: { source: btn.dataset.src, file: btn.dataset.import } });
            if (!state.projects.length) throw new Error('请先在 Projects 登记该会话对应的 git 仓库');
            const task = await api('/api/tasks', { method: 'POST', body: { projectId: state.projects[0].id, capsuleId: capsule.id } });
            toast(`已导入并创建任务 ${task.id}`);
            location.hash = `#/task/${task.id}`;
          } catch (e) { err.textContent = e.message; }
        };
      });
    } catch (e) { err.textContent = e.message; }
  };
}

const STATUS_LABEL = { created: '已创建', running: '运行中', interrupted: '已中断（可恢复）', done: '完成', failed: '失败' };

async function renderTaskDetail(taskId) {
  if (state.ws) { state.ws.close(); state.ws = null; }
  state.currentTaskId = taskId;
  state.events = [];
  let data;
  try { data = await api(`/api/tasks/${taskId}`); } catch (e) { main.innerHTML = `<h1>任务不存在</h1><p class="muted">${esc(e.message)}</p>`; return; }
  const t = data.task;
  const agents = state.agents.filter((a) => a.status === 'installed');
  const options = agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  main.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div><h1>任务 ${esc(t.id)}</h1><div class="sub">${esc(t.objective)}</div></div>
      <div><span class="badge ${t.status === 'done' ? 'ok' : t.status === 'failed' ? 'err' : 'warn'}" style="font-size:13px">${STATUS_LABEL[t.status] || esc(t.status)}</span></div>
    </div>
    <div class="card">
      <div class="row">
        <div style="flex:1;min-width:200px"><label>Agent</label><select id="opAgent"><option value="auto">Auto（自动路由）</option>${options}</select></div>
        <div style="flex:1;min-width:200px"><label>换人/评审目标</label><select id="opAgent2">${options}</select></div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="btnRun">▶ 运行</button>
        <button id="btnSwap">🔁 换人接管（Swap）</button>
        <button id="btnResume">↩️ 恢复（Resume）</button>
        <button id="btnFork">⑂ Fork 到所选（相同起点并行）</button>
      </div>
      <label>向其他 Agent 提问（会携带任务上下文，只读不改文件）</label>
      <div class="row"><input id="askQuestion" placeholder="例如：review 当前分支的实现是否存在边界问题" style="flex:1" /><button id="btnAsk">提问</button></div>
      <label>跟进：向最近运行的 agent 发送新指令（同会话续聊，优先原生 resume）</label>
      <div class="row"><input id="followupMsg" placeholder="例如：把错误信息改成英文，并重跑测试" style="flex:1" /><button id="btnFollowup">跟进</button></div>
      <div id="busy" class="muted" style="margin-top:8px"></div>
    </div>
    <h2>统一 Timeline <span class="muted" id="wsState"></span></h2>
    <div class="card"><ul class="timeline" id="timeline"><li class="muted">（尚无事件）</li></ul></div>
    <div class="grid">
      <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Capsule</h2><button id="btnCapsule">查看最新</button></div><pre id="capsuleOut" class="muted">任务运行后会生成 Universal Session Capsule。</pre></div>
      <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Git Diff</h2><button id="btnDiff">查看变更</button></div><pre id="diffOut" class="muted">任务运行后会显示分支上的变更文件与统计。</pre></div>
    </div>`;

  const busy = (msg) => { document.getElementById('busy').textContent = msg || ''; };

  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  const agentId = () => document.getElementById('opAgent').value;
  const agentId2 = () => document.getElementById('opAgent2').value;

  bind('btnRun', guard(async () => {
    busy('运行中…（事件实时推送）');
    const r = await api(`/api/tasks/${taskId}/run`, { method: 'POST', body: { agentId: agentId() } });
    busy(`运行完成：exit=${r.run.exitCode}，变更 ${r.diffFiles} 个文件。Capsule: ${r.capsule?.id ?? '—'}`);
    refreshCapsuleAndDiff();
  }));
  bind('btnSwap', guard(async () => {
    busy('交接中…（Capsule → Context → 新 Agent → 七问验证）');
    const r = await api(`/api/tasks/${taskId}/swap`, { method: 'POST', body: { toAgentId: agentId2() } });
    busy(`接管完成：${r.run.agentId} exit=${r.run.exitCode}。Capsule: ${r.capsule?.id ?? '—'}`);
    refreshCapsuleAndDiff();
  }));
  bind('btnResume', guard(async () => {
    busy('恢复中…');
    const r = await api(`/api/tasks/${taskId}/resume`, { method: 'POST', body: { agentId: agentId() === 'auto' ? undefined : agentId() } });
    busy(`恢复完成：exit=${r.run.exitCode}`);
    refreshCapsuleAndDiff();
  }));
  bind('btnFork', guard(async () => {
    const ids = agents.map((a) => a.id).filter((id) => id !== 'auto').slice(0, 3);
    if (!ids.length) throw new Error('没有已安装的 agent 可 Fork');
    busy(`Fork 并行中（${ids.join(', ')}，相同起点）…`);
    const r = await api(`/api/tasks/${taskId}/fork`, { method: 'POST', body: { agentIds: ids } });
    busy('Fork 完成：' + r.map((x) => `${x.agentId}: exit=${x.run.exitCode}, ${x.diffFiles} 文件`).join(' | '));
    refreshCapsuleAndDiff();
  }));
  bind('btnAsk', guard(async () => {
    const q = document.getElementById('askQuestion').value.trim();
    if (!q) throw new Error('请输入问题');
    busy(`${agentId2()} 思考中…`);
    const r = await api(`/api/tasks/${taskId}/ask`, { method: 'POST', body: { toAgentId: agentId2(), question: q } });
    busy('回答已入 Timeline');
    document.getElementById('capsuleOut').textContent = r.answer;
  }));
  bind('btnFollowup', guard(async () => {
    const m = document.getElementById('followupMsg').value.trim();
    if (!m) throw new Error('请输入跟进指令');
    busy('跟进中…（同会话续聊）');
    const r = await api(`/api/tasks/${taskId}/followup`, { method: 'POST', body: { message: m } });
    busy(`跟进完成：exit=${r.run.exitCode}，Capsule: ${r.capsule?.id ?? '—'}`);
    refreshCapsuleAndDiff();
  }));
  bind('btnCapsule', () => refreshCapsuleAndDiff(true));
  bind('btnDiff', () => refreshCapsuleAndDiff());

  async function refreshCapsuleAndDiff(capsuleOnly) {
    try {
      const md = await fetch(`/api/tasks/${taskId}/capsule?format=md`).then((r) => (r.ok ? r.text() : null));
      if (md) document.getElementById('capsuleOut').textContent = md;
    } catch { /* 尚无 capsule */ }
    if (!capsuleOnly) {
      try {
        const d = await api(`/api/tasks/${taskId}/diff`);
        document.getElementById('diffOut').textContent = `${d.note || `分支 ${d.branch} · ${d.files?.length ?? 0} 个文件变更`}\n\n${d.stat || (d.files || []).map((f) => `${f.change}\t${f.path}`).join('\n')}`;
      } catch { /* 尚无 diff */ }
    }
  }

  function guard(fn) {
    return async () => {
      try { await fn(); } catch (e) { busy(''); toast(e.message, true); }
      finally { busy(document.getElementById('busy').textContent.replace('中…', '完成')); }
    };
  }

  connectWS(taskId);
  refreshCapsuleAndDiff();
}

function connectWS(taskId) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws?taskId=${encodeURIComponent(taskId)}`);
  state.ws = ws;
  ws.onopen = () => { const el = document.getElementById('wsState'); if (el) el.textContent = '· 实时'; };
  ws.onmessage = (m) => {
    let evt;
    try { evt = JSON.parse(m.data); } catch { return; }
    if (evt.type === 'history') { state.events = evt.events || []; }
    else state.events.push(evt);
    renderTimeline();
  };
  ws.onclose = () => { const el = document.getElementById('wsState'); if (el) el.textContent = '· 已断开'; };
}

function renderTimeline() {
  const ul = document.getElementById('timeline');
  if (!ul) return;
  if (!state.events.length) { ul.innerHTML = '<li class="muted">（尚无事件）</li>'; return; }
  ul.innerHTML = state.events.map((e) => {
    const hl = /handoff|capsule|fork|swap|checkpoint|replied|asked/.test(e.type) ? 'hl' : '';
    const payload = e.payload ? Object.entries(e.payload).filter(([, v]) => v !== undefined && v !== null).slice(0, 4).map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 90 ? v.slice(0, 90) + '…' : JSON.stringify(v)}`).join(' · ') : '';
    return `<li class="${hl}"><span class="t">${fmtTime(e.ts)}</span><span class="actor">${esc(e.actor)}</span><span>${esc(e.type)}</span>${payload ? `<div class="muted">${esc(payload)}</div>` : ''}</li>`;
  }).join('');
  ul.scrollTop = ul.scrollHeight;
}

/* ---------------- 路由 ---------------- */

function route() {
  const hash = location.hash || '#/agents';
  const m = hash.match(/^#\/task\/([^?]+)/);
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', hash.startsWith(`#${a.dataset.view}`) || (m && a.dataset.view === 'tasks')));
  if (m) return renderTaskDetail(m[1]);
  if (hash.startsWith('#/projects')) return renderProjects();
  if (hash.startsWith('#/tasks')) return renderTasks();
  return renderAgents();
}

window.addEventListener('hashchange', route);
route().catch((e) => { main.innerHTML = `<h1>启动失败</h1><pre>${esc(e.message)}</pre><p class="muted">请确认 API 服务已启动（npm start，默认 http://127.0.0.1:7333）。</p>`; });
