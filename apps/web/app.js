/* AgentOS Web UI v3 — ChatGPT 风格克制审美；零构建、零 CDN、可离线。 */
'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  meta: null,
  settings: {},
  agents: [],
  projects: [],
  tasks: [],
  currentTaskId: null,
  ws: null,
  events: [],
  activeTab: 'timeline',
};

/* ---------------- 基础设施 ---------------- */

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
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(ts) { return (ts || '').replace('T', ' ').slice(5, 19); }
function relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - new Date(ts).getTime();
  if (d < 60e3) return '刚刚';
  if (d < 3600e3) return `${Math.floor(d / 60e3)} 分钟前`;
  if (d < 86400e3) return `${Math.floor(d / 3600e3)} 小时前`;
  return `${Math.floor(d / 86400e3)} 天前`;
}
const STATUS_META = {
  created: { label: '已创建', cls: '' },
  running: { label: '运行中', cls: 'info pulse' },
  waiting: { label: '等待下一步 · 可换人/跟进/分叉', cls: 'warn' },
  interrupted: { label: '已中断 · 可恢复', cls: 'warn' },
  done: { label: '已完成', cls: 'ok' },
  failed: { label: '失败', cls: 'err' },
};
function statusBadge(s) {
  const m = STATUS_META[s] || { label: s, cls: '' };
  return `<span class="badge ${m.cls}"><span class="dot-i"></span>${esc(m.label)}</span>`;
}
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-close]');
  if (t) closeModal(t.dataset.close);
});

/* ---------------- 主题（服务端持久化） ---------------- */

async function initTheme() {
  const saved = localStorage.getItem('agentos.theme');
  applyTheme(saved || state.settings.theme || 'system');
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('agentos.theme') || state.settings.theme || 'system') === 'system') applyTheme('system');
    });
  }
}
function applyTheme(mode) {
  const system = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = mode === 'system' ? system : mode;
  localStorage.setItem('agentos.theme', mode);
  document.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.theme === mode));
}
async function setTheme(mode) {
  applyTheme(mode);
  try { state.settings = await api('/api/settings', { method: 'PUT', body: { ...state.settings, theme: mode } }); } catch { /* 离线也允许 */ }
}

/* ---------------- 向导（首次使用） ---------------- */

function onboarded() {
  if (localStorage.getItem('agentos.onboarded')) return;
  showOnboardStep(0);
}
let onboardStep = 0;
function showOnboardStep(i) {
  onboardStep = i;
  openModal('onboarding');
  $('onboardDots').innerHTML = [0, 1, 2].map((n) => `<span class="dot ${n <= i ? 'on' : ''}"></span>`).join('');
  $('onboardNext').textContent = i === 2 ? '完成' : '下一步';
  $('onboardSkip').textContent = i === 0 ? '跳过导览' : '上一步';
  const body = $('onboardBody');
  if (i === 0) {
    body.innerHTML = `
      <div class="onboard-hero">
        <div class="logo">A</div>
        <h2>欢迎来到 AgentOS</h2>
        <p>在一个地方运行、切换、并行编排你机器上已有的每一个 AI Coding Agent。</p>
      </div>
      <div class="onboard-points">
        <div class="onboard-point"><span class="pt-ic">🔒</span><span><b>本地优先</b> — AgentOS 的任务记录保存在本机；调用 Agent 时，所选 CLI 可能向模型服务发送代码与上下文。</span></div>
        <div class="onboard-point"><span class="pt-ic">🤝</span><span><b>不碰你的凭据</b> — 已登录的 agent 直接复用，绝不读取/迁移 Token。</span></div>
        <div class="onboard-point"><span class="pt-ic">🔁</span><span><b>会话可携带</b> — Claude 干到一半，Codex 一键接管，无需重新解释。</span></div>
      </div>`;
  } else if (i === 1) {
    body.innerHTML = `
      <div class="onboard-hero">
        <h2 style="font-size:16px">正在扫描本机 Agent</h2>
        <p>只读检测：PATH / npm 全局 / 配置标记。不会执行任何程序。</p>
      </div>
      <div id="onboardAgents" class="onboard-points" style="color:var(--muted)">检测中…</div>`;
    api('/api/agents?refresh=1').then((agents) => {
      const el = $('onboardAgents');
      if (!el) return;
      state.agents = agents;
      el.innerHTML = agents.map((a) => {
        const ok = a.status === 'installed';
        return `<div class="onboard-point"><span class="pt-ic">${ok ? '✅' : '⬜'}</span>
          <span><b>${esc(a.name)}</b> — ${ok ? `已安装${a.auth === 'ok' ? '，已登录' : ''}` : '未安装（不影响其他 agent 使用）'}</span></div>`;
      }).join('');
    });
  } else {
    body.innerHTML = `
      <div class="onboard-hero">
        <h2 style="font-size:16px">三步开始第一个任务</h2>
      </div>
      <div class="onboard-points">
        <div class="onboard-point"><span class="pt-ic">1️⃣</span><span>在<b>项目</b>页登记一个 Git 仓库</span></div>
        <div class="onboard-point"><span class="pt-ic">2️⃣</span><span>在<b>任务</b>页描述目标，选择 Agent（或交给 Auto）</span></div>
        <div class="onboard-point"><span class="pt-ic">3️⃣</span><span>运行后可随时 <b>换人 / 跟进 / 请求评审 / 多路分叉</b></span></div>
      </div>`;
  }
}
$('onboardNext').onclick = () => {
  if (onboardStep < 2) showOnboardStep(onboardStep + 1);
  else { localStorage.setItem('agentos.onboarded', '1'); closeModal('onboarding'); }
};
$('onboardSkip').onclick = () => {
  if (onboardStep > 0) showOnboardStep(onboardStep - 1);
  else { localStorage.setItem('agentos.onboarded', '1'); closeModal('onboarding'); }
};

