'use strict';

let syncRequest = null;
let lastAttempt = 0;
let onboardingGuide = false;
let queuedUnlocks = null;
const onlineMode = location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
const algorithmTags = {
  base: [-2, 353], sim: [1, 111], sort: [113, 78], prefix: [254], recur: [54, 359],
  bit: [314, 465], stack: [287], queue: [288], dp: [3, 444], graph: [155, 158, 6],
  str: [2, 357], gcd: [241, 455], gauss: [274, 271], diff: [330], binary: [45],
  two: [345], greedy: [7, 524], divide: [112, 100], heap: [51, 148], mono: [385, 56],
  dsu: [47], st: [290], fenwick: [53], seg: [42, 446, 379], balanced: [50],
  knapsack: [139], interval: [144], digit: [141], mask: [464], dfs: [127, 128, 4],
  bfs: [126], topo: [159], floyd: [476], hash: [235, 473], kmp: [302], trie: [300],
  manacher: [329, 325], sam: [101], sieve: [239, 475], pow: [415], exgcd: [242, 243],
  xor: [277], game: [445, 13], geo: [8, 482, 286, 292], divblock: [448], prob: [266, 270],
  persist: [233, 234], offline: [447, 298, 316], lis: [444], dpopt: [146, 150, 154, 463],
  shortest: [160], mst: [166, 68], tree: [208, 230, 213], scc: [179, 180], bridge: [181],
  match: [187, 541, 189], flow: [79, 198, 471, 197], euler: [182], ac: [301], sa: [303, 304],
  inverse: [276], crt: [250], matrix: [149, 272, 273, 71], hull: [291], fft: [313],
  mobius: [251, 451, 461], mo: [41, 289], negative: [185, 174], lca: [211, 43],
  twosat: [176], centroid: [49, 483], comb: [252, 253, 322], calipers: [299], ntt: [324],
  treediff: [330, 230], hld: [228], costflow: [204, 373], poly: [69, 372, 416, 417],
  treeDP: [152], high: [10], 'intro-output': [353], 'intro-input': [353]
};
const tagGenerality = new Set([-2, 1, 2, 3, 4, 5, 6, 8, 11, 44, 72, 110, 230, 308]);

function tagRows(problem) {
  return (Array.isArray(problem.tags) ? problem.tags : []).filter(tag =>
    tag && Number.isInteger(tag.id) && typeof tag.name === 'string' && (!tag.type || tag.type === 2));
}

function normalizedWords(text) {
  return String(text || '').normalize('NFKC').toLowerCase().replace(/[\s/·「」〖〗（）()\[\]、]/g, '');
}

function matchingNodes(problem) {
  const tags = tagRows(problem);
  const title = normalizedWords(problem.title);
  const description = String(problem.statement || '');
  const gridScan = /矩阵|方阵|网格|字符阵列|矩形/.test(description) &&
    /方向|直线|对角线|向上.*向下/.test(description) &&
    !/最短|连通|最少步|可达/.test(description) &&
    !tags.some(tag => [126, 127].includes(tag.id));
  const ranked = [];
  for (const [treeId, atlas] of Object.entries(atlases)) {
    for (const node of atlas.nodes) {
      const topics = (node.keywords || []).concat(node.name.split(/[与、 /（）()·]/))
        .map(normalizedWords).filter(word => word.length > 1);
      const matchingExercises = atlas.exercises.filter(route => route.node === node.id);
      let score = topics.some(word => title.includes(word)) ? 17 : 0;
      if (gridScan && problem.difficulty <= 3) {
        if (node.id === 'intro-grid') score += 22;
        if (node.id === 'intro-matrix') score += 14;
      }
      for (const tag of tags) {
        const tagName = normalizedWords(tag.name);
        const common = (algorithmTags[node.id] || []).includes(tag.id) || node.matchTags?.includes(tag.id) || node.tags?.includes(tag.id);
        const exactTopic = topics.some(word => tagName === word || (word.length >= 3 && tagName.includes(word)));
        const examples = matchingExercises.filter(route => route.tags?.includes(tag.id)).length;
        if (exactTopic || common) score += tagGenerality.has(tag.id) ? 6 : 14;
        score += examples / Math.max(1, matchingExercises.length) * (tagGenerality.has(tag.id) ? 4 : 10);
      }
      if (!score) continue;
      if (treeId === tree) score += 1;
      if (problem.difficulty === 1 && treeId === 'beginner') score += 3;
      if (problem.difficulty >= 4 && treeId === 'advanced') score += 3;
      const average = atlas.layers[node.layer].average;
      ranked.push({ node, score, gap: Math.abs((problem.difficulty > 6 ? 10 : problem.difficulty > 5 ? 7 : problem.difficulty) - average) });
    }
  }
  return ranked.sort((a, b) => b.score - a.score || a.gap - b.gap || a.node.order - b.node.order);
}

