/* Presentation only: never tween a flight, trajectory, or simulation clock. */
(function (root) {
  'use strict';
  var media = root.matchMedia('(prefers-reduced-motion: reduce)'), contexts = new Set(), cameraTween = null;
  function enter(el) {
    if (!root.gsap || media.matches || document.hidden) return;
    var ctx = gsap.context(function () {
      gsap.fromTo(el, {opacity:0, y:8}, {opacity:1, y:0, duration:.24, ease:'power2.out', clearProps:'opacity,transform', overwrite:true,onComplete:function(){contexts.delete(ctx);}});
    });
    contexts.add(ctx);
  }
  function stopCamera() { if (cameraTween) cameraTween.progress(1).kill(); cameraTween = null; }
  function camera(progress) {
    stopCamera();
    if (!root.gsap || media.matches || document.hidden) { progress.value = 1; return; }
    cameraTween = gsap.to(progress, {value:1, duration:.75, ease:'power2.inOut', onComplete:function(){cameraTween=null;}});
  }
  function mount(api) {
    var $ = function (s) { return document.querySelector(s); };
    var drawer = $('#opsDrawer'), panels = {}, trigger = null;
    function closeOperations(){ $('#opsNav').classList.remove('mc-open');$('#operationsMenu').setAttribute('aria-expanded','false'); }
    $('#operationsMenu').addEventListener('click',function(){var open=$('#opsNav').classList.toggle('mc-open');this.setAttribute('aria-expanded',String(open));});
    document.addEventListener('click',function(e){if(!e.target.closest('#opsNav,#operationsMenu'))closeOperations();});
    [['fleet','.c-sk'],['tools','#toolH'],['alerts','#alH'],['reports','#rpH']].forEach(function (pair) {
      var el = $(pair[1]); el = el.matches('.panel') ? el : el.closest('.panel');
      panels[pair[0]] = el; drawer.appendChild(el); el.hidden = true;
    });
    function closeDrawer() {
      drawer.hidden = true;
      document.querySelectorAll('[data-drawer]').forEach(function(b){b.setAttribute('aria-expanded','false');});
      if (trigger) { if(trigger.getClientRects().length)trigger.focus();else $('#operationsMenu').focus(); }
    }
    function openDrawer(key, button) {
      closeOperations();
      var title = {fleet:'Starseeker fleet',tools:"Your agent’s tools",alerts:'System alerts',reports:'Logs & scoreboard'};
      Object.keys(panels).forEach(function(k){panels[k].hidden = k !== key;});
      $('#drawerTitle').textContent = title[key]; trigger = button || $('#connectBtn');
      document.querySelectorAll('[data-drawer]').forEach(function(b){b.setAttribute('aria-expanded',b.dataset.drawer===key?'true':'false');});
      drawer.hidden = false; enter(drawer); $('#drawerClose').focus();
    }
    $('#drawerClose').addEventListener('click',closeDrawer);
    document.querySelectorAll('[data-drawer]').forEach(function(b){b.addEventListener('click',function(){
      if(!drawer.hidden && b.getAttribute('aria-expanded')==='true') closeDrawer(); else openDrawer(b.dataset.drawer,b);
    });});
    var feedPanel = $('#fdH').closest('.panel'); $('#activityDock').appendChild(feedPanel); feedPanel.id='activityPanel'; feedPanel.hidden=true;
    var activity = $('#activityToggle'), mobileActivity = $('#mobileActivity');
    function activityOpen(open) {
      feedPanel.hidden = !open;
      [activity,mobileActivity].forEach(function(b){b.setAttribute('aria-expanded',String(open));});
      activity.querySelector('.mc-sign').textContent = open ? '−' : '+';
      if(open) { drawer.hidden=true; enter(feedPanel); }
    }
    [activity,mobileActivity].forEach(function(b){b.addEventListener('click',function(){activityOpen(feedPanel.hidden);});});
    var filter = document.createElement('label'); filter.className='mc-feed-filter';
    filter.innerHTML='Show<select id="feedSource"><option value="all">Agent + simulation</option><option value="agent">Agent events</option><option value="simulation">Simulation events</option></select>';
    feedPanel.querySelector('.pb').prepend(filter);
    var empty=document.createElement('p');empty.className='mc-feed-empty';empty.id='feedEmpty';empty.textContent='No events yet. Local route previews are excluded.';
    feedPanel.querySelector('.pb').appendChild(empty);
    function filterFeed() {
      var count=0;
      document.querySelectorAll('#feed>li').forEach(function(li){li.hidden=filter.querySelector('select').value!=='all' && li.dataset.source!==filter.querySelector('select').value;if(!li.hidden) count++;});
      empty.hidden=count>0;
      $('#activityCount').textContent=count;
    }
    filter.querySelector('select').addEventListener('change',filterFeed);
    var observer=new MutationObserver(filterFeed);observer.observe($('#feed'),{childList:true});filterFeed();
    $('#mcClock').appendChild($('#clk')); $('#mcSeason').appendChild($('#clkS'));
    $('#zoomIn').addEventListener('click',function(){api.zoom(.8);});
    $('#zoomOut').addEventListener('click',function(){api.zoom(1.25);});
    $('#resetMap').addEventListener('click',api.reset);
    $('#pauseMap').addEventListener('click',function(){api.pause();});
    $('#mapHelp').addEventListener('click',function(){var open=$('#legend').classList.toggle('mc-open');this.setAttribute('aria-expanded',String(open));});
    $('#hidePanels').addEventListener('click',function(){var off=document.body.classList.toggle('mc-panels-hidden');this.setAttribute('aria-pressed',String(off));this.textContent=off?'Show panels':'Hide panels';});
    $('#sheetCollapse').addEventListener('click',function(){var down=$('.c-fl').classList.toggle('mc-collapsed');this.setAttribute('aria-expanded',String(!down));this.setAttribute('aria-label',down?'Expand bookings':'Collapse bookings');this.textContent=down?'⌃':'⌄';});
    var host=$('#glhost');
    host.addEventListener('keydown',function(e){
      if(e.target!==host)return;
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].indexOf(e.key)<0)return;
      e.preventDefault(); if(e.key==='Home')api.reset();else if(e.key==='+'||e.key==='=')api.zoom(.8);else if(e.key==='-')api.zoom(1.25);else api.orbit(e.key);
    });
    document.addEventListener('keydown',function(e){
      var modal=Array.from(document.querySelectorAll('.modal')).find(function(m){return !m.hidden;});
      if(e.key==='Escape' && modal)return; // The app closes only the top modal and restores its trigger.
      if(e.key==='Escape'){if(!drawer.hidden)closeDrawer();closeOperations();activityOpen(false);$('#legend').classList.remove('mc-open');$('#mapHelp').setAttribute('aria-expanded','false');}
      if(e.key==='Tab' && modal){
        var focus=Array.from(modal.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')).filter(function(n){return !n.disabled && n.getClientRects().length;});
        if(!focus.length)return;e.preventDefault();var n=focus.indexOf(document.activeElement),next=(n+(e.shiftKey?-1:1)+focus.length)%focus.length;focus[next].focus();
      }
    });
    // Inert the world while an existing app modal is active; keep its own focus restoration.
    var modalObserver=new MutationObserver(function(){
      var shown=Array.from(document.querySelectorAll('.modal')).some(function(m){return !m.hidden;});
      [$('#ops'),document.querySelector('.top'),document.querySelector('.mc-strip')].forEach(function(n){n.inert=shown;});
      if(shown)stopCamera();
    });
    document.querySelectorAll('.modal').forEach(function(m){modalObserver.observe(m,{attributes:true,attributeFilter:['hidden']});});
    root.StarfareMotion.openTools=function(){openDrawer('tools');};
    root.StarfareMotion.refreshFeed=filterFeed;
    root.addEventListener('pagehide',function(event){stopCamera();if(!event.persisted){observer.disconnect();modalObserver.disconnect();dispose();}});
  }
  function dispose(){stopCamera();contexts.forEach(function(c){c.revert();});contexts.clear();}
  media.addEventListener('change',function(){stopCamera();});
  document.addEventListener('visibilitychange',function(){if(document.hidden)stopCamera();});
  root.StarfareMotion={camera:camera,stopCamera:stopCamera,enter:enter,mount:mount,dispose:dispose};
})(window);
