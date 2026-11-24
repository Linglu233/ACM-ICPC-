'use strict';

const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const atlases = JSON.parse($('atlas-data').textContent);
const trees = Object.keys(atlases);
const nodeById = new Map();
const treeByNode = new Map();
const builtIns = new Map();
const builtInRoutesByPid = new Map();
for (const tree of trees) {
  for (const node of atlases[tree].nodes) {
    nodeById.set(node.id, node);
    treeByNode.set(node.id, tree);
  }
  for (const exercise of atlases[tree].exercises) {
    builtIns.set(exercise.key, exercise);
    if (!builtInRoutesByPid.has(exercise.pid)) builtInRoutesByPid.set(exercise.pid, []);
    builtInRoutesByPid.get(exercise.pid).push(exercise);
  }
}

const STORAGE = 'icpc-algorithm-atlas-v1';
const nativePid = /^(?:P|B)\d{4,6}$/;
const historicPid = /^[A-Z][A-Z0-9_]{1,32}$/i;
const uidPattern = /^[1-9]\d{0,9}$/;
const problemUrl = pid => 'https://www.luogu.com.cn/problem/' + encodeURIComponent(pid);
const difficultyById = new Map(atlases.beginner.difficulties.map(difficulty => [difficulty.id, difficulty]));
const defaultZoom = { beginner: .68, advanced: .57 };
const minimumZoom = { beginner: .10, advanced: .02 };
const empty = () => ({
  version: 3,
  learned: [],
  done: Object.fromEntries(trees.map(tree => [tree, []])),
  pending: {},
  custom: [],
  tree: 'beginner',
  positions: {},
  onboardingSeen: false,
  account: null
});

function cleanManualPids(input) {
  return [...new Set(input.filter(pid => typeof pid === 'string' && historicPid.test(pid))
    .map(pid => nativePid.test(pid.toUpperCase()) ? pid.toUpperCase() : pid))];
}

function manualDoneOwner(pid, result) {
  const routes = [...(builtInRoutesByPid.get(pid) || []), ...result.custom.filter(item => item.pid === pid)];
  const owners = new Set(routes.map(item => treeByNode.get(item.node)));
  const learned = new Set(result.learned);
  const learnedOwners = new Set(routes.filter(item => learned.has(item.node)).map(item => treeByNode.get(item.node)));
  if (learnedOwners.size === 1) return learnedOwners.values().next().value;
  if (owners.has(result.tree)) return result.tree;
  return owners.values().next().value || 'advanced';
}

function cleanRemoteProblems(input) {
  const problems = {};
  for (const [pid, record] of Object.entries(input || {})) {
    if (!nativePid.test(pid) || !record || !['passed', 'attempted'].includes(record.status)) continue;
    const score = typeof record.score === 'number' && Number.isFinite(record.score) && record.score >= 0
      ? record.score : null;
    problems[pid] = { status: record.status, score, fromFullScore: record.fromFullScore === true };
  }
  return problems;
}

