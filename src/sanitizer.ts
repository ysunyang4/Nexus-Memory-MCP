/**
 * Nexus Sanitizer - Physical Redaction of Secrets and Credentials
 * 
 * Ensures that no private keys, auth tokens, database credentials, or API keys
 * are ever stored in plain text in memory or handoff packages.
 */
export interface RedactionResult {
  sanitized: string;
  redacted: boolean;
  redactedCount: number;
}

export function redactSensitiveTokensWithStats(input: string): RedactionResult {
  if (!input) return { sanitized: "", redacted: false, redactedCount: 0 };
  let result = input;
  let redactedCount = 0;

  const replaceCounted = (pattern: RegExp, replacement: string) => {
    result = result.replace(pattern, (...args) => {
      redactedCount++;
      return replacement.replace(/\$(\d)/g, (_, idx) => args[Number(idx)] ?? "");
    });
  };

  // 1. Nexus / LocalBridge tokens
  replaceCounted(/lb_[a-zA-Z0-9_-]{16,}/gi, "[REDACTED_LB_TOKEN]");
  replaceCounted(/lbr_[a-zA-Z0-9_-]{16,}/gi, "[REDACTED_LBR_TOKEN]");

  // 2. OpenAI / Anthropic / Gemini / DeepSeek API keys
  replaceCounted(/sk-[a-zA-Z0-9_\-]{20,}/g, "[REDACTED_API_KEY]");

  // 3. GitHub Personal Access Tokens
  replaceCounted(/ghp_[a-zA-Z0-9]{36,}/g, "[REDACTED_GH_TOKEN]");
  replaceCounted(/github_pat_[a-zA-Z0-9_]{50,}/g, "[REDACTED_GH_PAT]");

  // 4. Generic Bearer Tokens
  replaceCounted(/Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi, "Bearer [REDACTED_BEARER_TOKEN]");

  // 5. JWT tokens
  replaceCounted(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, "[REDACTED_JWT]");

  // 6. AWS Access Keys
  replaceCounted(/\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]");

  // 7. PEM Private Key Blocks
  replaceCounted(/-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
  replaceCounted(/-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");

  // 8. Database URI credentials (e.g. postgres://user:pass@host)
  replaceCounted(/([a-zA-Z0-9+.-]+:\/\/[^:\s\/]+):([^@\s\/]+)@/g, "$1:[REDACTED_PASSWORD]@");

  // 9. Plain assignment passwords
  replaceCounted(/(password|passwd|pwd|secret|token)\s*([:=])\s*(['"])(.*?)\3/gi, "$1$2$3[REDACTED]$3");
  replaceCounted(/(password|passwd|pwd|secret|token)\s*=\s*([^\s,;}{'"]+)/gi, "$1=[REDACTED]");

  return {
    sanitized: result,
    redacted: redactedCount > 0,
    redactedCount,
  };
}

export function redactSensitiveTokens(input: string): string {
  return redactSensitiveTokensWithStats(input).sanitized;
}
