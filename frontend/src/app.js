import { getState, setState, subscribe, handleWsEvent } from './store.js';
import { connect, disconnect, onEvent } from './api.js';
import { renderMarkdown, isTruncated, getNodeColor, getDynamicNodeColor, getNodeRole, getConfidenceClass, resolveColor } from './utils.js';
import { initCanvas, startAnimation, zoomIn, zoomOut, fitView } from './canvas.js';

let currentSessionId = null;

export function init() {
  initCanvas();
  startAnimation();

  onEvent(handleWsEvent);

  document.getElementById('btn-analyze').addEventListener('click', startAnalysis);
  document.getElementById('question-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startAnalysis();
  });
  document.getElementById('btn-stop').addEventListener('click', stopAnalysis);
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });
  document.querySelectorAll('.right-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
  document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
  document.getElementById('btn-fit').addEventListener('click', fitView);
  document.getElementById('btn-add-node').addEventListener('click', openNodeSelector);
  document.getElementById('btn-rerun').addEventListener('click', rerunAnalysis);
  document.getElementById('btn-settings').addEventListener('click', () => {
    alert('Settings panel coming soon.');
  });

  setupFileDropZone();
  setupOutputsDelegation();

  subscribe('status', updateButtons);
  subscribe('status', updateModeBadge);
  subscribe('activeNode', updateModeBadge);
  subscribe('nodesLoading', updateModeBadge);
  subscribe('nodesLoading', (loading) => {
    if (loading) showAssemblingCouncil();
  });
  subscribe('dynamicNodes', () => {
    const s = getState();
    updateNodeList(s.dynamicNodes, s.experts);
  });
  subscribe('domains', () => {
    const s = getState();
    if (!s.nodesLoading) {
      updateNodeList(s.dynamicNodes, s.experts);
    }
  });
  subscribe('experts', () => {
    const s = getState();
    updateNodeList(s.dynamicNodes, s.experts);
    updateOutputs(s.experts, s.dynamicNodes);
  });
  subscribe('synthesis', () => updateVerdict(getState().synthesis));
  subscribe('consensusScore', (score) => updateConsensusMeter(score));
  subscribe('contradictions', () => {
    const s = getState();
    updateTradeoffs(s.contradictions);
    updateRecommendations(s.agreements);
  });
  subscribe('agreements', () => {
    const s = getState();
    updateRecommendations(s.agreements);
  });
}

function startAnalysis() {
  const input = document.getElementById('question-input');
  const situation = input.value.trim();
  if (!situation) return;
  if (getState().status === 'processing') return;

  setState({
    status: 'processing',
    situation,
    error: null,
    activeNode: null,
    dynamicNodes: [],
    nodesLoading: true,
    distributor: null,
    domains: [],
    experts: [],
    contradictions: [],
    agreements: [],
    consensusScore: 0.5,
    synthesis: null,
    files: [],
  });

  currentSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  connect(situation, currentSessionId, 0);
}

function stopAnalysis() {
  disconnect();
  setState({ status: 'idle', activeNode: null, nodesLoading: false });
}

function rerunAnalysis() {
  const s = getState();
  if (!s.situation) return;
  disconnect();
  setState({
    status: 'processing',
    error: null,
    activeNode: null,
    dynamicNodes: [],
    nodesLoading: true,
    distributor: null,
    domains: [],
    experts: [],
    contradictions: [],
    agreements: [],
    consensusScore: 0.5,
    synthesis: null,
  });
  currentSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  connect(s.situation, currentSessionId, 0);
}

function switchMode(mode) {
  setState({ mode });
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });
  document.getElementById('case-files-section').classList.toggle('hidden', mode !== 'case-study');
  updateModeBadge();
}

function switchTab(tab) {
  setState({ activeTab: tab });
  document.querySelectorAll('.right-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(t => {
    t.classList.toggle('active', t.id === 'tab-' + tab);
  });
}

function openNodeSelector() {
  alert('Node selector coming soon — add custom expert nodes for Case Study mode.');
}

function updateButtons(status) {
  const isProcessing = status === 'processing';
  document.getElementById('btn-analyze').classList.toggle('hidden', isProcessing);
  document.getElementById('btn-stop').classList.toggle('hidden', !isProcessing);
  document.getElementById('btn-analyze').disabled = isProcessing;
}