function normalize(raw) {
  if (!raw || ![1, 2, 3].includes(raw.version) || !Array.isArray(raw.learned) ||
      (raw.version === 3 ? !trees.every(tree => Array.isArray(raw.done?.[tree])) : !Array.isArray(raw.done))) {
    throw new Error('这不是有效的星图进度备份。');
  }

  const result = empty();
  result.learned = [...new Set(raw.learned.filter(id => nodeById.has(id)))];
  if (raw.version >= 2 && trees.includes(raw.tree)) result.tree = raw.tree;
  for (const tree of trees) {
    const previous = raw.positions?.[tree] || (raw.version === 1 && tree === 'advanced' ? raw : {});
    result.positions[tree] = {
      selected: treeByNode.get(previous.selected) === tree ? previous.selected : atlases[tree].nodes[0].id,
      zoom: Number.isFinite(previous.zoom) ? Math.min(1.6, Math.max(minimumZoom[tree], previous.zoom)) : defaultZoom[tree],
      autoZoom: previous.autoZoom !== false
    };
  }

  const occupied = new Set([...builtIns.values()].map(problem => problem.pid));
  for (const item of Array.isArray(raw.custom) ? raw.custom : []) {
    if (!item || !nativePid.test(item.pid) || !nodeById.has(item.node) || occupied.has(item.pid)) continue;
    const difficulty = difficultyById.has(item.difficulty) ? item.difficulty : 0;
    result.custom.push({
      key: item.node + ':' + item.pid,
      node: item.node,
      pid: item.pid,
      title: String(item.title || item.pid).slice(0, 250),
      url: problemUrl(item.pid),
      tags: Array.isArray(item.tags) ? item.tags.filter(Number.isInteger).slice(0, 50) : [],
      difficulty,
      requires: [item.node],
      extra: [],
      rank: 100000 + result.custom.length,
      source: 'custom',
      fullScore: typeof item.fullScore === 'number' && Number.isFinite(item.fullScore) ? item.fullScore : null,
      note: String(item.note || '手动添加的洛谷练习。').slice(0, 400)
    });
    occupied.add(item.pid);
  }

  if (raw.version === 3) {
    for (const tree of trees) result.done[tree] = cleanManualPids(raw.done[tree]);
  } else if (raw.version === 1) {
    result.done.advanced = cleanManualPids(raw.done);
  } else {
    for (const pid of cleanManualPids(raw.done)) result.done[manualDoneOwner(pid, result)].push(pid);
  }

  const allRoutes = new Map([...builtIns, ...result.custom.map(item => [item.key, item])]);
  for (const node of nodeById.values()) {
    const keys = raw.pending?.[node.id];
    if (Array.isArray(keys)) {
      const valid = [...new Set(keys.filter(key => allRoutes.get(key)?.node === node.id))];
      if (valid.length) result.pending[node.id] = valid;
    }
  }

  result.onboardingSeen = raw.onboardingSeen === true;
  if (raw.account && uidPattern.test(raw.account.uid)) {
    result.account = {
      uid: String(raw.account.uid),
      name: String(raw.account.name || '').slice(0, 120),
      syncedAt: Number.isFinite(raw.account.syncedAt) ? raw.account.syncedAt : 0,
      problems: cleanRemoteProblems(raw.account.problems),
      warnings: Array.isArray(raw.account.warnings) ? raw.account.warnings.slice(0, 6).map(x => String(x).slice(0, 300)) : [],
      practiceComplete: raw.account.practiceComplete === true
    };
  }
  return result;
}

let state, tree, selected, zoom;
let manualLearned, autoLearned, learned, manualDone;
let progressWarning = '';
let upgradingBoundAccount = false;
let DATA, categoryById, problemsByNode, exercisesByPid;
let view = 'tree';
let toastTimer;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

function persist() {
  state.tree = tree;
  state.learned = [...manualLearned];
  state.done = Object.fromEntries(trees.map(tree => [tree, [...manualDone.get(tree)]]));
  state.positions[tree] = { selected, zoom, autoZoom: state.positions[tree].autoZoom !== false };
  try {
    localStorage.setItem(STORAGE, JSON.stringify(state));
    $('saveStatus').textContent = '✓ 已保存到本机';
  } catch {
    $('saveStatus').textContent = '保存失败 · 请导出进度';
  }
}

function isManuallyDone(pid, inTree = tree) {
  return manualDone.get(inTree)?.has(pid) === true;
}

function manualDoneCount(snapshot) {
  if (snapshot) return trees.reduce((total, tree) => total + snapshot.done[tree].length, 0);
  return trees.reduce((total, tree) => total + manualDone.get(tree).size, 0);
}

function isDone(pid, inTree = tree) {
  const assigned = builtInRoutesByPid.get(pid)?.some(item => treeByNode.get(item.node) === inTree) ||
    state.custom.some(item => item.pid === pid && treeByNode.get(item.node) === inTree);
  return !!assigned && (isManuallyDone(pid, inTree) || state.account?.problems[pid]?.status === 'passed');
}

function isManuallyLearned(id) {
  return manualLearned.has(id);
}

function isAutoLearned(id) {
  return autoLearned.has(id);
}

function ancestorSet(id, ancestors = new Set()) {
  if (ancestors.has(id)) return ancestors;
  ancestors.add(id);
  for (const dependency of nodeById.get(id).deps) ancestorSet(dependency, ancestors);
  return ancestors;
}

const ancestorsByNode = new Map([...nodeById.keys()].map(id => [id, ancestorSet(id)]));

function unlocked(problem, knowledge = learned) {
  if (!knowledge.has(problem.node)) return false;
  const ancestors = ancestorsByNode.get(problem.node);
  return problem.requires.every(id => ancestors.has(id) || knowledge.has(id));
}

const assignedPidsByNode = new Map([...nodeById.keys()].map(id => [id, new Set()]));
for (const problem of builtIns.values()) {
  assignedPidsByNode.get(problem.node).add(problem.pid);
}

function canLearn(id) {
  return !learned.has(id) && nodeById.get(id).deps.every(dependency => learned.has(dependency));
}

