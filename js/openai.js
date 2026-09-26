/* Synapse · openai.js
   One implementation of the widely used "OpenAI-compatible" chat API, registered several times:
   Groq (free, no card), Mistral, OpenRouter (free models) and a Custom endpoint.

   Free tiers have small per-minute and per-day token budgets, so this file:
     - waits and retries when the provider says "try again in 23s",
     - shrinks the request when it is slightly too large for the per-minute budget,
     - switches to another model when one is missing, out of daily quota, or overloaded
       (free limits are per model, so this effectively stretches the free allowance).
   These providers have no web search, so references become "suggested topics". */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});
  const { SynapseError, sleep } = S.util;

  /* ---------- helpers ---------- */
  function parseWait(msg) {
    // "Please try again in 6m11.52s", "in 5.289s", "in 250ms", "in 1h2m3s"
    const m = /try again in\s+([0-9hms.\s]+)/i.exec(msg || '');
    if (!m) return 0;
    const t = m[1].trim();
    if (/^[\d.]+ms/.test(t)) return parseFloat(t);
    let ms = 0;
    const h = /(\d+)\s*h/.exec(t), mi = /(\d+)\s*m(?!s)/.exec(t), s = /([\d.]+)\s*s(?!\w)/.exec(t);
    if (h) ms += h[1] * 3600000;
    if (mi) ms += mi[1] * 60000;
    if (s) ms += parseFloat(s[1]) * 1000;
    return ms;
  }

  function mapError(cfg, status, body) {
    const msg = String((body && body.error && (body.error.message || body.error)) || (body && body.message) || '').slice(0, 400);
    const e = (code, message, opts) => new SynapseError(code, message, Object.assign({ status }, opts || {}));
    if (status === 401) return e('invalid_key', cfg.name + ' rejected this API key.', { hint: 'Check the key in Settings. ' + (cfg.keyHint ? 'Keys look like ' + cfg.keyHint + '.' : '') });
    if (status === 403) return e('invalid_key', 'This API key was not accepted.', { hint: msg || 'It may be disabled, or blocked in your region.' });
    if (status === 402) return e('quota', cfg.name + ' needs credits for this request.', { hint: msg || 'Pick a free model in Settings.' });
    if (status === 404 || (status === 400 && /model/i.test(msg) && /(decommission|does not exist|not found|not supported|no longer|unavailable|do not have access|invalid model)/i.test(msg))) {
      return e('model_not_found', 'That model is not available for this key.', { hint: msg });
    }
    if (status === 413) return e('too_large', 'That request was too big for the free per-minute limit.', { hint: msg });
    if (status === 429) {
      const wait = parseWait(msg);
      const daily = /per day|\bTPD\b|\bRPD\b|daily/i.test(msg) || wait > 75000;
      if (daily) return e('quota', "You've used this model's free allowance for now.", { hint: msg || 'Try another model, or wait.', retryable: true });
      const err = e('rate_limit', 'The free speed limit was reached.', { retryable: true, hint: msg });
      err.waitMs = wait || 8000;
      return err;
    }
    if (status >= 500) return e('server', cfg.name + ' is overloaded right now.', { retryable: true, hint: 'Wait a minute and resume, or pick a different model in Settings.' + (msg ? ' (' + msg.slice(0, 100) + ')' : '') });
    return e('bad_request', cfg.name + ' could not process the request.', { hint: msg });
  }

  function make(cfg) {
    const base = () => String(typeof cfg.baseUrl === 'function' ? cfg.baseUrl() : cfg.baseUrl || '').replace(/\/+$/, '');
    const state = { temporary: {} };
    const delays = [3000, 6000, 12000, 20000];

    async function oaFetch(path, { apiKey, body, method, signal, onNotice, attempts }) {
      if (!apiKey) throw new SynapseError('missing_key', 'Add your ' + cfg.name + ' API key to continue.', { hint: 'Open Settings and paste a key.' });
      if (!base()) throw new SynapseError('bad_request', 'Enter the API base URL in Settings.', { hint: 'For example https://api.example.com/v1' });
      const max = attempts || 6;
      let last;
      for (let attempt = 1; attempt <= max; attempt++) {
        let res;
        try {
          res = await fetch(base() + path, {
            method: method || 'POST',
            headers: Object.assign({ Authorization: 'Bearer ' + apiKey }, body ? { 'Content-Type': 'application/json' } : {}),
            body: body ? JSON.stringify(body) : undefined,
            signal,
          });
        } catch (e) {
          if (e && e.name === 'AbortError') throw S.util.abortError();
          last = new SynapseError('network', navigator.onLine === false ? "You're offline." : "Couldn't reach " + cfg.name + '.', {
            retryable: true, cause: e,
            hint: navigator.onLine === false ? 'Reconnect, then resume.' : 'Check your connection. If it keeps failing, this service may not allow requests from a web page (CORS), or an ad-blocker / VPN is in the way. Try another provider in Settings.',
          });
          if (attempt < 3 && navigator.onLine !== false) { if (onNotice) onNotice('Connection hiccup. Retrying…'); await sleep(1200 * attempt, signal); continue; }
          throw last;
        }
        let json = null;
        try { json = await res.json(); } catch (e) { /* non-JSON */ }
        if (res.ok) return json;
        const err = mapError(cfg, res.status, json);
        if ((err.code === 'rate_limit' || err.code === 'server') && attempt < max) {
          const wait = (err.waitMs || delays[Math.min(attempt - 1, delays.length - 1)]) + 400;
          if (onNotice) onNotice((err.code === 'rate_limit' ? 'Free speed limit reached, which is normal on free plans.' : cfg.name + ' is busy.') + ' Continuing in ' + Math.ceil(wait / 1000) + 's (attempt ' + (attempt + 1) + ' of ' + max + ')…');
          await sleep(wait, signal);
          continue;
        }
        throw err;
      }
      throw last;
    }

    const provider = {
      id: cfg.id, name: cfg.name, order: cfg.order || 5, keyUrl: cfg.keyUrl, keyLabel: cfg.keyLabel, keyHint: cfg.keyHint, keySteps: cfg.keySteps,
      note: cfg.note, custom: !!cfg.custom,
      defaultModel: cfg.defaultModel, models: cfg.models || [],
      supportsSearch: false,
      perLesson: !!cfg.perLesson,
      maxTokens: cfg.maxTokens || 8000,

      async listModels({ apiKey, signal }) {
        const json = await oaFetch('/models', { apiKey, method: 'GET', signal, attempts: 2 });
        return (json.data || json.models || [])
          .filter((m) => m && m.id && m.active !== false && (!cfg.pick || cfg.pick(m)))
          .map((m) => m.id)
          .filter((id) => !/(whisper|guard|tts|orpheus|embed|moderation|safeguard|transcri|image|vision-preview|rerank|ocr)/i.test(id));
      },

      rank(ids) {
        const prefs = cfg.prefs || [];
        const score = (id) => { const i = prefs.findIndex((re) => re.test(id)); return i < 0 ? 999 : i; };
        return ids.slice().sort((a, b) => score(a) - score(b));
      },

      async testKey({ apiKey, signal }) {
        const ids = await provider.listModels({ apiKey, signal });
        return { models: ids, suggested: provider.rank(ids)[0] || null };
      },

      /** Runs `run(model, opts)`, switching models if this one is missing, out of quota, or overloaded. */
      async withModel(model, ctx, run) {
        const wanted = model || cfg.defaultModel || '';
        const tmp = state.temporary[wanted];
        let first = (tmp && tmp.until > Date.now() && tmp.model) || wanted;
        if (!first) {
          const ids = await provider.listModels(ctx);
          first = provider.rank(ids)[0];
          if (!first) throw new SynapseError('model_not_found', 'No models are available for this key.', { hint: 'Check the base URL and key in Settings.' });
        }
        try {
          return await run(first, {});
        } catch (e) {
          if (!['model_not_found', 'quota', 'server'].includes(e.code)) throw e;
          const ids = await provider.listModels(ctx).catch(() => []);
          const alts = provider.rank(ids).filter((i) => i !== first).slice(0, 3);
          for (const alt of alts) {
            if (ctx.onNotice) ctx.onNotice('“' + first + '” ' + (e.code === 'quota' ? 'has hit its free limit' : e.code === 'server' ? 'is overloaded' : 'isn’t available') + ', so Synapse is trying “' + alt + '”.');
            try {
              const out = await run(alt, { attempts: 3 });
              state.temporary[wanted] = { model: alt, until: Date.now() + (e.code === 'quota' ? 60 : 10) * 60 * 1000 };
              if (e.code === 'model_not_found') { try { S.store.settings.setModel(cfg.id, alt); } catch (err) { /* best effort */ } }
              return out;
            } catch (e2) {
              if (!['model_not_found', 'quota', 'server', 'too_large'].includes(e2.code)) throw e2;
            }
          }
          throw e;
        }
      },

      async generateJSON({ apiKey, model, system, prompt, signal, temperature, maxTokens, onNotice }) {
        const json = await provider.withModel(model, { apiKey, signal, onNotice }, async (m, o) => {
          const opt = { json: cfg.jsonMode !== false, effort: cfg.id === 'groq' && /gpt-oss/.test(m), temp: true };
          let limit = Math.min(maxTokens || 8000, provider.maxTokens);
          for (let guard = 0; guard < 6; guard++) {
            const body = { model: m, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: limit, stream: false };
            if (opt.temp) body.temperature = temperature == null ? 0.7 : temperature;
            if (opt.json) body.response_format = { type: 'json_object' };
            if (opt.effort) body.reasoning_effort = 'low';
            try {
              return await oaFetch('/chat/completions', { apiKey, body, signal, onNotice, attempts: o.attempts });
            } catch (e) {
              const why = (e.hint || '') + ' ' + e.message;
              if (e.code === 'bad_request') {
                if (opt.json && /response_format|json/i.test(why)) { opt.json = false; continue; }
                if (opt.effort && /reasoning/i.test(why)) { opt.effort = false; continue; }
                if (opt.temp && /temperature/i.test(why)) { opt.temp = false; continue; }
              }
              if (e.code === 'too_large') {
                const mm = /Limit\s+(\d+).*?Requested\s+(\d+)/i.exec(why);
                if (mm) {
                  const next = limit - (Number(mm[2]) - Number(mm[1])) - 250;
                  if (next >= 1200 && next < limit) { limit = next; continue; }
                }
              }
              throw e;
            }
          }
          throw new SynapseError('bad_request', cfg.name + ' could not process the request.', { hint: 'The request kept being adjusted but was still rejected.' });
        });
        const choice = json && json.choices && json.choices[0];
        let text = choice && choice.message && choice.message.content;
        if (Array.isArray(text)) text = text.map((p) => p.text || '').join('');
        text = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (!text) throw new SynapseError('empty', cfg.name + ' returned an empty reply.', { retryable: true });
        return { text, truncated: !!(choice && choice.finish_reason === 'length') };
      },
    };
    return provider;
  }

  const reg = (cfg) => S.providers.register(make(cfg));

  reg({
    id: 'groq', name: 'Groq', order: 1, baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys', keyLabel: 'console.groq.com/keys', keyHint: 'gsk_…',
    keySteps: 'Sign in with Google at console.groq.com, open API Keys, choose Create API Key. No card or phone number needed.',
    note: 'Free and fast, but the free plan has small per-minute and per-day token limits for each model. Synapse writes one lesson at a time, waits when told to, and switches models if one runs out, so a course may take several minutes. There is no web search, so references are suggested topics.',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B · good quality' },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B · strong reasoning' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B · fastest, simpler writing' },
    ],
    prefs: [/llama-4-scout/, /llama-3\.3-70b/, /gpt-oss-120b/, /kimi/, /gpt-oss-20b/, /qwen/, /llama-3\.1-8b/],
    perLesson: true, maxTokens: 5000,
  });

  reg({
    id: 'mistral', name: 'Mistral', order: 2, baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys', keyLabel: 'console.mistral.ai', keyHint: '32 letters and numbers',
    keySteps: 'Create an account at console.mistral.ai, choose the free “Experiment” plan (it asks to verify a phone number), then create an API key.',
    note: 'Generous free plan, so long courses work well. There is no web search, so references are suggested topics.',
    defaultModel: 'mistral-small-latest',
    models: [
      { id: 'mistral-small-latest', label: 'Mistral Small · fast, recommended' },
      { id: 'mistral-medium-latest', label: 'Mistral Medium · better writing' },
      { id: 'mistral-large-latest', label: 'Mistral Large · best quality' },
    ],
    prefs: [/^mistral-small-latest$/, /^mistral-medium-latest$/, /^mistral-large-latest$/, /small/, /nemo/],
    perLesson: false, maxTokens: 16000,
  });

  reg({
    id: 'openrouter', name: 'OpenRouter', order: 3, baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys', keyLabel: 'openrouter.ai/keys', keyHint: 'sk-or-…',
    keySteps: 'Sign in at openrouter.ai, open Keys, create a key. Use models whose name ends in “:free”. No card needed.',
    note: 'Free models are shared and can be slow or busy, and free accounts are limited to about 50 requests a day. There is no web search, so references are suggested topics.',
    defaultModel: 'openrouter/free',
    models: [{ id: 'openrouter/free', label: 'Automatic free model' }],
    pick: (m) => /:free$/.test(m.id) || m.id === 'openrouter/free' || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0),
    prefs: [/^openrouter\/free$/, /llama-3\.3-70b/, /gpt-oss-120b/, /qwen.*(235|72|32)/, /deepseek/, /mistral/, /gemma/],
    perLesson: false, maxTokens: 12000, jsonMode: false,
  });

  reg({
    id: 'custom', name: 'Custom (OpenAI-compatible)', order: 9, custom: true,
    baseUrl: () => (S.store && S.store.settings.get().customBaseUrl) || '',
    keyUrl: '', keyLabel: '', keyHint: '',
    keySteps: 'Any service that offers an OpenAI-style /chat/completions endpoint and allows browser requests.',
    note: 'For advanced use. The service must allow requests from a web page (CORS).',
    defaultModel: '', models: [], prefs: [], perLesson: false, maxTokens: 8000,
  });
})();
