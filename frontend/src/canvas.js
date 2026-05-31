import { getState, subscribe, setState } from './store.js';
import { resolveColor, getNodeColor, getDynamicNodeColor } from './utils.js';

let scale = 1;
let offsetX = 0;
let offsetY = 0;
let animFrame = null;
let nodes = [];
let hoveredNode = null;
let selectedNodeId = null;

const NODE_W = 180;
const NODE_H = 48;
const NODE_R = 0;
const LEVEL_GAP = 110;
const EXPERT_GAP = 200;

// Badge colors (the ONLY colored elements)
const BADGE_COLORS = {
  distributor: '#2563eb',
  crosscheck: '#7c3aed',
  synthesizer: '#0d9488',
  verdict: '#d97706',
  report: '#2563eb',
  reanalyze: '#0d9488',
  default: '#2563eb',
};

const BADGE_ICONS = {
  distributor: 'D',
  crosscheck: 'C',
  synthesizer: 'S',
  verdict: 'V',
  report: 'R',
  reanalyze: 'R',
};

// Canvas state for interaction
let canvasEl = null;
let ctx = null;
let canvasW = 0;
let canvasH = 0;

export function buildGraphLayout(state) {
  const w = document.getElementById('main-canvas')?.width || 800;
  const h = document.getElementById('main-canvas')?.height || 600;
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
    const isStreaming = state.streamingNodes && state.streamingNodes[d] && state.streamingNodes[d].active;
    const isCached = state.cacheHits && state.cacheHits[d] === true;
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
      streaming: isStreaming,
      cached: isCached,
    });
  });

  const crossY = expertY + NODE_H + LEVEL_GAP;
  const crossStreaming = state.streamingNodes && state.streamingNodes['cross_check'] && state.streamingNodes['cross_check'].active;
  list.push({
    id: 'crosscheck',
    label: 'Cross-Check',
    type: 'crosscheck',
    x: cx - NODE_W / 2,
    y: crossY,
    streaming: crossStreaming,
  });

  const synthY = crossY + NODE_H + LEVEL_GAP;
  const synthStreaming = state.streamingNodes && state.streamingNodes['synthesizer'] && state.streamingNodes['synthesizer'].active;
  list.push({
    id: 'synthesizer',
    label: 'Synthesizer',
    type: 'synthesizer',
    x: cx - NODE_W / 2,
    y: synthY,
    streaming: synthStreaming,
  });

  // Add thinking steps as floating nodes
  if (state.thinkingSteps && state.thinkingSteps.length > 0) {
    const steps = state.thinkingSteps.slice(-3);
    steps.forEach((step, i) => {
      const nodeRef = list.find(n => n.type === step.node || n.shortLabel === step.node);
      if (nodeRef) {
        list.push({
          id: `thinking-${step.node}-${i}`,
          label: step.step || 'Reasoning',
          type: 'thinking',
          x: nodeRef.x + NODE_W + 20,
          y: nodeRef.y + i * 30,
          parentNode: step.node,
          content: step.content,
          isThinking: true,
        });
      }
    });
  }

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

function getNodeColors() {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    bg: isDark ? '#1a1a1a' : '#ffffff',
    border: isDark ? '#ffffff' : '#000000',
    dimBorder: isDark ? '#888888' : '#6b6b6b',
    text: isDark ? '#ffffff' : '#000000',
    dimText: isDark ? '#888888' : '#6b6b6b',
    connectionLine: isDark ? '#888888' : '#6b6b6b',
  };
}

export function renderCanvas(state) {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;
  canvasEl = canvas;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';

  ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  canvasW = rect.width;
  canvasH = rect.height;

  // Clear canvas
  ctx.clearRect(0, 0, canvasW, canvasH);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  buildGraphLayout(state);

  const active = getActiveNode(state);
  const { completed, expertComplete } = getCompleteStatus(state);

  drawConnections(ctx, canvasW, canvasH, state, active, completed, expertComplete);
  nodes.forEach(n => {
    if (n.isThinking) {
      drawThinkingNode(ctx, n);
      return;
    }
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
    const isSelected = selectedNodeId === n.id;
    drawNode(ctx, n, isActive, isComplete, isSelected);
  });

  ctx.restore();

  renderMinimap(state, canvasW, canvasH);
}