function accountMastery() {
  const mastery = new Set();
  if (!state.account) return mastery;
  const appended = new Map();
  for (const item of state.custom) {
    if (!appended.has(item.node)) appended.set(item.node, []);
    appended.get(item.node).push(item.pid);
  }
  const records = state.account.problems;
  for (const [id, assigned] of assignedPidsByNode) {
    const pids = appended.has(id) ? new Set([...assigned, ...appended.get(id)]) : assigned;
    let passed = 0;
    for (const pid of pids) if (records[pid]?.status === 'passed') passed++;
    if (pids.size && passed >= Math.ceil(pids.size * 7 / 10)) mastery.add(id);
  }
  return mastery;
}

function activateProgress(incoming) {
  state = incoming;
  tree = state.tree;
  ({ selected, zoom } = state.positions[tree]);
  manualLearned = new Set(state.learned);
  manualDone = new Map(trees.map(tree => [tree, new Set(state.done[tree])]));
  autoLearned = accountMastery();
  learned = new Set([...manualLearned, ...autoLearned]);
}

function notifyNewRoutes(before) {
  for (const problem of builtIns.values()) {
    if (before.has(problem.node) && !unlocked(problem, before) && unlocked(problem)) {
      state.pending[problem.node] = [...new Set([...(state.pending[problem.node] || []), problem.key])];
    }
  }
}

function applyRemoteAutoLearn() {
  const before = learned;
  autoLearned = accountMastery();
  learned = new Set([...manualLearned, ...autoLearned]);
  notifyNewRoutes(before);
  return [...autoLearned].filter(id => !before.has(id));
}

function pendingFor(id) {
  return (state.pending[id] || []).filter(key => {
    const problem = builtIns.get(key) || state.custom.find(item => item.key === key);
    return problem && (problem.source === 'custom' || unlocked(problem));
  });
}

function sortExercises(a, b) {
  return (a.difficulty || 9) - (b.difficulty || 9) || a.rank - b.rank;
}

function rebuildIndexes() {
  DATA = atlases[tree];
  categoryById = new Map(DATA.categories.map(category => [category.id, category]));
  problemsByNode = new Map(DATA.nodes.map(node => [node.id, []]));
  exercisesByPid = new Map();
  for (const problem of [...DATA.exercises, ...state.custom]) {
    if (!problemsByNode.has(problem.node)) continue;
    problemsByNode.get(problem.node).push(problem);
    if (!exercisesByPid.has(problem.pid)) exercisesByPid.set(problem.pid, []);
    exercisesByPid.get(problem.pid).push(problem);
  }
  for (const problems of problemsByNode.values()) problems.sort(sortExercises);
}

function progressText(pid) {
  const record = state.account?.problems[pid];
  if (record) {
    const status = record.status === 'passed' ? '已通过' : '已尝试';
    if (record.score === null) return '洛谷' + status + (record.status === 'passed' ? ' · 满分' : ' · 分数未公开');
    return '洛谷' + status + (record.fromFullScore ? ' · 题目满分 ' : ' · ') + record.score + ' 分';
  }
  if (state.account?.syncedAt) return state.account.practiceComplete ? '洛谷暂无提交记录' : '洛谷暂无可见记录';
  return '';
}

function toggleDone(pid) {
  if (!exercisesByPid.has(pid)) return;
  const records = manualDone.get(tree);
  if (records.has(pid)) records.delete(pid);
  else records.add(pid);
  persist();
  refresh();
}

function learnNode(id) {
  if (!canLearn(id)) return;
  const before = new Set(learned);
  manualLearned.add(id);
  learned.add(id);
  notifyNewRoutes(before);
  persist();
  refresh();
  toast('已点亮「' + nodeById.get(id).name + '」');
}

function affectedByUndo(id) {
  if (!manualLearned.has(id)) return [];
  if (autoLearned.has(id)) return [id];
  return [...manualLearned].filter(other => ancestorsByNode.get(other).has(id));
}

function undoNode(id) {
  for (const affected of affectedByUndo(id)) {
    manualLearned.delete(affected);
    if (!autoLearned.has(affected)) learned.delete(affected);
  }
  for (const key of Object.keys(state.pending)) {
    const remaining = pendingFor(key);
    if (remaining.length) state.pending[key] = remaining;
    else delete state.pending[key];
  }
  persist();
  refresh();
  toast('已撤销学习标记，做题记录仍保留。');
}

try {
  const saved = localStorage.getItem(STORAGE);
  const previous = saved ? JSON.parse(saved) : empty();
  activateProgress(normalize(previous));
  upgradingBoundAccount = previous.version === 2 && Boolean(state.account);
} catch {
  activateProgress(normalize(empty()));
  progressWarning = '读取本机进度失败。可以从旧备份恢复进度。';
}
