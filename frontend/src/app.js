import { getState, setState, subscribe, handleWsEvent } from './store.js';
import { connect, connectCaseStudy, disconnect, retryConnection, onEvent, onConnectionChange } from './api.js';
import { renderMarkdown, isTruncated, getNodeColor, getDynamicNodeColor, getNodeRole, getConfidenceClass, resolveColor, PRESET_TEMPLATES, NODE_COLORS_PRESET, truncateFilename, getFileTypeIcon, getFileTypeBadgeClass } from './utils.js';
import { initCanvas, startAnimation, zoomIn, zoomOut, fitView } from './canvas.js';

let currentSessionId = null;
let caseSessionId = null;

export function init() {
  initCanvas();
  startAnimation();

  onEvent(handleWsEvent);
  onConnectionChange((connectionInfo) => {
    handleWsEvent({ type: 'connection_change', ...connectionInfo });
  });

  document.getElementById('btn-analyze').addEventListener('click', () => {
    const s = getState();
    if (s.mode === 'case-study') startCaseAnalysis();
    else startAnalysis();
  });
  document.getElementById('question-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && getState().mode !== 'case-study') startAnalysis();
  });
  document.getElementById('case-question-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && getState().mode === 'case-study') startCaseAnalysis();
  });
  document.getElementById('btn-stop').addEventListener('click', stopAnalysis);
  document.getElementById('btn-retry').addEventListener('click', retryAnalysis);

  document.querySelectorAll('.right-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
  document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
  document.getElementById('btn-fit').addEventListener('click', fitView);
  document.getElementById('btn-rerun').addEventListener('click', rerunAnalysis);
  document.getElementById('btn-settings').addEventListener('click', () => {
    alert('Settings panel coming soon.');
  });
  document.getElementById('btn-presets').addEventListener('click', togglePresetsDropdown);
  document.getElementById('btn-add-case-node').addEventListener('click', addCaseNode);

  setupOutputsDelegation();

  subscribe('status', updateButtons);
  subscribe('status', updateModeBadge);
  subscribe('activeNode', updateModeBadge);
  subscribe('nodesLoading', updateModeBadge);
  subscribe('connectionStatus', (status) => {
    const indicator = document.getElementById('reconnect-indicator');
    const retryBtn = document.getElementById('btn-retry');
    const text = document.getElementById('reconnect-text');
    if (!indicator || !text) return;
    const s = getState();

    // Show retry button when connection is permanently lost
    if (status === 'disconnected' && s.status === 'failed' && s.error?.includes('Click Retry')) {
      indicator.classList.remove('hidden');
      indicator.classList.add('retry-state');
      text.textContent = 'Connection lost. Click Retry.';
      if (retryBtn) retryBtn.classList.remove('hidden');
      return;
    }
    if (retryBtn) retryBtn.classList.add('hidden');
    indicator.classList.remove('retry-state');

    if (status === 'reconnecting') {
      indicator.classList.remove('hidden');
      const attempt = s.reconnectAttempts || 0;
      const max = 5;
      text.textContent = attempt > 0
        ? `Reconnecting… (${attempt}/${max})`
        : 'Reconnecting…';
    } else if (status === 'connected' && s.isReconnecting) {
      indicator.classList.remove('hidden');
      text.textContent = 'Reconnected ✓';
      // Auto-hide after 2 seconds
      setTimeout(() => {
        const s2 = getState();
        if (s2.connectionStatus === 'connected') {
          document.getElementById('reconnect-indicator')?.classList.add('hidden');
        }
      }, 2000);
      setState({ isReconnecting: false });
    } else {
      indicator.classList.add('hidden');
    }
  });
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

  document.addEventListener('click', (e) => {
    const dd = document.getElementById('presets-dropdown');
    if (!e.target.closest('#presets-wrapper') && !dd.classList.contains('hidden')) {
      dd.classList.add('hidden');
    }
    document.querySelectorAll('.color-picker-popup').forEach(p => {
      if (!e.target.closest('.color-swatch-wrapper')) {
        p.classList.add('hidden');
      }
    });
  });

  document.getElementById('outputs-list').addEventListener('click', (e) => {
    const header = e.target.closest('[data-toggle]');
    if (header) {
      header.closest('.output-card, .case-output-card').classList.toggle('open');
    }
    const reasoningToggle = e.target.closest('[data-toggle-reasoning]');
    if (reasoningToggle) {
      const body = reasoningToggle.previousElementSibling;
      if (body) {
        body.classList.toggle('expanded');
        reasoningToggle.textContent = body.classList.contains('expanded') ? 'Hide reasoning \u25b2' : 'Show reasoning \u25bc';
      }
    }
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
  });

  currentSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  connect(situation, currentSessionId, 0);
}