async function api(route, cancellation) {
  if (!onlineMode) throw new Error('请用新版 Windows 启动器打开星图以连接洛谷。');
  const timeout = AbortSignal.timeout(45000);
  const response = await fetch('/api/' + route, {
    signal: cancellation ? AbortSignal.any([cancellation, timeout]) : timeout,
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  const data = await response.json();
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : data.error?.message;
    throw new Error(message || data.message || '洛谷请求失败，请稍后重试。');
  }
  return data;
}

function invalidateSync() {
  syncRequest?.controller.abort();
  syncRequest = null;
  queuedUnlocks = null;
  lastAttempt = 0;
}

function renderAccountButton() {
  const button = $('accountBtn');
  const label = $('accountLabel');
  if (!onlineMode) { label.textContent = '洛谷功能说明'; button.title = '查看静态网页版的洛谷功能说明'; $('accountGuide').hidden = true; return; }
  label.textContent = state.account ? '洛谷 ' + state.account.uid : '绑定洛谷';
  button.title = state.account ? '查看洛谷账号和同步状态' : '绑定洛谷账号';
  $('accountGuide').hidden = !onboardingGuide;
  button.classList.toggle('guide-active', onboardingGuide);
}

function guideBinding() {
  onboardingGuide = true;
  renderAccountButton();
  $('accountBtn').focus();
}

function openOnboarding() {
 if (!onlineMode) { state.onboardingSeen = true; persist(); return; }
  showDialog(`<h3>绑定洛谷账号</h3><p>填写你的洛谷 UID，即可同步公开练习进度。每个节点的题目已通过 70% 或以上时，星图会自动点亮该节点。</p>
    <div class="dialog-actions"><button data-close id="deferBind" class="defer-bind">暂不绑定</button><button id="startBind" class="primary">立即绑定</button></div>`);
  const dialog = $('dialog');
  const completeOnboarding = () => {
    state.onboardingSeen = true;
    persist();
    guideBinding();
  };
  dialog.addEventListener('close', completeOnboarding, { once: true });
  $('startBind').onclick = () => {
    dialog.removeEventListener('close', completeOnboarding);
    state.onboardingSeen = true;
    persist();
    openAccount(true, true);
  };
}

function openAccount(editing = false, guideOnCancel = false) {
 if (!onlineMode) { showDialog('<h3>洛谷功能说明</h3><p>静态网页版支持算法学习、内置题库、手动记录和进度备份。绑定洛谷、同步公开记录、自动解锁及按题号加题需要使用 2.8 本地版启动器。</p><p>可在进度与备份中导出进度，导入本地版后继续学习。</p><div class="dialog-actions"><button data-close>关闭</button></div>'); return; }
  onboardingGuide = false;
  renderAccountButton();
  const account = state.account;
  const canEdit = editing || !account;
  const warnings = account?.warnings.map(warning => `<li>${esc(warning)}</li>`).join('') || '';
  const syncDate = account?.syncedAt ? new Date(account.syncedAt).toLocaleString('zh-CN', { hour12: false }) : '';
  const attempted = account ? Object.values(account.problems).filter(record => record.status === 'attempted').length : 0;
  const passed = account ? Object.values(account.problems).filter(record => record.status === 'passed').length : 0;
  showDialog(`<h3>洛谷账号</h3>
    ${account ? `<p><a href="https://www.luogu.com.cn/user/${account.uid}/practice" target="_blank" rel="noopener">${esc(account.name || 'UID ' + account.uid)}的练习页 ↗</a>
      <br>UID ${account.uid}${syncDate ? ` · 同步于 ${esc(syncDate)}` : ''}<br>公开通过 ${passed} 道 · 已尝试 ${attempted} 道</p>` : ''}
    ${warnings ? `<ul class="help-list">${warnings}</ul>` : ''}
    ${canEdit ? `<form id="uidForm"><label for="uidInput">洛谷 UID</label>
      <div class="dialog-input"><input id="uidInput" name="uid" inputmode="numeric" maxlength="10" value="${account?.uid || ''}" placeholder="例如 2058632" autocomplete="off" required>
        <button class="primary" type="submit">绑定并同步</button></div>
      <p class="hint">UID 是个人主页网址中的数字。同步公开数据无需输入密码。</p></form>` : ''}
    <p class="account-message" id="accountMessage" role="status"></p>
    <div class="dialog-actions">${account && !canEdit ? '<button id="unbindAccount">解除绑定</button><button id="editAccount">更换 UID</button><button class="primary" id="syncNow">立即同步</button>' : ''}
    <button data-close>${canEdit ? '取消' : '关闭'}</button></div>`);
  const message = $('accountMessage');
  if (!onlineMode) message.textContent = '请通过新版启动器打开星图以连接洛谷。';
  if ($('uidForm')) {
    $('uidForm').onsubmit = event => {
      event.preventDefault();
      const uid = $('uidInput').value.trim();
      if (!uidPattern.test(uid)) {
        message.textContent = '请输入洛谷个人主页中的数字 UID。';
        return;
      }
      syncAccount(uid, { binding: true, message });
    };
    $('dialog').addEventListener('close', () => {
      if (syncRequest?.binding && syncRequest.message === message) {
        syncRequest.controller.abort();
        syncRequest = null;
        lastAttempt = 0;
      }
      if (guideOnCancel && !state.account) guideBinding();
    }, { once: true });
    $('uidInput').focus();
  }
  if ($('syncNow')) $('syncNow').onclick = () => syncAccount(account.uid, { message });
  if ($('editAccount')) $('editAccount').onclick = () => openAccount(true);
  if ($('unbindAccount')) $('unbindAccount').onclick = () => {
    invalidateSync();
    state.account = null;
    applyRemoteAutoLearn();
    refresh();
    persist();
    $('dialog').close();
    toast('已解除洛谷账号绑定。');
  };
}

function showQueuedUnlocks(replaceDialog = false) {
  const dialog = $('dialog');
  if (!queuedUnlocks || (dialog.open && !replaceDialog)) return false;
  const { uid, ids } = queuedUnlocks;
  queuedUnlocks = null;
  if (state.account?.uid !== uid) return false;
  const masteredIds = [...ids].filter(id => learned.has(id));
  if (!masteredIds.length) return false;
  const sections = [
    ['beginner', '入门算法树'],
    ['advanced', 'ICPC算法树']
  ].map(([treeId, label]) => {
    const nodes = masteredIds.filter(id => treeByNode.get(id) === treeId)
      .map(id => nodeById.get(id)).sort((a, b) => a.layer - b.layer || a.order - b.order);
    const contents = nodes.length ? `<ul class="help-list">${nodes.map(node => `<li>${esc(node.name)}</li>`).join('')}</ul>`
      : '<p class="quiet">本次无新增</p>';
    return `<section class="unlock-result-group"><h4>${label}</h4>${contents}</section>`;
  }).join('');
  showDialog(`<h3>已自动为您解锁已学会的节点</h3>
    <div class="unlock-result-groups">${sections}</div>
    <div class="dialog-actions"><button class="primary" id="confirmAutoUnlock" data-close>确定</button></div>`);
  $('confirmAutoUnlock').focus();
  return true;
}

function showMigratedMastery() {
  const ids = new Set([...autoLearned].filter(id => !isManuallyLearned(id)));
  state.onboardingSeen = true;
  persist();
  if (ids.size) {
    queuedUnlocks = { uid: state.account.uid, ids };
    showQueuedUnlocks();
  }
}

function showSyncProgress(request, message) {
  if (!message) return;
  request.message = message;
  request.control = message.parentElement.querySelector('button[type="submit"], #syncNow');
  message.textContent = '正在读取洛谷练习页…';
  if (request.control) request.control.disabled = true;
}

async function syncAccount(uid, { binding = false, message = null } = {}) {
  if (syncRequest && (!binding || syncRequest.binding)) {
    if (!binding && !syncRequest.binding && syncRequest.uid === uid) {
      showSyncProgress(syncRequest, message);
    } else if (message) {
      message.textContent = '正在同步洛谷练习…';
    }
    return;
  }
  syncRequest?.controller.abort();
  const request = { uid, binding, message: null, control: null, controller: new AbortController() };
  syncRequest = request;
  lastAttempt = Date.now();
  showSyncProgress(request, message);
  try {
    const data = await api('practice/' + uid, request.controller.signal);
    if (syncRequest !== request || (binding && (!message?.isConnected || !$('dialog').open))) return;
    if (String(data.uid) !== uid || !data.problems || typeof data.problems !== 'object' ||
      Array.isArray(data.problems) || data.practiceComplete !== true) {
      throw new Error('洛谷返回的练习记录不完整，请重试。');
    }
    const previous = state.account?.uid === uid ? state.account.problems : {};
    const problems = cleanRemoteProblems(data.problems);
    for (const [pid, record] of Object.entries(problems)) {
      if (record.score === null && previous[pid]?.status === record.status) {
        record.score = previous[pid].score;
        record.fromFullScore = previous[pid].fromFullScore;
      }
    }
    state.account = {
      uid,
      name: String(data.name || ''),
      syncedAt: Date.now(),
      warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : [],
      practiceComplete: true,
      problems
    };
    const newIds = applyRemoteAutoLearn();
    refresh();
    persist();
    const inAccountDialog = Boolean(request.message?.isConnected && $('dialog').open);
    if (queuedUnlocks?.uid !== uid) queuedUnlocks = null;
    if (newIds.length) {
      queuedUnlocks ??= { uid, ids: new Set() };
      for (const id of newIds) queuedUnlocks.ids.add(id);
    }
    if (!showQueuedUnlocks(inAccountDialog) && inAccountDialog) {
      openAccount();
      $('accountMessage').textContent = binding ? '已绑定并同步。本次没有符合自动解锁条件的新节点。' : '同步完成。';
    }
  } catch (error) {
    if (syncRequest !== request || request.controller.signal.aborted) return;
    const text = error.name === 'TimeoutError' ? '洛谷响应超时，请重试。' : error.message;
    if (request.message?.isConnected) request.message.textContent = text;
    else {
      $('accountBtn').title = '上次同步失败 · ' + text;
      if (state.account?.uid === uid && state.account.syncedAt) toast('洛谷同步失败，已保留上次同步结果。');
    }
  } finally {
    if (syncRequest === request) syncRequest = null;
    if (request.control?.isConnected) request.control.disabled = false;
  }
}

function maybeSync(force = false) {
  if (!onlineMode || !state.account || syncRequest) return;
  const stale = Date.now() - Math.max(lastAttempt, state.account.syncedAt) > 5 * 60 * 1000;
  if (force || stale) syncAccount(state.account.uid);
}

const scoreCache = new Map();
const scoreLookups = new Set();
let desiredScores = [];

function scheduleScoreLookups(problems) {
  if (!onlineMode || !state.account || view !== 'tree') return;
  desiredScores = problems.filter(problem => state.account.problems[problem.pid]?.status === 'passed' &&
    state.account.problems[problem.pid].score === null).map(problem => problem.pid);
  queueMicrotask(pumpScoreLookups);
}

function pumpScoreLookups() {
  if (!state.account || view !== 'tree') return;
  for (const pid of desiredScores) {
    if (scoreLookups.size >= 2) break;
    if (scoreCache.get(pid) === null || scoreLookups.has(pid) || state.account.problems[pid]?.score !== null) continue;
    verifyPassedScore(pid);
  }
}

async function verifyPassedScore(pid, manual = false) {
  if (scoreLookups.has(pid)) return;
  scoreLookups.add(pid);
  try {
    const known = (exercisesByPid.get(pid) || []).find(problem => Number.isFinite(problem.fullScore));
    const score = known?.fullScore ?? scoreCache.get(pid) ?? (await api('problem/' + pid)).fullScore;
    scoreCache.set(pid, typeof score === 'number' && Number.isFinite(score) ? score : null);
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      if (manual) toast('洛谷公开题目数据没有给出满分数值。');
      return;
    }
    const record = state.account?.problems[pid];
    if (record?.status !== 'passed' || record.score !== null) return;
    record.score = score;
    record.fromFullScore = true;
    persist();
    const scroll = $('detail').scrollTop;
    renderDetail();
    $('detail').scrollTop = scroll;
    if (view === 'practice') renderPractice();
  } catch (error) {
    scoreCache.set(pid, null);
    if (manual) toast(error.message);
  } finally {
    scoreLookups.delete(pid);
    queueMicrotask(pumpScoreLookups);
  }
}

