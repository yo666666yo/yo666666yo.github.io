const fab = document.querySelector('[data-toc-open]');
if (fab) fab.click();
setTimeout(function(){
  const out = {innerW: window.innerWidth, root: getComputedStyle(document.documentElement).fontSize, docScrollW: document.documentElement.scrollWidth, boxes: [], overflow: []};
  const t = [['.toc-drawer','drawer root'],['.toc-drawer-panel','panel'],['.toc-drawer-close','drawer close'],['.toc-drawer-grabber','grabber'],['.toc-drawer-list .article-toc-link','drawer TOC link'],['.code-copy-button','copy button'],['.code-block','code block'],['.post-body pre','pre'],['.post-body table','table'],['.toc-fab','FAB'],['.article-toc-sidebar','sidebar'],['.post-tag','tag chip'],['.nav-link','nav link']];
  for (const [s,n] of t) { const el=document.querySelector(s); if(!el){out.boxes.push({name:n,missing:true});continue;} const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); out.boxes.push({name:n,w:+r.width.toFixed(1),h:+r.height.toFixed(1),display:cs.display,sw:el.scrollWidth,cw:el.clientWidth,ox:cs.overflowX,maxH:cs.maxHeight}); }
  document.querySelectorAll('body *').forEach(el=>{const r=el.getBoundingClientRect(); if(r.width>0&&(r.right>window.innerWidth+1||r.left<-1)){const cs=getComputedStyle(el); if(cs.visibility==='hidden')return; out.overflow.push({tag:el.tagName.toLowerCase(),cls:(el.className||'').toString().slice(0,50),pos:cs.position,l:+r.left.toFixed(1),rt:+r.right.toFixed(1)});}});
  out.overflow=out.overflow.slice(0,20);
  parent.postMessage("PROBE:"+JSON.stringify(out),"*");
}, 900);
