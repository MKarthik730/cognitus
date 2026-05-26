const subscribers = new Map();

let state = {
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
      // Backend is about to replay missed events after reconnect
      s.connectionStatus = 'reconnecting';
      s.isReconnecting = true;
      break;

    case 'resume_complete':
      // Backend has finished replaying events
      s.connectionStatus = 'connected';
      s.isReconnecting = false;
      break;

    case 'partial_results':
      // Backend sent partial node results from a previous session
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
      break;

    case 'node_complete':
      if (event.node === 'distributor' && event.data?.domains) {
        s.domains = event.data.domains;
        s.distributor = event.data;
        s.activeNode = null;
      }
      if (event.node === 'cross_check' && event.data) {
        s.contradictions = event.data.contradictions ?? [];
        s.agreements = event.data.agreements ?? [];
        s.consensusScore = event.data.consensus_score ?? 0.5;
        s.activeNode = null;
      }
      if (event.node === 'synthesizer' && event.data) {
        s.synthesis = {
          verdict: event.data.verdict ?? '',
          reasoning: event.data.reasoning ?? '',
          confidence: event.data.confidence ?? 'medium',
          consensus_score: event.data.consensus_score ?? 0.5,
        };
        s.activeNode = null;
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
      }
      break;

    case 'expert_error':
      s.error = `Expert ${event.domain} failed: ${event.error}`;
      break;

    case 'case_node_start':
      s.activeNode = event.node;
      s.caseStudy = {
        ...s.caseStudy,
        analysisStatus: event.status || 'analyzing',
        step: event.status || 'analyzing',
      };
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
      s.caseStudy = {
        ...s.caseStudy,
        analysisStatus: 'completed',
      };
      if (event.data) {
        if (event.data.synthesis) {
          s.synthesis = {
            verdict: event.data.synthesis.verdict || event.data.synthesis.verdict || '',
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
        s.synthesis = {
          verdict: event.verdict ?? event.data?.verdict ?? '',
          reasoning: event.synthesis_reasoning ?? event.data?.synthesis_reasoning ?? '',
          confidence: event.synthesis_confidence ?? event.data?.synthesis_confidence ?? 'medium',
          consensus_score: event.consensus_score ?? event.data?.consensus_score ?? 0.5,
        };
        s.consensusScore = event.consensus_score ?? event.data?.consensus_score ?? 0.5;
        s.contradictions = event.contradictions ?? event.data?.contradictions ?? [];
        s.agreements = event.agreements ?? event.data?.agreements ?? [];
      }
      break;

    case 'error':
      s.error = event.message ?? 'Unknown error';
      s.status = 'failed';
      s.activeNode = null;
      s.nodesLoading = false;
      break;
  }
  setState(s);
}