function updateModeBadge() {
  const s = getState();
  const badge = document.getElementById('mode-badge');
  const status = s.status;
  const activeNode = s.activeNode;

  if (s.nodesLoading) {
    badge.textContent = 'Assembling council\u2026';
    badge.className = 'mode-badge';
    return;
  }

  if (status === 'processing') {
    const labels = {
      distributor: 'Distributing',
      experts: 'Expert Analysis',
      cross_check: 'Cross-Checking',
      synthesizer: 'Synthesizing',
    };
    badge.textContent = labels[activeNode] || 'Processing';
    badge.className = 'mode-badge';
  } else if (status === 'completed') {
    badge.textContent = 'Completed';
    badge.className = 'mode-badge';
  } else if (status === 'failed') {
    badge.textContent = 'Failed';
    badge.className = 'mode-badge';
  } else {
    badge.textContent = s.mode === 'case-study' ? 'Case Study' : 'Standard';
    badge.className = 'mode-badge';
    if (s.mode === 'case-study') badge.classList.add('case-study');
  }
}

function showAssemblingCouncil() {
  const list = document.getElementById('node-list');
  list.innerHTML = '<div class="node-list-loading">'
    + '<span class="loading-dots">Assembling council</span>'
    + '</div>';
  document.getElementById('node-count').textContent = '0';
}

function updateNodeList(dynamicNodes, experts) {
  const list = document.getElementById('node-list');
  if (!dynamicNodes || dynamicNodes.length === 0) {
    const s = getState();
    if (s.nodesLoading) return;
    list.innerHTML = '<div class="node-list-empty">No nodes selected yet</div>';
    return;
  }
  const items = dynamicNodes.map((node, i) => {
    const expert = experts.find(e => e.domain === node.name);
    const color = resolveColor(getDynamicNodeColor(node.name, i));
    const confClass = expert ? getConfidenceClass(expert.confidence) : '';
    const stagger = 150 * i;
    return '<div class="node-item node-fade-in" style="animation-delay:' + stagger + 'ms" data-domain="' + node.name + '">'
      + '<div class="node-dot" style="background:' + color + '"></div>'
      + '<div class="node-info">'
      + '<div class="node-name">' + node.name + '</div>'
      + '<div class="node-role">' + node.role + '</div>'
      + '</div>'
      + (expert ? '<span class="conf-pill ' + confClass + '">' + expert.confidence + '</span>' : '')
      + '</div>';
  }).join('');
  list.innerHTML = items;
  document.getElementById('node-count').textContent = dynamicNodes.length;
}

function updateVerdict(synthesis) {
  const verdictContent = document.getElementById('verdict-content');
  const placeholder = document.getElementById('placeholder-idle');

  if (!synthesis) {
    verdictContent.classList.add('hidden');
    placeholder.classList.remove('hidden');
    return;
  }

  verdictContent.classList.remove('hidden');
  placeholder.classList.add('hidden');

  const verdictVal = document.getElementById('verdict-value');
  const score = synthesis.consensus_score ?? 0.5;
  if (score === 0.5) {
    verdictVal.textContent = 'Context-dependent \u2014 analysis inconclusive';
  } else {
    verdictVal.textContent = synthesis.verdict || '\u2014';
  }

  updateConsensusMeter(score);

  const badge = document.getElementById('confidence-badge');
  const level = synthesis.confidence || 'medium';
  badge.className = 'confidence-badge ' + getConfidenceClass(level);
  badge.textContent = level;

  const reasoningText = document.getElementById('reasoning-text');
  const raw = synthesis.reasoning || '';
  const html = renderMarkdown(raw);
  const truncated = isTruncated(raw);
  reasoningText.innerHTML = html;
  if (truncated) {
    reasoningText.innerHTML += '<span class="truncated-indicator">\u2026 response may be truncated</span>';
    reasoningText.innerHTML += '<button class="btn-expand" data-expand>See full output</button>';
  }
}

function updateConsensusMeter(score) {
  const pct = Math.round((score ?? 0.5) * 100);
  document.getElementById('consensus-fill').style.width = pct + '%';
  document.getElementById('consensus-pct').textContent = pct + '%';
}