function stopAnalysis() {
  disconnect();
  setState({ status: 'idle', activeNode: null, nodesLoading: false, caseStudy: { ...getState().caseStudy, analysisStatus: 'idle' } });
}

function retryAnalysis() {
  const s = getState();
  retryConnection();
  setState({ status: 'processing', error: null, connectionStatus: 'connecting' });
}

function rerunAnalysis() {
  const s = getState();
  if (s.mode === 'case-study') { startCaseAnalysis(); return; }
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
  const s = getState();
  setState({ mode });
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });
  document.getElementById('case-files-section').classList.toggle('hidden', mode !== 'case-study');
  document.getElementById('node-builder-section').classList.toggle('hidden', mode !== 'case-study');
  document.getElementById('question-input').classList.toggle('hidden', mode === 'case-study');
  document.getElementById('case-question-input').classList.toggle('hidden', mode !== 'case-study');
  const btnAnalyze = document.getElementById('btn-analyze');
  if (mode === 'case-study') {
    btnAnalyze.textContent = 'Analyze \u2192';
    updateCaseNodeList();
  } else {
    btnAnalyze.textContent = 'Analyze \u2192';
  }
  updateModeBadge();
  switchTab('verdict');
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

function updateButtons(status) {
  const isProcessing = status === 'processing';
  const btnAnalyze = document.getElementById('btn-analyze');
  btnAnalyze.classList.toggle('hidden', isProcessing);
  document.getElementById('btn-stop').classList.toggle('hidden', !isProcessing);
  btnAnalyze.disabled = isProcessing;
}

function updateModeBadge() {
  const s = getState();
  const badge = document.getElementById('mode-badge');
  if (!badge) return;
  const status = s.status;
  const activeNode = s.activeNode;
  const cs = s.caseStudy;

  if (s.nodesLoading) {
    badge.textContent = 'Assembling council\u2026';
    badge.className = 'mode-badge';
    return;
  }

  if (s.mode === 'case-study' && cs.analysisStatus !== 'idle') {
    const labels = {
      extracting: 'Extracting files\u2026',
      summarizing: 'Building context\u2026',
      analyzing: 'Analyzing\u2026',
      crosschecking: 'Cross-checking\u2026',
      synthesizing: 'Synthesizing\u2026',
      completed: 'Completed',
      error: 'Failed',
    };
    badge.textContent = labels[cs.analysisStatus] || 'Processing';
    badge.className = 'mode-badge';
    if (cs.analysisStatus === 'completed') badge.classList.add('case-study');
    else if (cs.analysisStatus === 'error') badge.style.color = 'var(--danger)';
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
    badge.textContent = 'Standard';
    badge.className = 'mode-badge';
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
  document.getElementById('condensed-banner').classList.add('hidden');
  document.getElementById('critical-findings-section').classList.add('hidden');
  document.getElementById('unresolved-section').classList.add('hidden');
  document.getElementById('case-recommendations-section').classList.add('hidden');

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
  }

  if (synthesis.criticalFindings && synthesis.criticalFindings.length > 0) {
    document.getElementById('critical-findings-section').classList.remove('hidden');
    document.getElementById('critical-findings-list').innerHTML = synthesis.criticalFindings.map(f =>
      '<div class="findings-item">' + f + '</div>'
    ).join('');
  }

  if (synthesis.unresolvedDisagreements && synthesis.unresolvedDisagreements.length > 0) {
    document.getElementById('unresolved-section').classList.remove('hidden');
    document.getElementById('unresolved-list').innerHTML = synthesis.unresolvedDisagreements.map(u =>
      '<div class="findings-item">' + u + '</div>'
    ).join('');
  }

  if (synthesis.recommendations && synthesis.recommendations.length > 0) {
    document.getElementById('case-recommendations-section').classList.remove('hidden');
    document.getElementById('case-recommendations-list').innerHTML = synthesis.recommendations.map((r, i) =>
      '<div class="numbered-item"><span class="numbered-item-num">' + (i + 1) + '.</span><span class="numbered-item-text">' + r + '</span></div>'
    ).join('');
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
    document.getElementById('crosscheck-section').classList.add('hidden');
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
  document.getElementById('crosscheck-section').classList.add('hidden');
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
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.pdf,.png,.jpg,.jpeg,.webp,.md,.txt,.docx,.csv';
  input.style.display = 'none';
  zone.parentElement.appendChild(input);

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFiles(Array.from(e.dataTransfer.files));
  });

  input.addEventListener('change', () => {
    handleFiles(Array.from(input.files));
    input.value = '';
  });
}

