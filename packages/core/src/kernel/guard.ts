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

/**
 * Rules are named so that one of them can be withheld for one kind of value.
 *
 * The phone rule is the only rule that matches a bare integer, and a bare integer is the only shape an
 * identifier takes, so it is the only rule a reference has to be excused from. Naming the rule rather
 * than filtering by pattern makes that a one-line, greppable decision instead of an implicit one.
 */
type RuleId = 'email' | 'phone' | 'api-key' | 'github-token' | 'jwt' | 'aws-key';

const REDACTIONS: ReadonlyArray<{ id: RuleId; pattern: RegExp; replacement: string }> = [
  { id: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[email]' },
  {
    id: 'phone',
    pattern: /\b(?:\+?\d{1,3}[ -]?)?(?:\(?\d{3}\)?[ -]?)\d{3}[ -]?\d{4}\b/g,
    replacement: '[phone]',
  },
  { id: 'api-key', pattern: /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, replacement: '[api-key]' },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: '[github-token]' },
  {
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[jwt]',
  },
  { id: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[aws-key]' },
];
/**
 * A field name that declares its value to be a row reference.
 *
 * `product_id`, `item_ids`, bare `id`. Deliberately narrow: `identity`, `identifier` and `paid` are
 * words that end in the letters `id` without naming a key, and a rule that matched them would excuse a
 * value on the strength of a coincidence in English.
 */
const REFERENCE_KEY = /(?:^id$|_ids?$)/i;

/** Whether this string is entirely a digit run -- the only shape a row reference takes here. */
const DIGITS = /^\d+$/;

function applyRules(text: string, except?: RuleId): RedactionResult {
  let output = text;
  let count = 0;
  for (const rule of REDACTIONS) {
    if (rule.id === except) continue;
    output = output.replace(rule.pattern, () => {
      count += 1;
      return rule.replacement;
    });
  }
  return { text: output, count };
}

/**
 * A reference: the phone rule does not apply, and every other rule still does.
 *
 * Withholding the rule instead of bypassing redaction keeps the exemption from swallowing a rule added
 * later. A credential or an address that happens to sit under `*_id` is still redacted, and that is
 * where such values actually leak: `api_key_id` is an identifier-shaped key by construction.
 */
function redactReference(value: string): RedactionResult {
  return applyRules(value, 'phone');
}

/**
 * Half-open `[start, end)` ranges holding an argument whose value is a row reference.
 *
 * The expression matches a whole argument -- one quoted digit run, or a bracketed list of them -- and
 * not merely a keyed value, because a per-key rule keeps the first element of `item_ids=[...]` and
 * redacts the rest. `item_ids=["1615379700", "[phone]"]` is worse than keeping nothing, since a model
 * reading it takes the placeholder for the answer. A list that mixes shapes matches neither alternative
 * and is left whole to the guard, which is the direction that fails closed.
 *
 * The literal is per-call so that `lastIndex` cannot outlive the scan: a module-level global regex is
 * state, and state shared between calls is how a redaction quietly stops redacting.
 */
function referenceSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const pattern =
    /\b[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:\[\s*(?:"\d+"\s*,?\s*)*\]|"\d+"|'\d+'|\d+(?=\s*[,)\]};\n]|$))/g;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const argument = match[0];
    const equals = argument.indexOf('=');
    if (!REFERENCE_KEY.test(argument.slice(0, equals).trim())) continue;
    // The value is digit runs and punctuation, so walking its pieces attributes an offset to each run
    // exactly, with no arithmetic that could drift by the width of a quote.
    const value = argument.slice(equals + 1);
    let offset = 0;
    for (const piece of value.split(/(\d+)/)) {
      if (DIGITS.test(piece)) {
        const start = match.index + equals + 1 + offset;
        spans.push({ start, end: start + piece.length });
      }
      offset += piece.length;
    }
  }
  return spans;
}

export function redact(text: string): RedactionResult {
  const spans = referenceSpans(text);
  if (spans.length === 0) return applyRules(text);
  let output = '';
  let count = 0;
  let cursor = 0;
  for (const span of spans) {
    const before = applyRules(text.slice(cursor, span.start));
    output += before.text;
    count += before.count;
    const reference = redactReference(text.slice(span.start, span.end));
    output += reference.text;
    count += reference.count;
    cursor = span.end;
  }
  const after = applyRules(text.slice(cursor));
  return { text: output + after.text, count: count + after.count };
}

/** Recursive redaction for JSON payloads; strings only, structure preserved. */
export function redactJson(value: import('./types.js').Json): import('./types.js').Json {
  return redactLeaf(undefined, value);
}

/**
 * `key` is the field the value sits under, and it is what makes the exemption possible: digits alone
 * cannot say whether they are a row key or a telephone number, and the field's name can.
 */
function redactLeaf(
  key: string | undefined,
  value: import('./types.js').Json,
): import('./types.js').Json {
  if (typeof value === 'string') {
    return key !== undefined && REFERENCE_KEY.test(key) && DIGITS.test(value)
      ? redactReference(value).text
      : redact(value).text;
  }
  // An array under a reference key is a list of references, so the key reaches the elements.
  if (Array.isArray(value)) return value.map((entry) => redactLeaf(key, entry));
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: import('./types.js').Json } = {};
    for (const [name, entry] of Object.entries(value)) out[name] = redactLeaf(name, entry);
    return out;
  }
  return value;
}
