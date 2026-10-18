async (page) => {
  const results = { viewports: [], interactions: [], errors: [] };
  page.on('pageerror', error => results.errors.push(error.message));
  const names = {a:'orbital-desk', b:'departure-lounge', c:'mission-control'};
  for (const variant of ['a','b','c']) {
    for (const width of [360,390,768,1440]) {
      await page.setViewportSize({width,height:width<700?844:1100});
      await page.goto('http://127.0.0.1:8795/?variant='+variant);
      const dimensions = await page.evaluate(() => ({width:innerWidth, scrollWidth:document.documentElement.scrollWidth, viewport:document.querySelector('meta[name=viewport]').content}));
      results.viewports.push({variant,...dimensions,pass:dimensions.width===dimensions.scrollWidth});
      if (width===390 || width===1440) await page.screenshot({path:names[variant]+(width===390?'-mobile.png':'-desktop.png'),fullPage:true});
    }
  }
  await page.goto('http://127.0.0.1:8795/?variant=a');
  await page.getByRole('button',{name:'Agent',exact:true}).click();
  results.interactions.push({name:'Agent filter',pass:await page.locator('.event').count()===2});
  await page.getByRole('button',{name:'Simulation',exact:true}).click();
  results.interactions.push({name:'Simulation filter',pass:await page.locator('.event').count()===1});
  await page.getByRole('button',{name:'All',exact:true}).click();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  results.interactions.push({name:'Pause state',pass:await page.getByRole('button',{name:'Resume',exact:true}).getAttribute('aria-pressed')==='true'});
  await page.getByRole('button',{name:'Resume',exact:true}).click();
  await page.locator('[data-booking="1"]').click();
  results.interactions.push({name:'Booking selection',pass:(await page.locator('#route-name').innerText()).includes('Mars')});
  await page.getByRole('button',{name:'View manifest'}).click();
  results.interactions.push({name:'Manifest selection',pass:await page.getByRole('dialog').getByText('S. Rao · Geologist').isVisible()});
  await page.getByRole('button',{name:'Preview replay',exact:true}).click();
  await page.getByRole('button',{name:'Next step',exact:true}).click();
  results.interactions.push({name:'Replay step',pass:(await page.locator('#replay-caption').innerText()).startsWith('2 / 3')});
  results.interactions.push({name:'Preview excluded from feed',pass:await page.locator('.event').count()===3});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Connect your agent'}).click();
  let focusContained=true;
  for(let i=0;i<8;i++){await page.keyboard.press('Tab');focusContained=focusContained&&await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement));}
  results.interactions.push({name:'Dialog keyboard containment',pass:focusContained});
  await page.keyboard.press('Escape');
  results.interactions.push({name:'Dialog focus restoration',pass:await page.getByRole('button',{name:'Connect your agent'}).evaluate(el=>el===document.activeElement)});
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:8795/?variant=a');
  await page.getByRole('button',{name:'Show all 3 bookings'}).click();
  results.interactions.push({name:'Mobile booking disclosure',pass:await page.locator('[data-booking="2"]').isVisible()});
  await page.getByRole('button',{name:'Expand activity',exact:true}).click();
  results.interactions.push({name:'Mobile activity disclosure',pass:await page.locator('.event').nth(2).isVisible()});
  await page.getByRole('button',{name:'Explore route & fleet map'}).click();
  results.interactions.push({name:'Mobile map disclosure',pass:await page.locator('.map-svg').isVisible()});
  results.pass=results.errors.length===0 && results.viewports.every(x=>x.pass) && results.interactions.every(x=>x.pass);
  console.log(JSON.stringify(results,null,2));
}
