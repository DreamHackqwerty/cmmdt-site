(() => {
  'use strict';
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const ids = tabs.map(t => t.getAttribute('aria-controls'));
  const panels = ids.map(id => document.getElementById(id));
  const reduce = false;
  const tint = { home: 'var(--violet)', products: 'var(--teal)', features: 'var(--accent)', about: 'var(--rose)' };
  const orb = document.getElementById('orbA');
  const indicator = document.getElementById('indicator');
  const aliases = { manager:'p-manager', switchup:'p-switch', alware:'p-fisch', tinyrepeat:'p-tiny', 'manager-download-title':'p-manager', 'switchup-download-title':'p-switch', 'alware-download-title':'p-fisch', 'tinyrepeat-download-title':'p-tiny', download:'products', showcases:'features', tools:'products' };
  const routes = {home:'/',products:'/products',features:'/features',about:'/about'};
  const productRoutes = {'p-fisch':'/products/alware','p-manager':'/products/manager','p-switch':'/products/switchup','p-tiny':'/products/tinyrepeat'};
  const routeFor = (id, target) => productRoutes[target] || routes[id];
  let current = -1;
  const io = !reduce && 'IntersectionObserver' in window ? new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px' }) : null;
  function moveIndicator() {
    const tab = tabs[current];
    if (!tab) return;
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.transform = `translateX(${tab.offsetLeft - 3}px)`;
  }
  function animate(panel, direction) {
    panel.classList.remove('enter-l', 'enter-r');
    if (reduce) return;
    void panel.offsetWidth;
    panel.classList.add(direction < 0 ? 'enter-l' : 'enter-r');
    const elements = panel.querySelectorAll('.person, .hero > *, .dock > *, .strip, .section-head > *, .product, .video, .video-caption, .contact');
    elements.forEach(el => {
      el.classList.remove('fx','rv','in');
      if (io) io.unobserve(el);
    });
    void panel.offsetWidth;
    let i = 0;
    elements.forEach(el => {
      if (!io || el.getBoundingClientRect().top < innerHeight * .95) {
        el.style.setProperty('--i', i++); el.classList.add('fx');
      } else { el.classList.add('rv'); io.observe(el); }
    });
  }
  function show(id, target, updateHistory = true) {
    if (!ids.includes(id)) id = 'home';
    // Load the matching document so its content, title and canonical stay aligned.
    const destination = routeFor(id, target);
    if (updateHistory && location.pathname.replace(/\/+$/, '') !== destination.replace(/\/+$/, '')) {
      location.assign(destination);
      return;
    }
    if (!document.getElementById(id)) {
      location.replace(destination);
      return;
    }
    const next = ids.indexOf(id), changed = current !== next;
    const direction = current < 0 ? 1 : Math.sign(next - current) || 1;
    current = next;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === next));
      tab.tabIndex = i === next ? 0 : -1;
    });
    panels.forEach((panel, i) => { if (panel) panel.hidden = i !== next; });
    moveIndicator(); orb.style.setProperty('--orb-color', tint[id]);
    const path = routeFor(id, target);
    if (updateHistory && location.pathname + location.search + location.hash !== path) history.pushState(null, '', path);
    if (!target) window.scrollTo({top:0,behavior:'instant'});
    if (changed) animate(panels[next], direction);
    const el = target && document.getElementById(target);
    if (el && updateHistory) requestAnimationFrame(() => el.scrollIntoView({behavior:reduce ? 'auto':'smooth',block:'start'}));
  }
  function fromLocation() {
    const select = (id, target = null) => {
      show(id, target, false);
      const path = routeFor(id, target);
      if (location.pathname + location.hash !== path) history.replaceState(null, '', path + location.search);
    };
    let raw = decodeURIComponent(location.hash.slice(1));
    raw = aliases[raw] || raw;
    if (raw.startsWith('p-') && document.getElementById(raw)) return select('products',raw);
    if (ids.includes(raw)) return select(raw);
    const path = location.pathname.toLowerCase().replace(/\/+$/, '') || '/';
    const product = Object.keys(productRoutes).find(id => productRoutes[id] === path);
    if (product) return select('products',product);
    if (/\/(macros|tools)\/alware$/.test(path)) return select('products','p-fisch');
    if (/\/(macros|tools)\/tinyrepeat$/.test(path)) return select('products','p-tiny');
    if (/^\/(products|macros|tools|downloads)$/.test(path)) return select('products');
    if (/^\/(features|showcases)$/.test(path)) return select('features');
    if (path === '/about') return select('about');
    select('home');
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      show(ids[i]);
    });
    tab.addEventListener('keydown', e => {
      let next;
      if (e.key === 'ArrowRight') next = (i+1)%tabs.length;
      if (e.key === 'ArrowLeft') next = (i-1+tabs.length)%tabs.length;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = tabs.length-1;
      if (next === undefined) return;
      e.preventDefault();tabs[next].focus();show(ids[next]);
    });
  });
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => show(button.dataset.go,button.dataset.target)));
  document.querySelectorAll('.log > summary').forEach(summary => {
    const details = summary.parentElement;
    const content = summary.nextElementSibling;
    let expanded = details.open;
    let animation;
    summary.addEventListener('click', event => {
      event.preventDefault();
      const top = window.scrollY;
      expanded = !expanded;
      if (animation) animation.cancel();
      details.open = true;
      details.dataset.expanded = String(expanded);
      // Animate only composited properties; avoid relaying out the page every frame.
      const motion = content.animate([
        {opacity:expanded ? 0 : 1,transform:expanded ? 'translateY(-3px)' : 'translateY(0)'},
        {opacity:expanded ? 1 : 0,transform:expanded ? 'translateY(0)' : 'translateY(-3px)'}
      ], {duration:expanded ? 160 : 90,easing:'ease-out',fill:'forwards'});
      animation = motion;
      motion.onfinish = () => {
        if (animation !== motion) return;
        details.open = expanded;
        motion.cancel();
        animation = null;
      };
      summary.focus({preventScroll:true});
      window.scrollTo({top,behavior:'instant'});
      requestAnimationFrame(() => window.scrollTo({top,behavior:'instant'}));
    });
  });
  window.addEventListener('popstate',fromLocation);
  window.addEventListener('hashchange',fromLocation);
  window.addEventListener('resize',moveIndicator);
  if (document.fonts) document.fonts.ready.then(moveIndicator);
  fromLocation();
  const ambient = document.querySelector('.ambient'), cursor = document.getElementById('orbCursor');
  let tx = innerWidth / 2, ty = innerHeight * .3, cx = tx, cy = ty;
  let cursorFrame = 0;
  function followCursor() {
    cursorFrame = 0;
    cx += (tx - cx) * .12; cy += (ty - cy) * .12;
    cursor.style.transform = `translate3d(${cx}px,${cy}px,0) translate(-50%,-50%)`;
    if (Math.abs(tx - cx) + Math.abs(ty - cy) > .5 && !document.hidden) {
      cursorFrame = requestAnimationFrame(followCursor);
    }
  }
  window.addEventListener('pointermove', e => {
    tx = e.clientX; ty = e.clientY;
    if (!cursorFrame) cursorFrame = requestAnimationFrame(followCursor);
  }, {passive:true});
  followCursor();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && cursorFrame) {
      cancelAnimationFrame(cursorFrame); cursorFrame = 0;
    }
  });
})();
