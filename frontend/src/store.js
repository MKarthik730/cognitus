const subscribers = new Map();

let state = {
  mode: 'standard',
  situation: '',
  status: 'idle',
  activeTab: 'verdict',
  error: null,
  activeNode: null,

  dynamicNodes: [],
  nodesLoading: false,

  distributor: null,
  domains: [],
  experts: [],
  contradictions: [],
  agreements: [],
  consensusScore: 0.5,
  synthesis: null,

  // Connection state
  connectionStatus: 'disconnected',
  reconnectAttempts: 0,
  isReconnecting: false,

  // Ghost Mode
  ghostLevel: 'off',
  ghostTimer: null,
  ghostDisclosure: null,
  piiRedactions: [],

  // Chat (post-analysis conversation)
  chatMessages: [],
  chatInput: '',
  chatActiveNode: null,
  chatStreaming: false,
  chatVisible: false,

  // Analysis mode
  analysisMode: 'standard',
  modeOutput: null,

  // Assumptions
  assumptions: [],

  // Intelligence Layer
  minorityReport: null,
  whatWouldChangeMyMind: [],
  confidenceBreakdown: null,
  situationDna: null,
  thinkingSteps: [],

  // === NEW FEATURE STATE ===

  // Task 4 - Token Streaming
  streamingNodes: {},        // { nodeName: { tokens: string, active: bool } }
  streamingActive: false,

  // Task 5 - Result Caching
  cacheEnabled: true,
  cacheHits: {},             // { domain: true }
  cacheInfo: null,           // { hits: N, misses: N, keys: [...] }

  // Task 6 - RAG Context Slicing
  ragEnabled: true,
  ragStatus: 'idle',         // idle | chunking | embedding | ready | error
  chunkCount: 0,
  embeddingStatus: null,

  // Task 7 - Cross-Examination (extended)
  crossCheckResult: null,    // full cross-check data object
  crossCheckStep: null,      // which step we're on

  // Task 9 - Data Enrichment
  enrichmentEnabled: true,
  enrichmentStatus: 'idle',  // idle | fetching | enriching | done | error
  enrichmentData: null,

  // Task 10 - Interactive Canvas
  selectedNode: null,        // clicked node for detail view
  tooltipData: null,         // { x, y, content }

  // Task 11 - Export
  exportFormat: 'json',      // json | pdf | share
  exportLoading: false,

  // Task 12 - Eval Harness
  evalRunning: false,
  evalResults: null,

  // Groq API
  groqApiKey: localStorage.getItem('cognitus_groq_key') || '',
  groqModel: 'llama-3.3-70b',

  // Onboarding
  onboardingStep: null,
  onboardingMode: null,

  // Legacy case study
  caseStudy: {
    files: [],
    nodes: [],
    guidingQuestion: '',
    caseContext: '',
    contextCondensed: false,
    analysisStatus: 'idle',
    result: null,
  },
};

export function getState() {
  return state;
}

export function setState(update) {
  const prev = state;
  state = { ...state, ...update };
  for (const [key, fns] of subscribers) {
    if (key in update) {
      for (const fn of fns) fn(state[key], prev[key]);
    }
  }
  if (subscribers.has('*')) {
    for (const fn of subscribers.get('*')) fn(state, prev);
  }
}

