// ==UserScript==
// @name         Lee-Su-Threads (你是誰)
// @namespace    https://github.com/user/lee-su-threads
// @version      0.2.1
// @description  自動顯示 Threads 貼文作者的地點資訊 - Mobile compatible userscript for Tampermonkey/Violentmonkey/Userscripts
// @author       Lee-Su-Threads
// @match        https://www.threads.net/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @run-at       document-idle
// @license      MIT
// @noframes
// ==/UserScript==

(function() {
  'use strict';

  // ========== CONFIGURATION ==========
  const CONFIG = {
    FETCH_DELAY_MS: 800,
    INITIAL_DELAY_MS: 2000,
    RATE_LIMIT_COOLDOWN_MS: 5 * 60 * 1000,
    MAX_QUEUE_SIZE: 5,
    VISIBILITY_DELAY_MS: 500,
    PROFILE_CACHE_MAX_AGE: 24 * 60 * 60 * 1000, // 24 hours
    USER_ID_CACHE_MAX_AGE: 30 * 24 * 60 * 60 * 1000 // 30 days
  };

  // ========== STORAGE HELPERS ==========
  // Support both GM_ (Tampermonkey/Violentmonkey sync API) and GM. (async API) and localStorage fallback
  const Storage = {
    _useGM: typeof GM_getValue === 'function',
    _useGMAsync: typeof GM !== 'undefined' && typeof GM.getValue === 'function',

    get: (key, defaultValue = null) => {
      try {
        // Try GM_getValue (sync API - Tampermonkey/Violentmonkey)
        if (Storage._useGM) {
          const val = GM_getValue(key, null);
          return val !== null ? JSON.parse(val) : defaultValue;
        }
        // Fallback to localStorage
        const val = localStorage.getItem('lee-su-threads-' + key);
        return val !== null ? JSON.parse(val) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    },

    set: (key, value) => {
      try {
        const str = JSON.stringify(value);
        // Try GM_setValue (sync API - Tampermonkey/Violentmonkey)
        if (Storage._useGM) {
          GM_setValue(key, str);
          return;
        }
        // Fallback to localStorage
        localStorage.setItem('lee-su-threads-' + key, str);
      } catch (e) {
        console.error('[Lee-Su-Threads] Storage error:', e);
      }
    },

    // Async versions for GM. API (some userscript managers)
    getAsync: async (key, defaultValue = null) => {
      try {
        if (Storage._useGMAsync) {
          const val = await GM.getValue(key, null);
          return val !== null ? JSON.parse(val) : defaultValue;
        }
        return Storage.get(key, defaultValue);
      } catch (e) {
        return defaultValue;
      }
    },

    setAsync: async (key, value) => {
      try {
        const str = JSON.stringify(value);
        if (Storage._useGMAsync) {
          await GM.setValue(key, str);
          return;
        }
        Storage.set(key, value);
      } catch (e) {
        console.error('[Lee-Su-Threads] Storage error:', e);
      }
    }
  };

  // ========== STATE ==========
  const profileCache = new Map();
  const userIdMap = new Map();
  const fetchQueue = [];
  const pendingVisibility = new Map();
  let isFetching = false;
  let autoFetchReady = false;
  let rateLimitedUntil = 0;
  let sessionTokens = null;

  // ========== STYLES ==========
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* Fetch info button */
      .threads-fetch-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        margin-left: 4px;
        padding: 0;
        background: rgba(102, 126, 234, 0.2);
        border: 1px solid rgba(102, 126, 234, 0.3);
        border-radius: 50%;
        cursor: pointer;
        font-size: 12px;
        vertical-align: middle;
        transition: all 0.2s;
        -webkit-tap-highlight-color: transparent;
      }

      .threads-fetch-btn:hover:not(:disabled),
      .threads-fetch-btn:active:not(:disabled) {
        background: rgba(102, 126, 234, 0.4);
        border-color: rgba(102, 126, 234, 0.6);
      }

      .threads-fetch-btn:disabled {
        cursor: not-allowed;
        opacity: 0.7;
      }

      /* Rate limit toast */
      #threads-rate-limit-toast {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 12px 20px;
        background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        z-index: 9999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        max-width: 90vw;
        animation: slideUp 0.3s ease-out;
      }

      @keyframes slideUp {
        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }

      #threads-rate-limit-toast button {
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
      }

      #threads-resume-btn {
        background: white;
        color: #ee5a5a;
      }

      #threads-dismiss-toast {
        background: rgba(255, 255, 255, 0.2);
        color: white;
        padding: 6px 8px;
      }

      /* Profile info badge */
      .threads-profile-info-badge {
        display: inline-block;
        margin-left: 6px;
        padding: 2px 8px;
        background: rgba(102, 126, 234, 0.15);
        border-radius: 12px;
        font-size: 12px;
        color: #a0a0a0;
        vertical-align: middle;
        cursor: default;
      }

      @media (prefers-color-scheme: light) {
        .threads-profile-info-badge {
          background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
          color: #333;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ========== LOGGING HELPERS ==========
  function log(...args) {
    console.log('[Lee-Su-Threads]', ...args);
  }

  function logWarn(...args) {
    console.warn('[Lee-Su-Threads]', ...args);
  }

  // ========== SESSION TOKENS ==========
  function captureSessionTokens(bodyParsed) {
    if (bodyParsed && bodyParsed.fb_dtsg) {
      sessionTokens = {
        fb_dtsg: bodyParsed.fb_dtsg,
        lsd: bodyParsed.lsd,
        jazoest: bodyParsed.jazoest,
        __user: bodyParsed.__user,
        __a: bodyParsed.__a,
        __hs: bodyParsed.__hs,
        __dyn: bodyParsed.__dyn,
        __csr: bodyParsed.__csr,
        __comet_req: bodyParsed.__comet_req,
        __ccg: bodyParsed.__ccg,
        __rev: bodyParsed.__rev,
        __s: bodyParsed.__s,
        __hsi: bodyParsed.__hsi,
        __spin_r: bodyParsed.__spin_r,
        __spin_b: bodyParsed.__spin_b,
        __spin_t: bodyParsed.__spin_t,
        dpr: bodyParsed.dpr,
        __d: bodyParsed.__d
      };
      log('Session tokens captured!');
    }
  }

  // ========== USER ID MANAGEMENT ==========
  function addUserId(username, userId, source = '') {
    if (!userIdMap.has(username)) {
      userIdMap.set(username, userId);
      // Persist to storage
      const cached = Storage.get('userIdCache', {});
      cached[username] = { userId, timestamp: Date.now() };
      Storage.set('userIdCache', cached);
      if (source) {
        log(`Found user (${source}): @${username} -> ${userId}`);
      }
      return true;
    }
    return false;
  }

  function extractUserIds(obj, source = 'unknown') {
    if (!obj || typeof obj !== 'object') return;

    if (obj.id && obj.username) {
      const userId = String(obj.id);
      const username = String(obj.username);
      if (userId.match(/^\d+$/) && username.match(/^[\w.]+$/)) {
        addUserId(username, userId, 'id');
      }
    }

    if (obj.pk && obj.username) {
      const userId = String(obj.pk);
      const username = String(obj.username);
      if (userId.match(/^\d+$/) && username.match(/^[\w.]+$/)) {
        addUserId(username, userId, 'pk');
      }
    }

    if (obj.user && typeof obj.user === 'object') {
      const user = obj.user;
      const userId = String(user.pk || user.id || '');
      const username = String(user.username || '');
      if (userId.match(/^\d+$/) && username.match(/^[\w.]+$/)) {
        addUserId(username, userId, 'nested');
      }
    }

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (Array.isArray(value)) {
        value.forEach(item => extractUserIds(item, source));
      } else if (typeof value === 'object' && value !== null) {
        extractUserIds(value, source);
      }
    }
  }

  // ========== PROFILE PARSING ==========
  function parseProfileResponse(responseText) {
    try {
      let jsonStr = responseText;
      if (jsonStr.startsWith('for (;;);')) {
        jsonStr = jsonStr.substring(9);
      }
      const data = JSON.parse(jsonStr);
      return extractProfileInfo(data);
    } catch (e) {
      console.error('[Lee-Su-Threads] Failed to parse response:', e);
      return null;
    }
  }

  function extractProfileInfo(obj, result = {}) {
    if (!obj || typeof obj !== 'object') return result;

    if (result._pairs === undefined) {
      result._pairs = [];
      result._currentLabel = null;
    }

    if (obj['bk.components.Text']) {
      const textComp = obj['bk.components.Text'];
      const text = textComp.text;
      const style = textComp.text_style;

      if (style === 'semibold' && text) {
        result._currentLabel = text;
      } else if (style === 'normal' && text && result._currentLabel) {
        result._pairs.push({ label: result._currentLabel, value: text });
        result._currentLabel = null;
      }
    }

    if (obj['bk.components.RichText']) {
      const children = obj['bk.components.RichText'].children || [];
      let fullText = '';
      for (const child of children) {
        if (child['bk.components.TextSpan']) {
          fullText += child['bk.components.TextSpan'].text || '';
        }
      }
      let match = fullText.match(/^(.+?)\s*[（(]@([\w.]+)[)）]$/);
      if (!match) {
        match = fullText.match(/^(.+?)\s*[（(]@([\w.]+)/);
      }
      if (!match) {
        match = fullText.match(/@([\w.]+)/);
        if (match) {
          result.username = match[1];
          const nameMatch = fullText.match(/^(.+?)\s*[（(]@/);
          if (nameMatch) {
            result.displayName = nameMatch[1].trim();
          }
        }
      }
      if (match && match[2]) {
        result.displayName = match[1]?.trim();
        result.username = match[2];
      }
    }

    if (obj['bk.components.Image']) {
      const url = obj['bk.components.Image'].url;
      if (url && url.includes('cdninstagram.com')) {
        result.profileImage = url;
      }
    }

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          extractProfileInfo(item, result);
        }
      } else if (typeof value === 'object' && value !== null) {
        extractProfileInfo(value, result);
      }
    }

    if (result._pairs && result._pairs.length >= 2 && !result._pairsProcessed) {
      result._pairsProcessed = true;
      const pairs = result._pairs;
      let joinedRaw = pairs[0].value;
      result.joined = joinedRaw.split(/\s*[·•]\s*/)[0].trim();
      result.location = pairs[1].value;
    }

    return result;
  }

  // ========== FETCH INTERCEPTOR ==========
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = args[0]?.url || args[0];
    const options = args[1] || {};

    // Capture session tokens
    if (options.body) {
      try {
        let bodyParsed = null;
        if (options.body instanceof URLSearchParams) {
          bodyParsed = Object.fromEntries(options.body.entries());
        } else if (typeof options.body === 'string' && !options.body.startsWith('{')) {
          bodyParsed = Object.fromEntries(new URLSearchParams(options.body).entries());
        }
        if (bodyParsed) {
          captureSessionTokens(bodyParsed);
        }
      } catch (e) { /* ignore */ }
    }

    const response = await originalFetch.apply(this, args);

    // Extract user IDs from responses
    if (typeof url === 'string') {
      try {
        const clone = response.clone();
        const text = await clone.text();
        let jsonStr = text;
        if (jsonStr.startsWith('for (;;);')) {
          jsonStr = jsonStr.substring(9);
        }
        if (jsonStr.startsWith('{') || jsonStr.startsWith('[')) {
          const data = JSON.parse(jsonStr);

          // Handle bulk-route-definitions
          if (url.includes('bulk-route-definitions')) {
            log('🎯 Intercepted bulk-route-definitions!');
            if (data.payload?.payloads) {
              const beforeCount = userIdMap.size;
              for (const [routeKey, routeData] of Object.entries(data.payload.payloads)) {
                let decodedKey = routeKey;
                try {
                  decodedKey = JSON.parse(`"${routeKey}"`);
                } catch (e) {}

                const usernameMatch = decodedKey.match(/^\/@([\w.]+)/);
                if (usernameMatch) {
                  const username = usernameMatch[1];
                  const userId = routeData.result?.exports?.rootView?.props?.user_id
                              || routeData.result?.exports?.hostableView?.props?.user_id;
                  if (userId) {
                    addUserId(username, String(userId), 'route');
                  }
                }
              }
              const afterCount = userIdMap.size;
              if (afterCount > beforeCount) {
                log(`🎯 bulk-route-definitions: Found ${afterCount - beforeCount} NEW user(s)`);
              }
            }
          }

          extractUserIds(data, url);
        }
      } catch (e) { /* not JSON */ }
    }

    // Handle about_this_profile
    if (typeof url === 'string' && url.includes('about_this_profile_async_action')) {
      try {
        const clone = response.clone();
        const text = await clone.text();
        const profileInfo = parseProfileResponse(text);
        if (profileInfo && profileInfo.username) {
          delete profileInfo._pairs;
          delete profileInfo._currentLabel;
          delete profileInfo._pairsProcessed;
          log('Extracted profile info:', profileInfo);
          handleProfileExtracted(profileInfo);
        }
      } catch (e) {
        console.error('[Lee-Su-Threads] Error processing response:', e);
      }
    }

    return response;
  };

  // ========== XHR INTERCEPTOR ==========
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._threadsUrl = url;
    this._threadsMethod = method;
    this._threadsHeaders = {};
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (this._threadsHeaders) {
      this._threadsHeaders[name] = value;
    }
    return originalXHRSetRequestHeader.apply(this, [name, value]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    const xhrUrl = this._threadsUrl;

    if (xhrUrl && xhrUrl.includes('bulk-route-definitions')) {
      this.addEventListener('load', function() {
        try {
          log('🎯 Intercepted bulk-route-definitions (XHR)!');
          let jsonStr = this.responseText;
          if (jsonStr.startsWith('for (;;);')) {
            jsonStr = jsonStr.substring(9);
          }
          const data = JSON.parse(jsonStr);
          if (data.payload?.payloads) {
            const beforeCount = userIdMap.size;
            for (const [routeKey, routeData] of Object.entries(data.payload.payloads)) {
              let decodedKey = routeKey;
              try {
                decodedKey = JSON.parse(`"${routeKey}"`);
              } catch (e) {}

              const usernameMatch = decodedKey.match(/^\/@([\w.]+)/);
              if (usernameMatch) {
                const username = usernameMatch[1];
                const userId = routeData.result?.exports?.rootView?.props?.user_id
                            || routeData.result?.exports?.hostableView?.props?.user_id;
                if (userId) {
                  addUserId(username, String(userId), 'route-xhr');
                }
              }
            }
            const afterCount = userIdMap.size;
            if (afterCount > beforeCount) {
              log(`🎯 bulk-route-definitions (XHR): Found ${afterCount - beforeCount} NEW user(s)`);
            }
          }
        } catch (e) {
          console.error('[Lee-Su-Threads] Error processing bulk-route-definitions:', e);
        }
      });
    }

    if (xhrUrl && xhrUrl.includes('about_this_profile_async_action')) {
      this.addEventListener('load', function() {
        try {
          const profileInfo = parseProfileResponse(this.responseText);
          if (profileInfo && profileInfo.username) {
            delete profileInfo._pairs;
            delete profileInfo._currentLabel;
            delete profileInfo._pairsProcessed;
            log('Extracted profile info (XHR):', profileInfo);
            handleProfileExtracted(profileInfo);
          }
        } catch (e) {
          console.error('[Lee-Su-Threads] Error processing XHR response:', e);
        }
      });
    }
    return originalXHRSend.apply(this, args);
  };

  // ========== FETCH PROFILE INFO ==========
  async function fetchProfileInfo(targetUserId) {
    if (!sessionTokens) {
      logWarn('No session tokens available. Browse the feed first.');
      return null;
    }

    const url = '/async/wbloks/fetch/?appid=com.bloks.www.text_post_app.about_this_profile_async_action&type=app&__bkv=22713cafbb647b89c4e9c1acdea97d89c8c2046e2f4b18729760e9b1ae0724f7';

    const params = new URLSearchParams();
    params.append('__user', sessionTokens.__user || '0');
    params.append('__a', sessionTokens.__a || '1');
    params.append('__req', 'ext_' + Math.random().toString(36).substring(7));
    params.append('__hs', sessionTokens.__hs || '');
    params.append('dpr', sessionTokens.dpr || '2');
    params.append('__ccg', sessionTokens.__ccg || 'UNKNOWN');
    params.append('__rev', sessionTokens.__rev || '');
    params.append('__s', sessionTokens.__s || '');
    params.append('__hsi', sessionTokens.__hsi || '');
    params.append('__dyn', sessionTokens.__dyn || '');
    params.append('__csr', sessionTokens.__csr || '');
    params.append('__comet_req', sessionTokens.__comet_req || '29');
    params.append('fb_dtsg', sessionTokens.fb_dtsg || '');
    params.append('jazoest', sessionTokens.jazoest || '');
    params.append('lsd', sessionTokens.lsd || '');
    params.append('__spin_r', sessionTokens.__spin_r || '');
    params.append('__spin_b', sessionTokens.__spin_b || 'trunk');
    params.append('__spin_t', sessionTokens.__spin_t || '');
    params.append('params', JSON.stringify({
      atpTriggerSessionID: crypto.randomUUID(),
      referer_type: 'TextPostAppProfileOverflow',
      target_user_id: String(targetUserId)
    }));
    params.append('__d', sessionTokens.__d || 'www');

    log('Fetching profile info for user ID:', targetUserId);

    try {
      const response = await originalFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
        credentials: 'include'
      });

      if (response.status === 429) {
        logWarn('⚠️ Rate limited (429)!');
        rateLimitedUntil = Date.now() + CONFIG.RATE_LIMIT_COOLDOWN_MS;
        showRateLimitToast();
        return { _rateLimited: true };
      }

      const text = await response.text();
      const profileInfo = parseProfileResponse(text);

      if (profileInfo && !profileInfo.username) {
        for (const [uname, uid] of userIdMap.entries()) {
          if (uid === String(targetUserId)) {
            profileInfo.username = uname;
            log(`Resolved username from map: @${uname}`);
            break;
          }
        }
      }

      if (profileInfo && (profileInfo.username || profileInfo.joined || profileInfo.location)) {
        delete profileInfo._pairs;
        delete profileInfo._currentLabel;
        delete profileInfo._pairsProcessed;
        if (!profileInfo.username) {
          profileInfo.username = `user_${targetUserId}`;
          profileInfo._userIdOnly = true;
        }
        log('Fetched profile info:', profileInfo);
        handleProfileExtracted(profileInfo);
        return profileInfo;
      }
    } catch (e) {
      console.error('[Lee-Su-Threads] Error fetching profile info:', e);
    }

    return null;
  }

  // ========== PROFILE HANDLING ==========
  function handleProfileExtracted(profileInfo) {
    if (profileInfo && profileInfo.username) {
      profileCache.set(profileInfo.username, profileInfo);

      // Persist to storage
      const cached = Storage.get('profileCache', {});
      cached[profileInfo.username] = {
        ...profileInfo,
        timestamp: Date.now()
      };
      Storage.set('profileCache', cached);

      displayProfileInfo(profileInfo);
    }
  }

  // ========== UI FUNCTIONS ==========
  function showRateLimitToast() {
    const existing = document.getElementById('threads-rate-limit-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'threads-rate-limit-toast';
    toast.innerHTML = `
      <span>⚠️ 地點查詢太多次，被 Threads 限制了，5 分鐘內不會自動查</span>
      <button id="threads-resume-btn">繼續自動查詢</button>
      <button id="threads-dismiss-toast">✕</button>
    `;
    document.body.appendChild(toast);

    document.getElementById('threads-resume-btn').addEventListener('click', () => {
      rateLimitedUntil = 0;
      toast.remove();
      log('User resumed auto-fetch manually.');
      processFetchQueue();
    });

    document.getElementById('threads-dismiss-toast').addEventListener('click', () => {
      toast.remove();
    });

    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
    }, CONFIG.RATE_LIMIT_COOLDOWN_MS);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function createProfileBadge(profileInfo) {
    const badge = document.createElement('span');
    badge.className = 'threads-profile-info-badge';

    if (profileInfo.location) {
      badge.innerHTML = `📍 ${escapeHtml(profileInfo.location)}`;
      badge.title = `Joined: ${profileInfo.joined || 'Unknown'}`;
    } else {
      badge.innerHTML = `🌐 N/A`;
      badge.title = profileInfo.joined ? `Joined: ${profileInfo.joined}` : 'Location not available';
    }

    return badge;
  }

  function displayProfileInfo(profileInfo) {
    const username = profileInfo.username;
    const buttons = document.querySelectorAll(`.threads-fetch-btn[data-username="${username}"]`);

    buttons.forEach(btn => {
      if (btn.previousElementSibling?.classList?.contains('threads-profile-info-badge')) return;

      const badge = createProfileBadge(profileInfo);
      btn.parentElement?.insertBefore(badge, btn);
      btn.style.display = 'none';
    });
  }

  // ========== AUTO-FETCH QUEUE ==========
  async function autoFetchProfile(username, btn) {
    if (profileCache.has(username)) {
      const cached = profileCache.get(username);
      displayProfileInfo(cached);
      btn.style.display = 'none';
      return;
    }

    const userId = userIdMap.get(username);
    if (!userId) {
      btn.innerHTML = '❓';
      btn.title = 'User ID not found. Click to retry.';
      btn.disabled = false;
      return;
    }

    const result = await fetchProfileInfo(userId);
    if (result) {
      if (result._rateLimited) {
        btn.innerHTML = '🔄';
        btn.title = 'Rate limited. Click to retry later.';
        btn.disabled = false;
      } else {
        btn.style.display = 'none';
      }
    } else {
      btn.innerHTML = '🔄';
      btn.title = 'Failed to load. Click to retry.';
      btn.disabled = false;
    }
  }

  async function processFetchQueue() {
    if (isFetching || fetchQueue.length === 0) return;

    if (Date.now() < rateLimitedUntil) {
      log('Rate limit cooldown active. Skipping queue processing.');
      return;
    }

    isFetching = true;

    while (fetchQueue.length > 0) {
      if (Date.now() < rateLimitedUntil) {
        log('Rate limit triggered. Stopping queue processing.');
        break;
      }

      const { username, btn } = fetchQueue.shift();
      log(`Processing @${username}, queue length: ${fetchQueue.length}`);

      if (profileCache.has(username)) {
        const cached = profileCache.get(username);
        displayProfileInfo(cached);
        btn.style.display = 'none';
        continue;
      }

      btn.innerHTML = '⏳';
      await autoFetchProfile(username, btn);

      if (fetchQueue.length > 0) {
        await new Promise(r => setTimeout(r, CONFIG.FETCH_DELAY_MS));
      }
    }

    isFetching = false;
  }

  function queueAutoFetch(username, btn) {
    if (profileCache.has(username)) return;

    const existingIndex = fetchQueue.findIndex(item => item.username === username);
    if (existingIndex !== -1) {
      const existing = fetchQueue.splice(existingIndex, 1)[0];
      fetchQueue.unshift(existing);
      return;
    }

    fetchQueue.unshift({ username, btn });

    while (fetchQueue.length > CONFIG.MAX_QUEUE_SIZE) {
      const removed = fetchQueue.pop();
      if (removed && removed.btn) {
        visibilityObserver.observe(removed.btn);
      }
    }

    if (autoFetchReady) {
      processFetchQueue();
    }
  }

  // ========== VISIBILITY OBSERVER ==========
  const visibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const btn = entry.target;
      const username = btn.getAttribute('data-username');
      if (!username) return;

      if (entry.isIntersecting) {
        if (!pendingVisibility.has(username) && !profileCache.has(username)) {
          const timeoutId = setTimeout(() => {
            if (pendingVisibility.has(username)) {
              pendingVisibility.delete(username);
              queueAutoFetch(username, btn);
              visibilityObserver.unobserve(btn);
            }
          }, CONFIG.VISIBILITY_DELAY_MS);
          pendingVisibility.set(username, timeoutId);
        }
      } else {
        if (pendingVisibility.has(username)) {
          clearTimeout(pendingVisibility.get(username));
          pendingVisibility.delete(username);
        }
      }
    });
  }, { threshold: 0.1 });

  // ========== DOM MANIPULATION ==========
  function findPostContainer(element) {
    let current = element;
    let depth = 0;
    const maxDepth = 15;

    while (current && depth < maxDepth) {
      if (current.getAttribute &&
          (current.getAttribute('data-pressable-container') === 'true' ||
           current.classList?.contains('x1lliihq') ||
           current.tagName === 'ARTICLE')) {
        return current;
      }
      current = current.parentElement;
      depth++;
    }

    return null;
  }

  function addFetchButtons() {
    const timeElements = document.querySelectorAll('time:not([data-threads-info-added])');

    timeElements.forEach(timeEl => {
      timeEl.setAttribute('data-threads-info-added', 'true');

      const postContainer = findPostContainer(timeEl);
      if (!postContainer) return;

      if (postContainer.querySelector('.threads-fetch-btn')) return;

      const profileLink = postContainer.querySelector('a[href^="/@"]');
      if (!profileLink) return;

      const href = profileLink.getAttribute('href');
      const match = href.match(/^\/@([\w.]+)/);
      if (!match) return;

      const username = match[1];

      if (profileCache.has(username) && postContainer.querySelector('.threads-profile-info-badge')) return;

      const btn = document.createElement('button');
      btn.className = 'threads-fetch-btn';
      btn.innerHTML = 'ℹ️';
      btn.title = `Get profile info for @${username}`;
      btn.setAttribute('data-username', username);

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        btn.disabled = true;
        btn.innerHTML = '⏳';

        const userId = userIdMap.get(username);

        if (userId) {
          log(`Found user ID for @${username}: ${userId}`);
          const result = await fetchProfileInfo(userId);

          if (result) {
            btn.style.display = 'none';
          } else {
            btn.innerHTML = '🔄';
            btn.title = 'Failed to load. Click to retry.';
            btn.disabled = false;
          }
        } else {
          log(`Could not find user ID for @${username}`);
          btn.innerHTML = '❓';
          btn.title = 'User ID not found. Try scrolling or clicking on their profile first.';
          btn.disabled = false;
        }
      });

      const timeParent = timeEl.closest('span') || timeEl.parentElement;
      if (timeParent) {
        timeParent.parentElement?.insertBefore(btn, timeParent.nextSibling);
        visibilityObserver.observe(btn);
      }
    });
  }

  // ========== PAGE SCANNING ==========
  function scanPageForSessionTokens() {
    log('🔑 Scanning page for session tokens...');

    const html = document.documentElement.innerHTML;

    const patterns = {
      fb_dtsg: [
        /"fb_dtsg"\s*:\s*"([^"]+)"/,
        /name="fb_dtsg"\s+value="([^"]+)"/,
        /"DTSGInitialData"[^}]*"token"\s*:\s*"([^"]+)"/,
        /\["DTSGInitData",\[\],\{"token":"([^"]+)"/
      ],
      lsd: [
        /"lsd"\s*:\s*"([^"]+)"/,
        /name="lsd"\s+value="([^"]+)"/,
        /"LSD"[^}]*"token"\s*:\s*"([^"]+)"/
      ],
      jazoest: [
        /"jazoest"\s*:\s*"?(\d+)"?/,
        /name="jazoest"\s+value="(\d+)"/
      ]
    };

    const foundTokens = {};

    for (const [tokenName, regexList] of Object.entries(patterns)) {
      for (const regex of regexList) {
        const match = html.match(regex);
        if (match) {
          foundTokens[tokenName] = match[1];
          log(`  Found ${tokenName}`);
          break;
        }
      }
    }

    const scripts = document.querySelectorAll('script:not([src])');
    scripts.forEach((script) => {
      const content = script.textContent || '';

      const dtsgMatch = content.match(/\["DTSGInitData",\[\],\{"token":"([^"]+)"/);
      if (dtsgMatch && !foundTokens.fb_dtsg) {
        foundTokens.fb_dtsg = dtsgMatch[1];
        log('  Found fb_dtsg from DTSGInitData');
      }

      const lsdMatch = content.match(/\["LSD",\[\],\{"token":"([^"]+)"/);
      if (lsdMatch && !foundTokens.lsd) {
        foundTokens.lsd = lsdMatch[1];
        log('  Found lsd from LSD');
      }
    });

    if (foundTokens.fb_dtsg) {
      sessionTokens = {
        ...sessionTokens,
        fb_dtsg: foundTokens.fb_dtsg,
        lsd: foundTokens.lsd || sessionTokens?.lsd || '',
        jazoest: foundTokens.jazoest || sessionTokens?.jazoest || '',
        __user: sessionTokens?.__user || '0',
        __a: sessionTokens?.__a || '1',
        __comet_req: sessionTokens?.__comet_req || '29',
        __d: sessionTokens?.__d || 'www'
      };
      log('  ✅ Session tokens updated from page!');
    }

    return foundTokens;
  }

  function scanPageForUserIds() {
    log('🔎 Scanning page for embedded user data...');
    const beforeCount = userIdMap.size;

    const jsonScripts = document.querySelectorAll('script[type="application/json"]');

    jsonScripts.forEach((script, i) => {
      const content = script.textContent || '';
      if (content.includes('"pk"') || content.includes('"username"') || content.includes('"user"')) {
        try {
          const data = JSON.parse(content);
          extractUserIds(data, `json-script#${i}`);
        } catch (e) {
          const pkMatches = [...content.matchAll(/"pk"\s*:\s*"(\d+)"/g)];
          const usernameMatches = [...content.matchAll(/"username"\s*:\s*"([\w.]+)"/g)];

          for (const pkMatch of pkMatches) {
            const pkIndex = pkMatch.index;
            const pk = pkMatch[1];
            for (const userMatch of usernameMatches) {
              const userIndex = userMatch.index;
              const username = userMatch[1];
              if (Math.abs(userIndex - pkIndex) < 500) {
                addUserId(username, pk, 'regex');
                break;
              }
            }
          }
        }
      }
    });

    const inlineScripts = document.querySelectorAll('script:not([src]):not([type])');
    inlineScripts.forEach((script) => {
      const content = script.textContent || '';
      if (content.includes('"pk"') && content.includes('"username"')) {
        const pkMatches = [...content.matchAll(/"pk"\s*:\s*"(\d+)"/g)];
        const usernameMatches = [...content.matchAll(/"username"\s*:\s*"([\w.]+)"/g)];

        for (const pkMatch of pkMatches) {
          const pk = pkMatch[1];
          const pkIndex = pkMatch.index;
          for (const userMatch of usernameMatches) {
            const username = userMatch[1];
            const userIndex = userMatch.index;
            if (Math.abs(userIndex - pkIndex) < 500) {
              addUserId(username, pk, 'inline');
              break;
            }
          }
        }
      }
    });

    const afterCount = userIdMap.size;
    log(`📊 Total users discovered: ${afterCount} (${afterCount - beforeCount} new)`);
  }

  // ========== CACHE LOADING ==========
  function loadCachedData() {
    // Load profile cache
    const cachedProfiles = Storage.get('profileCache', {});
    const now = Date.now();
    for (const [username, data] of Object.entries(cachedProfiles)) {
      if (now - data.timestamp < CONFIG.PROFILE_CACHE_MAX_AGE) {
        profileCache.set(username, data);
      }
    }
    log(`Loaded ${profileCache.size} cached profiles`);

    // Load user ID cache
    const cachedUserIds = Storage.get('userIdCache', {});
    for (const [username, data] of Object.entries(cachedUserIds)) {
      if (now - data.timestamp < CONFIG.USER_ID_CACHE_MAX_AGE) {
        userIdMap.set(username, data.userId);
      }
    }
    log(`Loaded ${userIdMap.size} cached user IDs`);
  }

  // ========== OBSERVER ==========
  function observeFeed() {
    const observer = new MutationObserver((mutations) => {
      clearTimeout(observer._timeout);
      observer._timeout = setTimeout(() => {
        addFetchButtons();
      }, 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ========== INITIALIZATION ==========
  function init() {
    log('🚀 Lee-Su-Threads userscript loaded');

    // Inject styles
    injectStyles();

    // Load cached data
    loadCachedData();

    // Add fetch buttons to existing posts
    setTimeout(addFetchButtons, 1000);

    // Observe for new posts
    observeFeed();

    // Scan page for initial data
    setTimeout(() => {
      scanPageForSessionTokens();
      scanPageForUserIds();
    }, 1000);

    // Enable auto-fetch after initial delay
    setTimeout(() => {
      autoFetchReady = true;
      log('Auto-fetch enabled');
      processFetchQueue();
    }, CONFIG.INITIAL_DELAY_MS);
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