function saveCustom(problem, node, tags) {
  if (state.custom.some(item => item.pid === problem.pid)) {
    toast(problem.pid + ' 已经在星图中。');
    return;
  }
  const names = tags.slice(0, 5).map(tag => tag.name);
  const exercise = {
    key: node.id + ':' + problem.pid,
    node: node.id,
    pid: problem.pid,
    title: problem.title,
    url: problemUrl(problem.pid),
    difficulty: difficultyById.has(problem.difficulty) ? problem.difficulty : 0,
    tags: tags.map(tag => tag.id),
    requires: [node.id],
    extra: [],
    rank: 100000 + state.custom.length,
    source: 'custom',
    fullScore: typeof problem.fullScore === 'number' && Number.isFinite(problem.fullScore) ? problem.fullScore : null,
    note: names.length ? '手动添加 · 洛谷算法标签 ' + names.join('、') : '手动添加 · ' + node.name
  };
  state.custom.push(exercise);
  state.pending[node.id] = [...new Set([...(state.pending[node.id] || []), exercise.key])];
  $('addPid').value = '';
  applyRemoteAutoLearn();
  rebuildIndexes();
  refresh();
  persist();
  const targetTree = treeByNode.get(node.id);
  if (targetTree !== tree) switchTree(targetTree);
  selectNode(node.id, { focus: true, acknowledge: false });
  toast(problem.pid + ' 已添加到「' + node.name + '」。');
}