/* ---------------- 设置 ---------------- */

$('btnSettings').onclick = async () => {
  const sel = $('setDefaultAgent');
  sel.innerHTML = '<option value="">Auto（自动路由）</option>' +
    state.agents.filter((a) => a.status === 'installed').map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  sel.value = state.settings.defaultAgent || '';
  $('metaCard').innerHTML = state.meta
    ? `版本 <b>v${esc(state.meta.version)}</b> · ${esc(state.meta.platform)} · ${esc(state.meta.node)}<br>数据目录：${esc(state.meta.dataDir)}<br>任务记录保存在本机 · Agent 联网行为由所选 CLI 决定`
    : '';
  openModal('settingsModal');
};
document.querySelectorAll('#themeSeg button').forEach((b) => { b.onclick = () => setTheme(b.dataset.theme); });
$('setDefaultAgent').onchange = async (e) => {
  state.settings = await api('/api/settings', { method: 'PUT', body: { ...state.settings, defaultAgent: e.target.value } });
  toast('已保存');
};

function confirmDanger(text, onOk) {
  $('confirmText').textContent = text;
  openModal('confirmModal');
  $('confirmOk').onclick = () => { closeModal('confirmModal'); onOk(); };
}

/* ---------------- 侧栏最近任务 ---------------- */

function renderRecents() {
  const el = $('recentsList');
  const recent = state.tasks.slice(0, 5);
  el.innerHTML = recent.length
    ? recent.map((t) => `<a href="#/task/${esc(t.id)}" title="${esc(t.objective)}">${statusDot(t.status)} ${esc(t.objective.slice(0, 26))}</a>`).join('')
    : '<div class="recents-empty">还没有任务</div>';
}
function statusDot(s) {
  const color = s === 'done' ? 'var(--accent)' : s === 'failed' ? 'var(--danger)' : s === 'running' ? 'var(--blue)' : 'var(--warn)';
  return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:2px"></span>`;
}

/* ---------------- 视图：任务 ---------------- */

