const targets = [
  ['.nav-link', 'nav link'],
  ['.navbar-toggler', 'nav toggler'],
  ['.toc-fab', 'TOC FAB'],
  ['.toc-drawer-close', 'drawer close'],
  ['.article-toc-collapse', 'TOC collapse'],
  ['.post-tag', 'tag chip'],
  ['.code-copy-button', 'copy button'],
  ['.pager .btn', 'pager btn'],
  ['.back-to-top', 'back to top'],
  ['.site-search', 'site search'],
  ['.article-toc-sidebar', 'TOC sidebar'],
  ['.toc-drawer-grabber', 'grabber'],
  ['.tag-cloud-svg', 'tag cloud svg'],
  ['.archive-post-title', 'archive title'],
  ['.taxonomy-item a', 'taxonomy row'],
];
const out = {docScrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, boxes: [], overflow: []};
for (const [sel, name] of targets) {
  document.querySelectorAll(sel).forEach((el, i) => {
    if (i > 0) return;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out.boxes.push({name, sel, w: +r.width.toFixed(1), h: +r.height.toFixed(1), display: cs.display, vis: cs.visibility, hidden: el.hasAttribute('hidden')});
  });
}
document.querySelectorAll('body *').forEach(el => {
  const r = el.getBoundingClientRect();
  if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden') return;
    out.overflow.push({tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,60), left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1), sw: el.scrollWidth, cw: el.clientWidth, ox: cs.overflowX});
  }
});
out.overflow = out.overflow.slice(0, 30);
console.log(JSON.stringify(out, null, 1));
