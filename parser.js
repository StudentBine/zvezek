// Finds tasks and events inside markdown text.
//
//   - [ ] Buy milk 📅 2026-11-12          -> task (open)
//   - [x] Hand in report due:2026-11-10   -> task (done)
//   - Dentist 📅 2026-11-14 09:30         -> event (a list item with a date but no checkbox)
//   - [ ] Read chapter 3                  -> task without a date (shows only in the Tasks view)
//   1. [ ] Hand in report 📅 2026-11-20  -> numbered task (works like "- [ ]", the number stays)
//
// Repeating items:
//
//   - [ ] Water plants repeat: every week due:2026-11-09
//   - Gym repeat: every monday, wednesday due:2026-11-09 18:00
//   - Standup repeat: every weekday until 2026-12-20 due:2026-11-09 09:30
//
// A ticked task gets "done:2026-11-08".
//
// A category is a #tag on the line (the first one counts):
//
//   - [ ] RIRS kolokvij #kolokvij due:2026-11-13
//
// Older notes use emoji instead (the Obsidian Tasks way): 📅 2026-11-09, 🔁 every week, ✅ 2026-11-08.
// Both spellings are read. Everything Zvezek writes uses the text spelling, and when it changes
// a line that has emoji (ticking, dragging) the whole line is converted (see modernize below).

const TASK_REGEX = /^(\s*)(?:[-*]|\d+[.)]) \[( |x|X)\] (.*)$/;
const LIST_REGEX = /^(\s*)[-*] (.*)$/;
const DATE_REGEX = /(?:📅|due:)\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/;
// "repeat: every week" (or "🔁 every week") up to the next marker (due:, done: ...) or the end of the line
const REPEAT_REGEX = /(?:🔁|\brepeat:)\s*((?:(?!📅|due:|✅|done:|⏳|🛫|➕|❌).)*)/su;
const TAG_REGEX = /(?:^|\s)#(\p{L}[\p{L}\p{N}_-]*)/u;     // "#kolokvij" (must start with a letter, so "#123" is not a tag)
const DONE_DATE_REGEX = /\s*(?:✅|\bdone:)\s*\d{4}-\d{2}-\d{2}/;

// ================= Dates (plain "YYYY-MM-DD" strings, no time zones) =================

function toDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function isRealDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && toIso(toDate(iso)) === iso;
}

function addDays(iso, days) {
  const date = toDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

// Adds whole months. A day that does not exist in the target month becomes its last day
// (the 31st + 1 month = the 28th/29th/30th).
function addMonths(iso, months, dayOfMonth) {
  const date = toDate(iso);
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(year, month, Math.min(dayOfMonth, lastDay))));
}

// 0 = Sunday ... 6 = Saturday
function weekdayOf(iso) {
  return toDate(iso).getUTCDay();
}

// ================= Repeat rules =================

const DAY_NUMBERS = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

// "monday, thursday" or "monday and thursday" -> [1, 4] (or null if a word is not a day)
function parseDayList(text) {
  const days = [];
  for (const word of text.split(/\s*,\s*|\s+and\s+/)) {
    const day = DAY_NUMBERS[word.trim()];
    if (day === undefined) return null;
    if (!days.includes(day)) days.push(day);
  }
  return days.length ? days : null;
}

// Turns the text after 🔁 into a rule, or null when we do not understand it.
//   rule = { unit: 'day' | 'week' | 'month' | 'year', every: 2, days: [1, 4] or null, until: 'YYYY-MM-DD' or null }
function parseRepeat(text) {
  let rest = text.trim().toLowerCase().replace(/\s+/g, ' ');

  let until = null;
  const untilMatch = rest.match(/ until (\d{4}-\d{2}-\d{2})$/);
  if (untilMatch) {
    if (!isRealDate(untilMatch[1])) return null;
    until = untilMatch[1];
    rest = rest.slice(0, untilMatch.index);
  }

  if (!rest.startsWith('every ')) return null;
  rest = rest.slice('every '.length);

  let rule = null;
  if (rest === 'weekday' || rest === 'weekdays') {
    rule = { unit: 'week', every: 1, days: [1, 2, 3, 4, 5] };
  } else {
    // "every 2 weeks", "every month", "every 2 weeks on monday, friday"
    const match = rest.match(/^(?:(\d+) )?(day|week|month|year)s?(?: on (.+))?$/);
    if (match) {
      const every = match[1] ? parseInt(match[1], 10) : 1;
      const days = match[3] ? parseDayList(match[3]) : null;
      if (every >= 1 && !(match[3] && (!days || match[2] !== 'week'))) {
        rule = { unit: match[2], every: every, days: days };
      }
    } else {
      // "every monday, thursday"
      const days = parseDayList(rest);
      if (days) rule = { unit: 'week', every: 1, days: days };
    }
  }

  if (!rule) return null;
  rule.until = until;
  return rule;
}

