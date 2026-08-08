setTimeout(function(){
  const out={innerW:window.innerWidth,root:getComputedStyle(document.documentElement).fontSize,docScrollW:document.documentElement.scrollWidth,boxes:[]};
  const t=[['.pager .btn','pager btn'],['.load-more-btn','load more'],['.taxonomy-item a','taxonomy row'],['.archive-post-title','archive title'],['.social-list-item a','social link'],['.site-search-button','search btn'],['.site-search-input','search input'],['.post-pager-item','post pager item'],['.tag-cloud-link','tag cloud link'],['.post-meta a','post meta link'],['.masthead .post-kicker-cat','kicker cat'],['.navbar-brand','brand'],['.tag-cloud-svg','cloud svg'],['.tag-cloud-svg text','cloud word']];
  for(const [s,n] of t){const el=document.querySelector(s); if(!el){out.boxes.push({name:n,missing:true});continue;} const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); out.boxes.push({name:n,w:+r.width.toFixed(1),h:+r.height.toFixed(1),display:cs.display,fs:cs.fontSize,pad:cs.padding});}
  let minw=999,minh=999,cnt=0;
  document.querySelectorAll('.tag-cloud-svg text').forEach(el=>{const r=el.getBoundingClientRect(); cnt++; if(r.width<minw)minw=+r.width.toFixed(1); if(r.height<minh)minh=+r.height.toFixed(1);});
  if(cnt) out.boxes.push({name:'smallest cloud word',w:minw,h:minh,count:cnt});
  parent.postMessage("PROBE:"+JSON.stringify(out),"*");
},1000);