async function renderTasks() {
  setTitle('任务', '');
  view(``);
  state.tasks = await api('/api/tasks');
  state.projects = await api('/api/projects');
  const installed = state.agents.filter((a) => a.status === 'installed');
  const projOpts = state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.path)}</option>`).join('') || '<option value="">（先在「项目」页登记）</option>';
  view(`
    <div class="card">
      <div class="card-title">新建任务</div>
      <div class="card-hint">描述目标 → 选 Agent → 运行。Agent 在独立 worktree 分支上工作，不碰你的主工作区。</div>
      <div class="row" style="margin-bottom:10px">
        <select id="tProject" class="input" style="flex:1">${projOpts}</select>
        <div class="segmented" id="pathToggle"><button class="on">选项目</button><button>粘贴路径</button></div>
      </div>
      <div id="pathRow" class="row" style="display:none;margin-bottom:10px"><input id="tPath" class="input" placeholder="仓库绝对路径，如 D:\\code\\my-project" /></div>
      <label class="field-label">任务目标</label>
      <textarea id="tObjective" placeholder="例如：为 utils/date.ts 补充时区转换函数并添加单元测试"></textarea>
      <label class="field-label">约束（每行一条，可选）</label>
      <textarea id="tConstraints" style="min-height:44px" placeholder="不引入新依赖"></textarea>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary" id="createTask">创建任务</button>
        <span class="muted" style="font-size:12px">创建后可选择运行 / 换人 / 分叉</span>
      </div>
      <div id="tErr" class="err-text"></div>
    </div>
    ${taskTable()}
    ${importCard(installed)}
  `);
  bindTaskCreate();
  bindImport();
  renderRecents();
}

function taskTable() {
  if (!state.tasks.length) {
    return `<div class="card"><div class="empty"><div class="glyph">🗂️</div><h3>还没有任务</h3><p>创建第一个任务，让本机 Agent 开始工作</p></div></div>`;
  }
  return `<div class="card" style="padding:6px 14px"><table><thead><tr><th>任务</th><th>状态</th><th>最近 Agent</th><th>时间</th><th></th></tr></thead><tbody>
    ${state.tasks.map((t) => `<tr>
      <td style="max-width:340px"><a href="#/task/${esc(t.id)}" style="color:var(--text);text-decoration:none">${esc(t.objective.slice(0, 60))}${t.objective.length > 60 ? '…' : ''}</a></td>
      <td>${statusBadge(t.status)}</td>
      <td class="muted">${esc(t.runs.length ? t.runs[t.runs.length - 1].agentId : '—')}</td>
      <td class="muted" style="white-space:nowrap">${relTime(t.createdAt)}</td>
      <td><div class="row" style="gap:6px;flex-wrap:nowrap"><a href="#/task/${esc(t.id)}"><button class="btn btn-sm">打开</button></a><button class="btn btn-sm btn-danger" data-del="${esc(t.id)}">删除</button></div></td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

function importCard() {
  return `
    <div class="card">
      <div class="card-title">导入既有会话 <span class="badge">只读</span></div>
      <div class="card-hint">把你在裸 Claude Code / Codex CLI 里的历史会话转成 Capsule，让任意 Agent 接管。绝不改动你的会话文件。</div>
      <div class="row">
        <select id="impSource" class="input" style="width:150px"><option value="claude">Claude Code</option><option value="codex">Codex CLI</option></select>
        <input id="impDir" class="input" style="flex:1" placeholder="留空 = 默认目录（~/.claude/projects 或 ~/.codex/sessions）" />
        <button class="btn" id="impList">扫描会话</button>
      </div>
      <div id="impErr" class="err-text"></div>
      <div id="impResults" style="margin-top:10px"></div>
    </div>`;
}

function bindTaskCreate() {
  const seg = $('pathToggle');
  if (seg) {
    seg.querySelectorAll('button').forEach((b, i) => {
      b.onclick = () => {
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        $('tProject').style.display = i === 0 ? '' : 'none';
        $('pathRow').style.display = i === 1 ? '' : 'none';
      };
    });
  }
  const submit = async () => {
    const usePath = $('pathRow').style.display !== 'none';
    const constraints = $('tConstraints').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const body = {
      objective: $('tObjective').value,
      constraints,
      ...(usePath ? { repoRoot: $('tPath').value.trim() } : { projectId: $('tProject').value || undefined }),
    };
    try {
      const task = await api('/api/tasks', { method: 'POST', body });
      toast(`任务已创建`);
      location.hash = `#/task/${task.id}`;
    } catch (e) { $('tErr').textContent = e.message; }
  };
  $('createTask').onclick = submit;
  $('tObjective').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); });
  document.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = () => confirmDanger('删除该任务？其 worktree 与全部时间线/Capsule 数据将一并移除（分支与提交保留在仓库中）。', async () => {
      try {
        const r = await api(`/api/tasks/${btn.dataset.del}`, { method: 'DELETE' });
        toast(`已删除（清理 ${r.worktreesRemoved} 个 worktree）`);
        renderTasks();
      } catch (e) { toast(e.message, true); }
    });
  });
}

function bindImport() {
  const btn = $('impList');
  if (!btn) return;
  btn.onclick = async () => {
    const err = $('impErr');
    err.textContent = '';
    const src = $('impSource').value;
    const dir = $('impDir').value.trim();
    try {
      const sessions = await api(`/api/imports/${src}${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`);
      const box = $('impResults');
      if (!sessions.length) { box.innerHTML = '<div class="muted" style="font-size:13px">未找到会话文件</div>'; return; }
      box.innerHTML = `<table><thead><tr><th>时间</th><th>预览</th><th>仓库</th><th></th></tr></thead><tbody>
        ${sessions.slice(0, 15).map((s) => `<tr>
          <td class="muted" style="white-space:nowrap">${new Date(s.mtimeMs).toLocaleString()}</td>
          <td class="clip" title="${esc(s.preview)}">${esc(s.preview) || '<span class="muted">（无文本）</span>'}</td>
          <td class="muted clip mono">${esc(s.cwd || '—')}</td>
          <td><button class="btn btn-sm" data-import="${esc(s.file)}" data-src="${esc(src)}">导入并接管</button></td>
        </tr>`).join('')}</tbody></table>`;
      box.querySelectorAll('[data-import]').forEach((b) => {
        b.onclick = async () => {
          try {
            if (!state.projects.length) throw new Error('请先登记该会话对应的 Git 仓库（项目页）');
            const capsule = await api('/api/imports/save', { method: 'POST', body: { source: b.dataset.src, file: b.dataset.import } });
            const task = await api('/api/tasks', { method: 'POST', body: { projectId: state.projects[0].id, capsuleId: capsule.id } });
            toast('已导入，任务已创建');
            location.hash = `#/task/${task.id}`;
          } catch (e) { err.textContent = e.message; }
        };
      });
    } catch (e) { err.textContent = e.message; }
  };
}

