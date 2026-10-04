(function(){
    'use strict';
    function qs(root, sel){ return root.querySelector(sel); }
    function qsa(root, sel){ return Array.prototype.slice.call(root.querySelectorAll(sel)); }
    function esc(str){ return String(str == null ? '' : str).replace(/[&<>'"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]; }); }
    function fmt(n){ return Number(n || 0).toLocaleString('vi-VN'); }
    function api(path, opts){
        opts=opts||{}; opts.headers=opts.headers||{};
        if (window.NAH_ICD10 && NAH_ICD10.nonce) opts.headers['X-WP-Nonce']=NAH_ICD10.nonce;
        return fetch((NAH_ICD10.restUrl||'').replace(/\/$/,'')+path, opts).then(function(r){ if(!r.ok) throw new Error('API'); return r.json(); });
    }
    function postApi(path, data){ return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})}); }
    window.NAH_ICD10_DOCK_BRIDGE = {
        search:function(q, options){ options=options||{}; return api('/search?q='+encodeURIComponent(q||'')+'&filter='+encodeURIComponent(options.filter||'all')+'&limit='+(options.limit||12)); },
        checkPrimary:function(code, options){ options=options||{}; return postApi('/check-primary',{code:code,gender:options.gender||'',record_type:options.record_type||'clinical'}); }
    };
    function copyText(text){
        if(!text) return Promise.resolve();
        if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
        var ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); return Promise.resolve();
    }
    function badgeHtml(badges){ return (badges||[]).map(function(b){ return '<span class="nah-icd10-badge nah-icd10-badge-'+esc(b.type)+'">'+esc(b.label)+'</span>'; }).join(''); }
    function renderSuggestions(suggestions){
        if(!suggestions||!suggestions.length) return '';
        return '<details class="nah-icd10-suggestions" open><summary>Gợi ý mã cụ thể hơn ('+suggestions.length+')</summary>'+suggestions.map(function(s){
            return '<div class="nah-icd10-suggestion"><code>'+esc(s.code)+'</code><span>'+esc(s.name_vi||s.name_en||'')+'</span></div>';
        }).join('')+'</details>';
    }
    function renderProtocolLinks(item){
        var items=item&&item.linked_protocols||[];
        if(!items.length) return '';
        var url=item.protocols_url||'#';
        return '<div class="nah-icd10-protocol-links"><div><strong>Clinical Desk Reference liên quan</strong><span>'+items.length+' phác đồ</span></div>'+items.map(function(p){return '<a href="'+esc((window.MCR_CONFIG&&MCR_CONFIG.appUrl?MCR_CONFIG.appUrl:'/medipharm/')+'?view=protocols&protocol='+encodeURIComponent(p.slug))+'"><b>'+esc(p.title_vi||'Phác đồ')+'</b><small>'+esc(p.is_primary?'ICD chính':'ICD liên quan')+'</small></a>';}).join('')+'<a class="nah-icd10-protocol-all" href="'+esc(url)+'">Xem tất cả phác đồ theo mã '+esc(item.code)+' →</a></div>';
    }
    function renderCard(item){
        var ev=item.evaluation||{}, fm=ev.copy_formats||{}; var messages=(ev.messages||[]).concat(ev.warnings||[]);
        return '<article class="nah-icd10-card nah-icd10-card-'+esc(ev.severity||'ok')+'">'+
        '<div class="nah-icd10-card-top"><code class="nah-icd10-code">'+esc(item.code)+'</code><div class="nah-icd10-actions"><button type="button" data-copy="'+esc(fm.code||item.code)+'">Copy mã</button><button type="button" data-copy="'+esc(fm.code_name||(item.code+' - '+(item.name_vi||'')))+'">Copy mã + tên</button><button type="button" data-use-primary="'+esc(item.code)+'">Dùng mã</button></div></div>'+
        '<div class="nah-icd10-card-title" role="heading" aria-level="3">'+esc(item.name_vi||item.name_en||'(Chưa có tên bệnh)')+'</div>'+(item.name_en?'<p class="nah-icd10-en">'+esc(item.name_en)+'</p>':'')+
        '<div class="nah-icd10-badges">'+badgeHtml(ev.badges)+'</div>'+(messages.length?'<div class="nah-icd10-message">'+messages.map(function(m){return '<p>'+esc(m)+'</p>';}).join('')+'</div>':'')+
        '<div class="nah-icd10-meta">'+(item.chapter_name_vi?'<span>'+esc(item.chapter_name_vi)+'</span>':'')+(item.block_name_vi?'<span>'+esc(item.block_name_vi)+'</span>':'')+(item.three_char_name_vi?'<span>'+esc(item.three_char_name_vi)+'</span>':'')+'</div>'+((item.coding_guidance_vi||item.coding_guidance_en)?'<details class="nah-icd10-note"><summary>Hướng dẫn / ghi chú mã hóa</summary><p>'+esc(item.coding_guidance_vi||item.coding_guidance_en)+'</p></details>':'')+renderSuggestions(item.suggestions)+renderProtocolLinks(item)+'</article>';
    }
    function renderResults(root, data){
        var box=qs(root,'[data-icd10-results]'); if(!box) return;
        if(!data||!data.results){box.innerHTML='<div class="nah-icd10-empty">Không đọc được phản hồi từ API.</div>';return;}
        if(!data.results.length){box.innerHTML='<div class="nah-icd10-empty">Không tìm thấy mã phù hợp. Kiểm tra lại từ khóa hoặc import database ICD-10.</div>';return;}
        var q=qs(root,'[data-icd10-query]'); var qtxt=q&&q.value.trim()? ' cho từ khóa “<strong>'+esc(q.value.trim())+'</strong>”':'';
        box.innerHTML='<div class="nah-icd10-count">Tìm thấy '+data.count+' kết quả'+qtxt+'.</div>'+data.results.map(renderCard).join('');
    }
    function activateIcdPanel(root){
        qsa(root,'[data-icd10-tab]').forEach(function(btn){btn.classList.toggle('is-active',btn.getAttribute('data-icd10-tab')==='icd');});
        qsa(root,'[data-icd10-panel]').forEach(function(panel){var on=panel.getAttribute('data-icd10-panel')==='icd';panel.hidden=!on;panel.classList.toggle('is-active',on);});
    }
    function search(root, logQuery){
        activateIcdPanel(root);
        var input=qs(root,'[data-icd10-query]'); var q=input?input.value.trim():''; var filter=root.getAttribute('data-current-filter')||'all'; var box=qs(root,'[data-icd10-results]');
        if(box) box.innerHTML='<div class="nah-icd10-loading">Đang tra cứu...</div>';
        api('/search?q='+encodeURIComponent(q)+'&filter='+encodeURIComponent(filter)+'&limit=50&log='+(logQuery?'1':'0')).then(function(data){renderResults(root,data);}).catch(function(){ if(box) box.innerHTML='<div class="nah-icd10-empty">Lỗi kết nối API.</div>'; });
    }
    function renderCheck(root,data){
        var out=qs(root,'[data-icd10-check-output]'); if(!out) return; var ev=data.evaluation||{}, item=data.item||{}; var messages=(ev.messages||[]).concat(ev.warnings||[]);
        out.innerHTML='<div class="nah-icd10-check-card nah-icd10-card-'+esc(ev.severity||'ok')+'"><div class="nah-icd10-badges">'+badgeHtml(ev.badges)+'</div>'+(data.found?'<div class="nah-icd10-check-card-title" role="heading" aria-level="3"><code>'+esc(data.code)+'</code> '+esc(item.name_vi||'')+'</div>':'<div class="nah-icd10-check-card-title" role="heading" aria-level="3">'+esc(data.code||'')+'</div>')+(messages.length?messages.map(function(m){return '<p>'+esc(m)+'</p>';}).join(''):'')+renderSuggestions(data.suggestions)+'</div>';
    }
    function checkPrimary(root){
        var code=qs(root,'[data-check-code]').value.trim(), gender=qs(root,'[data-check-gender]').value, recordType=qs(root,'[data-check-record-type]').value, out=qs(root,'[data-icd10-check-output]');
        if(!code){ if(out) out.innerHTML='<div class="nah-icd10-empty">Vui lòng nhập mã ICD-10.</div>'; return; }
        if(out) out.innerHTML='<div class="nah-icd10-loading">Đang kiểm tra...</div>';
        postApi('/check-primary',{code:code,gender:gender,record_type:recordType}).then(function(data){renderCheck(root,data);}).catch(function(){ if(out) out.innerHTML='<div class="nah-icd10-empty">Lỗi kết nối API.</div>'; });
    }
    function rowCode(label,code){ return code?'<div class="nah-icd10-code-row"><span>'+esc(label)+'</span><code>'+esc(code)+'</code></div>':''; }
    function renderPl3Card(r){
        return '<article class="nah-icd10-card nah-icd10-pl3-card"><div class="nah-icd10-card-top"><div class="nah-icd10-card-title">'+esc(r.substance)+'</div><button type="button" data-copy="'+esc(r.substance)+'">Copy tên</button></div><div class="nah-icd10-meta"><span>Nhóm '+esc(r.group_letter||'')+'</span></div>'+rowCode('Ngộ độc - Chương XIX',r.poisoning_code)+rowCode('Vô tình',r.accidental_code)+rowCode('Cố ý tự làm hại',r.self_harm_code)+rowCode('Không rõ ý định',r.undetermined_code)+rowCode('Tác dụng có hại khi dùng điều trị',r.adverse_effect_code)+'</article>';
    }
    function renderLoadMore(type, data){
        if(!data.has_more) return '';
        var next=(Number(data.offset||0)+Number(data.shown||0));
        return '<div class="nah-icd10-loadmore-wrap"><button type="button" class="nah-icd10-loadmore" data-'+type+'-load-more data-next-offset="'+next+'">Hiện thêm 50 mục</button></div>';
    }
    function renderPl3(data){
        if(!data.results||!data.results.length) return '<div class="nah-icd10-empty">Không tìm thấy thuốc/hóa chất phù hợp. Hãy kiểm tra đã import PL3 hoặc thử từ khóa/mã khác.</div>';
        var total=(typeof data.total==='number')?data.total:data.count, shownUpTo=Number(data.offset||0)+Number(data.shown||data.results.length);
        var countText='Tìm thấy <b>'+fmt(total)+'</b> dòng thuốc/hóa chất, đang hiển thị <b>'+fmt(shownUpTo)+'</b>.';
        return '<div class="nah-icd10-count" data-pl3-count>'+countText+'</div><div class="nah-icd10-note">PL3 có số lượng dòng lớn. Có thể bấm <b>Hiện thêm</b> để tải tiếp 50 dòng hoặc nhập tên thuốc/hóa chất/mã T/X/Y để lọc chính xác hơn.</div><div class="nah-icd10-pl3-grid" data-pl3-grid>'+data.results.map(renderPl3Card).join('')+'</div>'+renderLoadMore('pl3', data);
    }
    function appendPl3(root, data){
        var box=qs(root,'[data-pl3-results]'), grid=qs(root,'[data-pl3-grid]'), count=qs(root,'[data-pl3-count]'), oldBtn=qs(root,'[data-pl3-load-more]');
        if(!box || !grid) { if(box) box.innerHTML=renderPl3(data); return; }
        grid.insertAdjacentHTML('beforeend', data.results.map(renderPl3Card).join(''));
        if(count){ count.innerHTML='Tìm thấy <b>'+fmt(data.total)+'</b> dòng thuốc/hóa chất, đang hiển thị <b>'+fmt(Number(data.offset||0)+Number(data.shown||0))+'</b>.'; }
        if(oldBtn){ var wrap=oldBtn.closest('.nah-icd10-loadmore-wrap'); if(wrap) wrap.remove(); }
        if(data.has_more){ box.insertAdjacentHTML('beforeend', renderLoadMore('pl3', data)); }
    }
    function searchPl3(root, append){
        var qEl=qs(root,'[data-pl3-query]'), q=qEl?qEl.value.trim():'', box=qs(root,'[data-pl3-results]');
        var offset=append ? Number(root.getAttribute('data-pl3-next-offset')||0) : 0;
        if(!append && box) box.innerHTML='<div class="nah-icd10-loading">Đang tra cứu PL3...</div>';
        api('/pl3/search?q='+encodeURIComponent(q)+'&limit=50&offset='+offset).then(function(data){
            root.setAttribute('data-pl3-next-offset', String(Number(data.offset||0)+Number(data.shown||0)));
            if(box){ if(append) appendPl3(root,data); else box.innerHTML=renderPl3(data); }
        }).catch(function(){ if(box) box.innerHTML='<div class="nah-icd10-empty">Lỗi kết nối API PL3.</div>'; });
    }
    function renderYhctCard(r){
        return '<article class="nah-icd10-card nah-icd10-card-ok"><div class="nah-icd10-card-top"><code class="nah-icd10-code">'+esc(r.yhct_code)+'</code><div class="nah-icd10-actions"><button type="button" data-copy="'+esc(r.yhct_code)+'">Copy mã</button><button type="button" data-copy="'+esc(r.yhct_code+' - '+(r.name_yhct||''))+'">Copy mã + tên</button></div></div><div class="nah-icd10-card-title">'+esc(r.name_yhct)+'</div><div class="nah-icd10-badges"><span class="nah-icd10-badge nah-icd10-badge-success">'+esc(r.status||'Đang dùng')+'</span></div><div class="nah-icd10-meta">'+(r.icd10_code?'<span>ICD10: '+esc(r.icd10_code)+'</span>':'')+(r.name_icd10?'<span>'+esc(r.name_icd10)+'</span>':'')+'</div>'+(r.note?'<details class="nah-icd10-note"><summary>Chi tiết dữ liệu YHCT</summary><p>'+esc(r.note)+'</p></details>':'')+'</article>';
    }
    function renderYhct(data){
        if(!data.results||!data.results.length) return '<div class="nah-icd10-empty">Chưa có dữ liệu YHCT hoặc không tìm thấy kết quả phù hợp.</div>';
        var total=(typeof data.total==='number')?data.total:data.count, shownUpTo=Number(data.offset||0)+Number(data.shown||data.results.length);
        var note = data.is_sample_only ? '<div class="nah-icd10-note"><b>Lưu ý dữ liệu:</b> hiện database YHCT chỉ có dữ liệu mẫu ('+fmt(total)+' mã). Cần import file danh mục mã bệnh YHCT chính thức dạng CSV/XLSX để tra cứu đầy đủ.</div>' : '';
        return '<div class="nah-icd10-count" data-yhct-count>Tìm thấy <b>'+fmt(total)+'</b> mã YHCT, đang hiển thị <b>'+fmt(shownUpTo)+'</b>.</div>'+note+'<div class="nah-icd10-yhct-grid" data-yhct-grid>'+data.results.map(renderYhctCard).join('')+'</div>'+renderLoadMore('yhct', data);
    }
    function appendYhct(root, data){
        var box=qs(root,'[data-yhct-results]'), grid=qs(root,'[data-yhct-grid]'), count=qs(root,'[data-yhct-count]'), oldBtn=qs(root,'[data-yhct-load-more]');
        if(!box || !grid) { if(box) box.innerHTML=renderYhct(data); return; }
        grid.insertAdjacentHTML('beforeend', data.results.map(renderYhctCard).join(''));
        if(count){ count.innerHTML='Tìm thấy <b>'+fmt(data.total)+'</b> mã YHCT, đang hiển thị <b>'+fmt(Number(data.offset||0)+Number(data.shown||0))+'</b>.'; }
        if(oldBtn){ var wrap=oldBtn.closest('.nah-icd10-loadmore-wrap'); if(wrap) wrap.remove(); }
        if(data.has_more){ box.insertAdjacentHTML('beforeend', renderLoadMore('yhct', data)); }
    }
    function searchYhct(root, append){
        var qEl=qs(root,'[data-yhct-query]'), q=qEl?qEl.value.trim():'', box=qs(root,'[data-yhct-results]'), filter=root.getAttribute('data-yhct-filter')||'all';
        var offset=append ? Number(root.getAttribute('data-yhct-next-offset')||0) : 0;
        if(!append && box) box.innerHTML='<div class="nah-icd10-loading">Đang tra cứu YHCT...</div>';
        api('/yhct/search?q='+encodeURIComponent(q)+'&filter='+encodeURIComponent(filter)+'&limit=50&offset='+offset).then(function(data){
            root.setAttribute('data-yhct-next-offset', String(Number(data.offset||0)+Number(data.shown||0)));
            if(box){ if(append) appendYhct(root,data); else box.innerHTML=renderYhct(data); }
        }).catch(function(){ if(box) box.innerHTML='<div class="nah-icd10-empty">Lỗi kết nối API YHCT.</div>'; });
    }
    function renderGuides(data){
        if(!data.results||!data.results.length) return '<div class="nah-icd10-empty">Chưa có dữ liệu PL1/PL2 hoặc không tìm thấy nội dung phù hợp.</div>';
        return '<div class="nah-icd10-count">Đang hiển thị '+data.count+' mục.</div><div class="nah-icd10-guide-grid">'+data.results.map(function(r){return '<article class="nah-icd10-card nah-icd10-guide-card"><div class="nah-icd10-card-title">'+esc((r.section_code?r.section_code+' - ':'')+(r.title||''))+'</div>'+(r.range_code?'<p><code>'+esc(r.range_code)+'</code></p>':'')+'<p>'+esc(r.content||'').replace(/\n/g,'<br>')+'</p></article>';}).join('')+'</div>';
    }
    function searchGuides(root){
        var q=qs(root,'[data-guide-query]').value.trim(), box=qs(root,'[data-guide-results]'), part=root.getAttribute('data-guide-part')||'pl1';
        if(box) box.innerHTML='<div class="nah-icd10-loading">Đang tải hướng dẫn...</div>';
        api('/guides/search?part='+encodeURIComponent(part)+'&q='+encodeURIComponent(q)+'&limit=50').then(function(data){ if(box) box.innerHTML=renderGuides(data);}).catch(function(){ if(box) box.innerHTML='<div class="nah-icd10-empty">Lỗi kết nối API hướng dẫn.</div>'; });
    }
    var deferredPrompt=null;
    function setupPwaInstallButtons(){
        var buttons=qsa(document,'[data-icd10-install]'); if(!buttons.length) return;
        function setInstallLabel(btn,text){var label=btn.querySelector('span'); if(label){label.textContent=text;}else{btn.textContent=text;}}
        window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferredPrompt=e;buttons.forEach(function(b){b.hidden=false;setInstallLabel(b,'Cài ứng dụng');});});
        window.addEventListener('appinstalled',function(){deferredPrompt=null;buttons.forEach(function(b){b.hidden=true;});});
        buttons.forEach(function(btn){btn.addEventListener('click',function(){
            if(!deferredPrompt){setInstallLabel(btn,'Mở /icd-10 để cài');setTimeout(function(){setInstallLabel(btn,'Cài ứng dụng');},1500);return;}
            deferredPrompt.prompt();
            deferredPrompt.userChoice.finally(function(){deferredPrompt=null;buttons.forEach(function(b){b.hidden=true;});});
        });});
    }
    function setupTheme(root){
        var button=qs(root,'[data-icd10-theme-toggle]'); if(!button) return;
        var label=qs(button,'[data-icd10-theme-label]');
        var storageKey='nah_icd10_theme';
        var saved=null;
        try{saved=window.localStorage.getItem(storageKey);}catch(e){saved=null;}
        function hostPrefersDark(){
            var html=document.documentElement,body=document.body;
            var hostDark=html.classList.contains('dark')||html.classList.contains('dark-mode')||html.classList.contains('nah-sdp-night-active')||html.classList.contains('nah-sdp-dark-mode')||(body&&(body.classList.contains('dark')||body.classList.contains('dark-mode')||body.classList.contains('nah-sdp-night-active')||body.classList.contains('nah-sdp-dark-mode')));
            if(hostDark) return true;
            return !!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
        }
        function applyTheme(theme,persist){
            var isDark=theme==='dark';
            root.classList.toggle('nah-icd10--dark',isDark);
            root.classList.toggle('nah-icd10--light',!isDark);
            button.setAttribute('aria-pressed',isDark?'true':'false');
            button.setAttribute('aria-label',isDark?'Bật chế độ sáng':'Bật chế độ tối');
            if(label) label.textContent=isDark?'Chế độ sáng':'Chế độ tối';
            if(document.body&&document.body.classList.contains('nah-icd10-webapp-body')) document.body.classList.toggle('nah-icd10-page-dark',isDark);
            var meta=document.querySelector('meta[name="theme-color"]');
            if(meta) meta.setAttribute('content',isDark?'#10181d':'#0b6674');
            if(persist){try{window.localStorage.setItem(storageKey,isDark?'dark':'light');}catch(e){}}
        }
        applyTheme(saved==='dark'||saved==='light'?saved:(hostPrefersDark()?'dark':'light'),false);
        button.addEventListener('click',function(){applyTheme(root.classList.contains('nah-icd10--dark')?'light':'dark',true);});
    }
    function registerServiceWorker(){ if(!('serviceWorker' in navigator)||!(window.NAH_ICD10&&NAH_ICD10.pwaEnabled&&NAH_ICD10.serviceWorkerUrl)) return; window.addEventListener('load',function(){navigator.serviceWorker.register(NAH_ICD10.serviceWorkerUrl,{scope:NAH_ICD10.serviceWorkerScope||'/icd-10/'}).catch(function(){});}); }
    function bindApp(root){
        root.setAttribute('data-current-filter','all'); root.setAttribute('data-guide-part','pl1'); root.setAttribute('data-yhct-filter','all'); root.classList.add('nah-icd10-readable');
        setupTheme(root);
        var form=qs(root,'[data-icd10-search-form]'); if(form) form.addEventListener('submit',function(e){e.preventDefault();search(root,true);});
        var input=qs(root,'[data-icd10-query]'), timer; if(input) input.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(function(){if(input.value.trim().length>=2)search(root,false);},420);});
        qsa(root,'[data-filter]').forEach(function(btn){btn.addEventListener('click',function(){qsa(root,'[data-filter]').forEach(function(b){b.classList.remove('is-active');});btn.classList.add('is-active');root.setAttribute('data-current-filter',btn.getAttribute('data-filter'));search(root,false);});});
        qsa(root,'[data-view-mode]').forEach(function(btn){btn.addEventListener('click',function(){qsa(root,'[data-view-mode]').forEach(function(b){b.classList.remove('is-active');});btn.classList.add('is-active');root.classList.toggle('nah-icd10-compact',btn.getAttribute('data-view-mode')==='compact');root.classList.toggle('nah-icd10-readable',btn.getAttribute('data-view-mode')!=='compact');});});
        var primary=qs(root,'[data-primary-mode]'); if(primary) primary.addEventListener('change',function(){var note=qs(root,'[data-primary-note]'); if(note) note.hidden=!primary.checked; if(primary.checked){root.setAttribute('data-current-filter','primary'); qsa(root,'[data-filter]').forEach(function(b){b.classList.toggle('is-active',b.getAttribute('data-filter')==='primary');}); search(root,false);}});
        var detail=qs(root,'[data-detail-toggle]'); if(detail) detail.addEventListener('click',function(){var box=qs(root,'[data-detail-filters]'); if(box) box.hidden=!box.hidden;});
        qsa(root,'[data-icd10-tab]').forEach(function(btn){btn.addEventListener('click',function(){var tab=btn.getAttribute('data-icd10-tab'); qsa(root,'[data-icd10-tab]').forEach(function(b){b.classList.remove('is-active');}); btn.classList.add('is-active'); qsa(root,'[data-icd10-panel]').forEach(function(p){var on=p.getAttribute('data-icd10-panel')===tab; p.hidden=!on; p.classList.toggle('is-active',on);}); if(tab==='pl3'&&!root.getAttribute('data-pl3-loaded')){root.setAttribute('data-pl3-loaded','1'); searchPl3(root,false);} if(tab==='yhct'&&!root.getAttribute('data-yhct-loaded')){root.setAttribute('data-yhct-loaded','1'); searchYhct(root,false);} if(tab==='guides'&&!root.getAttribute('data-guide-loaded')){root.setAttribute('data-guide-loaded','1'); searchGuides(root);}});});
        var pl3Form=qs(root,'[data-pl3-search-form]'); if(pl3Form) pl3Form.addEventListener('submit',function(e){e.preventDefault();searchPl3(root,false);});
        var yForm=qs(root,'[data-yhct-search-form]'); if(yForm) yForm.addEventListener('submit',function(e){e.preventDefault();searchYhct(root,false);});
        qsa(root,'[data-yhct-filter]').forEach(function(btn){btn.addEventListener('click',function(){qsa(root,'[data-yhct-filter]').forEach(function(b){b.classList.remove('is-active');});btn.classList.add('is-active');root.setAttribute('data-yhct-filter',btn.getAttribute('data-yhct-filter'));searchYhct(root,false);});});
        var gForm=qs(root,'[data-guide-search-form]'); if(gForm) gForm.addEventListener('submit',function(e){e.preventDefault();searchGuides(root);});
        qsa(root,'[data-guide-part]').forEach(function(btn){btn.addEventListener('click',function(){qsa(root,'[data-guide-part]').forEach(function(b){b.classList.remove('is-active');});btn.classList.add('is-active');root.setAttribute('data-guide-part',btn.getAttribute('data-guide-part'));searchGuides(root);});});
        root.addEventListener('click',function(e){
            var copy=e.target.closest('[data-copy]'); if(copy){copyText(copy.getAttribute('data-copy')).then(function(){var old=copy.textContent;copy.textContent='Đã copy';setTimeout(function(){copy.textContent=old;},1200);});}
            var use=e.target.closest('[data-use-primary]'); if(use){var code=use.getAttribute('data-use-primary'),check=qs(root,'[data-check-code]'); if(check){check.value=code; checkPrimary(root);}}
            var pl3More=e.target.closest('[data-pl3-load-more]'); if(pl3More){e.preventDefault(); root.setAttribute('data-pl3-next-offset', pl3More.getAttribute('data-next-offset')||root.getAttribute('data-pl3-next-offset')||'0'); pl3More.textContent='Đang tải...'; searchPl3(root,true);}
            var yhctMore=e.target.closest('[data-yhct-load-more]'); if(yhctMore){e.preventDefault(); root.setAttribute('data-yhct-next-offset', yhctMore.getAttribute('data-next-offset')||root.getAttribute('data-yhct-next-offset')||'0'); yhctMore.textContent='Đang tải...'; searchYhct(root,true);}
        });
        var checkForm=qs(root,'[data-icd10-check-form]'); if(checkForm) checkForm.addEventListener('submit',function(e){e.preventDefault();checkPrimary(root);});
        document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement&&!/input|textarea|select/i.test(document.activeElement.tagName)){e.preventDefault(); if(input) input.focus();}});
    }
    document.addEventListener('DOMContentLoaded',function(){qsa(document,'[data-nah-icd10-app]').forEach(bindApp);setupPwaInstallButtons();registerServiceWorker();});
})();
