/* =====================================================================
 * inaka 的工作台 — 数据层
 * 职责：状态管理、localStorage 持久化、jsonbin.io 加密同步
 * 纯原生 JS，无依赖。通过全局对象 Store 暴露给 UI 层。
 * ===================================================================== */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'inaka_workbench_state_v1';
  var SETTINGS_KEY = 'inaka_workbench_settings_v1';

  // 打卡默认项（固定 id，载入时自动补齐；用户主动移除后记入 removedDefaults 不再补）
  var HABIT_DEFAULTS = [
    { id: 'def_walk', name: '散步', def: true },
    { id: 'def_sport', name: '运动', def: true },
    { id: 'def_meal', name: '自制餐', def: true },
    { id: 'def_sleep', name: '早睡（11点前）', def: true }
  ];

  /* ---------- 默认状态结构（兼容现有备份 + 新增板块） ---------- */
  function defaultState() {
    return {
      // 聚焦：{ "2026-08-10": [{id, text, done}] }
      focus: {},
      // 待办
      todo: [],
      // 项目
      project: [],
      // 沉淀（摘抄/笔记）
      notes: [],
      // 打卡
      habit: { items: clone(HABIT_DEFAULTS), punch: {}, removedDefaults: [] },
      // 战略
      strategy: [],
      // 人脉
      contacts: [],
      // 理财
      finance: { accounts: [], records: [], budgets: [] },
      // 复盘
      review: [],
      // 元信息
      _meta: { lastWrite: 0, lastSync: 0, lastPage: 'focus' }
    };
  }

  /* ---------- 工具 ---------- */
  function uid() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function todayStr(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }
  function clone(o) { return (o === undefined || o === null) ? o : JSON.parse(JSON.stringify(o)); }

  /* ---------- 从旧版备份迁移 ---------- */
  // 旧备份 data 是扁平键：focus:<date>, habit:items, habit:punch:<date>, todo, project, notes
  function migrateFromBackup(backup) {
    var data = (backup && backup.data) ? backup.data : backup;
    var s = defaultState();
    try {
      // focus（habit:punch 旧格式语义不清，重新打卡即可，不迁移）
      Object.keys(data).forEach(function (k) {
        if (k.indexOf('focus:') === 0) {
          var date = k.slice(6);
          s.focus[date] = data[k] || [];
        }
      });
      if (Array.isArray(data['habit:items'])) s.habit.items = data['habit:items'];
      if (Array.isArray(data.todo)) s.todo = data.todo;
      if (Array.isArray(data.project)) s.project = data.project;
      if (Array.isArray(data.notes)) s.notes = data.notes;
      if (data._lastPage) s._meta.lastPage = data._lastPage;
      s._meta.lastWrite = data._lastWrite || Date.now();
    } catch (e) {
      console.error('迁移失败，使用空状态', e);
    }
    return s;
  }

  /* ---------- 状态读写 ---------- */
  var state = defaultState();

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        // 合并默认，防止缺字段
        state = Object.assign(defaultState(), parsed);
        state.habit = Object.assign({ items: [], punch: {}, removedDefaults: [] }, parsed.habit || {});
        // 打卡默认项：确保 4 个默认打卡存在（除非用户主动移除过）
        (function seedHabitDefaults() {
          var removed = state.habit.removedDefaults || [];
          HABIT_DEFAULTS.forEach(function (d) {
            if (removed.indexOf(d.id) >= 0) return;
            if (!state.habit.items.some(function (x) { return x.id === d.id; })) {
              state.habit.items.push(clone(d));
            }
          });
        })();
        state.finance = Object.assign({ accounts: [], records: [], budgets: [] }, parsed.finance || {});
        state._meta = Object.assign({ lastWrite: 0, lastSync: 0, lastPage: 'focus' }, parsed._meta || {});
        // 人脉字段归一化：兼容旧格式（tag→tags、memo→timeline），保证新结构所需数组字段齐全
        if (Array.isArray(state.contacts)) {
          state.contacts.forEach(function (c) {
            c.tags = c.tags || (c.tag ? [c.tag] : []);
            c.attrs = c.attrs || [];
            c.channels = c.channels || [];
            c.timeline = c.timeline || (c.memo ? [{ id: uid(), d: '', t: c.memo }] : []);
            c.relations = c.relations || [];
            c.blockedKw = c.blockedKw || [];
            c.location = c.location || '';
            c.brands = c.brands || '';
            c.last = c.last || '';
            c.updatedAt = c.updatedAt || c.created || Date.now();
          });
        }
        // 项目字段归一化：兼容旧格式，补齐卡片化编辑所需字段
        if (Array.isArray(state.project)) {
          state.project.forEach(function (p) {
            p.overview = p.overview || '';
            p.status = p.status || 'doing';
            p.contacts = p.contacts || [];
            p.progress = p.progress || [];
            p.subs = p.subs || [];
            // 客户跟进（CRM 看板）：挂在项目上，可复制到其他项目
            p.customers = p.customers || [];
            p.customers.forEach(function (cu) {
              cu.stage = cu.stage || '跟进中';
              cu.timeline = cu.timeline || [];
              cu.updatedAt = cu.updatedAt || cu.created || Date.now();
            });
            p.created = p.created || Date.now();
            p.updatedAt = p.updatedAt || p.created || Date.now();
            p.subs.forEach(function (sub) {
              sub.summary = sub.summary || '';
              sub.created = sub.created || Date.now();
            });
          });
        }
        // 沉淀字段归一化：兼容旧格式，补齐卡片化/分类所需字段
        if (Array.isArray(state.notes)) {
          state.notes.forEach(function (n) {
            n.type = n.type || 'idea';
            n.tags = n.tags || [];
            if (n.type === 'diary') n.date = n.date || S.todayStr();
            if (n.type === 'kb') { n.sub = n.sub || 'industry'; n.links = n.links || []; n.files = n.files || []; }
            n.created = n.created || Date.now();
            n.updatedAt = n.updatedAt || n.created || Date.now();
          });
        }
        // 成长板块合并到沉淀：旧 growth 数据迁移为「灵感」类沉淀，迁移后清空 growth
        if (Array.isArray(state.growth) && state.growth.length) {
          state.growth.forEach(function (g) {
            state.notes = state.notes || [];
            state.notes.push({
              id: g.id || S.uid(),
              type: 'idea',
              title: g.title || '',
              content: g.title ? (g.content ? g.title + '\n' + g.content : g.title) : (g.content || ''),
              tags: g.tag ? [g.tag] : [],
              created: g.created || Date.now(),
              updatedAt: g.updatedAt || g.created || Date.now()
            });
          });
          state.growth = [];
        }
        return state;
      }
    } catch (e) { console.warn('load failed', e); }
    return state;
  }

  var saveListeners = [];
  function onSave(cb) { if (typeof cb === 'function') saveListeners.push(cb); }
  function save(notify) {
    state._meta.lastWrite = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { console.warn('save failed', e); }
    // 通知 UI 层：本地数据已变更，触发自动推送（notify=false 时不递归）
    if (notify !== false) {
      saveListeners.forEach(function (cb) { try { cb(); } catch (e) {} });
    }
    return state;
  }

  function reset() {
    state = defaultState();
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    return state;
  }

  function getState() { return state; }
  function setState(s) { state = s; save(); return state; }

  /* ---------- 设置（jsonbin API Key / Bin ID / syncPass） ---------- */
  function getSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        // 旧版本（手动填写 Bin ID）迁移：丢弃缓存的 bin/集合 id，强制重新自动发现，
        // 避免沿用旧的各自独立的 bin 导致两端都显示已同步、实际永不互通。
        if (s.syncV !== 2) {
          return { backend: s.backend || 'jsonbin', jsonKey: s.jsonKey || '', jsonBinId: '', jsonCollectionId: '', syncPass: s.syncPass || '', giteeToken: s.giteeToken || '', giteeRepo: s.giteeRepo || '' };
        }
        return {
          backend: s.backend || 'jsonbin',
          jsonKey: s.jsonKey || '',
          jsonBinId: s.jsonBinId || '',
          jsonCollectionId: s.jsonCollectionId || '',
          syncPass: s.syncPass || '',
          giteeToken: s.giteeToken || '',
          giteeRepo: s.giteeRepo || ''
        };
      }
    } catch (e) {}
    return { backend: 'jsonbin', jsonKey: '', jsonBinId: '', jsonCollectionId: '', syncPass: '', giteeToken: '', giteeRepo: '' };
  }
  function setSettings(s) {
    s.syncV = 2;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }

  /* ---------- 加密（Web Crypto AES-GCM，passphrase = token） ---------- */
  var SALT = new TextEncoder().encode('inaka-workbench-salt-v1');
  function deriveKey(passphrase) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then(function (km) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
          km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
      });
  }
  /* ---------- 加密（Web Crypto AES-GCM，passphrase = token） ----------
   * 加密前先 pako deflate 压缩，再把 iv/ct 用紧凑 base64 保存，
   * 相比旧版 "数组 JSON" 大幅减少同步 payload 体积，避免 jsonbin 免费版 100KB 上限。
   */
  var COMPRESS = typeof pako !== 'undefined';
  function bytesToB64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function encryptState(obj, passphrase) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(passphrase).then(function (key) {
      var plain = new TextEncoder().encode(JSON.stringify(obj));
      var body = COMPRESS ? pako.deflate(plain) : plain;
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, body);
    }).then(function (ct) {
      return JSON.stringify({
        v: 2,
        cm: COMPRESS ? 1 : 0,
        iv: bytesToB64(iv),
        ct: bytesToB64(new Uint8Array(ct))
      });
    });
  }
  function decryptState(payload, passphrase) {
    var pkg;
    try {
      pkg = JSON.parse(typeof payload === 'string' ? payload : '');
    } catch (e) {
      throw new Error('存档不是有效加密包（可能是旧格式或云端数据损坏）：' + String(payload).slice(0, 80));
    }
    if (!pkg || typeof pkg !== 'object') {
      throw new Error('存档格式异常：' + String(payload).slice(0, 80));
    }
    return deriveKey(passphrase).then(function (key) {
      var iv, ct;
      if (pkg.v === 1) { // 兼容旧格式：iv/ct 是整数数组
        iv = new Uint8Array(pkg.iv);
        ct = new Uint8Array(pkg.ct);
      } else {
        iv = b64ToBytes(pkg.iv);
        ct = b64ToBytes(pkg.ct);
      }
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    }).then(function (pt) {
      try {
        if (pkg.cm === 1 && COMPRESS) {
          return JSON.parse(pako.inflate(pt, { to: 'string' }));
        }
        return JSON.parse(new TextDecoder().decode(pt));
      } catch (e) {
        throw new Error('解密后解压/解析失败：' + e.message);
      }
    });
  }

  /* ---------- jsonbin.io 同步（浏览器跨域直连，CORS 已实测通过） ----------
   * 关键改进：不再依赖手动填写 Bin ID。
   * 两端只要填相同的 X-Master-Key + 同步口令，就会自动在同一个 Collection
   * （inaka-workbench）里的同一个 Bin 上汇合，从根本上避免"各自建各自的 bin
   * 导致两端都显示已同步、实际永不互通"的问题。
   */
  var JSONBIN_BASE = 'https://api.jsonbin.io/v3';
  var COLLECTION_NAME = 'inaka-workbench';
  var BIN_NAME = 'inaka-state';
  function jsonHeaders(key, extra) {
    var h = { 'X-Master-Key': key, 'Content-Type': 'application/json' };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }
  // 统一请求：处理 HTTP 错误、网络/CORS 异常，返回解析后的 JSON
  function jsonApi(key, method, path, body, extraHeaders) {
    var url = JSONBIN_BASE + path;
    var opts = { method: method, headers: jsonHeaders(key, extraHeaders) };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (res) {
      return res.text().then(function (txt) {
        var j = null;
        try { j = JSON.parse(txt); } catch (e) { j = null; }
        if (!res.ok) {
          var msg = (j && (j.message || j.error)) || ('HTTP ' + res.status + '：' + txt.slice(0, 200));
          var err = new Error(msg); err.status = res.status;
          throw err;
        }
        return j;
      });
    }).catch(function (e) {
      if (e instanceof TypeError || /Failed to fetch|NetworkError|load failed/i.test(e.message || '')) {
        throw new Error('无法连接 jsonbin.io（检查网络，或该服务在你的网络下被限制）。');
      }
      throw e;
    });
  }

  /* ---- Collection 自动发现：按名称找到/创建 inaka-workbench 集合 ----
   * 关键坑：jsonbin 对"资源不存在"统一返回 400（Invalid Bin Id / Collection not found），
   * 而非 404；只有"请求额度耗尽"的 400 不能当作缺失处理（重建也无效）。
   * 因此把 400/404 都视为"缺失"来触发自愈，但额度耗尽单独识别并提示。 */
  function isQuotaErr(err) {
    return !!err && err.status === 400 && /requests?\s+exhausted/i.test(err.message || '');
  }
  function isMissingErr(err) {
    return !!err && (err.status === 404 || err.status === 400) && !isQuotaErr(err);
  }
  function findOrCreateCollection(key) {
    return jsonApi(key, 'GET', '/c').then(function (list) {
      var arr = Array.isArray(list) ? list : [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].collectionMeta && arr[i].collectionMeta.name === COLLECTION_NAME) {
          return arr[i].record; // 集合 id
        }
      }
      // 没找到 → 创建
      return jsonApi(key, 'POST', '/c', null, { 'X-Collection-Name': COLLECTION_NAME })
        .then(function (j) { return j.record; });
    });
  }
  // 列出集合内的 bin，返回第一个 bin 的 id（本集合内只放一个状态 bin）
  function findBinInCollection(key, collId) {
    return jsonApi(key, 'GET', '/c/' + collId + '/bins').then(function (list) {
      var arr = Array.isArray(list) ? list : [];
      return arr.length ? arr[0].record : null;
    });
  }
  // 发现并定位共享 bin：找到/创建集合 → 找到/创建 bin → 缓存 id 到本地
  function discover() {
    var s = getSettings();
    return findOrCreateCollection(s.jsonKey).then(function (collId) {
      return findBinInCollection(s.jsonKey, collId).then(function (binId) {
        if (binId) { setSyncIds(collId, binId); return binId; }
        // 集合里还没有 bin → 用当前本地状态创建一个（避免空 bin）
        return encryptState(state, s.syncPass).then(function (content) {
          var record = { v: 1, payload: content, ts: Date.now() };
          return jsonApi(s.jsonKey, 'POST', '/b', record, {
            'X-Collection-Id': collId, 'X-Bin-Name': BIN_NAME
          }).then(function (j) {
            var id = j.metadata && j.metadata.id;
            setSyncIds(collId, id); return id;
          });
        });
      });
    });
  }
  // 确保已解析出两端共享的 bin：命中缓存直接返回；否则发现一次，
  // 若遇 400/404（bin 或集合失效）则清空缓存再发现一次自愈（额度耗尽除外）。
  // Gitee 后端不需要 bin，直接 resolve。
  function ensureBin() {
    var s = getSettings();
    if (s.backend === 'gitee') return Promise.resolve('');
    if (!s.jsonKey || !s.syncPass) return Promise.reject(new Error('未配置同步'));
    if (s.jsonBinId) return Promise.resolve(s.jsonBinId);
    return discover().catch(function (err) {
      if (isMissingErr(err)) { resetSyncLink(); return discover(); }
      throw err;
    });
  }
  function setSyncIds(collId, binId) {
    var s = getSettings();
    s.jsonCollectionId = collId || '';
    s.jsonBinId = binId || '';
    setSettings(s);
  }
  // 清除缓存的 bin/集合 id（"重新连接存档"用）
  function resetSyncLink() {
    var s = getSettings();
    s.jsonBinId = ''; s.jsonCollectionId = '';
    setSettings(s);
  }

  // ========== jsonbin.io 同步 ==========
  function jsonbinPush() {
    var s = getSettings();
    if (!s.jsonKey || !s.syncPass) return Promise.reject(new Error('未配置同步'));
    state._meta.lastWrite = Date.now();
    return ensureBin().then(function (binId) {
      return encryptState(state, s.syncPass).then(function (content) {
        var record = { v: 1, payload: content, ts: state._meta.lastWrite };
        function doPut(id) {
          return jsonApi(s.jsonKey, 'PUT', '/b/' + id, record);
        }
        return doPut(binId).catch(function (err) {
          if (isMissingErr(err)) { // bin 被删或 id 失效（jsonbin 返回 400/404），断开重建
            resetSyncLink();
            return ensureBin().then(function (newId) {
              return encryptState(state, s.syncPass).then(function (c2) {
                return doPut(newId);
              });
            });
          }
          throw err;
        });
      });
    }).then(function () {
      state._meta.lastSync = Date.now();
      save(false);
    });
  }
  function jsonbinPull() {
    var s = getSettings();
    if (!s.jsonKey || !s.syncPass) return Promise.reject(new Error('未配置同步'));
    if (!s.jsonBinId) return Promise.resolve(null);
    return jsonApi(s.jsonKey, 'GET', '/b/' + s.jsonBinId).then(function (j) {
      var rec = j && j.record;
      if (!rec || !rec.payload) return null;
      return decryptState(rec.payload, s.syncPass).then(function (remoteState) {
        if (!remoteState || !Array.isArray(remoteState.todo)) return null;
        var merged = Object.assign(defaultState(), remoteState);
        merged.habit = Object.assign({ items: [], punch: {} }, remoteState.habit || {});
        merged.finance = Object.assign({ accounts: [], records: [], budgets: [] }, remoteState.finance || {});
        merged._meta = Object.assign({ lastWrite: 0, lastSync: 0, lastPage: 'focus' }, remoteState._meta || {});
        return merged;
      });
    }).catch(function (err) {
      if (isMissingErr(err)) {
        resetSyncLink();
        var e = new Error('共享存档失效，已断开重连');
        e.code = 'BIN_MISSING';
        throw e;
      }
      if (err && /存档不是有效加密包|存档格式异常/.test(err.message || '')) {
        resetSyncLink();
        var e2 = new Error('共享存档内容异常，已断开重连（本地数据为准）');
        e2.code = 'BIN_MISSING';
        throw e2;
      }
      throw err;
    });
  }

  // ========== Gitee 私有仓库同步 ==========
  function giteeConfigured() {
    var s = getSettings();
    return !!(s.backend === 'gitee' && s.giteeToken && s.giteeRepo && s.syncPass);
  }
  function giteePush() {
    var s = getSettings();
    if (!giteeConfigured()) return Promise.reject(new Error('未配置 Gitee 同步'));
    state._meta.lastWrite = Date.now();
    return encryptState(state, s.syncPass).then(function (content) {
      return window.GiteeSync.push(s.giteeToken, s.giteeRepo, content);
    }).then(function () {
      state._meta.lastSync = Date.now();
      save(false);
    });
  }
  function giteePull() {
    var s = getSettings();
    if (!giteeConfigured()) return Promise.reject(new Error('未配置 Gitee 同步'));
    return window.GiteeSync.pull(s.giteeToken, s.giteeRepo).then(function (rec) {
      if (!rec || !rec.payload) return null;
      return decryptState(rec.payload, s.syncPass).then(function (remoteState) {
        if (!remoteState || !Array.isArray(remoteState.todo)) return null;
        var merged = Object.assign(defaultState(), remoteState);
        merged.habit = Object.assign({ items: [], punch: {} }, remoteState.habit || {});
        merged.finance = Object.assign({ accounts: [], records: [], budgets: [] }, remoteState.finance || {});
        merged._meta = Object.assign({ lastWrite: 0, lastSync: 0, lastPage: 'focus' }, remoteState._meta || {});
        return merged;
      });
    }).catch(function (err) {
      if (err && /存档不是有效加密包|存档格式异常/.test(err.message || '')) {
        var e = new Error('Gitee 存档内容异常，建议检查仓库文件或重新连接存档');
        e.code = 'BIN_MISSING';
        throw e;
      }
      throw err;
    });
  }

  // 统一入口
  function syncPush() {
    var s = getSettings();
    if (s.backend === 'gitee') return giteePush();
    return jsonbinPush();
  }
  function syncPull() {
    var s = getSettings();
    if (s.backend === 'gitee') return giteePull();
    return jsonbinPull();
  }

  /* ---- 安全合并：按 id 取并集，避免任一方数据丢失（多端编辑后以较新者为准） ---- */
  function modTimeOf(it) {
    return Number(it && (it.updatedAt || it.completedAt || it.createdAt || it.time)) || 0;
  }
  function mergeArrWith(localArr, remoteArr, getId, nested) {
    var map = {};
    (localArr || []).forEach(function (it) { map[getId(it)] = clone(it); });
    (remoteArr || []).forEach(function (it) {
      var id = getId(it);
      var l = map[id];
      if (!l) { map[id] = clone(it); return; }
      if (nested) { map[id] = nested(l, clone(it)); return; }
      // 扁平数组：远端整体更新则采用远端（按时间戳）
      if (modTimeOf(it) > modTimeOf(l)) map[id] = clone(it);
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function mergeArr(localArr, remoteArr, getId) { return mergeArrWith(localArr, remoteArr, getId, null); }
  // 项目的嵌套子项（子任务 subs、进展 progress）按 id 取并集，避免某端新增的子项在合并时丢失
  function mergeProject(a, b) {
    var out = clone(a);
    out.subs = mergeArr(a.subs || [], b.subs || [], function (x) { return x.id; });
    out.progress = mergeArr(a.progress || [], b.progress || [], function (x) { return x.id; });
    out.customers = mergeArr(a.customers || [], b.customers || [], function (x) { return x.id; });
    return out;
  }
  // 人脉：嵌套字段（沟通时间线 timeline、手动关系 relations）按 id 并集，避免任一方新增丢失；
  // 标签/渠道/属性等数组取并集；标量字段（公司/姓名/电话/所在地/品牌/最近沟通）以较新一方为准。
  function unionArr(a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (v) { if (!seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }
  function mergeContacts(a, b) {
    if (!a && b) return clone(b);
    if (a && !b) return clone(a);
    var out = clone(a);
    var newer = (b.updatedAt || 0) > (a.updatedAt || 0);
    ['company', 'name', 'role', 'phone', 'location', 'brands', 'last'].forEach(function (k) {
      if (newer && b[k] !== undefined) out[k] = clone(b[k]);
    });
    out.tags = unionArr(a.tags, b.tags);
    out.attrs = unionArr(a.attrs, b.attrs);
    out.channels = unionArr(a.channels, b.channels);
    out.timeline = mergeArr(a.timeline || [], b.timeline || [], function (x) { return x.id; });
    out.relations = mergeArr(a.relations || [], b.relations || [], function (x) { return x.id; });
    out.blockedKw = unionArr(a.blockedKw, b.blockedKw);
    out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
    out.created = a.created || b.created || Date.now();
    return out;
  }
  function sortKeys(o) {
    if (Array.isArray(o)) return o.map(sortKeys);
    if (o && typeof o === 'object') {
      var r = {}; Object.keys(o).sort().forEach(function (k) { r[k] = sortKeys(o[k]); }); return r;
    }
    return o;
  }
  function canon(o) { return JSON.stringify(sortKeys(o)); }
  function mergeState(local, remote) {
    if (!remote) return { state: local, changed: false };
    var out = clone(local);
    var ARR_KEYS = ['todo', 'project', 'notes', 'contacts', 'strategy', 'growth', 'review'];
    ARR_KEYS.forEach(function (k) {
      if (k === 'project') {
        out[k] = mergeArrWith(local[k], remote[k], function (i) { return i.id; }, mergeProject);
      } else if (k === 'contacts') {
        out[k] = mergeArrWith(local[k], remote[k], function (i) { return i.id; }, mergeContacts);
      } else {
        out[k] = mergeArr(local[k], remote[k], function (i) { return i.id; });
      }
    });
    ['accounts', 'records', 'budgets'].forEach(function (k) {
      out.finance[k] = mergeArr(local.finance[k], remote.finance[k], function (i) { return i.id; });
    });
    var habitRemoved = unionArr(local.habit.removedDefaults || [], remote.habit.removedDefaults || []);
    out.habit.items = mergeArr(local.habit.items, remote.habit.items, function (i) { return i.id; })
      .filter(function (it) { return habitRemoved.indexOf(it.id) < 0; });
    // habit.punch：对象 id -> 日期数组，取并集
    Object.keys(remote.habit.punch || {}).forEach(function (id) {
      var set = {};
      (local.habit.punch[id] || []).concat(remote.habit.punch[id] || []).forEach(function (d) { set[d] = 1; });
      var arr = Object.keys(set);
      if (!out.habit.punch[id] || arr.length !== out.habit.punch[id].length) out.habit.punch[id] = arr;
    });
    // habit.removedDefaults：用户主动移除的默认项，取并集（避免任一端补回）
    out.habit.removedDefaults = habitRemoved;
    // focus：按日期合并数组
    Object.keys(remote.focus || {}).forEach(function (d) {
      out.focus[d] = mergeArr(local.focus[d], remote.focus[d], function (i) { return i.id; });
    });
    // _meta：保留较新的 lastWrite；若远端更新则采用远端 lastPage
    var rl = remote._meta.lastWrite || 0, ll = local._meta.lastWrite || 0;
    out._meta.lastWrite = Math.max(rl, ll);
    if (rl > ll) out._meta.lastPage = remote._meta.lastPage;
    return { state: out, changed: canon(out) !== canon(local) };
  }

  /* ---------- 导出 / 导入 ---------- */
  function exportJson() {
    return {
      app: 'inaka 的工作台',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: state
    };
  }
  function importJson(obj) {
    var s = migrateFromBackup(obj);
    state = s;
    save();
    return state;
  }

  /* ---------- 公开 API ---------- */
  global.Store = {
    defaultState: defaultState,
    uid: uid,
    todayStr: todayStr,
    clone: clone,
    migrateFromBackup: migrateFromBackup,
    load: load,
    save: save,
    reset: reset,
    getState: getState,
    setState: setState,
    getSettings: getSettings,
    setSettings: setSettings,
    encryptState: encryptState,
    decryptState: decryptState,
    syncPush: syncPush,
    syncPull: syncPull,
    ensureBin: ensureBin,
    mergeState: mergeState,
    resetSyncLink: resetSyncLink,
    onSave: onSave,
    exportJson: exportJson,
    importJson: importJson
  };

})(window);