/* ---------------- 视图：Agent 详情 ---------------- */

async function renderTaskDetail(taskId) {
  if (state.ws) { state.ws.close(); state.ws = null; }
  state.currentTaskId = taskId;
  state.events = [];
  let data;
  try { data = await api(`/api/tasks/${taskId}`); } catch (e) { setTitle('任务不存在', ''); view(`<div class="card"><div class="empty"><div class="glyph">🕳️</div><h3>任务不存在</h3><p>${esc(e.message)}</p></div></div>`); return; }
  if (state.currentTaskId !== taskId) return;
  const t = data.task;
  const lastRun = t.runs[t.runs.length - 1];
  setTitle(t.objective.length > 28 ? t.objective.slice(0, 28) + '…' : t.objective, `
    <span id="taskStatus">${statusBadge(t.status)}
    ${lastRun?.branch ? `<span class="badge mono">${esc(lastRun.branch)}</span>` : ''}</span>
    <button class="btn btn-sm btn-danger" id="btnDelTask">删除任务</button>`);
  const agents = state.agents.filter((a) => a.status === 'installed');
  const opts = (sel) => `<option value="auto"${sel === 'auto' ? ' selected' : ''}>Auto（自动路由）</option>` + agents.map((a) => `<option value="${esc(a.id)}"${sel === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  const agents2 = agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');

  view(`
    <div class="view-inner">
      <div class="card">
        <div class="card-title">任务目标</div>
        <div style="font-size:13.5px;margin-bottom:4px">${esc(t.objective)}</div>
        ${t.constraints.length ? `<div class="muted" style="font-size:12.5px;margin-top:6px">约束：${t.constraints.map(esc).join(' · ')}</div>` : ''}
        <div class="row" style="margin-top:14px">
          <select id="opAgent" class="input" style="width:200px">${opts(state.settings.defaultAgent || 'auto')}</select>
          <select id="opAgent2" class="input" style="width:200px">${agents2}</select>
        </div>
        <div class="row" style="margin-top:14px;justify-content:space-between">
          <div class="row">
            <button class="btn btn-primary" id="btnRun">▶ 运行</button>
            <button class="btn" id="btnSwap" title="Capsule → 上下文 → 新 Agent 接管（七问验证）">🔁 换人接管</button>
            <button class="btn" id="btnResume" title="同 Agent 用 Capsule 续接">↩️ 恢复</button>
            <button class="btn" id="btnFork" title="相同起点，多 Agent 并行">⑂ 分叉</button>
          </div>
          <div class="row" title="安全=各家默认；开发者=允许在独立 worktree 内读写与执行；完全=解除沙箱（默认禁用）">
            <span class="muted" style="font-size:12px">权限档</span>
            <div class="segmented" id="profileSeg">
              <button data-profile="safe">安全</button>
              <button data-profile="developer">开发者</button>
              <button data-profile="full" disabled title="默认禁用；需 AGENTOS_ALLOW_BYPASS=1 启动服务">完全</button>
            </div>
          </div>
        </div>
        <label class="field-label">跟进 · 向最近运行的 Agent 发新指令（同会话续聊）</label>
        <div class="row"><input id="followupMsg" class="input" style="flex:1" placeholder="例如：把错误信息改成英文，并重跑测试" /><button class="btn" id="btnFollowup">跟进</button></div>
        <label class="field-label">请教其他 Agent（在当前任务工作区评审；提示 Agent 不修改文件，实际权限由其配置决定）</label>
        <div class="row"><input id="askQuestion" class="input" style="flex:1" placeholder="例如：review 当前分支的实现是否存在边界问题" /><button class="btn" id="btnAsk">提问</button></div>
        <div id="busy" class="muted" style="font-size:12.5px;margin-top:10px;min-height:18px"></div>
      </div>
      <div class="segmented" style="margin-bottom:12px" id="detailTabs">
        <button data-tab="timeline" class="on">时间线</button>
        <button data-tab="capsule">Capsule</button>
        <button data-tab="diff">代码审查</button>
      </div>
      <div id="tabBody"></div>
    </div>`);

  $('btnDelTask').onclick = () => confirmDanger('删除该任务及其全部本地数据？（worktree 会清理，分支与提交保留）', async () => {
    try { await api(`/api/tasks/${taskId}`, { method: 'DELETE' }); toast('已删除'); location.hash = '#/tasks'; } catch (e) { toast(e.message, true); }
  });

  const statusElement = $('taskStatus');
  let statusRequest = 0;
  async function refreshTaskStatus() {
    const request = ++statusRequest;
    try {
      const fresh = (await api('/api/tasks/' + taskId)).task;
      if (request !== statusRequest || state.currentTaskId !== taskId || !statusElement.isConnected) return;
      const branch = fresh.runs[fresh.runs.length - 1]?.branch;
      statusElement.innerHTML = statusBadge(fresh.status) + (branch ? '<span class="badge mono">' + esc(branch) + '</span>' : '');
      state.tasks = state.tasks.map(task => task.id === taskId ? fresh : task);
      renderRecents();
    } catch { /* A later event or navigation retries the status read. */ }
  }
  const busy = (m) => { if (state.currentTaskId === taskId && $('busy')) $('busy').textContent = m || ''; };
  let currentProfile = state.settings.defaultProfile === 'developer' ? 'developer' : 'safe';
  document.querySelectorAll('#profileSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.profile === currentProfile);
    b.onclick = () => {
      if (b.disabled) return;
      currentProfile = b.dataset.profile;
      document.querySelectorAll('#profileSeg button').forEach((x) => x.classList.toggle('on', x.dataset.profile === currentProfile));
    };
  });
  const showOutcome = (r, prefix) => {
    busy(`${prefix}：exit=${r.run.exitCode}${r.run.error ? ` ⚠ ${r.run.error}` : ''}${r.capsule ? ' · Capsule 已保存' : ''}`);
  };
  const guard = (fn) => async () => {
    try { await fn(); } catch (e) { toast(e.message, true); } finally { busy(''); await refreshTaskStatus(); }
  };
  const agentId = () => $('opAgent').value;
  const agentId2 = () => $('opAgent2').value;
  const post = (path, body) => api(`/api/tasks/${taskId}/${path}`, { method: 'POST', body });

  $('btnRun').onclick = guard(async () => {
    busy('运行中…（事件实时推送，可随时关闭窗口回来查看）');
    const r = await post('run', { agentId: agentId(), profile: currentProfile });
    showOutcome(r, '完成');
    loadTab();
  });
  $('btnSwap').onclick = guard(async () => {
    busy('交接中… Capsule → 上下文编译 → 新 worktree → 七问验证');
    const r = await post('swap', { toAgentId: agentId2(), profile: currentProfile });
    showOutcome(r, `接管完成（${r.run.agentId}）`);
    loadTab();
  });
  $('btnResume').onclick = guard(async () => {
    busy('恢复中…');
    const r = await post('resume', { agentId: agentId() === 'auto' ? undefined : agentId() });
    showOutcome(r, '恢复完成');
    loadTab();
  });
  $('btnFork').onclick = guard(async () => {
    const ids = agents.map((a) => a.id).slice(0, 3);
    if (!ids.length) throw new Error('没有已安装的 Agent 可分叉');
    busy(`分叉并行中（${ids.join(', ')}，相同起点）…`);
    const r = await post('fork', { agentIds: ids, profile: currentProfile });
    busy('分叉完成：' + r.map((x) => `${x.agentId}: exit=${x.run.exitCode}${x.run.error ? ' ⚠' : ''}`).join(' | '));
    loadTab();
  });
  const submitFollowup = guard(async () => {
    const m = $('followupMsg').value.trim();
    if (!m) throw new Error('请输入跟进指令');
    busy('跟进中…（同会话续聊）');
    const r = await post('followup', { message: m, profile: currentProfile });
    $('followupMsg').value = '';
    showOutcome(r, '跟进完成');
    loadTab();
  });
  $('btnFollowup').onclick = submitFollowup;
  $('followupMsg').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitFollowup(); });
  $('btnAsk').onclick = guard(async () => {
    const q = $('askQuestion').value.trim();
    if (!q) throw new Error('请输入问题');
    busy(`${agentId2()} 思考中…`);
    const r = await post('ask', { toAgentId: agentId2(), question: q });
    busy('回答已入时间线');
    switchTab('capsule');
    state.tabOverride = { capsule: r.answer };
    loadTab();
  });
  $('askQuestion').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnAsk').click(); });

  // Tabs
  const tabBody = $('tabBody');
  let tabRequest = 0;
  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('#detailTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    renderTab();
  }
  async function renderTab() {
    const request = ++tabRequest;
    const isCurrent = () => request === tabRequest && state.currentTaskId === taskId && tabBody.isConnected;
    const tab = state.activeTab;
    if (tab === 'timeline') {
      if (!state.events.length) { tabBody.innerHTML = `<div class="card"><div class="empty"><div class="glyph">⚡</div><h3>时间线还是空的</h3><p>点击「运行」开始，事件会实时出现在这里</p></div></div>`; return; }
      tabBody.innerHTML = `<div class="card" style="padding:10px 16px"><ul class="timeline">${state.events.map(renderEvent).join('')}</ul></div>`;
      const ul = tabBody.querySelector('.timeline');
      ul.scrollTop = ul.scrollHeight;
      const box = tabBody.querySelector('.card'); box.scrollTop = box.scrollHeight;
    } else if (tab === 'capsule') {
      const override = state.tabOverride?.capsule;
      if (override) { tabBody.innerHTML = `<div class="card"><div class="card-title">Agent 回答</div><pre style="max-height:none">${esc(override)}</pre></div>`; return; }
      const md = await fetch(`/api/tasks/${taskId}/capsule?format=md`).then((r) => (r.ok ? r.text() : null));
      if (!isCurrent()) return;
      tabBody.innerHTML = md
        ? `<div class="card"><div class="card-title">Universal Session Capsule</div><div class="card-hint">人可读的交接文档 · 保存于任务数据目录</div><pre style="max-height:none">${esc(md)}</pre></div>`
        : `<div class="card"><div class="empty"><div class="glyph">📦</div><h3>还没有 Capsule</h3><p>任务运行一次后自动生成</p></div></div>`;
    } else {
      await renderDiffReview(taskId, tabBody, isCurrent);
    }
  }
  document.querySelectorAll('#detailTabs button').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
  async function loadTab() { state.tabOverride = null; renderRecents(); renderTab(); }

  connectWS(taskId, (event) => {
    if (state.activeTab === 'timeline') renderTab();
    if (['task.started', 'task.finished', 'task.failed', 'task.recovered'].includes(event.type)) void refreshTaskStatus();
  });
  renderTab();
  renderRecents();
}

// Display repository text only as escaped content. Large patches never create unbounded DOM.
function renderReviewPatch(patch) {
  const lines = patch.split('\n');
  const clipped = lines.length > 3000;
  const html = lines.slice(0, 3000).map(line => {
    const kind = /^(diff |index |--- |\+\+\+ |rename |similarity |new file|deleted file)/.test(line) ? 'meta'
      : line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'context';
    return `<span class="diff-${kind}">${esc(line) || ' '}</span>`;
  }).join('');
  return { html, clipped };
}

async function renderDiffReview(taskId, container, isCurrent) {
  container.innerHTML = '<div class="card muted">正在读取任务工作区的变更…</div>';
  let summary;
  try { summary = await api(`/api/tasks/${taskId}/diff`); }
  catch (error) {
    if (isCurrent()) container.innerHTML = `<div class="card"><div class="card-title">无法读取变更</div><p>${esc(error.message)}</p><p class="muted">请检查任务工作区后重新打开此页。读取失败不代表没有改动。</p></div>`;
    return;
  }
  if (!isCurrent()) return;
  const files = summary.files || [];
  if (!files.length) {
    container.innerHTML = `<div class="card"><div class="card-title">代码审查</div><p>${esc(summary.note || '当前没有已跟踪文件的差异。')}</p></div>`;
    return;
  }
  const kinds = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名' };
  container.innerHTML = `<div class="card">
    <div class="card-title">代码审查 · ${files.length} 个文件</div>
    <div class="card-hint">${esc(summary.branch)} · 与任务起点比较，包含已暂存和未暂存的已跟踪文件；未跟踪文件需先进入 checkpoint。</div>
    <label class="field-label">选择要审查的文件</label>
    <select class="input" data-review-files aria-label="选择要审查的文件">${files.map((file, index) => `<option value="${index}">${esc(kinds[file.change] || file.change)} · ${esc(file.previousPath ? file.previousPath + ' → ' + file.path : file.path)}</option>`).join('')}</select>
    <div class="row" style="margin:12px 0"><button class="btn btn-sm" data-review-feedback>填写跟进意见</button><span class="muted">只填入文件位置，由你补充意见后发送。</span></div>
    <div data-review-patch></div>
  </div>`;
  const selector = container.querySelector('[data-review-files]');
  const body = container.querySelector('[data-review-patch]');
  let patchRequest = 0;
  async function loadPatch() {
    const request = ++patchRequest;
    const file = files[Number(selector.value)];
    if (!file) return;
    body.innerHTML = '<p class="muted">正在读取文件差异…</p>';
    try {
      const diff = await api(`/api/tasks/${taskId}/diff?file=${encodeURIComponent(file.path)}`);
      if (!isCurrent() || request !== patchRequest) return;
      if (diff.limited) { body.innerHTML = `<p class="muted">${esc(diff.note)}</p>`; return; }
      const rendered = renderReviewPatch(diff.patch || '');
      body.innerHTML = `${diff.binary ? '<p class="muted">二进制文件已变化，无法显示逐行文本差异。</p>' : ''}
        ${rendered.clipped ? '<p class="muted">仅显示前 3000 行，请在任务工作区审查完整差异。</p>' : ''}
        ${diff.patch ? `<pre class="diff-code">${rendered.html}</pre>` : '<p class="muted">该文件当前没有文本差异；文件可能已在读取期间改变，请刷新变更清单。</p>'}`;
    } catch (error) {
      if (isCurrent() && request === patchRequest) body.innerHTML = `<p>无法读取此文件：${esc(error.message)}</p>`;
    }
  }
  selector.onchange = loadPatch;
  container.querySelector('[data-review-feedback]').onclick = () => {
    if (!isCurrent()) return;
    const input = $('followupMsg');
    if (!input.value.trim()) input.value = `请检查文件 ${files[Number(selector.value)].path}：`;
    input.focus();
  };
  await loadPatch();
}

function renderEvent(e) {
  const cls = 'tl-' + String(e.type).replace(/\./g, '_');
  const payload = e.payload ? Object.entries(e.payload)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .slice(0, 6)
    .map(([k, v]) => {
      let s = typeof v === 'string' ? v : JSON.stringify(v);
      if (s && s.length > 110) s = s.slice(0, 110) + '…';
      return `<b style="color:var(--text)">${esc(k)}</b> ${esc(s)}`;
    }).join(' · ') : '';
  const cost = e.payload?.costUsd ? `<span class="tl-cost">$${Number(e.payload.costUsd).toFixed(4)}</span>` : '';
  return `<li class="${cls}">
    <span class="tl-icon"></span>
    <div class="tl-body">
      <div class="tl-head"><span class="actor">${esc(e.actor)}</span><span class="type">${esc(e.type)}</span>${cost}<span class="time">${fmtTime(e.ts)}</span></div>
      ${payload ? `<div class="muted" style="font-size:12px">${payload}</div>` : ''}
    </div>
  </li>`;
}

function connectWS(taskId, renderTimeline) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws?taskId=${encodeURIComponent(taskId)}`);
  state.ws = ws;
  ws.onopen = () => { if (state.ws !== ws || state.currentTaskId !== taskId) return; const el = document.getElementById('wsState'); if (el) el.textContent = '· 实时'; };
  ws.onmessage = (m) => {
    if (state.ws !== ws || state.currentTaskId !== taskId) return;
    let evt;
    try { evt = JSON.parse(m.data); } catch { return; }
    if (evt.type === 'history') state.events = evt.events || [];
    else { state.events.push(evt); }
    renderTimeline(evt);
  };
  ws.onclose = () => {
    if (state.ws !== ws || state.currentTaskId !== taskId) return;
    // 服务重启/网络闪断：自动重连（同任务才重连），重连后服务端会重放 history
    const el = document.getElementById('wsState');
    if (el) el.textContent = '· 重连中…';
    setTimeout(() => {
      if (state.currentTaskId === taskId && state.ws === ws) connectWS(taskId, renderTimeline);
    }, 2500);
  };
}

