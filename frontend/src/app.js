import { getState, setState, subscribe, handleWsEvent } from './store.js';
import { connect, connectCaseStudy, retryConnection, onEvent, onConnectionChange, connectWithOptions, sendChatMessage, sendStressTest } from './api.js';
import { renderMarkdown, isTruncated, getNodeColor, getDynamicNodeColor, getNodeRole, getConfidenceClass, resolveColor, PRESET_TEMPLATES, NODE_COLORS_PRESET, truncateFilename, getFileTypeIcon, getFileTypeBadgeClass } from './utils.js';
import { initCanvas, startAnimation, zoomIn, zoomOut, fitView } from './canvas.js';
import { initChat, showChat, hideChat, toggleChat, addChatMessage, addStreamingMessage, clearChat, handleChatEvent } from './chat.js';

let currentSessionId = null;
let caseSessionId = null;

export function init() {
  initCanvas();
  startAnimation();

  onEvent(handleWsEvent);
  onConnectionChange((connectionInfo) => {
    handleWsEvent({ type: 'connection_change', ...connectionInfo });
  });

  // Also forward chat events to the chat module
  onEvent((event) => {
    if (event.type && event.type.startsWith('chat_')) {
      handleChatEvent(event);
    }
  });

  // ---- Main button handlers ----
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

  // ---- Tab & Canvas controls ----
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
  document.getElementById('btn-presets')?.addEventListener('click', togglePresetsDropdown);
  document.getElementById('btn-add-case-node')?.addEventListener('click', addCaseNode);

  // ---- Stress test button ----
  document.getElementById('btn-stress-test')?.addEventListener('click', () => {
    const s = getState();
    if (s.synthesis && s.situation) {
      sendStressTest(
        s.situation,
        s.synthesis.verdict || '',
        s.synthesis.reasoning || ''
      );
    }
  });

  // ---- Ghost Mode selector ----
  document.querySelectorAll('.ghost-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const level = opt.dataset.level;
      if (!level) return;
      document.querySelectorAll('.ghost-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      setState({ ghostLevel: level });
      updateGhostUI(level);
    });
  });

  // ---- Analysis Mode selector ----
  document.querySelectorAll('.mode-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const mode = opt.dataset.mode;
      if (!mode) return;
      document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      setState({ analysisMode: mode });
      document.getElementById('mode-badge-static').textContent = opt.querySelector('.mode-option-label')?.textContent || mode;
    });
  });

  // ---- Onboarding ----
  document.getElementById('onboarding-next')?.addEventListener('click', advanceOnboarding);
  document.getElementById('onboarding-back')?.addEventListener('click', goBackOnboarding);
  document.getElementById('onboarding-skip')?.addEventListener('click', closeOnboarding);
  document.querySelectorAll('.onboarding-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.onboarding-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      setState({ onboardingMode: card.dataset.mode });
    });
  });
  document.querySelectorAll('.onboarding-template-card').forEach(card => {
    card.addEventListener('click', () => {
      const template = card.dataset.template;
      populateFromTemplate(template);
      closeOnboarding();
    });
  });

  // ---- Redaction modal ----
  document.getElementById('btn-view-redactions')?.addEventListener('click', () => {
    document.getElementById('redaction-modal').classList.remove('hidden');
  });
  document.getElementById('redaction-modal-close')?.addEventListener('click', () => {
    document.getElementById('redaction-modal').classList.add('hidden');
  });
  document.getElementById('redaction-auto-redact')?.addEventListener('click', () => {
    document.getElementById('redaction-modal').classList.add('hidden');
  });

  // ---- Assumption modal ----
  document.getElementById('assumption-modal-close')?.addEventListener('click', () => {
    document.getElementById('assumption-modal').classList.add('hidden');
  });
  document.getElementById('assumption-confirm-all')?.addEventListener('click', () => {
    const s = getState();
    setState({ assumptions: s.assumptions.map(a => ({ ...a, status: 'confirmed' })) });
    document.getElementById('assumption-modal').classList.add('hidden');
  });
  document.getElementById('assumption-proceed')?.addEventListener('click', () => {
    document.getElementById('assumption-modal').classList.add('hidden');
  });

  // ---- Chat panel event listener ----
  document.addEventListener('chat-message', (e) => {
    const { text } = e.detail;
    const s = getState();
    sendChatMessage(text, {
      verdict: s.synthesis?.verdict || '',
      reasoning: s.synthesis?.reasoning || '',
      experts: s.experts,
      contradictions: s.contradictions,
      analysisMode: s.analysisMode,
    });
  });

  // ---- Close modals on overlay click ----
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    });
  });

  setupOutputsDelegation();

  // ---- Subscriptions ----
  subscribe('status', updateButtons);
  subscribe('status', updateModeBadge);
  subscribe('status', (status) => {
    // Show chat panel after analysis completes
    if (status === 'completed') {
      setTimeout(showChat, 500);
    }
    if (status === 'idle' || status === 'processing') {
      hideChat();
      clearChat();
    }
  });
  subscribe('status', updateStressTestButton);
  subscribe('activeNode', updateModeBadge);
  subscribe('nodesLoading', updateModeBadge);
  subscribe('connectionStatus', handleConnectionStatus);
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
  subscribe('assumptions', () => updateAssumptionsList(getState().assumptions));
  subscribe('piiRedactions', () => updatePiiBanner(getState().piiRedactions));
  subscribe('ghostLevel', updateGhostUI);
  subscribe('ghostDisclosure', (disclosure) => {
    const el = document.getElementById('privacy-disclosure-text');
    if (el && disclosure) {
      el.textContent = disclosure;
      document.getElementById('privacy-disclosure').classList.remove('hidden');
    }
  });
  subscribe('situationDna', () => updateDna(getState().situationDna));
  subscribe('modeOutput', () => updateModeOutput(getState()));
  subscribe('thinkingSteps', () => updateThinkingSteps(getState().thinkingSteps));

  // ---- Click outside handlers ----
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
        reasoningToggle.textContent = body.classList.contains('expanded') ? 'Hide reasoning ▲' : 'Show reasoning ▼';
      }
    }
  });

  // Init chat
  initChat();

  // Check onboarding
  checkOnboarding();
}