export function subscribe(key, fn) {
  if (!subscribers.has(key)) subscribers.set(key, []);
  subscribers.get(key).push(fn);
  return () => {
    const list = subscribers.get(key);
    if (list) {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
  };
}

export function resetState() {
  setState({
    status: 'idle',
    error: null,
    activeNode: null,
    dynamicNodes: [],
    nodesLoading: false,
    distributor: null,
    domains: [],
    experts: [],
    contradictions: [],
    agreements: [],
    consensusScore: 0.5,
    synthesis: null,
    streamingNodes: {},
    streamingActive: false,
    crossCheckResult: null,
    crossCheckStep: null,
    cacheHits: {},
    cacheInfo: null,
    enrichmentStatus: 'idle',
    enrichmentData: null,
    selectedNode: null,
    tooltipData: null,
    thinkingSteps: [],
  });
}

export function handleWsEvent(event) {
  const s = { ...getState() };
  switch (event.type) {
    case 'connection_change':
      s.connectionStatus = event.status || 'disconnected';
      s.reconnectAttempts = event.reconnectAttempts || 0;
      s.isReconnecting = event.reconnecting || false;
      break;

    case 'connection_error':
      s.connectionStatus = 'disconnected';
      s.isReconnecting = false;
      s.error = event.message || 'Connection lost';
      s.status = 'failed';
      break;

    case 'connection_lost':
      s.connectionStatus = 'disconnected';
      s.isReconnecting = false;
      s.error = event.message || 'Connection lost. Click Retry to reconnect.';
      s.status = 'failed';
      break;

    case 'resume_start':
      s.connectionStatus = 'reconnecting';
      s.isReconnecting = true;
      break;

    case 'resume_complete':
      s.connectionStatus = 'connected';
      s.isReconnecting = false;
      break;

    case 'partial_results':
      if (event.data) {
        const partials = event.data;
        const existingExperts = [...s.experts];
        Object.entries(partials).forEach(([domain, data]) => {
          if (!existingExperts.find(e => e.domain === domain)) {
            existingExperts.push({
              domain,
              analysis: data.analysis || data.reasoning || '',
              confidence: data.confidence || 'medium',
              model_used: data.model_used || '',
              processing_time_ms: 0,
            });
          }
        });
        s.experts = existingExperts;
      }
      break;

    case 'node_selection_start':
      s.nodesLoading = true;
      s.dynamicNodes = [];
      s.domains = [];
      break;

    case 'node_selection_complete':
      if (event.nodes && event.nodes.length > 0) {
        s.dynamicNodes = event.nodes;
        s.domains = event.nodes.map(n => n.name);
      }
      s.nodesLoading = false;
      break;

    case 'node_start':
      s.activeNode = event.node;
      // Initialize streaming state for this node
      if (event.node && !event.node.startsWith('case_')) {
        s.streamingNodes = {
          ...s.streamingNodes,
          [event.node]: { tokens: '', active: true },
        };
        s.streamingActive = true;
      }
      break;

    // === TASK 4: Token Streaming ===
    case 'token':
      if (event.node && event.token) {
        const existing = s.streamingNodes[event.node] || { tokens: '', active: true };
        s.streamingNodes = {
          ...s.streamingNodes,
          [event.node]: {
            ...existing,
            tokens: existing.tokens + event.token,
            active: true,
          },
        };
        s.streamingActive = true;
      }
      break;

    case 'stream_end':
      if (event.node) {
        const existing = s.streamingNodes[event.node];
        if (existing) {
          s.streamingNodes = {
            ...s.streamingNodes,
            [event.node]: { ...existing, active: false },
          };
        }
        // Check if any streams remain active
        const anyActive = Object.values(s.streamingNodes).some(n => n.active);
        s.streamingActive = anyActive;
      }
      break;

    // === TASK 5: Result Caching ===
    case 'cache_hit':
      if (event.domain) {
        s.cacheHits = { ...s.cacheHits, [event.domain]: true };
      }
      break;

    case 'cache_miss':
      if (event.domain) {
        s.cacheHits = { ...s.cacheHits, [event.domain]: false };
      }
      break;

    case 'cache_info':
      s.cacheInfo = {
        hits: event.hits || 0,
        misses: event.misses || 0,
        keys: event.keys || [],
      };
      break;

    // === TASK 6: RAG Context Slicing ===
    case 'rag_status':
      s.ragStatus = event.status || 'idle';
      if (event.chunk_count !== undefined) s.chunkCount = event.chunk_count;
      if (event.embedding_status) s.embeddingStatus = event.embedding_status;
      break;

    // === TASK 7: Cross-Examination ===
    case 'cross_check_start':
      s.crossCheckStep = 'checking';
      s.activeNode = 'cross_check';
      break;

    case 'cross_check_complete':
      if (event.data) {
        s.crossCheckResult = event.data;
        s.contradictions = event.data.contradictions ?? [];
        s.agreements = event.data.agreements ?? [];
        s.consensusScore = event.data.consensus_score ?? 0.5;
        s.crossCheckStep = 'done';
        s.activeNode = null;
      }
      break;

    case 'cross_examine_start':
      s.crossCheckStep = 'cross_examining';
      break;

    case 'cross_examine_complete':
      if (event.data) {
        s.crossCheckResult = {
          ...(s.crossCheckResult || {}),
          crossExamination: event.data,
        };
        s.crossCheckStep = 'cross_examined';
      }
      break;

    // === TASK 9: Data Enrichment ===
    case 'enrichment_status':
      s.enrichmentStatus = event.status || 'idle';
      if (event.data) s.enrichmentData = event.data;
      break;

    // === TASK 12: Eval Harness ===
    case 'eval_start':
      s.evalRunning = true;
      s.evalResults = null;
      break;

    case 'eval_progress':
      if (event.results) {
        s.evalResults = event.results;
      }
      break;

    case 'eval_complete':
      s.evalRunning = false;
      if (event.results) {
        s.evalResults = event.results;
      }
      break;

    case 'eval_error':
      s.evalRunning = false;
      s.error = event.error || 'Eval failed';
      break;

    case 'node_complete':
      if (event.node === 'distributor' && event.data?.domains) {
        s.domains = event.data.domains;
        s.distributor = event.data;
        s.activeNode = null;
        // Close streaming for distributor
        s.streamingNodes['distributor'] = { tokens: '', active: false };
      }
      if (event.node === 'cross_check' && event.data) {
        s.contradictions = event.data.contradictions ?? [];
        s.agreements = event.data.agreements ?? [];
        s.consensusScore = event.data.consensus_score ?? 0.5;
        s.crossCheckResult = event.data;
        s.activeNode = null;
        s.streamingNodes['cross_check'] = { tokens: '', active: false };
      }
      if (event.node === 'synthesizer' && event.data) {
        s.synthesis = {
          verdict: event.data.verdict ?? '',
          reasoning: event.data.reasoning ?? '',
          confidence: event.data.confidence ?? 'medium',
          consensus_score: event.data.consensus_score ?? 0.5,
        };
        s.activeNode = null;
        s.streamingNodes['synthesizer'] = { tokens: '', active: false };
        s.streamingActive = false;
      }
      break;

    case 'expert_complete':
      if (event.domain && event.data) {
        s.experts = [
          ...s.experts,
          {
            domain: event.domain,
            analysis: event.data.analysis ?? '',
            confidence: event.data.confidence ?? 'medium',
            model_used: event.data.model_used ?? '',
            processing_time_ms: 0,
          },
        ];
        // Close streaming for this expert
        s.streamingNodes[event.domain] = { tokens: '', active: false };
      }
      break;

    case 'expert_error':
      s.error = `Expert ${event.domain} failed: ${event.error}`;
      if (event.domain) {
        s.streamingNodes[event.domain] = { tokens: '', active: false };
      }
      break;

    case 'case_node_start':
      s.activeNode = event.node;
      s.caseStudy = {
        ...s.caseStudy,
        analysisStatus: event.status || 'analyzing',
        step: event.status || 'analyzing',
      };
      if (event.node) {
        s.streamingNodes[event.node] = { tokens: '', active: true };
        s.streamingActive = true;
      }
      break;

    case 'case_expert_complete':
      if (event.domain && event.data) {
        const prev = s.caseStudy.result?.nodeResults || [];
        s.caseStudy = {
          ...s.caseStudy,
          analysisStatus: 'analyzing',
          result: {
            ...(s.caseStudy.result || {}),
            nodeResults: [
              ...prev,
              {
                domain: event.domain,
                confidence: event.data.confidence || 'medium',
                position: event.data.position || '',
                keyFindings: event.data.keyFindings || '',
                concerns: event.data.concerns || '',
                reasoning: event.data.reasoning || '',
                model_used: event.data.model_used || '',
              },
            ],
          },
        };
        if (event.domain) {
          s.streamingNodes[event.domain] = { tokens: '', active: false };
        }
      }
      break;

    case 'case_cross_check':
      if (event.status === 'cross_checking') {
        s.caseStudy = { ...s.caseStudy, analysisStatus: 'crosschecking' };
      } else if (event.data) {
        s.caseStudy = {
          ...s.caseStudy,
          analysisStatus: 'crosschecking',
          result: {
            ...(s.caseStudy.result || {}),
            crossCheck: event.data,
          },
        };
      }
      break;

    case 'case_synthesize':
      if (event.status === 'synthesizing') {
        s.caseStudy = { ...s.caseStudy, analysisStatus: 'synthesizing' };
      } else if (event.data) {
        s.synthesis = {
          verdict: event.data.verdict || '',
          reasoning: event.data.reasoning || '',
          confidence: event.data.confidence || 'medium',
          consensus_score: event.data.consensus_score || 0.5,
          criticalFindings: event.data.criticalFindings || [],
          unresolvedDisagreements: event.data.unresolvedDisagreements || [],
          recommendations: event.data.recommendations || [],
        };
        s.caseStudy = {
          ...s.caseStudy,
          analysisStatus: 'synthesizing',
        };
      }
      break;

    case 'case_complete':
      s.status = 'completed';
      s.activeNode = null;
      s.streamingActive = false;
      s.caseStudy = {
        ...s.caseStudy,
        analysisStatus: 'completed',
      };
      if (event.data) {
        if (event.data.synthesis) {
          s.synthesis = {
            verdict: event.data.synthesis.verdict || '',
            reasoning: event.data.synthesis.reasoning || '',
            confidence: event.data.synthesis.confidence || 'medium',
            consensus_score: event.data.crossCheck?.consensus_score || 0.5,
          };
        }
        if (event.data.crossCheck) {
          s.contradictions = [];
          s.agreements = [];
          s.consensusScore = event.data.crossCheck.consensus_score || 0.5;
        }
        if (event.data.experts) {
          s.experts = Object.entries(event.data.experts).map(([domain, data]) => ({
            domain,
            analysis: data.reasoning || '',
            confidence: data.confidence || 'medium',
          }));
        }
      }
      break;

    case 'complete':
      if (event.data) {
        s.status = 'completed';
        s.activeNode = null;
        s.streamingActive = false;
        s.synthesis = {
          verdict: event.verdict ?? event.data?.verdict ?? '',
          reasoning: event.synthesis_reasoning ?? event.data?.synthesis_reasoning ?? '',
          confidence: event.synthesis_confidence ?? event.data?.synthesis_confidence ?? 'medium',
          consensus_score: event.consensus_score ?? event.data?.consensus_score ?? 0.5,
        };
        s.consensusScore = event.consensus_score ?? event.data?.consensus_score ?? 0.5;
        s.contradictions = event.contradictions ?? event.data?.contradictions ?? [];
        s.agreements = event.agreements ?? event.data?.agreements ?? [];
        // Close any remaining streaming nodes
        Object.keys(s.streamingNodes).forEach(k => {
          s.streamingNodes[k] = { ...s.streamingNodes[k], active: false };
        });
      }
      break;

    case 'ghost_disclosure':
      s.ghostDisclosure = event.disclosure || null;
      break;

    case 'ghost_timer':
      s.ghostTimer = event.message || null;
      break;

    case 'pii_redactions':
      s.piiRedactions = event.redactions || [];
      break;

    case 'assumptions':
      s.assumptions = event.assumptions || [];
      break;

    case 'thinking_step':
      if (event.node && event.content) {
        s.thinkingSteps = [...s.thinkingSteps, {
          node: event.node,
          step: event.step || 'reasoning',
          content: event.content,
        }];
      }
      break;

    case 'chat_routing':
      s.chatActiveNode = event.node || null;
      if (event.persona) {
        s.chatMessages = [...s.chatMessages, {
          type: 'system',
          node: event.node,
          text: `Routing to ${event.node}...`,
        }];
      }
      break;

    case 'chat_token':
      s.chatStreaming = true;
      break;

    case 'chat_complete':
      s.chatStreaming = false;
      s.chatMessages = [...s.chatMessages, {
        type: 'node',
        node: event.node || 'synthesizer',
        text: event.content || '',
      }];
      break;

    case 'stress_test_complete':
      if (event.data) {
        s.synthesis = {
          ...(s.synthesis || {}),
          stressTest: event.data,
        };
      }
      break;

    case 'mode_output':
      if (event.data) {
        s.modeOutput = event.data;
        s.status = 'completed';
      }
      break;

    case 'error':
      s.error = event.message ?? 'Unknown error';
      s.status = 'failed';
      s.activeNode = null;
      s.nodesLoading = false;
      s.streamingActive = false;
      break;
  }
  setState(s);
}
