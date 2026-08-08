setTimeout(function(){
  const svg=document.querySelector('.tag-cloud-svg'); const r=svg.getBoundingClientRect();
  const sizes=[]; const boxes=[];
  document.querySelectorAll('.tag-cloud-svg text').forEach(t=>{
    sizes.push(parseFloat(getComputedStyle(t).fontSize));
    const b=t.getBoundingClientRect(); boxes.push([+b.width.toFixed(1),+b.height.toFixed(1)]);
  });
  const scale = r.width/860;
  const rendered = sizes.map(s=>+(s*scale).toFixed(2)).sort((a,b)=>a-b);
  const areaFail = boxes.filter(b=>b[0]<24||b[1]<24).length;
  parent.postMessage("PROBE:"+JSON.stringify({innerW:window.innerWidth,svgW:+r.width.toFixed(1),svgH:+r.height.toFixed(1),scale:+scale.toFixed(3),n:sizes.length,renderedMin:rendered[0],renderedP25:rendered[Math.floor(rendered.length*.25)],renderedMed:rendered[Math.floor(rendered.length/2)],renderedMax:rendered[rendered.length-1],under10px:rendered.filter(s=>s<10).length,under7px:rendered.filter(s=>s<7).length,boxesUnder24:areaFail}),"*");
},1200);