/* ---------------- 视图：Agents ---------------- */

async function renderAgents() {
  setTitle('Agents', `<button class="btn btn-sm" id="deepScan">🔍 深度检测</button>`);
  view(`<div class="sub">本机自动发现（只读：PATH / npm 全局 / 配置标记）。绝不执行你的 Agent、绝不读取凭据内容。</div><div class="grid" id="agentGrid"></div>`);
  await loadAgents(false);
  $('deepScan').onclick = guardAsync(async () => {
    toast('深度检测中（执行各 agent 的 --version，需你点击才发生）…');
    await loadAgents(true);
    toast('完成');
  });
}

async function guardAsync(fn) {
  try { await fn(); } catch (e) { toast(e.message, true); }
}

async function loadAgents(probe) {
  state.agents = await api(`/api/agents?refresh=1${probe ? '&probe=1' : ''}`);
  const grid = $('agentGrid');
  if (!grid) return;
  grid.innerHTML = state.agents.map((a) => {
    const installed = a.status === 'installed';
    const auth = a.auth === 'ok' ? '<span class="badge ok">已登录</span>' : '<span class="badge">登录状态未知</span>';
    const caps = Object.entries(a.capabilities).filter(([, v]) => v).map(([k]) => k).join(' · ');
    return `<div class="card">
      <div class="row" style="justify-content:space-between">
        <div class="row" style="gap:10px">
          <div class="logo" style="width:30px;height:30px;border-radius:8px;font-size:13px;background:${installed ? 'var(--accent)' : 'var(--muted)'}">${esc(a.name[0])}</div>
          <b>${esc(a.name)}</b>
        </div>
        ${installed ? '<span class="badge ok"><span class="dot-i"></span>已安装</span>' : '<span class="badge">未安装</span>'}
      </div>
      <div class="muted" style="font-size:12px;margin:8px 0 4px">${a.version ? `v${esc(a.version)} · ` : ''}${a.npmPackage ? esc(a.npmPackage) : ''}</div>
      <div class="muted" style="font-size:12px">能力：${esc(caps) || '—'}</div>
      <div class="row" style="margin-top:12px">${auth}
        ${installed ? '' : `<button class="btn btn-sm" data-install="${esc(a.id)}">安装方案</button>`}
      </div>
      ${a.binaries.length ? `<div class="muted mono" style="font-size:11px;margin-top:8px;word-break:break-all">${esc(a.binaries[0])}</div>` : ''}
    </div>`;
  }).join('');
  grid.querySelectorAll('[data-install]').forEach((btn) => {
    btn.onclick = async () => {
      const plan = await api(`/api/agents/${btn.dataset.install}/install`, { method: 'POST', body: {} });
      confirmInfo(`官方安装方案（${plan.source}）`, `${plan.command}\n\n${plan.note}\n\nAgentOS 不自动执行、不使用第三方镜像。请在终端手动执行。`);
    };
  });
}
function confirmInfo(title, text) {
  $('confirmText').textContent = `${title}\n${text}`;
  $('confirmOk').textContent = '我知道了';
  $('confirmOk').onclick = () => { closeModal('confirmModal'); $('confirmOk').textContent = '确认删除'; };
  openModal('confirmModal');
}