function updateOutputs(experts, dynamicNodes) {
  const list = document.getElementById('outputs-list');
  if (!experts || experts.length === 0) {
    list.innerHTML = '<div class="node-list-empty">No outputs yet</div>';
    return;
  }
  const items = experts.map(expert => {
    const nodeIndex = (dynamicNodes || []).findIndex(n => n.name === expert.domain);
    const colorIdx = nodeIndex >= 0 ? nodeIndex : 0;
    const color = resolveColor(getDynamicNodeColor(expert.domain, colorIdx));
    const confClass = getConfidenceClass(expert.confidence);
    const raw = expert.analysis || '';
    const body = renderMarkdown(raw);
    const truncated = isTruncated(raw);
    let bodyHtml = body;
    if (truncated) {
      bodyHtml += '<span class="truncated-indicator">\u2026 response may be truncated</span>';
      bodyHtml += '<button class="btn-expand" data-expand>See full output</button>';
    }
    return '<div class="output-card" data-domain="' + expert.domain + '">'
      + '<div class="output-card-header" data-toggle>'
      + '<div class="node-dot" style="background:' + color + '"></div>'
      + '<span class="output-card-title">' + expert.domain + '</span>'
      + '<span class="conf-pill ' + confClass + '">' + expert.confidence + '</span>'
      + '<span class="output-card-toggle">\u276f</span>'
      + '</div>'
      + '<div class="output-card-body">' + bodyHtml + '</div>'
      + '</div>';
  }).join('');
  list.innerHTML = items;
}

function updateTradeoffs(contradictions) {
  const section = document.getElementById('tradeoffs-section');
  const list = document.getElementById('tradeoffs-list');

  if (!contradictions || contradictions.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  list.innerHTML = contradictions.map(c => {
    const sevColor = c.severity === 'high' ? 'var(--danger)'
      : c.severity === 'low' ? 'var(--success)' : 'var(--warning)';
    const label = c.between.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(' vs ');
    return '<div class="tradeoff-item">'
      + '<div class="tradeoff-dot" style="background:' + sevColor + '"></div>'
      + '<div>'
      + '<div class="tradeoff-label">' + label + '</div>'
      + '<div class="tradeoff-desc">' + (c.description || '') + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function updateRecommendations(agreements) {
  const section = document.getElementById('recommendations-section');
  const grid = document.getElementById('recommendations-grid');

  if (!agreements || agreements.length === 0) {
    section.classList.add('hidden');
    return;
  }
  const recs = [];
  agreements.forEach(a => {
    a.points.forEach(point => {
      recs.push({
        domain: a.between.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(' & '),
        text: point,
      });
    });
  });
  if (recs.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  grid.innerHTML = recs.map(r => '<div class="rec-card">'
    + '<div class="rec-card-label">' + r.domain + '</div>'
    + '<div class="rec-card-text">' + r.text + '</div>'
    + '</div>'
  ).join('');
}

function showError(message) {
  const verdictContent = document.getElementById('verdict-content');
  const placeholder = document.getElementById('placeholder-idle');
  verdictContent.classList.add('hidden');
  placeholder.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32" style="color:var(--danger)">'
    + '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
    + '</svg>'
    + '<span class="placeholder-text" style="color:var(--danger)">' + message + '</span>';
  placeholder.classList.remove('hidden');
}

function setupFileDropZone() {
  const zone = document.getElementById('drop-zone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    const chips = document.getElementById('file-chips');
    files.forEach(file => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      const ext = file.name.split('.').pop() || '';
      chip.innerHTML = '<svg class="file-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
        + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>'
        + '<polyline points="14 2 14 8 20 8"/>'
        + '</svg>'
        + file.name
        + '<span class="file-chip-type">' + ext.toUpperCase() + '</span>';
      chips.appendChild(chip);
    });
  });
}

function setupOutputsDelegation() {
  document.getElementById('outputs-list').addEventListener('click', (e) => {
    const header = e.target.closest('[data-toggle]');
    if (header) {
      header.parentElement.classList.toggle('open');
    }
    const expand = e.target.closest('[data-expand]');
    if (expand) {
      const body = expand.closest('.output-card-body, .reasoning-text, .verdict-content');
      if (body) {
        body.style.maxHeight = 'none';
        expand.remove();
      }
    }
  });
  document.getElementById('tab-verdict').addEventListener('click', (e) => {
    const expand = e.target.closest('[data-expand]');
    if (expand) {
      const parent = expand.closest('.reasoning-text, .verdict-content, div');
      if (parent) {
        parent.style.maxHeight = 'none';
        expand.remove();
      }
    }
  });
}
