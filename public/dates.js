// Finds dates in a line of text and gives them a short readable label. Used by the editor and
// the preview to draw quiet chips. It only reads text, so it is easy to test (like lists.js).
//
//   due:2026-11-12 14:00     ->  "Thu 12 Nov, 14:00"      (older notes: 📅 2026-11-12 14:00)
//   done:2026-11-08          ->  "done 8 Nov"             (older notes: ✅ 2026-11-08)
//   repeat: every week       ->  "repeats every week"     (older notes: 🔁 every week)

const DateChips = (function () {
  const DUE = /(?:📅|\bdue:)\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/gu;
  const DONE = /(?:✅|\bdone:)\s*(\d{4}-\d{2}-\d{2})/gu;
  const REPEAT = /(?:🔁|\brepeat:)\s*((?:(?!📅|\bdue:|✅|\bdone:).)*)/gu;

  function localToday() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  // "Thu 12 Nov" - with the year when it is not this year. Returns '' for a date that does not exist.
  function dateText(iso, withWeekday = true) {
    const date = new Date(iso + 'T00:00');
    if (isNaN(date) || date.getDate() !== parseInt(iso.slice(8, 10), 10)) return '';
    const options = { day: 'numeric', month: 'short' };
    if (withWeekday) options.weekday = 'short';
    if (iso.slice(0, 4) !== localToday().slice(0, 4)) options.year = 'numeric';
    return date.toLocaleDateString('en-GB', options).replace(',', '');
  }

  function dueText(iso, time) {
    const text = dateText(iso);
    if (!text) return '';
    return time ? text + ', ' + time.padStart(5, '0') : text;
  }

  // 'overdue', 'today' or '' for a due date
  function state(iso) {
    const today = localToday();
    return iso < today ? 'overdue' : iso === today ? 'today' : '';
  }

  // All chips in one line: [{ from, to, kind, label, date }], left to right
  function find(text) {
    const found = [];
    let m;
    DUE.lastIndex = 0;
    while ((m = DUE.exec(text))) {
      const label = dueText(m[1], m[2]);
      if (label) found.push({ from: m.index, to: m.index + m[0].length, kind: 'due', label: label, date: m[1] });
    }
    DONE.lastIndex = 0;
    while ((m = DONE.exec(text))) {
      const label = dateText(m[1], false);
      if (label) found.push({ from: m.index, to: m.index + m[0].length, kind: 'done', label: 'done ' + label, date: m[1] });
    }
    REPEAT.lastIndex = 0;
    while ((m = REPEAT.exec(text))) {
      const rule = m[1].trim();
      if (!rule) continue;
      const length = m[0].length - (m[0].length - m[0].trimEnd().length);
      found.push({ from: m.index, to: m.index + length, kind: 'repeat', label: 'repeats ' + rule, date: null });
    }
    return found.sort((a, b) => a.from - b.from);
  }

  return { find, dateText, dueText, state };
})();

if (typeof module !== 'undefined') module.exports = DateChips;
