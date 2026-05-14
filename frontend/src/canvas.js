import { getState, subscribe } from './store.js';
import { resolveColor, getNodeColor, getDynamicNodeColor } from './utils.js';

let scale = 1;
let offsetX = 0;
let offsetY = 0;
let animFrame = null;
let nodes = [];

const NODE_W = 160;
const NODE_H = 48;
const NODE_R = 10;
const LEVEL_GAP = 110;
const EXPERT_GAP = 200;

export function buildGraphLayout(state) {
  const w = document.getElementById('main-canvas').width;
  const h = document.getElementById('main-canvas').height;
  const cx = w / 2;
  const list = [];

  list.push({ id: 'distributor', label: 'Distributor', type: 'distributor', x: cx - NODE_W / 2, y: 20 });

  const domains = state.domains && state.domains.length > 0 ? state.domains : [];
  const dynamicNodes = state.dynamicNodes && state.dynamicNodes.length > 0 ? state.dynamicNodes : [];
  const expertY = 20 + NODE_H + LEVEL_GAP;
  const expertCount = domains.length || 1;
  domains.forEach((d, i) => {
    const ex = cx + (i - (expertCount - 1) / 2) * EXPERT_GAP - NODE_W / 2;
    const expertData = state.experts.find(e => e.domain === d);
    const dynamicInfo = dynamicNodes.find(n => n.name === d);
    const color = getDynamicNodeColor(d, i);
    list.push({
      id: `expert-${d}`,
      label: dynamicInfo ? dynamicInfo.role : (d.charAt(0).toUpperCase() + d.slice(1)),
      shortLabel: d,
      type: d,
      color: color,
      x: ex,
      y: expertY,
      isExpert: true,
      complete: !!expertData,
      confidence: expertData ? expertData.confidence : null,
    });
  });

  const crossY = expertY + NODE_H + LEVEL_GAP;
  list.push({ id: 'crosscheck', label: 'Cross-Check', type: 'crosscheck', x: cx - NODE_W / 2, y: crossY });

  const synthY = crossY + NODE_H + LEVEL_GAP;
  list.push({ id: 'synthesizer', label: 'Synthesizer', type: 'synthesizer', x: cx - NODE_W / 2, y: synthY });

  nodes = list;
  return list;
}

function getActiveNode(state) {
  return state.activeNode;
}

function getCompleteStatus(state) {
  const completed = { distributor: false, crosscheck: false, synthesizer: false };
  if (state.distributor) completed.distributor = true;
  if (state.contradictions.length > 0 || state.agreements.length > 0 || state.cross_check) completed.crosscheck = true;
  if (state.synthesis) completed.synthesizer = true;
  const expertComplete = {};
  state.domains.forEach(d => {
    expertComplete[d] = !!state.experts.find(e => e.domain === d);
  });
  return { completed, expertComplete };
}

export function renderCanvas(state) {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  const w = rect.width;
  const h = rect.height;

  const bgColor = resolveColor('--bg-primary');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  buildGraphLayout(state);

  const active = getActiveNode(state);
  const { completed, expertComplete } = getCompleteStatus(state);

  drawConnections(ctx, w, h, state, active, completed, expertComplete);
  nodes.forEach(n => {
    const isActive =
      active === n.id ||
      (active === 'experts' && n.isExpert) ||
      (active === 'cross_check' && n.type === 'crosscheck') ||
      (active === 'synthesizer' && n.type === 'synthesizer') ||
      (active === 'distributor' && n.type === 'distributor');
    const isComplete =
      (n.type === 'distributor' && completed.distributor) ||
      (n.type === 'crosscheck' && completed.crosscheck) ||
      (n.type === 'synthesizer' && completed.synthesizer) ||
      (n.isExpert && expertComplete[n.type]);
    drawNode(ctx, n, isActive, isComplete);
  });

  ctx.restore();

  renderMinimap(state, rect.width, rect.height);
}

