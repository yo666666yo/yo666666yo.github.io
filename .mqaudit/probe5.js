setTimeout(function(){
  const sb=document.querySelector('[data-toc-sidebar]'), fb=document.querySelector('[data-toc-open]');
  const o={innerW:window.innerWidth, exactW:document.documentElement.clientWidth,
    sidebar: sb?{d:getComputedStyle(sb).display,hidden:sb.hasAttribute('hidden'),w:+sb.getBoundingClientRect().width.toFixed(1)}:null,
    fab: fb?{d:getComputedStyle(fb).display,hidden:fb.hasAttribute('hidden'),w:+fb.getBoundingClientRect().width.toFixed(1)}:null};
  o.bothHidden = !!(o.sidebar && o.fab && o.sidebar.d==='none' && o.fab.d==='none');
  parent.postMessage("PROBE:"+JSON.stringify(o),"*");
},900);