function startAnalysis() {
  const input = document.getElementById('question-input');
  const situation = input.value.trim();
  if (!situation) return;
  if (getState().status === 'processing') return;

  const s = getState();

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
    modeOutput: null,
    assumptions: [],
    thinkingSteps: [],
  });

  currentSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  connectWithOptions(situation, currentSessionId, 0, {
    analysisMode: s.analysisMode || 'standard',
    ghostLevel: s.ghostLevel || 'off',
  });
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
    modeOutput: null,
    assumptions: [],
    thinkingSteps: [],
  });
  currentSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  connectWithOptions(s.situation, currentSessionId, 0, {
    analysisMode: s.analysisMode || 'standard',
    ghostLevel: s.ghostLevel || 'off',
  });
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
    btnAnalyze.textContent = 'Analyze →';
    updateCaseNodeList();
  } else {
    btnAnalyze.textContent = 'Analyze →';
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
  const analysisMode = s.analysisMode || 'standard';

  if (s.nodesLoading) {
    badge.textContent = 'Assembling council...';
    badge.className = 'mode-badge';
    return;
  }

  // Show analysis mode for non-standard modes
  const modeLabels = {
    signal_vs_noise: 'Signal vs Noise',
    cascade_mapper: 'Cascade Mapper',
    pre_mortem: 'Pre-Mortem',
    debate: 'Debate',
    reverse_engineer: 'Reverse Engineer',
    iceberg: 'Iceberg Report',
  };
  const modeLabel = modeLabels[analysisMode];

  if (s.mode === 'case-study' && cs.analysisStatus !== 'idle') {
    const labels = {
      extracting: 'Extracting files...',
      summarizing: 'Building context...',
      analyzing: 'Analyzing...',
      crosschecking: 'Cross-checking...',
      synthesizing: 'Synthesizing...',
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
      signal_vs_noise: 'Extracting Signal...',
      cascade_mapper: 'Mapping Cascades...',
      pre_mortem: 'Pre-Mortem Analysis...',
      debate: 'Debating...',
      reverse_engineer: 'Reverse Engineering...',
      iceberg: 'Mapping Iceberg...',
    };
    badge.textContent = labels[activeNode] || labels[analysisMode] || 'Processing';
    badge.className = 'mode-badge';
  } else if (status === 'completed') {
    badge.textContent = modeLabel || 'Completed';
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
    verdictVal.textContent = 'Context-dependent — analysis inconclusive';
  } else {
    verdictVal.textContent = synthesis.verdict || '—';
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
    reasoningText.innerHTML += '<span class="truncated-indicator">... response may be truncated</span>';
  }

  // === INTELLIGENCE LAYER ===

  // Confidence Breakdown
  const cbSection = document.getElementById('confidence-breakdown-section');
  const cbList = document.getElementById('confidence-breakdown-list');
  if (synthesis.confidence_breakdown) {
    cbSection.classList.remove('hidden');
    const fields = ['information_quality', 'expert_agreement', 'assumption_risk', 'precedent_match', 'overall'];
    cbList.innerHTML = fields.map(f => {
      const val = synthesis.confidence_breakdown[f] || 0;
      const pct = Math.round(val * 100);
      const cls = val >= 0.67 ? 'high' : val >= 0.34 ? 'medium' : 'low';
      return '<div class="confidence-item">'
        + '<span class="confidence-item-label">' + f.replace(/_/g, ' ') + '</span>'
        + '<div class="confidence-item-track">'
        + '<div class="confidence-item-fill ' + cls + '" style="width:' + pct + '%"></div>'
        + '</div>'
        + '<span class="confidence-item-value">' + pct + '%</span>'
        + '</div>';
    }).join('');
  } else {
    cbSection.classList.add('hidden');
  }

  // Minority Report
  const mrSection = document.getElementById('minority-report-section');
  const mrText = document.getElementById('minority-report-text');
  if (synthesis.minority_report) {
    mrSection.classList.remove('hidden');
    mrText.textContent = synthesis.minority_report;
  } else {
    mrSection.classList.add('hidden');
  }

  // What Would Change My Mind
  const wwSection = document.getElementById('wwcmm-section');
  const wwList = document.getElementById('wwcmm-list');
  if (synthesis.what_would_change_my_mind && synthesis.what_would_change_my_mind.length > 0) {
    wwSection.classList.remove('hidden');
    wwList.innerHTML = synthesis.what_would_change_my_mind.map(c => '<div class="wwcmm-item">' + c + '</div>').join('');
  } else {
    wwSection.classList.add('hidden');
  }

  // Mode Output (for new analysis modes)
  const modeSection = document.getElementById('mode-output-section');
  const modeContent = document.getElementById('mode-output-content');
  if (synthesis.modeOutput) {
    modeSection.classList.remove('hidden');
    modeContent.innerHTML = formatModeOutput(synthesis.modeOutput, synthesis.analysisMode);
  } else {
    modeSection.classList.add('hidden');
  }

  // Legacy case study fields
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

function formatModeOutput(output, mode) {
  if (!output) return '';
  if (typeof output === 'string') return '<p>' + output + '</p>';

  const formatters = {
    signal_vs_noise: (o) => {
      let html = '';
      if (o.signals) html += '<div class="mode-output-section"><div class="mode-output-section-title">Signals</div>' + o.signals.map(s => '<div class="mode-output-item">' + (s.signal || s) + '</div>').join('') + '</div>';
      if (o.noise) html += '<div class="mode-output-section"><div class="mode-output-section-title">Noise</div>' + o.noise.map(n => '<div class="mode-output-item">' + (n.noise || n) + '</div>').join('') + '</div>';
      if (o.gaps) html += '<div class="mode-output-section"><div class="mode-output-section-title">Missing Information</div>' + o.gaps.map(g => '<div class="mode-output-item">' + (g.gap || g) + '</div>').join('') + '</div>';
      return html;
    },
    cascade_mapper: (o) => {
      let html = '';
      const levels = { immediate: 'Immediate', second_order: '2nd Order', third_order: '3rd Order', unexpected: 'Unexpected', irreversible: 'Irreversible' };
      Object.entries(levels).forEach(([key, label]) => {
        if (o[key] && o[key].length > 0) {
          html += '<div class="mode-output-section"><div class="mode-output-section-title">' + label + '</div>'
            + o[key].map(c => '<div class="mode-output-item">' + (c.consequence || c.trigger || c) + '</div>').join('') + '</div>';
        }
      });
      return html;
    },
    pre_mortem: (o) => {
      return '<div class="mode-output-section">'
        + '<div class="mode-output-section-title">Failure Scenarios</div>'
        + (o.failure_scenarios || []).map(s => '<div class="mode-output-item">' + (s.scenario || s) + '</div>').join('')
        + '</div>'
        + (o.most_likely_failure ? '<div class="mode-output-section"><div class="mode-output-section-title">Most Likely Failure</div><div class="mode-output-item">' + o.most_likely_failure + '</div></div>' : '')
        + (o.critical_fix ? '<div class="mode-output-section"><div class="mode-output-section-title">Critical Fix</div><div class="mode-output-item">' + o.critical_fix + '</div></div>' : '');
    },
    debate: (o) => {
      let html = '';
      if (o.for_position) html += '<div class="mode-output-section"><div class="mode-output-section-title">For</div><div class="mode-output-item">' + (o.for_position.argument || JSON.stringify(o.for_position)) + '</div></div>';
      if (o.against_position) html += '<div class="mode-output-section"><div class="mode-output-section-title">Against</div><div class="mode-output-item">' + (o.against_position.argument || JSON.stringify(o.against_position)) + '</div></div>';
      if (o.arbitration) html += '<div class="mode-output-section"><div class="mode-output-section-title">Arbitration</div><div class="mode-output-item">' + (o.arbitration.verdict || o.arbitration.analysis || JSON.stringify(o.arbitration)) + '</div></div>';
      return html;
    },
    reverse_engineer: (o) => {
      let html = '';
      const layers = { surface_cause: 'Surface Cause', real_cause: 'Real Cause', root_cause: 'Root Cause', prevention: 'Prevention' };
      Object.entries(layers).forEach(([key, label]) => {
        if (o[key]) {
          html += '<div class="mode-output-section"><div class="mode-output-section-title">' + label + '</div><div class="mode-output-item">' + (o[key].description || o[key].cause || JSON.stringify(o[key])) + '</div></div>';
        }
      });
      return html;
    },
    iceberg: (o) => {
      let html = '';
      const levels = { above_surface: 'Above Surface (Everyone Sees)', level_1: 'Level 1 (Careful Observers)', level_2: 'Level 2 (Experts Notice)', level_3: 'Level 3 (Almost Nobody Sees)' };
      Object.entries(levels).forEach(([key, label]) => {
        if (o[key] && o[key].length > 0) {
          html += '<div class="mode-output-section"><div class="mode-output-section-title">' + label + '</div>'
            + o[key].map(i => '<div class="mode-output-item">' + (i.item || i) + '</div>').join('') + '</div>';
        }
      });
      return html;
    },
  };

  const formatter = formatters[mode];
  if (formatter) return formatter(output);
  return '<pre>' + JSON.stringify(output, null, 2) + '</pre>';
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
      bodyHtml += '<span class="truncated-indicator">... response may be truncated</span>';
    }
    return '<div class="output-card" data-domain="' + expert.domain + '">'
      + '<div class="output-card-header" data-toggle>'
      + '<div class="node-dot" style="background:' + color + '"></div>'
      + '<span class="output-card-title">' + expert.domain + '</span>'
      + '<span class="conf-pill ' + confClass + '">' + expert.confidence + '</span>'
      + '<span class="output-card-toggle">❯</span>'
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

// ========================
// GHOST MODE UI
// ========================

function updateGhostUI(level) {
  const indicator = document.getElementById('ghost-indicator');
  const label = document.getElementById('ghost-level-label');
  const timer = document.getElementById('ghost-timer');
  const timerBar = document.getElementById('ghost-timer-bar');
  const timerCountdown = document.getElementById('ghost-timer-countdown');

  if (!level || level === 'off') {
    indicator.classList.add('hidden');
    if (timerBar) timerBar.classList.add('hidden');
    document.getElementById('privacy-disclosure').classList.add('hidden');
    document.getElementById('app').classList.remove('ghost-dim');
    return;
  }

  // Show indicator
  indicator.classList.remove('hidden');
  indicator.classList.add('active');
  label.textContent = level.charAt(0).toUpperCase() + level.slice(1);

  // Update timer
  const times = { fog: '23:59:59', shadow: '11:59:59', void: '—', phantom: '—' };
  if (timer) timer.textContent = times[level] || '23:47:12';
  if (timerBar && timerCountdown) {
    timerBar.classList.remove('hidden');
    timerCountdown.textContent = times[level] || '23:47:12';

    // Start countdown timer for fog/shadow
    if (level === 'fog' || level === 'shadow') {
      startGhostTimer(level);
    }
  }

  // Dim the app
  document.getElementById('app').classList.add('ghost-dim');

  // Privacy disclosure
  const disclosures = {
    fog: "Cognitus doesn't store it \u2713  LLM provider may log it \u26A0\uFE0F",
    shadow: "Cognitus doesn't store it \u2713  LLM provider may log it \u26A0\uFE0F",
    void: "Nothing leaves your device \u2713\u2713  Completely private \u2713\u2713",
    phantom: "Nothing leaves your browser tab \u2713\u2713\u2713  Not even Cognitus servers see it \u2713\u2713\u2713",
  };
  const disclosureEl = document.getElementById('privacy-disclosure-text');
  if (disclosureEl && disclosures[level]) {
    disclosureEl.textContent = disclosures[level];
    document.getElementById('privacy-disclosure').classList.remove('hidden');
  }
}

let ghostTimerInterval = null;

function startGhostTimer(level) {
  if (ghostTimerInterval) clearInterval(ghostTimerInterval);

  const maxHours = level === 'fog' ? 24 : 12;
  let remaining = maxHours * 3600; // seconds

  ghostTimerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(ghostTimerInterval);
      ghostTimerInterval = null;
      document.getElementById('ghost-timer-countdown').textContent = 'Expired';
      return;
    }
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    const display = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    document.getElementById('ghost-timer-countdown').textContent = display;
  }, 1000);
}

