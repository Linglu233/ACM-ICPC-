'use strict';

const pixelsPerCm = 96 / 2.54;
const gapCm = { beginner: { x: 8, y: 8 }, advanced: { x: 5.5, y: 4 } };
const sphereDiameter = 112;
const nodeWidth = 228;
const nodeHeight = 184;
const nodeCenterX = nodeWidth / 2;
const nodeCenterY = sphereDiameter / 2;
const topClearance = 54;
const bottomClearance = 78;
const columnHeaderHeight = 64;
const symbols = { basic: '</>', method: '⌘', ds: '◇', dp: 'Δ', graph: '⌁', string: 'Aa', math: 'π' };
const world = new Map();
const screen = new Map();
let graphWidth = 0;
let graphHeight = 0;
let worldCenterY = 0;
let screenOffsetX = 0;
let screenOffsetY = 0;
let stepX, stepY;
let camera = { yaw: 0, pitch: 0 };
let drag;

const edgeDefinitions = '<defs>' + [
  ['muted', '#7897b6'], ['incoming', '#6fbfff'], ['outgoing', '#ffc1ce']
].map(([kind, color]) => `<marker id="arrow-${kind}" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="none" stroke="${color}" stroke-width="1.2"/></marker>`).join('') + '</defs>';

function columnX(index, count) {
  return (index - (count - 1) / 2) * stepX;
}

function setupWorld() {
  world.clear();
  const gap = gapCm[tree];
  stepX = sphereDiameter + gap.x * pixelsPerCm;
  stepY = sphereDiameter + gap.y * pixelsPerCm;
  worldCenterY = (DATA.layers.length - 1) * stepY / 2;
  DATA.layers.forEach((row, layer) => {
    row.nodes.forEach((id, index) => {
      const col = nodeById.get(id).column;
      world.set(id, {
        x: DATA.columns ? columnX(col, DATA.columns.length) : columnX(index, row.nodes.length),
        y: layer * stepY,
        z: layer === 0 ? 0 : Math.sin(index + layer * .75) * 75
      });
    });
  });
}

function project(position) {
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  const x = position.x * cosYaw + position.z * sinYaw;
  const zBeforePitch = -position.x * sinYaw + position.z * cosYaw;
  const yCentered = position.y - worldCenterY;
  const y = yCentered * cosPitch - zBeforePitch * sinPitch;
  const z = yCentered * sinPitch + zBeforePitch * cosPitch;
  const scale = camera.yaw || camera.pitch ? 18000 / (18000 + z) : 1;
  return { x: x * scale, y: y * scale, z, scale };
}

function columnHeaderSpace() {
  return DATA.columns && !camera.yaw && !camera.pitch ? columnHeaderHeight : 0;
}

function measureGraph(mapNodes) {
  const projected = mapNodes.map(node => ({ id: node.id, ...project(world.get(node.id)) }));
  const minX = Math.min(...projected.map(point => point.x));
  const maxX = Math.max(...projected.map(point => point.x));
  const minY = Math.min(...projected.map(point => point.y));
  const maxY = Math.max(...projected.map(point => point.y));
  const viewport = $('viewport');
  const autoZoom = state.positions[tree].autoZoom !== false;
  const fullMap = autoZoom && tree === 'advanced';
  const headerSpace = columnHeaderSpace();
  if (autoZoom) {
    zoom = fullMap
      ? fitFullMapZoom(viewport, maxX - minX, maxY - minY, headerSpace)
      : fitOpeningZoom(viewport);
  }
  const headerGap = headerSpace / zoom;
  const spanY = maxY - minY + headerGap;
  const paddingX = Math.max(nodeCenterX + 16 / zoom, fullMap ? 0 : 112 / zoom, (viewport.clientWidth / zoom - (maxX - minX)) / 2);
  const topMargin = nodeCenterY + topClearance / zoom;
  const bottomMargin = nodeHeight - nodeCenterY + bottomClearance / zoom;
  const extraHeight = viewport.clientHeight / zoom - (spanY + topMargin + bottomMargin);
  const centerPadding = fullMap ? Math.max(0, extraHeight / 2) : 0;
  const paddingTop = topMargin + centerPadding;
  const paddingBottom = bottomMargin + centerPadding;
  screenOffsetX = paddingX - minX;
  screenOffsetY = paddingTop - minY;
  graphWidth = maxX - minX + 2 * paddingX;
  graphHeight = Math.max(spanY + paddingTop + paddingBottom, viewport.clientHeight / zoom);
  screen.clear();
  for (const point of projected) {
    screen.set(point.id, {
      x: point.x + screenOffsetX,
      y: point.y + screenOffsetY + (nodeById.get(point.id).layer > 0 ? headerGap : 0),
      scale: point.scale,
      z: point.z
    });
  }
  $('mapContent').style.width = graphWidth + 'px';
  $('mapContent').style.height = graphHeight + 'px';
  $('edges').setAttribute('width', graphWidth);
  $('edges').setAttribute('height', graphHeight);
}

