/* Gitee 私有仓库同步后端
 * 把工作台加密存档存到 Gitee 私有仓库的单个文件里。
 * 优点：国内访问稳定、免费私有仓库、单文件 100MB 上限、无请求额度焦虑。
 * 数据仍由前端 AES-GCM 加密，Gitee token 只能看到密文。
 */
(function (global) {
  var API = 'https://gitee.com/api/v5';
  var PATH = 'inaka-state.json';
  var COMMIT_MSG = 'inaka workbench sync';

  function b64Encode(str) {
    var bin = '';
    var bytes = new TextEncoder().encode(str);
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64Decode(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function parseJson(txt) {
    try { return JSON.parse(txt); } catch (e) { return null; }
  }
  function apiError(res, txt) {
    var j = parseJson(txt);
    var msg = (j && (j.message || j.error)) || ('HTTP ' + res.status + '：' + txt.slice(0, 200));
    var err = new Error(msg);
    err.status = res.status;
    return err;
  }
  // 把 owner/repo 按路径段分别编码，保留中间的 `/` 作为路径分隔符
  // 错误示例：encodeURIComponent('inaka/repo') -> 'inaka%2Frepo'，Gitee 会 404
  function encodeRepo(repo) {
    return repo.split('/').map(encodeURIComponent).join('/');
  }

  // 统一 fetch：带网络异常转换
  function request(token, method, repo, body) {
    var url = API + '/repos/' + encodeRepo(repo) + '/contents/' + encodeURIComponent(PATH);
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    url += sep + 'access_token=' + encodeURIComponent(token);
    var opts = { method: method, headers: { 'Accept': 'application/json' } };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.text().then(function (txt) {
        if (!res.ok) throw apiError(res, txt);
        return parseJson(txt);
      });
    }).catch(function (e) {
      if (e instanceof TypeError || /Failed to fetch|NetworkError|load failed/i.test(e.message || '')) {
        throw new Error('无法连接 Gitee（检查网络，或该服务在你的网络下被限制）。');
      }
      throw e;
    });
  }

  // 获取文件内容与 sha；文件不存在时返回 null
  function fetchRecord(token, repo) {
    return request(token, 'GET', repo).then(function (j) {
      if (!j || !j.content) return null;
      var payload = b64Decode(j.content.replace(/\s/g, ''));
      return { payload: payload, sha: j.sha };
    }).catch(function (err) {
      if (err.status === 404) return null;
      throw err;
    });
  }

  // 上传（创建或更新）文件
  // Gitee 区分：POST 新建文件（无需 sha），PUT 更新文件（必须带 sha）。
  function uploadRecord(token, repo, payload, sha) {
    var body = {
      access_token: token,
      message: COMMIT_MSG,
      content: b64Encode(payload)
    };
    if (sha) body.sha = sha;
    return request(token, sha ? 'PUT' : 'POST', repo, body);
  }

  var GiteeSync = {
    PATH: PATH,
    // 规范化仓库名：如果用户只填了仓库名（如 myrepo），通过 /user 接口获取当前用户名补全为 owner/repo。
    // 若已填完整路径则直接返回。失败时抛出带 status 的 Error。
    normalizeRepo: function (token, repo) {
      if (!repo) {
        var err = new Error('仓库名不能为空');
        err.status = 0;
        return Promise.reject(err);
      }
      repo = repo.trim();
      if (repo.indexOf('/') !== -1) return Promise.resolve(repo);
      var url = API + '/user?access_token=' + encodeURIComponent(token);
      return fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } })
        .then(function (res) {
          return res.text().then(function (txt) {
            if (!res.ok) {
              var j = parseJson(txt);
              var e = new Error((j && (j.message || j.error)) || ('HTTP ' + res.status));
              e.status = res.status;
              throw e;
            }
            var j = parseJson(txt);
            if (!j || !j.login) throw new Error('无法从 Gitee 获取当前用户名');
            return j.login + '/' + repo;
          });
        })
        .catch(function (e) {
          if (e instanceof TypeError || /Failed to fetch|NetworkError|load failed/i.test(e.message || '')) {
            var ne = new Error('网络无法连接 Gitee（检查网络/代理）');
            ne.status = 0;
            throw ne;
          }
          throw e;
        });
    },
    // 验证 token 并返回当前用户名；便于 UI 明确告知"令牌属于哪个账号"。失败时抛出带 status 的 Error。
    whoami: function (token) {
      var url = API + '/user?access_token=' + encodeURIComponent(token);
      return fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } })
        .then(function (res) {
          return res.text().then(function (txt) {
            if (!res.ok) {
              var j = parseJson(txt);
              var e = new Error((j && (j.message || j.error)) || ('HTTP ' + res.status));
              e.status = res.status;
              throw e;
            }
            var j = parseJson(txt);
            if (!j || !j.login) throw new Error('无法从 Gitee 获取当前用户名');
            return j.login;
          });
        })
        .catch(function (e) {
          if (e instanceof TypeError || /Failed to fetch|NetworkError|load failed/i.test(e.message || '')) {
            var ne = new Error('网络无法连接 Gitee（检查网络/代理）');
            ne.status = 0;
            throw ne;
          }
          throw e;
        });
    },
    // 拉取：返回 { payload: <加密包字符串> } 或 null（文件不存在）
    pull: function (token, repo) {
      return fetchRecord(token, repo).then(function (rec) {
        return rec || null;
      });
    },
    // 推送：先读 sha，再 PUT；遇到 sha 冲突则抛出 CONFLICT 让上层合并后重试
    push: function (token, repo, payload) {
      return fetchRecord(token, repo).then(function (rec) {
        return uploadRecord(token, repo, payload, rec && rec.sha);
      }).catch(function (err) {
        if (err.status === 422 || /sha does not match|already exists|conflict/i.test(err.message || '')) {
          var e = new Error('云端已被其他设备更新，需要拉取合并后重试');
          e.code = 'CONFLICT';
          throw e;
        }
        throw err;
      });
    },
    // 连接自检：仅验证 令牌+仓库 是否有效，不读写实际数据。返回 { ok, status?, msg? }
    // 打在仓库根接口，可区分「仓库不存在(404)」与「文件未创建(首次同步本就正常)」。
    checkRepo: function (token, repo) {
      var url = API + '/repos/' + encodeRepo(repo) + '?access_token=' + encodeURIComponent(token);
      return fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } })
        .then(function (res) {
          if (res.ok) return { ok: true };
          return res.text().then(function (txt) {
            var j = parseJson(txt);
            var err = new Error((j && (j.message || j.error)) || ('HTTP ' + res.status));
            err.status = res.status;
            throw err;
          });
        })
        .catch(function (e) {
          if (e instanceof TypeError || /Failed to fetch|NetworkError|load failed/i.test(e.message || '')) {
            return { ok: false, status: 0, msg: '网络无法连接 Gitee（检查网络/代理）' };
          }
          return { ok: false, status: e.status || 0, msg: e.message || ('HTTP ' + (e.status || '?')) };
        });
    }
  };

  global.GiteeSync = GiteeSync;
})(window);