// ========================
// PII REDACTION
// ========================

function updatePiiBanner(redactions) {
  const banner = document.getElementById('pii-banner');
  if (redactions && redactions.length > 0) {
    banner.classList.remove('hidden');

    // Update redaction modal list
    const list = document.getElementById('redaction-list');
    list.innerHTML = redactions.map(r =>
      '<div class="redaction-item">'
      + '<span class="redaction-item-type">' + (r.type || 'PII') + '</span>'
      + '<span class="redaction-item-text">' + (r.original || r.text || '') + '</span>'
      + '</div>'
    ).join('');
  } else {
    banner.classList.add('hidden');
  }
}

// ========================
// ASSUMPTION EXCAVATOR
// ========================

function updateAssumptionsList(assumptions) {
  const section = document.getElementById('assumptions-section');
  const list = document.getElementById('assumptions-list');

  if (!assumptions || assumptions.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  list.innerHTML = assumptions.map(a =>
    '<div class="assumption-item">'
    + '<span class="assumption-item-icon">' + (a.category === 'hidden' ? '\u{1F50D}' : '\u{1F4AD}') + '</span>'
    + '<div class="assumption-item-content">'
    + '<div class="assumption-item-text">' + (a.assumption || a.text || '') + '</div>'
    + '<div class="assumption-item-category">' + (a.category || 'general') + (a.importance ? ' \u00B7 ' + a.importance : '') + '</div>'
    + '</div>'
    + '</div>'
  ).join('');

  // Show modal if this is a new set
  if (assumptions.length > 0) {
    const modalList = document.getElementById('assumption-modal-list');
    modalList.innerHTML = assumptions.map((a, i) =>
      '<div class="assumption-item" data-index="' + i + '">'
      + '<div class="assumption-item-content">'
      + '<div class="assumption-item-text">' + (a.assumption || a.text || '') + '</div>'
      + '<div class="assumption-item-category">' + (a.category || 'general') + '</div>'
      + '</div>'
      + '<div class="assumption-item-actions">'
      + '<button class="assumption-action-btn" data-action="confirm" data-index="' + i + '">\u2713</button>'
      + '<button class="assumption-action-btn" data-action="deny" data-index="' + i + '">\u2717</button>'
      + '</div>'
      + '</div>'
    ).join('');

    // Set up action buttons
    modalList.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        const action = btn.dataset.action;
        const s = getState();
        const newAssumptions = [...s.assumptions];
        newAssumptions[idx] = { ...newAssumptions[idx], status: action === 'confirm' ? 'confirmed' : 'denied' };
        setState({ assumptions: newAssumptions });
        btn.classList.add(action === 'confirm' ? 'confirmed' : 'denied');
      });
    });

    document.getElementById('assumption-modal').classList.remove('hidden');
  }
}