function openingNodes() {
  return DATA.layers.slice(0, 3).flatMap(layer => layer.nodes);
}

function fitFullMapZoom(viewport, spanX, spanY, headerSpace) {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return zoom;
  const widthFit = (width - 32) / (spanX + nodeWidth);
  const heightFit = (height - topClearance - bottomClearance - headerSpace) / (spanY + nodeHeight);
  return Math.max(minimumZoom.advanced, Math.min(1, widthFit, heightFit));
}

function fitOpeningZoom(viewport) {
  const points = openingNodes().map(id => world.get(id));
  if (!points.length || !viewport.clientWidth || !viewport.clientHeight) return zoom;
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys) + nodeHeight;
  const width = viewport.clientWidth - 28;
  const orbFit = width / (spanX + nodeWidth);
  const packedLabelFit = (width + 14) / (spanX + stepX);
  const fullLabelFit = spanX > 0 ? (width - 196) / spanX : Infinity;
  const widthFit = Math.min(orbFit, Math.max(packedLabelFit, fullLabelFit));
  const controls = $('mapControls');
  const controlsBottom = Number.parseFloat(getComputedStyle(controls).bottom) || 0;
  const availableHeight = viewport.clientHeight - topClearance - controls.offsetHeight - controlsBottom - 22;
  const heightFit = availableHeight / height;
  return Math.max(.27, Math.min(1, widthFit, heightFit));
}

function branchPath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const sx = from.x + dx / length * 60 * from.scale;
  const sy = from.y + dy / length * 60 * from.scale;
  const tx = to.x - dx / length * 64 * to.scale;
  const ty = to.y - dy / length * 64 * to.scale;
  const bend = Math.max(50, (ty - sy) * .42);
  return `M${sx},${sy} C${sx},${sy + bend} ${tx},${ty - bend} ${tx},${ty}`;
}

function renderColumnGuides() {
  if (!columnHeaderSpace()) return { guides: '', labels: '' };
  const firstY = screen.get(DATA.layers[1].nodes[0]).y;
  const lastY = firstY + (DATA.layers.length - 2) * stepY;
  const groups = new Map();
  const guides = DATA.columns.map((id, column) => {
    const x = screenOffsetX + columnX(column, DATA.columns.length);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(x);
    return `<path class="column-guide" stroke="${categoryById.get(id).color}" stroke-width="${1 / zoom}" d="M${x},${firstY}V${lastY}"/>`;
  });
  const labels = [];
  const columnWidth = stepX * zoom;
  if (columnWidth >= 20) {
    const fontSize = Math.min(11, (columnWidth - 2) / 2);
    const baseline = firstY - nodeCenterY - 21 / zoom;
    for (const [id, xs] of groups) {
      const category = categoryById.get(id);
      const x = (xs[0] + xs[xs.length - 1]) / 2;
      const characters = Math.max(2, Math.floor((xs.length * columnWidth - 4) / fontSize));
      const lineCount = Math.ceil(category.name.length / characters);
      const lineWidth = Math.ceil(category.name.length / lineCount);
      const lines = category.name.match(new RegExp(`.{1,${lineWidth}}`, 'gu'));
      const text = lines.map((line, index) => {
        const y = baseline + (index - (lines.length - 1) / 2) * 14 / zoom;
        return `<tspan x="${x}" y="${y}">${esc(line)}</tspan>`;
      }).join('');
      labels.push(`<text class="column-label" fill="${category.color}" stroke-width="${3 / zoom}"
        font-size="${fontSize / zoom}" text-anchor="middle">${text}</text>`);
    }
  }
  return { guides: guides.join(''), labels: labels.join('') };
}

