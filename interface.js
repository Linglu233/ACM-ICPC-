'use strict';

function showDialog(content) {
  const dialog = $('dialog');
  $('dialogContent').innerHTML = content;
  if (!dialog.open) dialog.showModal();
  for (const button of dialog.querySelectorAll('[data-close]')) button.onclick = () => dialog.close();
}

function selectNode(id, { focus = false, acknowledge = false } = {}) {
  if (treeByNode.get(id) !== tree) return;
  if (selected !== id) $('detail').scrollTop = 0;
  selected = id;
  const pendingKeys = acknowledge ? pendingFor(id) : [];
  if (pendingKeys.length) {
    const pending = new Set(pendingKeys);
    const other = state.pending[id].filter(key => !pending.has(key));
    if (other.length) state.pending[id] = other;
    else delete state.pending[id];
    toast('已查看「' + nodeById.get(id).name + '」的 ' + pendingKeys.length + ' 道新题');
  }
  $('detail').classList.remove('mobile-hidden');
  persist();
  if (focus) setView('tree');
  else refresh();
  if (focus) focusNode(id, true);
}

function setView(nextView) {
  view = nextView;
  const mapVisible = view === 'tree';
  $('mapArea').hidden = !mapVisible;
  $('practice').classList.toggle('active', !mapVisible);
  for (const button of document.querySelectorAll('[data-view]')) {
    button.classList.toggle('active', button.dataset.view === view);
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  refresh();
}

function switchTree(nextTree) {
  if (!trees.includes(nextTree) || nextTree === tree) return;
  Object.assign(state.positions[tree], { selected, zoom });
  tree = nextTree;
  ({ selected, zoom } = state.positions[tree]);
  $('search').value = '';
  $('searchResults').hidden = true;
  $('detail').classList.toggle('mobile-hidden', innerWidth < 760);
  setupTree();
  setView('tree');
  openTreeViewport();
  persist();
}

function missingText(ids, buttons = false) {
  return ids.map(id => {
    const name = esc(nodeById.get(id).name);
    return buttons ? `<button data-goto="${id}">${name}</button>` : name;
  }).join('、');
}

function requirementButtons(ids) {
  return ids.map(id => {
    const complete = learned.has(id);
    return `<button class="chip ${complete ? 'done' : ''}" data-goto="${id}">${complete ? '✓ ' : ''}${esc(nodeById.get(id).name)}</button>`;
  }).join('');
}

function completionButton(pid) {
  const manual = isManuallyDone(pid);
  if (!manual && state.account?.problems[pid]?.status === 'passed') {
    return '<span class="remote-complete">✓ 洛谷已通过</span>';
  }
  return `<button type="button" class="completion-toggle ${manual ? 'mark-done' : ''}" data-done="${pid}" aria-pressed="${manual}">
    ${manual ? '撤销手动标记' : '标记完成'}</button>`;
}

function bindCompletionButtons(container) {
  for (const button of container.querySelectorAll('[data-done]')) {
    button.onclick = () => toggleDone(button.dataset.done);
  }
}

function problemCard(problem) {
  const open = unlocked(problem);
  const difficulty = difficultyById.get(problem.difficulty);
  const url = problemUrl(problem.pid);
  const syncText = progressText(problem.pid);
  const sourceUrl = /^https:\/\/www\.luogu\.com\.cn\/(?:(?:training|contest)\/\d+|training\/list\?type=[\w.-]+)$/.test(problem.sourceUrl || '') ? problem.sourceUrl : '';
  const source = problem.sourceLabel ? `<span class="quiet">${esc(problem.sourceLabel)}</span>` : '';
  const note = [esc(problem.note || ''), source].filter(Boolean).join(' · ');
  const scoreLookup = state.account?.problems[problem.pid]?.status === 'passed' && state.account.problems[problem.pid].score === null;
  return `<article class="problem-card ${open ? '' : 'locked'} ${problem.difficulty === 8 && open ? 'black-level' : ''}" style="--difficulty:${open ? difficulty.color : '#7b879a'}" data-problem="${problem.key}">
    <div class="problem-top"><span class="difficulty-dot"></span><a class="pid" href="${url}" target="_blank" rel="noopener">${problem.pid} ↗</a><span class="difficulty-tag">${esc(difficulty.name)}</span></div>
    <a class="problem-title" href="${url}" target="_blank" rel="noopener">${esc(problem.title)}</a>
    <p class="problem-note">${note}${sourceUrl ? ` <a href="${sourceUrl}" target="_blank" rel="noopener">查看出处 ↗</a>` : ''}</p>
    ${syncText ? `<div class="sync-line">${esc(syncText)}${scoreLookup ? ` <button class="text-button" data-score="${problem.pid}">核对分值</button>` : ''}</div>` : ''}
    <div class="problem-footer">${open ? '<span>✓ 知识条件已满足</span>' :
      `<span class="missing">待学 ${missingText(problem.requires.filter(id => !learned.has(id)), true)}</span>`}
      ${completionButton(problem.pid)}</div>
    </article>`;
}

function renderDetail() {
  const node = nodeById.get(selected);
  const category = categoryById.get(node.cat);
  const on = learned.has(node.id);
  const ready = canLearn(node.id);
  const remoteOnly = isAutoLearned(node.id) && !isManuallyLearned(node.id);
  const problems = problemsByNode.get(node.id);
  const available = problems.filter(problem => unlocked(problem)).length;
  const completed = new Set(problems.filter(problem => isDone(problem.pid)).map(problem => problem.pid)).size;
  $('detail').innerHTML = `<div class="detail-category"><span style="color:${category.color}">${esc(category.name)} · 第 ${node.layer + 1} 层</span>
    <span class="status-label ${on ? 'on' : ''}">${on ? '✓ 已点亮' : ready ? '可以学习' : '等待前置'}</span><button class="mobile-close" id="closeDetail" aria-label="关闭知识点详情">×</button></div>
    <h2>${esc(node.name)}</h2><p class="detail-desc">${esc(node.desc)}</p>
    <div class="section-label">前置知识</div>
    <div class="chips">${node.deps.length ? requirementButtons(node.deps) : '<span class="quiet">从这里开始。</span>'}</div>
    <div class="section-label">学习目标</div><ul class="goals">${node.goals.map(goal => `<li>${esc(goal)}</li>`).join('')}</ul>
    ${node.wiki ? `<a class="quiet" href="https://oi-wiki.org/${esc(node.wiki)}" target="_blank" rel="noopener">在 OI Wiki 学习这个专题 ↗</a>` : ''}
    <div class="learn-action"><button id="learnBtn" class="learn-btn ${on ? 'learned-btn' : ''}" ${remoteOnly || (!on && !ready) ? 'disabled' : ''}>${remoteOnly ? '✓ 洛谷通过率已达 70% · 已自动解锁' : on ? '✓ 已学习 · 撤销手动点亮' : ready ? '✦ 我已掌握，点亮知识点' : '请先点亮前置知识'}</button></div>
    <div class="section-label">洛谷练习 <span>${available}/${problems.length} 已解锁 · ${completed} 已完成</span></div>
    ${problems.length ? problems.map(problemCard).join('') : '<p class="quiet">此节点暂无练习。</p>'}`;
  $('learnBtn').onclick = () => on ? requestUndo(node.id) : learnNode(node.id);
  $('closeDetail').onclick = () => $('detail').classList.add('mobile-hidden');
  $('detail').querySelectorAll('[data-goto]').forEach(button => button.onclick = () => selectNode(button.dataset.goto, { focus: true }));
  bindCompletionButtons($('detail'));
  $('detail').querySelectorAll('[data-score]').forEach(button => button.onclick = () => verifyPassedScore(button.dataset.score, true));
  scheduleScoreLookups(problems);
}

function renderPractice() {
  const filter = $('practiceStatus').value;
  const category = $('practiceCategory').value;
  const difficulty = $('practiceDifficulty').value;
  const rows = [];
  for (const routes of exercisesByPid.values()) {
    const shown = category === 'all' ? routes : routes.filter(problem => nodeById.get(problem.node).cat === category);
    const problem = shown.find(route => unlocked(route)) || shown[0];
    if (!problem || (difficulty !== 'all' && problem.difficulty !== Number(difficulty))) continue;
    const ready = unlocked(problem);
    const complete = isDone(problem.pid);
    if (filter === 'ready' && (!ready || complete) || filter === 'locked' && ready || filter === 'done' && !complete) continue;
    rows.push(problem);
  }

  rows.sort(sortExercises);
  $('practiceCount').textContent = rows.length + ' 道题';
  $('practiceRows').innerHTML = rows.length ? rows.map(problem => {
    const ready = unlocked(problem);
    const node = nodeById.get(problem.node);
    const d = difficultyById.get(problem.difficulty);
    const recorded = progressText(problem.pid);
    const url = problemUrl(problem.pid);
    const status = isDone(problem.pid) ? '✓ 已完成' : ready ? '可练习' :
      '待学 ' + missingText(problem.requires.filter(id => !learned.has(id)));
    return `<div class="exercise-row ${ready ? '' : 'locked'}" style="--difficulty:${ready ? d.color : '#8796aa'}">
      <a class="pid" href="${url}" target="_blank" rel="noopener">${problem.pid} ↗</a>
      <div class="row-name"><a href="${url}" target="_blank" rel="noopener">${esc(problem.title)}</a><small>${status}${recorded ? ' · ' + esc(recorded) : ''}</small></div>
      <div class="row-category quiet">${esc(node.name)}</div><span class="row-difficulty" style="color:var(--difficulty)">${esc(d.name)}</span>
      <div class="row-actions">${completionButton(problem.pid)}<button data-route="${node.id}">查看路线</button></div></div>`;
  }).join('') : '<div class="empty">暂无符合条件的题目。试试切换筛选，或点亮更多知识点。</div>';
  $('practiceRows').querySelectorAll('[data-route]').forEach(button => button.onclick = () => selectNode(button.dataset.route, { focus: true }));
  bindCompletionButtons($('practiceRows'));
}

function renderStats() {
  const count = DATA.nodes.filter(node => learned.has(node.id)).length;
  const available = DATA.nodes.filter(node => canLearn(node.id)).length;
  const ready = [...exercisesByPid.values()].filter(routes => routes.some(problem => unlocked(problem))).length;
  $('progressText').textContent = count + ' / ' + DATA.nodes.length;
  $('progressBar').style.width = (100 * count / DATA.nodes.length) + '%';
  $('learnedCount').textContent = count;
  $('availableCount').textContent = available;
  $('problemCount').textContent = ready;
  const notices = DATA.nodes.filter(node => pendingFor(node.id).length);
  $('noticesBtn').hidden = !notices.length;
  $('noticesBtn').textContent = '✦ ' + notices.length + ' 个节点有新题';
}

function refresh() {
  if (view === 'tree') renderGraph();
  else renderPractice();
  renderDetail();
  renderStats();
  renderAccountButton();
  if (!$('searchResults').hidden) runSearch();
}

function setupTree() {
  rebuildIndexes();
  screen.clear();
  camera = { yaw: 0, pitch: 0 };
  setupWorld();
  $('detail').scrollTop = 0;
  $('treeChoice').value = tree;
  $('mapTitle').textContent = tree === 'beginner' ? '入门算法树' : 'ICPC 进阶算法树';
  $('mapDescription').textContent = tree === 'beginner'
    ? '从 C++ 的第一行代码开始，逐步学习编程语法和基础算法。'
    : '按知识类型分列，从上到下按建议顺序学习。';
  $('fitBtn').textContent = tree === 'beginner' ? '自动适应' : '查看全图';
  const palette = DATA.columns ? [...new Set(DATA.columns)].map(id => categoryById.get(id)) : DATA.categories;
  $('categoryPalette').innerHTML = palette.map(category =>
    `<span><i class="dot" style="background:${category.color};color:${category.color}"></i>${esc(category.name)}</span>`).join('');
  $('practiceCategory').replaceChildren(new Option('全部方向', 'all'),
    ...DATA.categories.map(category => new Option(category.name, category.id)));
}

function requestUndo(id) {
  const names = affectedByUndo(id).map(item => esc(nodeById.get(item).name)).join('、');
  showDialog(`<h3>撤销学习标记</h3><p>将撤销以下节点的手动学习标记。</p><p>${names}</p>
    <div class="dialog-actions"><button data-close>取消</button><button class="danger" id="confirmUndo">确认撤销</button></div>`);
  $('confirmUndo').onclick = () => { $('dialog').close(); undoNode(id); };
}

function exportProgress() {
  persist();
  const content = JSON.stringify({ ...state, exportedAt: new Date().toISOString(), app: 'ICPC 算法星图' }, null, 2);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  link.download = `ICPC星图进度-${new Date().toLocaleDateString('sv-SE')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  toast('进度备份已导出。');
}

function openBackup() {
  showDialog(`<h3>进度与备份</h3><p>两棵树共点亮 ${learned.size} 个知识点，手动完成 ${manualDoneCount()} 项练习。备份包含绑定状态、同步结果与手动加题。</p>
    <p>迁移旧进度时，在旧版导出 JSON，再在新版导入。导入会替换当前进度。</p>
    <div class="dialog-actions"><button id="exportBtn">导出进度</button><button id="importBtn">导入进度</button><button data-close>关闭</button></div>`);
  $('exportBtn').onclick = exportProgress;
  $('importBtn').onclick = () => $('importFile').click();
}

function restore(incoming) {
  invalidateSync();
  activateProgress(incoming);
  setupTree();
  setView('tree');
  openTreeViewport();
}

function runSearch() {
  const query = $('search').value.trim().toLowerCase();
  const box = $('searchResults');
  if (!query) {
    box.hidden = true;
    return;
  }
  const results = DATA.nodes.filter(node => node.name.toLowerCase().includes(query))
    .map(node => ({ id: node.id, name: node.name, caption: categoryById.get(node.cat).name }));
  for (const [pid, routes] of exercisesByPid) {
    const route = routes.find(problem => pid.toLowerCase().includes(query) || problem.title.toLowerCase().includes(query));
    if (route) results.push({ id: route.node, name: pid + ' · ' + route.title, caption: nodeById.get(route.node).name });
  }
  box.innerHTML = results.slice(0, 18).map(result => `<button data-result="${result.id}">${esc(result.name)}<small>${esc(result.caption)}</small></button>`).join('')
    || '<div class="empty">当前算法树中没有匹配结果。</div>';
  box.hidden = false;
  box.querySelectorAll('[data-result]').forEach(button => button.onclick = () => {
    box.hidden = true;
    selectNode(button.dataset.result, { focus: true });
  });
}

function start() {
  setupTree();
  bindGraphControls();
  $('treeChoice').onchange = event => switchTree(event.target.value);
  for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => setView(button.dataset.view);
  for (const id of ['practiceStatus', 'practiceCategory', 'practiceDifficulty']) $(id).onchange = renderPractice;
  $('practiceDifficulty').append(...[...difficultyById.values()].filter(d => d.id).map(d => new Option(d.name, d.id)));
  $('nextBtn').onclick = () => {
    const node = DATA.nodes.filter(node => canLearn(node.id)).sort((a, b) => a.layer - b.layer || a.order - b.order)[0];
    if (node) selectNode(node.id, { focus: true });
    else toast('当前没有可点亮的知识点。');
  };
  $('noticesBtn').onclick = () => {
    const node = DATA.nodes.find(node => pendingFor(node.id).length);
    if (node) selectNode(node.id, { focus: true });
  };
  $('backupBtn').onclick = openBackup;
  $('helpBtn').onclick = () => showDialog(`<h3>使用指南</h3><ol class="help-list">
    <li>所有知识点都可查看。未点亮的节点和名称用暗色显示。进阶树按知识类型分列，建议从上往下学习。</li>
    <li>点亮全部直接前置知识后，即可手动点亮已掌握的知识点。洛谷满分通过或手动标记的题目计入完成题数，手动记录按树保存。</li>
    <li>本地版绑定洛谷后，某个节点至少 70% 的题目已通过，就会自动点亮。静态网页版可手动记录学习和练习进度。</li>
    <li>拖动空白平移，Alt + 拖动旋转，Ctrl + 滚轮缩放。点击小地图可定位。</li>
    <li>绑定洛谷、同步公开练习和按题号加题需要 2.8 本地版启动器。网页版可直接打开内置练习的洛谷题目链接。</li>
    <li>从旧版迁移时，先导出旧进度，再通过新版“进度与备份”导入。</li></ol>
    <div class="dialog-actions"><button data-close>关闭</button></div>`);
  $('importFile').onchange = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 8e6) throw new Error('备份文件过大。');
      const incoming = normalize(JSON.parse(await file.text()));
      const completed = manualDoneCount(incoming);
      showDialog(`<h3>导入学习进度</h3><p>备份包含 ${incoming.learned.length} 个手动点亮的知识点和 ${completed} 项手动完成的练习。</p>
        <div class="dialog-actions"><button id="beforeImport">先导出当前进度</button><button data-close>取消</button><button id="confirmImport">替换并导入</button></div>`);
      $('beforeImport').onclick = exportProgress;
      $('confirmImport').onclick = () => {
        incoming.onboardingSeen ||= state.onboardingSeen;
        restore(incoming);
        persist();
        $('dialog').close();
        toast('学习进度已导入。');
        maybeSync(true);
      };
    } catch (error) {
      toast('导入失败 · ' + error.message);
    }
  };
  $('search').addEventListener('input', runSearch);
  $('search').addEventListener('keydown', event => {
    if (event.key === 'Escape') $('searchResults').hidden = true;
    if (event.key === 'Enter' && !$('searchResults').hidden) $('searchResults').querySelector('button')?.click();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.search-wrap')) $('searchResults').hidden = true;
  });
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE || !event.newValue) return;
    try {
      restore(normalize(JSON.parse(event.newValue)));
    } catch {
      toast('另一个窗口的进度无法读取。');
    }
  });
  bindLuoguControls();
  setView('tree');
  openTreeViewport();
  if (progressWarning) toast(progressWarning);
  if (innerWidth < 760) $('detail').classList.add('mobile-hidden');
  if (upgradingBoundAccount) showMigratedMastery();
  if (!state.onboardingSeen) openOnboarding();
  else maybeSync(true);
}

start();