// ========================
// CONNECTION STATUS
// ========================

function handleConnectionStatus(status) {
  const indicator = document.getElementById('reconnect-indicator');
  const retryBtn = document.getElementById('btn-retry');
  const text = document.getElementById('reconnect-text');
  if (!indicator || !text) return;
  const s = getState();

  if (status === 'disconnected' && s.status === 'failed' && s.error && s.error.includes('Click Retry')) {
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
      ? 'Reconnecting... (' + attempt + '/' + max + ')'
      : 'Reconnecting...';
  } else if (status === 'connected' && s.isReconnecting) {
    indicator.classList.remove('hidden');
    text.textContent = 'Reconnected \u2713';
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
}

// ========================
// STRESS TEST
// ========================

function updateStressTestButton(status) {
  const btn = document.getElementById('btn-stress-test');
  if (!btn) return;
  if (status === 'completed' && getState().synthesis) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

// ========================
// SITUATION DNA
// ========================

function updateDna(dna) {
  const section = document.getElementById('dna-section');
  const list = document.getElementById('dna-list');
  if (!dna || Object.keys(dna).length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  list.innerHTML = Object.entries(dna).map(([key, value]) =>
    '<div class="dna-item">'
    + '<span class="dna-item-label">' + key.replace(/_/g, ' ') + '</span>'
    + '<span class="dna-item-value">' + value + '</span>'
    + '</div>'
  ).join('');
}

// ========================
// THINKING STEPS (R1)
// ========================

function updateThinkingSteps(steps) {
  // R1 thinking steps are rendered on the canvas by the canvas module
  if (steps && steps.length > 0) {
    // Canvas handles the rendering
  }
}

// ========================
// MODE OUTPUT DISPLAY
// ========================

function updateModeOutput(state) {
  if (!state.modeOutput || state.analysisMode === 'standard') return;

  const modeSection = document.getElementById('mode-output-section');
  const modeContent = document.getElementById('mode-output-content');
  modeSection.classList.remove('hidden');
  modeContent.innerHTML = formatModeOutput(state.modeOutput, state.analysisMode);
}

// ========================
// CASE STUDY (unchanged)
// ========================

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
      + '<textarea class="node-behavior-input" placeholder="System prompt \u2014 describe how this node should reason, what to focus on, what to ignore..." data-field="behavior" data-index="' + i + '">' + (node.behavior || '') + '</textarea>'
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
        colorIndex: t.color !== undefined ? t.color % NODE_COLORS_PRESET.length : 0,
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

// ========================
// ONBOARDING FLOW
// ========================

function checkOnboarding() {
  const hasCompleted = localStorage.getItem('cognitus_onboarding');
  if (hasCompleted) return;

  const s = getState();
  if (s.connectionStatus === 'connected') {
    showOnboarding();
  } else {
    // Wait for connection before showing
    const unsub = subscribe('connectionStatus', (status) => {
      if (status === 'connected') {
        unsub();
        showOnboarding();
      }
    });
  }
}

function showOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  overlay.classList.remove('hidden');
  setState({ onboardingStep: 'mode' });

  // Show step 1
  document.getElementById('onboarding-step-mode').classList.remove('hidden');
  document.getElementById('onboarding-step-key').classList.add('hidden');
  document.getElementById('onboarding-step-template').classList.add('hidden');
  document.getElementById('onboarding-step-indicator').textContent = 'Step 1 of 3';
  document.getElementById('onboarding-back').classList.add('hidden');
}

function advanceOnboarding() {
  const s = getState();
  const currentStep = s.onboardingStep || 'mode';

  if (currentStep === 'mode') {
    const selectedMode = s.onboardingMode;
    if (!selectedMode) return;

    localStorage.setItem('cognitus_llm_mode', selectedMode);

    // Set env var via API
    fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm_mode: selectedMode }),
    }).catch(() => {});

    document.getElementById('onboarding-step-mode').classList.add('hidden');

    // Free and Browser go directly to template step (no key needed)
    if (selectedMode === 'free' || selectedMode === 'browser') {
      goToStep('template');
      return;
    }

    // Local mode
    if (selectedMode === 'local') {
      document.getElementById('onboarding-key-desc').textContent =
        'Install Ollama and enter the model name (or leave empty for auto-detect)';
      document.getElementById('onboarding-key-input').placeholder = 'e.g., llama3.1:8b (leave empty for auto-detect)';
      document.getElementById('onboarding-key-validate').textContent = 'Auto-detect';
      goToStep('key');
      return;
    }

    // Paid mode
    if (selectedMode === 'paid') {
      document.getElementById('onboarding-key-desc').textContent =
        'Enter your API key (OpenAI or Anthropic)';
      document.getElementById('onboarding-key-input').placeholder = 'Paste your API key...';
      document.getElementById('onboarding-key-validate').textContent = 'Validate';
      goToStep('key');
      return;
    }
  } else if (currentStep === 'key') {
    // Validate key (or skip for local)
    goToStep('template');
  } else if (currentStep === 'template') {
    closeOnboarding();
  }
}

