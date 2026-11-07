// Helpers for numbered lists in the editor.
//
// The file on disk stays standard markdown: every level is written as "1.", "2.", ...
// and the nesting comes from indentation (4 spaces per level). The hierarchical look
// (1. / 1.1. / 1.1.1.) is only drawn in the preview, with CSS counters.
//
// All functions work on an array of strings (the lines of the note) and do not touch
// the page, so they are easy to test. app.js connects them to the editor.

const ListTools = (function () {
  const INDENT = 4;                                // spaces per nesting level
  const NUMBERED = /^(\s*)(\d+)([.)])( +)(.*)$/;   // "  2. text"  or  "2) text"
  const BULLET = /^(\s*)[-*+] /;

  // Width of the leading whitespace (a tab counts as one level)
  function indentOf(line) {
    const lead = line.match(/^\s*/)[0];
    return lead.replace(/\t/g, ' '.repeat(INDENT)).length;
  }

  function isNumbered(line) {
    return NUMBERED.test(line);
  }

  // A line can be part of a list block when it is a numbered item, or it is indented
  // (a nested bullet, or a paragraph under an item). A blank line or a line at the
  // left edge that is not numbered ends the block.
  function inBlock(line) {
    return isNumbered(line) || (line.trim() !== '' && indentOf(line) > 0);
  }

  // Finds the block of list lines around line index i: returns [start, end] (inclusive)
  function findBlock(lines, i) {
    let start = i;
    let end = i;
    while (start > 0 && inBlock(lines[start - 1])) start--;
    while (end < lines.length - 1 && inBlock(lines[end + 1])) end++;
    return [start, end];
  }

  // The lines that belong under line i: the lines right after it that are indented deeper
  function subtreeEnd(lines, i) {
    const base = indentOf(lines[i]);
    let end = i;
    while (end + 1 < lines.length && lines[end + 1].trim() !== '' && indentOf(lines[end + 1]) > base) {
      end++;
    }
    return end;
  }

  // Rewrites the numbers of one block so every level counts 1, 2, 3, ...
  // A level restarts at 1 under a new parent. The first line keeps its own number,
  // so a list that starts at 5 stays that way.
  function renumber(lines) {
    const out = [];
    const stack = [];   // one entry per open level: { indent, n }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(NUMBERED);
      const indent = indentOf(line);

      if (!m) {
        // A nested bullet closes numbered levels at the same depth or deeper
        if (BULLET.test(line)) {
          while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        }
        out.push(line);
        continue;
      }

      while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();

      let n;
      if (stack.length && stack[stack.length - 1].indent === indent) {
        n = stack[stack.length - 1].n + 1;
        stack[stack.length - 1].n = n;
      } else {
        n = stack.length === 0 ? parseInt(m[2], 10) : 1;
        stack.push({ indent: indent, n: n });
      }
      out.push(m[1] + n + m[3] + m[4] + m[5]);
    }
    return out;
  }

  // Moves lines by one level. direction is +1 (Tab) or -1 (Shift+Tab).
  // Every line in "rows" moves, together with the lines nested under it.
  // Returns { first, count, lines }: the lines from "first" (count of them) are replaced by "lines"; or null when the
  // move is not possible (for example Tab on the first item of a list).
  function shift(lines, rows, direction) {
    const move = new Set();
    for (const row of rows) {
      const end = subtreeEnd(lines, row);
      for (let i = row; i <= end; i++) move.add(i);
    }

    const sorted = Array.from(move).sort((a, b) => a - b);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const [blockStart, blockEnd] = findBlock(lines, first);
    const start = Math.min(blockStart, first);
    const end = Math.max(blockEnd, last);

    // A line may only go one level deeper than the line above it. Anything more would
    // not be a nested list item in markdown any more (it would turn into plain text).
    if (direction > 0) {
      let above = first - 1;
      while (above >= start && lines[above].trim() === '') above--;
      if (above < start || indentOf(lines[first]) > indentOf(lines[above])) return null;
    }

    const block = lines.slice(start, end + 1);
    for (const i of sorted) {
      const line = lines[i];
      if (line.trim() === '') continue;
      const lead = line.match(/^\s*/)[0];
      if (direction > 0) {
        block[i - start] = ' '.repeat(INDENT) + line;
      } else {
        // take away up to one level of spaces (or one tab)
        const spaces = lead.startsWith('\t') ? 1 : Math.min(INDENT, lead.length);
        block[i - start] = line.slice(spaces);
      }
    }

    return { first: start, count: block.length, lines: renumber(block) };
  }

  // Splits a numbered line at character position ch (Enter pressed there).
  // Returns { first, lines, cursor: { line, ch } } or null when the line is not numbered.
  function enter(lines, row, ch) {
    const m = lines[row].match(NUMBERED);
    if (!m) return null;

    const prefix = m[1] + m[2] + m[3] + m[4];
    if (ch < prefix.length) return null;            // cursor is inside the number: leave it alone

    const content = m[5];
    const isTask = /^\[( |x|X)\] /.test(content);
    const emptyItem = content.trim() === '' || /^\[( |x|X)\]\s*$/.test(content.trim());

    // Enter on an empty item: step out one level, or end the list at the left edge
    if (emptyItem) {
      if (indentOf(lines[row]) > 0) {
        const result = shift(lines, [row], -1);
        result.cursor = { line: row, ch: result.lines[row - result.first].length };
        return result;
      }
      const block = findBlock(lines, row);
      const copy = lines.slice(block[0], block[1] + 1);
      copy[row - block[0]] = '';
      return { first: block[0], count: copy.length, lines: renumber(copy), cursor: { line: row, ch: 0 } };
    }

    const before = lines[row].slice(0, ch);
    const after = lines[row].slice(ch);
    const taskPart = isTask ? '[ ] ' : '';
    const newPrefix = m[1] + (parseInt(m[2], 10) + 1) + m[3] + m[4] + taskPart;

    const [start, end] = findBlock(lines, row);
    const copy = lines.slice(start, end + 1);
    copy.splice(row - start, 1, before, newPrefix + after.replace(/^\[( |x|X)\] /, ''));
    const renumbered = renumber(copy);

    // After renumbering, the new line may have a different number; the cursor goes after its prefix
    const newLine = renumbered[row - start + 1];
    const newMatch = newLine.match(NUMBERED);
    const cursorCh = newMatch ? (newMatch[1] + newMatch[2] + newMatch[3] + newMatch[4]).length + taskPart.length : newLine.length;
    return { first: start, count: end - start + 1, lines: renumbered, cursor: { line: row + 1, ch: cursorCh } };
  }

  return { indentOf, isNumbered, findBlock, renumber, shift, enter };
})();

// Lets the same file be loaded by Node for tests (ignored in the browser)
if (typeof module !== 'undefined') module.exports = ListTools;
