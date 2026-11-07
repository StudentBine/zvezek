// When a note moves to another folder, its relative image links must keep pointing at the
// same files. This rewrites them. The image files themselves are never touched.
//
//   ![](pics/a.png)           markdown image
//   ![](pics/my%20pic.png)    encoded path (Trilium exports look like this)
//   ![](<pics/my pic.png>)    path with spaces in <>
//   <img src="pics/a.png">    html image
//
// Left alone: http(s):, data:, //host, /absolute and /files/ links, anything inside
// ``` code blocks or `inline code`, and links that go above the notes folder.

const MARKDOWN_IMAGE = /(!\[[^\]]*\]\()(<[^>\n]*>|[^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'))?\s*\))/g;
const HTML_IMAGE = /(<img\b[^>]*?\ssrc\s*=\s*)(["'])(.*?)\2/gi;
const NOT_RELATIVE = /^([a-z][a-z0-9+.-]*:|\/|#|$)/i;   // "http:", "data:", "//host", "/abs", "#x", ""

function parts(folder) {
  return folder.split('/').filter(Boolean);
}

function encodePath(path) {
  return path.split('/').map((p) => encodeURIComponent(p).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/');
}

// Returns the new link text for one link, or null to leave it as it is.
// fromDir and toDir are folders relative to the notes folder: "" (top level), "School", "A/B".
function newLink(link, fromDir, toDir) {
  const angle = link.startsWith('<') && link.endsWith('>');
  const text = angle ? link.slice(1, -1) : link;
  if (NOT_RELATIVE.test(text)) return null;

  const suffixAt = text.search(/[?#]/);
  const pathPart = suffixAt === -1 ? text : text.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? '' : text.slice(suffixAt);

  let decoded = pathPart;
  if (!angle) {
    try { decoded = decodeURIComponent(pathPart); } catch (err) { return null; }
  }

  // Where does the link point now? (a list of folder names ending with the file name)
  const target = parts(fromDir);
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (target.length === 0) return null;   // goes above the notes folder: cannot be fixed
      target.pop();
    } else {
      target.push(part);
    }
  }

  // Path from the new folder to the same file
  const to = parts(toDir);
  let common = 0;
  while (common < to.length && common < target.length - 1 && to[common] === target[common]) common++;
  const relative = '../'.repeat(to.length - common) + target.slice(common).join('/');

  if (relative === decoded) return null;   // already right: keep the original text
  return (angle ? '<' + relative + suffix + '>' : encodePath(relative) + suffix);
}

function rewriteLine(line, fromDir, toDir) {
  // Do not touch `inline code`: only every second piece is real text
  return line.split(/(`+[^`]*`+)/).map((piece, i) => {
    if (i % 2 === 1) return piece;
    piece = piece.replace(MARKDOWN_IMAGE, (all, start, link, end) => {
      const fixed = newLink(link, fromDir, toDir);
      return fixed === null ? all : start + fixed + end;
    });
    return piece.replace(HTML_IMAGE, (all, start, quote, link) => {
      const fixed = newLink(link, fromDir, toDir);
      return fixed === null ? all : start + quote + fixed + quote;
    });
  }).join('');
}

// content: the markdown text. Returns the text with image links fixed for the new folder.
function rewriteImageLinks(content, fromDir, toDir) {
  if (parts(fromDir).join('/') === parts(toDir).join('/')) return content;

  let inFence = false;
  return content.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    return inFence ? line : rewriteLine(line, fromDir, toDir);
  }).join('\n');
}

module.exports = { rewriteImageLinks };
