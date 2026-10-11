"use strict";
/**
 * Google Apps Script does not consistently provide CORS headers for browser fetch.
 * POST a hidden HTML form into a short-lived hidden iframe. The server returns
 * an HtmlService document that posts the response to this site via postMessage.
 * A high-entropy request identifier prevents unrelated messages from resolving
 * requests. The server also targets exactly FRONTEND_ORIGIN on its response.
 *
 * Neither spreadsheet editor permissions nor OAuth client secrets are exposed.
 */
window.DaymarkBridge = (() => {
  const pending = new Map();
  let getToken = () => null;
  const ACTIONS = new Set(["bootstrap", "state", "start", "cancel", "submit", "history", "adminQueue", "adminReview"]);
  const TIMEOUT_MS = 35000;

  function isGoogleScriptOrigin(origin) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.port || url.username || url.password || url.pathname !== "/") return false;
      const host = url.hostname;
      return host === "script.google.com" || host === "script.googleusercontent.com" ||
        /^[a-z0-9-]+-script\.googleusercontent\.com$/.test(host);
    } catch (_) { return false; }
  }

  function isConfigured() {
    const config = window.DAYMARK_CONFIG || {};
    const url = String(config.APPS_SCRIPT_URL || "");
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(url);
  }

  function randomRequestId() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function cleanup(id) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timeout);
    request.iframe.remove();
  }

  function handleMessage(event) {
    if (!isGoogleScriptOrigin(event.origin)) return;
    const data = event.data;
    if (!data || data.channel !== "daymark:response:v2" || typeof data.requestId !== "string") return;
    const request = pending.get(data.requestId);
    if (!request) return;
    cleanup(data.requestId);
    if (data.ok && data.status === 200) request.resolve(data.data);
    else {
      const error = new Error(data.error || "Unable to complete the operation.");
      error.status = data.status;
      request.reject(error);
    }
  }
  window.addEventListener("message", handleMessage);

  function request(action, args = {}) {
    return new Promise((resolve, reject) => {
      if (!ACTIONS.has(action)) { reject(new Error("Unknown operation.")); return; }
      if (!isConfigured()) { reject(new Error("Configure your Apps Script deployment URL in config.js.")); return; }
      const idToken = getToken();
      if (!idToken) { const error = new Error("Sign in using Google first."); error.status = 401; reject(error); return; }
      const id = randomRequestId();
      const iframe = document.createElement("iframe");
      const target = `daymark_result_${id}`;
      iframe.name = target;
      iframe.title = "Background Google Sheets request";
      iframe.tabIndex = -1;
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;border:0;opacity:0;";
      document.body.appendChild(iframe);
      const timeout = setTimeout(() => {
        cleanup(id);
        const error = new Error("Google Apps Script did not respond. Check deployment permissions (Anyone), the Apps Script URL, and your browser's iframe restrictions.");
        error.status = 504;
        reject(error);
      }, TIMEOUT_MS);
      pending.set(id, {resolve, reject, iframe, timeout});
      try {
        const form = document.createElement("form");
        form.action = window.DAYMARK_CONFIG.APPS_SCRIPT_URL;
        form.method = "POST";
        form.target = target;
        form.acceptCharset = "UTF-8";
        form.style.display = "none";
        const fields = {
          request_id: id,
          origin: location.origin,
          payload: JSON.stringify({idToken, action, args}),
        };
        for (const [name, value] of Object.entries(fields)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
        form.remove();
      } catch (error) { cleanup(id); reject(error); }
    });
  }
  function setTokenProvider(provider) { getToken = provider; }
  return Object.freeze({request, setTokenProvider, isConfigured, isGoogleScriptOrigin});
})();