function handleFiles(files) {
  const s = getState();
  const existing = s.caseStudy.files || [];
  const newFiles = files.map(f => ({
    id: 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    name: f.name,
    type: f.name.split('.').pop().toLowerCase(),
    rawContent: '',
    status: 'extracting',
    fileObj: f,
  }));
  const updated = [...existing, ...newFiles];
  setState({ caseStudy: { ...s.caseStudy, files: updated } });
  renderFileChips();
  newFiles.forEach(file => extractFile(file, f => {
    const s2 = getState();
    const files2 = s2.caseStudy.files.map(f2 => f2.id === file.id ? { ...f2, ...f } : f2);
    setState({ caseStudy: { ...s2.caseStudy, files: files2 } });
    renderFileChips();
  }));
}

function renderFileChips() {
  const s = getState();
  const chips = document.getElementById('file-chips');
  const files = s.caseStudy.files || [];
  if (files.length === 0) { chips.innerHTML = ''; return; }
  chips.innerHTML = files.map(f => {
    const icon = getFileTypeIcon(f.type);
    const badgeClass = getFileTypeBadgeClass(f.type);
    const statusText = f.status === 'extracting' ? '<span class="file-chip-status extracting">\u23f3</span>'
      : f.status === 'ready' ? '<span class="file-chip-status ready">\u2713</span>'
      : '<span class="file-chip-status failed">\u2717</span>';
    return '<div class="file-chip" data-id="' + f.id + '">'
      + icon
      + '<span class="file-chip-name" title="' + f.name + '">' + truncateFilename(f.name, 22) + '</span>'
      + '<span class="file-chip-badge ' + badgeClass + '">' + f.type + '</span>'
      + statusText
      + '<button class="file-chip-remove" data-remove="' + f.id + '">\u00d7</button>'
      + '</div>';
  }).join('');

  chips.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.remove;
      const s2 = getState();
      const files2 = (s2.caseStudy.files || []).filter(f => f.id !== id);
      setState({ caseStudy: { ...s2.caseStudy, files: files2 } });
      renderFileChips();
    });
  });
}

async function extractFile(file, onUpdate) {
  try {
    let content = '';
    const ext = file.type.toLowerCase();
    if (ext === 'pdf') {
      content = await extractPDF(file.fileObj);
    } else if (ext === 'docx') {
      content = await extractDOCX(file.fileObj);
    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      content = await extractImage(file.fileObj);
    } else {
      content = await extractText(file.fileObj);
    }
    onUpdate({ rawContent: content, status: 'ready' });
  } catch (e) {
    console.warn('Extraction failed for', file.name, e);
    onUpdate({ rawContent: '', status: 'failed' });
  }
}

async function extractPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text.trim();
}

async function extractDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

async function extractImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      fetch('/api/case-study/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, base64, type: 'image' }),
      }).then(r => r.json()).then(data => resolve(data.rawContent || '')).catch(() => {
        resolve('[Image file: ' + file.name + ']');
      });
    };
    reader.onerror = () => resolve('[Image file: ' + file.name + ']');
    reader.readAsDataURL(file);
  });
}

