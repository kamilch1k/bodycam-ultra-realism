import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args:['--mute-audio'] });
for (const url of [
  'http://127.0.0.1:5180/?map=yard&menu=0',
  'http://127.0.0.1:5180/?map=yard&menu=0&prewarm=1',
]) {
  const p = await b.newPage({ viewport:{width:1024,height:576} });
  const logs=[];
  p.on('console', m => { const t=m.text(); if(/\[boot\]|\[engine\]|prewarm/.test(t)) logs.push(t); });
  const t0=Date.now();
  await p.goto(url,{waitUntil:'domcontentloaded'});
  await p.waitForFunction('!!window.__ENGINE__',null,{timeout:180000});
  const ready=Date.now()-t0;
  const progs = await p.evaluate(()=>{const i=window.__ENGINE__.ctx.get('render').renderer.info;return i.programs?i.programs.length:0;});
  console.log(JSON.stringify({url:url.split('?')[1], readyMs:ready, programs:progs, prewarm:logs.filter(l=>/prewarm/.test(l)).slice(-1)[0]||null}));
  await p.close();
}
await b.close();
