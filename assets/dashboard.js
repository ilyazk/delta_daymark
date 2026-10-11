"use strict";

(() => {
  const dashboard = document.getElementById("dashboard");
  if (!dashboard) return;

  const $ = (selector) => document.querySelector(selector);
  const grid = $("#calendar-grid");
  const monthSelect = $("#month-select");
  const yearSelect = $("#year-select");
  const timerList = $("#timer-list");
  const recentList = $("#recent-list");
  const initialPeriod = window.DaymarkJalali.periodForTehranNow();
  const initialYear = initialPeriod.year;
  const initialMonth = initialPeriod.month;
  const query = new URLSearchParams(window.location.search);
  const queryYear = Number(query.get("year"));
  const queryMonth = Number(query.get("month"));
  let year = Number.isInteger(queryYear) && queryYear >= 1400 && queryYear <= 1405 ? queryYear : initialYear;
  let month = Number.isInteger(queryMonth) && queryMonth >= 1 && queryMonth <= 12 ? queryMonth : initialMonth;
  let currentState = null;
  let serverOffsetMs = 0;
  let requestSerial = 0;
  let toastTimeout = null;
  const draftCounts = new Map();
  const busyDays = new Set();
  const clockElements = new Map();
  const numberFormatter = new Intl.NumberFormat("en-US");
  const countText = (number) => numberFormatter.format(number);

  function node(tag, className = "", content = null) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== null) element.textContent = String(content);
    return element;
  }

  function showToast(message, isError = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("is-error", isError);
    toast.classList.add("visible");
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("visible"), 4500);
  }

  async function api(action, args = {}) {
    try {
      const data = await window.DaymarkBridge.request(action, args);
      if (typeof data.server_now_ms === "number") serverOffsetMs = data.server_now_ms - Date.now();
      return data;
    } catch (error) {
      if (error.status === 401) window.DaymarkAuth.logout("Your Google sign-in expired. Please sign in again.");
      throw error;
    }
  }

  function setMonth(newYear, newMonth) {
    if (newYear < 1400 || newYear > 1405 || newMonth < 1 || newMonth > 12) return;
    year = newYear;
    month = newMonth;
    monthSelect.value = String(month);
    yearSelect.value = String(year);
    $("#prev-month").disabled = year === 1400 && month === 1;
    $("#next-month").disabled = year === 1405 && month === 12;
    if (window.DaymarkAuth?.getUser()) fetchState();
  }

  function navigate(direction) {
    const absolute = (year - 1400) * 12 + (month - 1) + direction;
    if (absolute < 0 || absolute >= 72) return;
    setMonth(1400 + Math.floor(absolute / 12), (absolute % 12) + 1);
  }

  async function fetchState() {
    if (!window.DaymarkAuth?.getUser()) return;
    const serial = ++requestSerial;
    try {
      const data = await api("state", {year, month});
      if (serial !== requestSerial || !window.DaymarkAuth?.getUser()) return;
      currentState = data;
      renderCalendar();
      renderTimers();
      renderRecent();
      $("#stat-total").textContent = countText(data.stats.total_data);
      $("#stat-days").textContent = countText(data.stats.completed_days);
      $("#stat-pending").textContent = countText(data.stats.pending_days);
      tickCountdowns();
    } catch (error) {
      if (serial === requestSerial) showToast(error.message || "Could not load the calendar.", true);
    }
  }

  function monthDayKey(day) {
    return `${String(year).padStart(4,"0")}/${String(month).padStart(2,"0")}/${String(day).padStart(2,"0")}`;
  }

  function timerForDay(day) {
    return currentState?.active_timers.find((item) => item.day === day) || null;
  }

  function renderCalendar() {
    if (!currentState) return;
    const monthData = currentState.month;
    grid.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < monthData.start_weekday; i++) {
      fragment.appendChild(node("div", "calendar-empty"));
    }
    for (let index = 1; index <= monthData.days; index++) {
      const day = monthDayKey(index);
      const saved = currentState.entries[day] || null;
      const active = timerForDay(day);
      const occupied = currentState.occupied?.[day] || null;
      const isBusy = busyDays.has(day);
      const tile = node("div", "day-cell");
      tile.dataset.day = day;
      tile.classList.toggle("is-saved", Boolean(saved && saved.status === "APPROVED"));
      tile.classList.toggle("is-pending", Boolean(saved && saved.status === "PENDING"));
      tile.classList.toggle("is-occupied", Boolean(occupied));
      tile.classList.toggle("is-active", Boolean(active));
      tile.classList.toggle("is-busy", isBusy);

      const heading = node("div", "day-top");
      const label = node("label", "day-label");
      const check = node("input", "day-checkbox");
      check.type = "checkbox";
      check.checked = Boolean(saved || active);
      check.disabled = Boolean(saved || occupied || isBusy);
      check.setAttribute("aria-label", `${day}: ${saved ? saved.status.toLowerCase() : active ? "timer running" : occupied ? "claimed by another user" : "available"}`);
      check.addEventListener("change", () => changeSelection(day, check.checked));
      label.append(check, node("span", "day-number", index));
      heading.appendChild(label);
      tile.appendChild(heading);

      if (active) {
        const clock = node("div", "day-running-time", "03:00");
        clock.dataset.calendarClock = day;
        tile.appendChild(clock);
        tile.appendChild(node("div", "day-description", saved ? "Editing count" : "Counting now"));
      } else if (saved) {
        tile.appendChild(node("div", "day-count", countText(saved.count)));
        tile.appendChild(node("div", "review-state-label", saved.status === "APPROVED" ? "Approved ✓" : "Pending review"));
        if (saved.status === "PENDING") {
          const edit = node("button", "edit-day", "Edit ↗");
          edit.type = "button";
          edit.disabled = isBusy;
          edit.setAttribute("aria-label", `Edit pending data count for ${day}`);
          edit.addEventListener("click", () => startDay(day, true));
          tile.appendChild(edit);
        }
      } else if (occupied) {
        const labels = {APPROVED: "Claimed ✓", PENDING: "Under review", IN_PROGRESS: "In progress"};
        tile.appendChild(node("div", "day-description", labels[occupied.status] || "Unavailable"));
      } else {
        tile.appendChild(node("div", "day-description", "Select day"));
      }
      fragment.appendChild(tile);
    }
    const renderedCells = monthData.start_weekday + monthData.days;
    const after = (7 - renderedCells % 7) % 7;
    for (let i = 0; i < after; i++) fragment.appendChild(node("div", "calendar-empty"));
    grid.appendChild(fragment);
  }

  async function changeSelection(day, selected) {
    if (selected) await startDay(day, false);
    else await cancelDay(day);
  }

  async function startDay(day, edit) {
    if (busyDays.has(day)) return;
    busyDays.add(day);
    renderCalendar();
    try {
      const outcome = await api("start", {day, edit});
      showToast(outcome.resumed ? `Resumed the active timer for ${day}.` : `Three-minute timer started for ${day}.`);
      await fetchState();
      if (window.innerWidth <= 880) $("#timers-heading").scrollIntoView({behavior: "smooth", block: "start"});
    } catch (error) {
      showToast(error.message, true);
      await fetchState();
    } finally {
      busyDays.delete(day);
      renderCalendar();
    }
  }

  async function cancelDay(day) {
    if (busyDays.has(day)) return;
    busyDays.add(day);
    try {
      await api("cancel", {day});
      draftCounts.delete(day);
      showToast(`Selection removed for ${day}.`);
    } catch (error) { showToast(error.message, true); }
    finally {
      busyDays.delete(day);
      await fetchState();
    }
  }

  async function submitDay(day, input, button) {
    const raw = input.value.trim();
    if (!/^\d+$/.test(raw)) { showToast("Enter a whole number of extracted data (0 or more).", true); input.focus(); return; }
    const count = Number(raw);
    if (!Number.isSafeInteger(count) || count > 999999999) {
      showToast("Enter a number from 0 to 999,999,999.", true); input.focus(); return;
    }
    if (busyDays.has(day)) return;
    busyDays.add(day);
    button.disabled = true;
    try {
      await api("submit", {day, count});
      draftCounts.delete(day);
      showToast(`Submitted ${countText(count)} for ${day}. Awaiting administrator approval.`);
      await fetchState();
    } catch (error) {
      showToast(error.message, true);
      await fetchState();
    } finally { busyDays.delete(day); }
  }

  function emptyTimerState() {
    const wrapper = node("div", "empty-placeholder");
    wrapper.appendChild(node("span", "placeholder-clock", "◷"));
    wrapper.appendChild(node("strong", "", "No timers running"));
    wrapper.appendChild(node("p", "", "Choose one or more dates in the calendar to start."));
    return wrapper;
  }

  function renderTimers() {
    clockElements.clear();
    timerList.replaceChildren();
    if (!currentState || currentState.active_timers.length === 0) {
      timerList.appendChild(emptyTimerState());
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const timer of currentState.active_timers) {
      const day = timer.day;
      const saved = timer.previous_count !== null && timer.previous_count !== undefined;
      const card = node("article", "timer-card");
      card.dataset.timerDay = day;
      const header = node("div", "timer-card-head");
      const left = node("div");
      left.appendChild(node("div", "timer-card-date", day));
      left.appendChild(node("div", "timer-card-subtitle", saved ? "Updating saved count" : "New data count"));
      const clock = node("div", "timer-clock", "03:00");
      header.append(left, clock);
      card.appendChild(header);

      const progress = node("div", "timer-progress");
      const bar = node("div", "timer-progress-bar");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `Remaining time for ${day}`);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "180");
      progress.appendChild(bar);
      card.appendChild(progress);

      const form = node("form", "timer-form-row");
      const input = node("input", "timer-count-input");
      input.type = "number"; input.inputMode = "numeric"; input.step = "1";
      input.min = "0"; input.max = "999999999";
      input.placeholder = "Number of data";
      input.autocomplete = "off";
      input.setAttribute("aria-label", `Data count for ${day}`);
      if (draftCounts.has(day)) input.value = draftCounts.get(day);
      else if (saved) input.value = String(timer.previous_count);
      input.addEventListener("input", () => draftCounts.set(day, input.value));
      const save = node("button", "primary-button timer-save", "Save");
      save.type = "submit";
      form.addEventListener("submit", (event) => { event.preventDefault(); submitDay(day, input, save); });
      form.append(input, save);
      card.appendChild(form);

      const cancel = node("button", "timer-cancel", "Cancel selection");
      cancel.type = "button";
      cancel.addEventListener("click", () => cancelDay(day));
      card.appendChild(cancel);

      const restart = node("button", "timer-restart", "Time ended · Restart 3 minutes");
      restart.type = "button";
      restart.hidden = true;
      restart.addEventListener("click", () => startDay(day, saved));
      card.appendChild(restart);
      fragment.appendChild(card);
      clockElements.set(day, {clock, bar, card, input, save, cancel, restart});
    }
    timerList.appendChild(fragment);
  }

  function renderRecent() {
    recentList.replaceChildren();
    if (!currentState || currentState.recent.length === 0) {
      recentList.appendChild(node("p", "muted", "Your submissions will appear here."));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of currentState.recent) {
      const row = node("div", "activity-row");
      const icon = node("span", "activity-icon", entry.status === "APPROVED" ? "✓" : "◷");
      icon.classList.toggle("is-pending", entry.status === "PENDING");
      const meta = node("div", "activity-meta");
      meta.appendChild(node("span", "activity-day", entry.day));
      meta.appendChild(node("span", "activity-label", entry.status === "APPROVED" ? "Approved by administrator" : "Awaiting administrator review"));
      row.append(icon, meta, node("span", "activity-number", countText(entry.count)));
      fragment.appendChild(row);
    }
    recentList.appendChild(fragment);
  }

  function tickCountdowns() {
    if (!currentState) return;
    const now = Date.now() + serverOffsetMs;
    let active = 0;
    for (const timer of currentState.active_timers) {
      const timeLeftMs = Math.max(0, timer.expires_at_ms - now);
      const remaining = Math.ceil(timeLeftMs / 1000);
      const timeString = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
      const elements = clockElements.get(timer.day);
      if (elements) {
        elements.clock.textContent = remaining > 0 ? timeString : "00:00";
        elements.card.classList.toggle("is-expired", remaining === 0);
        elements.bar.style.width = `${Math.min(100, Math.max(0, timeLeftMs / 180000 * 100))}%`;
        elements.bar.setAttribute("aria-valuenow", String(Math.min(180, remaining)));
        elements.input.disabled = remaining === 0;
        elements.save.disabled = remaining === 0 || busyDays.has(timer.day);
        elements.restart.hidden = remaining > 0;
        elements.cancel.hidden = remaining === 0;
      }
      const calendarClock = grid.querySelector(`[data-calendar-clock="${timer.day}"]`);
      if (calendarClock) calendarClock.textContent = remaining > 0 ? timeString : "Expired";
      if (remaining > 0) active += 1;
    }
    $("#stat-active").textContent = countText(active);
    $("#timer-count-badge").textContent = String(active);
  }

  monthSelect.addEventListener("change", () => setMonth(year, Number(monthSelect.value)));
  yearSelect.addEventListener("change", () => setMonth(Number(yearSelect.value), month));
  $("#prev-month").addEventListener("click", () => navigate(-1));
  $("#next-month").addEventListener("click", () => navigate(1));
  $("#today-button").addEventListener("click", () => setMonth(initialYear, initialMonth));
  $("#refresh-calendar").addEventListener("click", fetchState);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentState) fetchState();
  });
  window.addEventListener("pageshow", (event) => { if (event.persisted) fetchState(); });
  setInterval(tickCountdowns, 250);
  function clear() {
    requestSerial++;
    currentState = null;
    busyDays.clear();
    draftCounts.clear();
    clockElements.clear();
    grid.replaceChildren(node("div", "loading-calendar", "Sign in to load your calendar."));
  }
  function start() { setMonth(year, month); }
  function jumpTo(newYear, newMonth) { setMonth(Number(newYear), Number(newMonth)); }
  window.DaymarkDashboard = Object.freeze({start, refresh: fetchState, jumpTo, clear});
  // Never load private user data before a verified Google Sign-In.
  monthSelect.value = String(month);
  yearSelect.value = String(year);
})();