async function extractText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function buildCaseContext() {
  const s = getState();
  const readyFiles = (s.caseStudy.files || []).filter(f => f.status === 'ready');
  if (readyFiles.length === 0) return '';
  let context = '=== CASE FILES ===\n\n';
  readyFiles.forEach(f => {
    context += '[File: ' + f.name + ']\n' + (f.rawContent || '') + '\n\n';
  });
  context += '=== END CASE FILES ===';
  return context;
}

function buildCaseNodeList() {
  const s = getState();
  const list = document.getElementById('case-node-list');
  const nodes = s.caseStudy.nodes || [];
  document.getElementById('case-node-count').textContent = nodes.length;

  if (nodes.length === 0) {
    list.innerHTML = '<div class="node-list-empty">Add at least 2 nodes</div>';
    return;
  }

  list.innerHTML = nodes.map((node, i) => {
    const color = resolveColor(NODE_COLORS_PRESET[node.colorIndex || 0]);
    const canDelete = nodes.length > 2;
    return '<div class="node-card' + (node.collapsed ? ' collapsed' : '') + '" data-index="' + i + '">'
      + '<div class="node-card-header">'
      + '<span class="node-drag-handle">\u283f</span>'
      + '<div class="color-swatch-wrapper">'
      + '<div class="color-swatch" style="background:' + color + '" data-swatch="' + i + '"></div>'
      + '<div class="color-picker-popup hidden" data-popup="' + i + '">'
      + NODE_COLORS_PRESET.map((c, ci) => '<div class="color-picker-option' + (ci === node.colorIndex ? ' selected' : '') + '" style="background:' + resolveColor(c) + '" data-ci="' + ci + '"></div>').join('')
      + '</div>'
      + '</div>'
      + '<input class="node-name-input" value="' + (node.name || '') + '" placeholder="Node name" data-field="name" data-index="' + i + '"/>'
      + '<div class="node-card-actions">'
      + '<button class="btn-node-action" data-toggle-node="' + i + '">' + (node.collapsed ? '\u25bc' : '\u25b2') + '</button>'
      + '<button class="btn-node-action" data-duplicate="' + i + '">\u2398</button>'
      + '<button class="btn-node-action danger" data-delete="' + i + '"' + (canDelete ? '' : ' disabled style="opacity:0.3"') + '>\u2715</button>'
      + '</div>'
      + '</div>'
      + '<div class="node-card-body">'
      + '<input class="node-role-input" value="' + (node.role || '') + '" placeholder="One line description of role" data-field="role" data-index="' + i + '"/>'
      + '<textarea class="node-behavior-input" placeholder="System prompt \u2014 describe how this node should reason, what to focus on, what to ignore\u2026" data-field="behavior" data-index="' + i + '">' + (node.behavior || '') + '</textarea>'
      + '</div>'
      + '</div>';
  }).join('');

  list.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('input', () => {
      const idx = parseInt(el.dataset.index);
      const field = el.dataset.field;
      const s2 = getState();
      const nodes2 = [...(s2.caseStudy.nodes || [])];
      nodes2[idx] = { ...nodes2[idx], [field]: el.value };
      setState({ caseStudy: { ...s2.caseStudy, nodes: nodes2 } });
      updateAnalyzeButton();
    });
  });

  list.querySelectorAll('[data-swatch]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const popup = el.parentElement.querySelector('.color-picker-popup');
      document.querySelectorAll('.color-picker-popup').forEach(p => { if (p !== popup) p.classList.add('hidden'); });
      popup.classList.toggle('hidden');
    });
  });

  list.querySelectorAll('.color-picker-option').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.closest('[data-popup]').dataset.popup);
      const ci = parseInt(el.dataset.ci);
      const s2 = getState();
      const nodes2 = [...(s2.caseStudy.nodes || [])];
      nodes2[idx] = { ...nodes2[idx], colorIndex: ci };
      setState({ caseStudy: { ...s2.caseStudy, nodes: nodes2 } });
      el.closest('.color-picker-popup').classList.add('hidden');
      buildCaseNodeList();
    });
  });

  list.querySelectorAll('[data-toggle-node]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.toggleNode);
      const s2 = getState();
      const nodes2 = [...(s2.caseStudy.nodes || [])];
      nodes2[idx] = { ...nodes2[idx], collapsed: !nodes2[idx].collapsed };
      setState({ caseStudy: { ...s2.caseStudy, nodes: nodes2 } });
      buildCaseNodeList();
    });
  });

  list.querySelectorAll('[data-duplicate]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.duplicate);
      const s2 = getState();
      const nodes2 = [...(s2.caseStudy.nodes || [])];
      const orig = nodes2[idx];
      if (nodes2.length >= 6) return;
      const dup = { ...orig, name: orig.name + ' (copy)', collapsed: false };
      nodes2.splice(idx + 1, 0, dup);
      setState({ caseStudy: { ...s2.caseStudy, nodes: nodes2 } });
      buildCaseNodeList();
      updateAnalyzeButton();
    });
  });

  list.querySelectorAll('[data-delete]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.delete);
      const s2 = getState();
      const nodes2 = [...(s2.caseStudy.nodes || [])];
      if (nodes2.length <= 2) return;
      nodes2.splice(idx, 1);
      setState({ caseStudy: { ...s2.caseStudy, nodes: nodes2 } });
      buildCaseNodeList();
      updateAnalyzeButton();
    });
  });
}

