import { getState, setState, subscribe, handleWsEvent } from './store.js';
import { connect, disconnect, connectCaseStudy, retryConnection, onEvent, onConnectionChange, connectWithOptions, sendChatMessage, sendStressTest, exportAnalysis, clearCache, runEval } from './api.js';
import { renderMarkdown, isTruncated, getNodeColor, getDynamicNodeColor, getNodeRole, getConfidenceClass, resolveColor, PRESET_TEMPLATES, NODE_COLORS_PRESET, truncateFilename, getFileTypeIcon, getFileTypeBadgeClass } from './utils.js';
import { initCanvas, startAnimation, zoomIn, zoomOut, fitView } from './canvas.js';
import { initChat, showChat, hideChat, toggleChat, addChatMessage, addStreamingMessage, clearChat, handleChatEvent } from './chat.js';
import { getGroq, GROQ_MODELS } from './groq.js';

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
    openSettingsModal();
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

  // === TASK 11: Export Button ===
  const exportBtn = document.getElementById('btn-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const dropdown = document.getElementById('export-dropdown');
      if (dropdown) dropdown.classList.toggle('hidden');
    });
  }

  document.querySelectorAll('[data-export-format]').forEach(el => {
    el.addEventListener('click', async () => {
      const format = el.dataset.exportFormat;
      const dropdown = document.getElementById('export-dropdown');
      if (dropdown) dropdown.classList.add('hidden');
      await handleExport(format);
    });
  });

  // === TASK 5: Cache Controls ===
  const cacheToggle = document.getElementById('toggle-cache');
  if (cacheToggle) {
    cacheToggle.addEventListener('change', () => {
      setState({ cacheEnabled: cacheToggle.checked });
    });
  }

  const clearCacheBtn = document.getElementById('btn-clear-cache');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', async () => {
      await clearCache();
      setState({ cacheHits: {}, cacheInfo: null });
      clearCacheBtn.textContent = 'Cleared ✓';
      setTimeout(() => { clearCacheBtn.textContent = 'Clear Cache'; }, 2000);
    });
  }

  // === TASK 6: RAG Toggle ===
  const ragToggle = document.getElementById('toggle-rag');
  if (ragToggle) {
    ragToggle.addEventListener('change', () => {
      setState({ ragEnabled: ragToggle.checked });
    });
  }

  // === TASK 9: Enrichment Toggle ===
  const enrichToggle = document.getElementById('toggle-enrichment');
  if (enrichToggle) {
    enrichToggle.addEventListener('change', () => {
      setState({ enrichmentEnabled: enrichToggle.checked });
    });
  }

  // === TASK 12: Eval Button ===
  const evalBtn = document.getElementById('btn-run-eval');
  if (evalBtn) {
    evalBtn.addEventListener('click', async () => {
      setState({ evalRunning: true });
      const results = await runEval();
      setState({ evalRunning: false, evalResults: results });
      if (results) {
        showEvalResults(results);
      }
    });
  }

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

  // ---- Settings modal ----
  document.getElementById('settings-modal-close')?.addEventListener('click', closeSettingsModal);
  document.getElementById('settings-save-btn')?.addEventListener('click', () => {
    saveSettings();
    closeSettingsModal();
  });
  document.getElementById('settings-reset-btn')?.addEventListener('click', resetSettingsDefaults);
  document.getElementById('settings-llm-mode')?.addEventListener('change', (e) => {
    // Show/hide API key field based on selected provider
    const apiKeyRow = document.getElementById('settings-api-key')?.closest('.settings-row');
    if (apiKeyRow) {
      const needsKey = ['groq', 'openai', 'anthropic'].includes(e.target.value);
      apiKeyRow.style.display = needsKey ? 'flex' : 'none';
    }
    // Show/hide Groq model selector
    const groqModelRow = document.getElementById('settings-groq-model-row');
    if (groqModelRow) {
      groqModelRow.style.display = e.target.value === 'groq' ? 'flex' : 'none';
    }
    // Update placeholder
    const apiKeyInput = document.getElementById('settings-api-key');
    if (apiKeyInput) {
      apiKeyInput.placeholder = e.target.value === 'groq'
        ? 'Enter your Groq API key...'
        : 'Enter API key...';
    }
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

  // === NEW SUBSCRIPTIONS ===

  // Task 4: Streaming status
  subscribe('streamingActive', (active) => {
    const indicator = document.getElementById('streaming-indicator');
    if (indicator) {
      indicator.classList.toggle('hidden', !active);
    }
  });

  subscribe('streamingNodes', () => {
    updateStreamingIndicator(getState());
  });

  // Task 5: Cache info
  subscribe('cacheInfo', (info) => {
    updateCacheDisplay(info);
  });

  // Task 7: Cross-examination
  subscribe('crossCheckResult', (result) => {
    updateCrossCheckDisplay(getState());
  });
  subscribe('contradictions', () => updateCrossCheckDisplay(getState()));
  subscribe('agreements', () => updateCrossCheckDisplay(getState()));

  // Task 9: Enrichment status
  subscribe('enrichmentStatus', (status) => {
    const indicator = document.getElementById('enrichment-indicator');
    if (indicator) {
      indicator.classList.toggle('hidden', !status || status === 'idle');
      const text = indicator.querySelector('.enrichment-status-text');
      if (text) {
        const labels = {
          fetching: 'Fetching external data...',
          enriching: 'Enriching analysis...',
          done: 'Enriched ✓',
          error: 'Enrichment failed',
        };
        text.textContent = labels[status] || status;
        indicator.className = 'enrichment-indicator ' + (status === 'done' ? 'done' : status === 'error' ? 'error' : '');
      }
    }
  });

  // Task 6: RAG status
  subscribe('ragStatus', (status) => {
    const indicator = document.getElementById('rag-indicator');
    if (indicator) {
      indicator.classList.toggle('hidden', !status || status === 'idle');
      const text = indicator.querySelector('.rag-status-text');
      if (text) {
        const labels = {
          chunking: 'Chunking documents...',
          embedding: 'Embedding chunks...',
          ready: 'Vector search ready ✓',
          error: 'RAG processing failed',
        };
        text.textContent = labels[status] || status;
      }
    }
  });

  // Task 12: Eval results
  subscribe('evalResults', (results) => {
    if (results) showEvalResults(results);
  });

  // ---- Click outside handlers ----
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('presets-dropdown');
    if (!e.target.closest('#presets-wrapper') && !dd.classList.contains('hidden')) {
      dd.classList.add('hidden');
    }
    const exportDD = document.getElementById('export-dropdown');
    if (exportDD && !e.target.closest('#export-wrapper') && !exportDD.classList.contains('hidden')) {
      exportDD.classList.add('hidden');
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

  // ================================================================
  // GROQ API INIT
  // ================================================================

  const groq = getGroq();
  const s0 = getState();
  if (s0.groqApiKey) {
    groq.setApiKey(s0.groqApiKey);
  }
  if (s0.groqModel) {
    groq.setModel(s0.groqModel);
  }

  // ================================================================
  // RESIZABLE PANELS
  // ================================================================

  initResizablePanels();
}

// ================================================================
// SETTINGS MODAL
// ================================================================

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  populateSettingsForm();
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hidden');
}

function populateSettingsForm() {
  const s = getState();
  
  const llmSelect = document.getElementById('settings-llm-mode');
  if (llmSelect) {
    llmSelect.value = s.llmMode || 'groq';
    // Toggle API key field visibility — show for Groq, OpenAI, and Anthropic
    const apiKeyRow = document.getElementById('settings-api-key')?.closest('.settings-row');
    if (apiKeyRow) {
      apiKeyRow.style.display = ['groq', 'openai', 'anthropic'].includes(llmSelect.value) ? 'flex' : 'none';
    }
  }
  
  const apiKeyInput = document.getElementById('settings-api-key');
  if (apiKeyInput) {
    const s2 = getState();
    const llmMode = s2.llmMode || 'groq';
    // Load the appropriate key based on current mode
    const key = llmMode === 'groq'
      ? (s2.groqApiKey || localStorage.getItem('cognitus_groq_key') || '')
      : (localStorage.getItem('cognitus_api_key') || '');
    apiKeyInput.value = key;
    apiKeyInput.placeholder = llmMode === 'groq'
      ? 'Enter your Groq API key...'
      : 'Enter API key...';
  }
  
  const showRoles = document.getElementById('settings-show-role-labels');
  if (showRoles) showRoles.checked = s.showRoleLabels !== false;
  
  const showMinimap = document.getElementById('settings-show-minimap');
  if (showMinimap) showMinimap.checked = s.showMinimap !== false;
  
  const animations = document.getElementById('settings-animations');
  if (animations) animations.checked = s.animationsEnabled !== false;
  
  const expertCount = document.getElementById('settings-expert-count');
  if (expertCount) expertCount.value = s.expertCount || 5;
  
  const maxTokens = document.getElementById('settings-max-tokens');
  if (maxTokens) maxTokens.value = s.maxTokens || 2048;
  
  const autoRedact = document.getElementById('settings-auto-redact');
  if (autoRedact) autoRedact.checked = s.autoRedact !== false;
  
  const debugLogging = document.getElementById('settings-debug-logging');
  if (debugLogging) debugLogging.checked = s.debugLogging === true;
  
  // Show active provider
  const activeProvider = document.getElementById('settings-active-provider');
  if (activeProvider) {
    activeProvider.textContent = s.connectionStatus === 'connected' ? 'Connected' : 'Disconnected';
  }

  // Show Groq model selector
  const groqModelSelect = document.getElementById('settings-groq-model');
  if (groqModelSelect) {
    const models = GROQ_MODELS;
    groqModelSelect.innerHTML = Object.entries(models).map(([key, m]) =>
      `<option value="${key}" ${(s.groqModel || 'llama-3.3-70b') === key ? 'selected' : ''}>${m.label} (${m.context} ctx)</option>`
    ).join('');
    groqModelSelect.closest('.settings-row').style.display = llmSelect?.value === 'groq' ? 'flex' : 'none';
  }
}

function saveSettings() {
  const s = getState();
  
  const llmMode = document.getElementById('settings-llm-mode')?.value;
  if (llmMode) {
    setState({ llmMode });
    localStorage.setItem('cognitus_llm_mode', llmMode);

    // Save API key to the right storage based on mode
    const apiKey = document.getElementById('settings-api-key')?.value;
    if (apiKey) {
      if (llmMode === 'groq') {
        localStorage.setItem('cognitus_groq_key', apiKey);
        setState({ groqApiKey: apiKey });
        getGroq().setApiKey(apiKey);
      } else {
        localStorage.setItem('cognitus_api_key', apiKey);
      }
    }

    // Save Groq model preference
    const groqModel = document.getElementById('settings-groq-model')?.value;
    if (groqModel && llmMode === 'groq') {
      setState({ groqModel });
      getGroq().setModel(groqModel);
    }

    fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm_mode: llmMode }),
    }).catch(() => {});
  }
  
  const showRoleLabels = document.getElementById('settings-show-role-labels')?.checked;
  if (showRoleLabels !== undefined) setState({ showRoleLabels });
  
  const showMinimap = document.getElementById('settings-show-minimap')?.checked;
  if (showMinimap !== undefined) setState({ showMinimap });
  
  const animationsEnabled = document.getElementById('settings-animations')?.checked;
  if (animationsEnabled !== undefined) setState({ animationsEnabled });
  
  const expertCount = parseInt(document.getElementById('settings-expert-count')?.value || '5');
  if (!isNaN(expertCount)) setState({ expertCount: Math.max(2, Math.min(10, expertCount)) });
  
  const maxTokens = parseInt(document.getElementById('settings-max-tokens')?.value || '2048');
  if (!isNaN(maxTokens)) setState({ maxTokens: Math.max(256, Math.min(8192, maxTokens)) });
  
  const autoRedact = document.getElementById('settings-auto-redact')?.checked;
  if (autoRedact !== undefined) setState({ autoRedact });
  
  const debugLogging = document.getElementById('settings-debug-logging')?.checked;
  if (debugLogging !== undefined) setState({ debugLogging });
}

