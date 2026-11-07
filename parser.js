// Finds tasks and events inside markdown text.
//
//   - [ ] Buy milk 📅 2026-11-12          -> task (open)
//   - [x] Hand in report due:2026-11-10   -> task (done)
//   - Dentist 📅 2026-11-14 09:30         -> event (a list item with a date but no checkbox)
//   - [ ] Read chapter 3                  -> task without a date (shows only in the Tasks view)
//   1. [ ] Hand in report 📅 2026-11-20  -> numbered task (works like "- [ ]", the number stays)

const TASK_REGEX = /^(\s*)(?:[-*]|\d+[.)]) \[( |x|X)\] (.*)$/;
const LIST_REGEX = /^(\s*)[-*] (.*)$/;
const DATE_REGEX = /(?:📅|due:)\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/;

function findDate(text) {
  const match = text.match(DATE_REGEX);
  if (!match) {
    return { date: null, time: null, title: text.trim() };
  }
  // Remove the date part from the title so it looks clean in the calendar
  const title = text.replace(match[0], '').replace(/\s+/g, ' ').trim();
  return { date: match[1], time: match[2] || null, title: title };
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
          path: filePath,
          line: i,
          raw: line,
        });
      }
    }
  }

  return items;
}

// Change the checkbox of a task line
function setDone(line, done) {
  return line.replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]');
}

// Change (or add) the date of a line. time can be null.
function setDate(line, date, time) {
  let newDate = '📅 ' + date;
  if (time) {
    newDate += ' ' + time;
  }
  if (DATE_REGEX.test(line)) {
    return line.replace(DATE_REGEX, newDate);
  }
  return line.trimEnd() + ' ' + newDate;
}

module.exports = { parseFile, setDone, setDate };
