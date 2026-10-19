import { runInNewContext } from "node:vm";

// Runs a slice of a page's inline script in a fresh context and returns the value of `expr`.
// A marker that is missing throws, rather than slicing from index -1 and testing the wrong text.
export function evalSlice(source, from, to, expr, ctx) {
  const start = source.indexOf(from);
  if (start < 0) throw new Error(`page script has no "${from}"`);
  const end = to === null ? source.length : source.indexOf(to, start);
  if (end < 0) throw new Error(`page script has no "${to}" after "${from}"`);
  return runInNewContext(source.slice(start, end) + "\n" + expr + ";", ctx);
}

// The page's `SF` object. The landing page assigns `window.SF` inside an immediately invoked
// function; the flight page declares `var SF = (function () { ... })();`.
export function pageSF(source, home, window) {
  if (home) return evalSlice(source, "(function (root) {", "</script>", "window.SF", { window });
  const start = source.indexOf("var SF = (function () {");
  const end = source.indexOf("})();", start);
  if (start < 0 || end < 0) throw new Error("flight page has no SF block");
  return runInNewContext(source.slice(start, end + 5) + "\nSF;", { window });
}
