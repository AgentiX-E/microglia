/**
 * Prompt-injection screening for knowledge that will be rendered into a prompt.
 *
 * Feedback text is attacker-reachable in any host that accepts user edits. The
 * primary defence is structural — knowledge is rendered as quoted data, never as
 * instructions — but a screen is still required, because a host may render a
 * statement itself and because an item that *reads* as a command is a signal
 * that the distillation step failed.
 *
 * The screen is intentionally narrow. It flags known instruction shapes rather
 * than "suspicious" words, so a legitimate constraint such as "exclude cancelled
 * orders" is never rejected for containing a verb.
 */
export type GuardFinding = {
  readonly code:
    | 'MG_G_CONTROL_CHAR'
    | 'MG_G_INSTRUCTION_OVERRIDE'
    | 'MG_G_ROLE_MARKER'
    | 'MG_G_SYSTEM_PROMPT'
    | 'MG_G_SCRIPT'
    | 'MG_G_EXFILTRATION';
  readonly severity: 'high' | 'medium';
  readonly excerpt: string;
};

const RULES: ReadonlyArray<{ code: GuardFinding['code']; severity: GuardFinding['severity']; pattern: RegExp }> = [
  {
    code: 'MG_G_INSTRUCTION_OVERRIDE',
    severity: 'high',
    pattern: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|system)\b[^.\n]{0,20}\b(instruction|prompt|rule|direction)s?\b/i,
  },
  {
    code: 'MG_G_ROLE_MARKER',
    severity: 'high',
    pattern: /(<\|im_start\|>|<\|im_end\|>|\[\/?INST\]|<<\/?SYS>>|<\|system\|>|<\|user\|>|<\|assistant\|>)/i,
  },
  {
    code: 'MG_G_SYSTEM_PROMPT',
    severity: 'high',
    pattern: /\b(reveal|print|repeat|output|show)\b[^.\n]{0,30}\b(system prompt|hidden prompt|instructions above)\b/i,
  },
  {
    code: 'MG_G_SCRIPT',
    severity: 'medium',
    pattern: /<\s*script\b|javascript:\s*|data:text\/html/i,
  },
  {
    code: 'MG_G_EXFILTRATION',
    severity: 'medium',
    pattern: /\b(send|post|upload|exfiltrate)\b[^.\n]{0,30}\b(api[ _-]?key|token|credential|password|secret)\b/i,
  },
];

export function scanForInjection(text: string): readonly GuardFinding[] {
  const findings: GuardFinding[] = [];
  const control = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
  const controlMatch = control.exec(text);
  if (controlMatch) {
    findings.push({
      code: 'MG_G_CONTROL_CHAR',
      severity: 'high',
      // `index` is where the match starts, so `charCodeAt` is always a number;
      // reading the code point off the matched string would need a fallback for
      // a case the regex cannot produce.
      excerpt: `U+${text.charCodeAt(controlMatch.index).toString(16).toUpperCase().padStart(4, '0')}`,
    });
  }
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      findings.push({
        code: rule.code,
        severity: rule.severity,
        excerpt: match[0].slice(0, 120),
      });
    }
  }
  return findings;
}

export function hasHighSeverity(findings: readonly GuardFinding[]): boolean {
  return findings.some((finding) => finding.severity === 'high');
}

/**
 * Redaction runs before persistence, not at export time.
 *
 * A redaction performed when the dataset is exported has already written the
 * secret to disk once; the point of capturing feedback locally is that it must
 * be safe to keep.
 */
export type RedactionResult = {
  readonly text: string;
  readonly count: number;
};

const REDACTIONS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[email]' },
  { pattern: /\b(?:\+?\d{1,3}[ -]?)?(?:\(?\d{3}\)?[ -]?)\d{3}[ -]?\d{4}\b/g, replacement: '[phone]' },
  { pattern: /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, replacement: '[api-key]' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: '[github-token]' },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: '[jwt]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[aws-key]' },
];

/** Recursive redaction for JSON payloads; strings only, structure preserved. */
export function redactJson(value: import('./types.js').Json): import('./types.js').Json {
  if (typeof value === 'string') return redact(value).text;
  if (Array.isArray(value)) return value.map((entry) => redactJson(entry));
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: import('./types.js').Json } = {};
    for (const [key, entry] of Object.entries(value)) out[key] = redactJson(entry);
    return out;
  }
  return value;
}

export function redact(text: string): RedactionResult {
  let output = text;
  let count = 0;
  for (const rule of REDACTIONS) {
    output = output.replace(rule.pattern, () => {
      count += 1;
      return rule.replacement;
    });
  }
  return { text: output, count };
}
