/**
 * WebLLM Service — runs LLM inference inside the browser via WebGPU.
 *
 * Loaded via CDN (no npm install needed).
 * Model downloads once to browser IndexedDB cache.
 * Subsequent loads are instant from cache.
 * Zero network requests for inference.
 *
 * Supported browsers: Chrome 113+, Edge 113+
 * Fallback: Free Mode if WebGPU not supported
 *
 * Privacy disclosure:
 *   "Model runs in your browser tab. Nothing leaves your device.
 *    Not even Cognitus servers see your input."
 */

/**
 * Available models via WebLLM:
 *   Llama 3.1 8B     ~4.5GB   recommended default
 *   Phi 3.5 Mini     ~2.2GB   fastest, low VRAM
 *   Gemma 2 2B       ~1.5GB   smallest footprint
 *   Mistral 7B       ~4.0GB   balanced
 *   Qwen 2.5 3B      ~2.0GB   best small reasoning
 */
const WEBLLM_MODELS = {
  'llama-3.1-8b': {
    id: 'Llama-3.1-8B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.1 8B',
    size: '~4.5GB',
    recommended: true,
  },
  'phi-3.5-mini': {
    id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
    label: 'Phi 3.5 Mini',
    size: '~2.2GB',
  },
  'gemma-2-2b': {
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    label: 'Gemma 2 2B',
    size: '~1.5GB',
  },
  'mistral-7b': {
    id: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC',
    label: 'Mistral 7B',
    size: '~4.0GB',
  },
  'qwen-2.5-3b': {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 3B',
    size: '~2.0GB',
  },
};

const CDN_BASE = 'https://unpkg.com/@mlc-ai/web-llm@latest';

class WebLLMService {
  constructor() {
    this.engine = null;
    this.selectedModel = 'llama-3.1-8b';
    this.isLoaded = false;
    this.isLoading = false;
    this.loadProgress = 0;
    this.progressCallback = null;
    this.errorCallback = null;
    this._webllmModule = null;
  }

  /**
   * Check if WebGPU is supported in this browser.
   */
  async isWebGPUSupported() {
    // Check for navigator.gpu
    if (!navigator.gpu) {
      console.warn('WebLLM: WebGPU not available (navigator.gpu not found)');
      return false;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        console.warn('WebLLM: No GPU adapter found');
        return false;
      }
      return true;
    } catch (e) {
      console.warn('WebLLM: WebGPU not supported:', e);
      return false;
    }
  }

  /**
   * Load the WebLLM library from CDN if not already loaded.
   * Returns the CreateMLCEngine function.
   */
  async _loadLibrary() {
    if (this._webllmModule) return this._webllmModule;

    // Dynamic import from CDN
    try {
      const module = await import(/* @vite-ignore */ `${CDN_BASE}/dist/web-llm.min.js`);
      this._webllmModule = module;
      return module;
    } catch (e) {
      console.error('WebLLM: Failed to load library from CDN:', e);
      throw new Error('Failed to load WebLLM library. Check internet connection.');
    }
  }

  /**
   * Set progress callback for model download.
   * @param {function(number, string)} callback - (progress 0-1, status text)
   */
  onProgress(callback) {
    this.progressCallback = callback;
  }

  /**
   * Set error callback.
   * @param {function(string)} callback
   */
  onError(callback) {
    this.errorCallback = callback;
  }

  /**
   * Initialize the WebLLM engine with the selected model.
   * Downloads the model if not cached.
   *
   * @param {string} modelKey - Key from WEBLLM_MODELS
   * @returns {Promise<boolean>} True if loaded successfully
   */
  async initialize(modelKey = null) {
    if (this.isLoaded) return true;
    if (this.isLoading) {
      console.warn('WebLLM: Already loading');
      return false;
    }

    if (modelKey) {
      this.selectedModel = modelKey;
    }

    // Check WebGPU
    const hasWebGPU = await this.isWebGPUSupported();
    if (!hasWebGPU) {
      const error = 'WebGPU not supported. Please use Chrome 113+ or Edge 113+.';
      if (this.errorCallback) this.errorCallback(error);
      throw new Error(error);
    }

    this.isLoading = true;
    this.loadProgress = 0;

    try {
      const webllm = await this._loadLibrary();
      const modelInfo = WEBLLM_MODELS[this.selectedModel];

      if (!modelInfo) {
        throw new Error(`Unknown model: ${this.selectedModel}`);
      }

      if (this.progressCallback) {
        this.progressCallback(0, `Loading ${modelInfo.label} (${modelInfo.size})...`);
      }

      // Create the MLCEngine
      // The CreateMLCEngine function handles downloading and caching
      this.engine = await webllm.CreateMLCEngine(
        modelInfo.id,
        {
          initProgressCallback: (progress) => {
            this.loadProgress = progress.progress || 0;
            if (this.progressCallback) {
              const status = progress.text || `Downloading... ${Math.round(this.loadProgress * 100)}%`;
              this.progressCallback(this.loadProgress, status);
            }
          },
          maxGenLength: 4096,
        }
      );

      this.isLoaded = true;
      this.isLoading = false;

      if (this.progressCallback) {
        this.progressCallback(1, `${modelInfo.label} loaded ✓`);
      }

      console.log(`WebLLM: ${modelInfo.label} loaded successfully`);
      return true;
    } catch (e) {
      this.isLoading = false;
      const msg = `WebLLM initialization failed: ${e.message || e}`;
      console.error(msg);
      if (this.errorCallback) this.errorCallback(msg);
      throw e;
    }
  }

  /**
   * Generate a response using the loaded model.
   *
   * @param {string} system - System prompt
   * @param {string} user - User prompt
   * @param {object} options - { maxGenLength, temperature }
   * @returns {Promise<string>} Generated text
   */
  async generate(system, user, options = {}) {
    if (!this.engine || !this.isLoaded) {
      throw new Error('WebLLM engine not initialized. Call initialize() first.');
    }

    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    const reply = await this.engine.chat.completions.create({
      messages,
      max_tokens: options.maxGenLength || 4096,
      temperature: options.temperature || 0.3,
    });

    return reply.choices[0].message.content || '';
  }

  /**
   * Check if a specific model is already cached in IndexedDB.
   *
   * @param {string} modelKey
   * @returns {Promise<boolean>}
   */
  async isModelCached(modelKey) {
    const modelInfo = WEBLLM_MODELS[modelKey || this.selectedModel];
    if (!modelInfo) return false;

    try {
      const webllm = await this._loadLibrary();
      // Check if model is already cached via WebLLM's API
      const cached = await webllm.hasModelInCache(modelInfo.id);
      return cached;
    } catch (e) {
      console.warn('WebLLM: Failed to check cache:', e);
      return false;
    }
  }

  /**
   * Unload the model and free GPU memory.
   */
  async unload() {
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch (e) {
        console.warn('WebLLM: Error unloading engine:', e);
      }
      this.engine = null;
    }
    this.isLoaded = false;
    this.isLoading = false;
    this.loadProgress = 0;
  }

  /**
   * Get available models list for UI.
   */
  static getAvailableModels() {
    return Object.entries(WEBLLM_MODELS).map(([key, info]) => ({
      key,
      ...info,
    }));
  }
}

// Singleton
let _webllmInstance = null;

export function getWebLLM() {
  if (!_webllmInstance) {
    _webllmInstance = new WebLLMService();
  }
  return _webllmInstance;
}

export { WebLLMService, WEBLLM_MODELS };