function goBackOnboarding() {
  const s = getState();
  const currentStep = s.onboardingStep || 'mode';

  if (currentStep === 'key') {
    goToStep('mode');
  } else if (currentStep === 'template') {
    goToStep('key');
  }
}

function goToStep(step) {
  setState({ onboardingStep: step });

  document.getElementById('onboarding-step-mode').classList.toggle('hidden', step !== 'mode');
  document.getElementById('onboarding-step-key').classList.toggle('hidden', step !== 'key');
  document.getElementById('onboarding-step-template').classList.toggle('hidden', step !== 'template');

  const stepNumbers = { mode: 'Step 1 of 3', key: 'Step 2 of 3', template: 'Step 3 of 3' };
  document.getElementById('onboarding-step-indicator').textContent = stepNumbers[step] || '';

  document.getElementById('onboarding-back').classList.toggle('hidden', step === 'mode');

  const nextBtn = document.getElementById('onboarding-next');
  if (step === 'template') {
    nextBtn.textContent = 'Start Analyzing';
  } else {
    nextBtn.textContent = 'Next';
  }
}

function closeOnboarding() {
  document.getElementById('onboarding-overlay').classList.add('hidden');
  localStorage.setItem('cognitus_onboarding', 'true');
  setState({ onboardingStep: 'complete' });
}

function populateFromTemplate(template) {
  const templates = {
    career: "I'm considering leaving my stable job to join a startup. The startup has promising technology but is pre-revenue. I have a family to support and a mortgage. The equity offer is 2% with a 4-year vest. My current role pays $150k with good benefits.",
    product: "We're launching a new product in a competitive market. We have a working MVP but our competitors have first-mover advantage. Our key differentiator is a novel algorithm, but it's unpatented. We have 6 months of runway and a team of 8.",
    relationship: "Two senior team members have conflicting visions for the project. One wants to prioritize speed-to-market with a minimal feature set. The other insists on building a robust, scalable architecture first. The team is split. The deadline is 3 months away.",
  };
  const text = templates[template];
  if (text) {
    document.getElementById('question-input').value = text;
  }
}
