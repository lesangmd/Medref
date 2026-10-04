(() => {
  'use strict';
  const cfg=window.MCR_CONFIG||{};
  const app=document.getElementById('mcr-app');
  if(!app) return;
  const modules=['dashboard','protocols','procedures','icd'];
  const icdTabs=['icd','pl3','yhct','guides'];
  let current=modules.includes(cfg.initialView)?cfg.initialView:'dashboard';
  let currentIcdTab=icdTabs.includes(cfg.initialIcdTab)?cfg.initialIcdTab:'icd';
  let searchTimer=null, installPrompt=null, dashboardLoaded=false;
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const fmt=n=>Number(n||0).toLocaleString('vi-VN');
  const api=async path=>{const headers={Accept:'application/json'};if(cfg.restNonce)headers['X-WP-Nonce']=cfg.restNonce;const r=await fetch((cfg.restBase||'').replace(/\/$/,'')+'/'+path,{credentials:'same-origin',headers});if(!r.ok)throw new Error('API');return r.json();};

  function normalizeModule(view){return ['pl3','yhct','guides'].includes(view)?'icd':view;}
  function setView(view,{push=true,q=null,protocol=null,icdTab=null}={}){
    if(['pl3','yhct','guides'].includes(view)){icdTab=view;view='icd';}
    view=normalizeModule(view);
    if(!modules.includes(view)) view='dashboard';
    if(view==='icd'){const requested=icdTab||currentIcdTab||'icd';currentIcdTab=icdTabs.includes(requested)?requested:'icd';}
    current=view; app.dataset.view=view;
    $$('[data-mcr-panel]',app).forEach(el=>el.classList.toggle('is-active',el.dataset.mcrPanel===(view==='procedures'?'protocols':view)));
    $$('.mcr-nav [data-mcr-view]',app).forEach(el=>el.classList.toggle('is-active',el.dataset.mcrView===view));
    if(view==='protocols'||view==='procedures') window.dispatchEvent(new CustomEvent('mcr:clinical-content-type',{detail:{contentType:view==='procedures'?'procedure':'protocol'}}));
    if(view==='icd') activateIcdSubtab(currentIcdTab,q);
    if((view==='protocols'||view==='procedures') && protocol) {
      const base=new URL(cfg.appUrl||location.href,location.origin);
      let rootPath=(base.pathname.replace(/\/+$/,'')||'/medipharm');
      if(view==='procedures') rootPath += '/quy-trinh';
      const pretty=rootPath+'/'+encodeURIComponent(protocol)+'/';
      if(push) history.pushState({},'',pretty); else history.replaceState({},'',pretty);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    if(push){
      const u=new URL(cfg.appUrl||location.href,location.origin);
      u.search='';
      if(view!=='dashboard')u.searchParams.set('view',view);
      if(view==='icd'&&currentIcdTab!=='icd')u.searchParams.set('icd_tab',currentIcdTab);
      if(q)u.searchParams.set('q',q);
      history.pushState({},'',u.pathname+(u.search||''));
    }
    if(view==='dashboard'&&!dashboardLoaded) loadDashboard();
  }

  function activateIcdSubtab(view,q){
    const tab=icdTabs.includes(view)?view:'icd';
    let tries=0;
    const go=()=>{
      const root=$('[data-nah-icd10-app]'); const btn=root&&$(`[data-icd10-tab="${tab}"]`,root);
      if(!root||!btn){if(tries++<20)setTimeout(go,100);return;}
      btn.click();
      if(q&&tab==='icd'){
        const input=$('[data-icd10-query]',root); if(input){input.value=q; const form=$('[data-icd10-search-form]',root); if(form)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
      }
    };go();
  }

  function renderDashboard(d){
    const host=$('#mcr-dashboard'); if(!host)return;
    dashboardLoaded=true;
    const icd=d.icd||{}, p=d.protocols||{}, specs=(d.specialties||[]).slice(0,10), tools=d.tools||[];
    const totalIcd=Number(icd.total_records||icd.codes||0), active=Number(icd.active_tt06||icd.active||0), cancelled=Number(icd.cancelled||0), newer=Number(icd.new||0);
    host.innerHTML=`
      <section class="mcr-hero">
        <div class="mcr-hero-main"><div class="mcr-hero-kicker">THƯ VIỆN MEDIPHARM</div><h1>MEDIPHARM CLINICAL REFERENCE</h1><p>Thư viện tham chiếu lâm sàng tích hợp phác đồ chẩn đoán–điều trị, quy trình chuyên môn và hệ thống mã ICD-10 trong một không gian tra cứu thống nhất.</p><div class="mcr-hero-links"><button data-open-view="protocols">Mở Phác đồ</button><button data-open-view="procedures">Mở Quy trình</button><button data-open-view="icd">Tra cứu ICD-10</button></div></div>
        <aside class="mcr-live-card"><h2>Trạng thái dữ liệu</h2><div class="mcr-live-list"><div class="mcr-live-row"><span>ICD-10 hiệu lực</span><b>${active?fmt(active)+' mã':'Chưa có dữ liệu'}</b></div><div class="mcr-live-row"><span>Phác đồ</span><b>${fmt(p.published_protocols||0)}</b></div><div class="mcr-live-row"><span>Quy trình</span><b>${fmt(p.published_procedures||0)}</b></div><div class="mcr-live-row"><span>Liên kết ICD ↔ Phác đồ</span><b>${fmt(p.icd_links||0)}</b></div><div class="mcr-live-row"><span>Mã ICD có phác đồ</span><b>${fmt(d.linked_unique_icd||0)}</b></div></div><div class="mcr-live-foot">Tra cứu ICD-10, phác đồ và quy trình chuyên môn ngay trong cùng một giao diện.</div></aside>
      </section>
      <section class="mcr-stat-grid">
        ${stat('Mã ICD hiệu lực',active,'Theo danh mục hiện hành','var(--mcr-brand)')}
        ${stat('Phác đồ',p.published_protocols||0,'Đang có thể tra cứu','var(--mcr-green)')}
        ${stat('Quy trình',p.published_procedures||0,'Đang có thể tra cứu','var(--mcr-blue)')}
        ${stat('Chuyên khoa',p.specialties||0,'Đang có trong thư viện','var(--mcr-blue)')}
        ${stat('Mã ICD đã hủy',cancelled,'Được cảnh báo khi tra cứu','var(--mcr-red)')}
        ${stat('Mã ICD mới',newer,'Theo bộ dữ liệu hiện hành','var(--mcr-amber)')}
      </section>
      <div class="mcr-section-title"><div><h2>Công cụ truy cập nhanh</h2><p>Các module tra cứu và tham chiếu lâm sàng dùng chung.</p></div></div>
      <section class="mcr-tools">${tools.map(t=>`<button class="mcr-tool" data-open-view="${esc(t.view||'dashboard')}"><span class="mcr-tool-icon">${esc(t.icon||'M')}</span><strong>${esc(t.title||'Công cụ')}</strong><p>${esc(t.description||'')}</p><b>Mở công cụ →</b></button>`).join('')}</section>
      <div class="mcr-section-title"><div><h2>Thống kê thư viện</h2><p>Tổng quan số lượng phác đồ, quy trình, liên kết ICD-10 và phân bố chuyên khoa.</p></div></div>
      <section class="mcr-chart-grid">
        <article class="mcr-chart-card"><h3>Phác đồ theo chuyên khoa</h3><p>Các chuyên khoa có nhiều phác đồ nhất trong thư viện hiện tại.</p>${barChart(specs)}</article>
        <article class="mcr-chart-card"><h3>Trạng thái danh mục ICD</h3><p>Tổng quan mã hiệu lực, mã đã hủy và mã mới.</p>${donutChart(totalIcd,active,cancelled,newer)}</article>
      </section>`;
    $$('[data-open-view]',host).forEach(b=>b.addEventListener('click',()=>setView(b.dataset.openView,{push:true})));
  }
  function stat(label,value,note,accent){return `<article class="mcr-stat-card" style="--stat-accent:${accent}"><small>${esc(label)}</small><strong>${fmt(value)}</strong><span>${esc(note)}</span></article>`;}
  function barChart(rows){if(!rows.length)return '<div class="mcr-search-empty">Chưa có phác đồ Published để thống kê.</div>';const max=Math.max(...rows.map(r=>Number(r.protocol_count||0)),1);return `<div class="mcr-bars">${rows.map(r=>`<div class="mcr-bar-row"><span title="${esc(r.name_vi)}">${esc(r.name_vi)}</span><div class="mcr-bar-track"><div class="mcr-bar-fill" style="width:${Math.max(2,Number(r.protocol_count||0)/max*100).toFixed(1)}%"></div></div><b>${fmt(r.protocol_count)}</b></div>`).join('')}</div>`;}
  function donutChart(total,active,cancelled,newer){const base=Math.max(active+cancelled,1);const r=64,c=2*Math.PI*r;const a=Math.min(active/base,1)*c, x=Math.min(cancelled/base,1)*c;return `<div class="mcr-donut-wrap"><svg class="mcr-donut" viewBox="0 0 180 180" role="img" aria-label="Tỷ lệ mã ICD hiệu lực và mã đã hủy"><circle class="base" cx="90" cy="90" r="64"></circle><circle class="seg-active" cx="90" cy="90" r="64" stroke-dasharray="${a} ${c-a}" stroke-dashoffset="0"></circle><circle class="seg-cancel" cx="90" cy="90" r="64" stroke-dasharray="${x} ${c-x}" stroke-dashoffset="${-a}"></circle><text x="90" y="86">${fmt(total)}</text><text x="90" y="105" style="font-size:8px;fill:var(--mcr-muted);font-weight:600">Tổng bản ghi</text></svg><div class="mcr-legend"><div><span>Mã hiệu lực</span><b>${fmt(active)}</b></div><div><span>Mã đã hủy</span><b>${fmt(cancelled)}</b></div><div><span>Trong đó mã mới</span><b>${fmt(newer)}</b></div></div></div>`;}
  async function loadDashboard(){const host=$('#mcr-dashboard');if(host)host.innerHTML='<div class="mcr-loading">Đang tổng hợp dữ liệu lâm sàng…</div>';try{renderDashboard(await api('dashboard'));}catch(e){if(host)host.innerHTML='<div class="mcr-search-empty">Không thể tải thống kê. Kiểm tra database ICD/phác đồ/quy trình và REST API.</div>';}}

  async function globalSearch(q,logQuery=false){
    const box=$('#mcr-search-results'); if(!box)return;
    q=String(q||'').trim(); if(q.length<2){box.hidden=true;box.innerHTML='';return;}
    box.hidden=false; box.innerHTML='<div class="mcr-loading">Đang tìm đồng thời ICD-10, phác đồ và quy trình…</div>';
    try{
      const d=await api('search?q='+encodeURIComponent(q)+'&limit=8&log='+(logQuery?'1':'0'));
      const icd=d.icd||[], protocols=d.protocols||[], procedures=d.procedures||[];
      if(!icd.length&&!protocols.length&&!procedures.length){box.innerHTML='<div class="mcr-search-empty">Không tìm thấy kết quả phù hợp.</div>';return;}
      box.innerHTML=`${searchGroup('ICD-10',icd.map(r=>`<button class="mcr-search-item" data-search-icd="${esc(r.code)}"><span class="mcr-search-code">${esc(r.code)}</span><span class="mcr-search-copy"><strong>${esc(r.name_vi||r.name_en||'')}</strong><small>${r.linked_protocol_count?`${r.linked_protocol_count} phác đồ liên quan · `:''}${esc(r.chapter_name_vi||'')}</small></span><span class="mcr-search-link">Mở →</span></button>`).join(''),icd.length)}${searchGroup('Phác đồ',protocols.map(p=>`<button class="mcr-search-item" data-search-protocol="${esc(p.slug)}"><span class="mcr-search-code">PĐ</span><span class="mcr-search-copy"><strong>${esc(p.title_vi)}</strong><small>${esc(p.specialty_name_vi||'')}${(p.icd||[]).length?' · '+esc((p.icd||[]).map(x=>x.code).join(', ')):''}</small></span><span class="mcr-search-link">Mở →</span></button>`).join(''),protocols.length)}${searchGroup('Quy trình',procedures.map(p=>`<button class="mcr-search-item" data-search-procedure="${esc(p.slug)}"><span class="mcr-search-code">QT</span><span class="mcr-search-copy"><strong>${esc(p.title_vi)}</strong><small>${esc(p.specialty_name_vi||'')}</small></span><span class="mcr-search-link">Mở →</span></button>`).join(''),procedures.length)}`;
      $$('[data-search-icd]',box).forEach(b=>b.addEventListener('click',()=>{box.hidden=true;setView('icd',{push:true,q:b.dataset.searchIcd});}));
      $$('[data-search-protocol]',box).forEach(b=>b.addEventListener('click',()=>{box.hidden=true;setView('protocols',{push:true,protocol:b.dataset.searchProtocol});}));
      $$('[data-search-procedure]',box).forEach(b=>b.addEventListener('click',()=>{box.hidden=true;setView('procedures',{push:true,protocol:b.dataset.searchProcedure});}));
    }catch(e){box.innerHTML='<div class="mcr-search-empty">Không thể tìm kiếm. Kiểm tra kết nối REST API.</div>';}
  }
  function searchGroup(title,html,count){if(!html)return '';return `<section class="mcr-search-group"><div class="mcr-search-group-title"><strong>${esc(title)}</strong><span>${count} kết quả</span></div>${html}</section>`;}

  function showToast(message,duration=4200){
    const toast=$('#mcr-toast');if(!toast)return;
    toast.textContent=String(message||'');toast.hidden=false;
    clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>{toast.hidden=true;},duration);
  }
  function setMenuOpen(open){
    const toggle=$('#mcr-menu-toggle'),panel=$('#mcr-menu-panel');if(!toggle||!panel)return;
    panel.hidden=!open;toggle.setAttribute('aria-expanded',open?'true':'false');
  }

  const READER_FONT_KEY='mcr-reader-font-scale';
  const READER_FONT_STEPS=[0.94,1,1.08,1.16,1.26,1.36];
  function readerFontScale(){try{const n=Number(localStorage.getItem(READER_FONT_KEY));return READER_FONT_STEPS.includes(n)?n:1.16;}catch(e){return 1.16;}}
  function applyReaderFontScale(scale,{persist=true}={}){
    scale=READER_FONT_STEPS.reduce((best,x)=>Math.abs(x-scale)<Math.abs(best-scale)?x:best,READER_FONT_STEPS[0]);
    document.documentElement.style.setProperty('--mcr-reader-scale',String(scale));
    if(persist)try{localStorage.setItem(READER_FONT_KEY,String(scale));}catch(e){}
  }
  function adjustReaderFont(dir){
    const cur=readerFontScale();let idx=READER_FONT_STEPS.indexOf(cur);if(idx<0)idx=3;
    if(Number(dir)===0)idx=3;else idx=Math.max(0,Math.min(READER_FONT_STEPS.length-1,idx+(Number(dir)>0?1:-1)));
    applyReaderFontScale(READER_FONT_STEPS[idx]);
  }
  function guestRemaining(){try{return Math.max(0,Number(cfg.guestViewLimit||10)-Number(localStorage.getItem('mcr-guest-protocol-views')||0));}catch(e){return Number(cfg.guestViewLimit||10);}}
  let guestGateModal=false;
  function setLoginCopy(mode='default'){
    const title=$('#mcr-login-title'),copy=$('#mcr-login-copy');
    if(!title||!copy)return;
    if(mode==='guest-limit'){
      title.textContent=`Đã hết ${Number(cfg.guestViewLimit||10)} lượt xem thử`;
      copy.textContent='Đăng nhập hoặc đăng ký tài khoản để tiếp tục xem đầy đủ các phác đồ.';
    }else{
      title.textContent='Đăng nhập MEDIPHARM';
      copy.textContent='Đăng nhập để tiếp tục xem đầy đủ thư viện phác đồ.';
    }
  }
  function setLoginModal(open,{mode='default'}={}){
    const m=$('#mcr-login-modal');if(!m)return;
    if(open)setLoginCopy(mode);
    m.hidden=!open;m.setAttribute('aria-hidden',open?'false':'true');document.body.classList.toggle('mcr-login-open',!!open);
    if(!open)guestGateModal=false;
    if(open){const input=$('input[name="log"]',m);if(input)setTimeout(()=>input.focus(),30);}
  }
  function setupLoginModal(){
    window.addEventListener('mcr:login-required',e=>{
      if(e&&e.detail&&e.detail.reason==='guest-limit'){guestGateModal=true;setLoginModal(true,{mode:'guest-limit'});}
    });
    document.addEventListener('click',e=>{
      if(e.target.closest('[data-mcr-login-open]')){
        e.preventDefault();
        const modal=$('#mcr-login-modal');
        if(!(guestGateModal&&modal&&!modal.hidden))setLoginModal(true,{mode:'default'});
      }
      if(e.target.closest('[data-mcr-login-close]')){e.preventDefault();setLoginModal(false);}
    });
    document.addEventListener('keydown',e=>{if(e.key==='Escape')setLoginModal(false);});
  }

  function setupMenu(){
    const toggle=$('#mcr-menu-toggle'),panel=$('#mcr-menu-panel');if(!toggle||!panel)return;
    toggle.addEventListener('click',e=>{e.stopPropagation();setAccountMenuOpen(false);setMenuOpen(panel.hidden);});
    panel.addEventListener('click',e=>{if(e.target.closest('.mcr-menu-item'))setMenuOpen(false);});
    document.addEventListener('click',e=>{if(!panel.hidden&&!e.target.closest('.mcr-menu'))setMenuOpen(false);});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){setMenuOpen(false);toggle.focus();}});
  }
  function setAccountMenuOpen(open){
    const toggle=$('[data-mcr-account-toggle]'),panel=$('#mcr-account-panel');
    if(!toggle||!panel)return;
    panel.hidden=!open;toggle.setAttribute('aria-expanded',open?'true':'false');
  }
  function setupAccountMenu(){
    const toggle=$('[data-mcr-account-toggle]'),panel=$('#mcr-account-panel');if(!toggle||!panel)return;
    toggle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setMenuOpen(false);setAccountMenuOpen(panel.hidden);});
    panel.addEventListener('click',e=>{if(e.target.closest('.mcr-account-panel-item'))setAccountMenuOpen(false);});
    document.addEventListener('click',e=>{if(!panel.hidden&&!e.target.closest('.mcr-account-menu'))setAccountMenuOpen(false);});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){setAccountMenuOpen(false);toggle.focus();}});
  }
  function setThemeState(dark){
    const root=document.documentElement;
    root.dataset.mcrTheme=dark?'dark':'light';root.dataset.mtpTheme=dark?'dark':'light';
    ['tvm-dark','yhlsm-dark','nah-sdp-dark-mode','nah-sdp-night-active','nah-sdp-night-mode'].forEach(name=>root.classList.toggle(name,dark));
    if(document.body){['tvm-dark','yhlsm-dark','nah-sdp-dark-mode','nah-sdp-night-active','nah-sdp-night-mode'].forEach(name=>document.body.classList.toggle(name,dark));}
    const icd=$('[data-nah-icd10-app]');if(icd){icd.classList.toggle('nah-icd10--dark',dark);icd.classList.toggle('nah-icd10--light',!dark);}
    const themeButton=$('#mcr-theme'),themeLabel=$('[data-mcr-theme-label]');
    if(themeButton){themeButton.setAttribute('aria-pressed',dark?'true':'false');themeButton.setAttribute('aria-label',dark?'Bật chế độ sáng':'Bật chế độ tối');}
    if(themeLabel)themeLabel.textContent=dark?'Chế độ Sáng':'Chế độ Tối';
    const meta=$('meta[name="theme-color"]');if(meta)meta.setAttribute('content',dark?'#10181d':'#0b6674');
  }
  function persistTheme(dark){
    const value=dark?'dark':'light';
    try{['mcr-theme','tvm-theme','yhls-theme','yhlsm-theme'].forEach(key=>localStorage.setItem(key,value));}catch(e){}
  }
  function applyTheme(theme,{persist=true,notify=true}={}){
    const dark=theme==='dark';setThemeState(dark);if(persist)persistTheme(dark);
    if(notify)window.dispatchEvent(new CustomEvent('nah-sdp:theme-change',{detail:{dark,owner:'mcr-clinical-reference'}}));
  }
  function initTheme(){
    let saved='';try{for(const key of ['yhls-theme','tvm-theme','yhlsm-theme','mcr-theme']){const value=localStorage.getItem(key);if(value==='dark'||value==='light'){saved=value;break;}}}catch(e){}
    if(!saved)saved=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
    applyTheme(saved,{persist:false,notify:false});
  }
  function isStandalone(){return !!((window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true);}
  function isOwnStandalone(){
    let launched=false;
    try{
      const params=new URLSearchParams(location.search);
      launched=params.get('source')==='mcr-pwa'||params.get('mcr_pwa')==='1';
      if(launched)sessionStorage.setItem('mcr-own-standalone','1');
      else launched=sessionStorage.getItem('mcr-own-standalone')==='1';
    }catch(e){}
    return isStandalone()&&launched;
  }
  function openInstallInBrowser(){
    let target;
    try{
      target=new URL(location.href);
      target.searchParams.delete('source');
      target.searchParams.delete('mcr_pwa');
      target.searchParams.set('mcr_install','1');
    }catch(e){return false;}
    const ua=navigator.userAgent||'';
    if(/android/i.test(ua)){
      try{
        const scheme=target.protocol.replace(':','')||'https';
        const path=target.host+target.pathname+target.search+target.hash;
        location.href='intent://'+path+'#Intent;scheme='+scheme+';package=com.android.chrome;S.browser_fallback_url='+encodeURIComponent(target.href)+';end';
        return true;
      }catch(e){}
    }
    try{const w=window.open(target.href,'_blank','noopener,noreferrer');if(w)return true;}catch(e){}
    return false;
  }
  async function ensureServiceWorker(){
    if(!('serviceWorker'in navigator)||!cfg.swUrl)return null;
    const scope=cfg.swScope||'/medipharm/';const expected=new URL(cfg.swUrl,location.href).href;
    try{
      const scopeUrl=new URL(scope,location.origin).href;let reg=await navigator.serviceWorker.getRegistration(scopeUrl);
      const worker=reg&&(reg.active||reg.waiting||reg.installing);const script=worker&&worker.scriptURL?new URL(worker.scriptURL,location.href).href:'';
      if(reg&&script===expected){if(reg.update)reg.update().catch(()=>{});return reg;}
      reg=await navigator.serviceWorker.register(cfg.swUrl,{scope});return reg;
    }catch(e){return null;}
  }
  function installFallback(){
    const ios=/iphone|ipad|ipod/i.test(navigator.userAgent||'');
    if(ios){showToast('Trên iPhone/iPad: mở Chia sẻ → Thêm vào Màn hình chính.',6500);return;}
    showToast('Trình duyệt chưa cung cấp hộp thoại cài đặt. Mở menu trình duyệt và chọn “Cài đặt ứng dụng” hoặc “Thêm vào màn hình chính”.',6500);
  }
  function setupInstall(){
    const b=$('#mcr-install');if(!b)return;
    const installLabel=b.querySelector('span:last-child');
    const syncPrompt=()=>{
      installPrompt=window.__MCR_INSTALL_PROMPT||installPrompt;
      const own=isOwnStandalone();
      b.hidden=false;
      b.removeAttribute('hidden');
      b.dataset.installState=own?'installed':(installPrompt?'ready':(isStandalone()?'host-standalone':'waiting'));
      if(installLabel)installLabel.textContent=own?'WebApp đã cài':'Cài WebApp';
      b.setAttribute('aria-label',own?'MEDIPHARM Clinical Reference đang chạy dưới dạng WebApp độc lập':'Cài MEDIPHARM Clinical Reference thành WebApp độc lập');
    };
    syncPrompt();
    window.addEventListener('mcr:install-ready',syncPrompt);
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();window.__MCR_INSTALL_PROMPT=e;installPrompt=e;syncPrompt();});
    window.addEventListener('appinstalled',()=>{installPrompt=null;window.__MCR_INSTALL_PROMPT=null;try{sessionStorage.setItem('mcr-own-standalone','1');}catch(e){}syncPrompt();showToast('MEDIPHARM Clinical Reference đã được cài đặt.');});
    b.addEventListener('click',async()=>{
      if(isOwnStandalone()){syncPrompt();showToast('MEDIPHARM Clinical Reference đang chạy ở chế độ ứng dụng độc lập.');return;}
      await ensureServiceWorker();installPrompt=window.__MCR_INSTALL_PROMPT||installPrompt;
      if(installPrompt){
        const prompt=installPrompt;installPrompt=null;window.__MCR_INSTALL_PROMPT=null;
        try{prompt.prompt();const choice=await prompt.userChoice;if(choice&&choice.outcome==='accepted'){syncPrompt();}else{syncPrompt();}}catch(e){syncPrompt();installFallback();}
        return;
      }
      if(isStandalone()){
        showToast('Đang mở Clinical Reference trong trình duyệt để cài thành ứng dụng độc lập…',4200);
        if(!openInstallInBrowser())installFallback();
        return;
      }
      installFallback();
    });
    if(document.readyState==='complete')ensureServiceWorker().then(syncPrompt);else window.addEventListener('load',()=>ensureServiceWorker().then(syncPrompt),{once:true});
  }
  function parseViewFromLocation(){const p=new URLSearchParams(location.search);const explicit=p.get('view');let v=explicit||current;let icdTab=p.get('icd_tab')||currentIcdTab||cfg.initialIcdTab||'icd';const path=location.pathname.replace(/\/+$/,'');let protocol=p.get('protocol')||cfg.initialProtocol||'';if(['pl3','yhct','guides'].includes(v)){icdTab=v;v='icd';}if(!explicit&&(path.endsWith('/icd-10')||path.endsWith('/icd10')))v='icd';if(!explicit&&path.endsWith('/phac-do'))v='protocols';const pm=path.match(/\/medipharm\/quy-trinh(?:\/([^/]+))?$/i);if(pm){v='procedures';if(pm[1]){try{protocol=decodeURIComponent(pm[1]);}catch(e){protocol=pm[1];}}}else{const m=path.match(/\/medipharm\/([^/]+)$/i);if(m&&m[1].toLowerCase()!=='quy-trinh'){v='protocols';try{protocol=decodeURIComponent(m[1]);}catch(e){protocol=m[1];}}}v=normalizeModule(v);if(!modules.includes(v))v='dashboard';if(!icdTabs.includes(icdTab))icdTab='icd';return {view:v,icdTab,q:p.get('q')||p.get('syh_q')||p.get('icd10_q')||p.get('query')||'',protocol};}

  $$('.mcr-nav [data-mcr-view],.mcr-brand[data-mcr-view]',app).forEach(el=>el.addEventListener('click',e=>{e.preventDefault();setView(el.dataset.mcrView,{push:true});}));
  document.addEventListener('click',e=>{const btn=e.target.closest('.mcr-embedded-icd [data-icd10-tab]');if(!btn)return;const tab=btn.getAttribute('data-icd10-tab');if(icdTabs.includes(tab))currentIcdTab=tab;});
  setupMenu();
  setupAccountMenu();
  applyReaderFontScale(readerFontScale(),{persist:false});
  $$('[data-mcr-font]').forEach(b=>b.addEventListener('click',()=>adjustReaderFont(b.dataset.mcrFont)));
  setupLoginModal();
  const themeButton=$('#mcr-theme');if(themeButton)themeButton.addEventListener('click',()=>applyTheme(document.documentElement.dataset.mcrTheme==='dark'?'light':'dark'));
  window.addEventListener('nah-sdp:theme-change',e=>{if(!e.detail||typeof e.detail.dark!=='boolean'||e.detail.owner==='mcr-clinical-reference')return;applyTheme(e.detail.dark?'dark':'light',{persist:false,notify:false});});
  window.addEventListener('storage',e=>{if(!['mcr-theme','tvm-theme','yhls-theme','yhlsm-theme'].includes(e.key)||!['dark','light'].includes(e.newValue))return;applyTheme(e.newValue,{persist:false,notify:false});});
  const search=$('#mcr-search'),clear=$('#mcr-search-clear'),form=$('#mcr-search-form');
  search.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>globalSearch(search.value,false),420);});
  form.addEventListener('submit',e=>{e.preventDefault();globalSearch(search.value,true);});
  clear.addEventListener('click',()=>{search.value='';$('#mcr-search-results').hidden=true;search.focus();});
  document.addEventListener('click',e=>{const box=$('#mcr-search-results');if(box&&!box.hidden&&!e.target.closest('#mcr-search-results')&&!e.target.closest('#mcr-search-form'))box.hidden=true;});
  window.addEventListener('popstate',()=>{const x=parseViewFromLocation();setView(x.view,{push:false,q:x.q,protocol:null,icdTab:x.icdTab});if(x.view==='icd'&&x.q)activateIcdSubtab(x.icdTab,x.q);});
  initTheme();setupInstall();
  const initial=parseViewFromLocation();setView(initial.view,{push:false,q:initial.q,protocol:null,icdTab:initial.icdTab});
  if(initial.view==='dashboard')loadDashboard();
  if(initial.view==='icd'&&initial.q)activateIcdSubtab(initial.icdTab,initial.q);
})();