function resetSettingsDefaults() {
  const llmSelect = document.getElementById('settings-llm-mode');
  if (llmSelect) llmSelect.value = 'groq';
  
  const apiKeyInput = document.getElementById('settings-api-key');
  if (apiKeyInput) apiKeyInput.value = '';

  const groqModelRow = document.getElementById('settings-groq-model-row');
  if (groqModelRow) groqModelRow.style.display = 'none';
  
  const showRoles = document.getElementById('settings-show-role-labels');
  if (showRoles) showRoles.checked = true;
  
  const showMinimap = document.getElementById('settings-show-minimap');
  if (showMinimap) showMinimap.checked = true;
  
  const animations = document.getElementById('settings-animations');
  if (animations) animations.checked = true;
  
  const expertCount = document.getElementById('settings-expert-count');
  if (expertCount) expertCount.value = 5;
  
  const maxTokens = document.getElementById('settings-max-tokens');
  if (maxTokens) maxTokens.value = 2048;
  
  const autoRedact = document.getElementById('settings-auto-redact');
  if (autoRedact) autoRedact.checked = true;
  
  const debugLogging = document.getElementById('settings-debug-logging');
  if (debugLogging) debugLogging.checked = false;
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
    streamingNodes: {},
    streamingActive: false,
    cacheHits: {},
    cacheInfo: null,
    crossCheckResult: null,
    crossCheckStep: null,
    enrichmentStatus: 'idle',
    enrichmentData: null,
    selectedNode: null,
  });

  currentSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  // Pass cache/rag/enrichment toggles along with analysis options
  connectWithOptions(situation, currentSessionId, 0, {
    analysisMode: s.analysisMode || 'standard',
    ghostLevel: s.ghostLevel || 'off',
    cacheEnabled: s.cacheEnabled !== false,
    ragEnabled: s.ragEnabled !== false,
    enrichmentEnabled: s.enrichmentEnabled !== false,
  });
}

