"use strict";
window.DaymarkHistory = (() => {
  const $ = (id) => document.getElementById(id);
  const formatter = new Intl.NumberFormat("en-US");
  const state = {year: null, page: 1, totalPages: 1, serial: 0, loading: false};

  function addCell(row, text, className = "") {
    const cell = document.createElement("td");
    cell.textContent = text;
    if (className) cell.className = className;
    row.appendChild(cell);
    return cell;
  }
  function paint(data) {
    $("history-days").textContent = formatter.format(data.entry_count);
    $("history-total").textContent = formatter.format(data.total_count);
    $("history-page-label").textContent = `Page ${data.page} of ${data.total_pages}`;
    state.totalPages = data.total_pages;
    $("history-prev").disabled = state.page <= 1;
    $("history-next").disabled = state.page >= state.totalPages;
    const tbody = $("history-table-body");
    tbody.replaceChildren();
    if (!data.entries.length) {
      const tr = document.createElement("tr");
      const td = addCell(tr, "No records for this period. Select a day in the calendar to begin.", "history-empty");
      td.colSpan = 5;
      tbody.appendChild(tr);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of data.entries) {
      const tr = document.createElement("tr");
      addCell(tr, entry.day, "day-data");
      const count = addCell(tr, formatter.format(entry.count));
      const bold = document.createElement("strong");
      bold.textContent = count.textContent;
      count.replaceChildren(bold);
      const date = new Date(entry.updated_at_ms);
      addCell(tr, Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
      const statusCell = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = "status-pill " + (entry.status === "APPROVED" ? "status-approved" : "status-pending");
      pill.textContent = entry.status === "APPROVED" ? "Approved" : "Pending review";
      statusCell.appendChild(pill);
      tr.appendChild(statusCell);
      const td = document.createElement("td");
      const anchor = document.createElement("a");
      anchor.href = "#calendar";
      anchor.className = "text-link";
      anchor.textContent = "Open month ↗";
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        window.DaymarkAuth.showDashboard(false);
        window.DaymarkDashboard.jumpTo(Number(entry.day.slice(0, 4)), Number(entry.day.slice(5, 7)));
      });
      td.appendChild(anchor);
      tr.appendChild(td);
      fragment.appendChild(tr);
    }
    tbody.appendChild(fragment);
  }

  async function load() {
    const serial = ++state.serial;
    if (!window.DaymarkAuth.getUser()) return;
    $("history-error").hidden = true;
    state.loading = true;
    try {
      const data = await window.DaymarkBridge.request("history", {year: state.year, page: state.page, pageSize: 35});
      if (serial !== state.serial || !window.DaymarkAuth.getUser()) return;
      paint(data);
    } catch (error) {
      if (serial !== state.serial) return;
      if (error.status === 401) window.DaymarkAuth.logout("Your Google sign-in expired. Sign in again.");
      else { $("history-error").hidden = false; $("history-error").textContent = error.message || "Could not load your history."; }
    } finally {state.loading = false;}
  }

  // Export includes only Google-verified own records. The browser constructs
  // the CSV (rather than exposing a public file or URL for all users).
  async function exportCSV() {
    const button = $("export-csv");
    button.disabled = true;
    $("history-error").hidden = true;
    try {
      const all = [];
      let page = 1;
      let pages = 1;
      do {
        const result = await window.DaymarkBridge.request("history", {year: state.year, page, pageSize: 200});
        all.push(...result.entries);
        pages = result.total_pages;
        page += 1;
      } while (page <= pages);
      const csv = ["Jalali Date,Data Count,Status,Last Saved UTC", ...all.map((item) => {
        const day = item.day; // strictly validated on the server
        return `${day},${item.count},${item.status},${new Date(item.updated_at_ms).toISOString()}`;
      })].join("\r\n") + "\r\n";
      const blob = new Blob(["\uFEFF", csv], {type: "text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `daymark_${state.year || "all_years"}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      $("history-error").hidden = false;
      $("history-error").textContent = error.message || "Unable to export CSV.";
    } finally {button.disabled = false;}
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("history-apply-filter").addEventListener("click", () => {
      state.year = $("year-filter").value || null;
      state.page = 1;
      load();
    });
    $("history-prev").addEventListener("click", () => {if (state.page > 1) {state.page--;load();}});
    $("history-next").addEventListener("click", () => {if (state.page < state.totalPages) {state.page++;load();}});
    $("export-csv").addEventListener("click", exportCSV);
  });
  return Object.freeze({load});
})();