// All dates of a repeating series that fall between "from" and "to" (inclusive).
// The series starts at "start" (which counts as the first one, even if it is not on a listed weekday).
function occurrences(rule, start, from, to, max = 400) {
  const result = [];
  const stop = rule.until && rule.until < to ? rule.until : to;

  if (start >= from && start <= stop) result.push(start);

  if (rule.days) {
    // Weekdays: go week by week (weeks start on Monday) and pick the listed days
    const monday = addDays(start, -((weekdayOf(start) + 6) % 7));
    for (let week = 0; week < 20000; week += rule.every) {
      const weekStart = addDays(monday, 7 * week);
      if (weekStart > stop) break;
      for (let offset = 0; offset < 7; offset++) {
        const date = addDays(weekStart, offset);
        if (date <= start || date > stop || !rule.days.includes(weekdayOf(date))) continue;
        if (date >= from) result.push(date);
        if (result.length >= max) return result;
      }
    }
    return result;
  }

  const startDay = toDate(start).getUTCDate();
  for (let k = 1; k < 100000; k++) {
    let date;
    if (rule.unit === 'day') date = addDays(start, k * rule.every);
    else if (rule.unit === 'week') date = addDays(start, 7 * k * rule.every);
    else if (rule.unit === 'month') date = addMonths(start, k * rule.every, startDay);
    else date = addMonths(start, 12 * k * rule.every, startDay);

    if (date > stop) break;
    if (date >= from) result.push(date);
    if (result.length >= max) break;
  }
  return result;
}

// The first date after "date" in the series, or null when the series has ended
function nextDate(rule, date) {
  return occurrences(rule, date, addDays(date, 1), '9999-12-31', 1)[0] || null;
}

// ================= Reading a line =================

function findDate(text) {
  const dateMatch = text.match(DATE_REGEX);
  const repeatMatch = text.match(REPEAT_REGEX);
  const rule = repeatMatch ? parseRepeat(repeatMatch[1]) : null;
  const tagMatch = text.match(TAG_REGEX);

  // Remove the markers from the title so it looks clean in the calendar.
  // A repeat text we do not understand stays in the title, so it is not silently lost.
  let title = text;
  if (dateMatch) title = title.replace(dateMatch[0], '');
  if (rule) title = title.replace(repeatMatch[0], '');
  if (tagMatch) title = title.replace(tagMatch[0], ' ');
  title = title.replace(DONE_DATE_REGEX, '').replace(/\s+/g, ' ').trim();

  let repeat = null;
  if (rule) {
    repeat = { text: repeatMatch[1].replace(/\s+until \d{4}-\d{2}-\d{2}\s*$/i, '').trim(), until: rule.until };
  }

  return {
    date: dateMatch ? dateMatch[1] : null,
    time: dateMatch ? dateMatch[2] || null : null,
    title: title,
    repeat: repeat,
    category: tagMatch ? tagMatch[1] : null,
  };
}

// For a line that repeats and has a date: { rule, date, time }. Otherwise null.
function repeatOf(line) {
  const info = findDate(line);
  const repeatMatch = line.match(REPEAT_REGEX);
  if (!repeatMatch || !info.date || !isRealDate(info.date)) return null;
  const rule = parseRepeat(repeatMatch[1]);
  return rule ? { rule: rule, date: info.date, time: info.time } : null;
}

// Returns a list of items found in one file
function parseFile(filePath, content) {
  const items = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const taskMatch = line.match(TASK_REGEX);
    if (taskMatch) {
      const info = findDate(taskMatch[3]);
      items.push({
        type: 'task',
        done: taskMatch[2] !== ' ',
        title: info.title,
        date: info.date,
        time: info.time,
        repeat: info.repeat,
        category: info.category,
        path: filePath,
        line: i,
        raw: line,
      });
      continue;
    }

    const listMatch = line.match(LIST_REGEX);
    if (listMatch) {
      const info = findDate(listMatch[2]);
      // Plain list items only count as events when they have a date
      if (info.date) {
        items.push({
          type: 'event',
          done: false,
          title: info.title,
          date: info.date,
          time: info.time,
          repeat: info.repeat,
          category: info.category,
          path: filePath,
          line: i,
          raw: line,
        });
      }
    }
  }

  return items;
}