/* ---------------- 视图：项目 ---------------- */

async function renderProjects() {
  setTitle('项目', '');
  state.projects = await api('/api/projects');
  view(`
    <div class="sub">登记真实 Git 仓库。Agent 在独立 worktree 分支工作，不碰你的主工作区。</div>
    <div class="card">
      <div class="row"><input id="projPath" class="input" style="flex:1" placeholder="仓库绝对路径，如 D:\\code\\my-project" /><button class="btn btn-primary" id="addProj">登记</button></div>
      <div id="projErr" class="err-text"></div>
    </div>
    ${state.projects.length ? `<div class="card" style="padding:6px 14px"><table><thead><tr><th>名称</th><th>路径</th><th>登记时间</th></tr></thead><tbody>
      ${state.projects.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="muted mono clip" style="max-width:380px">${esc(p.path)}</td><td class="muted">${relTime(p.createdAt)}</td></tr>`).join('')}
    </tbody></table></div>`
      : `<div class="card"><div class="empty"><div class="glyph">📁</div><h3>还没有项目</h3><p>登记一个 Git 仓库即可开始</p></div></div>`}
  `);
  $('addProj').onclick = async () => {
    try {
      await api('/api/projects', { method: 'POST', body: { path: $('projPath').value.trim() } });
      toast('项目已登记');
      renderProjects();
    } catch (e) { $('projErr').textContent = e.message; }
  };
  $('projPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('addProj').click(); });
}

/* ---------------- 路由与启动 ---------------- */

function setTitle(title, extra) { $('pageTitle').textContent = title; $('topbarExtra').innerHTML = extra || ''; }
function view(html) { $('view').innerHTML = `<div class="view-inner">${html}</div>`; }

async function route() {
  if (state.ws) { state.ws.close(); state.ws = null; }
  state.currentTaskId = null;
  const hash = location.hash || '#/tasks';
  const m = hash.match(/^#\/task\/([^?]+)/);
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', hash.startsWith(`#${a.dataset.view}`) || (m && a.dataset.view === 'tasks')));
  if (m) return renderTaskDetail(m[1]);
  if (hash.startsWith('#/agents')) return renderAgents();
  if (hash.startsWith('#/projects')) return renderProjects();
  return renderTasks();
}
$('btnNewTask').onclick = () => { location.hash = '#/tasks'; setTimeout(() => $('tObjective')?.focus(), 120); };
window.addEventListener('hashchange', route);

(async function boot() {
  try {
    [state.meta, state.settings] = await Promise.all([api('/api/meta'), api('/api/settings')]);
    $('version').textContent = `v${state.meta.version}`;
    state.agents = await api('/api/agents');
    state.tasks = await api('/api/tasks');
  } catch (e) {
    document.body.innerHTML = `<div style="display:flex;height:100vh;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#a4a4a4;font-family:sans-serif">
      <div style="font-size:30px">🔌</div><div>无法连接 AgentOS 服务</div>
      <div style="font-size:13px">${esc(e.message)}</div>
      <div style="font-size:12.5px">请先启动服务：双击 AgentOS.bat，或命令行 npm run desktop</div></div>`;
    return;
  }
  await initTheme();
  await route();
  onboarded();
})();
