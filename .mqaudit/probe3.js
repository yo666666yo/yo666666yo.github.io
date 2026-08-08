setTimeout(function(){
  const out={innerW:window.innerWidth,root:getComputedStyle(document.documentElement).fontSize,docScrollW:document.documentElement.scrollWidth,bodySW:document.body.scrollWidth,boxes:[],overflow:[]};
  const t=[['.code-copy-button','copy button'],['.code-language','code lang'],['.code-block','code block'],['.post-body pre','pre'],['.post-body table','table'],['.katex-display','katex display'],['.post-body :not(pre) > code','inline code'],['.toc-fab','FAB']];
  for(const [s,n] of t){const els=document.querySelectorAll(s); if(!els.length){out.boxes.push({name:n,missing:true});continue;} let el=els[0]; const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); out.boxes.push({name:n,count:els.length,w:+r.width.toFixed(1),h:+r.height.toFixed(1),l:+r.left.toFixed(1),rt:+r.right.toFixed(1),display:cs.display,sw:el.scrollWidth,cw:el.clientWidth,ox:cs.overflowX});}
  // widest pre / table
  ['pre','table'].forEach(tag=>{let mx=null; document.querySelectorAll('.post-body '+tag).forEach(el=>{if(!mx||el.scrollWidth>mx.scrollWidth)mx=el;}); if(mx){const r=mx.getBoundingClientRect(); out.boxes.push({name:'widest '+tag,sw:mx.scrollWidth,cw:mx.clientWidth,w:+r.width.toFixed(1),l:+r.left.toFixed(1),rt:+r.right.toFixed(1),ox:getComputedStyle(mx).overflowX});}});
  document.querySelectorAll('body *').forEach(el=>{const r=el.getBoundingClientRect(); if(r.width>0&&(r.right>window.innerWidth+1||r.left<-1)){const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.position==='fixed')return; out.overflow.push({tag:el.tagName.toLowerCase(),cls:(el.className||'').toString().slice(0,45),l:+r.left.toFixed(1),rt:+r.right.toFixed(1),sw:el.scrollWidth,cw:el.clientWidth,ox:cs.overflowX});}});
  out.overflow=out.overflow.slice(0,25);
  parent.postMessage("PROBE:"+JSON.stringify(out),"*");
},1200);
