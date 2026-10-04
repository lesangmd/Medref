(() => {
  'use strict';
  const cfg = window.MTP_CONFIG || {};
  const root = document.getElementById('mtp-app');
  if (!root) return;

  const state = {
    groups: [],
    status: null,
    results: [],
    total: 0,
    libraryTotal: null,
    hasMore: false,
    nextOffset: 0,
    pageSize: 30,
    loadingMore: false,
    current: null,
    q: '',
    group: '',
    specialty: '',
    loading: false,
    contentType: cfg.initialContentType === 'procedure' ? 'procedure' : 'protocol',
    drawer: false,
    investigationFilter: 'all',
    investigationExpanded: false,
    installPrompt: null,
    isStandalone: (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true,
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    updateInstallButton();
    applyContentCopy();
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    state.isStandalone = true;
    updateInstallButton();
  });

  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  // v0.27+ reader-facing display normalization. This layer changes labels and
  // editorial metadata only; it never rewrites clinical doses, thresholds,
  // routes, treatment algorithms, or immutable provenance stored in the DB.
  const INTERNAL_READER_RE = /(?:editorial\s+synthesis|source[-_\s]fidelity(?:[-_\s]+backbone|\s+review)?|source[-_\s]backbone|\bcanonical\b|\bscaffold\b|review[-\s]only|production\s+gate|clinical\s+gate|depth\s+gate|currentness(?:[-_\s]+gate)?|\bpipeline\b|\baudit\b|\bschema\b|media[-_\s]manifest|sha[-\s]?256|\bfrontend\b|\bbackend\b|\bimporter\b|\bpayload\b|tệp\s+nguồn\s*:|modified\s+20\d{2}|bảo\s+toàn\s+body\s+xml|toàn\s+văn[^.]{0,120}gói\s+import|bảng\s+và\s+hình[^.]{0,120}gói\s+import|đợt\s+quét\s+currentness|lớp\s+cập\s+nhật[^.]{0,100}không\s+xóa\s+nội\s+dung\s+nguồn|không\s+tự\s+suy\s+diễn)/i;
  const CLINICAL_LABELS = new Map([
    ['CBC','Tổng phân tích tế bào máu ngoại vi'],
    ['ECG','Điện tâm đồ'],
    ['ABG','Khí máu động mạch'],
    ['EGFR','Mức lọc cầu thận ước tính'],
  ]);
  function readerClinicalLabel(v) {
    const text=String(v ?? '').trim();
    if (!text) return '';
    return CLINICAL_LABELS.get(text.toUpperCase()) || text;
  }
  function readerSourceLocator(v) {
    const raw=stripHtml(v || '').replace(/\s+/g,' ').trim();
    if (!raw) return '';
    const parts=raw.split(/\s*(?:[;|]|\s+[·•]\s+)\s*/).filter(Boolean);
    const kept=parts.filter(part=>!INTERNAL_READER_RE.test(part));
    let text=kept.length ? kept.join(' · ') : (INTERNAL_READER_RE.test(raw) ? '' : raw);
    text=text.replace(/^(?:source\s*locator|locator|vị\s*trí\s*nguồn)\s*:\s*/i,'').trim();
    return text;
  }
  const debounce = (fn, ms=240) => { let t; return (...args) => { clearTimeout(t); t=setTimeout(()=>fn(...args),ms); }; };
  const api = async (path) => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
    let res;
    try {
      let requestPath=path.replace(/^\//,'');
      // Library browsing/statistics stay Published-only for every user.
      // Administrators may still open an exact unpublished record by direct detail URL.
      if (cfg.draftPreview && /^protocol\//.test(requestPath)) requestPath += (requestPath.includes('?')?'&':'?') + 'preview=1';
      const headers={'Accept':'application/json'};
      if (cfg.restNonce) headers['X-WP-Nonce']=cfg.restNonce;
      res = await fetch((cfg.restBase || '').replace(/\/$/, '/') + requestPath, {credentials:'same-origin', headers, signal: controller ? controller.signal : undefined});
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('Hết thời gian chờ tải dữ liệu phác đồ.');
      throw err;
    }
    if (timer) clearTimeout(timer);
    if (!res.ok) {
      let msg='Không thể tải dữ liệu.';
      try { const j=await res.json(); msg=j.message || msg; } catch(e) {}
      throw new Error(msg);
    }
    return res.json();
  };


  function contentCopy(){
    const proc=state.contentType==='procedure';
    return proc ? {brand:'QUY TRÌNH',noun:'quy trình',title:'THƯ VIỆN QUY TRÌNH',sub:'Tra cứu quy trình chuyên môn theo chuyên khoa.',aria:'Tìm quy trình'}
                : {brand:'PHÁC ĐỒ',noun:'phác đồ',title:'THƯ VIỆN PHÁC ĐỒ',sub:'Tra cứu phác đồ chẩn đoán và điều trị theo chuyên khoa.',aria:'Tìm phác đồ'};
  }
  function contentBaseUrl(){ return state.contentType==='procedure' ? (cfg.procedureUrl || cfg.appUrl) : cfg.appUrl; }

  // v3.5.18: the reader Back control must always have a deterministic
  // in-app destination. Browser history alone is insufficient for direct
  // deep links, PWA launches, restored tabs, or links opened in a new tab.
  function libraryReturnUrl() {
    const base = new URL(contentBaseUrl() || cfg.appRoot || location.href, location.origin);
    if (state.q) base.searchParams.set('q', state.q); else base.searchParams.delete('q');
    if (state.group) base.searchParams.set('group', state.group); else base.searchParams.delete('group');
    if (state.specialty) base.searchParams.set('specialty', state.specialty); else base.searchParams.delete('specialty');
    return base.pathname + (base.search || '');
  }
  function safeInternalReturnUrl(value) {
    try {
      const u = new URL(String(value || ''), location.origin);
      if (u.origin !== location.origin) return '';
      const appRoot = new URL(cfg.appRoot || '/medipharm/', location.origin).pathname.replace(/\/+$/,'') + '/';
      if (!u.pathname.startsWith(appRoot)) return '';
      return u.pathname + (u.search || '') + (u.hash || '');
    } catch(e) { return ''; }
  }
  function navigateBackFromProtocol() {
    const hs = history.state || {};
    const recorded = safeInternalReturnUrl(hs.mtpReturnUrl || '');
    if (hs.mtpCanHistoryBack === true && recorded && history.length > 1) {
      history.back();
      return;
    }
    const target = recorded || libraryReturnUrl();
    // Use assign rather than a synthetic SPA state when this page was loaded
    // directly. This guarantees the control works even with a one-entry stack.
    location.assign(target);
  }
  function applyContentCopy(){
    const c=contentCopy();
    const brand=root.querySelector('.mtp-brand-copy strong'); if(brand) brand.textContent=c.brand;
    const input=document.getElementById('mtp-search'); if(input){input.setAttribute('aria-label',c.aria); input.placeholder=state.contentType==='procedure'?'Tìm quy trình, kỹ thuật, chuyên khoa…':'Tìm bệnh, ICD-10, triệu chứng, tên tiếng Anh…';}
    const side=root.querySelector('.mtp-sidebar-head small'); if(side) side.textContent='Duyệt thư viện '+c.noun;
    const all=root.querySelector('.mtp-nav-all span'); if(all) all.textContent='Tất cả '+c.noun;
  }
  async function switchContentType(type){
    const next=type==='procedure'?'procedure':'protocol';
    if(state.contentType===next){ applyContentCopy(); return; }
    state.contentType=next; state.q=''; state.group=''; state.specialty=''; state.current=null;
    resetResultPaging();
    applyContentCopy();
    try{
      const specialties=await api('specialties?content_type='+encodeURIComponent(state.contentType));
      state.groups=specialties.groups||[];
      state.libraryTotal=Number.isFinite(Number(specialties.total)) ? Number(specialties.total) : null;
      renderSidebar(); await runSearch(false); renderStatus();
    }catch(e){renderError(e);}
  }

  function mountShell() {
    root.innerHTML = `
      <div class="mtp-shell">
        <header class="mtp-topbar">
          <div class="mtp-brand-wrap">
            <button class="mtp-icon-btn mtp-menu-btn" type="button" aria-label="Mở chuyên khoa" data-action="toggle-drawer">☰</button>
            <a class="mtp-brand" href="${esc(cfg.appUrl)}" data-action="home">
              <span class="mtp-logo">M</span>
              <span class="mtp-brand-copy"><strong>PHÁC ĐỒ</strong><small>THƯ VIỆN MEDIPHARM</small></span>
            </a>
          </div>
          <div class="mtp-search-wrap">
            <span class="mtp-search-icon">⌕</span>
            <input id="mtp-search" class="mtp-search" type="search" autocomplete="off" placeholder="Tìm bệnh, ICD-10, triệu chứng, tên tiếng Anh…" aria-label="Tìm phác đồ">
            <button class="mtp-search-clear" type="button" data-action="clear-search" aria-label="Xóa tìm kiếm">×</button>
          </div>
          <div class="mtp-top-actions">
            <button class="mtp-install-btn" type="button" data-action="install-app" id="mtp-install-btn" title="Cài WebApp lên thiết bị"><span>⇩</span><b>Cài WebApp</b></button>
            <a class="mtp-icon-btn mtp-home-link" href="${esc(cfg.homeUrl)}" title="Trang chủ website">⌂</a>
            <button class="mtp-icon-btn" type="button" data-action="theme" title="Đổi giao diện">◐</button>
          </div>
        </header>

        <div class="mtp-tablet-specialty-bar" aria-label="Thanh công cụ phác đồ">
          <button class="mtp-tablet-specialty-trigger" type="button" data-action="toggle-drawer" aria-label="Mở danh sách chuyên khoa">
            <span class="mtp-tablet-specialty-icon">☰</span>
            <span class="mtp-tablet-specialty-copy"><small>Điều hướng</small><strong id="mtp-tablet-specialty-label">Chuyên khoa</strong></span>
            <span class="mtp-tablet-specialty-chevron">›</span>
          </button>
          <div class="mtp-mobile-reader-control">
            <button class="mtp-mobile-tool-btn mtp-mobile-font-toggle" type="button" data-action="mobile-font-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="mtp-mobile-font-panel" aria-label="Cỡ chữ nội dung">aA</button>
            <div class="mtp-mobile-tool-panel mtp-mobile-font-panel" id="mtp-mobile-font-panel" role="menu" hidden>
              <button type="button" data-action="mobile-font-adjust" data-dir="-1" role="menuitem" aria-label="Giảm cỡ chữ">A−</button>
              <button type="button" data-action="mobile-font-adjust" data-dir="0" role="menuitem">Mặc định</button>
              <button type="button" data-action="mobile-font-adjust" data-dir="1" role="menuitem" aria-label="Tăng cỡ chữ">A+</button>
            </div>
          </div>
          <div class="mtp-mobile-nav-control">
            <button class="mtp-mobile-tool-btn mtp-mobile-nav-toggle" type="button" data-action="mobile-nav-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="mtp-mobile-nav-panel" aria-label="Điều hướng các phần trong phác đồ" title="Điều hướng phác đồ">☷</button>
            <div class="mtp-mobile-tool-panel mtp-mobile-nav-panel" id="mtp-mobile-nav-panel" role="menu" hidden></div>
          </div>
        </div>

        <div class="mtp-body">
          <aside class="mtp-sidebar" id="mtp-sidebar" aria-label="Điều hướng chuyên khoa">
            <div class="mtp-sidebar-head">
              <div><strong>Chuyên ngành</strong><small>Duyệt thư viện phác đồ</small></div>
              <button class="mtp-icon-btn mtp-drawer-close" type="button" data-action="toggle-drawer">×</button>
            </div>
            <button class="mtp-nav-all is-active" type="button" data-group="" data-specialty="">
              <span>Tất cả phác đồ</span><b id="mtp-all-count">0</b>
            </button>
            <nav id="mtp-specialty-nav" class="mtp-specialty-nav"></nav>
            <div class="mtp-sidebar-foot">
              <div id="mtp-icd-status" class="mtp-icd-status"><span class="mtp-dot"></span><span>Đang kiểm tra ICD-10…</span></div>
              <small>Phát triển bởi: THƯ VIỆN MEDIPHARM</small>
            </div>
          </aside>
          <div class="mtp-overlay" data-action="toggle-drawer"></div>
          <main class="mtp-main" id="mtp-main">
            <div class="mtp-loading-page"><span class="mtp-spinner"></span><p>Đang tải thư viện phác đồ…</p></div>
          </main>
        </div>
      </div>`;

    if (cfg.embedded) {
      root.classList.add('mtp-embedded');
      const topbar=root.querySelector('.mtp-topbar'); if (topbar) topbar.remove();
    }
    bindShell();
    applySavedTheme();
    updateInstallButton();
  }

  function bindShell() {
    root.addEventListener('click', async (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        const action = actionEl.dataset.action;
        if (action === 'toggle-drawer') { toggleDrawer(); return; }
        if (action === 'theme') { toggleTheme(); return; }
        if (action === 'install-app') { e.preventDefault(); installWebApp(); return; }
        if (action === 'close-install') { e.preventDefault(); closeInstallHelp(); return; }
        if (action === 'clear-search') { clearSearch(); return; }
        if (action === 'load-more') { e.preventDefault(); await loadMoreResults(actionEl); return; }
        if (action === 'home') { e.preventDefault(); goHome(true); return; }
        if (action === 'toggle-module') { e.preventDefault(); toggleModule(actionEl); return; }
        if (action === 'toggle-all') { e.preventDefault(); toggleAllModules(); return; }
        if (action === 'collapse-all') { e.preventDefault(); setAllModulesCollapsed(true); return; }
        if (action === 'expand-all') { e.preventDefault(); setAllModulesCollapsed(false); return; }
        if (action === 'investigation-filter') { e.preventDefault(); setInvestigationFilter(actionEl.dataset.filter || 'all'); return; }
        if (action === 'toggle-investigations') { e.preventDefault(); state.investigationExpanded=!state.investigationExpanded; renderInvestigationPanel(); return; }
        if (action === 'quick-anchor') { e.preventDefault(); closeMobileProtocolMenus(); scrollToProtocolTarget(actionEl.dataset.target || ''); return; }
        if (action === 'anchor-scroll') { e.preventDefault(); scrollAnchorBar(actionEl); return; }
        if (action === 'mobile-font-menu') { e.preventDefault(); toggleMobileProtocolMenu('font'); return; }
        if (action === 'mobile-nav-menu') { e.preventDefault(); toggleMobileProtocolMenu('nav'); return; }
        if (action === 'mobile-font-adjust') { e.preventDefault(); adjustMobileReaderFont(actionEl.dataset.dir || '0'); return; }
      }
      const nav = e.target.closest('[data-group][data-specialty]');
      if (nav && nav.closest('.mtp-sidebar')) {
        e.preventDefault();
        state.group = nav.dataset.group || '';
        state.specialty = nav.dataset.specialty || '';
        state.current = null;
        updateNavActive();
        if (window.innerWidth < 900) toggleDrawer(false);
        await runSearch(true);
        return;
      }
      const card = e.target.closest('[data-protocol]');
      if (card) {
        e.preventDefault();
        openProtocol(card.dataset.protocol, true);
        return;
      }
      const back = e.target.closest('[data-back]');
      if (back) { e.preventDefault(); navigateBackFromProtocol(); return; }
    });

    const input = document.getElementById('mtp-search');
    if (input) {
      input.addEventListener('input', debounce(() => {
        state.q = input.value.trim();
        state.current = null;
        runSearch(true);
      }, 220));
      input.addEventListener('keydown', e => {
        if (e.key === 'Escape') clearSearch();
      });
    }
    window.addEventListener('popstate', hydrateFromUrl);
    window.addEventListener('resize', debounce(()=>{ closeMobileProtocolMenus(); refreshStickyLayout(); }, 120));
    document.addEventListener('click',e=>{
      if (!e.target.closest('.mtp-mobile-reader-control,.mtp-mobile-nav-control')) closeMobileProtocolMenus();
    });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeMobileProtocolMenus(); });
  }

  function applySavedTheme() {
    // In the unified MEDIPHARM shell, the host owns theme state. Never let a
    // stale standalone `mtp-theme` value override the current app theme.
    if (cfg.embedded) {
      const hostTheme=document.documentElement.dataset.mcrTheme;
      if (hostTheme==='dark' || hostTheme==='light') {
        document.documentElement.dataset.mtpTheme=hostTheme;
        return;
      }
      let shared='';
      try {
        for (const key of ['mcr-theme','yhls-theme','tvm-theme','yhlsm-theme']) {
          const value=localStorage.getItem(key);
          if (value==='dark' || value==='light') { shared=value; break; }
        }
      } catch(e) {}
      if (shared) document.documentElement.dataset.mtpTheme=shared;
      return;
    }
    let saved='';
    try { saved=localStorage.getItem('mtp-theme') || ''; } catch(e) {}
    if (saved === 'dark') document.documentElement.dataset.mtpTheme='dark';
    else if (saved === 'light') document.documentElement.dataset.mtpTheme='light';
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.mtpTheme='dark';
  }
  function toggleTheme() {
    const dark = document.documentElement.dataset.mtpTheme === 'dark';
    document.documentElement.dataset.mtpTheme = dark ? 'light' : 'dark';
    try { localStorage.setItem('mtp-theme', dark ? 'light' : 'dark'); } catch(e) {}
  }
  function toggleDrawer(force) {
    state.drawer = typeof force === 'boolean' ? force : !state.drawer;
    root.classList.toggle('mtp-drawer-open', state.drawer);
    const sidebar=root.querySelector('.mtp-sidebar');
    if (sidebar) sidebar.setAttribute('aria-hidden',state.drawer?'false':'true');
    root.querySelectorAll('[data-action="toggle-drawer"]').forEach(el=>el.setAttribute('aria-expanded',state.drawer?'true':'false'));
  }

  function scrollAnchorBar(control) {
    const bar=control && control.closest ? control.closest('.mtp-anchor-bar') : null;
    const scroller=bar ? bar.querySelector('.mtp-anchor-scroll') : null;
    if (!scroller) return;
    const direction=Number(control.dataset.dir||1) < 0 ? -1 : 1;
    const distance=Math.max(220,Math.round(scroller.clientWidth*0.72));
    scroller.scrollBy({left:direction*distance,behavior:'smooth'});
  }

  function syncAnchorScrollControls() {
    root.querySelectorAll('.mtp-anchor-bar').forEach(bar=>{
      const scroller=bar.querySelector('.mtp-anchor-scroll');
      const controls=bar.querySelectorAll('[data-action="anchor-scroll"]');
      if (!scroller || !controls.length) return;
      const hasOverflow=scroller.scrollWidth > scroller.clientWidth + 4;
      controls.forEach(btn=>{ btn.hidden=!hasOverflow; btn.disabled=!hasOverflow; });
    });
  }

  const MOBILE_READER_FONT_KEY='mcr-reader-font-scale';
  const MOBILE_READER_FONT_STEPS=[0.94,1,1.08,1.16,1.26,1.36];
  function mobileReaderFontScale(){
    try { const n=Number(localStorage.getItem(MOBILE_READER_FONT_KEY)); return MOBILE_READER_FONT_STEPS.includes(n)?n:1.16; }
    catch(e){ return 1.16; }
  }
  function adjustMobileReaderFont(dir){
    const cur=mobileReaderFontScale();let idx=MOBILE_READER_FONT_STEPS.indexOf(cur);if(idx<0)idx=3;
    const n=Number(dir||0);idx=n===0?3:Math.max(0,Math.min(MOBILE_READER_FONT_STEPS.length-1,idx+(n>0?1:-1)));
    const scale=MOBILE_READER_FONT_STEPS[idx];
    document.documentElement.style.setProperty('--mcr-reader-scale',String(scale));
    try { localStorage.setItem(MOBILE_READER_FONT_KEY,String(scale)); } catch(e) {}
    window.dispatchEvent(new CustomEvent('mcr:reader-font-changed',{detail:{scale,source:'protocol-mobile-toolbar'}}));
    closeMobileProtocolMenus();
  }
  function setMobileToolPanel(name,open){
    const isFont=name==='font';
    const panel=root.querySelector(isFont?'#mtp-mobile-font-panel':'#mtp-mobile-nav-panel');
    const toggle=root.querySelector(isFont?'[data-action="mobile-font-menu"]':'[data-action="mobile-nav-menu"]');
    if(!panel||!toggle)return;
    panel.hidden=!open;toggle.setAttribute('aria-expanded',open?'true':'false');
  }
  function closeMobileProtocolMenus(){setMobileToolPanel('font',false);setMobileToolPanel('nav',false);}
  function toggleMobileProtocolMenu(name){
    const isFont=name==='font';
    const panel=root.querySelector(isFont?'#mtp-mobile-font-panel':'#mtp-mobile-nav-panel');
    const next=panel?panel.hidden:false;
    closeMobileProtocolMenus();
    if(next)setMobileToolPanel(name,true);
  }
  function syncMobileProtocolToolbar(){
    const panel=root.querySelector('#mtp-mobile-nav-panel');
    const toggle=root.querySelector('[data-action="mobile-nav-menu"]');
    const bar=root.querySelector('.mtp-tablet-specialty-bar');
    if(!panel||!toggle||!bar)return;
    const anchors=[...root.querySelectorAll('.mtp-anchor-scroll [data-action="quick-anchor"][data-target]')];
    const seen=new Set();
    const items=[];
    anchors.forEach(btn=>{
      const target=String(btn.dataset.target||'').trim();
      const label=cleanQuickNavLabel(btn.textContent||'').trim();
      if(!target||!label||seen.has(target))return;
      seen.add(target);items.push({target,label,active:btn.classList.contains('is-active')});
    });
    bar.classList.toggle('is-protocol-context',items.length>0);
    toggle.disabled=!items.length;
    panel.innerHTML=items.map(x=>`<button type="button" data-action="quick-anchor" data-target="${esc(x.target)}" role="menuitem"${x.active?' class="is-active"':''}>${esc(x.label)}</button>`).join('');
    if(!items.length) closeMobileProtocolMenus();
  }

  async function boot() {
    mountShell();
    try {
      const [status, specialties] = await Promise.all([api('status'), api('specialties?content_type='+encodeURIComponent(state.contentType))]);
      state.status = status;
      state.groups = specialties.groups || [];
      state.libraryTotal = Number.isFinite(Number(specialties.total)) ? Number(specialties.total) : null;
      renderStatus();
      renderSidebar();
      await hydrateFromUrl();
      registerSW();
    } catch(err) {
      renderFatal(err);
    }
  }

  function renderStatus() {
    const el = document.getElementById('mtp-icd-status');
    if (!el || !state.status) return;
    const connected = !!state.status.icd?.connected;
    el.classList.toggle('is-connected', connected);
    el.classList.toggle('is-disconnected', !connected);
    el.innerHTML = `<span class="mtp-dot"></span><span>${connected ? 'Liên thông ICD-10' : 'ICD-10 tạm thời chưa khả dụng'}</span>`;
    const publishedFallback = state.contentType==='procedure' ? (state.status.stats?.published_procedures ?? 0) : (state.status.stats?.published_protocols ?? state.status.stats?.published ?? 0);
    const all = Number.isFinite(Number(state.libraryTotal)) ? Number(state.libraryTotal) : Number(publishedFallback || 0);
    const count = document.getElementById('mtp-all-count');
    if (count) count.textContent = all.toLocaleString('vi-VN');
  }

  function renderSidebar() {
    const nav = document.getElementById('mtp-specialty-nav');
    if (!nav) return;
    nav.innerHTML = state.groups.map(group => {
      const specs = (group.specialties || []).map(sp => `
        <button class="mtp-specialty-item" type="button" data-group="${esc(group.key)}" data-specialty="${esc(sp.key)}">
          <span>${esc(sp.name_vi)}</span><b>${Number(sp.protocol_count || 0).toLocaleString('vi-VN')}</b>
        </button>`).join('');
      return `<section class="mtp-nav-group">
        <button class="mtp-group-item" type="button" data-group="${esc(group.key)}" data-specialty="">
          <span>${esc(group.name_vi)}</span><b>${Number(group.protocol_count || 0).toLocaleString('vi-VN')}</b>
        </button>
        <div class="mtp-nav-children">${specs}</div>
      </section>`;
    }).join('');
    updateNavActive();
  }

  function updateNavActive() {
    root.querySelectorAll('.mtp-nav-all,.mtp-group-item,.mtp-specialty-item').forEach(el => {
      const g=el.dataset.group || '', s=el.dataset.specialty || '';
      el.classList.toggle('is-active', g===state.group && s===state.specialty);
    });
    const label=document.getElementById('mtp-tablet-specialty-label');
    if (label) {
      const sp=state.specialty ? findSpecialty(state.specialty) : null;
      const group=state.group ? (state.groups||[]).find(x=>x.key===state.group) : null;
      label.textContent=sp?.name_vi || group?.name_vi || 'Tất cả chuyên khoa';
    }
  }

  function protocolSlugFromLocation() {
    const params = new URLSearchParams(location.search);
    const querySlug = params.get('protocol') || '';
    if (querySlug) return querySlug;
    const path = location.pathname.replace(/\/+$/,'');
    const match = state.contentType==='procedure' ? path.match(/\/medipharm\/quy-trinh\/([^/]+)$/i) : path.match(/\/medipharm\/([^/]+)$/i);
    if (match) {
      try { return decodeURIComponent(match[1]); } catch(e) { return match[1]; }
    }
    return cfg.initialProtocol || '';
  }

  async function hydrateFromUrl() {
    const params = new URLSearchParams(location.search);
    state.q = params.get('q') || '';
    state.group = params.get('group') || '';
    state.specialty = params.get('specialty') || '';
    const protocol = protocolSlugFromLocation();
    const input = document.getElementById('mtp-search');
    if (input) input.value = state.q;
    updateNavActive();
    if (protocol) await openProtocol(protocol, false);
    else await runSearch(false);
  }

  function syncUrl(mode='replace', options={}) {
    if (state.current?.slug) {
      const rootUrl = new URL(cfg.appRoot || cfg.appUrl || location.href, location.origin);
      let rootPath = rootUrl.pathname.replace(/\/+$/,'');
      if(state.contentType==='procedure') rootPath += '/quy-trinh';
      const suffix = cfg.draftPreview ? '?clinical_preview=1' : '';
      const pretty = rootPath + '/' + encodeURIComponent(state.current.slug) + '/' + suffix;
      const previous = history.state && typeof history.state === 'object' ? history.state : {};
      const returnUrl = safeInternalReturnUrl(options.returnUrl || previous.mtpReturnUrl || '') || libraryReturnUrl();
      const navState = Object.assign({}, previous, {
        mtpView:'protocol',
        mtpReturnUrl:returnUrl,
        mtpCanHistoryBack: mode === 'push'
      });
      history[mode === 'push' ? 'pushState' : 'replaceState'](navState, '', pretty);
      return;
    }
    const u = new URL(contentBaseUrl() || location.href, location.origin);
    if (state.q) u.searchParams.set('q', state.q);
    if (state.group) u.searchParams.set('group', state.group);
    if (state.specialty) u.searchParams.set('specialty', state.specialty);
    history[mode === 'push' ? 'pushState' : 'replaceState']({mtpView:'library'}, '', u.pathname + (u.search || ''));
  }

  function resetResultPaging() {
    state.results = [];
    state.total = 0;
    state.hasMore = false;
    state.nextOffset = 0;
    state.loadingMore = false;
  }

  function searchQuery(offset=0) {
    const qs = new URLSearchParams({
      limit:String(state.pageSize),
      offset:String(Math.max(0, Number(offset) || 0)),
      content_type:state.contentType
    });
    if (state.q) qs.set('q', state.q);
    if (state.specialty) qs.set('specialty', state.specialty);
    else if (state.group) qs.set('group', state.group);
    return qs;
  }

  async function runSearch(push=false) {
    state.loading = true;
    resetResultPaging();
    const main = document.getElementById('mtp-main');
    main.classList.remove('is-protocol-view');
    main.style.removeProperty('--mtp-anchor-sticky-height');
    main.style.removeProperty('--mtp-sticky-stack-height');
    main.innerHTML = `<div class="mtp-loading-page"><span class="mtp-spinner"></span><p>Đang tìm trong thư viện…</p></div>`;
    syncMobileProtocolToolbar();
    try {
      const data = await api('search?' + searchQuery(0).toString());
      state.results = data.results || [];
      state.total = Number.isFinite(Number(data.total)) ? Number(data.total) : state.results.length;
      if (!state.q && !state.group && !state.specialty) { state.libraryTotal = state.total; renderStatus(); }
      state.hasMore = Boolean(data.has_more);
      state.nextOffset = Number.isFinite(Number(data.next_offset)) ? Number(data.next_offset) : state.results.length;
      state.current = null;
      renderSearch();
      syncUrl(push ? 'push' : 'replace');
    } catch(err) {
      renderError(err);
    } finally { state.loading = false; }
  }

  function paginationLabel() {
    const copy=contentCopy();
    const shown=state.results.length;
    const total=Math.max(shown, Number(state.total || 0));
    if (!total) return '';
    return `Đang hiển thị ${shown.toLocaleString('vi-VN')}/${total.toLocaleString('vi-VN')} ${copy.noun}`;
  }

  function loadMoreMarkup() {
    if (!state.results.length) return '';
    const copy=contentCopy();
    const remaining=Math.max(0, Number(state.total || 0)-state.results.length);
    const next=Math.min(state.pageSize, remaining || state.pageSize);
    return `<div class="mtp-load-more-wrap" id="mtp-load-more-wrap">
      <span class="mtp-load-more-progress" id="mtp-load-more-progress">${esc(paginationLabel())}</span>
      ${state.hasMore ? `<button class="mtp-load-more-btn" type="button" data-action="load-more">Tải thêm ${next.toLocaleString('vi-VN')} ${esc(copy.noun)}</button>` : ''}
    </div>`;
  }

  function updateLoadMoreControls() {
    const wrap=document.getElementById('mtp-load-more-wrap');
    if (!wrap) return;
    const progress=wrap.querySelector('#mtp-load-more-progress');
    if (progress) progress.textContent=paginationLabel();
    let btn=wrap.querySelector('[data-action="load-more"]');
    const copy=contentCopy();
    const remaining=Math.max(0, Number(state.total || 0)-state.results.length);
    if (!state.hasMore || remaining<=0) {
      if (btn) btn.remove();
      return;
    }
    const next=Math.min(state.pageSize, remaining);
    if (!btn) {
      wrap.insertAdjacentHTML('beforeend', `<button class="mtp-load-more-btn" type="button" data-action="load-more"></button>`);
      btn=wrap.querySelector('[data-action="load-more"]');
    }
    btn.disabled=state.loadingMore;
    btn.classList.toggle('is-loading',state.loadingMore);
    btn.textContent=state.loadingMore ? 'Đang tải…' : `Tải thêm ${next.toLocaleString('vi-VN')} ${copy.noun}`;
  }

  async function loadMoreResults(button) {
    if (state.loadingMore || !state.hasMore) return;
    state.loadingMore=true;
    if (button) { button.disabled=true; button.classList.add('is-loading'); button.textContent='Đang tải…'; }
    try {
      const offset=state.nextOffset || state.results.length;
      const data=await api('search?' + searchQuery(offset).toString());
      const incoming=Array.isArray(data.results) ? data.results : [];
      const seen=new Set(state.results.map(row=>String(row.id || row.slug || '')));
      const fresh=incoming.filter(row=>{
        const key=String(row.id || row.slug || '');
        if (!key || seen.has(key)) return false;
        seen.add(key); return true;
      });
      state.results.push(...fresh);
      state.total=Number.isFinite(Number(data.total)) ? Number(data.total) : Math.max(state.total,state.results.length);
      state.hasMore=Boolean(data.has_more) && incoming.length>0;
      state.nextOffset=Number.isFinite(Number(data.next_offset)) ? Number(data.next_offset) : offset + incoming.length;
      const grid=document.querySelector('.mtp-card-grid');
      if (grid && fresh.length) grid.insertAdjacentHTML('beforeend',fresh.map(protocolCard).join(''));
    } catch(err) {
      const wrap=document.getElementById('mtp-load-more-wrap');
      if (wrap) {
        const old=wrap.querySelector('.mtp-load-more-error'); if(old) old.remove();
        wrap.insertAdjacentHTML('afterbegin', `<span class="mtp-load-more-error" role="status">${esc(err.message || 'Không tải được dữ liệu tiếp theo.')}</span>`);
      }
    } finally {
      state.loadingMore=false;
      updateLoadMoreControls();
    }
  }

  function renderSearch() {
    const main = document.getElementById('mtp-main');
    main.classList.remove('is-protocol-view');
    const filtered = state.q || state.group || state.specialty;
    const copy=contentCopy();
    const title = filtered ? 'Kết quả tra cứu' : copy.title;
    const sub = filtered ? filterDescription() : copy.sub;
    const fallbackTotal = Number(state.contentType==='procedure' ? (state.status?.stats?.published_procedures||0) : (state.status?.stats?.published_protocols||state.status?.stats?.published||0));
    const visibleCount = Number.isFinite(Number(state.total)) && Number(state.total)>=0 ? Number(state.total) : (fallbackTotal || state.results.length);
    main.innerHTML = `
      <section class="mtp-home-head">
        <div>
          <h1>${esc(title)}</h1>
          <p>${esc(sub)}</p>
        </div>
        <div class="mtp-home-actions">
          ${filtered ? `<button class="mtp-soft-btn" type="button" data-action="clear-search">Xóa bộ lọc</button>` : ''}
        </div>
      </section>
      <section class="mtp-result-section">
        <div class="mtp-section-line"><strong>${visibleCount.toLocaleString('vi-VN')} ${esc(copy.noun)}</strong><span>Tìm theo tên Việt/Anh · ICD-10 · từ khóa · triệu chứng</span></div>
        ${state.results.length ? `<div class="mtp-card-grid">${state.results.map(protocolCard).join('')}</div>${loadMoreMarkup()}` : emptyState()}
      </section>`;
    syncMobileProtocolToolbar();
  }

  function filterDescription() {
    const bits=[];
    if (state.q) bits.push(`“${state.q}”`);
    if (state.specialty) {
      const sp=findSpecialty(state.specialty); if (sp) bits.push(sp.name_vi);
    } else if (state.group) {
      const g=state.groups.find(x=>x.key===state.group); if (g) bits.push(g.name_vi);
    }
    return bits.length ? bits.join(' · ') : contentCopy().title;
  }

  function findSpecialty(key) {
    for (const g of state.groups) for (const s of (g.specialties||[])) if (s.key===key) return s;
    return null;
  }

  function protocolCard(p) {
    const icd = (p.icd || []).slice(0,4).map(x=>`<span class="mtp-chip mtp-icd-chip">${esc(x.code)}</span>`).join('');
    const stateTag = '';
    return `<article class="mtp-protocol-card" data-protocol="${esc(p.slug)}" data-specialty="${esc(p.specialty_key || '')}" tabindex="0">
      <div class="mtp-card-meta"><span>${esc(p.specialty_name_vi)}</span>${stateTag}</div>
      <h3>${esc(p.title_vi)}</h3>
      ${userSummary(p.summary)?`<p class="mtp-summary">${esc(userSummary(p.summary))}</p>`:''}
      <div class="mtp-card-foot"><div>${icd}</div><span class="mtp-open-arrow">→</span></div>
    </article>`;
  }

  function stripHtml(v) {
    const d=document.createElement('div'); d.innerHTML=v; return d.textContent || d.innerText || '';
  }

  function cleanReaderAnnotationText(value) {
    return String(value||'')
      .replace(/\s*\btrong\s+tài\s+liệu\s+gốc\s*\.?/giu,'')
      .replace(/[ \t]{2,}/g,' ')
      .replace(/\s+([,.;:!?])/g,'$1')
      .trim();
  }

  function cleanReaderAnnotationHtml(raw) {
    const holder=document.createElement('div');
    holder.innerHTML=String(raw||'');
    // Remove synthetic source-presence notes such as “Lưu đồ ... trong tài liệu gốc.”
    // These are editorial/import annotations, not clinical source content.
    [...holder.querySelectorAll('p,div,em,i,small,figcaption,blockquote')].forEach(el=>{
      if (el.querySelector('img,figure,svg,table,ul,ol')) return;
      const text=String(el.textContent||'').replace(/\s+/g,' ').trim();
      if (/^(?:lưu đồ|sơ đồ|hình|bảng|xem)\b.{0,220}\btrong\s+tài\s+liệu\s+gốc\s*\.?$/iu.test(text)) el.remove();
    });
    const walker=document.createTreeWalker(holder,NodeFilter.SHOW_TEXT);
    const nodes=[]; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node=>{ node.nodeValue=cleanReaderAnnotationText(node.nodeValue||''); });
    [...holder.querySelectorAll('p,div,em,i,small,figcaption,blockquote')].forEach(el=>{
      if (!el.querySelector('img,figure,svg,table,ul,ol') && !String(el.textContent||'').trim()) el.remove();
    });
    return holder.innerHTML;
  }

  function structuredFieldHtml(raw) {
    const html=cleanReaderAnnotationHtml(String(raw || '').trim());
    if (!html) return '';
    const holder=document.createElement('div');
    holder.innerHTML=html;
    const hasStructuredBlocks=!!holder.querySelector('h2,h3,h4,h5,h6,p,ul,ol,table,blockquote');
    if (hasStructuredBlocks) return prepareModuleHtml(html);

    // Fallback for future imports that arrive as flattened plain text. Only split
    // hierarchical source numbering such as 2.1., 2.2., 3.1.1.; do not rewrite
    // ordinary decimal values or change the source wording.
    const text=stripHtml(html).replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').trim();
    const marker=/(^|\s)(\d+(?:\.\d+)+\.)\s+/g;
    const matches=[...text.matchAll(marker)];
    if (matches.length < 2) return `<p>${esc(text)}</p>`;
    const chunks=[];
    for (let idx=0; idx<matches.length; idx++) {
      const m=matches[idx];
      const start=m.index + m[1].length;
      const end=idx+1<matches.length ? matches[idx+1].index + matches[idx+1][1].length : text.length;
      const chunk=text.slice(start,end).trim();
      const number=m[2];
      const body=chunk.slice(number.length).trim();
      chunks.push(`<div class="mtp-structured-item"><strong>${esc(number)}</strong><span>${esc(body)}</span></div>`);
    }
    const prefix=text.slice(0,matches[0].index).trim();
    return `${prefix?`<p>${esc(prefix)}</p>`:''}${chunks.join('')}`;
  }

  function userSummary(v) {
    let text=cleanReaderAnnotationText(stripHtml(v || '').trim());
    if (!text) return '';
    let sentences=text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    if (/^Phác đồ cấu trúc hóa từ\s+/i.test(text)) sentences.shift();
    sentences=sentences.filter(sentence=>!INTERNAL_READER_RE.test(sentence));
    return sentences.join(' ').replace(/\s+/g,' ').trim();
  }

  function emptyState() {
    return `<div class="mtp-empty"><div class="mtp-empty-icon">⌕</div><h3>Chưa tìm thấy phác đồ phù hợp</h3><p>Thử tên bệnh tiếng Việt/Anh, mã ICD-10, triệu chứng hoặc chọn một chuyên khoa khác.</p></div>`;
  }

  const GUEST_VIEW_KEY='mcr-guest-protocol-views';
  function guestLimit(){return Math.max(1,Number(cfg.guestViewLimit||10));}
  function guestViews(){if(cfg.isLoggedIn)return 0;try{return Math.max(0,Number(localStorage.getItem(GUEST_VIEW_KEY)||0));}catch(e){return 0;}}
  function guestRemaining(){return Math.max(0,guestLimit()-guestViews());}
  function notifyGuestViews(){window.dispatchEvent(new CustomEvent('mcr:guest-views-updated',{detail:{used:guestViews(),remaining:guestRemaining(),limit:guestLimit()}}));}
  function openGuestGate(){window.dispatchEvent(new CustomEvent('mcr:login-required',{detail:{reason:'guest-limit'}}));const b=document.querySelector('[data-mcr-login-open]');if(b)b.click();}
  function canOpenGuestProtocol(){if(cfg.isLoggedIn)return true;if(guestViews()>=guestLimit()){openGuestGate();return false;}return true;}
  function countGuestProtocolView(){if(cfg.isLoggedIn)return;try{localStorage.setItem(GUEST_VIEW_KEY,String(Math.min(guestLimit(),guestViews()+1)));}catch(e){}notifyGuestViews();}

  async function openProtocol(slug, push=false) {
    if(!canOpenGuestProtocol()) return;
    const returnUrl = push ? libraryReturnUrl() : '';
    const main=document.getElementById('mtp-main');
    main.innerHTML=`<div class="mtp-loading-page"><span class="mtp-spinner"></span><p>Đang mở phác đồ…</p></div>`;
    try {
      const p=await api('protocol/' + encodeURIComponent(slug));
      state.current=p;
      countGuestProtocolView();
      renderProtocol(p);
      syncUrl(push ? 'push':'replace', {returnUrl});
      main.scrollTop=0;
    } catch(err) { renderError(err); }
  }

  function renderProtocol(p) {
    if (String(p.desk_schema_version||'')==='1.0') return renderDeskProtocol(p);
    const main=document.getElementById('mtp-main');
    main.classList.add('is-protocol-view');
    const primarySource=(p.sources||[]).find(x=>Number(x.is_primary)===1) || (p.sources||[])[0];
    const icd=(p.icd||[]).map(icdBadge).join('');
    const sources=(p.sources||[]).map((x,i)=>sourceCard(x,i+1)).join('');
    const recommendations=(p.recommendations||[]).map(recommendationCard).join('');
    state.investigationFilter='all';
    state.investigationExpanded=false;

    const invNow=effectiveInvestigations(p);
    const navComponents=(p.canonical_components||[])
      .filter(c=>c && c.status!=='review' && String(c.key||'')!=='sources')
      .filter(c=>String(c.key||'')!=='investigations' || invNow.length>0)
      .map(c=>({...c}));
    if (invNow.length && !navComponents.some(c=>String(c.key||'')==='investigations')) {
      navComponents.push({key:'investigations',label:'Cận lâm sàng',order:40,status:'structured'});
    }
    navComponents.sort((a,b)=>Number(a.order||999)-Number(b.order||999));
    const modules=canonicalModuleStream(p.modules||[], invNow.length>0);
    const quickNav=navComponents.map(c=>{
      const key=String(c.key||'');
      const target=key==='investigations'?'mtp-investigations':`mtp-component-${esc(key)}`;
      return `<button type="button" data-action="quick-anchor" data-target="${target}">${esc(cleanQuickNavLabel(c.label||'Nội dung'))}</button>`;
    }).join('');

    main.innerHTML=`
      <div class="mtp-protocol-page">
        <div class="mtp-detail-toolbar">
          <a class="mtp-back-btn" href="${esc(libraryReturnUrl())}" data-back>← Quay lại</a>
          <div class="mtp-detail-trail"><span>${esc(p.group_name_vi)}</span><b>›</b><span>${esc(p.specialty_name_vi)}</span></div>
        </div>


        <header class="mtp-protocol-head" data-specialty="${esc(p.specialty_key || '')}">
          <div class="mtp-title-block">
            <div class="mtp-kicker">${esc(p.specialty_name_vi)}</div>
            <h1>${esc(p.title_vi)}</h1>
            <div class="mtp-icd-row">${icd}</div>
          </div>
          ${primarySource ? `<div class="mtp-primary-source">
            <span>Nguồn tham khảo</span><strong>${esc(primarySourceDisplay(primarySource))}</strong>
            ${publicSourceUrl(primarySource) ? `<a href="${esc(publicSourceUrl(primarySource))}" target="_blank" rel="noopener">Xem nguồn ↗</a>`:''}
          </div>`:''}
        </header>

        ${userSummary(p.summary)?`<div class="mtp-summary-box">${esc(userSummary(p.summary))}</div>`:''}

        <nav class="mtp-anchor-bar" aria-label="Điều hướng nhanh phác đồ">
          <button class="mtp-anchor-pan is-prev" type="button" data-action="anchor-scroll" data-dir="-1" aria-label="Xem các mục trước" title="Xem các mục trước">‹</button>
          <div class="mtp-anchor-scroll">
            ${quickNav}
            ${(p.recommendations||[]).length ? '<button type="button" data-action="quick-anchor" data-target="mtp-recommendations">Cập nhật & khuyến cáo</button>' : ''}
            <button type="button" data-action="quick-anchor" data-target="mtp-sources">Tài liệu tham khảo</button>
          </div>
          <button class="mtp-anchor-pan is-next" type="button" data-action="anchor-scroll" data-dir="1" aria-label="Xem các mục tiếp theo" title="Xem các mục tiếp theo">›</button>
          <div class="mtp-anchor-actions">
            <button type="button" class="mtp-anchor-toggle-all" data-action="toggle-all" title="Thu gọn tất cả" aria-label="Thu gọn tất cả" aria-pressed="false"><span aria-hidden="true">⇅</span><b>Thu</b></button>
          </div>
        </nav>

        <div class="mtp-protocol-stream" id="mtp-clinical-stream">${modules}</div>

        ${(p.recommendations||[]).length ? `<section class="mtp-recommendation-section" id="mtp-recommendations">
          <div class="mtp-section-line"><strong>Cập nhật & khuyến cáo mới</strong><span>Các khuyến cáo mới hơn được trình bày riêng và có nguồn tham khảo kèm theo</span></div>
          <div class="mtp-update-notice"><strong>LƯU Ý</strong><span>Nội dung cập nhật không thay thế phác đồ Bộ Y tế đang hiển thị.</span></div>
          <div class="mtp-recommendation-grid">${recommendations}</div>
        </section>` : ''}

        <section class="mtp-source-section" id="mtp-sources">
          <div class="mtp-section-line"><strong>Tài liệu tham khảo</strong><span>Đầy đủ nguồn đã sử dụng và ngày truy cập</span></div>
          <div class="mtp-source-grid">${sources || '<p>Chưa có nguồn được gắn.</p>'}</div>
        </section>
      </div>`;

    renderInvestigationPanel();
    refreshStickyLayout();
  }


  function deskRows(rows, cols, empty='Chưa có dữ liệu cấu trúc.') {
    if (!rows || !rows.length) return `<p class="mtp-desk-empty">${esc(empty)}</p>`;
    const head=cols.map(c=>`<th>${esc(c.label)}</th>`).join('');
    const body=rows.map(r=>`<tr>${cols.map(c=>`<td data-label="${esc(c.label)}">${c.html ? (r[c.key]||'—') : esc(r[c.key]||'—')}</td>`).join('')}</tr>`).join('');
    return `<div class="mtp-desk-table-wrap"><table class="mtp-desk-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function deskSection(id,title,body,sub='') {
    return `<section class="mtp-desk-section" id="${esc(id)}"><div class="mtp-desk-section-head"><h2>${esc(title)}</h2>${sub?`<span>${esc(sub)}</span>`:''}</div>${body}</section>`;
  }

  function cleanQuickNavLabel(v){return sourceReaderText(v).replace(/\s*[:;]+\s*$/u,'').trim();}
  function primarySourceDisplay(s){const org=String((s&&s.organization)||'').trim();return org?`Phác đồ điều trị, ${org}.`:'Phác đồ điều trị.';}

  function readerHeadingKey(v) {
    return stripHtml(String(v||''))
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'d')
      .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  }

  function sourceFidelityBlockTexts(html) {
    const holder=document.createElement('div');
    holder.innerHTML=String(html||'');
    const nodes=[...holder.children];
    if (!nodes.length) {
      const text=(holder.textContent||'').replace(/\s+/g,' ').trim();
      return text ? [text] : [];
    }
    return nodes.map(el=>(el.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean);
  }

  const SOURCE_READER_CANONICAL_HEADINGS=new Set([
    'dai cuong','tong quan','gioi thieu','dinh nghia','dich te','dich te hoc','phan loai','nguyen nhan','can nguyen',
    'yeu to nguy co','sinh ly benh','benh sinh','giai phau benh','bieu hien lam sang','lam sang','trieu chung','dau hieu',
    'chan doan','tiep can chan doan','chan doan phan biet','can lam sang','xet nghiem','tham do','hinh anh hoc',
    'phan tang','phan tang nguy co','muc do nang','dieu tri','xu tri','dieu tri noi khoa','dieu tri ngoai khoa','dieu tri ho tro',
    'dieu tri dac hieu','theo doi','danh gia dap ung','bien chung','tien luong','du phong','phong benh','tai kham',
    'cham soc','quan ly','chi dinh nhap vien','tieu chuan nhap vien','tieu chuan ra vien','cap nhat huong dan','tai lieu tham khao','tai lieu doc them'
  ]);

  function sourceReaderText(v) {
    return String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  }

  // Source documents sometimes encode list items as headings. Treat a broad but
  // anchored set of Word/PDF list markers as subpoints before any heading logic.
  // This is presentation-only; stored source HTML is not modified.
  const SOURCE_READER_LIST_MARKER_RE=/^(?:[+*·∙•●▪▫∘○◦‒–—−‐‑‧✓■□►▸-]+)\s*/u;

  function sourceReaderListMarkerLike(v) {
    const text=sourceReaderText(v);
    return !!text && SOURCE_READER_LIST_MARKER_RE.test(text);
  }

  function sourceReaderSentenceLike(v) {
    const text=sourceReaderText(v);
    if (!text) return false;
    if (sourceReaderListMarkerLike(text)) return true;
    const key=readerHeadingKey(text);
    const words=text.split(/\s+/).filter(Boolean);
    const firstLetter=[...text].find(ch=>ch.toLowerCase()!==ch.toUpperCase()) || '';
    const lowerStart=firstLetter && firstLetter===firstLetter.toLowerCase();
    if (SOURCE_READER_CANONICAL_HEADINGS.has(key) && !/[.,;:!?]$/.test(text)) return false;
    const startsContinuation=/^(và|với|nhưng|tuy nhiên|ngoài ra|do đó|vì vậy|khi|nếu|hoặc|đồng thời|sau đó|trong đó|mặc dù|cũng|được|có thể|thường|nặng|tăng|giảm|nôn|tình trạng|trạng thái|sau|trước|bệnh nhân|người bệnh|các|những|một|hai|ba|bốn|năm)(?=$|[\s,.;:!?()\[\]…])/iu.test(text);
    const internalSentence=/[.!?]\s+[A-ZÀ-ỸĐ]/.test(text);
    const trailingContinuation=/[,;:]$/.test(text);
    const endsSentence=/[.!?…][\)\]”’"']*$/.test(text);
    const looksNarrative=(words.length>=8 && /\s/.test(text)) || text.length>82;
    return lowerStart || startsContinuation || internalSentence || trailingContinuation || looksNarrative || (endsSentence && words.length>=5);
  }

  function sourceReaderHeadingLike(v) {
    const text=sourceReaderText(v);
    if (!text) return false;
    if (sourceReaderListMarkerLike(text)) return false;
    // v3.5.24: a pure parenthetical acronym/label is a continuation or caption
    // fragment, never a source-level heading. PDF extraction can isolate `(WHO)`
    // or `(DEQUERVAIN)` on its own visual line; promoting that fragment creates
    // a false reader section and QuickNav destination.
    if (/^\(\s*[A-ZĐÀ-Ỹ0-9][A-ZĐÀ-Ỹ0-9 .+\-\/]{0,40}\s*\)$/u.test(text)) return false;
    const key=readerHeadingKey(text);
    if (SOURCE_READER_CANONICAL_HEADINGS.has(key) && !/[.,;:!?]$/.test(text)) return true;
    if (sourceReaderSentenceLike(text)) return false;
    const words=text.split(/\s+/).filter(Boolean);
    const letters=[...text].filter(ch=>ch.toLowerCase()!==ch.toUpperCase());
    const upperRatio=letters.length ? letters.filter(ch=>ch===ch.toUpperCase()).length/letters.length : 0;
    if (text.length<=64 && words.length<=6 && upperRatio>=0.72 && !/[.!?;:,]$/.test(text)) return true;
    // v2.0.8.8: do not promote a short Title-Case clinical sentence merely
    // because it starts with an uppercase letter. Source hospital documents
    // contain many standalone prose lines such as “Tiên lượng rất xấu”.
    // Unnumbered headings must therefore be canonical clinical headings or
    // have strong all-caps evidence. This deliberately prefers preserving
    // prose over inventing a navigation boundary.
    return false;
  }

  function sourceReaderAlphabeticSubheading(v) {
    const text=sourceReaderText(v);
    if (!text) return false;
    const m=text.match(/^([A-Za-zĐđ])[.)]\s+(.+)$/u);
    if (!m) return false;
    const marker=m[1];
    const label=sourceReaderText(m[2]||'');
    if (!label || label.length>180) return false;
    // Lower-case letter markers are always alphabetic subsections. For upper-case
    // markers, preserve the common single Roman majors I/V/X; other single letters
    // (notably A/B/C/D in hospital protocols) are alphabetic subsections.
    if (marker===marker.toLowerCase()) return true;
    return !/^[IVX]$/.test(marker);
  }

  // v2.7: PDF/DOCX extraction can serialize short continuation fragments as
  // headings. Keep real numbered/alphabetic structure, but demote fragments such
  // as "B, C...", "A,B,C)", "lượng:" or "đích nhằm:" when their
  // surrounding syntax proves they continue the previous sentence.
  function sourceReaderNumberedSubheading(v) {
    const text=sourceReaderText(v);
    if (!text) return false;
    return /^\d{1,3}(?:\.\d{1,3}){0,3}[.)]?\s+\S/u.test(text);
  }

  function sourceReaderCompactEnumerationFragment(v) {
    const text=sourceReaderText(v);
    if (!text || text.length>40) return false;
    return /^(?:[A-ZĐ](?:\s*,\s*[A-ZĐ]){1,7})(?:[.)]|\.{2,}|…)?$/u.test(text);
  }

  function sourceReaderShortStandaloneHeading(v) {
    const text=sourceReaderText(v);
    if (!text) return false;
    if (sourceReaderHeadingLike(text)) return true;
    const words=text.replace(/[:：]\s*$/u,'').trim().split(/\s+/).filter(Boolean);
    const first=[...text].find(ch=>ch.toLowerCase()!==ch.toUpperCase()) || '';
    const upperStart=!!first && first===first.toUpperCase();
    return /[:：]\s*$/u.test(text) && upperStart && words.length<=6 && text.length<=64 && !/[.!?]/.test(text.replace(/[:：]\s*$/u,''));
  }

  function sourceReaderHeadingFragmentContinuation(previousText,currentText) {
    const previous=sourceReaderText(previousText);
    const current=sourceReaderText(currentText);
    if (!previous || !current) return false;
    if (sourceReaderMajorHeadingKind(current) || sourceReaderAlphabeticSubheading(current) || sourceReaderNumberedSubheading(current)) return false;
    if (sourceReaderCompactEnumerationFragment(current)) {
      return sourceReaderHasOpenDelimiter(previous) || /[,;:(\[]\s*$/u.test(previous) || !sourceReaderEndsParagraph(previous);
    }
    if (sourceReaderLooksLikeContinuation(current) && !sourceReaderEndsParagraph(previous)) return true;
    if (sourceReaderHasOpenDelimiter(previous) || sourceReaderEndsWithContinuationCue(previous)) return true;
    return false;
  }

  function sourceReaderMajorHeadingKind(v) {
    const text=sourceReaderText(v);
    if (!text) return '';
    // v2.5: alphabetic subsections (a./b./c./d. ...) are never top-level
    // destinations. This must run before Roman parsing because D/C/L/M are
    // themselves Roman-numeral characters and would otherwise be misclassified.
    if (sourceReaderAlphabeticSubheading(text)) return '';
    // Top-level headings in hospital documents occur as “2. CHẨN ĐOÁN”,
    // “2 CHẨN ĐOÁN”, “1.ĐẠI CƯƠNG”, or Roman equivalents. A dot followed
    // by another digit is a subsection (1.2, 2.3.1), never a major heading.
    const m=text.match(/^(?:([IVXLCDM]+|\d{1,2})[.)]\s*(?!\d)(.+)|([IVXLCDM]+|\d{1,2})\s+(.+))$/iu);
    if (!m) return '';
    const marker=String(m[1]||m[3]||'');
    const label=sourceReaderText(m[2]||m[4]||'').replace(/[;:]\s*$/,'').trim();
    if (!label || label.length>140) return '';
    const words=label.split(/\s+/).filter(Boolean);
    if (!words.length || words.length>16) return '';
    const key=readerHeadingKey(label);
    const semantic=/^(?:dai cuong|tong quan|gioi thieu|dinh nghia|dich te|phan loai|nguyen nhan|yeu to nguy co|danh gia benh nhan|danh gia|benh su|lam sang|can lam sang|chan doan|tiep can chan doan|phan tang|muc do|dieu tri|xu tri|theo doi|bien chung|tien luong|du phong|phong ngua|tai kham|tai lieu tham khao|muc dich|nguyen tac|tieu chuan|chi dinh|chong chi dinh)(?:\s|$)/.test(key);
    const letters=[...label].filter(ch=>ch.toLowerCase()!==ch.toUpperCase());
    const upperRatio=letters.length ? letters.filter(ch=>ch===ch.toUpperCase()).length/letters.length : 0;
    if (!semantic && upperRatio<0.68) return '';
    return /^[IVXLCDM]+$/i.test(marker) ? 'roman' : 'arabic';
  }

  function sourceReaderMajorNumberedHeading(v) {
    return !!sourceReaderMajorHeadingKind(v);
  }

  // v2.0.8.10: presentation-only cleanup for top-level source headings.
  // Hospital Word files frequently end headings with ':' or ';'. The source
  // text remains unchanged in storage, but the reader and quick navigation
  // show a cleaner clinical hierarchy without terminal punctuation.
  function sourceReaderDisplayMajorHeading(v) {
    const text=sourceReaderText(v);
    if (!text) return '';
    if (sourceReaderMajorHeadingKind(text) || sourceReferenceHeading(text) || readerHeadingKey(text)==='cap nhat huong dan') {
      return text.replace(/\s*[:;]\s*$/u,'').trim();
    }
    return text;
  }

  // v2.8: compare headings by their clinical semantic label, not only by the
  // literal numbered text. This prevents a section title such as
  // `III. ĐIỀU TRỊ` from being repeated by an imported/runtime heading
  // `ĐIỀU TRỊ`, and likewise for `IV. TIÊN LƯỢNG` / `TIÊN LƯỢNG`.
  function sourceReaderSemanticHeadingKey(v) {
    let text=sourceReaderDisplayMajorHeading(v);
    if (!text) return '';
    const m=text.match(/^(?:[IVXLCDM]+|\d{1,2})[.)-]?\s+(.+)$/iu);
    if (m) text=sourceReaderText(m[1]||'');
    return readerHeadingKey(text);
  }

  function sourceReaderRemoveDuplicateLeadHeading(root, sectionTitle) {
    if (!root) return root;
    const sectionKey=sourceReaderSemanticHeadingKey(sectionTitle);
    if (!sectionKey) return root;
    for (;;) {
      const first=root.firstElementChild;
      if (!first) break;
      const firstText=sourceReaderText(first.textContent||'');
      // v3.5.8: an image/figure/table can legitimately be the first and only
      // content of a source-fidelity section (for example a source flowchart).
      // Never treat meaningful non-text media as an empty duplicate-heading
      // artifact merely because textContent is empty.
      if (!firstText) {
        if (sourceReaderNodeHasMeaningfulContent(first) || /^(?:IMG|FIGURE|SVG|TABLE|VIDEO|AUDIO|IFRAME)$/.test(first.tagName)) break;
        first.remove();
        continue;
      }

      // v3.1: legacy source articles can retain a presentation wrapper around
      // the first clinical block. Descend into that leading wrapper before
      // comparing headings; otherwise `II. CHẨN ĐOÁN` + `CHẨN ĐOÁN` survives
      // merely because the duplicate H3/H4 is one DOM level deeper.
      if (!/^H[1-6]$/.test(first.tagName) && first.tagName!=='P') {
        const nestedFirst=first.firstElementChild;
        const leadingTextNodes=[...first.childNodes].slice(0,Math.max(0,[...first.childNodes].indexOf(nestedFirst))).some(node=>node.nodeType===Node.TEXT_NODE && sourceReaderText(node.textContent||''));
        if (nestedFirst && !leadingTextNodes) {
          const before=first.innerHTML;
          sourceReaderRemoveDuplicateLeadHeading(first,sectionTitle);
          if (!sourceReaderText(first.textContent||'') && !first.querySelector('table,ul,ol,img,figure,svg,video,audio')) { first.remove(); continue; }
          if (first.innerHTML!==before) continue;
        }
        break;
      }

      const firstKey=sourceReaderSemanticHeadingKey(firstText);
      const headingEvidence=/^H[1-6]$/.test(first.tagName) || sourceReaderHeadingLike(firstText) || !!sourceReaderMajorHeadingKind(firstText);
      if (!headingEvidence || firstKey!==sectionKey) break;
      first.remove();
    }
    return root;
  }

  function sourceReaderIsBulletElement(el) {
    if (!el) return false;
    const text=sourceReaderText(el.textContent||'');
    return el.classList.contains('mtp-source-bullet') || sourceReaderListMarkerLike(text);
  }

  function sourceReaderEndsParagraph(text) {
    const t=sourceReaderText(text);
    return /[.!?…][\)\]”’\"']*$/.test(t);
  }

  function sourceReaderStartsNewSentence(text) {
    const t=sourceReaderText(text);
    if (!t) return false;
    const first=[...t].find(ch=>ch.toLowerCase()!==ch.toUpperCase());
    return !!first && first===first.toUpperCase();
  }

  function sourceReaderLooksLikeContinuation(text) {
    const t=sourceReaderText(text);
    if (!t) return false;
    const first=[...t].find(ch=>ch.toLowerCase()!==ch.toUpperCase()) || '';
    const lowerStart=!!first && first===first.toLowerCase();
    const startsContinuation=/^(và|với|nhưng|tuy nhiên|ngoài ra|do đó|vì vậy|khi|nếu|hoặc|đồng thời|sau đó|trong đó|mặc dù|cũng|được|có thể|thường|nặng|tăng|giảm|tái|sát|thấy|ở|tại|cho|của|đến|từ|theo|bằng|như|là|kèm|không|cần|nên|sau|trước|bệnh nhân|người bệnh|các|những|một|hai|ba|bốn|năm)(?=$|[\s,.;:!?()\[\]…])/iu.test(t);
    return lowerStart || startsContinuation;
  }

  function sourceReaderHasOpenDelimiter(text) {
    const t=sourceReaderText(text);
    const count=(ch)=>[...t].filter(x=>x===ch).length;
    return count('(')>count(')') || count('[')>count(']');
  }

  function sourceReaderEndsWithContinuationCue(text) {
    const t=sourceReaderText(text);
    if (!t) return false;
    if (/[,;\/(\[–—-]$/.test(t)) return true;
    return /(?:\s|^)(?:và|hoặc|hay|với|của|trong|cho|do|tại|ở|đến|từ|theo|bằng|như|là|gồm|bao gồm|kèm|khi|nếu|mà|sau|trước)$/iu.test(t);
  }

  function sourceReaderStartsExplicitBoundary(text) {
    const t=sourceReaderText(text);
    if (!t) return false;
    if (sourceReaderAlphabeticSubheading(t)) return true;
    if (/^(?:\d{1,3}|[IVXLCDM]{1,8})[.)]\s+/iu.test(t)) return true;
    if (/[:：]$/.test(t) && t.length<=130 && t.split(/\s+/).filter(Boolean).length<=10) return true;
    if (/^[A-ZĐÀ-Ỹ][A-ZĐÀ-Ỹ0-9 /&+()\-]{2,72}[:：]?$/u.test(t)) return true;
    return sourceReaderHeadingLike(t);
  }

  function sourceReaderShouldMergeContinuation(previousText, currentText, options={}) {
    const previous=sourceReaderText(previousText);
    const current=sourceReaderStripLeadingBulletText(currentText);
    if (!previous || !current) return false;
    if (sourceReaderStartsExplicitBoundary(current)) return false;
    if (sourceReaderEndsParagraph(previous) && !sourceReaderHasOpenDelimiter(previous)) return false;
    if (sourceReaderLooksLikeContinuation(current)) return true;
    if (sourceReaderHasOpenDelimiter(previous) || sourceReaderEndsWithContinuationCue(previous)) return true;
    if (options.allowUppercaseAcronym && /^(?:[A-ZĐ]{2,}(?:[-/][A-Z0-9]{2,})?|\d+(?:[.,]\d+)?%?)(?=$|[\s,.;:!?()])/u.test(current)) return true;
    return false;
  }

  function sourceReaderCanMergeBullet(lastParagraph, text) {
    if (!lastParagraph || !lastParagraph.classList || !lastParagraph.classList.contains('mtp-source-bullet')) return false;
    return sourceReaderShouldMergeContinuation(lastParagraph.textContent||'',text,{allowUppercaseAcronym:true});
  }

  function sourceReaderCollapseSoftBreaks(root) {
    if (!root || !root.querySelectorAll) return root;
    root.querySelectorAll('p,li,h2,h3,h4,h5,h6').forEach(block=>{
      if (block.closest('pre,code,table')) return;
      [...block.querySelectorAll('br')].forEach(br=>{
        const prev=br.previousSibling, next=br.nextSibling;
        const adjacentBreak=(prev && prev.nodeType===Node.ELEMENT_NODE && prev.tagName==='BR') || (next && next.nodeType===Node.ELEMENT_NODE && next.tagName==='BR');
        if (adjacentBreak) return;
        br.replaceWith(document.createTextNode(' '));
      });
    });
    return root;
  }

  // v3.5.13: source PDFs from several hospital corpora contain a mix of
  // (a) visual line fragments serialized as one PRE per printed line,
  // (b) decomposed Vietnamese combining marks separated by an extraction space,
  // and (c) symbol-font glyphs whose ToUnicode map exposes legacy characters
  // such as Æ for a right arrow. Repair only the reader copy; the imported source
  // remains available through provenance/media and corrective re-import bundles.
  function sourceReaderRepairPdfUnicodeArtifacts(root) {
    if (!root || !root.ownerDocument) return root;
    const fix=(raw)=>{
      let s=String(raw||'');
      // PDF extractors can emit "Hiê ̣p" / "triê ̣u" (space before combining mark).
      s=s.replace(/([\p{L}])\s+([\u0300-\u036f]+)/gu,'$1$2');
      if (s.normalize) s=s.normalize('NFC');
      // Symbol-font mappings observed in the Viện Tim 2022 source.
      s=s.replace(/Æ/g,'→');
      s=s.replace(/(^|\n\s*)¾(?=\s+)/g,'$1•');
      // Tightly-scoped legacy Vietnamese extraction artefacts observed in the
      // already-published Nhi Đồng 2 source corpus.
      s=s.replace(/\bTHÖC\b/g,'THÚC').replace(/\bThÖc\b/g,'Thúc').replace(/\bthÖc\b/g,'thúc');
      s=s.replace(/\bĐỘT QUÎ\b/g,'ĐỘT QUỴ').replace(/\bĐột quî\b/g,'Đột quỵ').replace(/\bđột quî\b/g,'đột quỵ');
      s=s.replace(/\bKHƠNG\b/g,'KHÔNG').replace(/\bKhơng\b/g,'Không').replace(/\bkhơng\b/g,'không');
      return s;
    };
    const walker=root.ownerDocument.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[]; let node;
    while((node=walker.nextNode())) nodes.push(node);
    nodes.forEach(n=>{const v=fix(n.nodeValue||''); if(v!==n.nodeValue)n.nodeValue=v;});
    return root;
  }

  function sourceReaderReflowAdjacentPreVisualLines(root) {
    if (!root || !root.querySelectorAll) return root;
    const isPre=n=>!!(n&&n.matches&&n.matches('pre.mcr-source-layout-table'));
    const text=n=>sourceReaderText(n&&n.textContent||'');
    const tableish=t=>/\S\s{3,}\S/u.test(String(t||'')) || /(?:─{3,}|-{5,}|_{5,}|→.*→|←.*←)/u.test(String(t||''));
    const boundary=t=>{
      const v=sourceReaderText(t||'');
      if(!v)return true;
      if(sourceReaderMajorHeadingKind(v)||sourceReaderAlphabeticSubheading(v)||sourceReaderNumberedSubheading(v))return true;
      if(/^(?:Bảng|Hình|Sơ đồ|Lưu đồ|TÀI LIỆU THAM KHẢO)\b/iu.test(v))return true;
      return tableish(v);
    };
    let changed=true,guard=0;
    while(changed&&guard++<4000){
      changed=false;
      const pres=[...root.querySelectorAll('pre.mcr-source-layout-table')];
      for(const pre of pres){
        if(!pre.parentNode)continue;
        const cur=text(pre); if(!cur||boundary(cur))continue;
        const next=pre.nextElementSibling;
        if(!isPre(next))continue;
        const nxt=text(next); if(!nxt||boundary(nxt)||sourceReaderListMarkerLike(nxt))continue;
        const curIsList=sourceReaderListMarkerLike(cur);
        const shouldMerge=curIsList ? (!sourceReaderEndsParagraph(cur) || sourceReaderShouldMergeContinuation(cur,nxt,{allowUppercaseAcronym:true}))
          : (!sourceReaderEndsParagraph(cur) || sourceReaderShouldMergeContinuation(cur,nxt,{allowUppercaseAcronym:true}));
        if(!shouldMerge)continue;
        pre.textContent=String(pre.textContent||'').trimEnd()+' '+String(next.textContent||'').trim();
        next.remove(); changed=true; break;
      }
    }
    return root;
  }

  function sourceReaderRepairNativeTables(root) {
    if (!root || !root.querySelectorAll) return root;
    const rowsOf=t=>[...t.querySelectorAll('tr')];
    const rowCells=r=>[...r.children].filter(c=>/^(?:TD|TH)$/.test(c.tagName));
    const hasColspan=t=>[...t.querySelectorAll('td[colspan],th[colspan]')].some(c=>Number(c.getAttribute('colspan')||1)>1);
    const compactColumns=(table)=>{
      if(!table||hasColspan(table))return;
      const rows=rowsOf(table); if(!rows.length)return;
      const max=rows.reduce((m,r)=>Math.max(m,rowCells(r).length),0); if(max<2)return;
      const used=Array(max).fill(false);
      rows.forEach(r=>rowCells(r).forEach((c,i)=>{if(sourceReaderText(c.textContent||''))used[i]=true;}));
      if(used.every(Boolean)||used.filter(Boolean).length<2)return;
      rows.forEach(r=>{const cells=rowCells(r); for(let i=cells.length-1;i>=0;i--){if(!used[i])cells[i].remove();}});
    };
    const promoteFirstBodyRow=(table)=>{
      if(!table||table.tHead)return;
      const body=table.tBodies[0]; if(!body||!body.rows.length)return;
      const row=body.rows[0],cells=rowCells(row),nonempty=cells.filter(c=>sourceReaderText(c.textContent||'')).length;
      if(cells.length<2||nonempty<2)return;
      const thead=table.createTHead(),tr=thead.insertRow();
      cells.forEach(c=>{const th=document.createElement('th');th.innerHTML=c.innerHTML;tr.appendChild(th);});
      row.remove();
    };
    // A page break can concatenate the beginning of the next source table into
    // the current HTML table. Split again at a native "Bảng N." row.
    [...root.querySelectorAll('table.mcr-source-native-table')].forEach(table=>{
      const body=table.tBodies[0]; if(!body)return;
      const rows=[...body.rows];
      const splitIndex=rows.findIndex((r,i)=>i>0&&/(?:^|\s)Bảng\s+\d+\s*[.:]/iu.test(sourceReaderText(r.textContent||'')));
      if(splitIndex<0)return;
      const marker=rows[splitIndex],captionText=sourceReaderText(marker.textContent||'');
      const next=document.createElement('table'); next.className=table.className;
      const cap=document.createElement('caption');cap.textContent=captionText;next.appendChild(cap);
      const nb=document.createElement('tbody');next.appendChild(nb);
      rows.slice(splitIndex+1).forEach(r=>nb.appendChild(r));
      marker.remove(); table.insertAdjacentElement('afterend',next);
    });
    [...root.querySelectorAll('table.mcr-source-native-table')].forEach(compactColumns);

    // A continued table on the next PDF page is sometimes serialized as a new
    // table whose THEAD is actually the first continuation row (e.g. 6- /
    // mercaptopurine ... ức / chế tủy). If its compacted width matches the
    // preceding native table and the header does not look like a real header,
    // append it to the preceding table.
    [...root.querySelectorAll('table.mcr-source-native-table')].forEach(table=>{
      const prev=table.previousElementSibling;
      if(!prev||!prev.matches||!prev.matches('table.mcr-source-native-table'))return;
      compactColumns(prev); compactColumns(table);
      const pRows=rowsOf(prev),cRows=rowsOf(table); if(!pRows.length||!cRows.length)return;
      const pCols=Math.max(...pRows.map(r=>rowCells(r).length));
      const cCols=Math.max(...cRows.map(r=>rowCells(r).length));
      if(pCols!==cCols||pCols<2||!table.tHead)return;
      const heads=[...table.tHead.querySelectorAll('th')].map(h=>sourceReaderText(h.textContent||''));
      const headerText=heads.join(' ');
      const realHeader=/(?:Loại|Generic|Sử dụng|Tác dụng|Khuyến cáo|Chỉ định|Mức độ|Bệnh Crohn|Viêm loét|Thể bệnh)/iu.test(headerText);
      if(realHeader)return;
      const target=prev.tBodies[0]||prev.appendChild(document.createElement('tbody'));
      const headRow=table.tHead.rows[0];
      if(headRow){
        const tr=document.createElement('tr');
        [...headRow.cells].forEach(h=>{const td=document.createElement('td');td.innerHTML=h.innerHTML;tr.appendChild(td);});
        target.appendChild(tr);
      }
      [...table.querySelectorAll('tbody tr')].forEach(r=>target.appendChild(r));
      table.remove();
      // Stitch only a clearly hyphenated continuation into the previous row.
      const rs=[...target.rows];
      for(let i=1;i<rs.length;i++){
        const a=rowCells(rs[i-1]),b=rowCells(rs[i]); if(a.length!==b.length||!b.length)continue;
        if(sourceReaderText(b[0].textContent||''))continue;
        const hasHyphen=a.some(c=>/[\-–—]\s*$/.test(sourceReaderText(c.textContent||'')));
        if(!hasHyphen)continue;
        for(let j=0;j<a.length;j++){
          const bt=sourceReaderText(b[j].textContent||''); if(!bt)continue;
          const at=sourceReaderText(a[j].textContent||'');
          a[j].textContent=(/[\-–—]\s*$/.test(at)?at.replace(/\s+$/,''):at+(at?' ':''))+bt;
        }
        rs[i].remove(); break;
      }
    });
    [...root.querySelectorAll('table.mcr-source-native-table')].forEach(t=>{compactColumns(t);promoteFirstBodyRow(t);});
    return root;
  }

  // v3.5.5: PDF text extraction preserves visual line endings inside PRE
  // blocks. Those line endings are not semantic paragraph breaks and can split
  // ordinary clinical sentences in the reader (for example "... Hb và tùy / loại
  // bệnh"). Real fixed-width tables are promoted before this stage; the remaining
  // PRE blocks are therefore prose/list containers. Reflow only high-confidence
  // soft wraps, while preserving headings, bullets, numbered items and table-like
  // aligned rows that may have escaped table promotion.
  function sourceReaderReflowResidualPreVisualLines(root) {
    if (!root || !root.querySelectorAll) return root;
    const tableish=(raw)=>/\S\s{3,}\S/u.test(String(raw||'').replace(/^\s+/,''));
    const explicit=(raw)=>{
      const t=sourceReaderText(raw||'');
      if(!t)return true;
      if(sourceReaderListMarkerLike(t) || sourceReaderAlphabeticSubheading(t) || sourceReaderMajorHeadingKind(t) || sourceReaderNumberedSubheading(t))return true;
      if(/^(?:\d{1,3}|[IVXLCDM]{1,8})[.)]\s+/iu.test(t))return true;
      if(/^(?:LƯU|SƠ|LƯỢC)\s+ĐỒ\b/iu.test(t))return true;
      if(/[:：]$/.test(t) && t.length<=130 && t.split(/\s+/).filter(Boolean).length<=12)return true;
      return false;
    };
    [...root.querySelectorAll('pre.mcr-source-layout-table')].forEach(pre=>{
      const lines=String(pre.textContent||'').replace(/\r/g,'').split('\n');
      const out=[];
      lines.forEach(line=>{
        line=String(line||'').replace(/\s+$/,'');
        const t=sourceReaderText(line);
        if(!t){ if(out.length && out[out.length-1]!=='')out.push(''); return; }
        if(/^\d{2,4}$/.test(t))return;
        if(out.length && out[out.length-1]!==''){
          const prev=out[out.length-1];
          const pt=sourceReaderText(prev);
          const prevIsBullet=sourceReaderListMarkerLike(pt);
          const canMerge=(!explicit(prev) || prevIsBullet) && !explicit(line) && !tableish(prev) && !tableish(line) &&
            (sourceReaderShouldMergeContinuation(pt,t,{allowUppercaseAcronym:true}) ||
             (pt.length>=42 && !sourceReaderEndsParagraph(pt)));
          if(canMerge){ out[out.length-1]=prev.replace(/\s+$/,'')+' '+t; return; }
        }
        out.push(line);
      });
      while(out.length && out[0]==='')out.shift();
      while(out.length && out[out.length-1]==='')out.pop();
      pre.textContent=out.join('\n');
    });
    return root;
  }

  function sourceReaderStitchListContinuations(root) {
    if (!root || !root.querySelectorAll) return root;
    root.querySelectorAll('ul,ol').forEach(list=>{
      let i=0;
      while (i<list.children.length-1) {
        const a=list.children[i], b=list.children[i+1];
        if (!a || !b || a.tagName!=='LI' || b.tagName!=='LI') { i++; continue; }
        const at=sourceReaderText(a.textContent||'');
        const bt=sourceReaderText(b.textContent||'');
        if (at.length>=12 && bt.length<=280 && sourceReaderShouldMergeContinuation(at,bt,{allowUppercaseAcronym:true})) {
          a.innerHTML=(a.innerHTML+' '+b.innerHTML).replace(/\s+/g,' ');
          b.remove();
          continue;
        }
        i++;
      }
    });
    return root;
  }

  function sourceReaderAppendText(target, text) {
    const value=sourceReaderText(text);
    if (!value) return;
    const current=sourceReaderText(target.textContent||'');
    const noSpaceBefore=/^[,.;:!?%\)\]]/.test(value);
    target.appendChild(document.createTextNode((current && !noSpaceBefore ? ' ' : '')+value));
  }

  function sourceReaderStripLeadingBulletText(v) {
    return sourceReaderText(v).replace(SOURCE_READER_LIST_MARKER_RE,'').trim();
  }

  function sourceReaderNormalizeBulletNode(el) {
    // Always render a list-marked source line as a paragraph, even if the DOCX/PDF
    // importer serialized it as H2/H3/H4. This prevents visual subpoints from
    // becoming semantic headings or quick-navigation destinations.
    const p=document.createElement('p');
    p.innerHTML=el.innerHTML||'';
    p.className=((el.getAttribute && el.getAttribute('class')) || '')+' mtp-source-bullet';
    p.className=p.className.trim();
    const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);
    let node=null;
    while ((node=walker.nextNode())) {
      if (!sourceReaderText(node.nodeValue||'')) continue;
      node.nodeValue=(node.nodeValue||'').replace(SOURCE_READER_LIST_MARKER_RE,'');
      break;
    }
    return p;
  }

  function sourceReaderNodeHasMeaningfulContent(el) {
    if (!el) return false;
    const text=sourceReaderStripLeadingBulletText(el.textContent||'');
    if (text) return true;
    return !!el.querySelector('table,ul,ol,img,figure,svg,blockquote,video,audio,iframe');
  }

  function sourceReaderPruneEmptyListArtifacts(root) {
    if (!root || !root.querySelectorAll) return root;
    root.querySelectorAll('li').forEach(li=>{
      if (!sourceReaderNodeHasMeaningfulContent(li)) li.remove();
    });
    root.querySelectorAll('.mtp-source-bullet').forEach(p=>{
      if (!sourceReaderNodeHasMeaningfulContent(p)) p.remove();
    });
    root.querySelectorAll('ul,ol').forEach(list=>{
      if (![...list.children].some(child=>child.tagName==='LI' && sourceReaderNodeHasMeaningfulContent(child))) list.remove();
    });
    return root;
  }

  function sourceReaderUnwrapImportContainers(root) {
    if (!root || !root.querySelectorAll) return root;
    // Corpus packages may wrap the complete source article in a presentation-only
    // container. The reader must normalize the clinical blocks inside that wrapper,
    // otherwise each PDF visual line remains a separate paragraph and embedded
    // numbered headings cannot participate in the semantic quick navigation.
    [...root.querySelectorAll('.mcr-source-pdf,.mcr-source-section')].forEach(wrapper=>{
      const parent=wrapper.parentNode;
      if (!parent) return;
      while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild,wrapper);
      wrapper.remove();
    });
    return root;
  }

  function reflowSourceFidelityBody(html) {
    const holder=document.createElement('div');
    holder.innerHTML=String(html||'');
    sourceReaderUnwrapImportContainers(holder);
    sourceFidelityHydrateSourceMediaUrls(holder);
    sourceReaderCollapseSoftBreaks(holder);
    sourceReaderStitchListContinuations(holder);
    sourceReaderPruneEmptyListArtifacts(holder);
    // If any Roman major heading exists, the source uses the common
    // Roman-major / Arabic-subsection hierarchy. Otherwise Arabic numbered
    // headings are eligible as top-level destinations. This mirrors the
    // existing reader scheme guard and prevents 1./2./3. subsections from
    // becoming peer tabs beneath I./II./III. documents.
    const embeddedHeadingKinds=[...holder.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>sourceReaderMajorHeadingKind(h.textContent||'')).filter(Boolean);
    const embeddedMajorScheme=embeddedHeadingKinds.includes('roman')?'roman':(embeddedHeadingKinds.includes('arabic')?'arabic':'');
    const source=[...holder.childNodes];
    const out=document.createElement('div');
    let lastParagraph=null;

    const appendNewParagraph=(el, kind='prose')=>{
      const p=(kind==='bullet') ? sourceReaderNormalizeBulletNode(el) : el.cloneNode(true);
      out.appendChild(p);
      lastParagraph=p;
      return p;
    };

    source.forEach(node=>{
      if (node.nodeType===Node.TEXT_NODE) {
        const text=sourceReaderText(node.textContent||'');
        if (!text) return;
        if (!lastParagraph) {
          lastParagraph=document.createElement('p');
          out.appendChild(lastParagraph);
        }
        sourceReaderAppendText(lastParagraph,text);
        return;
      }
      if (node.nodeType!==Node.ELEMENT_NODE) return;
      const el=node;
      const tag=el.tagName;
      if (/^H[1-6]$/.test(tag) && sourceReaderListMarkerLike(el.textContent||'')) {
        const text=sourceReaderText(el.textContent||'');
        const bulletText=sourceReaderStripLeadingBulletText(text);
        if (sourceReaderCanMergeBullet(lastParagraph,text)) {
          sourceReaderAppendText(lastParagraph,bulletText);
        } else {
          const p=sourceReaderNormalizeBulletNode(el);
          out.appendChild(p);
          lastParagraph=p;
        }
        return;
      }
      if (/^H[1-6]$/.test(tag)) {
        const headingText=sourceReaderText(el.textContent||'');
        const headingKind=sourceReaderMajorHeadingKind(headingText);
        const alphabeticHeading=sourceReaderAlphabeticSubheading(headingText);
        const numberedHeading=sourceReaderNumberedSubheading(headingText);
        const structuralHeading=!!headingKind || alphabeticHeading || numberedHeading || sourceReaderShortStandaloneHeading(headingText);

        // v2.7: a heading tag is not sufficient evidence of a semantic heading.
        // Legacy PDF conversion may emit a sentence continuation as H3/H4. Fold
        // those fragments back into the preceding block before deciding visual
        // hierarchy. This repairs HIV examples such as "B, C...", "A,B,C)",
        // "lượng:", "đích nhằm:" and lower-case sentence continuations.
        if (lastParagraph && sourceReaderHeadingFragmentContinuation(lastParagraph.textContent||'',headingText)) {
          sourceReaderAppendText(lastParagraph,headingText);
          return;
        }

        const clone=el.cloneNode(true);
        if (!structuralHeading) {
          const p=document.createElement('p');
          p.innerHTML=clone.innerHTML||'';
          out.appendChild(p);
          lastParagraph=p;
          return;
        }
        if (headingKind && (!embeddedMajorScheme || headingKind===embeddedMajorScheme)) clone.classList.add('mtp-source-inline-heading');
        out.appendChild(clone);
        // Alphabetic treatment items are often full sentence-like subpoints whose
        // visual line wraps into the next <p>. Keep only those as the active block.
        // Standalone evidence markers such as H3 "I" must reset the prose cursor
        // so the evidence-table recovery stage can still stitch them correctly.
        lastParagraph=alphabeticHeading?clone:null;
        return;
      }
      if (tag==='TABLE' || tag==='UL' || tag==='OL' || (tag==='DIV' && el.querySelector('table'))) {
        out.appendChild(el.cloneNode(true));
        lastParagraph=null;
        return;
      }
      if (tag!=='P') {
        out.appendChild(el.cloneNode(true));
        lastParagraph=null;
        return;
      }

      const text=sourceReaderText(el.textContent||'');
      if (!text) {
        // v3.5.7: media-only paragraphs are meaningful source content. Older
        // packages may store <p><img ...></p>; never discard them merely because
        // textContent is empty.
        if (sourceReaderNodeHasMeaningfulContent(el)) {
          out.appendChild(el.cloneNode(true));
          lastParagraph=null;
        }
        return;
      }
      const bullet=sourceReaderIsBulletElement(el);

      if (bullet) {
        const bulletText=sourceReaderStripLeadingBulletText(text);
        if (!bulletText && !sourceReaderNodeHasMeaningfulContent(el)) return;
        if (sourceReaderCanMergeBullet(lastParagraph,text)) {
          sourceReaderAppendText(lastParagraph,bulletText);
          return;
        }
        const p=appendNewParagraph(el,'bullet');
        if (!sourceReaderNodeHasMeaningfulContent(p)) { p.remove(); lastParagraph=null; }
        return;
      }

      // v3.5.21: repair PDF-wrapped heading continuations before any heading
      // classifier runs. Short uppercase closing fragments such as `AGONIST)` or
      // `O2)` are continuations when the previous visual line has an unmatched
      // opening delimiter; promoting them first would invent a top-level section.
      const closingDelimiterFragment=/^[^()\[\]]{1,80}[)\]](?:[.,;:]?)$/u.test(text);
      if (lastParagraph && closingDelimiterFragment && sourceReaderHasOpenDelimiter(lastParagraph.textContent||'')) {
        sourceReaderAppendText(lastParagraph,text);
        return;
      }

      // v2.5: alphabetic markers (a./b./c./d. ...) are semantic subsections,
      // not document-level split points. Keep their visual heading treatment but
      // never attach mtp-source-inline-heading, which drives section splitting and
      // QuickNav promotion.
      if (sourceReaderAlphabeticSubheading(text)) {
        const h=document.createElement('h3');
        h.className='mcr-source-numbered-heading mcr-source-alpha-subheading';
        h.textContent=text;
        out.appendChild(h);
        lastParagraph=null;
        return;
      }

      // The PDF often serializes a real major heading as a plain <p>. Promote only
      // compact heading-like lines to an explicit boundary before paragraph reflow.
      if (sourceReaderHeadingLike(text)) {
        const h=document.createElement('h3');
        h.className='mtp-source-inline-heading';
        h.textContent=text;
        out.appendChild(h);
        lastParagraph=null;
        return;
      }

      // A visual PDF line is not a semantic paragraph. Continue the current
      // prose/bullet until an explicit heading, table or list boundary resets it.
      if (lastParagraph && sourceReaderShouldMergeContinuation(lastParagraph.textContent||'',text,{allowUppercaseAcronym:true})) {
        sourceReaderAppendText(lastParagraph,text);
        return;
      }
      appendNewParagraph(el,'prose');
    });
    sourceReaderPruneEmptyListArtifacts(out);
    return out.innerHTML;
  }

  function sourceFidelityPromoteLayoutTables(holder) {
    if(!holder||!holder.querySelectorAll)return holder;

    // v2.4: hospital PDFs frequently serialize real tables as fixed-width PRE
    // fragments, sometimes interrupted by wrapped <p>/<h4> nodes. The old
    // two-column splitter could not preserve 3+ column tables (for example
    // NHIỄM TRÙNG BỆNH VIỆN) and exposed wrapped cell text as broken rows.
    // Detect a semantic header, keep its column anchors, and stitch the
    // adjacent source fragments into one responsive HTML table.
    const rawLines=node=>String(node&&node.textContent||'').split(/\r?\n/).map(x=>x.replace(/\s+$/,'')).filter(x=>x.trim());
    const lineSegments=line=>{
      const raw=String(line||'').replace(/\t/g,'    ').replace(/\u00a0/g,' ');
      const out=[];const re=/\S(?:.*?\S)?(?=\s{2,}|$)/g;let m;
      while((m=re.exec(raw)))out.push({start:m.index,end:m.index+m[0].length,text:m[0].trim()});
      return out;
    };
    const headerTerms=/(?:loại nhiễm trùng|tiêu chuẩn|xét nghiệm|triệu chứng|mức độ|chứng cớ|chứng cứ|vấn đề|đặc điểm|nguyên nhân|dấu hiệu|cần làm|tác nhân|kháng sinh|cân nặng|bilirubin|tuổi thai|lâm sàng|dịch thấm|dịch tiết|nhóm tuổi|hệ số|gfr|liều|thuốc|nhẹ|trung bình|nặng|dọa ngưng thở)/iu;
    const headerSchemaFromLine=(line,{genericMultiColumn=false}={})=>{
      const segs=lineSegments(line);if(segs.length<2||segs.length>8)return null;
      const joined=segs.map(x=>x.text).join(' ');
      const semantic=headerTerms.test(joined);
      // v3.2: many source PDFs encode compact 3+ column tables with terse headers
      // (e.g. DMP / DỊCH THẤM / DỊCH TIẾT or Nhẹ / Trung bình / Nặng) that do not
      // contain the legacy header vocabulary. Permit a conservative generic path
      // only for 3+ compact cells; 2-column prose remains on the older guarded path.
      const compactMulti=genericMultiColumn&&segs.length>=3&&segs.every(seg=>sourceReaderText(seg.text).length<=64);
      if(!semantic&&!compactMulti)return null;
      return {anchors:segs.map(x=>x.start),headers:segs.map(x=>sourceReaderText(x.text)),generic:!semantic};
    };
    const mapLine=(line,anchors)=>{
      const cells=Array(anchors.length).fill('');
      const segs=lineSegments(line);
      if(!segs.length){const text=sourceReaderText(line);if(text)cells[0]=text;return cells;}
      segs.forEach(seg=>{
        let idx=0,dist=Infinity;
        anchors.forEach((a,i)=>{const d=Math.abs(seg.start-a);if(d<dist){dist=d;idx=i;}});
        cells[idx]+=(cells[idx]?' ':'')+sourceReaderText(seg.text);
      });
      return cells;
    };
    const normalizeCellText=v=>sourceReaderText(v).replace(/\s+([,.;:)])/g,'$1').replace(/([(])\s+/g,'$1');
    const appendCell=(row,idx,text)=>{
      text=normalizeCellText(text);if(!text||!row||!row.cells[idx])return;
      const cell=row.cells[idx];const prev=cell.textContent.trim();
      const spacer=prev&&text?' ':'';cell.textContent=prev+spacer+text;
    };
    const startsLower=v=>{const t=sourceReaderText(v);const c=[...t].find(ch=>ch.toLowerCase()!==ch.toUpperCase());return !!c&&c===c.toLowerCase();};
    const appendMappedRow=(tbody,headers,cells,state)=>{
      if(!cells.some(Boolean))return state.current;
      const first=sourceReaderText(cells[0]||'');
      const continuation=!!state.current && (!first || startsLower(first));
      if(continuation){cells.forEach((x,i)=>appendCell(state.current,i,x));return state.current;}
      const tr=document.createElement('tr');
      headers.forEach((header,i)=>{const td=document.createElement('td');td.dataset.label=header||'';td.textContent=normalizeCellText(cells[i]||'');tr.appendChild(td);});
      tbody.appendChild(tr);state.current=tr;return tr;
    };
    const evidenceTable=headers=>headers.length===2&&/(?:chung co|chung cu|muc do)/.test(readerHeadingKey((headers[1]||'')+' '+(headers[0]||'')));
    const evidenceContinuation=text=>/(?:cochrane|cdc|nelson|hospital|epidemiology|infection|control|who|aap|ebm|guideline|19\d{2}|20\d{2}|^[IVX]+$)/iu.test(sourceReaderText(text));
    const defaultContinuationColumn=(headers,text='')=>{
      if(headers.length>=3)return 1;
      if(evidenceTable(headers)&&evidenceContinuation(text))return 1;
      return 0;
    };
    const shortFragmentText=node=>{
      const text=sourceReaderText(node&&node.textContent||'');
      if(!text||text.length>110)return '';
      if(sourceReaderListMarkerLike(text)||startsLower(text)||/^\d+(?:[.,]\d+)?\s*(?:cfu|mg|ml|g|kg|cm|mm|meq|mmol|%|đơn vị|don vi)\b/iu.test(text))return text;
      return '';
    };
    // v3.5.6: a real fixed-width table can begin in the middle of one PRE
    // after ordinary narrative prose (e.g. the 4-column THALASSEMIA phenotype
    // table or procedure preparation tables). Earlier logic only inspected the
    // first PRE line, so these embedded tables fell through as plain text.
    // Split only high-confidence table runs into their own PRE; the existing
    // structured promoter then converts that isolated run to semantic HTML.
    const embeddedHeaderKey=(schema)=>schema&&schema.headers?schema.headers.map(x=>readerHeadingKey(x)).join('|'):'';
    const splitEmbeddedLayoutTables=()=>{
      let changed=true,guard=0;
      while(changed && guard++<24){
        changed=false;
        const pres=[...holder.querySelectorAll('pre.mcr-source-layout-table')];
        for(const pre of pres){
          if(!pre.parentNode || pre.dataset.mcrEmbeddedTableSplit==='1')continue;
          const lines=String(pre.textContent||'').replace(/\r/g,'').split('\n').map(x=>x.replace(/\s+$/,''));
          if(lines.length<4)continue;
          let found=null;
          for(let i=1;i<lines.length-2;i++){
            const schema=headerSchemaFromLine(lines[i],{genericMultiColumn:true});
            if(!schema)continue;
            const evidence=lines.slice(i+1,Math.min(lines.length,i+9)).filter(line=>mapLine(line,schema.anchors).filter(Boolean).length>=2).length;
            if(evidence<2)continue;
            let end=i+1,seen=0,blank=0;
            const headerKey=embeddedHeaderKey(schema);
            for(;end<lines.length;end++){
              const raw=lines[end], text=sourceReaderText(raw);
              if(!text){blank++; if(seen>=2&&blank>1)break; continue;}
              blank=0;
              const duplicate=headerSchemaFromLine(raw,{genericMultiColumn:true});
              if(duplicate && duplicate.headers.length===schema.headers.length && embeddedHeaderKey(duplicate)===headerKey){continue;}
              const cells=mapLine(raw,schema.anchors),occupied=cells.filter(Boolean).length;
              const segs=lineSegments(raw),start=segs.length?segs[0].start:0;
              const explicitBoundary=sourceReaderMajorHeadingKind(text)||sourceReaderAlphabeticSubheading(text)||sourceReaderNumberedSubheading(text)||sourceReaderHeadingLike(text);
              if(occupied>=2){seen++;continue;}
              if(seen>=2 && explicitBoundary && start<=schema.anchors[0]+3)break;
              // Wrapped cell lines are commonly indented beneath their column.
              // Keep them, but stop at a new left-aligned narrative sentence once
              // the table already has enough row evidence.
              if(occupied===1){
                const indented=start>schema.anchors[0]+2;
                const continuation=indented||startsLower(text)||/^\(?[+\-]?\d+(?:[.,]\d+)?%?\)?$/u.test(text);
                if(seen>=2 && !continuation && start<=schema.anchors[0]+3)break;
                continue;
              }
              if(seen>=2)break;
            }
            if(seen>=2 && end>i+2){found={start:i,end,schema};break;}
          }
          if(!found)continue;
          const before=lines.slice(0,found.start).join('\n').trimEnd();
          const headerKey=embeddedHeaderKey(found.schema);
          const tableLines=lines.slice(found.start,found.end).filter((line,idx)=>{
            if(idx===0)return true;
            const dup=headerSchemaFromLine(line,{genericMultiColumn:true});
            return !(dup && dup.headers.length===found.schema.headers.length && embeddedHeaderKey(dup)===headerKey);
          });
          const after=lines.slice(found.end).join('\n').trimStart();
          const frag=document.createDocumentFragment();
          if(before){const b=pre.cloneNode(false);b.textContent=before;frag.appendChild(b);}
          const t=pre.cloneNode(false);t.textContent=tableLines.join('\n');t.dataset.mcrEmbeddedTableSplit='1';frag.appendChild(t);
          if(after){const a=pre.cloneNode(false);a.textContent=after;frag.appendChild(a);}
          pre.replaceWith(frag);changed=true;break;
        }
      }
    };
    splitEmbeddedLayoutTables();

    const promoteStructured=(pre)=>{
      if(!pre||pre.dataset.mcrLayoutConsumed==='1')return false;
      const lines=rawLines(pre);if(!lines.length)return false;
      const prev=pre.previousElementSibling;
      const prevLine=prev&&/^H[1-6]$/.test(prev.tagName)?String(prev.textContent||''):'';
      let schema=headerSchemaFromLine(lines[0],{genericMultiColumn:true});let skipFirst=false;let removePrev=false;
      if(schema)skipFirst=true;
      if(!schema&&prevLine){schema=headerSchemaFromLine(prevLine,{genericMultiColumn:true});if(schema)removePrev=true;}
      if(!schema)return false;
      if(schema.generic){
        // Require evidence that at least two following source lines actually occupy
        // multiple inferred columns. This prevents a spaced prose line from being
        // promoted merely because it happened to contain three visual fragments.
        const evidence=lines.slice(skipFirst?1:0,Math.min(lines.length,7)).filter(line=>{
          const mapped=mapLine(line,schema.anchors);return mapped.filter(Boolean).length>=2;
        }).length;
        if(evidence<2)return false;
      }

      const headers=schema.headers,anchors=schema.anchors;
      const table=document.createElement('table');table.className='mtp-clinical-table mtp-source-fidelity-table mtp-source-layout-promoted mtp-source-layout-structured';
      table.dataset.layoutColumns=String(headers.length);
      const thead=document.createElement('thead'),hr=document.createElement('tr');
      headers.forEach(x=>{const th=document.createElement('th');th.textContent=x||' ';hr.appendChild(th);});thead.appendChild(hr);table.appendChild(thead);
      const tbody=document.createElement('tbody');table.appendChild(tbody);
      const state={current:null};
      lines.slice(skipFirst?1:0).forEach(line=>appendMappedRow(tbody,headers,mapLine(line,anchors),state));

      const consumed=[];let node=pre.nextElementSibling;let stitchedEvidenceFragments=0;
      while(node){
        if(node.matches&&node.matches('h2'))break;
        if(node.matches&&node.matches('h3')){
          const rawText=sourceReaderText(node.textContent||'');
          // v2.6: PDF extraction can promote an evidence-grade marker such as
          // "I" to H3 even though it is the second cell of the current table row.
          // Keep genuine major headings as boundaries, but stitch compact evidence
          // markers back into column 2 of evidence tables.
          if(state.current&&evidenceTable(headers)&&rawText.length<=48&&evidenceContinuation(rawText)){
            appendCell(state.current,1,rawText);consumed.push(node);stitchedEvidenceFragments++;node=node.nextElementSibling;continue;
          }
          break;
        }
        if(node.matches&&node.matches('pre.mcr-source-layout-table')){
          rawLines(node).forEach(line=>{
            const duplicate=headerSchemaFromLine(line);
            if(duplicate&&duplicate.headers.length===headers.length)return;
            appendMappedRow(tbody,headers,mapLine(line,anchors),state);
          });
          consumed.push(node);node=node.nextElementSibling;continue;
        }
        if(node.matches&&node.matches('h4,h5,h6')){
          const raw=String(node.textContent||'');
          const segs=lineSegments(raw);
          if(segs.length>=2){appendMappedRow(tbody,headers,mapLine(raw,anchors),state);consumed.push(node);node=node.nextElementSibling;continue;}
          const fragment=shortFragmentText(node);
          if(fragment&&state.current){appendCell(state.current,defaultContinuationColumn(headers,fragment),fragment);consumed.push(node);node=node.nextElementSibling;continue;}
          break;
        }
        if(node.matches&&node.matches('p')){
          const rawText=sourceReaderText(node.textContent||'');
          const fragment=shortFragmentText(node) || (state.current&&evidenceTable(headers)&&rawText.length<=110&&evidenceContinuation(rawText)?rawText:'');
          if(fragment&&state.current){appendCell(state.current,defaultContinuationColumn(headers,fragment),fragment);consumed.push(node);stitchedEvidenceFragments++;node=node.nextElementSibling;continue;}
          // v2.6: evidence tables in legacy PDFs frequently continue as ordinary
          // paragraphs after the fixed-width PRE. A non-evidence paragraph starts
          // the next logical row; subsequent lowercase fragments continue column 1,
          // while "I / Cochrane / Clinical Evidence / year" fragments continue
          // column 2. Bound the stitch window to avoid consuming unrelated prose.
          if(state.current&&evidenceTable(headers)&&rawText&&rawText.length<=220&&stitchedEvidenceFragments<24&&!sourceReaderMajorHeadingKind(rawText)&&!sourceReaderAlphabeticSubheading(rawText)){
            appendMappedRow(tbody,headers,[rawText,''],state);consumed.push(node);stitchedEvidenceFragments++;node=node.nextElementSibling;continue;
          }
          break;
        }
        break;
      }
      if(!tbody.rows.length)return false;
      if(removePrev&&prev)prev.remove();
      consumed.forEach(x=>{x.dataset.mcrLayoutConsumed='1';x.remove();});
      pre.dataset.mcrLayoutConsumed='1';pre.replaceWith(table);
      return true;
    };

    const splitLine=(line,boundary)=>{
      const raw=String(line||'').replace(/\t/g,'    ').replace(/\u00a0/g,' ');
      if(boundary&&raw.length>boundary){return [raw.slice(0,boundary).trim(),raw.slice(boundary).trim()];}
      const m=raw.match(/^\s*(.*?)\s{2,}(.+?)\s*$/);return m?[m[1].trim(),m[2].trim()]:[raw.trim(),''];
    };
    const inferBoundary=(lines)=>{
      for(const line of lines){const m=String(line).match(/\S(\s{3,})\S/);if(m)return m.index+1+m[1].length;}
      return 0;
    };
    [...holder.querySelectorAll('pre.mcr-source-layout-table')].forEach(pre=>{
      if(pre.dataset.mcrLayoutConsumed==='1'||!pre.parentNode)return;
      if(promoteStructured(pre))return;
      const lines=rawLines(pre);
      if(!lines.length)return;
      const boundary=inferBoundary(lines);
      const splitRows=lines.map(line=>splitLine(line,boundary));
      const usable=splitRows.filter(r=>r[0]&&r[1]).length;
      const prev=pre.previousElementSibling;
      const prevRaw=prev&&/^H[1-6]$/.test(prev.tagName)?String(prev.textContent||''):'';
      const prevBoundary=inferBoundary([prevRaw]);
      const prevCols=prevBoundary?splitLine(prevRaw,prevBoundary):['',''];
      const headerLike=!!(prevCols[0]&&prevCols[1]) || (splitRows.length>1 && splitRows[0][0]&&splitRows[0][1] && headerTerms.test(splitRows[0].join(' ')));
      if(usable<2 && !headerLike){
        const bridge=pre.previousElementSibling;
        const priorTable=bridge && bridge.matches('p') ? bridge.previousElementSibling : bridge;
        if(priorTable && priorTable.matches('table.mtp-source-layout-promoted') && splitRows.length){
          const tbody=priorTable.tBodies[0]||priorTable.appendChild(document.createElement('tbody'));
          splitRows.forEach(([left,right])=>{
            if(!left&&!right)return;const tr=document.createElement('tr');
            const headers=[...priorTable.querySelectorAll('thead th')].map(x=>x.textContent||'');
            [left,right].forEach((x,i)=>{const td=document.createElement('td');td.textContent=x||'';td.dataset.label=headers[i]||'';tr.appendChild(td);});tbody.appendChild(tr);
          });
          if(bridge&&bridge.matches('p')&&bridge.textContent.trim()){
            const rows=[...tbody.rows];const target=rows[Math.max(0,rows.length-splitRows.length-1)];
            if(target&&target.cells[1])target.cells[1].textContent+=' '+bridge.textContent.trim();bridge.remove();
          }
          const after=pre.nextElementSibling;
          if(after&&after.matches('p')&&after.textContent.trim()){
            const last=tbody.rows[tbody.rows.length-1];const left=(last&&last.cells[0]?last.cells[0].textContent:'').trim();
            const idx=/\b(?:hoặc|và|hay)\s*$/iu.test(left)?0:1;if(last&&last.cells[idx])last.cells[idx].textContent+=' '+after.textContent.trim();after.remove();
          }
          pre.remove();return;
        }
        return;
      }
      const table=document.createElement('table');table.className='mtp-clinical-table mtp-source-fidelity-table mtp-source-layout-promoted';
      const thead=document.createElement('thead'),hr=document.createElement('tr');
      let rows=splitRows,headers=prevCols;
      if(!headers[0]||!headers[1]){headers=splitRows[0];rows=splitRows.slice(1);}
      headers.forEach(x=>{const th=document.createElement('th');th.textContent=x||' ';hr.appendChild(th);});thead.appendChild(hr);table.appendChild(thead);
      const tbody=document.createElement('tbody');let current=null;
      rows.forEach(([left,right])=>{
        if(!left&&!right)return;
        const continuation=current && ((!right)||(/^\p{Ll}/u.test(left)));
        if(continuation){if(left)current.children[0].textContent+=(current.children[0].textContent?' ':'')+left;if(right)current.children[1].textContent+=(current.children[1].textContent?' ':'')+right;return;}
        const tr=document.createElement('tr');[left,right].forEach((x,i)=>{const td=document.createElement('td');td.textContent=x||'';td.dataset.label=headers[i]||'';tr.appendChild(td);});tbody.appendChild(tr);current=tr;
      });
      table.appendChild(tbody);
      if(prevCols[0]&&prevCols[1])prev.remove();
      const next=pre.nextElementSibling;
      pre.replaceWith(table);
      if(next&&next.matches('p')&&next.textContent.trim()){
        const last=tbody.rows[tbody.rows.length-1];
        if(last){const left=(last.cells[0]?last.cells[0].textContent:'').trim();const idx=/\b(?:hoặc|và|hay)\s*$/iu.test(left)?0:1;if(last.cells[idx])last.cells[idx].textContent+=' '+next.textContent.trim();next.remove();}
      }
    });
    return holder;
  }


  function sourceFidelityHydrateSourceMediaUrls(root) {
    if (!root || !root.querySelectorAll) return root;
    // v3.3 backward compatibility: v2.0.8.3-v3.2 importers resolved a
    // standalone {{MCR_MEDIA:*}} token to the attachment URL string itself.
    // Existing database rows therefore contain <p>https://.../mcr-source-<sha>.png</p>.
    // Convert only this tightly-scoped MEDIPHARM source-media filename pattern
    // into a responsive figure; ordinary clinical/reference URLs remain text/links.
    const mediaUrlRe=/(?:^|\/)mcr-source-[a-f0-9]{64}\.(?:png|jpe?g|gif|webp)(?:[?#][^\s<>]*)?$/i;
    [...root.querySelectorAll('p')].forEach(p=>{
      if (p.querySelector('img,figure,svg,video,audio')) return;
      const raw=String(p.textContent||'').trim();
      if (!raw || !mediaUrlRe.test(raw) || !/^(?:https?:)?\/\//i.test(raw)) return;
      let parsed;
      try { parsed=new URL(raw,location.origin); } catch(e) { return; }
      if (!mediaUrlRe.test(parsed.pathname+(parsed.search||'')+(parsed.hash||''))) return;
      const figure=document.createElement('figure');
      figure.className='mcr-source-figure mcr-source-media';
      const img=document.createElement('img');
      img.src=parsed.href;
      img.alt='';
      img.loading='lazy';
      img.decoding='async';
      figure.appendChild(img);
      p.replaceWith(figure);
    });
    return root;
  }

  function sourceFidelityNormalizeTables(html) {
    const holder=document.createElement('div');
    holder.innerHTML=cleanReaderAnnotationHtml(String(html||''));
    sourceFidelityHydrateSourceMediaUrls(holder);
    sourceReaderRepairPdfUnicodeArtifacts(holder);
    sourceReaderPruneEmptyListArtifacts(holder);
    sourceReaderRepairNativeTables(holder);
    sourceFidelityPromoteLayoutTables(holder);
    sourceReaderReflowResidualPreVisualLines(holder);
    sourceReaderReflowAdjacentPreVisualLines(holder);
    sourceReaderRepairNativeTables(holder);
    holder.querySelectorAll('table').forEach(table=>{
      table.classList.add('mtp-clinical-table','mtp-source-fidelity-table');
      const rows=[...table.querySelectorAll('tr')];
      const columnCount=rows.reduce((max,row)=>{
        const count=[...row.children].reduce((n,cell)=>n+Math.max(1,Number(cell.getAttribute('colspan')||1)),0);
        return Math.max(max,count);
      },1);
      table.dataset.sourceColumns=String(columnCount);
      table.style.setProperty('--mtp-source-table-cols',String(columnCount));
      const headerCells=[...table.querySelectorAll('thead th')].map(th=>sourceReaderText(th.textContent||''));
      if(headerCells.length){
        [...table.querySelectorAll('tbody tr')].forEach(row=>{
          [...row.children].forEach((cell,i)=>{if(cell.tagName==='TD'&&!cell.dataset.label)cell.dataset.label=headerCells[i]||'';});
        });
      }
      if (table.parentElement && table.parentElement.classList.contains('mtp-source-table-scroll')) return;
      const wrap=document.createElement('div');
      wrap.className='mtp-source-table-scroll';
      table.parentNode.insertBefore(wrap,table);
      wrap.appendChild(table);
    });
    sourceReaderPruneEmptyListArtifacts(holder);
    return holder.innerHTML;
  }

  function sourceFidelityMeaningfulContent(html) {
    const holder=document.createElement('div');
    holder.innerHTML=String(html||'');
    sourceReaderPruneEmptyListArtifacts(holder);
    if (holder.querySelector('table,ul,ol,img,figure,svg,blockquote')) return true;
    const text=sourceReaderStripLeadingBulletText(holder.textContent||'');
    return text.length>0;
  }

  function sourceFidelityRawContentStats(sfSections) {
    let meaningful=0, tables=0;
    (sfSections||[]).forEach(section=>{
      const holder=document.createElement('div');
      holder.innerHTML=String(section.content_html||'');
      tables += holder.querySelectorAll('table').length;
      if (sourceReaderText(holder.textContent||'') || holder.querySelector('table,ul,ol,img,figure,svg,blockquote')) meaningful++;
    });
    return {meaningful,tables};
  }

  function sourceFidelityLosslessFallback(sfSections) {
    const authors=[];
    const sections=[];
    (sfSections||[]).slice().sort((a,b)=>Number(a.sort_order||100)-Number(b.sort_order||100)).forEach((section,index)=>{
      const item=cleanSourceFidelitySection(section);
      if (item.kind==='author') { authors.push(...item.lines); return; }
      const html=sourceFidelityNormalizeTables(item.html||'');
      const empty=!sourceFidelityMeaningfulContent(html);
      sections.push({...item,html,display:empty?'divider':'card',losslessFallback:true,sourceIndex:index});
    });
    return {authors:[...new Set(authors.map(x=>sourceReaderText(x)).filter(Boolean))],sections};
  }

  function sourceReaderSplitMixedTitle(rawTitle) {
    const raw=sourceReaderText(rawTitle||'');
    if (!raw || sourceReaderListMarkerLike(raw)) return null;
    const m=raw.match(/^(.{2,64}?[.!?])\s+(.+)$/);
    if (!m) return null;
    const head=sourceReaderText(m[1]).replace(/[.!?]+$/,'').trim();
    const rest=sourceReaderText(m[2]);
    const words=head.split(/\s+/).filter(Boolean);
    if (!head || !rest || words.length>7 || head.length>48) return null;
    if (!sourceReaderHeadingLike(head) && !SOURCE_READER_CANONICAL_HEADINGS.has(readerHeadingKey(head))) return null;
    return {head,rest};
  }

  function splitSourceFidelityInlineHeadings(item) {
    if (!item || item.kind!=='section') return [item];
    const holder=document.createElement('div');
    holder.innerHTML=item.html||'';
    const children=[...holder.childNodes];
    if (!children.some(node=>node.nodeType===Node.ELEMENT_NODE && node.classList && node.classList.contains('mtp-source-inline-heading'))) return [item];

    const out=[];
    let title=item.title;
    let rawTitle=item.rawTitle;
    let box=document.createElement('div');
    const flush=()=>{
      const normalized=sourceFidelityNormalizeTables(box.innerHTML);
      out.push({...item,title,rawTitle,html:normalized,empty:!sourceFidelityMeaningfulContent(normalized)});
      box=document.createElement('div');
    };

    children.forEach(node=>{
      if (node.nodeType===Node.ELEMENT_NODE && node.classList && node.classList.contains('mtp-source-inline-heading')) {
        flush();
        title=sourceReaderText(node.textContent||'') || 'Mục';
        rawTitle=title;
        return;
      }
      box.appendChild(node.cloneNode(true));
    });
    flush();
    return out.filter(Boolean);
  }

  function cleanSourceFidelitySection(section) {
    const rawTitle=sourceReaderText(stripHtml(section.title||''));
    const titleKey=readerHeadingKey(rawTitle);
    const authorTitles=new Set(['tac gia chuong','ten nguyen ban va tac gia','tac gia']);
    const isSyntheticSourceTitle=(key)=>{
      if (key==='noi dung' || key==='source fidelity' || key==='source fidelity content') return true;
      // v2.0.8.23: PDF-derived hospital bundles used this provenance label as
      // a section title. It is not clinical content and must never become a
      // reader card or quick-navigation destination.
      if (/^noi dung phac do nguon(?:\s+.+)?$/.test(key)) return true;
      // v2.0.8.16: imported DOCX batches may append the protocol name to the
      // synthetic source label (e.g. "Nội dung nguyên bản – GÃY XƯƠNG MŨI").
      // readerHeadingKey() already normalizes case, accents and dash variants,
      // so an anchored prefix rule safely covers these UI-only labels.
      return /^noi dung nguyen ban(?:\s+.+)?$/.test(key);
    };
    const holder=document.createElement('div');
    holder.innerHTML=reflowSourceFidelityBody(section.content_html||'');

    // v2.0.8.9: strip import/audit annotations that may have been persisted
    // inside source-article HTML. Clinical prose, tables, figures and native
    // bibliography entries are left untouched.
    [...holder.querySelectorAll('p,li,small,em,strong,div')].forEach(node=>{
      const text=sourceReaderText(node.textContent||'');
      if (text && text.length<=520 && INTERNAL_READER_RE.test(text)) node.remove();
    });

    if (authorTitles.has(titleKey)) {
      return {kind:'author',lines:sourceFidelityBlockTexts(holder.innerHTML)};
    }

    let visibleTitle=rawTitle;
    const mixedTitle=sourceReaderSplitMixedTitle(rawTitle);
    if (mixedTitle) {
      visibleTitle=mixedTitle.head;
      const p=document.createElement('p');
      p.textContent=mixedTitle.rest;
      holder.insertBefore(p,holder.firstChild);
    }
    let first=holder.firstElementChild;
    const isHeading=(el)=>!!el && /^H[1-6]$/.test(el.tagName);
    if (isSyntheticSourceTitle(titleKey)) {
      const firstText=first ? sourceReaderText(first.textContent||'') : '';
      if (first && (isHeading(first) || (first.tagName==='P' && sourceReaderHeadingLike(firstText))) && firstText) {
        visibleTitle=firstText;
        first.remove();
      } else {
        visibleTitle='Tổng quan';
      }
    }

    // Source extraction/runtime normalization may store the same clinical
    // heading twice with different numbering, e.g. `III. ĐIỀU TRỊ` plus
    // `ĐIỀU TRỊ`. Compare semantic labels so the reader keeps one heading.
    sourceReaderRemoveDuplicateLeadHeading(holder,visibleTitle);

    if (INTERNAL_READER_RE.test(visibleTitle)) visibleTitle='Tổng quan';
    const normalizedHtml=sourceFidelityNormalizeTables(holder.innerHTML);
    return {kind:'section',title:visibleTitle || 'Tổng quan',rawTitle,html:normalizedHtml,empty:!sourceFidelityMeaningfulContent(normalizedHtml),original:section};
  }

  function prepareSourceFidelityForReader(sfSections) {
    const sorted=(sfSections||[]).slice().sort((a,b)=>Number(a.sort_order||100)-Number(b.sort_order||100));
    const authors=[];
    const sections=[];

    // v2.0.8.10: decide the document's top-level numbering scheme before
    // folding section records. This prevents Roman-major documents such as
    // Tăng áp phổi from promoting inner Arabic items (1. Điều trị chung,
    // 2. Điều trị đặc hiệu) to top-level h2 headings.
    const sourceSchemeCounts={arabic:0,roman:0};
    sorted.forEach(sec=>{
      const kind=sourceReaderMajorHeadingKind(sec&&sec.title||'');
      if (kind) sourceSchemeCounts[kind]++;
    });
    const sourceMajorScheme=sourceSchemeCounts.roman>sourceSchemeCounts.arabic?'roman':(sourceSchemeCounts.arabic>0?'arabic':'');

    function appendSectionIntoPrevious(item, titleText, asBullet=false) {
      if (!sections.length) return false;
      const prev=sections[sections.length-1];
      const holder=document.createElement('div');
      holder.innerHTML=prev.html||'';
      let last=[...holder.querySelectorAll('p,li')].pop() || null;
      const raw=sourceReaderText(titleText);
      if (raw) {
        if (asBullet) {
          const bulletText=sourceReaderStripLeadingBulletText(raw);
          const canContinueLast=last && ((last.tagName==='LI' && sourceReaderShouldMergeContinuation(last.textContent||'',raw,{allowUppercaseAcronym:true})) || sourceReaderCanMergeBullet(last,raw));
          if (canContinueLast) {
            sourceReaderAppendText(last,bulletText);
          } else {
            const p=document.createElement('p');
            p.className='mtp-source-bullet';
            p.textContent=bulletText;
            holder.appendChild(p);
            last=p;
          }
        } else if (sourceReaderAlphabeticSubheading(raw)) {
          const h=document.createElement('h3');
          h.className='mcr-source-numbered-heading mcr-source-alpha-subheading';
          h.textContent=raw;
          holder.appendChild(h);
          last=h;
        } else if (sourceReaderMajorNumberedHeading(raw)) {
          // A numbered source heading folded into the preceding article must
          // respect the document-level numbering scheme. Matching headings are
          // top-level h2; a mismatched scheme is retained as a bold subsection
          // rather than incorrectly promoted into quick navigation.
          const headingKind=sourceReaderMajorHeadingKind(raw);
          const isMajor=!sourceMajorScheme || headingKind===sourceMajorScheme;
          const h=document.createElement(isMajor?'h2':'h3');
          h.className=isMajor?'mcr-source-major-heading':'mcr-source-numbered-heading';
          h.textContent=isMajor?sourceReaderDisplayMajorHeading(raw):raw;
          holder.appendChild(h);
          last=h;
        } else if (last && sourceReaderShouldMergeContinuation(last.textContent||'',raw,{allowUppercaseAcronym:true})) {
          // Cross-section PDF fragments are joined only when the syntax strongly
          // indicates continuation; a completed prior sentence remains separate.
          sourceReaderAppendText(last,raw);
        } else {
          const p=document.createElement('p');
          p.textContent=raw;
          holder.appendChild(p);
          last=p;
        }
      }
      const cur=document.createElement('div');
      cur.innerHTML=item.html||'';
      while (cur.firstChild) holder.appendChild(cur.firstChild);
      prev.html=sourceFidelityNormalizeTables(reflowSourceFidelityBody(holder.innerHTML));
      prev.empty=!sourceFidelityMeaningfulContent(prev.html);
      prev.display=prev.empty?'divider':'card';
      return true;
    }

    sorted.forEach(x=>{
      const cleaned=cleanSourceFidelitySection(x);
      if (cleaned.kind==='author') { authors.push(...cleaned.lines); return; }

      // v3.5.21: a compliance checklist is one source-level section. Roman
      // criteria inside the checklist (I. CHẨN ĐOÁN, II. ĐIỀU TRỊ, III. THEO DÕI…)
      // describe rows/groups of the checklist and must never be split into peer
      // protocol sections or QuickNav destinations.
      const cleanedChecklist=cleaned.kind==='section' && sourceChecklistHeading(cleaned.rawTitle||cleaned.title||'');
      const sourceItems=cleanedChecklist ? [{...cleaned,checklistBoundaryLock:true}] : splitSourceFidelityInlineHeadings(cleaned);
      sourceItems.forEach(item=>{
        const raw=sourceReaderText(item.rawTitle||'');

        // v2.0.8.10: the native bibliography and the explicit current-guideline
        // update section are semantic top-level destinations. Never fold them
        // into the preceding article body even when the hospital source ends
        // the heading with ':' or ';'. This is what keeps native references
        // inside the single TÀI LIỆU THAM KHẢO card.
        const dedicatedReference=sourceReferenceHeading(raw);
        const dedicatedUpdate=readerHeadingKey(raw)==='cap nhat huong dan';
        const dedicatedChecklist=sourceChecklistHeading(raw);
        if (dedicatedReference || dedicatedUpdate || dedicatedChecklist) {
          sections.push({...item,title:sourceReaderDisplayMajorHeading(item.title||raw),display:item.empty?'divider':'card',checklistBoundaryLock:dedicatedChecklist||!!item.checklistBoundaryLock});
          return;
        }

        const bullet=sourceReaderListMarkerLike(raw);
        const alphabeticSubheading=sourceReaderAlphabeticSubheading(raw);
        const pseudoHeading=bullet || alphabeticSubheading || sourceReaderSentenceLike(raw) || !sourceReaderHeadingLike(raw);
        if (pseudoHeading && sections.length) {
          // Do not require item.html to be non-empty. PDF extraction frequently
          // stores a visual line as both section title and its only H3. After
          // duplicate-heading cleanup, the body is empty but the title is still
          // real clinical prose and must be folded into the previous section.
          appendSectionIntoPrevious(item,raw,bullet);
          return;
        }

        // A canonical parent heading can legitimately contain no direct body.
        // Keep it as a lightweight divider, never as an empty reader card.
        sections.push({...item,display:item.empty?'divider':'card'});
      });
    });

    sections.forEach(section=>{
      if (section.display!=='divider') {
        section.html=sourceFidelityNormalizeTables(reflowSourceFidelityBody(section.html||''));
        section.empty=!sourceFidelityMeaningfulContent(section.html);
        if (section.empty) section.display='divider';
      }
    });

    const prepared={authors:[...new Set(authors.map(x=>sourceReaderText(x)).filter(Boolean))],sections};
    const rawStats=sourceFidelityRawContentStats(sfSections);
    const renderedMeaningful=sections.filter(x=>x.display!=='divider' && sourceFidelityMeaningfulContent(x.html||'')).length;

    // Hard content-integrity fallback: normalization is never allowed to erase
    // a source-fidelity protocol that contained meaningful source sections.
    if (rawStats.meaningful>0 && renderedMeaningful===0) return sourceFidelityLosslessFallback(sfSections);
    return prepared;
  }

  // v3.1: final section-boundary integrity pass.
  // Some legacy Master ZIPs keep an entire hospital article in one source row,
  // while some PDF conversions retain a major H2/H3 inside an otherwise valid
  // section. QuickNav could identify those headings, but the card wrapper still
  // belonged to the first section, making II/III appear visually inside I.
  // Split embedded top-level headings into sibling reader cards after all source
  // reflow has completed. Newer corpora that already store one row per major
  // section pass through unchanged.
  function sourceReaderEnforceSectionBoundaries(inputSections) {
    const sections=(inputSections||[]).map(x=>({...x}));
    if (!sections.length) return sections;

    const schemeCounts={roman:0,arabic:0};
    sections.forEach(section=>{
      const titleKind=sourceReaderMajorHeadingKind(section&&section.title||'');
      if (titleKind) schemeCounts[titleKind]++;
      const holder=document.createElement('div');holder.innerHTML=section&&section.html||'';
      holder.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h=>{
        const kind=sourceReaderMajorHeadingKind(h.textContent||'');
        if (kind) schemeCounts[kind]++;
      });
    });
    const majorScheme=schemeCounts.roman>0?'roman':(schemeCounts.arabic>0?'arabic':'');
    const out=[];

    const finalize=(base,title,rawTitle,box,displayHint='card')=>{
      const holder=document.createElement('div');holder.innerHTML=box.innerHTML||'';
      sourceReaderRemoveDuplicateLeadHeading(holder,title);
      const html=sourceFidelityNormalizeTables(reflowSourceFidelityBody(holder.innerHTML));
      const meaningful=sourceFidelityMeaningfulContent(html);
      if (!meaningful && displayHint!=='divider') return;
      out.push({...base,title:sourceReaderDisplayMajorHeading(title||''),rawTitle:rawTitle||title,html,empty:!meaningful,display:meaningful?'card':'divider'});
    };

    sections.forEach(section=>{
      if (!section || section.display==='divider' || !sourceFidelityMeaningfulContent(section.html||'')) { out.push(section); return; }

      // v3.5.21: checklist-internal Roman headings are local table criteria, not
      // document-level section boundaries. Preserve the checklist as one card.
      if (section.checklistBoundaryLock || sourceChecklistHeading(section.title||section.rawTitle||'')) {
        const locked=document.createElement('div');locked.innerHTML=section.html||'';
        sourceReaderRemoveDuplicateLeadHeading(locked,section.title||'');
        const normalized=sourceFidelityNormalizeTables(reflowSourceFidelityBody(locked.innerHTML));
        const checklist=document.createElement('div');checklist.innerHTML=normalized;
        sourceReaderPreferChecklistSourceTable(checklist);
        const html=checklist.innerHTML;
        const meaningful=sourceFidelityMeaningfulContent(html);
        out.push({...section,html,empty:!meaningful,display:meaningful?'card':'divider',checklistBoundaryLock:true});
        return;
      }

      const holder=document.createElement('div');holder.innerHTML=section.html||'';
      sourceReaderRemoveDuplicateLeadHeading(holder,section.title||'');
      const children=[...holder.childNodes];
      const isBoundary=node=>{
        if (!node || node.nodeType!==Node.ELEMENT_NODE || !/^H[1-6]$/.test(node.tagName)) return false;
        const kind=sourceReaderMajorHeadingKind(node.textContent||'');
        return !!kind && (!majorScheme || kind===majorScheme);
      };
      if (!children.some(isBoundary)) {
        const cleaned=document.createElement('div');cleaned.innerHTML=holder.innerHTML;
        sourceReaderRemoveDuplicateLeadHeading(cleaned,section.title||'');
        out.push({...section,html:sourceFidelityNormalizeTables(reflowSourceFidelityBody(cleaned.innerHTML))});
        return;
      }

      let title=section.title||'';
      let rawTitle=section.rawTitle||title;
      let box=document.createElement('div');
      children.forEach(node=>{
        if (isBoundary(node)) {
          const label=sourceReaderDisplayMajorHeading(node.textContent||'');
          const same=sourceReaderSemanticHeadingKey(label)===sourceReaderSemanticHeadingKey(title);
          if (same) return;
          if (sourceFidelityMeaningfulContent(box.innerHTML)) finalize(section,title,rawTitle,box,section.display);
          box=document.createElement('div');
          title=label;rawTitle=label;
          return;
        }
        box.appendChild(node.cloneNode(true));
      });
      if (sourceFidelityMeaningfulContent(box.innerHTML)) finalize(section,title,rawTitle,box,section.display);
    });

    return out.length?out:sections;
  }

  function renderSourceFidelityDeskProtocol(p, sfSections) {
    const main=document.getElementById('mtp-main');
    main.classList.add('is-protocol-view','is-desk-protocol','is-source-fidelity-protocol');
    const primarySource=(p.sources||[]).find(x=>Number(x.is_primary)===1) || (p.sources||[])[0];
    const icd=(p.icd||[]).map(icdBadge).join('');
    const current=String(p.currentness_status||'');
    const currentOK=current==='currentness_verified' || current.indexOf('currentness_verified')===0 || current.indexOf('current_best_available')===0;
    const prepared=prepareSourceFidelityForReader(sfSections);
    const sections=sourceReaderEnforceSectionBoundaries(prepared.sections);

    // v2.0.8.9: use the protocol's native bibliography as the single public
    // reference destination. Public guideline citations are appended there as
    // a compact list; internal Word/Drive provenance stays admin-only.
    const referenceAddendum=sourceReferenceList(p.sources||[]);
    let nativeReferenceIndex=sections.findIndex(x=>sourceReferenceHeading(x.title||''));
    let referenceSection=nativeReferenceIndex>=0 ? sections[nativeReferenceIndex] : null;
    if (referenceSection) {
      referenceSection.title=sourceReaderDisplayMajorHeading(referenceSection.title||'Tài liệu tham khảo');
    }
    if (referenceAddendum) {
      if (referenceSection) {
        referenceSection.html=(referenceSection.html||'')+referenceAddendum;
        referenceSection.empty=false;
        referenceSection.display='card';
      } else {
        referenceSection={kind:'section',title:'Tài liệu tham khảo',rawTitle:'Tài liệu tham khảo',html:referenceAddendum,empty:false,display:'card',syntheticPublicReferences:true};
        sections.push(referenceSection);
        nativeReferenceIndex=sections.length-1;
      }
    }
    // v3.5.20: bibliography is final only when the source actually ends there.
    // If a hospital checklist follows it, preserve that source order and keep
    // the checklist as its own card. Older corpora without post-reference
    // checklists retain the established final-bibliography behavior.
    if (referenceSection && nativeReferenceIndex>=0) {
      const hasPostReferenceChecklist=sections.slice(nativeReferenceIndex+1).some(x=>sourceChecklistHeading(x&&x.title||''));
      if (!hasPostReferenceChecklist && nativeReferenceIndex!==sections.length-1) {
        sections.splice(nativeReferenceIndex,1);
        sections.push(referenceSection);
      }
    }

    // v2.0.8.6: build quick navigation from the final semantic article
    // hierarchy, not only from the imported top-level section records.
    // v2.0.8.5 can promote folded level-1 headings (2., 3., 4. ... or
    // Roman equivalents) to h2.mcr-source-major-heading inside a continuous
    // Source Article card. Give those headings deterministic anchors and place
    // them in the same quick-nav order in which they appear in the article.
    const nav=[];
    sections.forEach((x,i)=>{
      const sectionId=`desk-sf-${i}`;
      const sectionLabel=sourceReaderDisplayMajorHeading(String(x.title||'Mục '+(i+1)));
      x.title=sectionLabel;
      nav.push([sectionId,sectionLabel]);
      if (x.display==='divider' || !sourceFidelityMeaningfulContent(x.html||'')) return;

      const holder=document.createElement('div');
      holder.innerHTML=x.html||'';
      stripSourcePrintedPageNumbers(holder);
      const checklistContext=!!x.checklistBoundaryLock || sourceChecklistHeading(x.title||x.rawTitle||'');
      // v2.8 second-line guard: run after all reflow/splitting so a duplicate
      // heading created during normalization cannot survive into the reader.
      sourceReaderRemoveDuplicateLeadHeading(holder,x.title||'');

      // v2.0.8.8: infer the document's top-level numbering scheme from
      // imported section titles. This lets an Arabic-major document promote
      // “4 ĐIỀU TRỊ ...” even when the dot is missing, while a Roman-major
      // document (I., II., III. ...) keeps inner “1. ... / 2. ...” headings as
      // subsections. The scheme guard prevents over-promotion.
      const schemeCounts={arabic:0,roman:0};
      sections.forEach(sec=>{
        const kind=sourceReaderMajorHeadingKind(sec.title||'');
        if (kind) schemeCounts[kind]++;
      });
      const majorScheme=schemeCounts.roman>schemeCounts.arabic?'roman':(schemeCounts.arabic>0?'arabic':'');
      if (!checklistContext) holder.querySelectorAll('h3.mcr-source-numbered-heading,h4.mcr-source-numbered-heading,h5.mcr-source-numbered-heading,h6.mcr-source-numbered-heading').forEach(h=>{
        const label=sourceReaderText(h.textContent||'');
        const kind=sourceReaderMajorHeadingKind(label);
        if (!kind || !majorScheme || kind!==majorScheme) return;
        const major=document.createElement('h2');
        major.className='mcr-source-major-heading';
        major.textContent=sourceReaderDisplayMajorHeading(label);
        h.replaceWith(major);
      });

      // v2.0.8.18: establish bibliography context from the semantic boundary,
      // regardless of whether DOCX serialized it as H1-H6 or an ordinary P.
      // Citation entries after that boundary may themselves carry Heading
      // styles; demote them before quick-nav discovery. The generated public
      // `Tài liệu cập nhật` addendum keeps its own subheading.
      let bibliographyContext=sourceReferenceHeading(x.title||'');
      [...holder.querySelectorAll('h1,h2,h3,h4,h5,h6,p')].forEach(node=>{
        if (node.closest('.mtp-source-reference-addendum')) return;
        const label=sourceReaderDisplayMajorHeading(node.textContent||'');
        if (!label) return;
        if (sourceReferenceHeading(label)) {
          bibliographyContext=true;
          if (!(node.tagName==='H2' && node.classList.contains('mcr-source-major-heading'))) {
            const major=document.createElement('h2');
            major.className='mcr-source-major-heading';
            major.innerHTML=node.innerHTML;
            node.replaceWith(major);
          }
          return;
        }
        if (!bibliographyContext || !/^H[1-6]$/.test(node.tagName)) return;
        const p=document.createElement('p');
        p.className='mtp-source-reference-entry';
        p.innerHTML=node.innerHTML;
        node.replaceWith(p);
      });

      let majorIndex=0;
      if (!checklistContext) holder.querySelectorAll('h2.mcr-source-major-heading').forEach(h=>{
        const label=sourceReaderDisplayMajorHeading(h.textContent||'');
        if (!label) return;
        h.textContent=label;
        majorIndex++;
        const id=`${sectionId}-major-${majorIndex}`;
        h.id=id;
        h.classList.add('mcr-source-quick-target');
        // Avoid a duplicate quick-nav item if a malformed source repeats the
        // same heading both as section title and as the first promoted H2.
        if (sourceReaderSemanticHeadingKey(label)!==sourceReaderSemanticHeadingKey(x.title||'')) nav.push([id,label]);
      });
      x.html=holder.innerHTML;
    });
    const quickNav=nav.map(([id,label])=>`<button type="button" data-action="quick-anchor" data-target="${esc(id)}">${esc(cleanQuickNavLabel(label))}</button>`).join('');
    const sectionHtml=sections.map((x,i)=>{
      if (x.display==='divider' || !sourceFidelityMeaningfulContent(x.html||'')) {
        return `<div class="mtp-source-section-divider" id="desk-sf-${i}"><h2>${esc(x.title||'')}</h2></div>`;
      }
      const tableCount=(()=>{const h=document.createElement('div');h.innerHTML=x.html||'';return h.querySelectorAll('table').length;})();
      return `<section class="mtp-desk-section mtp-source-fidelity-section" id="desk-sf-${i}" data-source-table-count="${tableCount}" data-source-display-index="${i}">
        <div class="mtp-desk-section-head"><h2>${esc(x.title||'')}</h2></div>
        <div class="mtp-source-fidelity-body">${x.html||''}</div>
      </section>`;
    }).join('');
    const authorHtml=prepared.authors.length ? `<div class="mtp-source-attribution">${prepared.authors.map((line,i)=>`<span${i===0?' class="is-primary"':''}>${esc(line)}</span>`).join('')}</div>` : '';

    main.innerHTML=`<div class="mtp-protocol-page mtp-desk-page mtp-source-fidelity-page">
      <div class="mtp-detail-toolbar"><a class="mtp-back-btn" href="${esc(libraryReturnUrl())}" data-back>← Quay lại</a><div class="mtp-detail-trail"><span>${esc(p.group_name_vi)}</span><b>›</b><span>${esc(p.specialty_name_vi)}</span></div></div>
      <header class="mtp-protocol-head mtp-desk-head" data-specialty="${esc(p.specialty_key||'')}">
        <div class="mtp-title-block"><div class="mtp-kicker">${esc(p.specialty_name_vi||'')}</div><h1>${esc(p.title_vi)}</h1><div class="mtp-icd-row">${icd}</div>${authorHtml}</div>
        ${primarySource?`<div class="mtp-primary-source"><span>Nguồn tham khảo</span><strong>${esc(primarySourceDisplay(primarySource))}</strong></div>`:''}
      </header>
      <nav class="mtp-anchor-bar mtp-desk-anchor" aria-label="Điều hướng nhanh"><button class="mtp-anchor-pan is-prev" type="button" data-action="anchor-scroll" data-dir="-1" aria-label="Xem các mục trước" title="Xem các mục trước">‹</button><div class="mtp-anchor-scroll">${quickNav}</div><button class="mtp-anchor-pan is-next" type="button" data-action="anchor-scroll" data-dir="1" aria-label="Xem các mục tiếp theo" title="Xem các mục tiếp theo">›</button></nav>
      ${sectionHtml}
    </div>`;
    activateChecklistSourceTableFallbacks(main);
    refreshStickyLayout();
  }

  // v2.0.8.17: DOCX master bundles produced by the current source-preserving
  // pipeline use `clinical-source-*` for the native hospital article and
  // `guidance-update-*` for a newer-guidance addendum. Older bundles used
  // `sf-*`. Treat both source keys as the same lossless reader contract.
  //
  // Important: the structured CSV tables (diagnostic_criteria,
  // non_drug_treatments, etc.) may intentionally contain duplicated/searchable
  // projections of the source article. They must not force a tabular reader
  // when a native source article exists, otherwise ordinary headings become
  // fake rows with empty columns such as "Ngưỡng", "Diễn giải", "Chỉ định"
  // or "Nâng bậc khi".
  function sourceArticleSectionRole(section, allowLegacySource=false) {
    const key=String(section&&section.section_key||'').trim().toLowerCase();
    const titleKey=readerHeadingKey(section&&section.title||'');
    if (key.indexOf('sf-')===0 || key.indexOf('clinical-source-')===0 || key.indexOf('procedure-source-')===0) return 'source';
    // v3.5.3 compatibility: C08 source-preserving batches used source-001,
    // source-002... while marking the protocol as source_fidelity_*. Treat those
    // rows as native source article sections instead of falling back to the
    // legacy structured Clinical Desk renderer.
    if (allowLegacySource && /^source-[a-z0-9_-]+$/i.test(key)) return 'source';
    if (key.indexOf('guidance-update-')===0 || titleKey==='cap nhat huong dan') return 'update';
    return '';
  }

  // v3.5.4: suppress printed folio numbers that leaked from PDF text
  // extraction. Scope this only to source-fidelity PRE blocks and only to
  // isolated 2-4 digit lines separated by blank layout space; clinical numbers
  // embedded in sentences/tables remain untouched.
  function stripSourcePrintedPageNumbers(holder) {
    if(!holder)return;
    [...holder.querySelectorAll('pre.mcr-source-layout-table')].forEach(pre=>{
      const raw=String(pre.textContent||'').replace(/\r/g,'');
      const cleaned=raw.replace(/(^|\n)\s*\n\s*\d{2,4}\s*\n(?=\s*\n|$)/g,'$1\n');
      if(cleaned!==raw)pre.textContent=cleaned;
    });
  }

  function sourceArticleSectionsForReader(p) {
    const all=(p&&p.sections)||[];
    const allowLegacySource=/^source_fidelity(?:_|$)/i.test(String((p&&p.clinical_depth_status)||''));
    // Preserve the canonical-source gate so a guidance-only payload can never
    // activate the source reader. Legacy source-* is an additional gated alias.
    const hasSource=all.some(x=>sourceArticleSectionRole(x)==='source');
    const hasLegacySource=allowLegacySource && all.some(x=>sourceArticleSectionRole(x,true)==='source');
    if (!hasSource && !hasLegacySource) return [];
    return all.filter(x=>{
      const role=sourceArticleSectionRole(x,allowLegacySource);
      return role==='source' || role==='update';
    });
  }

  function renderDeskProtocol(p) {
    const sourceArticleSections=sourceArticleSectionsForReader(p);
    if (sourceArticleSections.length) { renderSourceFidelityDeskProtocol(p,sourceArticleSections); return; }
    const main=document.getElementById('mtp-main');
    main.classList.add('is-protocol-view','is-desk-protocol');
    const primarySource=(p.sources||[]).find(x=>Number(x.is_primary)===1) || (p.sources||[])[0];
    const icd=(p.icd||[]).map(icdBadge).join('');
    const current=String(p.currentness_status||'');
    const currentOK=current==='currentness_verified';
    const nav=[['desk-overview','Tổng quan'],['desk-diagnosis','Chẩn đoán'],['desk-investigations','Cận lâm sàng'],['desk-severity','Phân tầng'],['desk-treatment','Điều trị'],['desk-monitoring','Theo dõi'],['desk-complications','Biến chứng'],['desk-followup','Dự phòng & tái khám'],['mtp-sources','Nguồn']];
    const quickNav=nav.map(([id,label])=>`<button type="button" data-action="quick-anchor" data-target="${id}">${label}</button>`).join('');
    const red=(p.red_flags||[]).length ? `<div class="mtp-desk-redflags"><h3>Dấu hiệu cảnh báo / cần nâng mức xử trí</h3>${(p.red_flags||[]).map(x=>`<div><strong>!</strong><span>${x.flag_text||''}${x.clinical_action?`<small>${x.clinical_action}</small>`:''}</span></div>`).join('')}</div>` : '';
    const criteria=deskRows(p.diagnostic_criteria||[],[
      {key:'label',label:'Tiêu chí'},{key:'criterion',label:'Phát hiện / tiêu chuẩn',html:true},{key:'threshold',label:'Ngưỡng'},{key:'interpretation',label:'Diễn giải',html:true}
    ]);
    const diffs=deskRows(p.differentials||[],[
      {key:'condition_name',label:'Chẩn đoán phân biệt'},{key:'distinguishing_features',label:'Điểm giúp phân biệt',html:true},{key:'tests_to_distinguish',label:'Thăm dò định hướng',html:true}
    ],'Không có chẩn đoán phân biệt được cấu trúc từ nguồn.');
    const inv=deskRows(p.investigations||[],[
      {key:'name_vi',label:'Cận lâm sàng'},{key:'finding',label:'Phát hiện cần tìm',html:true},{key:'interpretation',label:'Diễn giải',html:true},{key:'thresholds',label:'Ngưỡng / giá trị',html:true},{key:'what_changes',label:'Ảnh hưởng quyết định',html:true}
    ]);
    const sev=deskRows(p.severity||[],[
      {key:'system_name',label:'Hệ thống'},{key:'label',label:'Mức độ'},{key:'criteria',label:'Tiêu chí',html:true},{key:'clinical_action',label:'Hành động lâm sàng',html:true}
    ],'Nguồn không quy định hệ thống phân tầng riêng.');
    const drugs=deskRows(p.drug_regimens||[],[
      {key:'context',label:'Bối cảnh'},{key:'drug_class',label:'Nhóm thuốc'},{key:'drug_name',label:'Thuốc'},{key:'dose',label:'Liều'},{key:'route',label:'Đường'},{key:'frequency',label:'Tần suất'},{key:'duration',label:'Thời gian'},{key:'indication',label:'Chỉ định / ghi chú',html:true}
    ],'Không có phác đồ thuốc được phép hiển thị từ nguồn hiện tại.');
    const nonDrug=deskRows(p.non_drug_treatments||[],[
      {key:'context',label:'Bối cảnh'},{key:'intervention',label:'Can thiệp'},{key:'indication',label:'Chỉ định',html:true},{key:'details',label:'Thực hiện',html:true},{key:'escalation_trigger',label:'Nâng bậc khi',html:true}
    ],'Không có can thiệp không dùng thuốc được cấu trúc từ nguồn.');
    const mon=deskRows(p.monitoring||[],[
      {key:'parameter_name',label:'Theo dõi'},{key:'timing',label:'Thời điểm'},{key:'target_or_response',label:'Đáp ứng mong đợi',html:true},{key:'failure_criteria',label:'Thất bại / xấu đi',html:true},{key:'action_if_failure',label:'Xử trí tiếp',html:true}
    ]);
    const comps=deskRows(p.complications||[],[
      {key:'complication',label:'Biến chứng'},{key:'recognition',label:'Nhận biết',html:true},{key:'management',label:'Xử trí',html:true}
    ]);
    const follow=deskRows(p.prevention_followup||[],[
      {key:'category',label:'Nhóm'},{key:'item_text',label:'Nội dung',html:true},{key:'timing',label:'Thời điểm'}
    ]);
    const overviewSections=(p.sections||[]).filter(x=>String(x.section_key||'').indexOf('overview')===0);
    const narrativeSections=(p.sections||[]).filter(x=>String(x.section_key||'').indexOf('overview')!==0);
    const overview=overviewSections.length ? `<div class="mtp-desk-notes mtp-desk-overview-notes">${overviewSections.map(x=>`<article><h3>${esc(x.title||'Tổng quan')}</h3><div>${x.content_html||''}</div></article>`).join('')}</div>` : `<p class="mtp-desk-empty">Chưa có nội dung Tổng quan được cấu trúc.</p>`;
    const narrative=narrativeSections.length ? `<div class="mtp-desk-notes">${narrativeSections.map(x=>`<article><h3>${esc(x.title||'Ghi chú lâm sàng')}</h3><div>${x.content_html||''}</div></article>`).join('')}</div>`:'';
    const sources=(p.sources||[]).map((x,i)=>sourceCard(x,i+1)).join('');

    main.innerHTML=`<div class="mtp-protocol-page mtp-desk-page">
      <div class="mtp-detail-toolbar"><a class="mtp-back-btn" href="${esc(libraryReturnUrl())}" data-back>← Quay lại</a><div class="mtp-detail-trail"><span>${esc(p.group_name_vi)}</span><b>›</b><span>${esc(p.specialty_name_vi)}</span></div></div>
      <header class="mtp-protocol-head mtp-desk-head" data-specialty="${esc(p.specialty_key||'')}">
        <div class="mtp-title-block"><div class="mtp-kicker">${esc(p.specialty_name_vi||'')}</div><h1>${esc(p.title_vi)}</h1><div class="mtp-icd-row">${icd}</div></div>
        ${primarySource?`<div class="mtp-primary-source"><span>Nguồn tham khảo</span><strong>${esc(primarySourceDisplay(primarySource))}</strong></div>`:''}
      </header>
      <div class="mtp-desk-quick mtp-desk-quick-reader"><div><small>Tóm tắt lâm sàng</small><p>${p.quick_summary||esc(userSummary(p.summary)||'')}</p></div></div>
      ${red}
      <nav class="mtp-anchor-bar mtp-desk-anchor" aria-label="Điều hướng nhanh"><button class="mtp-anchor-pan is-prev" type="button" data-action="anchor-scroll" data-dir="-1" aria-label="Xem các mục trước" title="Xem các mục trước">‹</button><div class="mtp-anchor-scroll">${quickNav}</div><button class="mtp-anchor-pan is-next" type="button" data-action="anchor-scroll" data-dir="1" aria-label="Xem các mục tiếp theo" title="Xem các mục tiếp theo">›</button></nav>
      ${deskSection('desk-overview','Tổng quan',overview,'Khái niệm · Dịch tễ/Gánh nặng · Yếu tố nguy cơ · Bối cảnh lâm sàng')}
      ${deskSection('desk-diagnosis','Chẩn đoán',criteria+'<div class="mtp-desk-subhead">Chẩn đoán phân biệt</div>'+diffs)}
      ${deskSection('desk-investigations','Cận lâm sàng',inv,'Phát hiện cần tìm · diễn giải · ngưỡng · ảnh hưởng quyết định')}
      ${deskSection('desk-severity','Phân tầng / mức độ',sev)}
      ${deskSection('desk-treatment','Điều trị','<div class="mtp-desk-subhead">Điều trị thuốc</div>'+drugs+'<div class="mtp-desk-subhead">Can thiệp / điều trị không dùng thuốc</div>'+nonDrug)}
      ${deskSection('desk-monitoring','Theo dõi và đánh giá đáp ứng',mon)}
      ${deskSection('desk-complications','Biến chứng',comps)}
      ${deskSection('desk-followup','Dự phòng và tái khám',follow)}
      ${narrative}
      <section class="mtp-source-section" id="mtp-sources"><div class="mtp-section-line"><strong>Tài liệu tham khảo</strong><span>Nguồn tài liệu kèm theo phác đồ</span></div><div class="mtp-source-grid">${sources||'<p>Chưa có nguồn được gắn.</p>'}</div></section>
    </div>`;
    refreshStickyLayout();
  }

  function canonicalModuleStream(modules, includeInvestigations=false) {
    const groups=[]; const by=new Map();
    (modules||[]).forEach((m,idx)=>{
      const key=String(m.canonical_component||'other');
      if (key==='sources' || key==='investigations') return;
      if (!by.has(key)) { const g={key,label:m.canonical_label||shortModuleTitle(m),order:Number(m.canonical_order||999),items:[]}; by.set(key,g); groups.push(g); }
      by.get(key).items.push(m);
    });
    if (includeInvestigations) groups.push({key:'investigations',label:'Cận lâm sàng',order:40,items:[],isInvestigation:true});
    groups.sort((a,b)=>a.order-b.order);
    return groups.map(g=>{
      if (g.isInvestigation) return `<section class="mtp-investigation-section mtp-component-section" id="mtp-investigations" data-component="investigations"><div class="mtp-component-band"><strong>Cận lâm sàng</strong></div><div id="mtp-investigation-panel"></div></section>`;
      return `<section class="mtp-component-section" id="mtp-component-${esc(g.key)}" data-component="${esc(g.key)}">
        <div class="mtp-component-band"><strong>${esc(g.label)}</strong></div>
        ${g.items.map(moduleCard).join('')}
      </section>`;
    }).join('');
  }

  function shortModuleTitle(m) {
    const map={overview:'Tổng quan',screening:'Sàng lọc',clinical:'Lâm sàng',diagnosis:'Chẩn đoán',differential:'Chẩn đoán phân biệt',classification:'Phân loại',assessment:'Đánh giá toàn diện',severity:'Phân tầng',risk_stratification:'Nguy cơ tim mạch–thận',treatment_goals:'Mục tiêu điều trị',treatment:'Điều trị',stable_management:'Điều trị ổn định',inpatient:'Điều trị nội trú',hypoglycemia:'Hạ đường huyết',acute_complications:'Biến chứng cấp',chronic_complications:'Biến chứng mạn',glucose_monitoring:'Theo dõi đường huyết',care_levels:'Phân tuyến quản lý',nutrition:'Dinh dưỡng',followup:'Theo dõi',delivery:'Chuyển dạ & sinh',postpartum:'Sau sinh',exacerbation:'Đợt cấp',comorbidities:'Bệnh đồng mắc',rehabilitation:'PHCN & giảm nhẹ',complications:'Biến chứng',disposition:'Nhập viện/Chuyển tuyến',special_populations:'Đối tượng đặc biệt',education_prevention:'Giáo dục & dự phòng',prevention:'Dự phòng',emergency:'Cấp cứu'};
    return map[m.module_key] || m.title || 'Nội dung';
  }

  function toggleModule(button) {
    const card=button.closest('.mtp-module');
    if (!card) return;
    const collapsed=card.classList.toggle('is-collapsed');
    button.setAttribute('aria-expanded', collapsed ? 'false':'true');
    button.title=collapsed ? 'Mở rộng':'Thu gọn';
    syncAllModulesControl();
  }

  function setAllModulesCollapsed(collapsed) {
    root.querySelectorAll('.mtp-module').forEach(card=>{
      card.classList.toggle('is-collapsed',collapsed);
      const btn=card.querySelector('[data-action="toggle-module"]');
      if (btn) {
        btn.setAttribute('aria-expanded',collapsed?'false':'true');
        btn.title=collapsed?'Mở rộng':'Thu gọn';
      }
    });
    syncAllModulesControl();
  }

  function toggleAllModules() {
    const cards=[...root.querySelectorAll('.mtp-module')];
    if (!cards.length) return;
    const allCollapsed=cards.every(card=>card.classList.contains('is-collapsed'));
    setAllModulesCollapsed(!allCollapsed);
  }

  function syncAllModulesControl() {
    const control=root.querySelector('[data-action="toggle-all"]');
    if (!control) return;
    const cards=[...root.querySelectorAll('.mtp-module')];
    const allCollapsed=cards.length>0 && cards.every(card=>card.classList.contains('is-collapsed'));
    const label=control.querySelector('b');
    if (label) label.textContent=allCollapsed?'Mở':'Thu';
    const title=allCollapsed?'Mở rộng tất cả':'Thu gọn tất cả';
    control.title=title;
    control.setAttribute('aria-label',title);
    control.setAttribute('aria-pressed',allCollapsed?'true':'false');
  }


  function scrollToProtocolTarget(id) {
    if (!id) return;
    requestAnimationFrame(()=>{
      const target=document.getElementById(id);
      if (!target) return;
      state.readingLockedTarget=id;
      state.readingLockUntil=Date.now()+720;
      setActiveQuickAnchor(id);
      target.scrollIntoView({behavior:'smooth',block:'start'});
      window.setTimeout(()=>{
        if (state.readingLockedTarget===id) state.readingLockedTarget='';
        updateReadingActive(true);
      },760);
    });
  }

  function setActiveQuickAnchor(id) {
    root.querySelectorAll('.mtp-anchor-scroll [data-target]').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.target===id));
    root.querySelectorAll('#mtp-mobile-nav-panel [data-target]').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.target===id));
  }

  function getStickyOffset() {
    const main=document.getElementById('mtp-main');
    if (!main) return 72;
    return Math.max(44,Math.ceil(parseFloat(getComputedStyle(main).getPropertyValue('--mtp-sticky-stack-height')) || 72));
  }

  function updateStickyMetrics() {
    const main=document.getElementById('mtp-main');
    const page=root.querySelector('.mtp-protocol-page');
    const anchor=root.querySelector('.mtp-anchor-bar');
    if (!main || !page || !anchor) return;
    const anchorHeight=Math.max(0,Math.ceil(anchor.getBoundingClientRect().height));
    main.style.setProperty('--mtp-anchor-sticky-height', `${anchorHeight}px`);
    main.style.setProperty('--mtp-sticky-stack-height', `${anchorHeight}px`);
  }

  function refreshStickyLayout() {
    syncMobileProtocolToolbar();
    if (!state.current) return;
    updateStickyMetrics();
    initProtocolReading();
    syncAllModulesControl();
    syncAnchorScrollControls();
    syncMobileProtocolToolbar();
  }

  function readingTargets() {
    // ScrollSpy must use the same target contract as the visible quick-navigation.
    // Source-Fidelity protocols render `desk-sf-*` sections rather than the legacy
    // `.mtp-component-section` class; the old selector therefore saw only
    // `#mtp-sources` and permanently highlighted “Tài liệu tham khảo”.
    const seen=new Set();
    const targets=[];
    root.querySelectorAll('.mtp-anchor-scroll [data-target]').forEach(btn=>{
      const id=String(btn.dataset.target||'').trim();
      if (!id || seen.has(id)) return;
      const target=document.getElementById(id);
      if (!target || !root.contains(target)) return;
      seen.add(id);
      targets.push(target);
    });
    if (targets.length) return targets;

    // Defensive fallback for renderer variants without a quick-nav bar.
    return [...root.querySelectorAll('.mtp-component-section[id],.mtp-source-fidelity-section[id],.mtp-desk-section[id],.mtp-source-section-divider[id],#mtp-recommendations,#mtp-sources')];
  }

  function updateReadingActive(force=false) {
    const main=document.getElementById('mtp-main');
    if (!main) return;
    const targets=readingTargets();
    if (!targets.length) return;
    if (!force && state.readingLockedTarget && Date.now() < Number(state.readingLockUntil||0)) {
      setActiveQuickAnchor(state.readingLockedTarget);
      return;
    }
    if (Date.now() >= Number(state.readingLockUntil||0)) state.readingLockedTarget='';

    const mainRect=main.getBoundingClientRect();
    const readingLead=Math.min(72,Math.max(24,Math.round(main.clientHeight*0.08)));
    const threshold=mainRect.top + getStickyOffset() + readingLead;
    const nearBottom=(main.scrollTop + main.clientHeight) >= (main.scrollHeight - 12);
    if (nearBottom) {
      setActiveQuickAnchor(targets[targets.length-1].id);
      return;
    }

    let active=targets[0];
    for (const target of targets) {
      const rect=target.getBoundingClientRect();
      if (rect.top <= threshold) active=target;
      else break;
    }
    setActiveQuickAnchor(active.id);
  }

  function initProtocolReading() {
    const main=document.getElementById('mtp-main');
    if (!main) return;
    const targets=readingTargets();
    if (!targets.length) return;

    if (state.readingObserver) { state.readingObserver.disconnect(); state.readingObserver=null; }
    if (state.readingScrollHandler) main.removeEventListener('scroll',state.readingScrollHandler);
    if (state.readingResizeHandler) window.removeEventListener('resize',state.readingResizeHandler);
    if (state.anchorResizeObserver) { state.anchorResizeObserver.disconnect(); state.anchorResizeObserver=null; }

    let ticking=false;
    state.readingScrollHandler=()=>{
      if (ticking) return;
      ticking=true;
      requestAnimationFrame(()=>{ ticking=false; updateReadingActive(false); });
    };
    state.readingResizeHandler=debounce(()=>{ updateStickyMetrics(); updateReadingActive(true); },120);
    main.addEventListener('scroll',state.readingScrollHandler,{passive:true});
    window.addEventListener('resize',state.readingResizeHandler,{passive:true});

    const anchor=root.querySelector('.mtp-anchor-bar');
    if (anchor && 'ResizeObserver' in window) {
      state.anchorResizeObserver=new ResizeObserver(()=>{ updateStickyMetrics(); updateReadingActive(true); });
      state.anchorResizeObserver.observe(anchor);
    }
    setActiveQuickAnchor(targets[0].id);
    requestAnimationFrame(()=>updateReadingActive(true));
  }

  function investigationHeadingLevel(node) {
    if (!node || !node.tagName) return 99;
    const m=String(node.tagName).match(/^H([2-6])$/);
    return m ? Number(m[1]) : 99;
  }

  function cleanInvestigationTitle(title) {
    return String(title||'')
      .replace(/\s+/g,' ')
      .replace(/^\s*(?:(?:\d+(?:\.\d+)+\.?)|(?:\d+[.)])|(?:[IVXLCDM]+[.)]))\s*/iu,'')
      .replace(/^[\-–—•]\s*/u,'')
      .replace(/[.:;]\s*$/u,'')
      .trim();
  }

  function isGenericInvestigationHeading(title) {
    const t=cleanInvestigationTitle(title).toLocaleLowerCase('vi-VN');
    return /^(?:cận\s*lâm\s*sàng|xét\s*nghiệm|chẩn\s*đoán\s*hình\s*ảnh|hình\s*ảnh\s*học|thăm\s*dò(?:\s*chức\s*năng)?)$/.test(t);
  }

  function siblingSegmentHtml(heading) {
    const level=investigationHeadingLevel(heading);
    let html=''; let n=heading.nextSibling;
    while(n){
      if (n.nodeType===1 && /^H[2-6]$/.test(n.tagName) && investigationHeadingLevel(n)<=level) break;
      html+=n.outerHTML || esc(n.textContent||'');
      n=n.nextSibling;
    }
    return html.trim();
  }

  function pushDerivedInvestigation(out,seen,title,content,m) {
    const cleanTitle=cleanInvestigationTitle(title) || 'Cận lâm sàng';
    const plain=stripHtml(content||'').replace(/\s+/g,' ').trim();
    if (!plain && isGenericInvestigationHeading(cleanTitle)) return;
    const key=(cleanTitle+'|'+plain).toLocaleLowerCase('vi-VN');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      name_vi:cleanTitle,name_en:'',category:'core',purpose:content||'',timing:'',
      coverage_status:'unverified',coverage_note:'',source_locator:m.source_locator||'',
      fidelity_status:'source_derived_view',derived:true
    });
  }

  function splitCanonicalInvestigationModule(holder,m,out,seen) {
    const headings=[...holder.querySelectorAll('h2,h3,h4,h5,h6')];
    if (!headings.length) return false;

    // Prefer specific child headings (e.g. 3.2.1 CT, 3.2.2 MRI) and treat
    // generic "Cận lâm sàng" / "Xét nghiệm" headings as containers only.
    const specific=headings.filter(h=>!isGenericInvestigationHeading(h.textContent||''));
    if (specific.length) {
      const cardLevel=Math.min(...specific.map(investigationHeadingLevel));
      specific.filter(h=>investigationHeadingLevel(h)===cardLevel).forEach(h=>pushDerivedInvestigation(out,seen,h.textContent||'',siblingSegmentHtml(h),m));
      return true;
    }

    // No specific child heading: use the generic heading body as one derived
    // record rather than copying the complete module title and body twice.
    const generic=headings.find(h=>isGenericInvestigationHeading(h.textContent||''));
    if (generic) {
      pushDerivedInvestigation(out,seen,generic.textContent||m.title||'Cận lâm sàng',siblingSegmentHtml(generic),m);
      return true;
    }
    return false;
  }

  function effectiveInvestigations(protocol) {
    const direct=Array.isArray(protocol?.investigations)?protocol.investigations:[];
    if (direct.length) return direct;
    const derived=[];
    const seen=new Set();
    const headingRx=/(cận\s*lâm\s*sàng|xét\s*nghiệm|chẩn\s*đoán\s*hình\s*ảnh|hình\s*ảnh\s*học|thăm\s*dò)/i;
    (protocol?.modules||[]).forEach(m=>{
      const moduleKey=String(m.module_key||'');
      const moduleTitle=String(m.title||'');
      const canonicalKey=String(m.canonical_component||'');
      const isCanonicalInvestigation=canonicalKey==='investigations';
      if (!isCanonicalInvestigation && !['diagnosis','assessment','clinical','screening'].includes(moduleKey) && !headingRx.test(moduleTitle)) return;
      const holder=document.createElement('div');
      holder.innerHTML=prepareModuleHtml(m.content_html||'');

      if (isCanonicalInvestigation) {
        if (splitCanonicalInvestigationModule(holder,m,derived,seen)) return;
        const content=holder.innerHTML;
        if (stripHtml(content).trim()) pushDerivedInvestigation(derived,seen,moduleTitle||'Cận lâm sàng',content,m);
        return;
      }

      const headings=[...holder.querySelectorAll('h2,h3,h4,h5,h6')];
      headings.forEach(h=>{
        const title=String(h.textContent||'').replace(/\s+/g,' ').trim();
        if (!headingRx.test(title)) return;
        const parentLevel=investigationHeadingLevel(h);
        const childHeadings=[];
        let n=h.nextElementSibling;
        while(n){
          if (/^H[2-6]$/.test(n.tagName) && investigationHeadingLevel(n)<=parentLevel) break;
          if (/^H[2-6]$/.test(n.tagName) && investigationHeadingLevel(n)>parentLevel) childHeadings.push(n);
          n=n.nextElementSibling;
        }
        const specificChildren=childHeadings.filter(ch=>!isGenericInvestigationHeading(ch.textContent||''));
        if (specificChildren.length) {
          const cardLevel=Math.min(...specificChildren.map(investigationHeadingLevel));
          specificChildren.filter(ch=>investigationHeadingLevel(ch)===cardLevel).forEach(ch=>pushDerivedInvestigation(derived,seen,ch.textContent||'',siblingSegmentHtml(ch),m));
        } else pushDerivedInvestigation(derived,seen,title,siblingSegmentHtml(h),m);
      });
      if (!headings.length && headingRx.test(moduleTitle)) {
        const content=holder.innerHTML;
        if (stripHtml(content).trim()) pushDerivedInvestigation(derived,seen,moduleTitle,content,m);
      }
    });
    return derived;
  }

  function renderInvestigationPanel() {
    const host=document.getElementById('mtp-investigation-panel');
    if (!host || !state.current) return;
    const all=effectiveInvestigations(state.current);
    const labels={all:'Tất cả',core:'Cơ bản',recommended:'Khuyến nghị',advanced:'Chuyên sâu'};
    const count=(key)=>key==='all'?all.length:all.filter(i=>i.category===key).length;
    let filtered=state.investigationFilter==='all'?all:all.filter(i=>i.category===state.investigationFilter);
    const limit=state.investigationExpanded?filtered.length:6;
    const visible=filtered.slice(0,limit);
    const hidden=Math.max(0,filtered.length-visible.length);
    const cards=visible.map(investigationCard).join('');
    const categoryKeys=['core','recommended','advanced'].filter(k=>count(k)>0);
    const showTabs=categoryKeys.length>1;
    const tabKeys=showTabs?['all',...categoryKeys]:[];
    const tabs=tabKeys.map(k=>`<button type="button" class="${state.investigationFilter===k?'is-active':''}" data-action="investigation-filter" data-filter="${k}">${labels[k]} <b>${count(k)}</b></button>`).join('');
    if (!showTabs && state.investigationFilter!=='all') state.investigationFilter='all';
    host.innerHTML=`
      <div class="mtp-investigation-overview"><span class="mtp-icon-circle">⌁</span><span><b>${all.length}</b> chỉ định theo phác đồ</span></div>
      ${showTabs?`<div class="mtp-investigation-tabs" role="tablist">${tabs}</div>`:''}
      <div class="mtp-investigation-list">${cards || '<div class="mtp-investigation-empty">Chưa xác định được cấu phần cận lâm sàng riêng trong dữ liệu hiện tại.</div>'}</div>
      ${hidden?`<button class="mtp-investigation-more" type="button" data-action="toggle-investigations">Xem thêm ${hidden} cận lâm sàng ↓</button>`:(state.investigationExpanded && filtered.length>6?'<button class="mtp-investigation-more" type="button" data-action="toggle-investigations">Thu gọn ↑</button>':'')}
    `;
  }

  function setInvestigationFilter(filter) {
    state.investigationFilter=['all','core','recommended','advanced'].includes(filter)?filter:'all';
    state.investigationExpanded=false;
    renderInvestigationPanel();
  }

  function icdBadge(x) {
    const core=x.icd_core || {};
    const name=core.found ? (core.name_vi || '') : '';
    const cls=core.found ? 'is-valid' : (core.disconnected ? 'is-unverified':'is-invalid');
    const url=core.webapp_url || `${cfg.icdUrl}?q=${encodeURIComponent(x.code)}`;
    const target=cfg.embedded ? '' : ' target="_blank" rel="noopener"';
    return `<a class="mtp-icd-badge ${cls}" href="${esc(url)}"${target} title="${esc(name || 'Mở trong ICD-10')}">
      <span>${esc(x.is_primary ? 'ICD chính' : 'ICD liên quan')}</span><strong>${esc(x.code)}</strong>${name?`<small>${esc(name)}</small>`:''}<b>↗</b>
    </a>`;
  }

  function prepareModuleHtml(raw) {
    const holder=document.createElement('div');
    holder.innerHTML=String(raw || '');
    sourceReaderCollapseSoftBreaks(holder);

    // Hide short pipeline/editorial annotations from the reader while keeping
    // the original data untouched in the database/admin layer.
    [...holder.querySelectorAll('p,li,small,em,strong')].forEach(node=>{
      const text=String(node.textContent||'').replace(/\s+/g,' ').trim();
      if (text && text.length<=420 && INTERNAL_READER_RE.test(text)) node.remove();
    });

    // Bibliography belongs to the dedicated reference/source section, not to a
    // clinical or treatment card. Keep later appendices when a bibliography is
    // local to one appendix.
    const nodes=[...holder.querySelectorAll('p,li,h2,h3,h4,h5,h6')];
    for (const node of nodes) {
      if (!node.isConnected) continue;
      const text=String(node.textContent || '').replace(/\s+/g,' ').trim();
      const upper=text.toLocaleUpperCase('vi-VN');
      const marker='TÀI LIỆU THAM KHẢO';
      if (!upper.includes(marker)) continue;
      const isAppendixLocal=upper.includes('TÀI LIỆU THAM KHẢO CỦA PHỤ LỤC');
      const idx=upper.indexOf(marker);
      const prefix=text.slice(0,idx).trim();
      const parentBeforeRemoval=node.parentElement;
      const nextBeforeRemoval=node.nextSibling;
      let cursor=nextBeforeRemoval;
      if (prefix) node.textContent=prefix; else node.remove();

      // When marker was inside an LI, clean the rest of that list and then the
      // following siblings of the list container. Capture sibling pointers before
      // removing the marker node so cleanup still works when the marker is a heading.
      if (node.tagName==='LI') {
        const list=parentBeforeRemoval;
        cursor=nextBeforeRemoval;
        while(cursor){ const next=cursor.nextSibling; cursor.remove(); cursor=next; }
        cursor=list ? list.nextSibling : null;
      }
      while(cursor){
        const next=cursor.nextSibling;
        if (isAppendixLocal && cursor.nodeType===1 && /^H[2-6]$/.test(cursor.tagName)) {
          const t=String(cursor.textContent||'').replace(/\s+/g,' ').trim().toLocaleUpperCase('vi-VN');
          if (/^PHỤ\s+LỤC\s+\d+/.test(t)) break;
        }
        cursor.remove();
        cursor=next;
      }
      if (!isAppendixLocal) break;
    }

    // Presentation normalization: remove orphan figure captions when the source
    // image itself is not present in the WebApp. The immutable source record is
    // kept in provenance; this only prevents captions such as "Hình 1..." from
    // appearing without the corresponding figure.
    [...holder.querySelectorAll('p,h3,h4,h5,h6,figcaption')].forEach(node=>{
      const text=String(node.textContent||'').replace(/\s+/g,' ').trim();
      if (!/^Hình\s+\d+(?:\s*[.:\-–]|\s+)/iu.test(text) || text.length>260) return;
      const parentHasImage=!!(node.parentElement && node.parentElement.querySelector('img,figure,svg,canvas'));
      const prev=node.previousElementSibling, next=node.nextElementSibling;
      const adjacentHasImage=!!((prev && prev.matches('img,figure,svg,canvas')) || (next && next.matches('img,figure,svg,canvas')) || (prev && prev.querySelector && prev.querySelector('img,figure,svg,canvas')) || (next && next.querySelector && next.querySelector('img,figure,svg,canvas')));
      if (!parentHasImage && !adjacentHasImage) node.remove();
    });

    // Repair conservative PDF line-break artifacts. A long heading that ends
    // mid-sentence and is followed by a lower-case paragraph is one sentence,
    // not a clinical subheading. Short lower-case colon headings are also
    // demoted to emphasized prose.
    [...holder.querySelectorAll('h3,h4,h5')].forEach(h=>{
      if (!h.isConnected) return;
      let text=String(h.textContent||'').replace(/\s+/g,' ').trim();
      if (/^[a-zà-ỹ]/u.test(text) && /[:：]$/.test(text)) {
        const para=document.createElement('p');
        const strong=document.createElement('strong'); strong.innerHTML=h.innerHTML;
        para.appendChild(strong); h.replaceWith(para); return;
      }
      const next=h.nextElementSibling;
      if (next && next.tagName==='P' && text.length>=55) {
        const nt=sourceReaderText(next.textContent||'');
        if (sourceReaderShouldMergeContinuation(text,nt,{allowUppercaseAcronym:true})) {
          const para=document.createElement('p');
          para.innerHTML=(h.innerHTML+' '+next.innerHTML).replace(/\s+/g,' ');
          h.replaceWith(para);
          next.remove();
        }
      }
    });

    // Conservative block stitcher for PDF page-break artifacts. It changes only
    // block boundaries, never wording. Example: "các hoạt động thường" + "ngày"
    // becomes "các hoạt động thường ngày" when the second block is clearly a
    // lower-case continuation rather than a new sentence/heading.
    sourceReaderStitchListContinuations(holder);
    const stitchParents=[holder,...holder.querySelectorAll('div,section,article,li')];
    stitchParents.forEach(parent=>{
      let i=0;
      while(i<parent.children.length-1){
        const a=parent.children[i], b=parent.children[i+1];
        if(!a||!b||!a.isConnected||!b.isConnected){ i++; continue; }
        if(!['P','LI'].includes(a.tagName)||!['P','LI'].includes(b.tagName)){ i++; continue; }
        const at=sourceReaderText(a.textContent||'');
        const bt=sourceReaderText(b.textContent||'');
        if(!at||!bt||at.length<12){ i++; continue; }
        const sourceBullets=a.classList.contains('mtp-source-bullet') && b.classList.contains('mtp-source-bullet');
        const continuation=sourceReaderShouldMergeContinuation(at,bt,{allowUppercaseAcronym:true});
        const lengthGate=bt.length<=(sourceBullets?280:180);
        if(continuation && lengthGate){
          a.innerHTML=(a.innerHTML+' '+b.innerHTML).replace(/\s+/g,' ');
          b.remove();
          continue;
        }
        i++;
      }
    });

    // PDF extraction may flatten a two-level bullet list. Preserve the source
    // wording, but make short colon-ended group labels visually distinct and
    // indent their following detail items.
    holder.querySelectorAll('ul,ol').forEach(list=>{
      let grouped=false;
      [...list.children].forEach(li=>{
        if (li.tagName!=='LI') return;
        const text=String(li.textContent||'').replace(/\s+/g,' ').trim();
        const isLabel=/[:：]$/.test(text) && text.length<=130;
        if (isLabel) {
          li.classList.add('mtp-list-label');
          grouped=true;
        } else if (grouped) {
          li.classList.add('mtp-list-detail');
        }
      });
    });

    // Demote obvious page-break artifacts accidentally parsed as headings.
    holder.querySelectorAll('h3,h4').forEach(h=>{
      const text=String(h.textContent||'').replace(/\s+/g,' ').trim();
      const looksContinuation=/^\d+\s+(tháng|ngày|năm|tuần|giờ|phút)\b/i.test(text) && /[,.]$/.test(text);
      if (looksContinuation) {
        const p=document.createElement('p');
        p.innerHTML=h.innerHTML;
        h.replaceWith(p);
      }
    });
    // v0.24.9 — Normalize all imported plain HTML tables.
    // Presentation only: source wording/cell content is unchanged.
    holder.querySelectorAll('table').forEach(table=>{
      table.classList.add('mtp-clinical-table');
      if (!table.parentElement || !table.parentElement.classList.contains('mtp-table-wrap')) {
        const wrap=document.createElement('div');
        wrap.className='mtp-table-wrap';
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
      }
    });
    sourceReaderPruneEmptyListArtifacts(holder);
    return holder.innerHTML;
  }

  function moduleCard(m) {
    const visibleLocator=readerSourceLocator(m.source_locator);
    const iconMap={overview:'◎',screening:'⌕',clinical:'✦',diagnosis:'▣',differential:'≠',classification:'≡',assessment:'☷',severity:'▤',risk_stratification:'◆',treatment_goals:'◉',treatment:'⌁',stable_management:'⌁',inpatient:'▦',hypoglycemia:'↓',acute_complications:'!',chronic_complications:'⚠',glucose_monitoring:'↟',care_levels:'⇅',nutrition:'◌',followup:'↻',delivery:'◇',postpartum:'○',exacerbation:'!',comorbidities:'⊕',rehabilitation:'↗',complications:'⚠',disposition:'⇄',special_populations:'◇',education_prevention:'○',emergency:'!',prevention:'◇'};
    const icon=iconMap[m.module_key] || '•';
    const body=moduleBody(m);
    return `<article class="mtp-module" data-module="${esc(m.module_key)}" id="mtp-${esc(m.module_key)}">
      <header class="mtp-module-head">
        <h2><span class="mtp-module-icon">${icon}</span>${esc(m.title)}</h2>
        <button class="mtp-module-toggle" type="button" data-action="toggle-module" aria-expanded="true" title="Thu gọn">⌃</button>
      </header>
      ${visibleLocator?`<div class="mtp-module-source"><span>Nguồn</span><strong>${esc(visibleLocator)}</strong></div>`:''}
      <div class="mtp-module-content">${body}</div>
    </article>`;
  }

  function moduleBody(m) {
    const html=prepareModuleHtml(m.content_html || '');
    if (m.module_key==='clinical') return sectionedModuleBody(html,'clinical');
    if (['screening','classification','assessment','severity','risk_stratification','treatment_goals','stable_management','inpatient','hypoglycemia','acute_complications','chronic_complications','glucose_monitoring','care_levels','nutrition','followup','delivery','postpartum','exacerbation','comorbidities','rehabilitation','complications','disposition','special_populations','education_prevention','prevention'].includes(m.module_key)) return sectionedModuleBody(html,'generic');
    if (m.module_key!=='treatment') return html;
    const holder=document.createElement('div');
    holder.innerHTML=html;
    const headings=[...holder.querySelectorAll('h3,h4')];
    if (headings.length) {
      return `<div class="mtp-treatment-subcards">${headings.map((h,idx)=>{
        let content=''; let n=h.nextSibling;
        while(n && !(n.nodeType===1 && /^(H3|H4)$/.test(n.tagName))){ content+=n.outerHTML || esc(n.textContent||''); n=n.nextSibling; }
        return `<section class="mtp-treatment-subcard"><div class="mtp-subcard-title"><span>${idx+1}</span><strong>${esc(h.textContent||'')}</strong></div><div>${content}</div></section>`;
      }).join('')}</div>`;
    }
    const directList=holder.querySelector(':scope > ul, :scope > ol');
    if (directList && directList.children.length>=2) {
      return `<div class="mtp-treatment-subcards">${[...directList.children].map((li,idx)=>`<section class="mtp-treatment-subcard"><div class="mtp-subcard-title"><span>${idx+1}</span><strong>${treatmentLabel(li.textContent,idx)}</strong></div><div>${li.innerHTML}</div></section>`).join('')}</div>`;
    }
    return html;
  }

  function sectionedModuleBody(html,kind='generic') {
    const holder=document.createElement('div');
    holder.innerHTML=html || '';
    const headings=[...holder.querySelectorAll('h3,h4')];
    if (!headings.length) return html;
    const allowedClinical=['TRIỆU CHỨNG CƠ NĂNG','KHÁM THỰC THỂ','DẤU HIỆU CẢNH BÁO'];
    return `<div class="mtp-clinical-subcards">${headings.map((h,idx)=>{
      let title=String(h.textContent||'').trim();
      if (kind==='clinical') {
        const normalized=title.toUpperCase();
        title=allowedClinical.includes(normalized) ? normalized : title;
      }
      let content=''; let n=h.nextSibling;
      while(n && !(n.nodeType===1 && /^(H3|H4)$/.test(n.tagName))){ content+=n.outerHTML || esc(n.textContent||''); n=n.nextSibling; }
      const cls=title==='DẤU HIỆU CẢNH BÁO' ? ' is-alert' : '';
      return `<section class="mtp-clinical-subcard${cls}"><div class="mtp-clinical-subcard-title"><span>${idx+1}</span><strong>${esc(title)}</strong></div><div>${content}</div></section>`;
    }).join('')}</div>`;
  }

  function treatmentLabel(text,idx) {
    const t=String(text||'').trim();
    const colon=t.match(/^([^:;.!?]{3,46})[:;]/);
    if (colon) return esc(colon[1]);
    const labels=['Nguyên tắc điều trị','Điều trị nền','Xử trí theo bệnh cảnh','Theo dõi đáp ứng','Điều trị bổ sung'];
    return labels[idx] || `Nội dung ${idx+1}`;
  }

  function investigationCard(i) {
    const purposeHtml=i.purpose ? structuredFieldHtml(i.purpose) : '';
    const visibleName=readerClinicalLabel(i.name_vi);
    const visibleLocator=readerSourceLocator(i.source_locator);
    const coverage = {
      covered_if_eligible:['BHYT · khi đủ điều kiện','covered'],
      conditional:['BHYT · có điều kiện','conditional'],
      service_extra:['Dịch vụ bổ sung','service'],
      unverified:['','unverified']
    }[i.coverage_status] || ['','unverified'];
    const categoryLabel={core:'Cơ bản',recommended:'Khuyến nghị',advanced:'Chuyên sâu'}[i.category] || 'Cận lâm sàng';
    const compactMeta=[i.timing?`<span>◷ ${esc(i.timing)}</span>`:'',`<span>${esc(categoryLabel)}</span>`].filter(Boolean).join('');
    return `<details class="mtp-investigation-card" data-category="${esc(i.category || 'core')}" data-fidelity="${esc(i.fidelity_status || 'source_faithful')}">
      <summary>
        <div class="mtp-investigation-summary-main">
          <div class="mtp-investigation-top"><h3>${esc(visibleName)}</h3>${coverage[0]?`<span class="mtp-coverage ${coverage[1]}">${coverage[0]}</span>`:''}</div>
          ${i.name_en?`<div class="mtp-investigation-en">${esc(i.name_en)}</div>`:''}
          <div class="mtp-investigation-compact-meta">${compactMeta}</div>
        </div>
        <span class="mtp-details-arrow">⌄</span>
      </summary>
      <div class="mtp-investigation-detail">
        ${purposeHtml?(i.derived?`<div class="mtp-investigation-derived-body mtp-investigation-rich">${purposeHtml}</div>`:`<div class="mtp-investigation-row mtp-investigation-purpose"><strong>Mục đích</strong><div class="mtp-investigation-rich">${purposeHtml}</div></div>`):''}
        ${i.timing?`<p><strong>Thời điểm / tần suất</strong><span>${esc(i.timing)}</span></p>`:''}
        ${visibleLocator?`<p><strong>Vị trí trong nguồn</strong><span>${esc(visibleLocator)}</span></p>`:''}
        ${coverage[0] && i.coverage_note?`<div class="mtp-coverage-note"><strong>Ghi chú thanh toán</strong><span>${esc(stripHtml(i.coverage_note))}</span></div>`:''}
      </div>
    </details>`;
  }

  function isInternalSourceUrl(url) {
    const raw=String(url||'').trim();
    if (!raw) return false;
    try {
      const host=(new URL(raw,window.location.origin)).hostname.toLowerCase();
      return host==='drive.google.com' || host==='docs.google.com';
    } catch(e) {
      return /^https?:\/\/(?:drive|docs)\.google\.com\//i.test(raw);
    }
  }

  function publicSourceUrl(s) {
    const url=String((s&&s.url)||'').trim();
    return url && !isInternalSourceUrl(url) ? url : '';
  }

  // v2.0.8.9: provenance rows used to import hospital Word files are admin
  // metadata, not reader-facing references. Keep them in the database but
  // never serialize them as public bibliography cards.
  function sourceIsInternalBackbone(s) {
    const role=String((s&&s.currentness_role)||'').toLowerCase();
    const type=String((s&&s.source_type)||'').toLowerCase();
    return isInternalSourceUrl(s&&s.url) || role==='source_fidelity_backbone' || role==='source_backbone' || type==='source_fidelity_backbone' || type==='source_backbone';
  }

  function publicSourceNote(s) {
    const raw=cleanReaderAnnotationText(stripHtml((s&&s.notes)||'').replace(/\s+/g,' ').trim());
    if (!raw || INTERNAL_READER_RE.test(raw) || sourceIsInternalBackbone(s)) return '';
    return raw;
  }

  // v2.0.8.18: bibliography headings in hospital documents are often numbered
  // (e.g. "5. TÀI LIỆU THAM KHẢO" or "V. REFERENCES"). The optional
  // document ordinal is part of the bibliography boundary, not a clinical
  // numbered heading.
  // v3.5.20: source hospital protocols may place a compliance checklist after
  // the bibliography. Treat that long label as a real top-level source section
  // rather than a sentence-like pseudo-heading that gets folded into references.
  // v3.5.22: checklist tables imported from hospital PDFs are preserved as a
  // tight-cropped source-media figure. The same PDF extraction can also leave a
  // flattened transcript immediately after the figure ("STT TIÊU CHÍ ĐÁNH GIÁ
  // ĐẠT KHÔNG" followed by I/II/III and row prose). Rendering both creates a
  // duplicate pseudo-table with no columns. Prefer the authoritative source table
  // image and keep the transcript hidden only as a runtime fallback if the image
  // cannot load. Footer/signature text outside the source crop remains visible.
  function sourceReaderChecklistTranscriptHeaderIndex(children) {
    if (!Array.isArray(children)) return -1;
    const sequence=[];
    children.forEach((node,index)=>{
      const key=readerHeadingKey(node&&node.textContent||'');
      if (key) sequence.push({index,key});
    });
    // v3.5.23: PDF table extraction may split the four-column checklist header
    // across several sibling nodes, e.g. STT -> TIÊU CHÍ ĐÁNH GIÁ -> ĐẠT ->
    // (1 điểm) -> KHÔNG -> (0 điểm), and some sources omit/extract STT poorly.
    // Detect the semantic header as a compact sequence rather than requiring one
    // exact element. Return the actual STT/criteria node, never patient metadata
    // that merely falls inside the same look-ahead window.
    for (let start=0;start<sequence.length;start++) {
      const window=sequence.slice(start,start+8);
      const joined=window.map(x=>x.key).join(' ');
      if (!/tieu chi danh gia/.test(joined)) continue;
      if (!/(?:^|\s)dat(?:\s|$)/.test(joined)) continue;
      if (!/(?:^|\s)khong(?:\s|$)/.test(joined)) continue;
      const anchor=window.find(x=>/^stt(?:\b|$)/.test(x.key) || /tieu chi danh gia/.test(x.key));
      if (anchor) return anchor.index;
    }
    return -1;
  }

  function sourceReaderPreferChecklistSourceTable(root) {
    if (!root || !root.children) return root;
    const children=[...root.children];
    const headerIndex=sourceReaderChecklistTranscriptHeaderIndex(children);
    if (headerIndex<0) return root;

    // Use the nearest preserved source figure before the transcript header. This
    // is important for multi-page/multi-fragment checklist tables and for YHCT-
    // PHCN sources that also carry a later unrelated figure after the transcript.
    let figure=null;
    for (let i=headerIndex-1;i>=0;i--) {
      const node=children[i];
      const candidate=node&&node.matches&&node.matches('figure.mcr-source-figure')
        ? node
        : (node&&node.querySelector ? node.querySelector('figure.mcr-source-figure') : null);
      if (candidate && candidate.querySelector('img[src]')) { figure=candidate; break; }
    }
    if (!figure) return root;

    const header=children[headerIndex];
    const fallback=document.createElement('div');
    fallback.className='mcr-checklist-transcript-fallback';
    fallback.hidden=true;
    fallback.setAttribute('aria-hidden','true');

    let node=header,moved=0;
    while (node) {
      const next=node.nextElementSibling;
      const key=readerHeadingKey(node.textContent||'');
      const footerBoundary=moved>0 && /^(?:ti le tong diem|ty le tong diem|danh gia(?:\b|$)|ngay(?:\b|$)|nguoi kiem tra(?:\b|$)|nguoi danh gia(?:\b|$))/.test(key);
      if (footerBoundary) break;
      fallback.appendChild(node);
      moved++;
      node=next;
    }
    if (!moved) return root;

    figure.classList.add('mcr-checklist-source-table');
    figure.dataset.checklistSourceTable='1';
    const img=figure.querySelector('img');
    if (img) {
      img.classList.add('mcr-checklist-source-table-image');
      if (!String(img.getAttribute('alt')||'').trim()) img.setAttribute('alt','Bảng kiểm tuân thủ phác đồ điều trị');
    }
    figure.after(fallback);
    return root;
  }

  function activateChecklistSourceTableFallbacks(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('figure.mcr-checklist-source-table').forEach(figure=>{
      const fallback=figure.nextElementSibling && figure.nextElementSibling.matches('.mcr-checklist-transcript-fallback')
        ? figure.nextElementSibling : null;
      const img=figure.querySelector('img');
      if (!fallback) return;
      const showFallback=()=>{
        figure.hidden=true;
        fallback.hidden=false;
        fallback.setAttribute('aria-hidden','false');
      };
      if (!img || !String(img.getAttribute('src')||'').trim()) { showFallback(); return; }
      img.addEventListener('error',showFallback,{once:true});
      if (img.complete && !img.naturalWidth) showFallback();
    });
  }

  function sourceChecklistHeading(title) {
    const key=readerHeadingKey(title||'');
    return /^(?:bang kiem|checklist)(?:\b|$)/.test(key) && /(?:tuan thu|phac do)/.test(key);
  }

  function sourceReferenceHeading(title) {
    const key=readerHeadingKey(title||'');
    return /^(?:(?:\d{1,3}|[ivxlcdm]{1,8})\s+)?(?:tai lieu tham khao|nguon tai lieu|references?|bibliography)(?:\b|$)/.test(key);
  }

  function sourceReferenceList(sources) {
    const refs=(sources||[]).filter(s=>!sourceIsInternalBackbone(s) && (String((s&&s.title)||'').trim() || String((s&&s.organization)||'').trim()));
    if (!refs.length) return '';
    const seen=new Set();
    const items=[];
    refs.forEach(s=>{
      const citation=sourceCitation(s);
      const plain=stripHtml(citation).replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
      const url=publicSourceUrl(s);
      const key=(plain+'|'+url).toLowerCase();
      if (!plain || seen.has(key)) return;
      seen.add(key);
      items.push(`<li><span>${citation}</span>${url?` <a href=\"${esc(url)}\" target=\"_blank\" rel=\"noopener\">Mở nguồn ↗</a>`:''}</li>`);
    });
    return items.length ? `<div class=\"mtp-source-reference-addendum\"><h3>Tài liệu cập nhật</h3><ol>${items.join('')}</ol></div>` : '';
  }

  function sourceRoleLabel(s) {
    const role=String(s.currentness_role||'');
    if (role==='current_national_primary') return 'Nguồn quốc gia chính';
    if (role==='current_international_primary') return 'Khuyến cáo quốc tế chính';
    if (role==='current_international_guideline' || role==='current_international_overlay') return 'Khuyến cáo quốc tế hiện hành';
    if (role==='national_context_overlay' || role==='national_overlay') return 'Tham chiếu quốc gia';
    if (role==='structural_reference_only') return 'Tài liệu tham khảo bổ sung';
    return 'Tài liệu tham khảo';
  }

  function sourceCard(s,index) {
    const dates=[];
    const visibleUrl=publicSourceUrl(s);
    const internalSource=isInternalSourceUrl(s.url);
    if (s.issued_date) dates.push(`Ban hành ${formatDate(s.issued_date)}`);
    if (s.effective_date && s.effective_date!==s.issued_date) dates.push(`Hiệu lực ${formatDate(s.effective_date)}`);
    if (s.accessed_at && !internalSource) dates.push(`Truy cập ${formatDate(s.accessed_at)}`);
    const citation=sourceCitation(s);
    const role=sourceRoleLabel(s);
    const publicNote=publicSourceNote(s);
    return `<article class="mtp-source-card">
      <div class="mtp-source-card-top"><b class="mtp-source-index">${index?esc(String(index))+'. ':''}${esc(role)}</b>${Number(s.is_primary)===1?'<b>Nguồn chính</b>':''}${Number(s.is_superseded)===1?'<b class="is-old">Đã được thay thế</b>':''}</div>
      <h3>${esc(s.title)}</h3>
      <p>${esc(s.organization || '')}</p>
      <div class="mtp-source-meta"><strong>${esc(s.document_no || '')}</strong><span>${esc(dates.join(' · '))}</span></div>
      ${s.supersedes_document_no?`<div class="mtp-source-supersedes">Thay thế: <strong>${esc(s.supersedes_document_no)}</strong></div>`:''}
      ${publicNote?`<div class="mtp-source-role-note"><span>${esc(publicNote)}</span></div>`:''}
      <div class="mtp-citation-box"><div><strong>Trích dẫn</strong></div><p>${citation}</p>${visibleUrl?`<a class="mtp-source-url" href="${esc(visibleUrl)}" target="_blank" rel="noopener">${esc(visibleUrl)}</a>`:''}</div>
      ${visibleUrl?`<a href="${esc(visibleUrl)}" target="_blank" rel="noopener">Mở tài liệu gốc ↗</a>`:''}
    </article>`;
  }

  function sourceCitation(s) {
    const org=String(s.organization || '').trim() || 'Tổ chức ban hành';
    const title=String(s.title || '').trim();
    const type=String(s.source_type||'').toLowerCase();
    const isByt=type.indexOf('byt_')===0 || org==='Bộ Y tế';
    let doc='';
    if (s.document_no) doc = isByt ? ` Quyết định số ${s.document_no}${s.issued_date ? ` ngày ${formatDate(s.issued_date)}` : ''}.` : ` ${s.document_no}.`;
    const internalSource=isInternalSourceUrl(s.url);
    const accessed=(!internalSource && s.accessed_at) ? ` Truy cập ngày ${formatDate(s.accessed_at)}.` : '';
    const url=(!internalSource && s.url) ? ` ${s.url}.` : '';
    return esc(`${org}. ${title}.${doc}${url}${accessed}`.replace(/\s+/g,' ').trim());
  }

  function recommendationCard(r) {
    const scope=r.scope==='domestic' ? 'Trong nước' : 'Quốc tế';
    const category={diagnosis:'Chẩn đoán',investigation:'Cận lâm sàng',treatment:'Điều trị',followup:'Theo dõi',prevention:'Dự phòng',general:'Cập nhật'}[r.category] || 'Cập nhật';
    return `<article class="mtp-recommendation-card">
      <div class="mtp-recommendation-meta"><span>${esc(scope)}</span><span>${esc(category)}</span>${r.version_year?`<span>${esc(r.version_year)}</span>`:''}</div>
      <h3>${esc(r.title || r.guideline_name || 'Cập nhật khuyến cáo')}</h3>
      ${r.summary_html?`<div class="mtp-recommendation-summary">${r.summary_html}</div>`:''}
      ${Number(r.differs_from_moh)===1 ? `<div class="mtp-difference-note"><strong>Điểm cập nhật đáng chú ý</strong><span>${esc(stripHtml(r.difference_note||''))}</span></div>`:''}
      ${r.recommendation_html?`<div class="mtp-recommendation-body">${r.recommendation_html}</div>`:''}
      <div class="mtp-recommendation-source"><strong>${esc(r.organization || '')}</strong>${r.guideline_name?`<span>${esc(r.guideline_name)}</span>`:''}${r.publication_date?`<span>Ban hành ${formatDate(r.publication_date)}</span>`:''}${r.accessed_at?`<span>Truy cập ${formatDate(r.accessed_at)}</span>`:''}</div>
      ${r.source_url?`<a href="${esc(r.source_url)}" target="_blank" rel="noopener">Mở nguồn khuyến cáo ↗</a>`:''}
    </article>`;
  }

  function formatDate(v) {
    const d=new Date(v+'T00:00:00');
    if (isNaN(d)) return v;
    return new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
  }

  function clearSearch() {
    const input=document.getElementById('mtp-search');
    if (input) input.value='';
    state.q=''; state.group=''; state.specialty=''; state.current=null;
    updateNavActive();
    runSearch(true);
  }
  function goHome(push=false) {
    state.q=''; state.group=''; state.specialty=''; state.current=null;
    const input=document.getElementById('mtp-search'); if (input) input.value='';
    updateNavActive(); runSearch(push);
  }

  function renderError(err) {
    const main=document.getElementById('mtp-main');
    main.classList.remove('is-protocol-view');
    main.innerHTML=`<div class="mtp-empty mtp-error"><div class="mtp-empty-icon">!</div><h3>Không tải được dữ liệu</h3><p>${esc(err.message || 'Lỗi không xác định')}</p><button type="button" class="mtp-soft-btn" data-action="home">Quay về thư viện</button></div>`;
  }
  function renderFatal(err) {
    root.innerHTML=`<div class="mtp-fatal"><div class="mtp-logo">M</div><h1>Phác đồ điều trị MEDIPHARM</h1><p>${esc(err.message || 'Không thể khởi tạo ứng dụng.')}</p><a href="${esc(cfg.homeUrl || '/')}">Về trang chủ</a></div>`;
  }

  function updateInstallButton() {
    const btn=document.getElementById('mtp-install-btn');
    if (!btn) return;
    const standalone=state.isStandalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    btn.hidden=!!standalone;
    btn.classList.toggle('is-ready', !!state.installPrompt);
    btn.title=state.installPrompt ? 'Cài WebApp lên thiết bị' : 'Hướng dẫn cài WebApp';
  }

  async function installWebApp() {
    if (state.isStandalone) return;
    if (state.installPrompt) {
      const promptEvent=state.installPrompt;
      state.installPrompt=null;
      try {
        await promptEvent.prompt();
        await promptEvent.userChoice;
      } catch(e) {}
      updateInstallButton();
      return;
    }
    showInstallHelp();
  }

  function showInstallHelp() {
    closeInstallHelp();
    const ua=navigator.userAgent || '';
    const ios=/iPad|iPhone|iPod/.test(ua) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
    const safari=/Safari/.test(ua) && !/Chrome|CriOS|Edg|OPR/.test(ua);
    const message=ios
      ? 'Trên iPhone/iPad: mở trang bằng Safari → Chia sẻ → Thêm vào Màn hình chính.'
      : (safari
        ? 'Trong Safari, dùng menu Chia sẻ hoặc tùy chọn thêm trang vào Dock/Màn hình chính nếu thiết bị hỗ trợ.'
        : 'Nếu hộp cài đặt chưa xuất hiện, hãy dùng Chrome/Edge trên HTTPS, tải lại trang rồi bấm Cài WebApp; cũng có thể dùng biểu tượng Cài đặt trên thanh địa chỉ của trình duyệt.');
    root.insertAdjacentHTML('beforeend', `<div class="mtp-install-modal" role="dialog" aria-modal="true" aria-label="Cài WebApp">
      <button class="mtp-install-backdrop" type="button" data-action="close-install" aria-label="Đóng"></button>
      <div class="mtp-install-dialog">
        <div class="mtp-install-mark">M</div>
        <div class="mtp-install-copy"><h3>Cài Phác đồ điều trị MEDIPHARM</h3><p>${esc(message)}</p><small>Sau khi cài, ứng dụng có thể mở trực tiếp từ màn hình chính của thiết bị.</small></div>
        <button class="mtp-install-close" type="button" data-action="close-install">Đã hiểu</button>
      </div>
    </div>`);
  }

  function closeInstallHelp() {
    const modal=root.querySelector('.mtp-install-modal');
    if (modal) modal.remove();
  }

  function syncEmbeddedTheme() {
    if (!cfg.embedded) return;
    const hostTheme=document.documentElement.dataset.mcrTheme;
    if (hostTheme==='dark' || hostTheme==='light') document.documentElement.dataset.mtpTheme=hostTheme;
  }

  window.addEventListener('nah-sdp:theme-change',e=>{
    if (!cfg.embedded || !e.detail || typeof e.detail.dark!=='boolean') return;
    document.documentElement.dataset.mtpTheme=e.detail.dark?'dark':'light';
  });
  window.addEventListener('storage',e=>{
    if (!cfg.embedded || !['mcr-theme','yhls-theme','tvm-theme','yhlsm-theme'].includes(e.key)) return;
    if (e.newValue==='dark' || e.newValue==='light') document.documentElement.dataset.mtpTheme=e.newValue;
  });

  function registerSW() {
    if (cfg.embedded) return; // Unified MEDIPHARM shell owns PWA registration.
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('https')) return;
    const swUrl=cfg.swUrl || ((cfg.homeUrl || '/') + 'medipharm-protocols-sw.js');
    const swScope=cfg.swScope || '/phac-do/';
    navigator.serviceWorker.register(swUrl, {scope:swScope}).catch(()=>{});
  }

  window.addEventListener('mcr:clinical-content-type',e=>switchContentType(e.detail?.contentType));
  boot();
})();
