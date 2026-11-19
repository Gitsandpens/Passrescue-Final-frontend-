/* No credentials belong in this file. Auto mode uses a same-origin PassRescue API
   when available, otherwise the clearly labelled browser heuristic. Once an API
   is selected, a failed calculation is an error, not a silent fallback. */
window.PASSRESCUE_CONFIG = Object.freeze({
  mode: 'auto', // 'auto', 'browser', or 'api'
  apiBase: 'https://passrescue-final-backend.onrender.com', // Optional HTTPS backend origin, with explicitly configured CORS.
  apiTimeoutMs: 60000
});
