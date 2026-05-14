const DYNAMIC_COLOR_POOL = [
  'var(--node-technology)',
  'var(--node-business)',
  'var(--node-finance)',
  'var(--node-education)',
  'var(--node-psychology)',
  'var(--node-sociology)',
  'var(--node-custom)',
];

const STATIC_NODE_COLORS = {
  distributor: 'var(--node-distributor)',
  technology: 'var(--node-technology)',
  business: 'var(--node-business)',
  finance: 'var(--node-finance)',
  medical: 'var(--node-medical)',
  legal: 'var(--node-legal)',
  education: 'var(--node-education)',
  science: 'var(--node-science)',
  ethics: 'var(--node-ethics)',
  psychology: 'var(--node-psychology)',
  sociology: 'var(--node-sociology)',
  cross_check: 'var(--node-crosscheck)',
  crosscheck: 'var(--node-crosscheck)',
  synthesizer: 'var(--node-synthesizer)',
};

const STATIC_NODE_ROLES = {
  distributor: 'Routes questions to experts',
  technology: 'Analyzes technical feasibility',
  business: 'Evaluates business strategy',
  finance: 'Assesses financial impact',
  medical: 'Evaluates health implications',
  legal: 'Identifies legal risks',
  education: 'Examines learning dimensions',
  science: 'Applies scientific method',
  ethics: 'Weighs ethical implications',
  psychology: 'Analyzes behavioral factors',
  sociology: 'Examines societal impact',
  cross_check: 'Finds contradictions & agreements',
  synthesizer: 'Produces unified verdict',
};

export function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
  return html;
}

export function isTruncated(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.endsWith('...')) return true;
  if (trimmed.endsWith('\u2026')) return true;
  const lastChar = trimmed[trimmed.length - 1];
  const sentenceEnders = '.!?"\'';
  if (!sentenceEnders.includes(lastChar) && trimmed.length > 50) return true;
  return false;
}

export function getNodeColor(domain) {
  return STATIC_NODE_COLORS[domain] || 'var(--text-muted)';
}

export function getDynamicNodeColor(name, index) {
  return DYNAMIC_COLOR_POOL[index % DYNAMIC_COLOR_POOL.length];
}

export function getNodeRole(domain) {
  return STATIC_NODE_ROLES[domain] || 'Domain expert';
}

export function getConfidenceClass(level) {
  if (level === 'high') return 'high';
  if (level === 'medium') return 'medium';
  if (level === 'low') return 'low';
  return 'neutral';
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function resolveColor(name) {
  const val = cssVar(name);
  if (val.startsWith('var(')) {
    return resolveColor(val.slice(4, -1).trim());
  }
  return val;
}