function stopAnalysis() {
  disconnect();
  setState({ status: 'idle', activeNode: null, nodesLoading: false, streamingActive: false, streamingNodes: {}, caseStudy: { ...getState().caseStudy, analysisStatus: 'idle' } });
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
    streamingNodes: {},
    streamingActive: false,
    cacheHits: {},
    cacheInfo: null,
    crossCheckResult: null,
    crossCheckStep: null,
    enrichmentStatus: 'idle',
    enrichmentData: null,
  });
  currentSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  connectWithOptions(s.situation, currentSessionId, 0, {
    analysisMode: s.analysisMode || 'standard',
    ghostLevel: s.ghostLevel || 'off',
    cacheEnabled: s.cacheEnabled !== false,
    ragEnabled: s.ragEnabled !== false,
    enrichmentEnabled: s.enrichmentEnabled !== false,
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
    const cached = getState().cacheHits && getState().cacheHits[node.name];
    const stagger = 150 * i;
    return '<div class="node-item node-fade-in" style="animation-delay:' + stagger + 'ms" data-domain="' + node.name + '">'
      + '<div class="node-dot" style="background:' + color + '"></div>'
      + '<div class="node-info">'
      + '<div class="node-name">' + node.name + '</div>'
      + '<div class="node-role">' + node.role + '</div>'
      + '</div>'
      + (expert ? '<span class="conf-pill ' + confClass + '">' + expert.confidence + '</span>' : '')
      + (cached ? '<span class="cache-badge">⚡</span>' : '')
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

  // Stress Test Results
  const stSection = document.getElementById('stress-test-section');
  const stResults = document.getElementById('stress-test-results');
  if (synthesis.stressTest) {
    stSection.classList.remove('hidden');
    stResults.innerHTML = formatStressTest(synthesis.stressTest);
  } else {
    stSection.classList.add('hidden');
  }

  // Mode Output
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

function formatStressTest(data) {
  let html = '';
  if (data.scenarios) {
    data.scenarios.forEach(s => {
      html += '<div class="stress-test-scenario">'
        + '<div class="stress-test-scenario-header">' + (s.scenario || 'Scenario') + '</div>'
        + '<div class="stress-test-scenario-text">' + (s.analysis || s.result || '') + '</div>'
        + '</div>';
    });
  }
  if (data.robustness_score !== undefined) {
    const pct = Math.round(data.robustness_score * 100);
    html += '<div class="stress-test-robustness">'
      + '<strong>Robustness: ' + pct + '%</strong>'
      + '</div>';
  }
  return html;
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
  const cacheHits = getState().cacheHits || {};
  const items = experts.map(expert => {
    const nodeIndex = (dynamicNodes || []).findIndex(n => n.name === expert.domain);
    const colorIdx = nodeIndex >= 0 ? nodeIndex : 0;
    const color = resolveColor(getDynamicNodeColor(expert.domain, colorIdx));
    const confClass = getConfidenceClass(expert.confidence);
    const raw = expert.analysis || '';
    const body = renderMarkdown(raw);
    const truncated = isTruncated(raw);
    const isCached = cacheHits[expert.domain];
    let bodyHtml = body;
    if (truncated) {
      bodyHtml += '<span class="truncated-indicator">... response may be truncated</span>';
    }
    return '<div class="output-card" data-domain="' + expert.domain + '">'
      + '<div class="output-card-header" data-toggle>'
      + '<div class="node-dot" style="background:' + color + '"></div>'
      + '<span class="output-card-title">' + expert.domain + '</span>'
      + (isCached ? '<span class="cache-badge-sm" title="From cache">⚡</span>' : '')
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

// ================================================================
// TASK 4: Streaming Indicator
// ================================================================

function updateStreamingIndicator(state) {
  const indicator = document.getElementById('streaming-indicator');
  if (!indicator) return;

  if (!state.streamingActive || !state.streamingNodes) {
    indicator.classList.add('hidden');
    return;
  }

  const activeNodes = Object.entries(state.streamingNodes)
    .filter(([_, data]) => data.active)
    .map(([name, data]) => name);

  if (activeNodes.length === 0) {
    indicator.classList.add('hidden');
    return;
  }

  indicator.classList.remove('hidden');
  const text = indicator.querySelector('.streaming-text');
  if (text) {
    text.textContent = `▶ Streaming: ${activeNodes.join(', ')}`;
  }
}

// ================================================================
// TASK 5: Cache Display
// ================================================================

function updateCacheDisplay(info) {
  if (!info) return;
  const display = document.getElementById('cache-info');
  if (display) {
    display.textContent = `${info.hits} hits / ${info.misses} misses`;
  }
}

// ================================================================
// TASK 7: Cross-Examination Display
// ================================================================

function updateCrossCheckDisplay(state) {
  const section = document.getElementById('crosscheck-section');
  if (!section) return;

  const contradictions = state.contradictions || [];
  const agreements = state.agreements || [];
  const crossCheckResult = state.crossCheckResult;

  if (contradictions.length === 0 && agreements.length === 0 && !crossCheckResult) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  // Agreements
  const agreeSection = document.getElementById('crosscheck-agreements');
  const agreeList = document.getElementById('crosscheck-agreements-list');
  if (agreements.length > 0) {
    agreeSection.classList.remove('hidden');
    agreeList.innerHTML = agreements.map(a =>
      '<div class="crosscheck-item agree">' + (a.statement || a.agreement || JSON.stringify(a)) + '</div>'
    ).join('');
  } else {
    agreeSection.classList.add('hidden');
  }

  // Conflicts
  const conflictSection = document.getElementById('crosscheck-conflicts');
  const conflictList = document.getElementById('crosscheck-conflicts-list');
  if (contradictions.length > 0) {
    conflictSection.classList.remove('hidden');
    conflictList.innerHTML = contradictions.map(c =>
      '<div class="crosscheck-item disagree">' + (c.statement || c.contradiction || JSON.stringify(c)) + '</div>'
    ).join('');
  } else {
    conflictSection.classList.add('hidden');
  }

  // Strongest Argument
  const strongestSection = document.getElementById('crosscheck-strongest');
  const strongestText = document.getElementById('crosscheck-strongest-text');
  if (crossCheckResult && crossCheckResult.strongest_argument) {
    strongestSection.classList.remove('hidden');
    strongestText.textContent = crossCheckResult.strongest_argument;
  } else {
    strongestSection.classList.add('hidden');
  }

  // Unanswered
  const unansweredSection = document.getElementById('crosscheck-unanswered');
  const unansweredText = document.getElementById('crosscheck-unanswered-text');
  if (crossCheckResult && crossCheckResult.unanswered_questions && crossCheckResult.unanswered_questions.length > 0) {
    unansweredSection.classList.remove('hidden');
    unansweredText.innerHTML = crossCheckResult.unanswered_questions.map(q =>
      '<div class="crosscheck-item">' + q + '</div>'
    ).join('');
  } else {
    unansweredSection.classList.add('hidden');
  }

  // Quality
  const qualitySection = document.getElementById('crosscheck-quality');
  const qualityText = document.getElementById('crosscheck-quality-text');
  if (crossCheckResult && crossCheckResult.quality) {
    qualitySection.classList.remove('hidden');
    qualityText.textContent = crossCheckResult.quality;
  } else {
    qualitySection.classList.add('hidden');
  }
}

// ================================================================
// TASK 11: Export Handler
// ================================================================

async function handleExport(format) {
  const s = getState();
  if (!s.synthesis) return;

  setState({ exportLoading: true });

  const data = {
    situation: s.situation,
    verdict: s.synthesis.verdict,
    reasoning: s.synthesis.reasoning,
    confidence: s.synthesis.confidence,
    consensus_score: s.synthesis.consensus_score,
    experts: s.experts,
    contradictions: s.contradictions,
    agreements: s.agreements,
    analysisMode: s.analysisMode,
    modeOutput: s.modeOutput,
    assumptions: s.assumptions,
  };

  const result = await exportAnalysis(format, data);
  setState({ exportLoading: false });

  if (!result) {
    alert('Export failed. Check console for details.');
    return;
  }

  if (result.blob) {
    // Download the file
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename || `analysis.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } else if (result.url) {
    // Share URL
    const shareUrl = result.url;
    try {
      await navigator.clipboard.writeText(shareUrl);
      alert(`Share URL copied to clipboard:\n${shareUrl}`);
    } catch {
      prompt('Copy this share URL:', shareUrl);
    }
  }
}

// ================================================================
// TASK 12: Eval Results Display
// ================================================================

function showEvalResults(results) {
  if (!results) return;

  // Show results in the verdict tab
  const verdictContent = document.getElementById('verdict-content');
  if (!verdictContent) return;

  let html = '<div class="eval-results-card">'
    + '<div class="eval-results-header">Eval Results</div>';

  if (results.summary) {
    html += '<div class="eval-summary">' + results.summary + '</div>';
  }

  if (results.tests && results.tests.length > 0) {
    html += '<div class="eval-tests-list">';
    results.tests.forEach((test, i) => {
      const passed = test.passed !== false;
      html += '<div class="eval-test-item ' + (passed ? 'passed' : 'failed') + '">'
        + '<span class="eval-test-icon">' + (passed ? '✓' : '✗') + '</span>'
        + '<div class="eval-test-info">'
        + '<div class="eval-test-name">' + (test.name || test.scenario || 'Test ' + (i + 1)) + '</div>'
        + (test.detail ? '<div class="eval-test-detail">' + test.detail + '</div>' : '')
        + '</div>'
        + '</div>';
    });
    html += '</div>';
  }

  if (results.score !== undefined) {
    html += '<div class="eval-score">Score: ' + Math.round(results.score * 100) + '%</div>';
  }

  html += '</div>';

  // Append to verdict content or show in placeholder
  const existing = verdictContent.querySelector('.eval-results-card');
  if (existing) {
    existing.outerHTML = html;
  } else {
    verdictContent.insertAdjacentHTML('afterbegin', html);
  }
}

// ================================================================
// GHOST MODE UI
// ================================================================

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

  indicator.classList.remove('hidden');
  indicator.classList.add('active');
  label.textContent = level.charAt(0).toUpperCase() + level.slice(1);

  const times = { fog: '23:59:59', shadow: '11:59:59', void: '—', phantom: '—' };
  if (timer) timer.textContent = times[level] || '23:47:12';
  if (timerBar && timerCountdown) {
    timerBar.classList.remove('hidden');
    timerCountdown.textContent = times[level] || '23:47:12';
    if (level === 'fog' || level === 'shadow') {
      startGhostTimer(level);
    }
  }

  document.getElementById('app').classList.add('ghost-dim');

  const disclosures = {
    fog: "Cognitus doesn't store it ✓  LLM provider may log it ⚠️",
    shadow: "Cognitus doesn't store it ✓  LLM provider may log it ⚠️",
    void: "Nothing leaves your device ✓✓  Completely private ✓✓",
    phantom: "Nothing leaves your browser tab ✓✓✓  Not even Cognitus servers see it ✓✓✓",
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
  let remaining = maxHours * 3600;

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
    const s2 = remaining % 60;
    const display = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s2).padStart(2, '0');
    document.getElementById('ghost-timer-countdown').textContent = display;
  }, 1000);
}

// ================================================================
// PII REDACTION
// ================================================================

function updatePiiBanner(redactions) {
  const banner = document.getElementById('pii-banner');
  if (redactions && redactions.length > 0) {
    banner.classList.remove('hidden');
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

// ================================================================
// ASSUMPTION EXCAVATOR
// ================================================================

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
    + '<span class="assumption-item-icon">' + (a.category === 'hidden' ? '🔍' : '💭') + '</span>'
    + '<div class="assumption-item-content">'
    + '<div class="assumption-item-text">' + (a.assumption || a.text || '') + '</div>'
    + '<div class="assumption-item-category">' + (a.category || 'general') + (a.importance ? ' · ' + a.importance : '') + '</div>'
    + '</div>'
    + '</div>'
  ).join('');

  if (assumptions.length > 0) {
    const modalList = document.getElementById('assumption-modal-list');
    modalList.innerHTML = assumptions.map((a, i) =>
      '<div class="assumption-item" data-index="' + i + '">'
      + '<div class="assumption-item-content">'
      + '<div class="assumption-item-text">' + (a.assumption || a.text || '') + '</div>'
      + '<div class="assumption-item-category">' + (a.category || 'general') + '</div>'
      + '</div>'
      + '<div class="assumption-item-actions">'
      + '<button class="assumption-action-btn" data-action="confirm" data-index="' + i + '">✓</button>'
      + '<button class="assumption-action-btn" data-action="deny" data-index="' + i + '">✗</button>'
      + '</div>'
      + '</div>'
    ).join('');

    modalList.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        const action = btn.dataset.action;
        const s2 = getState();
        const newAssumptions = [...s2.assumptions];
        newAssumptions[idx] = { ...newAssumptions[idx], status: action === 'confirm' ? 'confirmed' : 'denied' };
        setState({ assumptions: newAssumptions });
        btn.classList.add(action === 'confirm' ? 'confirmed' : 'denied');
      });
    });

    document.getElementById('assumption-modal').classList.remove('hidden');
  }
}

// ================================================================
// CONNECTION STATUS
// ================================================================

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
    text.textContent = 'Reconnected ✓';
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

// ================================================================
// STRESS TEST
// ================================================================

function updateStressTestButton(status) {
  const btn = document.getElementById('btn-stress-test');
  if (!btn) return;
  if (status === 'completed' && getState().synthesis) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

// ================================================================
// SITUATION DNA
// ================================================================

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

// ================================================================
// THINKING STEPS
// ================================================================

function updateThinkingSteps(steps) {
  // Canvas handles the rendering
}

// ================================================================
// MODE OUTPUT DISPLAY
// ================================================================

function updateModeOutput(state) {
  if (!state.modeOutput || state.analysisMode === 'standard') return;
  const modeSection = document.getElementById('mode-output-section');
  const modeContent = document.getElementById('mode-output-content');
  modeSection.classList.remove('hidden');
  modeContent.innerHTML = formatModeOutput(state.modeOutput, state.analysisMode);
}

// ================================================================
// CASE STUDY
// ================================================================

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
    const statusText = f.status === 'extracting' ? '<span class="file-chip-status extracting">⏳</span>'
      : f.status === 'ready' ? '<span class="file-chip-status ready">✓</span>'
      : '<span class="file-chip-status failed">✗</span>';
    return '<div class="file-chip" data-id="' + f.id + '">'
      + icon
      + '<span class="file-chip-name" title="' + f.name + '">' + truncateFilename(f.name, 22) + '</span>'
      + '<span class="file-chip-badge ' + badgeClass + '">' + f.type + '</span>'
      + statusText
      + '<button class="file-chip-remove" data-remove="' + f.id + '">×</button>'
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
      + '<span class="node-drag-handle">⠿</span>'
      + '<div class="color-swatch-wrapper">'
      + '<div class="color-swatch" style="background:' + color + '" data-swatch="' + i + '"></div>'
      + '<div class="color-picker-popup hidden" data-popup="' + i + '">'
      + NODE_COLORS_PRESET.map((c, ci) => '<div class="color-picker-option' + (ci === node.colorIndex ? ' selected' : '') + '" style="background:' + resolveColor(c) + '" data-ci="' + ci + '"></div>').join('')
      + '</div>'
      + '</div>'
      + '<input class="node-name-input" value="' + (node.name || '') + '" placeholder="Node name" data-field="name" data-index="' + i + '"/>'
      + '<div class="node-card-actions">'
      + '<button class="btn-node-action" data-toggle-node="' + i + '">' + (node.collapsed ? '▼' : '▲') + '</button>'
      + '<button class="btn-node-action" data-duplicate="' + i + '">⎘</button>'
      + '<button class="btn-node-action danger" data-delete="' + i + '"' + (canDelete ? '' : ' disabled style="opacity:0.3"') + '>✕</button>'
      + '</div>'
      + '</div>'
      + '<div class="node-card-body">'
      + '<input class="node-role-input" value="' + (node.role || '') + '" placeholder="One line description of role" data-field="role" data-index="' + i + '"/>'
      + '<textarea class="node-behavior-input" placeholder="System prompt — describe how this node should reason, what to focus on, what to ignore..." data-field="behavior" data-index="' + i + '">' + (node.behavior || '') + '</textarea>'
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

// ================================================================
// ONBOARDING FLOW
// ================================================================

function checkOnboarding() {
  const hasCompleted = localStorage.getItem('cognitus_onboarding');
  if (hasCompleted) return;
  const s = getState();
  if (s.connectionStatus === 'connected') {
    showOnboarding();
  } else {
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
    fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm_mode: selectedMode }),
    }).catch(() => {});
    document.getElementById('onboarding-step-mode').classList.add('hidden');
    if (selectedMode === 'browser') {
      goToStep('template');
      return;
    }
    if (selectedMode === 'free') {
      document.getElementById('onboarding-key-desc').textContent = 'Enter your Groq API key to use their free inference API.';
      document.getElementById('onboarding-key-input').placeholder = 'gsk_...';
      document.getElementById('onboarding-key-validate').textContent = 'Validate';
      document.getElementById('onboarding-key-hint').textContent = 'Get a free key at console.groq.com. Your key stays on this device.';
      goToStep('key');
      return;
    }
    if (selectedMode === 'local') {
      document.getElementById('onboarding-key-desc').textContent = 'Install Ollama and enter the model name (or leave empty for auto-detect)';
      document.getElementById('onboarding-key-input').placeholder = 'e.g., llama3.1:8b (leave empty for auto-detect)';
      document.getElementById('onboarding-key-validate').textContent = 'Auto-detect';
      document.getElementById('onboarding-key-hint').textContent = 'Your key stays on this device. Never sent to Cognitus servers.';
      goToStep('key');
      return;
    }
    if (selectedMode === 'paid') {
      document.getElementById('onboarding-key-desc').textContent = 'Enter your API key (OpenAI or Anthropic)';
      document.getElementById('onboarding-key-input').placeholder = 'Paste your API key...';
      document.getElementById('onboarding-key-validate').textContent = 'Validate';
      document.getElementById('onboarding-key-hint').textContent = 'Your key stays on this device. Never sent to Cognitus servers.';
      goToStep('key');
      return;
    }
  } else if (currentStep === 'key') {
    // Save the key if using Groq
    const keyInput = document.getElementById('onboarding-key-input');
    const selectedMode = s.onboardingMode;
    if (selectedMode === 'free' && keyInput && keyInput.value.trim()) {
      const key = keyInput.value.trim();
      localStorage.setItem('cognitus_groq_key', key);
      setState({ groqApiKey: key, llmMode: 'groq' });
      getGroq().setApiKey(key);
      localStorage.setItem('cognitus_llm_mode', 'groq');
    } else if (selectedMode === 'paid' && keyInput && keyInput.value.trim()) {
      localStorage.setItem('cognitus_api_key', keyInput.value.trim());
      setState({ llmMode: 'openai' });
      localStorage.setItem('cognitus_llm_mode', 'openai');
    }
    goToStep('template');
  } else if (currentStep === 'template') {
    closeOnboarding();
  }
}

function goBackOnboarding() {
  const s = getState();
  const currentStep = s.onboardingStep || 'mode';
  if (currentStep === 'key') goToStep('mode');
  else if (currentStep === 'template') goToStep('key');
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
  nextBtn.textContent = step === 'template' ? 'Start Analyzing' : 'Next';
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

// ================================================================
// RESIZABLE PANELS
// ================================================================

function initResizablePanels() {
  const resizers = document.querySelectorAll('.resizer');
  let isDragging = false;
  let currentResizer = null;
  let startX = 0;
  let startLeftWidth = 0;
  let startRightWidth = 0;

  resizers.forEach(resizer => {
    resizer.addEventListener('mousedown', (e) => {
      isDragging = true;
      currentResizer = resizer.dataset.resizer;
      startX = e.clientX;

      const leftPanel = document.getElementById('left-panel');
      const rightPanel = document.getElementById('right-panel');
      if (leftPanel) startLeftWidth = leftPanel.offsetWidth;
      if (rightPanel) startRightWidth = rightPanel.offsetWidth;

      resizer.classList.add('resizing');
      document.body.classList.add('resizing');
      e.preventDefault();
    });
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !currentResizer) return;

    const delta = e.clientX - startX;
    const leftPanel = document.getElementById('left-panel');
    const rightPanel = document.getElementById('right-panel');

    if (currentResizer === 'left' && leftPanel) {
      const newW = Math.min(400, Math.max(180, startLeftWidth + delta));
      leftPanel.style.width = newW + 'px';
      leftPanel.style.flex = 'none';
    }

    if (currentResizer === 'right' && rightPanel) {
      const newW = Math.min(500, Math.max(180, startRightWidth - delta));
      rightPanel.style.width = newW + 'px';
      rightPanel.style.flex = 'none';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging && currentResizer) {
      document.querySelectorAll('.resizer').forEach(r => r.classList.remove('resizing'));
      document.body.classList.remove('resizing');
    }
    isDragging = false;
    currentResizer = null;
  });
}