function renderGraph(keepPosition = true) {
  if (view !== 'tree') return;
  const viewport = $('viewport');
  const previous = screen.get(selected);
  const anchor = keepPosition && previous && {
    x: previous.x * zoom - viewport.scrollLeft,
    y: previous.y * zoom - viewport.scrollTop
  };
  const mapNodes = DATA.nodes;
  measureGraph(mapNodes);
  const links = [];
  const highlights = [];
  const minimap = [];
  for (const node of mapNodes) {
    for (const id of node.deps) {
      if (!screen.has(id)) continue;
      const from = screen.get(id);
      const to = screen.get(node.id);
      const focus = node.id === selected ? 'incoming' : id === selected ? 'outgoing' : '';
      const lit = learned.has(id) && learned.has(node.id) ? 'lit' : '';
      const path = branchPath(from, to);
      const line = `<path class="edge ${lit} ${focus || 'subdued'}" marker-end="url(#arrow-${focus || 'muted'})" d="${path}"/>`;
      if (focus) highlights.push(`<path class="branch-glow ${focus}" d="${path}"/>`, line);
      else links.push(line);
      minimap.push(`<path d="M${from.x},${from.y}L${to.x},${to.y}" stroke="${focus === 'incoming' ? '#4ba8ff' : focus ? '#ff9aae' : '#445c7b'}" stroke-width="9" fill="none"/>`);
    }
  }
  const { guides, labels } = renderColumnGuides();
  $('edges').innerHTML = edgeDefinitions + guides + links.join('') + highlights.join('') + labels;

  $('nodes').innerHTML = mapNodes.map(node => {
    const position = screen.get(node.id);
    const placement = `left:${position.x - nodeCenterX}px;top:${position.y - nodeCenterY}px;transform:scale(${position.scale});z-index:${Math.round(30000 - position.z)}`;
    const selection = selected === node.id ? 'selected' : '';
    const category = categoryById.get(node.cat);
    const on = learned.has(node.id);
    const ready = canLearn(node.id);
    const status = on ? '已点亮' : ready ? '可学习' : '等待前置';
    const pids = [...new Set(problemsByNode.get(node.id).map(problem => problem.pid))];
    const completed = pids.filter(pid => isDone(pid)).length;
    const pending = pendingFor(node.id).length;
    const symbol = symbols[node.cat.replace(/^intro-/, '')] || category.symbol || '✦';
    return `<button class="node ${on ? 'learned' : ready ? 'available dim' : 'dim'} ${selection} ${pending ? 'blink' : ''}"
      data-node="${node.id}" style="${placement};--node-color:${category.color}"
      title="${esc(node.name)} · ${completed}/${pids.length} 题已完成" aria-label="${esc(node.name)}，${status}${pending ? '，有新题' : ''}">
      <span class="orb-floor"></span><span class="node-top"><span class="node-core"><span class="orb-symbol">${esc(symbol)}</span><span class="node-mark">${on ? '✓' : ready ? '+' : '·'}</span></span><span class="node-name">${esc(node.name)}</span></span>
      <span class="node-bottom"><span>${status} · ${completed}/${pids.length} 题已完成</span>${pending ? `<span class="new-badge">＋${pending} 新题</span>` : ''}</span></button>`;
  }).join('');

  for (const nodeButton of $('nodes').querySelectorAll('[data-node]')) {
    nodeButton.onclick = () => selectNode(nodeButton.dataset.node, { acknowledge: true });
  }

  const center = screen.get(selected);
  const mini = $('minimap');
  mini.setAttribute('viewBox', `0 0 ${graphWidth} ${graphHeight}`);
  mini.innerHTML = minimap.join('') + mapNodes.map(node => {
    const point = screen.get(node.id);
    const color = categoryById.get(node.cat).color;
    const fill = pendingFor(node.id).length ? '#e5bb77' : learned.has(node.id) ? color :
      `color-mix(in srgb, ${color} 35%, #40556d)`;
    return `<circle cx="${point.x}" cy="${point.y}" r="${node.id === selected ? 54 : 35}" fill="${fill}"/>`;
  }).join('') + '<rect id="miniViewport" fill="#93c5ff15" stroke="#b7d6ff" stroke-width="12" rx="5"/>';
  applyZoom();
  if (anchor && center) {
    viewport.scrollLeft = center.x * zoom - anchor.x;
    viewport.scrollTop = center.y * zoom - anchor.y;
  }
  updateMiniViewport();
}

function updateMiniViewport() {
  const rect = $('miniViewport');
  if (!rect) return;
  const viewport = $('viewport');
  const logical = { x: viewport.scrollLeft, y: viewport.scrollTop, width: viewport.clientWidth, height: viewport.clientHeight };
  for (const [attribute, value] of Object.entries(logical)) rect.setAttribute(attribute, value / zoom);
}

