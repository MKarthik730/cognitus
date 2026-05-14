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

export const NODE_COLORS_PRESET = [
  'var(--node-medical)',
  'var(--node-legal)',
  'var(--node-technology)',
  'var(--node-business)',
  'var(--node-finance)',
  'var(--node-education)',
  'var(--node-ethics)',
  'var(--node-psychology)',
];

export const PRESET_TEMPLATES = {
  'Medical Team': [
    { name: 'Dr. Sarah Chen', role: 'Lead Diagnostician', behavior: 'Analyze patient symptoms and medical history to provide primary diagnosis. Consider differential diagnoses and recommend further tests.', color: 0 },
    { name: 'Dr. James Wilson', role: 'Pharmacology Specialist', behavior: 'Review treatment options, drug interactions, and contraindications. Provide evidence-based medication recommendations.', color: 1 },
  ],
  'Detective Squad': [
    { name: 'Detective Morgan', role: 'Lead Investigator', behavior: 'Analyze evidence, identify suspects, and establish timelines. Look for inconsistencies in witness statements.', color: 2 },
    { name: 'Inspector Reeves', role: 'Forensic Analyst', behavior: 'Examine physical evidence, forensic data, and crime scene details. Provide technical analysis of findings.', color: 3 },
    { name: 'Detective Park', role: 'Behavioral Analyst', behavior: 'Profile suspect behavior, analyze motives, and assess psychological patterns. Provide insights on likely actions.', color: 4 },
  ],
  'Startup Review': [
    { name: 'Alex Rivera', role: 'Product Strategist', behavior: 'Evaluate product-market fit, feature set, and roadmap. Assess competitive landscape and differentiation.', color: 0 },
    { name: 'Morgan Chen', role: 'Financial Analyst', behavior: 'Review business model, unit economics, burn rate, and revenue projections. Assess financial viability.', color: 1 },
    { name: 'Jordan Kim', role: 'Technical Lead', behavior: 'Assess technical architecture, scalability, development timeline, and technology stack choices.', color: 2 },
  ],
  'Legal Panel': [
    { name: 'Justice Okafor', role: 'Constitutional Expert', behavior: 'Analyze legal precedents, constitutional implications, and fundamental rights aspects of the case.', color: 1 },
    { name: 'Attorney Patel', role: 'Defense Counsel', behavior: 'Build defense strategy, identify procedural issues, and evaluate evidence admissibility.', color: 5 },
  ],
  'Engineering Review': [
    { name: 'Lead Engineer', role: 'Systems Architect', behavior: 'Review system design, architecture decisions, and technical debt. Assess scalability and reliability.', color: 2 },
    { name: 'DevOps Lead', role: 'Infrastructure Specialist', behavior: 'Evaluate deployment strategy, CI/CD pipeline, monitoring, and operational concerns.', color: 6 },
    { name: 'Security Engineer', role: 'Security Auditor', behavior: 'Identify security vulnerabilities, assess threat model, and recommend security improvements.', color: 7 },
    { name: 'QA Lead', role: 'Quality Assurance', behavior: 'Review testing strategy, test coverage, and quality metrics. Identify potential failure points.', color: 4 },
  ],
  'Custom': [],
};

export function truncateFilename(name, maxLen) {
  if (!name) return '';
  maxLen = maxLen || 22;
  if (name.length <= maxLen) return name;
  const dot = name.lastIndexOf('.');
  if (dot === -1) return name.slice(0, maxLen - 3) + '...';
  const ext = name.slice(dot);
  const base = name.slice(0, dot);
  const avail = maxLen - ext.length - 3;
  if (avail < 1) return name.slice(0, maxLen - 3) + '...';
  return base.slice(0, avail) + '...' + ext;
}

export function getFileTypeIcon(type) {
  const t = (type || '').toLowerCase();
  const icons = {
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15h6"/><path d="M12 12v6"/></svg>',
    png: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    jpg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    jpeg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    webp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    md: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M7 15l3-3 3 3"/><path d="M10 12v6"/></svg>',
    txt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    docx: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6"/><path d="M9 17h6"/><path d="M9 9h1"/></svg>',
    csv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
  };
  return icons[t] || icons.txt;
}

export function getFileTypeBadgeClass(type) {
  const t = (type || '').toLowerCase();
  const map = {
    pdf: 'badge-danger',
    png: 'badge-info',
    jpg: 'badge-warning',
    jpeg: 'badge-warning',
    webp: 'badge-info',
    md: 'badge-purple',
    txt: 'badge-neutral',
    docx: 'badge-primary',
    csv: 'badge-success',
  };
  return map[t] || 'badge-neutral';
}
