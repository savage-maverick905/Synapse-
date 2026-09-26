/* Synapse · providers.js
   The only file that knows how to talk to an AI service.

   A provider is a plain object registered with Synapse.providers.register():
     {
       id, name, keyUrl, defaultModel, models: [{id, label}],
       supportsSearch: boolean,
       generateJSON({ apiKey, model, system, prompt, signal, temperature, maxTokens, onNotice })
            → { text, truncated }
       searchWeb({ apiKey, model, prompt, signal, onNotice })   (optional)
            → { text, chunks: [{uri, title}], supports: [{text, chunkIndices}] }
       testKey({ apiKey, signal })  → resolves or throws SynapseError
     }
   To add another provider later, write one more object like `gemini` below and
   register it. Nothing else in the app needs to change. */
(function () {
  'use strict';
  const S = (window.Synapse = window.Synapse || {});
  const { SynapseError, sleep } = S.util;

  const registry = {};
  const providers = {
    register(p) { registry[p.id] = p; },
    get(id) { return registry[id] || null; },
    list() { return Object.values(registry).sort((a, b) => (a.order || 5) - (b.order || 5)); },
  };

  /* ============================== Gemini ============================== */
  const GEM_BASE = 'https://generativelanguage.googleapis.com/v1beta';

  function parseRetryDelay(err) {
    try {
      const details = (err && err.error && err.error.details) || [];
      for (const d of details) {
        if (d.retryDelay) return Math.ceil(parseFloat(String(d.retryDelay))) * 1000;
      }
      const m = /retry in ([\d.]+)s/i.exec((err && err.error && err.error.message) || '');
      if (m) return Math.ceil(parseFloat(m[1])) * 1000;
    } catch (e) { /* ignore */ }
    return 0;
  }

  function mapHttpError(status, body) {
    const msg = (body && body.error && body.error.message) || '';
    const reason = ((body && body.error && body.error.details) || []).map((d) => d.reason).filter(Boolean).join(' ');
    if (/API key not valid|API_KEY_INVALID|API key expired/i.test(msg + ' ' + reason)) {
      return new SynapseError('invalid_key', 'Gemini rejected this API key.', { status, hint: 'Check the key in Settings. Keys from Google AI Studio start with "AIza".' });
    }
    if (status === 401 || status === 403) {
      return new SynapseError('invalid_key', 'This API key was not accepted.', { status, hint: 'It may be restricted, disabled, or missing access to the Gemini API. ' + (msg ? '(' + msg.slice(0, 140) + ')' : '') });
    }
    if (status === 404) {
      return new SynapseError('model_not_found', 'That Gemini model is not available for this key.', { status, hint: 'Pick a different model in Settings.' });
    }
    if (status === 429) {
      const quota = /quota|RESOURCE_EXHAUSTED|billing/i.test(msg);
      return new SynapseError('rate_limit', quota ? "You've reached Gemini's usage limit for now." : 'Gemini is asking us to slow down.', { status, retryable: true, hint: quota ? 'Wait a minute and resume, or check your quota in Google AI Studio.' : 'Wait a moment and try again.' });
    }
    if (status >= 500) {
      return new SynapseError('server', 'Gemini is overloaded right now.', { status, retryable: true, hint: "Google's servers are busy with this model. Wait a minute and resume, or pick a different model in Settings." + (msg ? ' (' + msg.slice(0, 120) + ')' : '') });
    }
    return new SynapseError('bad_request', 'Gemini could not process the request.' , { status, hint: msg.slice(0, 220) });
  }

  /** fetch with retries for rate limits, overloads and flaky networks. */
  async function gemFetch(path, { apiKey, body, method, signal, onNotice, attempts }) {
    if (!apiKey) throw new SynapseError('missing_key', 'Add your Gemini API key to continue.', { hint: 'Open Settings and paste a key from Google AI Studio.' });
    const maxAttempts = attempts || 5;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res;
      try {
        res = await fetch(GEM_BASE + path, {
          method: method || 'POST',
          headers: Object.assign({ 'x-goog-api-key': apiKey }, body ? { 'Content-Type': 'application/json' } : {}),
          body: body ? JSON.stringify(body) : undefined,
          signal,
        });
      } catch (e) {
        if (e && e.name === 'AbortError') throw S.util.abortError();
        lastErr = new SynapseError('network', navigator.onLine === false ? "You're offline." : "Couldn't reach Gemini.", {
          retryable: true,
          hint: navigator.onLine === false ? 'Reconnect to the internet, then resume.' : 'Check your connection (or any ad-blocker / VPN) and try again.',
          cause: e,
        });
        if (attempt < maxAttempts && navigator.onLine !== false) {
          if (onNotice) onNotice('Connection hiccup. Retrying (attempt ' + (attempt + 1) + ' of ' + maxAttempts + ')…');
          await sleep(1200 * attempt, signal);
          continue;
        }
        throw lastErr;
      }
      let json = null;
      try { json = await res.json(); } catch (e) { /* non-JSON body */ }
      if (res.ok) return json;
      const err = mapHttpError(res.status, json);
      const canRetry = (res.status === 429 || res.status >= 500) && attempt < maxAttempts;
      if (canRetry) {
        const steps = gemini.retryDelays;
        const delay = parseRetryDelay(json) || steps[Math.min(attempt - 1, steps.length - 1)] + Math.floor(Math.random() * 800);
        if (delay <= 45000 && !(err.code === 'rate_limit' && /usage limit/i.test(err.message) && delay > 20000)) {
          if (onNotice) onNotice((res.status === 429 ? 'Rate limit reached.' : 'Gemini is overloaded right now.') + ' Retrying in ' + Math.ceil(delay / 1000) + 's (attempt ' + (attempt + 1) + ' of ' + maxAttempts + ')…');
          await sleep(delay, signal);
          continue;
        }
      }
      throw err;
    }
    throw lastErr;
  }

  function pickText(json) {
    const cand = json && json.candidates && json.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    return parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  }

  function checkBlocked(json) {
    const block = json && json.promptFeedback && json.promptFeedback.blockReason;
    const cand = json && json.candidates && json.candidates[0];
    if (block || (cand && /SAFETY|PROHIBITED|BLOCKLIST/.test(cand.finishReason || '') && !pickText(json))) {
      throw new SynapseError('blocked', "Gemini declined to write about this topic.", { hint: 'Try rephrasing what you want to learn.' });
    }
  }

  /* Gemini 3+ (and the "-latest" aliases that now point at it) want their default sampling settings. */
  const isModern = (m) => /latest/.test(m) || /gemini-(?:[3-9]|\d{2,})/.test(m);

  const gemini = {
    id: 'gemini',
    name: 'Google Gemini',
    order: 4,
    keyLabel: 'Google AI Studio',
    keyHint: 'AIza…',
    keySteps: 'Open Google AI Studio, sign in, and choose Create API key.',
    note: 'Includes live web search, so references can be verified. Free keys are often rate-limited or overloaded.',
    keyUrl: 'https://aistudio.google.com/apikey',
    // "-latest" aliases are maintained by Google, so this keeps working as model names change.
    defaultModel: 'gemini-flash-latest',
    models: [
      { id: 'gemini-flash-latest', label: 'Latest Flash · fast, recommended' },
      { id: 'gemini-pro-latest', label: 'Latest Pro · best writing, slower' },
      { id: 'gemini-flash-lite-latest', label: 'Latest Flash-Lite · lightest' },
    ],
    supportsSearch: true,
    resolved: {}, // requested model -> model that actually worked for this key
    temporary: {}, // requested model -> { model, until } while the first choice is overloaded
    retryDelays: [3000, 6000, 12000, 20000],

    /** Text models this key can actually call. Also proves the key is valid. */
    async listModels({ apiKey, signal }) {
      const json = await gemFetch('/models?pageSize=200', { apiKey, method: 'GET', signal });
      return (json.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((id) => /^gemini-/.test(id) && !/(image|tts|embedding|live|audio|robotics|computer-use|native|aqa|customtools|exp)/.test(id));
    },

    /** Concrete Flash models, newest first (stable before preview, full before lite). */
    rank(ids) {
      return ids
        .map((id) => {
          const m = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?(-preview.*)?$/.exec(id);
          return m ? { id, v: parseFloat(m[1]), lite: !!m[2], preview: !!m[3] } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.v - a.v || a.lite - b.lite || a.preview - b.preview)
        .map((x) => x.id);
    },

    /** Best general-purpose model from a list: the "latest" alias, else the newest Flash, else anything. */
    pickModel(ids) {
      if (ids.includes('gemini-flash-latest')) return 'gemini-flash-latest';
      return gemini.rank(ids)[0] || ids.find((i) => /flash/.test(i)) || ids[0] || null;
    },

    /** Runs `run(model, opts)`. If the model is missing for this key, or stays overloaded,
        switches to another model this key can use instead of failing the whole job. */
    async withModel(model, { apiKey, signal, onNotice }, run) {
      const wanted = model || gemini.defaultModel;
      const tmp = gemini.temporary[wanted];
      const first = (tmp && tmp.until > Date.now() && tmp.model) || gemini.resolved[wanted] || wanted;
      try {
        return await run(first, {});
      } catch (e) {
        if (e.code === 'model_not_found') {
          const ids = await gemini.listModels({ apiKey, signal });
          const alt = gemini.pickModel(ids.filter((i) => i !== first));
          if (!alt) throw new SynapseError('model_not_found', 'This key has no Gemini text model available.', { hint: 'Check that the Gemini API is enabled for your key in Google AI Studio.' });
          gemini.resolved[wanted] = alt;
          if (onNotice) onNotice('“' + first + '” isn’t available for your key, so Synapse is using “' + alt + '”.');
          try {
            const cur = S.store.settings.getModel('gemini');
            if (!cur || cur === wanted) S.store.settings.setModel('gemini', alt);
          } catch (err) { /* settings are best-effort */ }
          return run(alt, {});
        }
        if (e.code === 'server') {
          const ids = await gemini.listModels({ apiKey, signal }).catch(() => []);
          const tried = new Set([first]);
          const alts = gemini.rank(ids).filter((i) => !tried.has(i)).slice(0, 2);
          for (const alt of alts) {
            if (onNotice) onNotice('“' + first + '” is overloaded, so Synapse is trying “' + alt + '” instead.');
            try {
              const out = await run(alt, { attempts: 3 });
              gemini.temporary[wanted] = { model: alt, until: Date.now() + 10 * 60 * 1000 };
              return out;
            } catch (e2) {
              if (e2.code !== 'server' && e2.code !== 'model_not_found') throw e2;
            }
          }
        }
        throw e;
      }
    },

    async generateJSON({ apiKey, model, system, prompt, signal, temperature, maxTokens, onNotice }) {
      const call = (m, limit, withTemp, attempts) => {
        const cfg = { responseMimeType: 'application/json', maxOutputTokens: limit };
        if (withTemp && !isModern(m)) cfg.temperature = temperature == null ? 0.7 : temperature;
        return gemFetch('/models/' + encodeURIComponent(m) + ':generateContent', {
          apiKey, signal, onNotice, attempts,
          body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: cfg },
        });
      };
      const json = await gemini.withModel(model, { apiKey, signal, onNotice }, async (m, o) => {
        const attempt = async (limit, withTemp) => {
          try {
            return await call(m, limit, withTemp, o.attempts);
          } catch (e) {
            const why = e.hint + ' ' + e.message;
            if (e.code !== 'bad_request') throw e;
            // Some models cap output lower, or reject sampling settings: retry once more plainly.
            if (/max.*(output )?tokens?|output token/i.test(why) && limit > 8192) return attempt(8192, withTemp);
            if (withTemp && /temperature|top_?p|top_?k|sampling/i.test(why)) return attempt(limit, false);
            throw e;
          }
        };
        return attempt(maxTokens || 24000, true);
      });
      checkBlocked(json);
      const text = pickText(json);
      const cand = json.candidates && json.candidates[0];
      if (!text.trim()) throw new SynapseError('empty', 'Gemini returned an empty reply.', { retryable: true });
      return { text, truncated: !!(cand && cand.finishReason === 'MAX_TOKENS') };
    },

    async searchWeb({ apiKey, model, prompt, signal, onNotice }) {
      const json = await gemini.withModel(model, { apiKey, signal, onNotice }, (m, o) =>
        gemFetch('/models/' + encodeURIComponent(m) + ':generateContent', {
          apiKey, signal, onNotice, attempts: o.attempts,
          body: { contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 4096 } },
        })
      );
      checkBlocked(json);
      const cand = json.candidates && json.candidates[0];
      const gm = (cand && cand.groundingMetadata) || {};
      return {
        text: pickText(json),
        chunks: (gm.groundingChunks || []).map((c) => ({ uri: c.web && c.web.uri, title: (c.web && c.web.title) || '' })).filter((c) => c.uri),
        supports: (gm.groundingSupports || []).map((s) => ({ text: (s.segment && s.segment.text) || '', chunkIndices: s.groundingChunkIndices || [] })),
      };
    },

    /** Validates the key and returns the models it can use. */
    async testKey({ apiKey, signal }) {
      const ids = await gemini.listModels({ apiKey, signal });
      return { models: ids, suggested: gemini.pickModel(ids) };
    },
  };

  providers.register(gemini);
  S.providers = providers;
})();