function drawNode(ctx, node, isActive, isComplete, isSelected) {
  const colors = getNodeColors();
  const badgeColor = BADGE_COLORS[node.type] || BADGE_COLORS.default;
  const badgeIcon = BADGE_ICONS[node.type] || node.type.charAt(0).toUpperCase();

  ctx.save();

  // Dim inactive nodes
  if (!isActive && !isComplete && !isSelected) {
    ctx.globalAlpha = 0.5;
  }

  // Card background
  ctx.fillStyle = colors.bg;
  ctx.fillRect(node.x, node.y, NODE_W, NODE_H);

  // Left border accent for active/selected
  if (isActive || isSelected) {
    ctx.fillStyle = badgeColor;
    ctx.fillRect(node.x, node.y, 3, NODE_H);
  }

  // Border
  ctx.strokeStyle = isActive || isSelected ? colors.border : colors.dimBorder;
  ctx.lineWidth = isActive || isSelected ? 1.5 : 1;
  ctx.strokeRect(node.x, node.y, NODE_W, NODE_H);

  // Draw colored badge (24x24 rounded square with icon)
  const badgeX = node.x + 10;
  const badgeY = node.y + (NODE_H - 24) / 2;
  ctx.fillStyle = badgeColor;
  roundRect(ctx, badgeX, badgeY, 24, 24, 4);
  ctx.fill();

  // Icon letter inside badge
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeIcon, badgeX + 12, badgeY + 12);

  // Label
  const labelX = badgeX + 24 + 10;
  const displayLabel = node.isExpert ? node.shortLabel || node.label : node.label;
  ctx.fillStyle = colors.text;
  ctx.font = '400 13px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(displayLabel, labelX, node.y + NODE_H / 2);
  ctx.font = '600 13px -apple-system, BlinkMacSystemFont, sans-serif';

  // Confidence indicator (small dot for experts)
  if (node.isExpert && node.complete && node.confidence) {
    const confColor = node.confidence === 'high' ? '#0d9488' :
      node.confidence === 'low' ? '#2563eb' : '#d97706';
    ctx.beginPath();
    ctx.arc(node.x + NODE_W - 14, node.y + NODE_H / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = confColor;
    ctx.fill();
  }

  // Cached badge
  if (node.cached) {
    ctx.fillStyle = colors.dimText;
    ctx.font = '400 9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('cached', node.x + NODE_W - 8, node.y + NODE_H - 4);
  }

  // Streaming indicator (pulsing dot)
  if (node.streaming) {
    const pulse = Math.sin(Date.now() / 300) * 0.5 + 0.5;
    ctx.beginPath();
    ctx.arc(node.x + NODE_W - 12, node.y + NODE_H / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${pulse * 0.6 + 0.4})`;
    ctx.fill();
  }

  ctx.restore();
}

function drawConnections(ctx, w, h, state, active, completed, expertComplete) {
  const colors = getNodeColors();
  const findNode = (id) => nodes.find(n => n.id === id || n.type === id);
  const dist = findNode('distributor');
  if (!dist) return;

  const domains = state.domains && state.domains.length > 0 ? state.domains : [];
  const expertY = dist.y + NODE_H + LEVEL_GAP;
  const expertCount = domains.length || 1;
  const cx = w / 2 / scale - offsetX / scale;

  const edges = [];

  // Distributor -> Experts (dashed lines)
  domains.forEach((d, i) => {
    const ex = cx + (i - (expertCount - 1) / 2) * EXPERT_GAP;
    const srcX = dist.x + NODE_W / 2;
    const srcY = dist.y + NODE_H;
    const tgtX = ex + NODE_W / 2;
    const tgtY = expertY;

    const isActiveLine = active === 'experts' || active === 'distributor';
    const isDone = expertComplete[d];
    edges.push({ x1: srcX, y1: srcY, x2: tgtX, y2: tgtY, active: isActiveLine, done: isDone });
    drawDashedLine(ctx, srcX, srcY, tgtX, tgtY, isActiveLine, isDone);
  });

  const cross = findNode('crosscheck');
  if (cross) {
    // Experts -> Cross-Check
    domains.forEach((d, i) => {
      const ex = cx + (i - (expertCount - 1) / 2) * EXPERT_GAP;
      const srcX = ex + NODE_W / 2;
      const srcY = expertY + NODE_H;
      const tgtX = cross.x + NODE_W / 2;
      const tgtY = cross.y;
      const isActiveLine = active === 'cross_check' || active === 'experts';
      const isDone = expertComplete[d] && completed.crosscheck;
      edges.push({ x1: srcX, y1: srcY, x2: tgtX, y2: tgtY, active: isActiveLine, done: isDone });
      drawDashedLine(ctx, srcX, srcY, tgtX, tgtY, isActiveLine, isDone);
    });

    const synth = findNode('synthesizer');
    if (synth) {
      const srcX = cross.x + NODE_W / 2;
      const srcY = cross.y + NODE_H;
      const tgtX = synth.x + NODE_W / 2;
      const tgtY = synth.y;
      const isActiveLine = active === 'synthesizer' || active === 'cross_check';
      const isDone = completed.crosscheck && completed.synthesizer;
      edges.push({ x1: srcX, y1: srcY, x2: tgtX, y2: tgtY, active: isActiveLine, done: isDone });
      drawDashedLine(ctx, srcX, srcY, tgtX, tgtY, isActiveLine, isDone);
    }
  }

  // Animated pulse dots on active edges
  const now = Date.now() / 1000;
  edges.forEach(edge => {
    if (!edge.active) return;
    const t = (now * 0.4) % 1;
    const px = edge.x1 + (edge.x2 - edge.x1) * t;
    const py = edge.y1 + (edge.y2 - edge.y1) * t;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();
  });

  // Cross-examination confidence arcs
  if (state.crossCheckResult && state.crossCheckResult.contradictions) {
    state.crossCheckResult.contradictions.forEach((contra, idx) => {
      if (contra.domains && contra.domains.length >= 2) {
        const n1 = findNode(`expert-${contra.domains[0]}`);
        const n2 = findNode(`expert-${contra.domains[1]}`);
        if (n1 && n2) {
          drawConfidenceArc(ctx, n1, n2, 'conflict', idx);
        }
      }
    });
  }
  if (state.crossCheckResult && state.crossCheckResult.agreements) {
    state.crossCheckResult.agreements.forEach((agree, idx) => {
      if (agree.domains && agree.domains.length >= 2) {
        const n1 = findNode(`expert-${agree.domains[0]}`);
        const n2 = findNode(`expert-${agree.domains[1]}`);
        if (n1 && n2) {
          drawConfidenceArc(ctx, n1, n2, 'agreement', idx);
        }
      }
    });
  }
}

function drawDashedLine(ctx, x1, y1, x2, y2, isActive, isDone) {
  const colors = getNodeColors();
  ctx.save();

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);

  if (isDone) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
  } else if (isActive) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
  } else {
    ctx.strokeStyle = colors.connectionLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawConfidenceArc(ctx, n1, n2, type, index) {
  const colors = getNodeColors();
  const x1 = n1.x + NODE_W / 2;
  const y1 = n1.y + NODE_H / 2;
  const x2 = n2.x + NODE_W / 2;
  const y2 = n2.y + NODE_H / 2;

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const arcHeight = type === 'conflict' ? -20 : 20;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx, my + arcHeight, x2, y2);

  const color = type === 'conflict' ? '#d97706' : '#0d9488';
  ctx.strokeStyle = color;
  ctx.lineWidth = type === 'conflict' ? 1.5 : 1;
  ctx.setLineDash(type === 'conflict' ? [] : [3, 3]);
  ctx.globalAlpha = 0.4;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = color;
  ctx.font = '400 9px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = type === 'conflict' ? '!' : '✓';
  ctx.fillText(label, mx, my + arcHeight + (type === 'conflict' ? -8 : 8));

  ctx.restore();
}

function renderMinimap(state, mainW, mainH) {
  const mCanvas = document.getElementById('minimap-canvas');
  if (!mCanvas) return;
  const colors = getNodeColors();
  const mw = 120;
  const mh = 80;
  mCanvas.width = mw * window.devicePixelRatio;
  mCanvas.height = mh * window.devicePixelRatio;
  mCanvas.style.width = mw + 'px';
  mCanvas.style.height = mh + 'px';
  const mCtx = mCanvas.getContext('2d');
  mCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

  mCtx.fillStyle = colors.bg;
  mCtx.fillRect(0, 0, mw, mh);

  const scaleX = mw / mainW;
  const scaleY = mh / mainH;
  const s = Math.min(scaleX, scaleY) * 0.5;

  mCtx.save();
  mCtx.translate(mw / 2, mh / 2);
  mCtx.scale(s, s);
  mCtx.translate(-mainW / 2, -mainH / 2);

  nodes.forEach(n => {
    if (n.isThinking) return;
    const badgeColor = BADGE_COLORS[n.type] || BADGE_COLORS.default;
    mCtx.fillStyle = badgeColor;
    mCtx.globalAlpha = 0.5;
    mCtx.fillRect(n.x, n.y, NODE_W, NODE_H);
    mCtx.globalAlpha = 1;
  });

  // Viewport indicator
  const vw = mainW / scale;
  const vh = mainH / scale;
  const vx = -offsetX / scale;
  const vy = -offsetY / scale;
  mCtx.strokeStyle = colors.text;
  mCtx.lineWidth = 0.5;
  mCtx.globalAlpha = 0.3;
  mCtx.strokeRect(vx, vy, vw, vh);

  mCtx.restore();
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

export function getScale() { return scale; }
export function getNodes() { return nodes; }

// ================================================================
// HIT TESTING — Find which node is at a given canvas coordinate
// ================================================================

function screenToCanvas(clientX, clientY) {
  const rect = canvasEl.getBoundingClientRect();
  const px = (clientX - rect.left) * (canvasW / rect.width);
  const py = (clientY - rect.top) * (canvasH / rect.height);
  return {
    x: (px - offsetX) / scale,
    y: (py - offsetY) / scale,
  };
}

function hitTestNodes(canvasX, canvasY) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (canvasX >= n.x && canvasX <= n.x + NODE_W &&
        canvasY >= n.y && canvasY <= n.y + NODE_H) {
      return n;
    }
  }
  return null;
}

export function initCanvas() {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;
  canvasEl = canvas;

  // Zoom with scroll wheel
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  }, { passive: false });

  // Pan with middle mouse or space+drag
  let isPanning = false;
  let startX, startY;
  let isSpaceDown = false;

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) {
      isSpaceDown = true;
      canvas.style.cursor = 'grab';
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      isSpaceDown = false;
      canvas.style.cursor = 'default';
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1 || isSpaceDown) {
      isPanning = true;
      startX = e.clientX - offsetX;
      startY = e.clientY - offsetY;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    } else if (e.button === 0) {
      const pt = screenToCanvas(e.clientX, e.clientY);
      const hit = hitTestNodes(pt.x, pt.y);
      if (hit) {
        selectedNodeId = hit.id;
        setState({ selectedNode: hit });
        showNodeTooltip(e.clientX, e.clientY, hit);
      } else {
        selectedNodeId = null;
        setState({ selectedNode: null });
        hideNodeTooltip();
        isPanning = true;
        startX = e.clientX - offsetX;
        startY = e.clientY - offsetY;
        canvas.style.cursor = 'grabbing';
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (isPanning) {
      offsetX = e.clientX - startX;
      offsetY = e.clientY - startY;
    } else {
      const pt = screenToCanvas(e.clientX, e.clientY);
      const hit = hitTestNodes(pt.x, pt.y);
      if (hit && hit !== hoveredNode) {
        hoveredNode = hit;
        canvas.style.cursor = 'pointer';
        showNodeTooltip(e.clientX, e.clientY, hit);
      } else if (!hit) {
        if (hoveredNode) {
          hoveredNode = null;
          canvas.style.cursor = 'default';
          hideNodeTooltip();
        }
      }
    }
  });

  canvas.addEventListener('mouseup', () => {
    isPanning = false;
    canvas.style.cursor = isSpaceDown ? 'grab' : 'default';
  });

  canvas.addEventListener('mouseleave', () => {
    isPanning = false;
    hoveredNode = null;
    canvas.style.cursor = 'default';
    hideNodeTooltip();
  });

  // Double-click to fit view
  canvas.addEventListener('dblclick', (e) => {
    const pt = screenToCanvas(e.clientX, e.clientY);
    const hit = hitTestNodes(pt.x, pt.y);
    if (hit) {
      scale = Math.min(scale * 1.5, 3);
      offsetX = e.clientX - (canvasW / 2) * scale;
      offsetY = e.clientY - (canvasH / 2) * scale;
    } else {
      fitView();
    }
  });
}

// ================================================================
// TOOLTIP
// ================================================================

let tooltipEl = null;

function showNodeTooltip(screenX, screenY, node) {
  if (!tooltipEl) {
    tooltipEl = document.getElementById('tooltip');
  }
  if (!tooltipEl) return;

  const state = getState();
  let content = '';

  if (node.isExpert) {
    const expert = state.experts.find(e => e.domain === node.type);
    content = `<strong>${node.shortLabel}</strong>`;
    if (expert) {
      content += `<br>Confidence: ${expert.confidence || 'medium'}`;
      if (expert.model_used) content += `<br>Model: ${expert.model_used}`;
      if (node.cached) content += `<br>⚡ From cache`;
    }
    if (node.streaming) {
      const streamingData = state.streamingNodes[node.type];
      if (streamingData && streamingData.tokens) {
        const preview = streamingData.tokens.slice(-60);
        content += `<br>▶ Streaming: ${escapeHtml(preview)}`;
      } else {
        content += `<br>▶ Generating...`;
      }
    }
  } else if (node.isThinking) {
    content = `<strong>${node.label}</strong>`;
    if (node.content) {
      content += `<br>${escapeHtml(node.content.slice(0, 80))}${node.content.length > 80 ? '...' : ''}`;
    }
  } else {
    content = `<strong>${node.label}</strong>`;
    if (node.streaming) {
      content += `<br>▶ Processing...`;
    }
    if (node.type === 'crosscheck' && state.crossCheckResult) {
      const deps = state.contradictions.length;
      const agrs = state.agreements.length;
      content += `<br>${deps} conflicts, ${agrs} agreements`;
    }
  }

  tooltipEl.innerHTML = content;
  tooltipEl.classList.remove('hidden');

  const rect = canvasEl.getBoundingClientRect();
  let tx = screenX - rect.left + 16;
  let ty = screenY - rect.top - 10;
  const tw = tooltipEl.offsetWidth || 160;
  const th = tooltipEl.offsetHeight || 60;
  if (tx + tw > rect.width) tx = screenX - rect.left - tw - 16;
  if (ty + th > rect.height) ty = rect.height - th - 4;
  if (ty < 4) ty = 4;
  tooltipEl.style.left = tx + 'px';
  tooltipEl.style.top = ty + 'px';
}

function hideNodeTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.getElementById('tooltip');
  }
  if (tooltipEl) {
    tooltipEl.classList.add('hidden');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// ================================================================
// THINKING NODE
// ================================================================

function drawThinkingNode(ctx, node) {
  const colors = getNodeColors();
  ctx.save();

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = colors.dimBorder;
  ctx.lineWidth = 1;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(node.x, node.y, NODE_W, NODE_H + 16);
  ctx.strokeRect(node.x, node.y, NODE_W, NODE_H + 16);
  ctx.setLineDash([]);

  ctx.fillStyle = colors.dimText;
  ctx.font = '400 10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  ctx.fillText('ⓘ', node.x + 10, node.y + (NODE_H + 16) / 2);

  ctx.fillStyle = colors.dimText;
  ctx.font = '400 10px -apple-system, BlinkMacSystemFont, sans-serif';
  const label = (node.label || 'Reasoning').substring(0, 20);
  ctx.fillText(label, node.x + 28, node.y + (NODE_H + 16) / 2);

  ctx.restore();
}

// ================================================================
// CASCADE TREE (for cascade_mapper mode)
// ================================================================

export function renderCascadeTree(state) {
  if (!state.modeOutput || state.analysisMode !== 'cascade_mapper') return;
  const levels = state.modeOutput.levels || {};
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;

  const colors = getNodeColors();
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';

  const ctx2 = canvas.getContext('2d');
  ctx2.scale(window.devicePixelRatio, window.devicePixelRatio);

  ctx2.clearRect(0, 0, rect.width, rect.height);

  ctx2.save();
  ctx2.translate(offsetX, offsetY);
  ctx2.scale(scale, scale);

  const cx2 = rect.width / 2;
  const levelLabels = ['Immediate', '2nd Order', '3rd Order', 'Unexpected', 'Irreversible'];
  const levelKeys = ['immediate', 'second_order', 'third_order', 'unexpected', 'irreversible'];

  levelKeys.forEach((key, levelIdx) => {
    const items = levels[key] || [];
    const y = 30 + levelIdx * 80;
    const count = Math.min(items.length, 5);

    items.slice(0, 5).forEach((item, i) => {
      const x2 = cx2 + (i - (count - 1) / 2) * 150;
      drawCascadeNode(ctx2, {
        x: x2 - 70,
        y: y,
        label: item.consequence || item.trigger || item.scenario || '',
      }, levelIdx, i);

      if (levelIdx < 4) {
        ctx2.beginPath();
        ctx2.moveTo(x2, y + 36);
        ctx2.lineTo(x2, y + 80);
        ctx2.strokeStyle = colors.connectionLine;
        ctx2.lineWidth = 0.5;
        ctx2.setLineDash([3, 3]);
        ctx2.stroke();
        ctx2.setLineDash([]);
      }
    });

    ctx2.fillStyle = colors.dimText;
    ctx2.font = '400 9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx2.textAlign = 'right';
    ctx2.textBaseline = 'middle';
    ctx2.fillText(levelLabels[levelIdx], 80, y + 18);
  });

  ctx2.restore();
  renderMinimap(state, rect.width, rect.height);
}

function drawCascadeNode(ctx, node, level, index) {
  const colors = ['#2563eb', '#7c3aed', '#0d9488', '#d97706', '#2563eb'];
  const color = colors[level] || colors[0];
  const tnW = 140;
  const tnH = 36;

  ctx.save();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(node.x, node.y, tnW, tnH);
  ctx.strokeRect(node.x, node.y, tnW, tnH);

  ctx.fillStyle = color;
  ctx.font = '10px sans-serif';
  ctx.fillText('○', node.x + 10, node.y + tnH / 2 + 4);

  ctx.fillStyle = colors.text;
  ctx.font = '400 10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const label = (node.label || '').substring(0, 18);
  ctx.fillText(label, node.x + 28, node.y + tnH / 2);

  ctx.restore();
}

// ================================================================
// CHAT PANEL (delegated to canvas module for overlay positioning)
// ================================================================

export function showChatPanel() {
  const panel = document.getElementById('chat-panel');
  if (panel) {
    panel.classList.remove('hidden');
    panel.classList.add('visible');
  }
}

export function hideChatPanel() {
  const panel = document.getElementById('chat-panel');
  if (panel) {
    panel.classList.remove('visible');
    panel.classList.add('hidden');
  }
}

export function clearChatPanel() {
  const messages = document.getElementById('chat-messages');
  if (messages) {
    messages.innerHTML = '';
  }
}