// ================= Editing a line =================

// Old emoji spelling -> text spelling:  📅 2026-11-09  ->  due:2026-11-09,
// 🔁 every week  ->  repeat: every week,  ✅ 2026-11-08  ->  done:2026-11-08
function modernize(line) {
  return line
    .replace(/📅\s*(?=\d{4}-\d{2}-\d{2})/g, 'due:')
    .replace(/✅\s*(?=\d{4}-\d{2}-\d{2})/g, 'done:')
    .replace(/🔁\s*/g, 'repeat: ');
}

// Change the checkbox of a task line
function setDone(line, done) {
  return line.replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]');
}

// Change (or add) the date of a line. time can be null.
function setDate(line, date, time) {
  line = modernize(line);
  let newDate = 'due:' + date;
  if (time) {
    newDate += ' ' + time;
  }
  if (DATE_REGEX.test(line)) {
    return line.replace(DATE_REGEX, newDate);
  }
  return line.trimEnd() + ' ' + newDate;
}

// Rewrites one line from edited fields (the calendar popover). Every field is optional:
// title, category ('' = none), repeat (full rule text like "every week until 2026-12-20", '' = none),
// date ('' = none) and time. The checkbox and a done: date stay as they are.
function editLine(line, fields) {
  const m = line.match(/^(\s*(?:[-*]|\d+[.)]) (?:\[[ xX]\] )?)(.*)$/);
  if (!m) throw new Error('This line is not a task or event any more');
  const info = findDate(m[2]);
  const done = m[2].match(DONE_DATE_REGEX);
  const pick = (name, old) => (fields[name] === undefined ? old : fields[name]);

  const title = String(pick('title', info.title)).replace(/\s+/g, ' ').trim();
  const category = pick('category', info.category || '');
  const oldRepeat = info.repeat ? info.repeat.text + (info.repeat.until ? ' until ' + info.repeat.until : '') : '';
  const repeat = String(pick('repeat', oldRepeat)).trim();
  const date = pick('date', info.date || '');
  const time = fields.date === undefined && fields.time === undefined ? info.time : fields.time || null;

  if (!title) throw new Error('Write a title first');
  if (category && !/^\p{L}[\p{L}\p{N}_-]*$/u.test(category)) throw new Error('Category can only have letters, numbers, - and _');
  if (date && !isRealDate(date)) throw new Error('That date does not exist');
  if (time && !/^\d{1,2}:\d{2}$/.test(time)) throw new Error('Time must look like 14:30');
  if (repeat && !parseRepeat(repeat)) throw new Error('Repeat rule not understood');
  if (repeat && !date) throw new Error('Pick a date for a repeating item');

  let out = m[1] + title;
  if (category) out += ' #' + category;
  if (repeat) out += ' repeat: ' + repeat;
  if (date) out += ' due:' + date + (time ? ' ' + time : '');
  if (done) out += ' done:' + done[0].match(/\d{4}-\d{2}-\d{2}/)[0];
  return out;
}

// Ticking a task gives back the line(s) that replace it.
// A normal task: the same line, ticked.
// A repeating task (this is how Obsidian Tasks does it): a new open line with the next date,
// directly above the ticked line, which also gets ✅ and today's date.
function completeTask(line, today) {
  const repeat = repeatOf(line);
  if (!repeat) return [modernize(setDone(line, true))];

  const done = modernize(setDone(line, true)).replace(DONE_DATE_REGEX, '').trimEnd() + ' done:' + today;
  const next = nextDate(repeat.rule, repeat.date);
  if (!next) return [done];                      // the series has ended ("until")
  return [setDate(line, next, repeat.time).replace(DONE_DATE_REGEX, ''), done];
}

// Unticking: back to open, and the ✅ date goes away
function reopenTask(line) {
  return modernize(setDone(line, false)).replace(DONE_DATE_REGEX, '');
}

module.exports = {
  parseFile, setDone, setDate, completeTask, reopenTask,
  parseRepeat, occurrences, nextDate, repeatOf, addDays, isRealDate, modernize, editLine,
};
