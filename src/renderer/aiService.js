/**
 * AI Service — streaming response layer for the AI Chat Panel.
 *
 * Loaded as a plain <script> tag (no bundler), so it declares a global
 * `aiService` object. The CommonJS export guard at the bottom makes the
 * same object importable by Jest / Node without modification to the browser path.
 *
 * Dispatches real AI requests to the Electron main process via IPC.
 * Supports Ollama (NDJSON streaming) and OpenAI-compatible API (SSE streaming).
 */

const aiService = {

  /**
   * Send a message to the AI backend and stream the response incrementally.
   *
   * Registers one-time IPC event listeners for ai:token / ai:done / ai:error,
   * fires the ai:ask IPC call, then resolves with the full accumulated text.
   *
   * IMPORTANT: removeAIListeners() is called at the start of every invocation
   * to clear any stale listeners left over from a previous (possibly abandoned)
   * request. Only one active getResponse() call at a time is expected.
   *
   * @param {Array<{role: string, content: string}>} messages
   *   Full conversation array: [system, ...history, userTurn].
   *   Built by buildMessages() in index.js.
   * @param {object} model
   *   The active model config from AIConfigManager.getActiveModel().
   *   Must include at minimum: { type, base_url, model_name }.
   * @param {function(string): void} [onToken]
   *   Optional callback fired with each incremental token for streaming UI updates.
   * @returns {Promise<string>}
   *   Resolves with the complete response text when streaming is finished.
   *   Rejects with an Error when the backend reports a failure.
   */
  getResponse(messages, model, onToken) {
    // Clear any stale listeners from a previous call before registering new ones
    window.electronAPI.removeAIListeners()

    return new Promise((resolve, reject) => {
      let fullText = ''

      // Accumulate each token and forward to the streaming UI callback
      window.electronAPI.onAIToken((token) => {
        fullText += token
        if (typeof onToken === 'function') onToken(token)
      })

      // Stream complete — resolve with the full accumulated text
      window.electronAPI.onAIDone(() => {
        window.electronAPI.removeAIListeners()
        resolve(fullText)
      })

      // Backend reported an error — reject so sendMessage() shows an error bubble
      window.electronAPI.onAIError((msg) => {
        window.electronAPI.removeAIListeners()
        reject(new Error(msg))
      })

      // Fire the IPC call; catch synchronous invoke errors (e.g. serialisation failures)
      window.electronAPI.askAI({ model, messages }).catch((err) => {
        window.electronAPI.removeAIListeners()
        reject(err)
      })
    })
  },
}

// CommonJS export — picked up by Jest; ignored when loaded as a browser script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { aiService }
}