function drawNode(ctx, node, isActive, isComplete) {
  const color = node.color || resolveColor(getNodeColor(node.type));

  ctx.save();

  if (isActive) {
    const pulse = Math.sin(Date.now() / 300) * 0.15 + 0.15;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16 * pulse;
  }

  const bg = hexToRgba(color, isActive ? 0.15 : isComplete ? 0.1 : 0.04);
  ctx.fillStyle = bg;
  ctx.strokeStyle = color;
  ctx.lineWidth = isActive ? 2 : 1.5;
  ctx.globalAlpha = isComplete || isActive ? 1 : 0.6;
  roundRect(ctx, node.x, node.y, NODE_W, NODE_H, NODE_R);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;

  ctx.fillStyle = '#e2e4eb';
  ctx.font = '600 12px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const labelX = node.x + 14;
  const labelY = node.y + NODE_H / 2;

  const displayLabel = node.isExpert ? node.shortLabel || node.label : node.label;

  if (node.isExpert) {
    const dotR = 4;
    ctx.beginPath();
    ctx.arc(labelX, labelY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.font = '600 12px "DM Sans", sans-serif';
    ctx.fillStyle = '#e2e4eb';
    ctx.textAlign = 'left';
    ctx.fillText(displayLabel, labelX + 12, labelY);
  } else {
    ctx.fillText(displayLabel, labelX, labelY);
  }

  if (node.isExpert && node.complete && node.confidence) {
    const confColor = node.confidence === 'high' ? resolveColor('--success') :
      node.confidence === 'low' ? resolveColor('--danger') : resolveColor('--warning');
    ctx.beginPath();
    ctx.arc(labelX + 8, labelY + 14, 3, 0, Math.PI * 2);
    ctx.fillStyle = confColor;
    ctx.fill();
  }

  ctx.restore();
}

function drawConnections(ctx, w, h, state, active, completed, expertComplete) {
  const findNode = (id) => nodes.find(n => n.id === id || n.type === id);
  const dist = findNode('distributor');
  if (!dist) return;

  const domains = state.domains && state.domains.length > 0 ? state.domains : [];
  const expertY = dist.y + NODE_H + LEVEL_GAP;
  const expertCount = domains.length || 1;
  const cx = w / 2 / scale - offsetX / scale;

  domains.forEach((d, i) => {
    const ex = cx + (i - (expertCount - 1) / 2) * EXPERT_GAP;
    const srcX = dist.x + NODE_W / 2;
    const srcY = dist.y + NODE_H;
    const tgtX = ex + NODE_W / 2;
    const tgtY = expertY;

    const isActiveLine = active === 'experts' || active === 'distributor';
    const isDone = expertComplete[d];
    drawLine(ctx, srcX, srcY, tgtX, tgtY, isActiveLine, isDone);
  });

  const cross = findNode('crosscheck');
  if (cross) {
    domains.forEach((d, i) => {
      const ex = cx + (i - (expertCount - 1) / 2) * EXPERT_GAP;
      const srcX = ex + NODE_W / 2;
      const srcY = expertY + NODE_H;
      const tgtX = cross.x + NODE_W / 2;
      const tgtY = cross.y;
      const isActiveLine = active === 'cross_check';
      const isDone = expertComplete[d] && completed.crosscheck;
      drawLine(ctx, srcX, srcY, tgtX, tgtY, isActiveLine, isDone);
    });

    const synth = findNode('synthesizer');
    if (synth) {
      const srcX = cross.x + NODE_W / 2;
      const srcY = cross.y + NODE_H;
      const tgtX = synth.x + NODE_W / 2;
      const tgtY = synth.y;
      const isActiveLine = active === 'synthesizer' || active === 'cross_check';
      const isDone = completed.crosscheck && completed.synthesizer;
      drawLine(ctx, srcX, srcY, tgtX, tgtY, isActiveLine, isDone);
    }
  }
}

function drawLine(ctx, x1, y1, x2, y2, isActive, isDone) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = 'var(--border-strong)';
  ctx.lineWidth = 1;
  ctx.globalAlpha = isDone ? 0.9 : isActive ? 0.7 : 0.25;
  if (isActive && !isDone) {
    ctx.setLineDash([4, 4]);
  }
  ctx.stroke();
  ctx.restore();
}

function renderMinimap(state, mainW, mainH) {
  const mCanvas = document.getElementById('minimap-canvas');
  if (!mCanvas) return;
  const mw = 140;
  const mh = 90;
  mCanvas.width = mw * window.devicePixelRatio;
  mCanvas.height = mh * window.devicePixelRatio;
  mCanvas.style.width = mw + 'px';
  mCanvas.style.height = mh + 'px';
  const mCtx = mCanvas.getContext('2d');
  mCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const bg = resolveColor('--bg-secondary');
  mCtx.fillStyle = bg;
  mCtx.fillRect(0, 0, mw, mh);

  const scaleX = mw / mainW;
  const scaleY = mh / mainH;
  const s = Math.min(scaleX, scaleY) * 0.5;

  mCtx.save();
  mCtx.translate(mw / 2, mh / 2);
  mCtx.scale(s, s);
  mCtx.translate(-mainW / 2, -mainH / 2);

  nodes.forEach(n => {
    const color = n.color || resolveColor(getNodeColor(n.type));
    mCtx.fillStyle = hexToRgba(color, 0.5);
    mCtx.fillRect(n.x, n.y, NODE_W, NODE_H);
  });

  mCtx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function startAnimation() {
  function frame() {
    renderCanvas(getState());
    animFrame = requestAnimationFrame(frame);
  }
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = requestAnimationFrame(frame);
}

export function stopAnimation() {
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
}

export function zoomIn() {
  scale = Math.min(scale * 1.2, 3);
}

export function zoomOut() {
  scale = Math.max(scale / 1.2, 0.3);
}

export function fitView() {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
}

export function initCanvas() {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  }, { passive: false });

  let isPanning = false;
  let startX, startY;

  canvas.addEventListener('mousedown', (e) => {
    isPanning = true;
    startX = e.clientX - offsetX;
    startY = e.clientY - offsetY;
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    offsetX = e.clientX - startX;
    offsetY = e.clientY - startY;
  });

  canvas.addEventListener('mouseup', () => {
    isPanning = false;
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('mouseleave', () => {
    isPanning = false;
    canvas.style.cursor = 'default';
  });
}
