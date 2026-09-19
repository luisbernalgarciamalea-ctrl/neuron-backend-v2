const { createHash } = require('node:crypto');

const prefixes = { gemini: 'GEMINI_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY' };
const cooldowns = new Map();
const preferredKeys = new Map();
const hash = value => createHash('sha256').update(value).digest('hex');

function keyPool(provider) {
  const prefix = prefixes[provider];
  if (!prefix) return [];
  const seen = new Set();
  return [prefix, ...Array.from({ length: 15 }, (_, i) => `${prefix}_${i + 1}`)].flatMap(slot => {
    const key = String(process.env[slot] || '').trim();
    if (!key || seen.has(key)) return [];
    seen.add(key);
    // Keys share quotas unless the owner identifies independently provisioned groups.
    const group = String(process.env[`${slot}_GROUP`] || 'shared').trim();
    return [{ key, id: hash(provider + key), group: hash(provider + ':' + group) }];
  });
}

function resetRoutingState() { cooldowns.clear(); preferredKeys.clear(); }
function cooling(id) { return (cooldowns.get(id) || 0) > Date.now(); }
function cool(id, ms) {
  if (cooldowns.size > 300) for (const [key, until] of cooldowns) if (until <= Date.now()) cooldowns.delete(key);
  cooldowns.set(id, Date.now() + ms);
}
const error = (message, status, code) => Object.assign(new Error(message), { status, code });

async function routeChat({ provider, binary, allowFallback = true, attempt, deadline = Date.now() + 48000, attemptTimeout = 24000 }) {
  const order = ['gemini', 'groq', 'openrouter'];
  const available = order.filter(p => keyPool(p).length);
  if (binary && !['auto', 'gemini'].includes(provider)) throw error('Choose Gemini or Auto for PDF, image, audio, or video attachments.', 400, 'UNSUPPORTED_ATTACHMENT');
  if (provider !== 'auto' && !available.includes(provider)) throw error('The selected provider has no configured key.', 503, 'NOT_CONFIGURED');
  const primary = provider === 'auto' ? (binary ? 'gemini' : available[0]) : provider;
  const candidates = (binary ? ['gemini'] : [primary, ...order.filter(p => p !== primary)])
    .filter(p => available.includes(p)).filter((_, i) => allowFallback || i === 0);
  if (!candidates.length) throw error('No compatible AI provider is configured for this request.', 503, 'NOT_CONFIGURED');
  let attempts = 0, lastError;
  for (const selected of candidates) {
    const pool = keyPool(selected);
    const signature = hash(selected + pool.map(k => k.id).join());
    const first = preferredKeys.get(signature);
    pool.sort((a, b) => Number(b.id === first) - Number(a.id === first));
    const failedGroups = new Set();
    for (const entry of pool) {
      if (cooling(entry.id) || cooling(entry.group) || failedGroups.has(entry.group)) continue;
      const remaining = deadline - Date.now();
      if (remaining < 1000 || attempts >= 6) break;
      attempts++;
      try {
        const timeout = candidates.length > 1 ? Math.min(attemptTimeout, remaining) : remaining;
        const result = await attempt(selected, entry.key, timeout);
        preferredKeys.set(signature, entry.id);
        return { ...result, routing: { usedBackup: selected !== primary || attempts > 1, attempts } };
      } catch (failure) {
        lastError = failure;
        if (failure.code === 'CONTENT_BLOCKED' || failure.status === 422) throw failure;
        if (failure.code === 'PROVIDER_ACCESS') { cool(entry.id, 5 * 60000); continue; }
        if (failure.code === 'QUOTA_EXCEEDED') {
          cool(entry.group, Math.max(1000, Math.min(failure.retryAfterMs || 60000, 24 * 3600000)));
          failedGroups.add(entry.group);
          continue;
        }
        // A model/service error is not fixed by sending the same prompt to every key.
        if (['MODEL_UNAVAILABLE', 'PROVIDER_ERROR', 'TIMEOUT', 'INPUT_TOO_LARGE'].includes(failure.code)) {
          for (const item of pool) cool(item.group, 30000);
          break;
        }
        throw failure;
      }
    }
  }
  if (lastError) throw lastError;
  throw error('The available AI connections are cooling down after a quota or service error. Please try again shortly.', 429, 'PROVIDERS_COOLING_DOWN');
}

module.exports = { keyPool, routeChat, resetRoutingState };
