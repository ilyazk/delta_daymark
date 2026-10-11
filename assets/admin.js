"use strict";
/** The administrator UI is a convenience, not an authorization boundary.
 *  Every review request is also checked against the verified Google identity
 *  by Google Apps Script. Never put admin secrets in this JavaScript file.
 */
window.DaymarkAdmin = (() => {
  const $ = (id) => document.getElementById(id);
  const numberText = (value) => new Intl.NumberFormat("en-US").format(value);
  const state = {page: 1, totalPages: 1, status: "PENDING", query: "", serial: 0, busy: false};

  function node(tag, className = "", value = null) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== null) element.textContent = String(value);
    return element;
  }
  function errorText(message) {
    const element = $("admin-error");
    element.textContent = message || "";
    element.hidden = !message;
  }
  function makeButton(text, css) {
    const button = node("button", css, text);
    button.type = "button";
    return button;
  }
  function paint(data) {
    $("admin-pending").textContent = numberText(data.stats.pending);
    $("admin-approved").textContent = numberText(data.stats.approved);
    $("admin-rejected").textContent = numberText(data.stats.rejected);
    state.totalPages = data.total_pages;
    $("admin-page-label").textContent = `Page ${data.page} of ${data.total_pages} · ${numberText(data.entry_count)} matching claims`;
    $("admin-prev").disabled = state.page <= 1;
    $("admin-next").disabled = state.page >= state.totalPages;
    const body = $("admin-table-body");
    body.replaceChildren();
    if (!data.entries.length) {
      const row = node("tr");
      const cell = node("td", "history-empty", "No claims match this filter.");
      cell.colSpan = 4;
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of data.entries) {
      const row = node("tr");
      const identity = node("td", "admin-identity");
      identity.appendChild(node("strong", "day-data", entry.day));
      identity.appendChild(node("span", "admin-owner-name", entry.name || "Unknown user"));
      identity.appendChild(node("span", "admin-owner-email", entry.email || entry.subject));
      row.appendChild(identity);

      const count = node("td", "admin-count");
      count.appendChild(node("strong", "", numberText(entry.count)));
      const date = new Date(entry.updated_at_ms);
      count.appendChild(node("small", "", Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—"));
      row.appendChild(count);

      const statusCell = node("td");
      const status = node("span", "status-pill " + (entry.status === "APPROVED" ? "status-approved" : "status-pending"),
        entry.status === "APPROVED" ? "Approved" : "Pending review");
      statusCell.appendChild(status);
      row.appendChild(statusCell);

      const action = node("td", "admin-actions");
      const noteInput = node("input", "admin-reason");
      noteInput.type = "text";
      noteInput.maxLength = 500;
      noteInput.placeholder = "Rejection reason (required)";
      noteInput.setAttribute("aria-label", `Reason for rejecting ${entry.day} by ${entry.email || entry.subject}`);
      noteInput.autocomplete = "off";
      action.appendChild(noteInput);
      const buttons = node("div", "admin-action-buttons");
      const approve = makeButton("Approve ✓", "admin-approve");
      if (entry.status === "APPROVED") approve.hidden = true;
      else approve.addEventListener("click", () => decide(entry, "APPROVE", noteInput, [approve, reject]));
      const reject = makeButton("Reject ×", "admin-reject");
      reject.addEventListener("click", () => decide(entry, "REJECT", noteInput, [approve, reject]));
      buttons.append(approve, reject);
      action.appendChild(buttons);
      row.appendChild(action);
      fragment.appendChild(row);
    }
    body.appendChild(fragment);
  }

  async function load() {
    if (!window.DaymarkAuth?.getUser()?.is_admin) return;
    const serial = ++state.serial;
    errorText("");
    state.busy = true;
    try {
      const data = await window.DaymarkBridge.request("adminQueue", {
        status: state.status, query: state.query, page: state.page, pageSize: 20,
      });
      if (serial !== state.serial || !window.DaymarkAuth?.getUser()?.is_admin) return;
      if (data.page > data.total_pages) {state.page = data.total_pages; await load(); return;}
      paint(data);
    } catch (error) {
      if (serial !== state.serial) return;
      if (error.status === 401) window.DaymarkAuth.logout("Google sign-in expired. Please sign in again.");
      else errorText(error.message || "Could not load administrator review queue.");
    } finally {state.busy = false;}
  }

  async function decide(entry, decision, reason, buttons) {
    if (!window.DaymarkAuth?.getUser()?.is_admin) return;
    const note = reason.value.trim();
    if (decision === "REJECT") {
      if (note.length < 3) {
        errorText("Enter a rejection reason of at least 3 characters before rejecting.");
        reason.focus();
        return;
      }
      if (!window.confirm(`Reject ${entry.day} for ${entry.name || entry.email || entry.subject}? This removes the count from their history and frees the day for new work.`)) return;
    }
    errorText("");
    for (const button of buttons) button.disabled = true;
    try {
      await window.DaymarkBridge.request("adminReview", {
        subject: entry.subject, day: entry.day, decision,
        expected_updated_at_ms: entry.updated_at_ms, note: decision === "REJECT" ? note : "",
      });
      await load();
    } catch (error) {
      errorText(error.message || "Could not save the administrator decision.");
      for (const button of buttons) button.disabled = false;
      if (error.status === 401) window.DaymarkAuth.logout("Google sign-in expired. Please sign in again.");
    }
  }
  function clear() {
    state.serial++;
    state.page = 1;
    state.status = "PENDING";
    state.query = "";
    if ($("admin-status")) $("admin-status").value = "PENDING";
    if ($("admin-search")) $("admin-search").value = "";
    if ($("admin-table-body")) $("admin-table-body").replaceChildren();
    errorText("");
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("admin-status").addEventListener("change", (event) => {
      state.status = event.target.value;
      state.page = 1;
      load();
    });
    $("admin-search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      state.query = $("admin-search").value.trim();
      state.page = 1;
      load();
    });
    $("admin-refresh").addEventListener("click", () => load());
    $("admin-prev").addEventListener("click", () => {if (state.page > 1) {state.page--;load();}});
    $("admin-next").addEventListener("click", () => {if (state.page < state.totalPages) {state.page++;load();}});
  });
  return Object.freeze({load, clear});
})();