function updateCaseNodeList() {
  buildCaseNodeList();
  updateAnalyzeButton();
}

function addCaseNode() {
  const s = getState();
  const nodes = s.caseStudy.nodes || [];
  if (nodes.length >= 6) return;
  const newNode = {
    id: 'node-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    name: '',
    role: '',
    behavior: '',
    colorIndex: nodes.length % NODE_COLORS_PRESET.length,
    collapsed: false,
  };
  setState({ caseStudy: { ...s.caseStudy, nodes: [...nodes, newNode] } });
  buildCaseNodeList();
  updateAnalyzeButton();
}

function togglePresetsDropdown() {
  const dd = document.getElementById('presets-dropdown');
  dd.classList.toggle('hidden');
  if (dd.classList.contains('hidden')) return;
  dd.innerHTML = Object.keys(PRESET_TEMPLATES).map(key =>
    '<div class="preset-option" data-preset="' + key + '">' + key + '</div>'
  ).join('');
  dd.querySelectorAll('.preset-option').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.preset;
      const template = PRESET_TEMPLATES[key];
      if (!template) return;
      const nodes = template.map((t, i) => ({
        id: 'node-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + i,
        name: t.name,
        role: t.role,
        behavior: t.behavior,
        colorIndex: t.color !== undefined ? t.color % NODE_COLORS_PRESET.length : NODE_COLORS_PRESET.length % nodes.length,
        collapsed: false,
      }));
      const s = getState();
      setState({ caseStudy: { ...s.caseStudy, nodes } });
      dd.classList.add('hidden');
      buildCaseNodeList();
      updateAnalyzeButton();
    });
  });
}

function updateAnalyzeButton() {
  const s = getState();
  const btn = document.getElementById('btn-analyze');
  if (s.mode !== 'case-study') { btn.disabled = false; return; }
  const nodesOk = (s.caseStudy.nodes || []).length >= 2;
  const filesOk = (s.caseStudy.files || []).some(f => f.status === 'ready');
  btn.disabled = !(nodesOk && filesOk);
}

function startCaseAnalysis() {
  const s = getState();
  const readyFiles = (s.caseStudy.files || []).filter(f => f.status === 'ready');
  const nodes = s.caseStudy.nodes || [];
  if (nodes.length < 2) return;
  if (readyFiles.length === 0) return;

  const caseContext = buildCaseContext();
  const guidingQuestion = document.getElementById('case-question-input').value.trim();

  setState({
    status: 'processing',
    error: null,
    activeNode: null,
    caseStudy: {
      ...s.caseStudy,
      analysisStatus: 'analyzing',
      caseContext,
      contextCondensed: false,
      result: null,
    },
  });

  caseSessionId = 'case-session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const payload = {
    mode: 'case_study',
    nodes: nodes.map(n => ({
      name: n.name || 'Unnamed',
      role: n.role || '',
      behavior: n.behavior || 'You are an expert analyst. Analyze the case context thoroughly.',
    })),
    caseContext,
    guidingQuestion,
  };

  connectCaseStudy(payload, caseSessionId);
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
