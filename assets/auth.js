"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const config = window.DAYMARK_CONFIG || {};
  const SESSION_KEY = "daymark:google:id-token:v2";
  let idToken = null;
  let user = null;
  let authPending = false;
  let authGeneration = 0;

  function decodeExp(token) {
    try {
      const segment = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const info = JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, "=")));
      return Number(info.exp) || 0;
    } catch (_) { return 0; }
  }
  function isFresh(token) { return Boolean(token && decodeExp(token) > Math.floor(Date.now() / 1000) + 35); }
  function getToken() { return isFresh(idToken) ? idToken : null; }
  window.DaymarkBridge.setTokenProvider(getToken);

  function showError(message) {
    const element = $("login-error");
    element.hidden = false;
    element.textContent = message;
  }
  function clearError() { $("login-error").hidden = true; $("login-error").textContent = ""; }

  function screen(name) {
    $("login-screen").hidden = name !== "login";
    $("dashboard").hidden = name !== "dashboard";
    $("history-screen").hidden = name !== "history";
    $("admin-screen").hidden = name !== "admin";
    document.body.className = name === "login" ? "auth-body" : "app-body";
  }

  function logout(message = "") {
    authGeneration++;
    idToken = null;
    user = null;
    document.querySelectorAll("[data-show-admin]").forEach((el) => {el.hidden = true;});
    if (window.DaymarkAdmin) window.DaymarkAdmin.clear();
    sessionStorage.removeItem(SESSION_KEY);
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    screen("login");
    $("login-help").textContent = "Sign in to open your own calendar and saved records.";
    if (message) showError(message); else clearError();
    if (window.DaymarkDashboard) window.DaymarkDashboard.clear();
  }

  async function acceptToken(token) {
    if (authPending) return;
    authPending = true;
    clearError();
    const generation = ++authGeneration;
    $("login-help").textContent = "Verifying your Google account…";
    try {
      // Never trust the JWT payload read in the browser. Apps Script verifies
      // Google's signature and required claims before returning a user profile.
      if (!isFresh(token)) throw new Error("Google sign-in expired. Please sign in again.");
      idToken = token;
      const response = await window.DaymarkBridge.request("bootstrap");
      if (generation !== authGeneration) return;
      user = response.user;
      document.querySelectorAll("[data-show-admin]").forEach((el) => {el.hidden = !user.is_admin;});
      sessionStorage.setItem(SESSION_KEY, token); // per-tab, never in Google Sheets
      const label = user.name || user.email;
      for (const el of document.querySelectorAll("[data-user-name]")) el.textContent = label;
      for (const el of document.querySelectorAll("[data-user-avatar]")) el.textContent = (label || "G").slice(0, 1).toUpperCase();
      screen("dashboard");
      window.DaymarkDashboard.start();
    } catch (error) {
      if (generation !== authGeneration) return;
      idToken = null;
      user = null;
      sessionStorage.removeItem(SESSION_KEY);
      showError(error.message || "Could not sign in. Please try again.");
      $("login-help").textContent = "Sign in to open your own calendar and saved records.";
    } finally { authPending = false; }
  }

  function googleResponse(response) {
    if (!response || !response.credential) { showError("Google did not provide a credential."); return; }
    acceptToken(response.credential);
  }

  function initGoogleSignIn() {
    const placeholder = /REPLACE_|YOUR_CLIENT_ID/.test(String(config.GOOGLE_CLIENT_ID || ""));
    if (placeholder || !window.DaymarkBridge.isConfigured()) {
      showError("Administrator setup required: set GOOGLE_CLIENT_ID and APPS_SCRIPT_URL in config.js, then configure and deploy Google Apps Script. See README.md.");
      return;
    }
    if (!window.google?.accounts?.id) {
      showError("Google Sign-In could not load. Check your connection and content blockers.");
      return;
    }
    google.accounts.id.initialize({client_id: config.GOOGLE_CLIENT_ID, callback: googleResponse, auto_select: false, cancel_on_tap_outside: true});
    google.accounts.id.renderButton($("google-signin-button"), {
      type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", logo_alignment: "left", width: 325,
    });
  }

  function showHistory() {
    if (!getToken()) { logout("Sign in again to view your records."); return; }
    screen("history");
    window.DaymarkHistory.load();
  }
  function showDashboard(refresh = true) {
    if (!getToken()) { logout("Sign in again to view your calendar."); return; }
    screen("dashboard");
    if (refresh) window.DaymarkDashboard.refresh();
  }

  function showAdmin() {
    if (!getToken()) { logout("Sign in again to review records."); return; }
    if (!user?.is_admin) { showDashboard(); return; }
    screen("admin");
    window.DaymarkAdmin.load();
  }
  window.DaymarkAuth = Object.freeze({logout, showDashboard, showHistory, showAdmin, getUser: () => user});
  document.addEventListener("DOMContentLoaded", () => {
    screen("login");
    for (const node of document.querySelectorAll("[data-logout]")) node.addEventListener("click", () => logout());
    for (const node of document.querySelectorAll("[data-show-admin]")) node.addEventListener("click", (e) => {e.preventDefault();showAdmin();});
    for (const node of document.querySelectorAll("[data-show-history]")) node.addEventListener("click", (e) => {e.preventDefault();showHistory();});
    for (const node of document.querySelectorAll("[data-show-dashboard]")) node.addEventListener("click", (e) => {e.preventDefault();showDashboard();});
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (isFresh(saved)) acceptToken(saved);
    else sessionStorage.removeItem(SESSION_KEY);
    window.addEventListener("load", initGoogleSignIn, {once: true});
    if (document.readyState === "complete") initGoogleSignIn();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && user && !getToken()) logout("Your Google sign-in expired. Sign in again; saved records and server timers remain unchanged.");
    });
  });
})();