function choosePlacement(problem, tags, ranked) {
  const suggested = ranked.slice(0, 6).map(result => result.node);
  const otherNodes = [...nodeById.values()].filter(node => !suggested.includes(node));
  const choices = [...suggested, ...otherNodes];
  showDialog(`<h3>为 ${problem.pid} 选择知识点</h3><p>洛谷的标签和题名不足以确定细分知识点。请选择题目所属的知识点。</p>
    <div class="dialog-input"><label for="placeNode">知识点</label><select id="placeNode">${choices.map(node =>
      `<option value="${node.id}">${treeByNode.get(node.id) === 'beginner' ? '入门' : '进阶'} · ${esc(node.name)}</option>`).join('')}</select></div>
    <div class="dialog-actions"><button data-close>取消</button><button class="primary" id="confirmPlace">添加</button></div>`);
  $('confirmPlace').onclick = () => {
    const chosen = nodeById.get($('placeNode').value);
    $('dialog').close();
    saveCustom(problem, chosen, tags);
  };
}

async function addProblem(event) {
  event.preventDefault();
  const input = $('addPid');
  const pid = input.value.trim().toUpperCase();
  if (!nativePid.test(pid)) {
    toast('请输入洛谷主题库或入门题号，例如 P1234 或 B2001。');
    input.focus();
    return;
  }
  const existing = [...builtIns.values(), ...state.custom].find(problem => problem.pid === pid);
  if (existing) {
    toast(pid + ' 已经在星图中。');
    return;
  }
  const button = $('addBtn');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = '查询中…';
  try {
    const problem = await api('problem/' + pid);
    if (problem.pid !== pid || !problem.title) throw new Error('洛谷没有返回有效题目信息。');
    const provenance = [problem.title, problem.source, ...(problem.tags || []).map(tag => tag.name)].join(' ');
    const externalSource = /USACO|AtCoder|Codeforces?|\b(?:SPOJ|UVa|POJ|HDU|ZOJ|Kattis|UOJ|BZOJ|LibreOJ|CodeChef|QOJ|HackerRank|LeetCode|DMOJ|SGU|Timus|TopCoder|HackerEarth)(?=\b|\d)/i;
    if (externalSource.test(provenance)) throw new Error('请选择洛谷本地题库中的练习。星图排除这些外站题源。');
    const tags = tagRows(problem);
    const ranked = matchingNodes(problem);
    if (!ranked.length || ranked[0].score < 6) choosePlacement(problem, tags, ranked);
    else saveCustom(problem, ranked[0].node, tags);
  } catch (error) {
    toast(error.name === 'TimeoutError' ? '查询洛谷超时，请重试。' : error.message);
  } finally {
    button.disabled = false;
    button.textContent = '添加';
  }
}

function bindLuoguControls() {
  $('accountBtn').onclick = () => openAccount();
  $('addForm').onsubmit = addProblem;
  if (!onlineMode) { $('addForm').hidden = true; $('addForm').style.display = 'none'; }
  $('dialog').addEventListener('close', () => showQueuedUnlocks());
  window.addEventListener('focus', () => maybeSync());
  setInterval(() => { if (!document.hidden) maybeSync(); }, 60 * 1000);
}