function applyZoom() {
  const content = $('mapContent');
  content.style.transform = 'scale(' + zoom + ')';
  content.classList.toggle('compact-map', zoom < (tree === 'advanced' ? .49 : .42));
  const overview = zoom < (tree === 'advanced' ? .29 : .20);
  content.classList.toggle('overview-map', overview);
  const horizontalScale = Math.max(.48, Math.cos(camera.yaw));
  content.style.setProperty('--graph-label-width', Math.min(196, Math.max(16, stepX * zoom * horizontalScale - (overview ? 5 : 14))) + 'px');
  $('mapSpace').style.width = Math.ceil(graphWidth * zoom) + 'px';
  $('mapSpace').style.height = Math.ceil(graphHeight * zoom) + 'px';
  $('zoomLabel').textContent = Math.round(zoom * 100) + '%';
  for (const element of $('nodes').querySelectorAll('[data-node]')) {
    const inverse = 1 / (zoom * screen.get(element.dataset.node).scale);
    element.style.setProperty('--label-inverse', inverse);
    element.querySelector('.node-bottom').style.top = (124 + (element.querySelector('.node-name').offsetHeight + 7) * inverse) + 'px';
  }
}

function changeZoom(value, anchorX, anchorY) {
  const viewport = $('viewport');
  const old = zoom;
  const ax = anchorX ?? viewport.clientWidth / 2;
  const ay = anchorY ?? viewport.clientHeight / 2;
  const worldX = (viewport.scrollLeft + ax) / old - screenOffsetX;
  const anchorYInMap = viewport.scrollTop + ay;
  const headerSpace = columnHeaderSpace();
  let headerOffset = 0;
  if (headerSpace) {
    const firstY = (screenOffsetY - worldCenterY) * old;
    const fraction = (anchorYInMap - firstY) / (stepY * old + headerSpace);
    headerOffset = headerSpace * Math.max(0, Math.min(1, fraction));
  }
  const worldY = (anchorYInMap - headerOffset) / old - screenOffsetY;
  state.positions[tree].autoZoom = false;
  zoom = Math.max(minimumZoom[tree], Math.min(1.6, value));
  renderGraph(false);
  viewport.scrollLeft = (worldX + screenOffsetX) * zoom - ax;
  viewport.scrollTop = (worldY + screenOffsetY) * zoom + headerOffset - ay;
  if (graphWidth * zoom <= viewport.clientWidth + 1) viewport.scrollLeft = 0;
  updateMiniViewport();
  persist();
}

function openTreeViewport() {
  camera = { yaw: 0, pitch: 0 };
  screen.clear();
  renderGraph(false);
  focusNode(selected);
  if (openingNodes()[0] === selected) $('viewport').scrollTop = 0;
  updateMiniViewport();
}

function focusNode(id, smooth = false) {
  const point = screen.get(id);
  if (!point) return;
  const viewport = $('viewport');
  viewport.scrollTo({
    left: point.x * zoom - viewport.clientWidth / 2,
    top: point.y * zoom - viewport.clientHeight / 3,
    behavior: smooth ? 'smooth' : 'instant'
  });
}

function rotateView(delta) {
  camera.yaw = Math.max(-1.05, Math.min(1.05, camera.yaw + delta));
  renderGraph();
}

function bindGraphControls() {
  const viewport = $('viewport');
  $('zoomIn').onclick = () => changeZoom(zoom + Math.min(.1, zoom / 2));
  $('zoomOut').onclick = () => changeZoom(zoom - Math.min(.1, zoom / 3));
  $('fitBtn').onclick = () => {
    state.positions[tree].autoZoom = true;
    openTreeViewport();
    persist();
  };
  $('rotateLeft').onclick = () => rotateView(-.18);
  $('rotateRight').onclick = () => rotateView(.18);
  $('tiltView').onclick = () => {
    camera.pitch = camera.pitch > .12 ? -.12 : camera.pitch < 0 ? 0 : .21;
    renderGraph();
  };
  $('reset3D').onclick = () => {
    camera = { yaw: 0, pitch: 0 };
    renderGraph();
  };
  viewport.addEventListener('scroll', updateMiniViewport, { passive: true });
  viewport.addEventListener('wheel', event => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const frame = viewport.getBoundingClientRect();
    changeZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX - frame.left, event.clientY - frame.top);
  }, { passive: false });
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, rotate: event.altKey, ...camera };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.rotate) {
      camera.yaw = Math.max(-1.05, Math.min(1.05, drag.yaw + dx * .003));
      camera.pitch = Math.max(-.30, Math.min(.30, drag.pitch + dy * .0015));
      renderGraph();
    } else {
      viewport.scrollLeft = drag.left - dx;
      viewport.scrollTop = drag.top - dy;
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    viewport.addEventListener(type, () => {
      drag = null;
      viewport.classList.remove('dragging');
    });
  }
  $('minimap').onclick = event => {
    const transform = $('minimap').getScreenCTM();
    if (!transform) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    viewport.scrollTo({ left: point.x * zoom - viewport.clientWidth / 2, top: point.y * zoom - viewport.clientHeight / 2, behavior: 'smooth' });
  };
  window.addEventListener('resize', () => renderGraph());
}
