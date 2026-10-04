(() => {
  'use strict';
  const origin = 'https://app.medref.local';
  const params = new URLSearchParams(location.search);
  const authenticated = params.get('auth') === '1';
  const dataVersion = params.get('data') || 'local';
  const appVersion = params.get('app') || '1.0.0';
  const mcrBase = origin + '/wp-json/medipharm-reference/v1/';
  const mtpBase = origin + '/wp-json/medipharm-protocols/v1/';
  const icdBase = origin + '/wp-json/nah-icd10/v1';

  window.MCR_CONFIG = {
    version: appVersion,
    restBase: mcrBase,
    restNonce: '',
    appUrl: origin + '/medipharm/',
    manifestUrl: '',
    swUrl: '',
    swScope: '/medipharm/',
    initialView: params.get('view') || 'dashboard',
    initialIcdTab: params.get('icd_tab') || 'icd',
    initialProtocol: params.get('protocol') || '',
    query: params.get('q') || '',
    isLoggedIn: authenticated,
    guestViewLimit: 0,
    registrationUrl: 'https://www.sachyhoc.com/dangky/',
    accountUrl: 'https://www.sachyhoc.com/tai-khoan/',
    logoutUrl: 'medref://logout',
    androidOffline: true,
    dataVersion
  };
  window.NAH_ICD10 = {
    version: dataVersion,
    restUrl: icdBase,
    nonce: '',
    webappUrl: origin + '/medipharm/?view=icd',
    manifestUrl: '',
    serviceWorkerUrl: '',
    pwaEnabled: false,
    dockReady: true,
    androidOffline: true
  };
  window.MTP_CONFIG = {
    restBase: mtpBase,
    restNonce: '',
    homeUrl: origin + '/medipharm/',
    appUrl: origin + '/medipharm/?view=protocols',
    procedureUrl: origin + '/medipharm/?view=procedures',
    initialContentType: params.get('view') === 'procedures' ? 'procedure' : 'protocol',
    appRoot: origin + '/medipharm/',
    initialProtocol: params.get('protocol') || '',
    icdUrl: origin + '/medipharm/?view=icd',
    version: appVersion,
    brand: 'THƯ VIỆN MEDIPHARM',
    swUrl: '',
    swScope: '/medipharm/',
    manifestUrl: '',
    embedded: true,
    draftPreview: false,
    isLoggedIn: authenticated,
    guestViewLimit: 0,
    registrationUrl: 'https://www.sachyhoc.com/dangky/',
    accountUrl: 'https://www.sachyhoc.com/tai-khoan/',
    logoutUrl: 'medref://logout',
    androidOffline: true,
    dataVersion
  };

  // WebView interception cannot inspect a POST body. Convert the one local
  // POST endpoint used by the ICD checker to an equivalent local GET request.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    let url = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    if (method === 'POST' && url.startsWith(icdBase) && /\/check-primary(?:\?|$)/.test(url)) {
      let body = {};
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {}); } catch (_) {}
      const u = new URL(url, origin);
      ['code','gender','record_type'].forEach(k => { if (body && body[k] != null) u.searchParams.set(k, String(body[k])); });
      const nextInit = Object.assign({}, init, {method: 'GET'});
      delete nextInit.body;
      return nativeFetch(u.href, nextInit);
    }
    return nativeFetch(input, init);
  };

  document.addEventListener('DOMContentLoaded', () => {
    const install = document.getElementById('mcr-install');
    if (install) install.remove();
    document.querySelectorAll('[data-icd10-install]').forEach(el => el.remove());

    const menu = document.getElementById('mcr-menu-panel');
    if (menu) {
      const home = menu.querySelector('a.mcr-menu-item');
      if (home) { home.href = origin + '/medipharm/'; home.querySelector('span:last-child').textContent = 'Trang chủ MedRef'; }
      const add = (href, icon, label) => {
        const a = document.createElement('a');
        a.className = 'mcr-menu-item'; a.href = href; a.setAttribute('role','menuitem');
        a.innerHTML = '<span class="mcr-menu-icon" aria-hidden="true">'+icon+'</span><span>'+label+'</span>';
        menu.appendChild(a);
      };
      add('medref://data-update','↻','Cập nhật dữ liệu');
      add('medref://check-update','⇩','Kiểm tra phiên bản mới');
      add('medref://rollback-data','↶','Khôi phục dữ liệu trước');
      add('medref://about','ⓘ','Giới thiệu MedRef');
      if (authenticated) add('medref://logout','↪','Đăng xuất');
    }

    document.querySelectorAll('[data-mcr-login-open]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); location.href='medref://login'; }, true);
    });
    document.querySelectorAll('a[href*="/tai-khoan"], .nah-icd10-account-action').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); location.href='https://www.sachyhoc.com/tai-khoan/'; }, true);
    });
    document.documentElement.dataset.medrefAndroid = '1';
  });
})();
