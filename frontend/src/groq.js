/**
 * Groq API Service — direct browser-to-Groq streaming via fetch.
 *
 * Bypasses the Python backend for node generation.
 * Uses the Groq API key stored in localStorage.
 * Streams tokens back via callback for real-time display.
 *
 * Endpoint: https://api.groq.com/openai/v1/chat/completions
 * Models:  llama-3.3-70b-versatile, mixtral-8x7b-32768, gemma2-9b-it
 */

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const GROQ_MODELS = {
  'llama-3.3-70b': {
    id: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B',
    context: 32768,
    recommended: true,
  },
  'mixtral-8x7b': {
    id: 'mixtral-8x7b-32768',
    label: 'Mixtral 8x7B',
    context: 32768,
  },
  'gemma2-9b': {
    id: 'gemma2-9b-it',
    label: 'Gemma 2 9B',
    context: 8192,
  },
  'llama-3.1-8b': {
    id: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 8B',
    context: 8192,
  },
  'llama-guard-3-8b': {
    id: 'llama-guard-3-8b',
    label: 'Llama Guard 3 8B',
    context: 8192,
  },
};

class GroqService {
  constructor() {
    this.apiKey = localStorage.getItem('cognitus_groq_key') || '';
    this.selectedModel = 'llama-3.3-70b';
    this._abortController = null;
  }

  /**
   * Set or update the API key (stored in localStorage).
   */
  setApiKey(key) {
    this.apiKey = key;
    localStorage.setItem('cognitus_groq_key', key);
  }

  /**
   * Check if the API key is configured.
   */
  hasApiKey() {
    return !!this.apiKey;
  }

  /**
   * Select which model to use.
   */
  setModel(modelKey) {
    if (GROQ_MODELS[modelKey]) {
      this.selectedModel = modelKey;
    }
  }

  /**
   * Get the currently selected model info.
   */
  getModelInfo() {
    return GROQ_MODELS[this.selectedModel] || GROQ_MODELS['llama-3.3-70b'];
  }

  /**
   * Get list of available models for UI.
   */
  static getAvailableModels() {
    return Object.entries(GROQ_MODELS).map(([key, info]) => ({
      key,
      ...info,
    }));
  }

  /**
   * Generate a response from Groq with streaming.
   *
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {object} options - { temperature, max_tokens, system_prompt }
   * @param {function(string)} onToken - Callback for each token
   * @param {function(string)} onComplete - Callback with full text when done
   * @param {function(Error)} onError - Callback on error
   * @returns {Promise<string>} Full generated text
   */
  async generate(messages, options = {}, onToken, onComplete, onError) {
    if (!this.apiKey) {
      const err = new Error('Groq API key not configured. Set it in Settings or in localStorage as cognitus_groq_key.');
      if (onError) onError(err);
      throw err;
    }

    // Abort any previous request
    if (this._abortController) {
      this._abortController.abort();
    }
    this._abortController = new AbortController();

    const modelInfo = this.getModelInfo();
    const systemMessage = options.system_prompt
      ? { role: 'system', content: options.system_prompt }
      : null;

    const body = {
      model: modelInfo.id,
      messages: systemMessage ? [systemMessage, ...messages] : messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 2048,
      stream: true,
    };

    try {
      const response = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: this._abortController.signal,
      });

      if (!response.ok) {
        let errorMsg = `Groq API error: ${response.status}`;
        try {
          const errorBody = await response.json();
          errorMsg += ` — ${errorBody.error?.message || JSON.stringify(errorBody)}`;
        } catch {
          errorMsg += ` ${response.statusText}`;
        }
        const err = new Error(errorMsg);
        if (onError) onError(err);
        throw err;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const token = json.choices?.[0]?.delta?.content || '';
            if (token) {
              fullText += token;
              if (onToken) onToken(token);
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const token = json.choices?.[0]?.delta?.content || '';
            if (token) {
              fullText += token;
              if (onToken) onToken(token);
            }
          } catch {
            // ignore
          }
        }
      }

      this._abortController = null;
      if (onComplete) onComplete(fullText);
      return fullText;

    } catch (e) {
      if (e.name === 'AbortError') {
        // Request was aborted — not an error
        const msg = '[Aborted]';
        if (onComplete) onComplete(msg);
        return msg;
      }
      this._abortController = null;
      if (onError) onError(e);
      throw e;
    }
  }

  /**
   * Abort the current generation request.
   */
  abort() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  /**
   * Validate an API key by making a simple test request.
   *
   * @param {string} key - API key to validate
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async validateApiKey(key) {
    try {
      const response = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key || this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      });

      if (response.ok) {
        return { valid: true };
      }

      let errorMsg = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        errorMsg = body.error?.message || errorMsg;
      } catch {}

      return { valid: false, error: errorMsg };
    } catch (e) {
      return { valid: false, error: e.message || 'Network error' };
    }
  }

  /**
   * Get usage/quota info from the Groq API.
   * Note: Groq doesn't expose a dedicated usage endpoint, but we can check headers.
   */
  async getUsage() {
    try {
      const response = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      });

      return {
        rateLimitRemaining: response.headers.get('x-ratelimit-remaining') || 'unknown',
        rateLimitTotal: response.headers.get('x-ratelimit-limit') || 'unknown',
        rateLimitReset: response.headers.get('x-ratelimit-reset') || 'unknown',
      };
    } catch {
      return null;
    }
  }
}

// Singleton
let _groqInstance = null;

export function getGroq() {
  if (!_groqInstance) {
    _groqInstance = new GroqService();
  }
  return _groqInstance;
}

export { GroqService, GROQ_MODELS };
