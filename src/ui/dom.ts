export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const markupCache = new WeakMap<HTMLElement, string>();
export function setMarkup(el: HTMLElement, html: string) {
  if (markupCache.get(el) !== html) {
    el.innerHTML = html;
    markupCache.set(el, html);
  }
}
export const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
