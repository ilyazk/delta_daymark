"use strict";
// Fixed reference dates: leap-year correctness for precisely 1400..1405 SH.
// The 1406 boundary exists solely for validating 1405 Esfand.
window.DaymarkJalali = (() => {
  const START = 1400;
  const END = 1405;
  const NOWRUZ = Object.freeze({
    1400: "2021-03-21", 1401: "2022-03-21", 1402: "2023-03-21",
    1403: "2024-03-20", 1404: "2025-03-21", 1405: "2026-03-21",
    1406: "2027-03-21",
  });
  const EN = ["Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar", "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"];
  const FA = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
  const utcDay = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;
  const anchors = Object.fromEntries(Object.entries(NOWRUZ).map(([year, day]) => [year, utcDay(day)]));

  function daysInMonth(year, month) {
    if (!Number.isInteger(year) || year < START || year > END || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error("Date is outside the supported Jalali calendar.");
    }
    return month <= 6 ? 31 : month <= 11 ? 30 : anchors[year + 1] - anchors[year] - 336;
  }
  function validDay(date) {
    if (typeof date !== "string" || !/^14\d\d\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/.test(date)) return false;
    const [y, m, d] = date.split("/").map(Number);
    try { return d <= daysInMonth(y, m); } catch (_) { return false; }
  }
  function monthInfo(year, month) {
    const days = daysInMonth(year, month);
    const offset = month <= 6 ? (month - 1) * 31 : 186 + (month - 7) * 30;
    const dayNumber = anchors[year] + offset;
    const weekday = new Date(dayNumber * 86400000).getUTCDay();
    return {year, month, days, start_weekday: (weekday + 1) % 7, month_name_en: EN[month - 1], month_name_fa: FA[month - 1]};
  }
  function periodForTehranNow(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const part = (type) => Number(parts.find((p) => p.type === type).value);
    const day = Date.UTC(part("year"), part("month") - 1, part("day")) / 86400000;
    if (day < anchors[START]) return {year: START, month: 1};
    if (day >= anchors[END + 1]) return {year: END, month: 12};
    let year = START;
    for (let y = START; y <= END; y++) if (day >= anchors[y]) year = y;
    const offset = day - anchors[year];
    const month = offset < 186 ? Math.floor(offset / 31) + 1 : Math.floor((offset - 186) / 30) + 7;
    return {year, month};
  }
  return Object.freeze({START, END, EN, FA, daysInMonth, validDay, monthInfo, periodForTehranNow});
})();
