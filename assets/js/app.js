/* =====================================================================
 * inaka 的工作台 — UI 层
 * 渲染、路由、交互、云同步调度。原生 JS。
 * ===================================================================== */
(function () {
  'use strict';

  var S = Store;
  var state = S.load();
  var currentKey = state._meta.lastPage || 'focus';
  var pageHost = document.getElementById('pageHost');
  var navEl = document.getElementById('nav');

  /* ---------------- 通用工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    n = Number(n) || 0;
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var cls = n >= 0 ? 'in' : 'out';
    return '<span class="money ' + cls + '">' + sign + '¥' + abs + '</span>';
  }
  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function today() { return S.todayStr(); }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function saveRender() { S.save(); renderPage(currentKey); }

  // 简易确认（覆盖原生 confirm，移动端友好）
  function ask(msg) { return window.confirm(msg); }

  function section(title, desc, inner) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' +
      (desc ? '<div class="desc">' + esc(desc) + '</div>' : '') + '</div>' +
      '<div id="pageTools"></div></div>' + inner;
  }

  /* ================= 各板块 ================= */

  // ---- 聚焦 ----
  var Focus = {
    key: 'focus', label: '聚焦', icon: '◎',
    render: function (s) {
      var date = today();
      var list = (s.focus[date] || []);
      var items = list.length ? list.map(function (it) {
        return '<div class="item ' + (it.done ? 'done' : '') + '">' +
          '<div class="check ' + (it.done ? 'on' : '') + '" data-act="toggle" data-id="' + it.id + '">' + (it.done ? '✓' : '') + '</div>' +
          '<div class="body"><div class="title">' + esc(it.text) + '</div></div>' +
          '<button class="x" data-act="del" data-id="' + it.id + '">✕</button></div>';
      }).join('') : '<div class="empty">今天还没有聚焦目标，加一个 ↓</div>';
      return section('聚焦', '今天的 3 件要事', '') +
        '<div class="card"><div class="row-between" style="margin-bottom:10px">' +
        '<div class="field" style="margin:0;flex:1"><label>日期</label>' +
        '<input class="input" id="focusDate" type="date" value="' + date + '"></div></div>' +
        '<div class="row-between"><input class="input" id="focusInput" placeholder="今天最想推进的一件事…" style="flex:1;margin-right:8px">' +
        '<button class="btn" data-act="add">添加</button></div></div>' +
        '<div class="card"><h2>当日聚焦</h2>' + items + '</div>';
    },
    acts: {
      add: function () {
        var inp = document.getElementById('focusInput');
        var d = document.getElementById('focusDate').value || today();
        var v = inp.value.trim(); if (!v) return;
        state.focus[d] = state.focus[d] || [];
        state.focus[d].push({ id: S.uid(), text: v, done: false, updatedAt: Date.now() });
        saveRender();
      },
      toggle: function (el) {
        var d = document.getElementById('focusDate').value || today();
        var arr = state.focus[d] || [];
        var it = arr.find(function (x) { return x.id === el.dataset.id; });
        if (it) { it.done = !it.done; it.updatedAt = Date.now(); saveRender(); }
      },
      del: function (el) {
        var d = document.getElementById('focusDate').value || today();
        state.focus[d] = (state.focus[d] || []).filter(function (x) { return x.id !== el.dataset.id; });
        saveRender();
      }
    },
    onDate: function () { renderPage('focus'); }
  };

  // ---- 待办 ----
  // 类型 / 属性标签固定配色（维度基本固定，便于一眼区分）
  var TODO_SUB_CLASS = { '临时任务': 'yellow', '长线任务': 'red' };
  var TODO_ATTR_CLASS = { '客户': 'blue', '内部': 'purple', '品牌': 'teal', '其他': 'gray' };
  function subClass(sub) { return TODO_SUB_CLASS[sub] || 'gray'; }
  function attrClass(a) { return TODO_ATTR_CLASS[a] || 'gray'; }
  var Todo = {
    key: 'todo', label: '待办', icon: '☑',
    _f: 'all',
    _searchW: '', _searchT: '',
    _expand: {},
    _filter: { type: '', attr: '', project: '' },
    _detailId: null,
    _DIMS: [
      { key: 'type', label: '类型' },
      { key: 'attr', label: '属性' },
      { key: 'project', label: '关联项目' }
    ],
    render: function (s) {
      var self = this;
      var filter = this._f || 'all';
      var fcount = s.todo.filter(function (t) { return !t.done; }).length;
      var wlActive = s.todo.filter(function (t) { return !t.done && t.tab === '万澜'; }).length;
      var tyActive = s.todo.filter(function (t) { return !t.done && t.tab === '天意'; }).length;
      var projOpts = '<option value="无">无</option>' + s.project.map(function (p) {
        return '<option value="' + esc(p.name) + '">' + esc(p.name) + '</option>';
      }).join('');
      return section('待办', '当前 ' + fcount + ' 项进行中 · 万澜 ' + wlActive + ' / 天意 ' + tyActive, '') +
        '<div class="card"><div class="grid cols-2">' +
        '<div class="field" style="margin:0"><label>事项</label><input class="input" id="todoText" placeholder="要做什么"></div>' +
        '<div class="field" style="margin:0"><label>归属（万澜 / 天意）</label><select class="select" id="todoTab"><option>万澜</option><option>天意</option></select></div>' +
        '<div class="field" style="margin:0"><label>类型</label><select class="select" id="todoSub"><option>临时任务</option><option>长线任务</option></select></div>' +
        '<div class="field" style="margin:0"><label>属性</label><select class="select" id="todoAttr"><option>客户</option><option>内部</option><option>品牌</option><option>其他</option></select></div>' +
        '<div class="field" style="margin:0"><label>关联项目</label><select class="select" id="todoProj">' + projOpts + '</select></div>' +
        '<div class="field" style="margin:0;justify-content:flex-end;display:flex"><button class="btn" data-act="add">添加待办</button></div>' +
        '</div></div>' +
        '<div class="card" style="padding:12px 16px"><div class="row-between">' +
        '<h2 style="margin:0;font-size:15px">列表</h2>' +
        '<div>' +
        ['all', 'active', 'done'].map(function (f) {
          return '<button class="btn sm ' + (filter === f ? '' : 'ghost') + '" data-act="filter" data-f="' + f + '" style="margin-left:4px">' +
            ({ all: '全部', active: '进行中', done: '已完成' }[f]) + '</button>';
        }).join('') + '</div></div></div>' +
        '<div class="todo-board">' +
        self.renderCol(s, '万澜', 'blue') +
        self.renderCol(s, '天意', 'amber') +
        '</div>' +
        self.renderOverlay(s);
    },
    renderCol: function (s, col, dotCls) {
      var self = this;
      var filter = this._f || 'all';
      var search = col === '万澜' ? this._searchW : this._searchT;
      var items = s.todo.filter(function (t) {
        if (t.tab !== col) return false;
        if (filter === 'active') return !t.done;
        if (filter === 'done') return t.done;
        return true;
      });
      items = self.applyFilter(items, search);
      var count = items.length;
      var toolbar = '<div class="todo-toolbar">' +
        '<input class="input todo-search" type="text" placeholder="搜索事项、类型、属性、项目…" value="' + esc(search) + '" data-input="todoSearch" data-col="' + esc(col) + '">' +
        '<div class="todo-filters">' +
        this._DIMS.map(function (d) {
          var active = self._filter[d.key];
          var expanded = !!self._expand[d.key];
          return '<div class="todo-dim">' +
            '<button class="btn sm ' + (active ? '' : 'ghost') + '" data-act="dim" data-dim="' + d.key + '">' + esc(d.label) + (active ? '：' + esc(active) : '') + (expanded ? ' ▲' : ' ▼') + '</button>' +
            (expanded ? '<div class="todo-opts">' + self.renderOpts(items, d.key, active) + '</div>' : '') +
            '</div>';
        }).join('') +
        (self._filter.type || self._filter.attr || self._filter.project ? '<button class="btn sm ghost" data-act="clearFilter">清除筛选</button>' : '') +
        '</div></div>';
      return '<div class="todo-col"><div class="col-head"><span class="col-dot ' + dotCls + '"></span>' + esc(col) + ' <span class="count">' + count + '</span></div>' + toolbar + self.renderList(items, s) + '</div>';
    },
    renderOpts: function (items, dim, active) {
      var opts = this.collectOpts(items, dim);
      if (!opts.length) return '<span class="todo-opt-empty">无可用选项</span>';
      return opts.map(function (o) {
        return '<span class="todo-opt ' + (active === o ? 'active' : '') + '" data-act="setFilter" data-dim="' + esc(dim) + '" data-val="' + esc(o) + '">' + esc(o) + '</span>';
      }).join('');
    },
    collectOpts: function (items, dim) {
      var seen = {}, out = [];
      items.forEach(function (t) {
        var vals = [];
        if (dim === 'type') { if (t.sub) vals.push(t.sub); }
        else if (dim === 'attr') { vals = t.attr || []; }
        else if (dim === 'project') { if (t.project && t.project !== '无') vals.push(t.project); }
        vals.forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
      });
      return out.sort();
    },
    applyFilter: function (items, search) {
      var self = this;
      var q = (search || '').toLowerCase();
      var f = this._filter;
      return items.filter(function (t) {
        if (f.type && t.sub !== f.type) return false;
        if (f.attr && (t.attr || []).indexOf(f.attr) < 0) return false;
        if (f.project && t.project !== f.project) return false;
        if (!q) return true;
        var hay = [t.text, t.sub, (t.attr || []).join(' '), t.project].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    },
    renderList: function (items, s) {
      var self = this;
      return items.length ? items.map(function (t) {
        return self.renderItem(t);
      }).join('') : '<div class="empty">该归属下暂无待办</div>';
    },
    renderItem: function (t) {
      var tags = '';
      if (t.sub) tags += '<span class="tag ' + subClass(t.sub) + '">' + esc(t.sub) + '</span>';
      if (t.attr && t.attr.length) tags += t.attr.map(function (a) { return '<span class="tag ' + attrClass(a) + '">' + esc(a) + '</span>'; }).join('');
      if (t.project && t.project !== '无') tags += '<span class="tag green">' + esc(t.project) + '</span>';
      var tabCls = t.tab === '天意' ? 'tianyi' : 'wanlan';
      return '<div class="item todo-item ' + tabCls + ' ' + (t.done ? 'done' : '') + '" data-act="openTodo" data-id="' + t.id + '">' +
        '<div class="check ' + (t.done ? 'on' : '') + '" data-act="toggle" data-id="' + t.id + '" data-stop>' + (t.done ? '✓' : '') + '</div>' +
        '<div class="body"><div class="title">' + esc(t.text) + '</div>' +
        '<div class="meta">' + tags + (t.completedAt ? ' · 完成 ' + fmtDate(t.completedAt) : '') +
        '<span class="todo-created" title="创建时间">' + fmtDate(t.createdAt) + '</span></div></div>' +
        '<div class="todo-actions">' +
        '<button class="x" data-act="del" data-id="' + t.id + '" data-stop>✕</button></div></div>';
    },
    renderOverlay: function (s) {
      var self = this;
      var t = this._detailId ? s.todo.find(function (x) { return x.id === self._detailId; }) : null;
      if (!t) return '<div class="overlay" id="todoOverlay"></div>';
      var projOpts = '<option value="无">无</option>' + s.project.map(function (p) {
        return '<option value="' + esc(p.name) + '"' + (t.project === p.name ? ' selected' : '') + '>' + esc(p.name) + '</option>';
      }).join('');
      var attrOpts = ['客户', '内部', '品牌', '其他'].map(function (a) {
        return '<option' + ((t.attr || [])[0] === a ? ' selected' : '') + '>' + esc(a) + '</option>';
      }).join('');
      var tags = '';
      if (t.sub) tags += '<span class="tag ' + subClass(t.sub) + '">' + esc(t.sub) + '</span>';
      if (t.attr && t.attr.length) tags += t.attr.map(function (a) { return '<span class="tag ' + attrClass(a) + '">' + esc(a) + '</span>'; }).join('');
      if (t.project && t.project !== '无') tags += '<span class="tag green">' + esc(t.project) + '</span>';
      return '<div class="overlay open" id="todoOverlay"><div class="detail todo-detail"><div class="detail-head"><div class="detail-title">编辑待办</div><div class="head-actions"><button class="btn ghost danger" data-act="delTodo" data-id="' + t.id + '">删除</button><button class="btn ghost" data-act="closeDetail">关闭</button></div></div>' +
        '<div class="detail-body todo-detail-body"><div>' +
        '<div class="detail-section"><label>事项内容</label><input class="input" id="dTodoText" value="' + esc(t.text || '') + '" placeholder="要做什么"></div>' +
        '<div class="detail-section"><label>当前标签</label><div class="meta">' + (tags || '<span class="muted">无</span>') + '</div></div>' +
        '<div class="detail-section"><label>创建时间</label><div class="muted">' + (t.createdAt ? fmtDate(t.createdAt) : '未知') + '</div></div>' +
        (t.completedAt ? '<div class="detail-section"><label>完成时间</label><div class="muted">' + fmtDate(t.completedAt) + '</div></div>' : '') +
        '</div><div class="right-col">' +
        '<div class="detail-section"><label>归属</label><select class="select" id="dTodoTab"><option' + (t.tab === '万澜' ? ' selected' : '') + '>万澜</option><option' + (t.tab === '天意' ? ' selected' : '') + '>天意</option></select></div>' +
        '<div class="detail-section"><label>类型</label><select class="select" id="dTodoSub"><option' + (t.sub === '临时任务' ? ' selected' : '') + '>临时任务</option><option' + (t.sub === '长线任务' ? ' selected' : '') + '>长线任务</option></select></div>' +
        '<div class="detail-section"><label>属性</label><select class="select" id="dTodoAttr">' + attrOpts + '</select></div>' +
        '<div class="detail-section"><label>关联项目</label><select class="select" id="dTodoProj">' + projOpts + '</select></div>' +
        '<div class="detail-section"><label>状态</label><select class="select" id="dTodoDone"><option value="false"' + (t.done ? '' : ' selected') + '>进行中</option><option value="true"' + (t.done ? ' selected' : '') + '>已完成</option></select></div>' +
        '<button class="btn primary save-btn" data-act="saveTodo">保存修改</button>' +
        '</div></div></div></div>';
    },
    acts: {
      add: function () {
        var v = document.getElementById('todoText').value.trim(); if (!v) return;
        state.todo.unshift({
          id: S.uid(), text: v,
          tab: document.getElementById('todoTab').value,
          sub: document.getElementById('todoSub').value,
          attr: [document.getElementById('todoAttr').value],
          project: document.getElementById('todoProj').value || '无',
          createdAt: Date.now(), completedAt: null, done: false, subs: []
        });
        saveRender();
      },
      toggle: function (el) {
        var t = state.todo.find(function (x) { return x.id === el.dataset.id; });
        if (t) { t.done = !t.done; t.completedAt = t.done ? Date.now() : null; t.updatedAt = Date.now(); saveRender(); }
      },
      del: function (el) {
        if (!ask('删除该待办？')) return;
        state.todo = state.todo.filter(function (x) { return x.id !== el.dataset.id; });
        saveRender();
      },
      filter: function (el) { Todo._f = el.dataset.f; renderPage('todo'); },
      dim: function (el) {
        var key = el.dataset.dim;
        Todo._expand[key] = !Todo._expand[key];
        renderPage('todo');
      },
      setFilter: function (el) {
        var dim = el.dataset.dim, val = el.dataset.val;
        Todo._filter[dim] = Todo._filter[dim] === val ? '' : val;
        renderPage('todo');
      },
      clearFilter: function () { Todo._filter = { type: '', attr: '', project: '' }; renderPage('todo'); },
      openTodo: function (el) { Todo._detailId = el.dataset.id; renderPage('todo'); },
      closeDetail: function () { Todo._detailId = null; renderPage('todo'); },
      saveTodo: function () {
        var id = Todo._detailId; if (!id) return;
        var t = state.todo.find(function (x) { return x.id === id; }); if (!t) return;
        var text = document.getElementById('dTodoText').value.trim();
        if (!text) { toast('事项内容不能为空'); return; }
        t.text = text;
        t.tab = document.getElementById('dTodoTab').value;
        t.sub = document.getElementById('dTodoSub').value;
        t.attr = [document.getElementById('dTodoAttr').value];
        t.project = document.getElementById('dTodoProj').value || '无';
        var done = document.getElementById('dTodoDone').value === 'true';
        if (done !== t.done) { t.done = done; t.completedAt = done ? Date.now() : null; }
        t.updatedAt = Date.now();
        Todo._detailId = null;
        saveRender();
        toast('已保存');
      },
      delTodo: function (el) {
        var id = el.dataset.id || Todo._detailId;
        if (!id) return;
        if (!ask('删除该待办？')) return;
        state.todo = state.todo.filter(function (x) { return x.id !== id; });
        if (Todo._detailId === id) Todo._detailId = null;
        saveRender();
        toast('已删除');
      }
    },
    onRender: function () {
      var self = this;
      document.querySelectorAll('[data-input="todoSearch"]').forEach(function (input) {
        input.addEventListener('input', function () {
          var col = input.dataset.col;
          var val = input.value;
          if (col === '万澜') self._searchW = val; else self._searchT = val;
          renderPage('todo');
          var next = document.querySelector('[data-input="todoSearch"][data-col="' + col + '"]');
          if (next) { next.focus(); next.setSelectionRange(val.length, val.length); }
        });
      });
      // 详情 overlay 背景点击关闭
      var ov = document.getElementById('todoOverlay');
      if (ov) ov.addEventListener('click', function (e) { if (e.target.id === 'todoOverlay') { self._detailId = null; renderPage('todo'); } });
    }
  };

  // ---- 项目 ----
  var PROJECT_CATS = ['品牌合作', '客户合作', '市场与分析'];
  var PROJECT_STATUS = { doing: '进行中', done: '已完成', pause: '暂停' };
  // 旧类别映射：兼容历史数据，统一归到新的三类
  var PROJECT_CAT_MAP = { '市场和分析': '市场与分析', '市场和其他分析': '市场与分析', '其他': '市场与分析' };
  function normalizeProjectCat(cat) {
    if (!cat) return PROJECT_CATS[0];
    if (PROJECT_CATS.indexOf(cat) >= 0) return cat;
    return PROJECT_CAT_MAP[cat] || PROJECT_CATS[0];
  }
  function sortProjects(list) {
    return list.slice().sort(function (a, b) {
      return (b.lastAccessed || b.updatedAt || b.created || 0) - (a.lastAccessed || a.updatedAt || a.created || 0);
    });
  }
  function migrateProjectCats() {
    var dirty = false;
    state.project.forEach(function (p) {
      var nc = normalizeProjectCat(p.cat);
      if (nc !== p.cat) { p.cat = nc; dirty = true; }
    });
    return dirty;
  }
  // 客户跟进（CRM 看板）可选项
  var CUST_STAGES = ['已合作', '跟进中', '仅建联未沟通'];
  var CUST_STAGE_COLOR = { '已合作': 'green', '跟进中': 'blue', '仅建联未沟通': 'gray' };
  var CUST_ATTRS = ['代理商/经销商', '终端实体', '流通商/批发商', 'KA卖场'];
  var CUST_STATUS = ['确认合作已下单', '确认合作未下单', '已建联沟通中', '仅建联未沟通'];
  var CUST_CHANNELS = ['高超/精超', '线上平台', '传统CS', '新零售/新美妆', '便利', 'KA卖场', '私域', '团购特渠', '线下多渠道'];
  var CUST_POTENTIAL = ['大', '中', '小'];
  var CUST_POT_CLASS = { '大': 'potential-big', '中': 'potential-mid', '小': 'potential-small' };
  function custPotClass(p) { return CUST_POT_CLASS[p] || 'potential-small'; }

  var Project = {
    key: 'project', label: '项目', icon: '◫',
    _detailId: null,
    _subId: null,
    _custDetailId: null,
    _projTab: 'overview',
    _custTab: 'board',
    _custStage: null,
    _custAttr: '',
    _custSearch: '',
    render: function (s) {
      return section('项目', '渠道 / 品牌 / 合作进展', '') +
        this.renderForm(s) +
        this.renderList(s) +
        this.renderOverlay(s) +
        this.renderCustOverlay(s);
    },
    renderForm: function (s) {
      var catOpts = PROJECT_CATS.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      return '<div class="card"><div class="grid cols-3">' +
        '<div class="field" style="margin:0"><label>项目名称</label><input class="input" id="pName" placeholder="如：ciroa 出口日本"></div>' +
        '<div class="field" style="margin:0"><label>类别</label><select class="select" id="pCat">' + catOpts + '</select></div>' +
        '<div class="field" style="margin:0;justify-content:flex-end;display:flex"><button class="btn" data-act="add">新建项目</button></div>' +
        '</div></div>';
    },
    renderList: function (s) {
      var self = this;
      if (!s.project.length) return '<div class="empty">还没有项目，创建一个 ↓</div>';
      function card(p) {
        var stCls = p.status === 'done' ? 'green' : (p.status === 'pause' ? 'gray' : 'blue');
        var stTxt = PROJECT_STATUS[p.status] || p.status || '进行中';
        var custCount = (p.customers || []).length;
        var contacts = (p.contacts || []).map(function (cid) { return self.contactName(s, cid); }).filter(Boolean);
        return '<div class="card project-card" data-act="openProject" data-id="' + p.id + '">' +
          '<div class="project-card-head">' +
          '<div class="project-card-title">' + esc(p.name) + '</div>' +
          '<div class="project-card-tags"><span class="tag">' + esc(p.cat || '') + '</span><span class="tag ' + stCls + '">' + esc(stTxt) + '</span></div>' +
          '</div>' +
          '<div class="project-card-body">' +
          (p.overview ? '<div class="project-overview">' + esc(p.overview) + '</div>' : '') +
          '<div class="project-stats">' +
          '<span>客户 ' + custCount + '</span>' +
          (contacts.length ? '<span>关联 ' + contacts.length + ' 人</span>' : '') +
          '</div>' +
          (contacts.length ? '<div class="project-card-contacts">' + contacts.map(function (n) { return '<span class="tag sm">' + esc(n) + '</span>'; }).join('') + '</div>' : '') +
          '</div>' +
          '<div class="project-card-foot">点击进入 →</div>' +
          '</div>';
      }
      function col(name, key) {
        var list = sortProjects(s.project.filter(function (p) { return (p.cat || '') === key; }));
        return '<div class="project-col">' +
          '<div class="project-col-head"><span class="project-col-dot"></span>' + esc(name) + ' <span class="count">' + list.length + '</span></div>' +
          '<div class="project-col-cards">' + (list.length ? list.map(card).join('') : '<div class="empty sm">暂无项目</div>') + '</div>' +
          '</div>';
      }
      return '<div class="project-board">' +
        col('品牌合作', '品牌合作') +
        col('客户合作', '客户合作') +
        col('市场与分析', '市场与分析') +
        '</div>';
    },
    renderOverlay: function (s) {
      var self = this;
      var p = this._detailId ? s.project.find(function (x) { return x.id === self._detailId; }) : null;
      if (!p) return '<div class="overlay" id="projectOverlay"></div>';
      var tabs = '<div class="detail-tabs">' +
        '<button class="dtab ' + (this._projTab === 'overview' ? 'active' : '') + '" data-act="projTab" data-t="overview">概况</button>' +
        '<button class="dtab ' + (this._projTab === 'customers' ? 'active' : '') + '" data-act="projTab" data-t="customers">客户跟进</button>' +
        '</div>';
      var body = this._projTab === 'customers' ? this.renderCustomers(s, p) : this.renderOverviewTab(s, p);
      return '<div class="overlay open" id="projectOverlay"><div class="detail project-detail"><div class="detail-head"><div class="detail-title">编辑项目</div><div class="head-actions"><button class="btn ghost danger" data-act="delProject" data-id="' + p.id + '">删除项目</button><button class="btn ghost" data-act="closeProject">关闭</button></div></div>' +
        tabs +
        '<div class="detail-body project-detail-body full-width">' + body + '</div></div></div>';
    },
    renderOverviewTab: function (s, p) {
      var self = this;
      var catOpts = PROJECT_CATS.map(function (c) { return '<option' + (p.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
      var statusOpts = Object.keys(PROJECT_STATUS).map(function (k) {
        return '<option value="' + k + '"' + (p.status === k ? ' selected' : '') + '>' + PROJECT_STATUS[k] + '</option>';
      }).join('');
      var contacts = (p.contacts || []).map(function (cid) {
        var name = self.contactName(s, cid);
        return '<div class="rel-item" data-stop>' +
          '<div class="rname">' + esc(name || '未知人脉') + '</div>' +
          '<button class="mini-del" data-act="delProjectContact" data-pid="' + p.id + '" data-cid="' + esc(cid) + '">移除</button></div>';
      }).join('') || '<div class="net-empty">暂无关联人脉。在下方选择添加。</div>';
      var linkOpts = self.contactOptions(s, p);
      var contactSearchBox = '<input class="input" id="projectContactSearch" placeholder="搜索公司 / 姓名 / 品牌 / 渠道 / 所在地…">';
      return '<div class="detail-section"><label>项目名称</label><input class="input" id="dProjectName" value="' + esc(p.name || '') + '"></div>' +
        '<div class="detail-section"><label>项目概况</label><textarea class="textarea" id="dProjectOverview" placeholder="项目背景、目标、关键信息…">' + esc(p.overview || '') + '</textarea></div>' +
        '<div class="grid cols-2" style="margin:14px 0">' +
        '<div class="detail-section"><label>类别</label><select class="select" id="dProjectCat">' + catOpts + '</select></div>' +
        '<div class="detail-section"><label>状态</label><select class="select" id="dProjectStatus">' + statusOpts + '</select></div>' +
        '</div>' +
        '<div class="detail-section"><label>关联人脉</label>' + contacts + '</div>' +
        '<div class="detail-section"><label>添加关联人脉</label>' + contactSearchBox +
        '<select class="select" id="projectContactSelect">' + linkOpts + '</select>' +
        '<button class="btn" style="margin-top:8px" data-act="addProjectContact" data-pid="' + p.id + '">添加</button></div>' +
        '<div class="row-between" style="margin-top:16px"><button class="btn primary" data-act="saveProject">保存修改</button></div>';
    },
    renderCustomers: function (s, p) {
      var self = this;
      var all = (p.customers || []).slice();
      var q = (this._custSearch || '').trim().toLowerCase();
      var attr = this._custAttr;
      var filtered = all.filter(function (c) {
        if (attr && c.attr !== attr) return false;
        if (!q) return true;
        var hay = [c.name, c.person, c.region, c.channel, c.attr, c.status, c.progress, (c.timeline || []).map(function (t) { return t.memo; }).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
      function cnt(stage) { return all.filter(function (c) { return c.stage === stage; }).length; }
      var stats = '<div class="stat-row">' +
        '<div class="stat"><div class="n">' + all.length + '</div><div class="l">客户总数</div></div>' +
        '<div class="stat"><div class="n">' + cnt('已合作') + '</div><div class="l">已合作</div></div>' +
        '<div class="stat"><div class="n">' + cnt('跟进中') + '</div><div class="l">跟进中</div></div>' +
        '<div class="stat"><div class="n">' + cnt('仅建联未沟通') + '</div><div class="l">仅建联未沟通</div></div>' +
        '</div>';
      // 独立阶段页
      if (this._custStage) {
        var stage = this._custStage;
        var list = filtered.filter(function (c) { return c.stage === stage; })
          .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
        var cards = list.length ? list.map(function (c) { return self.renderCustCard(c); }).join('') : '<div class="empty">该阶段暂无客户</div>';
        return stats +
          '<div class="cust-toolbar"><button class="btn ghost" data-act="custStage" data-v="">← 返回看板</button>' +
          '<span class="cust-stage-title">' + esc(stage) + '（' + list.length + '）</span>' +
          '<button class="btn primary" style="margin-left:auto" data-act="addCust" data-pid="' + p.id + '">+ 新增客户</button></div>' +
          '<div class="cust-list">' + cards + '</div>';
      }
      // 看板
      var board = '<div class="cust-board">' + CUST_STAGES.map(function (stage) {
        var list = filtered.filter(function (c) { return c.stage === stage; })
          .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
        var shown = list.slice(0, 5);
        var rest = list.length - shown.length;
        var cards = shown.map(function (c) { return self.renderCustCard(c); }).join('');
        var more = rest > 0 ? '<button class="cust-more-btn" data-act="custStage" data-v="' + esc(stage) + '">查看全部 ' + rest + ' 条 →</button>' : '';
        return '<div class="cust-col"><div class="col-head"><span class="col-dot ' + CUST_STAGE_COLOR[stage] + '"></span>' + esc(stage) + ' <span class="count">' + list.length + '</span></div>' + cards + more + '</div>';
      }).join('') + '</div>';
      var attrChips = '<span class="chip ' + (attr === '' ? 'active' : '') + '" data-act="custAttr" data-v="">全部</span>' +
        CUST_ATTRS.map(function (a) { return '<span class="chip ' + (attr === a ? 'active' : '') + '" data-act="custAttr" data-v="' + esc(a) + '">' + esc(a) + '</span>'; }).join('');
      var importBtn = (window.CIROA_CUSTOMERS && window.CIROA_CUSTOMERS.length && all.length === 0)
        ? '<button class="btn ghost" style="margin-left:auto" data-act="importCustTemplate" data-pid="' + p.id + '">导入初始客户清单（' + window.CIROA_CUSTOMERS.length + '）</button>'
        : '';
      return stats +
        '<div class="cust-toolbar">' +
        '<input class="input cust-search" id="custSearch" type="text" placeholder="搜索客户 / 联系人 / 区域 / 渠道…" value="' + esc(this._custSearch) + '">' +
        '<button class="btn ghost sm" data-act="custTabToggle">' + (this._custTab === 'board' ? '列表' : '看板') + '</button>' +
        '<button class="btn primary" data-act="addCust" data-pid="' + p.id + '">+ 新增客户</button>' +
        importBtn +
        '</div>' +
        '<div class="cust-attrs">' + attrChips + '</div>' +
        (this._custTab === 'board' ? board : this.renderCustTable(filtered));
    },
    renderCustCard: function (c) {
      var pot = c.potential ? '<span class="tag ' + custPotClass(c.potential) + '">' + esc(c.potential) + '潜力</span>' : '';
      var statusTag = c.status ? '<span class="tag status">' + esc(c.status) + '</span>' : '';
      var lastMemo = (c.timeline && c.timeline.length) ? (c.timeline.slice(-1)[0].memo || '') : (c.progress || '');
      return '<div class="cust-card" data-act="openCust" data-id="' + esc(c.id) + '" data-stop>' +
        '<div class="cust-title">' + esc(c.name || '') + '</div>' +
        '<div class="cust-person">' + esc(c.person || '') + (c.region ? ' · ' + esc(c.region) : '') + '</div>' +
        '<div class="cust-tags">' +
        (c.attr ? '<span class="tag attr">' + esc(c.attr) + '</span>' : '') +
        (c.channel ? '<span class="tag channel">' + esc(c.channel) + '</span>' : '') +
        pot + statusTag +
        '</div>' +
        '<div class="cust-progress">' + (lastMemo || '暂无进展') + '</div>' +
        '<div class="cust-foot"><span class="owner-pill">' + esc(c.owner || '') + '</span><span>' + esc(c.outlets || '') + '</span></div>' +
        '</div>';
    },
    renderCustTable: function (list) {
      if (!list.length) return '<div class="empty">无匹配客户</div>';
      var rows = list.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).map(function (c) {
        var lastMemo = (c.timeline && c.timeline.length) ? c.timeline.slice(-1)[0].memo : (c.progress || '');
        return '<tr class="cust-row" data-act="openCust" data-id="' + esc(c.id) + '" data-stop>' +
          '<td><span class="cust-title">' + esc(c.name || '') + '</span></td>' +
          '<td>' + esc(c.owner || '') + '</td>' +
          '<td>' + esc(c.person || '') + '</td>' +
          '<td>' + esc(c.stage || '') + '</td>' +
          '<td>' + esc(c.status || '') + '</td>' +
          '<td>' + esc(c.attr || '') + '</td>' +
          '<td>' + esc(c.channel || '') + '</td>' +
          '<td>' + esc(c.region || '') + '</td>' +
          '<td>' + esc(c.potential || '-') + '</td>' +
          '<td class="cust-prog-cell">' + esc(lastMemo) + '</td>' +
          '</tr>';
      }).join('');
      return '<div class="cust-table-wrap"><table class="list-table cust-table"><thead><tr>' +
        '<th>客户公司</th><th>负责人</th><th>联系人</th><th>阶段</th><th>状态</th><th>属性</th><th>渠道</th><th>区域</th><th>潜力</th><th>最新进展</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    },
    renderCustOverlay: function (s) {
      var self = this;
      var p = this._detailId ? s.project.find(function (x) { return x.id === self._detailId; }) : null;
      var c = p && this._custDetailId ? (p.customers || []).find(function (x) { return x.id === self._custDetailId; }) : null;
      if (!c) return '<div class="overlay" id="custOverlay"></div>';
      function opts(arr, sel) { return arr.map(function (o) { return '<option' + (o === sel ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join(''); }
      var linkOpts = '<option value="">关联人脉（可选）…</option>' + (s.contacts || []).map(function (ct) {
        var label = ct.company ? ct.company + ' · ' + ct.name : ct.name;
        return '<option value="' + esc(ct.id) + '"' + (c.contactId === ct.id ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
      var tl = (c.timeline || []).slice().reverse().map(function (t) {
        return '<div class="timeline-item"><div class="timeline-date">' + fmtDate(t.time) + '</div>' +
          '<div class="timeline-content"><p>' + esc(t.stage || '') + '</p>' + (t.memo ? '<p class="muted" style="margin-top:4px">' + esc(t.memo) + '</p>' : '') +
          '<button class="mini-del" data-act="delCustProgress" data-id="' + esc(t.id) + '">删除</button></div></div>';
      }).join('') || '<div class="net-empty">暂无沟通记录。</div>';
      return '<div class="overlay open" id="custOverlay"><div class="detail cust-detail"><div class="detail-head"><div class="detail-title">编辑客户</div><div class="head-actions"><button class="btn ghost danger" data-act="delCust" data-id="' + c.id + '">删除</button><button class="btn ghost" data-act="closeCust">关闭</button></div></div>' +
        '<div class="detail-body cust-detail-body"><div>' +
        '<div class="detail-section"><label>客户公司 / 名称</label><input class="input" id="cName" value="' + esc(c.name || '') + '"></div>' +
        '<div class="detail-section"><label>阶段</label><select class="select" id="cStage">' + opts(CUST_STAGES, c.stage) + '</select></div>' +
        '<div class="detail-section"><label>合作状态</label><select class="select" id="cStatus">' + opts(CUST_STATUS, c.status) + '</select></div>' +
        '<div class="detail-section"><label>客户属性</label><select class="select" id="cAttr">' + opts(CUST_ATTRS, c.attr) + '</select></div>' +
        '<div class="detail-section"><label>渠道类型</label><select class="select" id="cChannel">' + opts(CUST_CHANNELS, c.channel) + '</select></div>' +
        '<div class="detail-section"><label>覆盖区域</label><input class="input" id="cRegion" value="' + esc(c.region || '') + '"></div>' +
        '<div class="detail-section"><label>渠道名及网点数</label><input class="input" id="cOutlets" value="' + esc(c.outlets || '') + '"></div>' +
        '<div class="detail-section"><label>合作模式</label><select class="select" id="cMode">' + opts(['现采', '试销', '无'], c.mode) + '</select></div>' +
        '<div class="detail-section"><label>寄样</label><select class="select" id="cSample">' + opts(['有', '无'], c.sample) + '</select></div>' +
        '<div class="detail-section"><label>拜访</label><select class="select" id="cVisited">' + opts(['已拜访', '未拜访'], c.visited) + '</select></div>' +
        '<div class="detail-section"><label>客户潜力</label><select class="select" id="cPotential">' + opts(CUST_POTENTIAL, c.potential) + '</select></div>' +
        '<div class="detail-section"><label>合作价格体系</label><input class="input" id="cPrice" value="' + esc(c.price || '') + '"></div>' +
        '<div class="detail-section"><label>合作品类</label><input class="input" id="cCategory" value="' + esc(c.category || '') + '"></div>' +
        '<div class="detail-section"><label>建联时间</label><input class="input" id="cConnect" value="' + esc(c.connectDate || '') + '"></div>' +
        '<div class="detail-section"><label>首单时间 / 预计合作时间</label><input class="input" id="cFirstDate" value="' + esc(c.firstDate || '') + '"></div>' +
        '<div class="detail-section"><label>首单金额 / 未合作核心问题</label><input class="input" id="cAmount" value="' + esc(c.amount || '') + '"></div>' +
        '<div class="detail-section"><label>最新进展记录（一句话）</label><input class="input" id="cProgress" value="' + esc(c.progress || '') + '"></div>' +
        '<div class="detail-section"><label>关联人脉</label><select class="select" id="cContact">' + linkOpts + '</select></div>' +
        '</div><div class="right-col">' +
        '<div class="detail-section"><label>负责人</label><input class="input" id="cOwner" value="' + esc(c.owner || '') + '"></div>' +
        '<div class="detail-section"><label>联系人</label><input class="input" id="cPerson" value="' + esc(c.person || '') + '"></div>' +
        '<div class="detail-section"><label>电话 / 微信</label><input class="input" id="cPhone" value="' + esc(c.phone || '') + '"></div>' +
        '<div class="detail-section"><label>目前复购</label><input class="input" id="cRepurchase" value="' + esc(c.repurchase || '') + '"></div>' +
        '<div class="detail-section"><label>添加沟通记录（保存到时间线）</label><div class="grid cols-2">' +
          '<input class="input" id="cTlStage" placeholder="阶段，如：已拜访">' +
          '<input class="input" id="cTlMemo" placeholder="进度…">' +
          '</div><button class="btn" style="margin-top:8px" data-act="addCustProgress" data-id="' + c.id + '">保存记录</button></div>' +
        '<div class="detail-section"><label>沟通时间线</label><div class="timeline">' + tl + '</div></div>' +
        '<button class="btn primary save-btn" data-act="saveCust" data-id="' + c.id + '">保存修改</button>' +
        '</div></div></div></div>';
    },
    contactName: function (s, cid) {
      var c = s.contacts.find(function (x) { return x.id === cid; });
      return c ? (c.company ? c.company + ' · ' + c.name : c.name) : '';
    },
    contactOptions: function (s, p) {
      var existing = (p.contacts || []).reduce(function (m, cid) { m[cid] = 1; return m; }, {});
      var opts = '<option value="">选择人脉…</option>';
      s.contacts.forEach(function (c) {
        if (existing[c.id]) return;
        var label = c.company ? c.company + ' · ' + c.name : c.name;
        var info = [c.company, c.name, c.role, c.brands, (c.channels || []).join(' '), c.location].join(' ').toLowerCase();
        opts += '<option value="' + esc(c.id) + '" data-info="' + esc(info) + '">' + esc(label) + '</option>';
      });
      return opts;
    },
    relatedProjectNames: function (s, cid) {
      return s.project.filter(function (p) { return (p.contacts || []).indexOf(cid) >= 0; }).map(function (p) { return p.name; });
    },
    acts: {
      add: function () {
        var v = document.getElementById('pName').value.trim(); if (!v) return;
        state.project.unshift({
          id: S.uid(), name: v, cat: normalizeProjectCat(document.getElementById('pCat').value),
          status: 'doing', created: Date.now(), updatedAt: Date.now(), lastAccessed: Date.now(),
          overview: '', contacts: [], progress: [], subs: [], customers: []
        });
        saveRender();
      },
      projTab: function (el) { Project._projTab = el.dataset.t; renderPage('project'); },
      custAttr: function (el) { Project._custAttr = el.dataset.v; renderPage('project'); },
      custStage: function (el) { Project._custStage = el.dataset.v || null; renderPage('project'); },
      custTabToggle: function () { Project._custTab = Project._custTab === 'board' ? 'list' : 'board'; renderPage('project'); },
      importCustTemplate: function (el) {
        var p = state.project.find(function (x) { return x.id === el.dataset.pid; }); if (!p) return;
        var tpl = (window.CIROA_CUSTOMERS || []);
        if (!tpl.length) { toast('未找到模板数据'); return; }
        if (p.customers && p.customers.length && !ask('该项目已有 ' + p.customers.length + ' 条客户，确认追加导入模板清单（可能与现有重复）？')) return;
        var now = Date.now();
        tpl.forEach(function (c) {
          p.customers.push({
            id: S.uid(), name: c.name, person: c.person || '', phone: c.phone || '',
            attr: c.attr || '', channel: c.channel || '', region: c.region || '', outlets: c.outlets || '',
            mode: c.mode || '', sample: c.sample || '', visited: c.visited || '', status: c.status || '已建联沟通中',
            stage: c.stage || '跟进中', price: c.price || '', firstDate: c.firstDate || '', amount: c.amount || '',
            progress: c.progress || '', category: c.category || '', connectDate: c.connectDate || '',
            repurchase: c.repurchase || '', potential: c.potential || '', owner: c.owner || '史霖',
            contactId: '', timeline: [], created: now, updatedAt: now
          });
        });
        p.updatedAt = now;
        saveRender();
        toast('已导入 ' + tpl.length + ' 条客户');
      },
      addCust: function (el) {
        var p = state.project.find(function (x) { return x.id === el.dataset.pid; }); if (!p) return;
        p.customers = p.customers || [];
        var now = Date.now();
        p.customers.unshift({ id: S.uid(), name: '', person: '', owner: '史霖', stage: '跟进中', status: '已建联沟通中', attr: '代理商/经销商', timeline: [], created: now, updatedAt: now });
        p.updatedAt = now;
        Project._custDetailId = p.customers[0].id;
        renderPage('project');
      },
      openCust: function (el) { Project._custDetailId = el.dataset.id; renderPage('project'); },
      closeCust: function () { Project._custDetailId = null; renderPage('project'); },
      saveCust: function (el) {
        var id = el.dataset.id || Project._custDetailId; if (!id) return;
        var p = state.project.find(function (x) { return x.id === Project._detailId; }); if (!p) return;
        var c = (p.customers || []).find(function (x) { return x.id === id; }); if (!c) return;
        var name = document.getElementById('cName').value.trim();
        if (!name) { toast('客户名称不能为空'); return; }
        c.name = name;
        c.stage = document.getElementById('cStage').value;
        c.status = document.getElementById('cStatus').value;
        c.attr = document.getElementById('cAttr').value;
        c.channel = document.getElementById('cChannel').value;
        c.region = document.getElementById('cRegion').value.trim();
        c.outlets = document.getElementById('cOutlets').value.trim();
        c.mode = document.getElementById('cMode').value;
        c.sample = document.getElementById('cSample').value;
        c.visited = document.getElementById('cVisited').value;
        c.potential = document.getElementById('cPotential').value;
        c.price = document.getElementById('cPrice').value.trim();
        c.category = document.getElementById('cCategory').value.trim();
        c.connectDate = document.getElementById('cConnect').value.trim();
        c.firstDate = document.getElementById('cFirstDate').value.trim();
        c.amount = document.getElementById('cAmount').value.trim();
        c.progress = document.getElementById('cProgress').value.trim();
        c.owner = document.getElementById('cOwner').value.trim();
        c.person = document.getElementById('cPerson').value.trim();
        c.phone = document.getElementById('cPhone').value.trim();
        c.repurchase = document.getElementById('cRepurchase').value.trim();
        c.contactId = document.getElementById('cContact').value || '';
        c.updatedAt = Date.now();
        p.updatedAt = Date.now();
        Project._custDetailId = null;
        saveRender();
        toast('已保存');
      },
      delCust: function (el) {
        var id = el.dataset.id || Project._custDetailId; if (!id) return;
        if (!ask('删除该客户？')) return;
        var p = state.project.find(function (x) { return x.id === Project._detailId; }); if (!p) return;
        p.customers = (p.customers || []).filter(function (x) { return x.id !== id; });
        p.updatedAt = Date.now();
        Project._custDetailId = null;
        saveRender();
        toast('已删除');
      },
      addCustProgress: function (el) {
        var id = el.dataset.id; if (!id) return;
        var p = state.project.find(function (x) { return x.id === Project._detailId; }); if (!p) return;
        var c = (p.customers || []).find(function (x) { return x.id === id; }); if (!c) return;
        var stage = document.getElementById('cTlStage').value.trim(); if (!stage) return;
        c.timeline = c.timeline || [];
        c.timeline.push({ id: S.uid(), time: Date.now(), stage: stage, memo: document.getElementById('cTlMemo').value.trim() });
        c.updatedAt = Date.now();
        p.updatedAt = Date.now();
        saveRender();
        toast('已保存记录');
      },
      delCustProgress: function (el) {
        var id = el.dataset.id; if (!id) return;
        var p = state.project.find(function (x) { return x.id === Project._detailId; }); if (!p) return;
        var c = (p.customers || []).find(function (x) { return x.id === Project._custDetailId; }); if (!c) return;
        c.timeline = (c.timeline || []).filter(function (t) { return t.id !== id; });
        c.updatedAt = Date.now();
        p.updatedAt = Date.now();
        saveRender();
      },
      openProject: function (el) {
        var p = state.project.find(function (x) { return x.id === el.dataset.id; }); if (!p) return;
        Project._detailId = el.dataset.id; Project._projTab = 'overview'; Project._custStage = null;
        p.lastAccessed = Date.now();
        S.save(false);
        renderPage('project');
      },
      closeProject: function () { Project._detailId = null; Project._custStage = null; Project._projTab = 'overview'; renderPage('project'); },
      saveProject: function () {
        var id = Project._detailId; if (!id) return;
        var p = state.project.find(function (x) { return x.id === id; }); if (!p) return;
        var name = document.getElementById('dProjectName').value.trim();
        if (!name) { toast('项目名称不能为空'); return; }
        p.name = name;
        p.overview = document.getElementById('dProjectOverview').value.trim();
        p.cat = normalizeProjectCat(document.getElementById('dProjectCat').value);
        p.status = document.getElementById('dProjectStatus').value;
        p.updatedAt = Date.now();
        saveRender();
        toast('已保存');
      },
      delProject: function (el) {
        var id = el.dataset.id || Project._detailId;
        if (!id) return;
        if (!ask('删除该项目及其所有进展、子任务、客户？')) return;
        state.project = state.project.filter(function (x) { return x.id !== id; });
        if (Project._detailId === id) Project._detailId = null;
        saveRender();
        toast('已删除');
      },
      addProjectContact: function (el) {
        var p = state.project.find(function (x) { return x.id === el.dataset.pid; }); if (!p) return;
        var cid = document.getElementById('projectContactSelect').value; if (!cid) return;
        p.contacts = p.contacts || [];
        if (p.contacts.indexOf(cid) < 0) p.contacts.push(cid);
        p.updatedAt = Date.now();
        saveRender();
        toast('已关联人脉');
      },
      delProjectContact: function (el) {
        var p = state.project.find(function (x) { return x.id === el.dataset.pid; }); if (!p) return;
        p.contacts = (p.contacts || []).filter(function (x) { return x.id !== el.dataset.cid; });
        p.updatedAt = Date.now();
        saveRender();
        toast('已移除关联');
      }
    },
    onRender: function () {
      var self = this;
      var ov = document.getElementById('projectOverlay');
      if (ov) ov.addEventListener('click', function (e) { if (e.target.id === 'projectOverlay') { self._detailId = null; self._custStage = null; self._projTab = 'overview'; renderPage('project'); } });
      var cv = document.getElementById('custOverlay');
      if (cv) cv.addEventListener('click', function (e) { if (e.target.id === 'custOverlay') { self._custDetailId = null; renderPage('project'); } });
      // 客户搜索（保留焦点与光标）
      var csearch = document.getElementById('custSearch');
      if (csearch) {
        csearch.addEventListener('input', function () {
          self._custSearch = csearch.value;
          renderPage('project');
          var next = document.getElementById('custSearch');
          if (next) { next.focus(); next.setSelectionRange(csearch.value.length, csearch.value.length); }
        });
      }
      // 关联人脉搜索过滤
      var searchInput = document.getElementById('projectContactSearch');
      var select = document.getElementById('projectContactSelect');
      if (searchInput && select) {
        searchInput.addEventListener('input', function () {
          var q = searchInput.value.trim().toLowerCase();
          Array.prototype.forEach.call(select.options, function (o) {
            if (!o.value) { o.style.display = ''; return; }
            var text = (o.textContent || '').toLowerCase();
            var info = (o.getAttribute('data-info') || '').toLowerCase();
            o.style.display = (text.indexOf(q) >= 0 || info.indexOf(q) >= 0) ? '' : 'none';
          });
        });
      }
    }
  };

  // ---- 通用简单列表工厂（战略/人脉/沉淀/成长/复盘） ----
  function simpleModule(cfg) {
    return {
      key: cfg.key, label: cfg.label, icon: cfg.icon,
      render: function (s) {
        var arr = s[cfg.key] || [];
        var inner = cfg.renderList(arr, s);
        var form = cfg.form();
        return section(cfg.title, cfg.desc, '') +
          '<div class="card">' + form + '</div>' +
          '<div class="card"><h2>' + esc(cfg.listTitle || '列表') + '</h2>' + (inner || '<div class="empty">暂无内容</div>') + '</div>';
      },
      acts: cfg.acts
    };
  }

  var Strategy = simpleModule({
    key: 'strategy', title: '战略', desc: '方向 / 打法 / 判断', label: '战略', icon: '⚑', listTitle: '战略清单',
    form: function () {
      return '<div class="grid cols-2"><div class="field" style="margin:0"><label>主题</label><input class="input" id="stTitle" placeholder="如：日系日化进口中长期策略"></div>' +
        '<div class="field" style="margin:0"><label>状态</label><select class="select" id="stStatus"><option>思考中</option><option>已定</option><option>执行中</option></select></div>' +
        '<div class="field" style="margin:0 0 12px"><label>内容</label><textarea class="textarea" id="stContent" placeholder="核心判断、打法…"></textarea></div>' +
        '<div style="display:flex;justify-content:flex-end"><button class="btn" data-act="add">保存</button></div></div>';
    },
    renderList: function (arr) {
      return arr.slice().reverse().map(function (x) {
        var stCls = x.status === '已定' || x.status === '执行中' ? 'green' : 'gray';
        return '<div class="item"><div class="body"><div class="title">' + esc(x.title) + ' <span class="tag ' + stCls + '">' + esc(x.status || '') + '</span></div>' +
          (x.content ? '<div class="muted" style="margin-top:4px;white-space:pre-wrap">' + esc(x.content) + '</div>' : '') + '</div>' +
          '<button class="x" data-act="del" data-id="' + x.id + '">✕</button></div>';
      }).join('');
    },
    acts: {
      add: function () {
        var v = document.getElementById('stTitle').value.trim(); if (!v) return;
        state.strategy.unshift({ id: S.uid(), title: v, content: document.getElementById('stContent').value.trim(), status: document.getElementById('stStatus').value, created: Date.now() });
        saveRender();
      },
      del: function (el) { if (ask('删除？')) { state.strategy = state.strategy.filter(function (x) { return x.id !== el.dataset.id; }); saveRender(); } }
    }
  });

  /* ================= 人脉（完整模块：资源视图 + 关系网络） ================= */
  var BRANCHES = [
    { key: 'client', label: '客户（下游）', color: 'blue' },
    { key: 'brand', label: '品牌方 / 厂家（上游）', color: 'teal' },
    { key: 'peer', label: '同行及行业人士（业内）', color: 'amber' },
    { key: 'internal', label: '公司及合作伙伴（内部）', color: 'purple' }
  ];
  var TAG_NAMES = { client: '客户', brand: '品牌方', peer: '同行', internal: '内部' };
  var TAG_COLORS = { client: 'blue', brand: 'teal', peer: 'amber', internal: 'purple' };
  var IDENTITY_COLORS = { client: '#4a90e2', brand: '#1abc9c', peer: '#f5a623', internal: '#9b59b6' };
  var CHANNEL_PALETTE = ['#4a90e2', '#1abc9c', '#f5a623', '#9b59b6', '#e74c3c', '#27ae60', '#16a085', '#8e44ad', '#2c3e50', '#d35400', '#2980b9', '#c0392b'];
  var ATTR_PALETTE = ['#1abc9c', '#4a90e2', '#f5a623', '#9b59b6'];
  var IDENTITY_FILTERS = ['终端', '代理 / 经销商', '品牌方 / 厂家'];
  var ALL_CHANNELS = ['线下精商超', '线下传统 KA', '线下便利', '线下传统 CS', '线下新零售', '线下特渠', '线下生活方式', '即时零售', '线上平台旗舰店', '线上平台自营店', '线上私域', '线上特渠'];

  var Contacts = {
    key: 'contacts', label: '人脉', icon: '☻',
    _tab: 'list', _branch: null, _search: '', _attrs: {}, _netSearch: '', _showKw: true, _showRel: true, _detailId: null,
    // 图谱运行态（跨 render 保持坐标稳定）
    _netNodes: [], _netLinks: [], _netAdj: {}, _netPos: {}, _netSel: null,
    _netRAF: 0, _netAlpha: 1, _netRunning: false, _dragNode: null, _moved: false, _downPos: null,
    _panning: false, _panStart: null,
    _netScale: 1, _netPan: { x: 0, y: 0 }, _netPinchDist: 0, _netPinchScale: 1,
    _VW: 760, _VH: 460,

    render: function (s) {
      var inner = (this._tab === 'graph' ? this.renderGraph(s) : this.renderList(s)) + this.renderOverlay(s);
      var tabs = '<div class="view-tabs">' +
        '<button class="tab-btn ' + (this._tab === 'list' ? 'active' : '') + '" data-act="tab" data-view="list">人脉资源</button>' +
        '<button class="tab-btn ' + (this._tab === 'graph' ? 'active' : '') + '" data-act="tab" data-view="graph">关系网络</button>' +
        '</div>';
      return section('人脉', '客户、品牌方、同行及内部伙伴的一体化管理', '') + tabs + inner;
    },

    /* ---------- 列表 / 资源视图 ---------- */
    renderList: function (s) {
      var total = s.contacts.length;
      var now = new Date();
      var ym = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
      var newThisMonth = s.contacts.filter(function (c) {
        var cd = c.created ? new Date(c.created) : null;
        return cd && (cd.getFullYear() + '-' + ('0' + (cd.getMonth() + 1)).slice(-2)) === ym;
      }).length;

      var regionOpts = Object.keys(window.REGION_DATA || {}).map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');

      function tagSpan(group, items, def) {
        return items.map(function (t) {
          var active = def && def.indexOf(t) >= 0 ? ' active' : '';
          return '<span class="tag' + active + '" data-toggle="' + group + '" data-val="' + esc(t) + '">' + esc(t) + '</span>';
        }).join('');
      }

      var form =
        '<div class="card"><h3 class="section-title">新建并录入</h3>' +
        '<div class="form-grid">' +
        '<div><label>公司名</label><input class="input" id="cCompany" placeholder="例如：上海泓弈商贸有限公司"></div>' +
        '<div><label>姓名</label><input class="input" id="cName" placeholder="对接人姓名"></div>' +
        '<div><label>角色 / 职务</label><input class="input" id="cRole" placeholder="例如：采购负责人"></div>' +
        '<div><label>电话</label><input class="input" id="cPhone" placeholder="手机号 / 微信"></div>' +
        '<div class="full"><label>所在地（省 - 地级市，可点选）</label>' +
        '<div style="display:flex;gap:10px"><select class="select" id="cProvince" style="flex:1"><option value="">选择省份</option>' + regionOpts + '</select>' +
        '<select class="select" id="cCity" style="flex:1"><option value="">选择城市</option></select></div></div>' +
        '</div>' +
        '<div style="margin-top:14px"><label>身份标签（多选）</label><div class="tag-group" id="cIdTags">' +
        BRANCHES.map(function (b) { return '<span class="tag" data-toggle="tag" data-val="' + b.key + '">' + b.label + '</span>'; }).join('') + '</div></div>' +
        '<div style="margin-top:14px"><label>公司属性（多选）</label><div class="tag-group" id="cAttrTags">' +
        tagSpan('attr', ['品牌方 / 厂家', '代理 / 经销商', '流通商', '终端']) + '</div></div>' +
        '<div style="margin-top:14px"><label>主要渠道（多选）</label><div class="tag-group" id="cChannelTags">' +
        tagSpan('channel', ALL_CHANNELS) + '</div></div>' +
        '<div style="margin-top:14px"><label>主营品牌 / 品类</label><input class="input" id="cBrands" placeholder="例如：本客 洁面 / ciroa 护肤"></div>' +
        '<div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end"><button class="btn primary" data-act="addContact">保存</button></div>' +
        '</div>';

      var overview =
        '<div class="card"><h3 class="section-title">总览</h3><div class="overview">' +
        '<div class="stat"><div class="num">' + total + '</div><div class="label">总人脉数</div></div>' +
        '<div class="stat"><div class="num">' + newThisMonth + '</div><div class="label">本月新增</div></div>' +
        '</div></div>';

      var dist =
        '<div class="section-title" style="margin:16px 0 0;">数据分布</div>' +
        '<div class="dist-grid">' +
        '<div class="card primary"><h4>按主要渠道</h4><p class="hint-key">核心维度</p><div class="pie-wrap" id="pieChannel"></div></div>' +
        '<div class="stack">' +
        '<div class="card"><h4>按身份标签</h4><div class="pie-wrap" id="pieIdentity"></div></div>' +
        '<div class="card"><h4>按公司属性</h4><div class="pie-wrap" id="pieAttr"></div></div>' +
        '</div></div>';

      var filter =
        '<div class="card" style="margin-top:16px"><div class="filter-bar">' +
        '<input class="input search" id="searchInput" type="text" placeholder="搜索公司名 / 姓名 / 职务 / 品牌 / 渠道…" value="' + esc(this._search) + '">' +
        '<div class="tag-group" id="attrFilters">' +
        IDENTITY_FILTERS.map(function (a) { return '<span class="tag' + (this._attrs[a] ? ' sel' : '') + '" data-attr="' + esc(a) + '">' + esc(a) + '</span>'; }, this).join('') +
        '</div></div></div>';

      var branchUI;
      if (this._branch) {
        var bInfo = BRANCHES.find(function (b) { return b.key === this._branch; }, this);
        var bCount = s.contacts.filter(function (d) { return (d.tags || []).indexOf(bInfo.key) >= 0; }).length;
        branchUI =
          '<div class="card"><div class="branch-detail-head">' +
          '<button class="btn ghost sm" data-act="closeBranch">← 返回总览</button>' +
          '<div style="font-weight:600">' + bInfo.label + ' · ' + bCount + ' 人</div>' +
          '</div></div>' + filter + '<div class="branch-detail-list" id="branches"></div>';
      } else {
        branchUI = '<div class="branch-grid" id="branches"></div>';
      }

      return form + overview + dist + branchUI;
    },

    renderBranches: function (s) {
      var el = document.getElementById('branches'); if (!el) return;
      var self = this;
      function matchFilter(d) {
        if (Object.keys(self._attrs).some(function (a) { return self._attrs[a]; }) &&
          !IDENTITY_FILTERS.some(function (a) { return self._attrs[a] && (d.attrs || []).indexOf(a) >= 0; })) return false;
        if (self._search) {
          var hay = [d.company, d.name, d.role, d.brands, d.location, (d.tags || []).join(' '), (d.attrs || []).join(' '), (d.channels || []).join(' '), d.last].join(' ').toLowerCase();
          if (hay.indexOf(self._search) < 0) return false;
        }
        return true;
      }
      // 入口卡片总览
      if (!self._branch) {
        el.innerHTML = BRANCHES.map(function (b) {
          var items = s.contacts.filter(function (d) { return (d.tags || []).indexOf(b.key) >= 0; });
          var recent = items.slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); }).slice(0, 3);
          var listHtml = recent.length === 0
            ? '<div class="branch-card-empty">暂无</div>'
            : recent.map(function (it) {
                return '<div class="branch-card-row"><span class="company">' + esc(it.company) + '</span><span class="name">' + esc(it.name) + '</span></div>';
              }).join('');
          return '<div class="branch-card" data-act="openBranch" data-key="' + b.key + '">' +
            '<div class="branch-card-head" style="background:var(--' + b.color + '-soft)">' +
            '<span class="dot" style="background:var(--' + b.color + ')"></span>' +
            '<span class="label">' + b.label + '</span>' +
            '<span class="count">' + items.length + ' 人</span>' +
            '</div>' +
            '<div class="branch-card-body">' + listHtml + '</div>' +
            '<div class="branch-card-foot">点击进入 →</div>' +
            '</div>';
        }).join('');
        return;
      }
      // 单分支详情列表
      var bInfo = BRANCHES.find(function (b) { return b.key === self._branch; });
      var items = s.contacts.filter(function (d) { return (d.tags || []).indexOf(self._branch) >= 0; }).filter(matchFilter);
      items.sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
      el.innerHTML = (items.length === 0 ? '<div class="card"><div class="empty" style="padding:24px">该分支下暂无匹配的人脉。</div></div>' :
        items.map(function (it) {
          return '<div class="card branch-detail-item" data-act="openContact" data-id="' + it.id + '">' +
            '<div class="row-between" style="align-items:flex-start">' +
            '<div>' +
            '<div style="font-weight:600;font-size:14px">' + esc(it.company) + ' · ' + esc(it.name) + '</div>' +
            '<div class="muted" style="margin-top:4px">' + esc(it.role || '') + (it.location ? ' · ' + esc(it.location) : '') + '</div>' +
            '<div class="muted" style="margin-top:4px">' + esc((it.channels || []).join(' / ') || '未填渠道') + '</div>' +
            '</div>' +
            '<div style="text-align:right;flex-shrink:0">' +
            (it.attrs || []).map(function (a) { return '<span class="tag sm">' + esc(a) + '</span>'; }).join('') +
            '</div></div>' +
            (it.last ? '<div class="branch-item-last">' + esc(it.last) + '</div>' : '') +
            '</div>';
        }).join(''));
    },

    /* ---------- 饼图 ---------- */
    countBy: function (s, key) {
      var m = {};
      s.contacts.forEach(function (d) { (d[key] || []).forEach(function (v) { m[v] = (m[v] || 0) + 1; }); });
      return m;
    },
    toEntries: function (map, labelFn, colorFn) {
      return Object.keys(map).filter(function (k) { return map[k] > 0; }).sort(function (a, b) { return map[b] - map[a]; })
        .map(function (k, i) { return { label: labelFn(k), value: map[k], color: colorFn(k, i) }; });
    },
    makePie: function (entries, size, centerLabel) {
      var cx = size / 2, cy = size / 2, r = size / 2 - 4;
      var total = entries.reduce(function (s, e) { return s + e.value; }, 0);
      var angle = -Math.PI / 2, slices = '';
      if (entries.length === 0) {
        slices = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#eef1f5"/>';
      } else if (entries.length === 1) {
        slices = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + entries[0].color + '"/>';
      } else {
        entries.forEach(function (e) {
          var a0 = angle, a1 = angle + (e.value / total) * Math.PI * 2;
          var x1 = cx + r * Math.cos(a0), y1 = cy + r * Math.sin(a0);
          var x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
          var large = (a1 - a0) > Math.PI ? 1 : 0;
          slices += '<path d="M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z" fill="' + e.color + '"/>';
          angle = a1;
        });
      }
      var center = centerLabel ? '<text x="' + cx + '" y="' + (cy - 3) + '" text-anchor="middle" font-size="' + (size * 0.20).toFixed(0) + '" font-weight="600" fill="#1f2329">' + total + '</text><text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="' + (size * 0.11).toFixed(0) + '" fill="#8b95a5">' + centerLabel + '</text>' : '';
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + slices + center + '</svg>';
    },
    makeLegend: function (entries) {
      return '<div class="pie-legend">' + entries.map(function (e) {
        return '<div class="pie-leg-row"><span class="dot" style="background:' + e.color + '"></span><span class="lbl" title="' + esc(e.label) + '">' + esc(e.label) + '</span><span class="val">' + e.value + '</span></div>';
      }).join('') + '</div>';
    },
    renderPies: function (s) {
      var ch = document.getElementById('pieChannel'); if (ch) ch.innerHTML = this.makePie(this.toEntries(this.countBy(s, 'channels'), function (k) { return k; }, function (k, i) { return CHANNEL_PALETTE[i % CHANNEL_PALETTE.length]; }), 200, '渠道') + this.makeLegend(this.toEntries(this.countBy(s, 'channels'), function (k) { return k; }, function (k, i) { return CHANNEL_PALETTE[i % CHANNEL_PALETTE.length]; }));
      var id = document.getElementById('pieIdentity'); if (id) id.innerHTML = this.makePie(this.toEntries(this.countBy(s, 'tags'), function (k) { return (TAG_NAMES[k] || k) + '（下游/上游/业内/内部）'; }, function (k) { return IDENTITY_COLORS[k] || '#888'; }), 150, '') + this.makeLegend(this.toEntries(this.countBy(s, 'tags'), function (k) { return TAG_NAMES[k] || k; }, function (k) { return IDENTITY_COLORS[k] || '#888'; }));
      var at = document.getElementById('pieAttr'); if (at) at.innerHTML = this.makePie(this.toEntries(this.countBy(s, 'attrs'), function (k) { return k; }, function (k, i) { return ATTR_PALETTE[i % ATTR_PALETTE.length]; }), 150, '') + this.makeLegend(this.toEntries(this.countBy(s, 'attrs'), function (k) { return k; }, function (k, i) { return ATTR_PALETTE[i % ATTR_PALETTE.length]; }));
    },

    /* ---------- 关系网络（力导向图谱） ---------- */
    renderGraph: function (s) {
      return '<div class="card" style="margin-top:16px"><h3 class="section-title">人脉关系网络（关联视图）</h3>' +
        '<p style="font-size:12px;color:var(--ink-soft);margin:-4px 0 12px;line-height:1.5">' +
        '圆点=人脉（按身份着色）、方块=公司。关联来自三处：<b>实线蓝</b>=你手动定义的关系（合作/竞争/上下游等，存进该人脉的「关联」字段并同步）；<b>橙点线</b>=系统从你备忘/时间线里自动抽取的共同提及（如两人都提到「胖东来」「apio」才连线，避免宽泛关联）；<b>细灰线</b>=隶属公司。点击节点看关联、可拖拽、搜索高亮；双指可缩放，空白处可拖动画布。</p>' +
        '<div class="net-controls">' +
        '<input class="input search" id="netSearch" type="text" placeholder="在图谱中搜索公司 / 姓名…" value="' + esc(this._netSearch) + '">' +
        '<div class="net-zoom"><button class="btn sm ghost" data-act="netZoomOut">−</button><span id="netZoomVal">' + Math.round(this._netScale * 100) + '%</span><button class="btn sm ghost" data-act="netZoomIn">+</button><button class="btn sm ghost" data-act="netZoomReset">重置</button></div>' +
        '<label><input type="checkbox" id="netKwToggle" ' + (this._showKw ? 'checked' : '') + ' style="width:auto"> 备忘关键词关联</label>' +
        '<label><input type="checkbox" id="netRelToggle" ' + (this._showRel ? 'checked' : '') + ' style="width:auto"> 手动关联</label>' +
        '</div>' +
        '<div class="net-wrap"><div class="net-canvas"><svg id="netSvg" viewBox="0 0 760 460" preserveAspectRatio="xMidYMid meet"></svg></div>' +
        '<div class="net-side" id="netSide"></div></div>' +
        '<div class="net-legend">' +
        '<div class="li"><span class="sw" style="background:#4a90e2"></span>客户</div>' +
        '<div class="li"><span class="sw" style="background:#1abc9c"></span>品牌方</div>' +
        '<div class="li"><span class="sw" style="background:#f5a623"></span>同行</div>' +
        '<div class="li"><span class="sw" style="background:#9b59b6"></span>内部</div>' +
        '<div class="li"><span class="sw" style="background:#cfd6e0"></span>公司</div>' +
        '<div class="li"><span class="sw" style="background:#4a90e2"></span>实线=定义关系</div>' +
        '<div class="li"><span class="sw" style="background:#d8dde4"></span>细线=隶属公司</div>' +
        '<div class="li"><span class="sw" style="background:#f5a623"></span>橙点线=备忘关键词关联</div>' +
        '</div></div>';
    },
    extractTerms: function (d) {
      var text = [d.last, (d.timeline || []).map(function (t) { return t.t; }).join(' '), d.company].join(' ').toLowerCase();
      var kw = window.NET_KEYWORDS || [];
      return kw.filter(function (k) { return text.indexOf(k.toLowerCase()) >= 0; });
    },
    buildGraph: function (s) {
      var self = this, compId = function (c) { return 'co:' + c; };
      var comps = {};
      s.contacts.forEach(function (d) { if (!comps[d.company]) comps[d.company] = { id: compId(d.company), name: d.company, type: 'company' }; });
      this._netNodes = s.contacts.map(function (d) {
        return { id: 'p:' + d.id, name: d.name, company: d.company, type: 'person', color: (IDENTITY_COLORS[(d.tags || [])[0]] || '#888'), deg: 0 };
      });
      Object.keys(comps).forEach(function (c) { self._netNodes.push({ id: comps[c].id, name: comps[c].name, company: comps[c].name, type: 'company', color: '#cfd6e0', deg: 0 }); });
      this._netLinks = [];
      s.contacts.forEach(function (d) { self._netLinks.push({ s: 'p:' + d.id, t: compId(d.company), kind: 'aff' }); });
      if (this._showRel) {
        var manualPairs = {};
        s.contacts.forEach(function (d) { (d.relations || []).forEach(function (r) { if (r.to && r.to.indexOf('co:') === 0) manualPairs[(d.id + '|' + r.to)] = true; else manualPairs[([d.id, r.to].sort()).join('|')] = true; }); });
        s.contacts.forEach(function (d) {
          (d.relations || []).forEach(function (r) {
            if (r.to && r.to.indexOf('co:') === 0) self._netLinks.push({ s: 'p:' + d.id, t: r.to, kind: 'rel', label: r.type });
            else if (r.to) self._netLinks.push({ s: 'p:' + d.id, t: 'p:' + r.to, kind: 'rel', label: r.type });
          });
        });
      }
      if (this._showKw) {
        var kwLabels = {};
        for (var i = 0; i < s.contacts.length; i++) for (var j = i + 1; j < s.contacts.length; j++) {
          var a = s.contacts[i], b = s.contacts[j];
          if (a.id > b.id) { var tmp = a; a = b; b = tmp; }
          var shared = this.extractTerms(a).filter(function (t) {
            return this.extractTerms(b).indexOf(t) >= 0 && (a.blockedKw || []).indexOf(t) < 0 && (b.blockedKw || []).indexOf(t) < 0;
          }, this);
          if (shared.length) { var k = a.id + '|' + b.id; (kwLabels[k] = kwLabels[k] || []).push.apply(kwLabels[k], shared); }
        }
        Object.keys(kwLabels).forEach(function (k) {
          var parts = k.split('|');
          self._netLinks.push({ s: 'p:' + parts[0], t: 'p:' + parts[1], kind: 'kw', label: Array.from(new Set(kwLabels[k])).join('·') });
        });
      }
      var byId = {}; this._netNodes.forEach(function (n) { byId[n.id] = n; });
      this._netLinks.forEach(function (l) { l.source = byId[l.s]; l.target = byId[l.t]; });
      var VW = this._VW, VH = this._VH;
      var self2 = this;
      this._netNodes.forEach(function (n) {
        if (self2._netPos[n.id]) { n.x = self2._netPos[n.id].x; n.y = self2._netPos[n.id].y; }
        else { n.x = VW / 2 + (Math.random() - 0.5) * 280; n.y = VH / 2 + (Math.random() - 0.5) * 200; }
        n.vx = 0; n.vy = 0;
      });
      this._netAdj = {}; this._netNodes.forEach(function (n) { self2._netAdj[n.id] = []; });
      this._netLinks.forEach(function (l) {
        if (!l.source || !l.target) return;
        l.source.deg++; l.target.deg++;
        self2._netAdj[l.source.id].push({ node: l.target, label: l.label, kind: l.kind });
        self2._netAdj[l.target.id].push({ node: l.source, label: l.label, kind: l.kind });
      });
    },
    netSimStep: function (alpha) {
      var VW = this._VW, VH = this._VH, nodes = this._netNodes, links = this._netLinks;
      var krep = 900, kspring = 0.02, rest = 62, kcenter = 0.02, damp = 0.82;
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        for (var j = i + 1; j < nodes.length; j++) {
          var b = nodes[j];
          var dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
          var f = krep / d2; a.vx += f * dx / d; a.vy += f * dy / d; b.vx -= f * dx / d; b.vy -= f * dy / d;
        }
      }
      links.forEach(function (l) {
        if (!l.source) return;
        var dx = l.target.x - l.source.x, dy = l.target.y - l.source.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        var f = kspring * (d - rest), fx = f * dx / d, fy = f * dy / d;
        l.source.vx += fx; l.source.vy += fy; l.target.vx -= fx; l.target.vy -= fy;
      });
      var self = this;
      nodes.forEach(function (n) {
        n.vx += (VW / 2 - n.x) * kcenter; n.vy += (VH / 2 - n.y) * kcenter;
        n.vx *= damp; n.vy *= damp;
        n.vx = Math.max(-20, Math.min(20, n.vx)); n.vy = Math.max(-20, Math.min(20, n.vy));
        n.x += n.vx * alpha; n.y += n.vy * alpha;
        n.x = Math.max(30, Math.min(VW - 30, n.x)); n.y = Math.max(22, Math.min(VH - 22, n.y));
        self._netPos[n.id] = { x: n.x, y: n.y };
      });
    },
    netLoop: function () {
      var self = this;
      if (this._netAlpha > 0.02) { this.netSimStep(this._netAlpha); this._netAlpha *= 0.95; this.renderNet(); this._netRAF = requestAnimationFrame(function () { self.netLoop(); }); }
      else { this._netRunning = false; this.renderNet(); }
    },
    netKick: function (a) {
      this._netAlpha = Math.max(this._netAlpha, a || 0.5);
      if (!this._netRunning) { this._netRunning = true; var self = this; this._netRAF = requestAnimationFrame(function () { self.netLoop(); }); }
    },
    matchNode: function (n) { if (!this._netSearch) return true; var q = this._netSearch; return (n.name || '').toLowerCase().indexOf(q) >= 0 || (n.company || '').toLowerCase().indexOf(q) >= 0; },
    renderNet: function () {
      var svg = '', self = this, VW = this._VW, VH = this._VH;
      svg += '<g transform="translate(' + this._netPan.x.toFixed(1) + ',' + this._netPan.y.toFixed(1) + ') scale(' + this._netScale.toFixed(3) + ')">';
      this._netLinks.forEach(function (l) {
        if (!l.source) return;
        var lsel = self._netSel && !(l.source.id === self._netSel || l.target.id === self._netSel);
        var lq = self._netSearch && !(self.matchNode(l.source) && self.matchNode(l.target));
        var cls = 'link ' + l.kind + ((lsel || lq) ? ' dim' : '');
        svg += '<line class="' + cls + '" x1="' + l.source.x.toFixed(1) + '" y1="' + l.source.y.toFixed(1) + '" x2="' + l.target.x.toFixed(1) + '" y2="' + l.target.y.toFixed(1) + '"/>';
        if ((l.kind === 'rel' || l.kind === 'kw') && l.label && !(lsel || lq)) {
          var mx = (l.source.x + l.target.x) / 2, my = (l.source.y + l.target.y) / 2;
          svg += '<text class="link-label" x="' + mx.toFixed(1) + '" y="' + (my - 3).toFixed(1) + '" text-anchor="middle">' + esc(l.label) + '</text>';
        }
      });
      this._netNodes.forEach(function (n) {
        var selDim = self._netSel && n.id !== self._netSel && !(self._netAdj[self._netSel] || []).some(function (r) { return r.node.id === n.id; });
        var qDim = self._netSearch && !self.matchNode(n);
        var dim = selDim || qDim, hl = n.id === self._netSel;
        var r = n.type === 'company' ? 9 + Math.min(6, n.deg) : 6 + Math.min(8, n.deg);
        var cls = 'node' + (dim ? ' dim' : '') + (hl ? ' hl' : '');
        if (n.type === 'company') {
          svg += '<g class="' + cls + '" data-id="' + n.id + '"><rect x="' + (n.x - r).toFixed(1) + '" y="' + (n.y - r / 1.6).toFixed(1) + '" width="' + (r * 2).toFixed(1) + '" height="' + (r * 1.3).toFixed(1) + '" rx="3" fill="' + n.color + '" stroke="#b8c0cc" stroke-width="1"/><text x="' + n.x.toFixed(1) + '" y="' + (n.y + r * 1.3 + 11).toFixed(1) + '" text-anchor="middle">' + esc(n.name) + '</text></g>';
        } else {
          svg += '<g class="' + cls + '" data-id="' + n.id + '"><circle cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + n.color + '"/><text x="' + n.x.toFixed(1) + '" y="' + (n.y + r + 11).toFixed(1) + '" text-anchor="middle">' + esc(n.name) + '</text></g>';
        }
      });
      svg += '</g>';
      var el = document.getElementById('netSvg'); if (el) el.innerHTML = svg;
    },
    selectNode: function (id) { this._netSel = id; this.renderNet(); this.renderNetSide(id); },
    renderNetSide: function (id) {
      var side = document.getElementById('netSide'); if (!side) return;
      var n = this._netNodes.find(function (x) { return x.id === id; });
      if (!n) { side.innerHTML = '<div class="net-empty">点击任意节点，查看其关联的人脉与公司；拖拽可调整布局，输入框可高亮搜索。</div>'; return; }
      var rels = this._netAdj[id] || [];
      var isPerson = n.type === 'person';
      var pid = isPerson ? n.id.slice(2) : null;
      var html = '<h4>' + esc(n.name) + '</h4>';
      if (isPerson) html += '<button class="btn primary" style="margin-bottom:8px;width:100%" data-act="openContact" data-id="' + pid + '">查看 / 编辑详情</button>';
      html += '<button class="btn" style="margin-bottom:12px;width:100%" data-act="addRelation" data-id="' + n.id + '">+ 添加关联</button>';
      html += '<div style="font-size:12px;color:var(--ink-soft);margin-bottom:8px">关联 ' + rels.length + ' 项</div>';
      if (rels.length === 0) html += '<div class="net-empty">暂无关联记录。</div>';
      rels.sort(function (a, b) { return (a.kind === 'rel' ? 0 : 1) - (b.kind === 'rel' ? 0 : 1); }).forEach(function (r) {
        var t = r.kind === 'aff' ? '隶属公司' : (r.kind === 'kw' ? ('共同提及「' + r.label + '」') : r.label);
        var btn = '';
        if (r.kind === 'kw') {
          var aId = n.id.indexOf('p:') === 0 ? n.id.slice(2) : '';
          var bId = r.node.id.indexOf('p:') === 0 ? r.node.id.slice(2) : '';
          btn = '<button class="mini-del" data-act="unblockKw" data-a="' + esc(aId) + '" data-b="' + esc(bId) + '" data-kw="' + esc(r.label) + '">不再关联</button>';
        }
        html += '<div class="rel-item ' + (r.kind === 'rel' || r.kind === 'kw' ? '' : ' weak') + '" data-go="' + r.node.id + '"><div class="rname">' + esc(r.node.name) + (r.node.type === 'company' ? '（公司）' : '') + '</div><div class="rtype">' + esc(t) + '</div>' + btn + '</div>';
      });
      side.innerHTML = html;
      var self = this;
      side.querySelectorAll('.rel-item[data-go]').forEach(function (el) {
        el.addEventListener('click', function (e) { if (e.target.closest('.mini-del')) return; self.selectNode(el.getAttribute('data-go')); });
      });
    },
    addRelationFrom: function (id) {
      var n = this._netNodes.find(function (x) { return x.id === id; }); if (!n) return;
      var target = window.prompt('输入要关联的对象名称（人名或公司名，可只输关键字）：'); if (!target) return;
      var type = window.prompt('关系类型，例如：合作 / 竞争 / 上下游 / 朋友：'); if (!type) return;
      var tnode = this._netNodes.find(function (x) { return (x.name || '').indexOf(target.trim()) >= 0; });
      if (!tnode) { window.alert('未找到该对象，请确认名称'); return; }
      var me = state.contacts.find(function (c) { return 'p:' + c.id === id; });
      if (!me) return;
      if (n.type === 'person' && tnode.type === 'person') {
        me.relations = me.relations || [];
        me.relations.push({ id: S.uid(), to: tnode.id.slice(2), type: type });
      } else if (n.type === 'company' && tnode.type === 'company') {
        me.relations = me.relations || [];
        me.relations.push({ id: S.uid(), to: 'co:' + tnode.name, type: type });
      } else { window.alert('暂仅支持「人对人」或「公司对司」关联'); return; }
      me.updatedAt = Date.now();
      saveRender();
    },
    toSvg: function (evt) {
      var el = document.getElementById('netSvg'); if (!el) return { x: 0, y: 0 };
      var pt = el.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
      var ctm = el.getScreenCTM(); if (!ctm) return { x: 0, y: 0 };
      var p = pt.matrixTransform(ctm.inverse());
      return { x: (p.x - this._netPan.x) / this._netScale, y: (p.y - this._netPan.y) / this._netScale };
    },
    setNetZoom: function (newScale, cx, cy) {
      newScale = Math.max(0.4, Math.min(4, newScale));
      var ratio = newScale / this._netScale;
      cx = cx == null ? this._VW / 2 : cx;
      cy = cy == null ? this._VH / 2 : cy;
      this._netPan.x = cx - (cx - this._netPan.x) * ratio;
      this._netPan.y = cy - (cy - this._netPan.y) * ratio;
      this._netScale = newScale;
      this.renderNet();
      var zv = document.getElementById('netZoomVal'); if (zv) zv.textContent = Math.round(newScale * 100) + '%';
    },
    resetNetView: function () {
      this._netScale = 1; this._netPan = { x: 0, y: 0 };
      this.renderNet();
      var zv = document.getElementById('netZoomVal'); if (zv) zv.textContent = '100%';
    },

    /* ---------- 详情弹窗 ---------- */
    renderOverlay: function (s) {
      var self = this;
      var d = this._detailId ? s.contacts.find(function (x) { return x.id === self._detailId; }) : null;
      if (!d) return '<div class="overlay" id="contactOverlay"></div>';
      var timeline = (d.timeline || []).slice().reverse().map(function (t) {
        return '<div class="timeline-item"><div class="timeline-date">' + esc(t.d || '') + '</div><div class="timeline-content"><p>' + esc(t.t) + '</p></div></div>';
      }).join('') || '<div class="net-empty">暂无沟通记录。</div>';

      function tagGroup(group, items, values, colorMap) {
        var gid = 'd' + group.charAt(0).toUpperCase() + group.slice(1) + 'Tags';
        return '<div class="tag-group" id="' + gid + '">' + items.map(function (it) {
          var val = typeof it === 'string' ? it : it.key;
          var text = typeof it === 'string' ? it : it.label;
          var on = values.indexOf(val) >= 0 ? ' active' : '';
          var colorClass = colorMap && colorMap[val] ? ' ' + colorMap[val] : '';
          return '<span class="tag' + colorClass + on + '" data-toggle="' + group + '" data-val="' + esc(val) + '">' + esc(text) + '</span>';
        }).join('') + '</div>';
      }

      var idTags = tagGroup('tag', BRANCHES, d.tags || [], TAG_COLORS);
      var attrTags = tagGroup('attr', ['品牌方 / 厂家', '代理 / 经销商', '流通商', '终端'], d.attrs || []);
      var channelTags = tagGroup('channel', ALL_CHANNELS, d.channels || []);

      var rels = (d.relations || []).map(function (r) {
        var tname = r.to && r.to.indexOf('co:') === 0 ? r.to.slice(3) : (state.contacts.find(function (c) { return c.id === r.to; }) || {}).name || r.to;
        return '<div class="rel-item"><div class="rname">' + esc(tname) + '</div><div class="rtype">' + esc(r.type || '关联') + '</div>' +
          '<button class="mini-del" data-act="delRelation" data-id="' + d.id + '" data-rid="' + r.id + '">解除</button></div>';
      }).join('') || '<div class="net-empty">暂无手动关联。在「关系网络」中可添加。</div>';

      var relatedProjects = state.project.filter(function (p) { return (p.contacts || []).indexOf(d.id) >= 0; });
      var relatedProjectsHtml = relatedProjects.length ? relatedProjects.map(function (p) {
        return '<div class="rel-item" data-act="goProject" data-id="' + p.id + '"><div class="rname">' + esc(p.name) + '</div><div class="rtype">' + esc(p.cat || '项目') + ' · ' + (PROJECT_STATUS[p.status] || p.status || '进行中') + '</div></div>';
      }).join('') : '<div class="net-empty">暂无关联项目。在「项目」卡片中添加关联即可自动显示。</div>';

      var form =
        '<div class="detail-section"><h4>基本信息</h4>' +
        '<div class="field-row"><label>公司名</label><input class="input" id="dCompany" value="' + esc(d.company || '') + '"></div>' +
        '<div class="field-row"><label>姓名</label><input class="input" id="dName" value="' + esc(d.name || '') + '"></div>' +
        '<div class="field-row"><label>角色</label><input class="input" id="dRole" value="' + esc(d.role || '') + '"></div>' +
        '<div class="field-row"><label>电话</label><input class="input" id="dPhone" value="' + esc(d.phone || '') + '"></div>' +
        '<div class="field-row"><label>所在地</label><input class="input" id="dLocation" value="' + esc(d.location || '') + '"></div>' +
        '<div class="field-row"><label>主营品牌</label><input class="input" id="dBrands" value="' + esc(d.brands || '') + '"></div>' +
        '</div>' +
        '<div class="detail-section"><label>身份标签（多选）</label>' + idTags + '</div>' +
        '<div class="detail-section"><label>公司属性（多选）</label>' + attrTags + '</div>' +
        '<div class="detail-section"><label>主要渠道（多选）</label>' + channelTags + '</div>' +
        '<div class="detail-section"><label>最近沟通</label><textarea class="textarea" id="dLast">' + esc(d.last || '') + '</textarea></div>' +
        '<div class="detail-section"><h4>手动关联</h4>' + rels + '</div>' +
        '<div class="detail-section"><h4>关联项目</h4>' + relatedProjectsHtml + '</div>';

      return '<div class="overlay open" id="contactOverlay"><div class="detail"><div class="detail-head"><div class="detail-title" id="detailTitle">' + esc(d.company || '') + ' · ' + esc(d.name || '') + '</div><div class="head-actions"><button class="btn ghost danger" data-act="delContact" data-id="' + d.id + '">删除</button><button class="btn ghost" data-act="closeDetail">关闭</button></div></div>' +
        '<div class="detail-body"><div><h4>沟通时间线</h4><div class="timeline" id="detailTimeline">' + timeline + '</div>' +
        '<div class="detail-add-record"><label>新增沟通记录</label><textarea class="textarea" id="recordInput" placeholder="时间、方式、内容、结论…"></textarea><button class="btn primary" data-act="addRecord">添加记录</button></div></div>' +
        '<div class="right-col" id="detailForm">' + form + '<button class="btn primary save-btn" data-act="saveContact">保存修改</button></div></div></div></div>';
    },

    /* ---------- 行为（data-act 委托） ---------- */
    acts: {
      tab: function (el) { Contacts._tab = el.dataset.view; Contacts._branch = null; renderPage('contacts'); },
      openBranch: function (el) { Contacts._branch = el.dataset.key; Contacts._search = ''; Contacts._attrs = {}; renderPage('contacts'); },
      closeBranch: function () { Contacts._branch = null; Contacts._search = ''; Contacts._attrs = {}; renderPage('contacts'); },
      addContact: function () {
        var company = document.getElementById('cCompany').value.trim();
        var name = document.getElementById('cName').value.trim();
        if (!name) { toast('请填写姓名'); return; }
        var prov = document.getElementById('cProvince').value;
        var city = document.getElementById('cCity').value;
        var location = prov ? (prov + (city ? ' - ' + city : '')) : '';
        function activeVals(groupId) {
          return Array.prototype.slice.call(document.querySelectorAll('#' + groupId + ' .tag.active')).map(function (t) { return t.getAttribute('data-val'); });
        }
        var now = Date.now();
        state.contacts.unshift({
          id: S.uid(), company: company, name: name,
          role: document.getElementById('cRole').value.trim(),
          phone: document.getElementById('cPhone').value.trim(),
          location: location,
          tags: activeVals('cIdTags'),
          attrs: activeVals('cAttrTags'),
          channels: activeVals('cChannelTags'),
          brands: document.getElementById('cBrands').value.trim(),
          timeline: [], relations: [],
          last: '', created: now, updatedAt: now
        });
        saveRender();
        toast('已添加 ' + name);
      },
      openContact: function (el) { Contacts._detailId = el.dataset.id; renderPage('contacts'); },
      closeDetail: function () { Contacts._detailId = null; renderPage('contacts'); },
      goProject: function (el) {
        Contacts._detailId = null;
        Project._detailId = el.dataset.id;
        renderPage('project');
      },
      saveContact: function () {
        var id = Contacts._detailId; if (!id) return;
        var d = state.contacts.find(function (x) { return x.id === id; }); if (!d) return;
        function activeVals(containerId) {
          return Array.prototype.slice.call(document.querySelectorAll('#' + containerId + ' .tag.active')).map(function (t) { return t.getAttribute('data-val'); });
        }
        d.company = document.getElementById('dCompany').value.trim();
        d.name = document.getElementById('dName').value.trim();
        d.role = document.getElementById('dRole').value.trim();
        d.phone = document.getElementById('dPhone').value.trim();
        d.location = document.getElementById('dLocation').value.trim();
        d.brands = document.getElementById('dBrands').value.trim();
        d.last = document.getElementById('dLast').value.trim();
        d.tags = activeVals('dTagTags');
        d.attrs = activeVals('dAttrTags');
        d.channels = activeVals('dChannelTags');
        d.updatedAt = Date.now();
        Contacts._detailId = null;
        saveRender();
        toast('已保存');
      },
      addRecord: function () {
        var id = Contacts._detailId; if (!id) return;
        var d = state.contacts.find(function (x) { return x.id === id; }); if (!d) return;
        var v = document.getElementById('recordInput').value.trim(); if (!v) return;
        d.timeline = d.timeline || [];
        d.timeline.push({ id: S.uid(), d: today(), t: v });
        d.last = v; d.updatedAt = Date.now();
        saveRender();
      },
      addRelation: function (el) { Contacts.addRelationFrom(el.dataset.id); },
      delContact: function (el) {
        var id = el.dataset.id || Contacts._detailId;
        if (!id) return;
        if (!ask('删除该人脉及其所有记录？此操作不可恢复。')) return;
        state.contacts = state.contacts.filter(function (x) { return x.id !== id; });
        if (Contacts._detailId === id) Contacts._detailId = null;
        saveRender();
        toast('已删除');
      },
      delRelation: function (el) {
        var id = el.dataset.id, rid = el.dataset.rid;
        var d = state.contacts.find(function (x) { return x.id === id; }); if (!d) return;
        d.relations = (d.relations || []).filter(function (r) { return r.id !== rid; });
        d.updatedAt = Date.now();
        saveRender();
        toast('已解除该关联');
      },
      unblockKw: function (el) {
        var a = el.dataset.a, b = el.dataset.b, kws = (el.dataset.kw || '').split('·');
        [a, b].forEach(function (pid) {
          if (!pid) return;
          var c = state.contacts.find(function (x) { return x.id === pid; }); if (!c) return;
          c.blockedKw = c.blockedKw || [];
          kws.forEach(function (k) { if (k && c.blockedKw.indexOf(k) < 0) c.blockedKw.push(k); });
          c.updatedAt = Date.now();
        });
        S.save();
        Contacts.buildGraph(state);
        Contacts.netKick(0.6);
        Contacts.renderNetSide(Contacts._netSel);
        toast('已不再关联该关键词');
      },
      netZoomIn: function () { Contacts.setNetZoom(Contacts._netScale * 1.25); },
      netZoomOut: function () { Contacts.setNetZoom(Contacts._netScale / 1.25); },
      netZoomReset: function () { Contacts.resetNetView(); }
    },

    /* ---------- 后绑定（每次 render 后由 renderPage 调用） ---------- */
    onRender: function () {
      var self = this;
      // 省-市联动 + 标签 toggle（list 视图）
      var prov = document.getElementById('cProvince');
      if (prov) {
        var city = document.getElementById('cCity');
        prov.addEventListener('change', function () {
          var p = prov.value;
          city.innerHTML = '<option value="">选择城市</option>';
          (window.REGION_DATA[p] || []).forEach(function (c) {
            var o = document.createElement('option'); o.value = c; o.textContent = c; city.appendChild(o);
          });
        });
      }
      document.querySelectorAll('[data-toggle]').forEach(function (t) {
        t.addEventListener('click', function () {
          var grp = t.getAttribute('data-toggle');
          if (grp === 'tag' || grp === 'attr' || grp === 'channel') t.classList.toggle('active');
        });
      });
      // 实时搜索 + 属性筛选
      var search = document.getElementById('searchInput');
      if (search) {
        search.addEventListener('input', function (e) { self._search = e.target.value.trim().toLowerCase(); self.renderBranches(state); });
      }
      var af = document.getElementById('attrFilters');
      if (af) {
        af.addEventListener('click', function (e) {
          var chip = e.target.closest('.tag'); if (!chip) return;
          var a = chip.getAttribute('data-attr');
          if (self._attrs[a]) { delete self._attrs[a]; chip.classList.remove('sel'); }
          else { self._attrs[a] = true; chip.classList.add('sel'); }
          self.renderBranches(state);
        });
      }
      this.renderPies(state);
      this.renderBranches(state);
      // 图谱
      var svg = document.getElementById('netSvg');
      if (svg) {
        this.buildGraph(state);
        this._netSel = null;
        this.netKick(1);
        this.renderNetSide(null);
        var ns = document.getElementById('netSearch');
        if (ns) ns.addEventListener('input', function (e) { self._netSearch = e.target.value.trim().toLowerCase(); self.renderNet(); });
        var kw = document.getElementById('netKwToggle');
        if (kw) kw.addEventListener('change', function () { self._showKw = kw.checked; self.buildGraph(state); self.netKick(0.6); });
        var rl = document.getElementById('netRelToggle');
        if (rl) rl.addEventListener('change', function () { self._showRel = rl.checked; self.buildGraph(state); self.netKick(0.6); });
        svg.addEventListener('pointerdown', function (e) {
          var g = e.target.closest('.node');
          self._moved = false;
          if (g) {
            self._dragNode = self._netNodes.find(function (nn) { return nn.id === g.getAttribute('data-id'); });
            self._downPos = self.toSvg(e);
          } else {
            self._panning = true;
            self._panStart = { x: e.clientX - self._netPan.x, y: e.clientY - self._netPan.y };
          }
          try { svg.setPointerCapture(e.pointerId); } catch (err) {}
        });
        svg.addEventListener('pointermove', function (e) {
          if (self._dragNode) {
            var p = self.toSvg(e);
            if (Math.hypot(p.x - self._downPos.x, p.y - self._downPos.y) > 4) self._moved = true;
            self._dragNode.x = p.x; self._dragNode.y = p.y; self._dragNode.vx = 0; self._dragNode.vy = 0;
            self.netKick(0.3);
          } else if (self._panning) {
            self._netPan.x = e.clientX - self._panStart.x;
            self._netPan.y = e.clientY - self._panStart.y;
            self.renderNet();
          }
        });
        svg.addEventListener('pointerup', function (e) {
          if (self._dragNode && !self._moved) self.selectNode(self._dragNode.id);
          self._dragNode = null; self._panning = false;
        });
        svg.addEventListener('pointercancel', function () { self._dragNode = null; self._panning = false; });
        // 双指捏合缩放
        svg.addEventListener('touchstart', function (e) {
          if (e.touches.length === 2) {
            var dx = e.touches[0].clientX - e.touches[1].clientX;
            var dy = e.touches[0].clientY - e.touches[1].clientY;
            self._netPinchDist = Math.hypot(dx, dy);
            self._netPinchScale = self._netScale;
          }
        }, { passive: true });
        svg.addEventListener('touchmove', function (e) {
          if (e.touches.length === 2 && self._netPinchDist > 0) {
            e.preventDefault();
            var dx = e.touches[0].clientX - e.touches[1].clientX;
            var dy = e.touches[0].clientY - e.touches[1].clientY;
            var dist = Math.hypot(dx, dy);
            var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            self.setNetZoom(self._netPinchScale * (dist / self._netPinchDist), cx, cy);
          }
        }, { passive: false });
        svg.addEventListener('touchend', function () { self._netPinchDist = 0; });
      }
      // 详情 overlay 背景点击关闭
      var ov = document.getElementById('contactOverlay');
      if (ov) ov.addEventListener('click', function (e) { if (e.target.id === 'contactOverlay') { self._detailId = null; renderPage('contacts'); } });
    }
  };

  /* ================= 沉淀（摘抄 / 灵感 / 日记 / 知识库） ================= */
  var NOTE_CATS = [
    { key: 'excerpt', label: '摘抄', icon: '❝', desc: '网上 / 书上的文字记录', color: 'type-excerpt' },
    { key: 'idea', label: '灵感', icon: '✦', desc: '随手记录的想法与启发', color: 'type-idea' },
    { key: 'diary', label: '日记', icon: '📓', desc: '日期化的心情与感悟', color: 'type-diary' },
    { key: 'kb', label: '知识库', icon: '📚', desc: '工作相关的知识归档', color: 'type-kb' }
  ];
  var NOTE_DIARY_TAGS = ['心情', '感悟', '回忆', '工作', '生活', '阅读'];
  var NOTE_KB_SUBS = [
    { key: 'industry', label: '行业', icon: '🏭' },
    { key: 'brand', label: '品牌', icon: '⭐' },
    { key: 'product', label: '产品', icon: '💄' },
    { key: 'channel', label: '渠道', icon: '📦' }
  ];
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function noteCat(k) { return NOTE_CATS.find(function (c) { return c.key === k; }) || NOTE_CATS[1]; }
  function kbSub(k) { return NOTE_KB_SUBS.find(function (s) { return s.key === k; }) || NOTE_KB_SUBS[3]; }
  function weekdayOf(dateStr) { var d = new Date(dateStr + 'T00:00:00'); return isNaN(d) ? '' : WEEKDAYS[d.getDay()]; }
  function parseTags(str) { return String(str || '').split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean); }

  var Notes = {
    key: 'notes', label: '沉淀', icon: '❝',
    _cat: '',       // 当前分类筛选，'' = 全部（首页）
    _tag: '',       // 当前标签筛选
    _search: '',
    _kbTab: 'industry',
    _detailId: null,
    _mode: 'view',
    render: function (s) {
      return (this._cat ? this.renderCategory(s) : this.renderLanding(s)) + this.renderOverlay(s);
    },
    counts: function (s) {
      var c = {}; NOTE_CATS.forEach(function (n) { c[n.key] = 0; });
      s.notes.forEach(function (n) { if (c[n.type] != null) c[n.type]++; });
      return c;
    },
    hotTags: function (s) {
      var m = {};
      s.notes.forEach(function (n) { (n.tags || []).forEach(function (t) { m[t] = (m[t] || 0) + 1; }); });
      return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).slice(0, 8);
    },
    renderLanding: function (s) {
      var self = this, counts = this.counts(s), tags = this.hotTags(s);
      var entries = NOTE_CATS.map(function (c) {
        return '<div class="entry-card" data-act="openCat" data-cat="' + c.key + '">' +
          '<div class="count">' + counts[c.key] + ' 条</div>' +
          '<div class="ico">' + c.icon + '</div>' +
          '<div class="title">' + c.label + '</div>' +
          '<div class="desc">' + c.desc + '</div></div>';
      }).join('');
      var catChips = '<span class="chip ' + (this._cat ? '' : 'active') + '" data-act="setCat" data-cat="">全部</span>' +
        NOTE_CATS.map(function (c) {
          return '<span class="chip ' + (self._cat === c.key ? 'active' : '') + '" data-act="setCat" data-cat="' + c.key + '">' + c.icon + ' ' + c.label + '</span>';
        }).join('');
      var tagChips = tags.length ? tags.map(function (t) {
        return '<span class="chip ' + (self._tag === t ? 'active' : '') + '" data-act="setTag" data-tag="' + esc(t) + '">#' + esc(t) + '</span>';
      }).join('') : '<span class="chip" style="cursor:default">暂无标签</span>';
      return section('沉淀', '摘抄 · 灵感 · 日记 · 知识库 · 共 ' + s.notes.length + ' 条', '') +
        '<div class="entry-grid">' + entries + '</div>' +
        '<div class="card">' +
        '<div class="filter-bar"><input class="input" id="noteSearch" placeholder="搜索沉淀内容、标签、来源、知识库子分类…" value="' + esc(this._search) + '">' +
        '<button class="btn" data-act="addNote">+ 新建</button></div>' +
        '<div class="chip-label">分类</div><div class="chip-group">' + catChips + '</div>' +
        '<div class="chip-label">标签</div><div class="chip-group">' + tagChips + '</div>' +
        '</div>' +
        '<div class="list" id="noteList">' + this.renderListHtml(s) + '</div>';
    },
    renderCategory: function (s) {
      var self = this, cat = noteCat(this._cat);
      var head = section(cat.icon + ' ' + cat.label, cat.desc, '') +
        '<button class="btn ghost" data-act="backHome">← 返回沉淀</button>';
      if (this._cat === 'kb') {
        var tabs = NOTE_KB_SUBS.map(function (sub) {
          return '<button class="kb-tab ' + (self._kbTab === sub.key ? 'active' : '') + '" data-act="setKb" data-sub="' + sub.key + '"><span class="kb-type-icon">' + sub.icon + '</span>' + sub.label + '</button>';
        }).join('');
        return head + '<div class="card"><div class="kb-tabs">' + tabs + '</div>' +
          '<div class="filter-bar"><input class="input" id="noteSearch" placeholder="搜索「' + kbSub(this._kbTab).label + '」…" value="' + esc(this._search) + '">' +
          '<button class="btn" data-act="addNote" data-type="kb" data-sub="' + this._kbTab + '">+ 新建' + kbSub(this._kbTab).label + '记录</button></div></div>' +
          '<div class="list" id="noteList">' + this.renderListHtml(s) + '</div>';
      }
      var tagChips = this._cat === 'diary'
        ? '<span class="chip ' + (this._tag ? '' : 'active') + '" data-act="setTag" data-tag="">全部</span>' +
          NOTE_DIARY_TAGS.map(function (t) { return '<span class="chip ' + (self._tag === t ? 'active' : '') + '" data-act="setTag" data-tag="' + esc(t) + '">' + esc(t) + '</span>'; }).join('')
        : '';
      return head + '<div class="card">' +
        '<div class="filter-bar"><input class="input" id="noteSearch" placeholder="搜索' + cat.label + '…" value="' + esc(this._search) + '">' +
        '<button class="btn" data-act="addNote" data-type="' + this._cat + '">+ 新建' + cat.label + '</button></div>' +
        (tagChips ? '<div class="chip-group">' + tagChips + '</div>' : '') +
        '</div>' +
        '<div class="list" id="noteList">' + this.renderListHtml(s) + '</div>';
    },
    filterNotes: function (s) {
      var self = this, list = s.notes.slice().sort(function (a, b) { return b.created - a.created; });
      if (this._cat) {
        list = list.filter(function (n) {
          if (self._cat === 'kb') return n.type === 'kb' && n.sub === self._kbTab;
          return n.type === self._cat;
        });
      }
      if (this._tag) list = list.filter(function (n) { return (n.tags || []).indexOf(self._tag) >= 0; });
      if (this._search.trim()) {
        var q = this._search.toLowerCase();
        list = list.filter(function (n) {
          var hay = [n.content, n.title, n.source, (n.tags || []).join(' '), kbSub(n.sub).label].join(' ').toLowerCase();
          return hay.indexOf(q) >= 0;
        });
      }
      return list;
    },
    renderListHtml: function (s) {
      var list = this.filterNotes(s);
      if (!list.length) return '<div class="empty">暂无匹配记录</div>';
      var self = this;
      return list.map(function (n) {
        if (n.type === 'diary') return self.renderDiaryCard(n);
        if (n.type === 'kb') return self.renderKbCard(n);
        return self.renderDefaultCard(n);
      }).join('');
    },
    renderTags: function (n) {
      var t = '<span class="tag ' + noteCat(n.type).color + '">' + noteCat(n.type).label + '</span>';
      if (n.type === 'kb') t += '<span class="tag green">' + kbSub(n.sub).label + '</span>';
      return t + (n.tags || []).map(function (x) { return '<span class="tag gray">' + esc(x) + '</span>'; }).join('');
    },
    renderDefaultCard: function (n) {
      var title = n.title || (n.type === 'excerpt' ? '摘抄' : '灵感');
      return '<div class="note-card" data-act="openNote" data-id="' + n.id + '">' +
        '<div class="head"><div class="title">' + esc(title) +
        (n.source ? ' <span style="font-size:12px;color:var(--ink-soft)">· ' + esc(n.source) + '</span>' : '') + '</div>' +
        '<div class="date">' + fmtDate(n.created) + '</div></div>' +
        '<div class="preview">' + esc(n.content) + '</div>' +
        '<div class="meta">' + this.renderTags(n) + '</div></div>';
    },
    renderDiaryCard: function (n) {
      var d = new Date(n.date + 'T00:00:00');
      var day = ('0' + d.getDate()).slice(-2), ymd = d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2);
      return '<div class="note-card diary-card" data-act="openNote" data-id="' + n.id + '">' +
        '<div class="head"><div class="diary-date"><span class="day">' + day + '</span><span class="ymd">' + ymd + '</span>' +
        '<span class="week">' + weekdayOf(n.date) + '</span></div>' +
        '<div class="date">' + esc(n.title || '日记') + '</div></div>' +
        '<div class="preview">' + esc(n.content) + '</div>' +
        '<div class="meta">' + this.renderTags(n) + '</div></div>';
    },
    renderKbCard: function (n) {
      var links = (n.links || []).length, files = (n.files || []).length;
      var badges = (links ? ' <span title="链接">🔗' + links + '</span>' : '') + (files ? ' <span title="本地资料">📎' + files + '</span>' : '');
      return '<div class="note-card kb-card" data-act="openNote" data-id="' + n.id + '">' +
        '<div class="head"><div class="title">' + esc(n.title || '未命名') + badges + '</div>' +
        '<div class="date">' + fmtDate(n.created) + '</div></div>' +
        '<div class="preview">' + esc(n.content || '（无文字内容）') + '</div>' +
        '<div class="meta">' + this.renderTags(n) + '</div></div>';
    },
    renderOverlay: function (s) {
      var self = this;
      var n = this._detailId ? s.notes.find(function (x) { return x.id === self._detailId; }) : null;
      if (!n) return '<div class="overlay" id="noteOverlay"></div>';
      var cat = noteCat(n.type);
      var body = this._mode === 'edit' ? this.renderEditForm(n) : this.renderViewBody(n);
      var foot = this._mode === 'edit'
        ? '<button class="btn primary save-btn" data-act="saveNote">保存</button><button class="btn ghost danger" data-act="delNote" data-id="' + n.id + '">删除</button><button class="btn ghost" data-act="closeNote">关闭</button>'
        : '<button class="btn ghost" data-act="editNote">编辑</button><button class="btn ghost danger" data-act="delNote" data-id="' + n.id + '">删除</button><button class="btn ghost" data-act="closeNote">关闭</button>';
      return '<div class="overlay open" id="noteOverlay"><div class="detail note-detail"><div class="detail-head"><div class="detail-title">' + cat.icon + ' ' + (this._mode === 'edit' ? '编辑' : '查看') + cat.label + '</div>' +
        '<div class="head-actions"><button class="close-x" data-act="closeNote">×</button></div></div>' +
        '<div class="detail-body note-detail-body"><div class="note-view">' + body + '</div></div>' +
        '<div class="overlay-foot">' + foot + '</div></div></div>';
    },
    renderViewBody: function (n) {
      var top = '';
      if (n.type === 'diary' && n.date) top = '<div style="margin-bottom:10px"><span class="tag type-diary">' + esc(n.date) + ' ' + weekdayOf(n.date) + '</span></div>';
      if (n.source) top += '<div style="color:var(--ink-soft);font-size:13px;margin-bottom:10px">来源：' + esc(n.source) + '</div>';
      top += '<div style="margin-bottom:10px">' + this.renderTags(n) + '</div>';
      var links = (n.links || []).length ? '<h4 style="margin:14px 0 8px;color:var(--ink-soft);font-size:13px">相关链接</h4>' +
        n.links.map(function (l) { return '<div style="margin-bottom:6px"><a href="' + esc(l.url) + '" target="_blank" rel="noopener">🔗 ' + esc(l.title || l.url) + '</a></div>'; }).join('') : '';
      var files = (n.files || []).length ? '<h4 style="margin:14px 0 8px;color:var(--ink-soft);font-size:13px">本地资料</h4>' +
        n.files.map(function (f) { return '<div class="file-chip">📎 ' + esc(f.name || f.path) + '<br><code style="font-size:11px">' + esc(f.path) + '</code></div>'; }).join('') : '';
      return top + '<div style="white-space:pre-wrap;line-height:1.8;font-size:15px">' + esc(n.content) + '</div>' + links + files +
        '<div style="margin-top:14px;color:var(--ink-soft);font-size:12px">创建于 ' + fmtDate(n.created) + '</div>';
    },
    renderEditForm: function (n) {
      var cat = noteCat(n.type);
      var typeOpts = NOTE_CATS.map(function (c) { return '<option value="' + c.key + '"' + (c.key === n.type ? ' selected' : '') + '>' + c.icon + ' ' + c.label + '</option>'; }).join('');
      var html = '<div class="grid cols-2">' +
        '<div class="detail-section"><label>分类</label><select class="select" id="editType">' + typeOpts + '</select></div>' +
        '<div class="detail-section"><label>标签（逗号分隔）</label><input class="input" id="editTags" value="' + esc((n.tags || []).join(', ')) + '"></div></div>';
      if (n.type === 'excerpt') html += '<div class="detail-section"><label>来源</label><input class="input" id="editSource" value="' + esc(n.source || '') + '" placeholder="书名 / 文章 / 作者"></div>';
      if (n.type === 'diary') html += '<div class="grid cols-2">' +
        '<div class="detail-section"><label>日期</label><input class="input" id="editDate" type="date" value="' + esc(n.date || today()) + '"></div>' +
        '<div class="detail-section"><label>标题（可选）</label><input class="input" id="editTitle" value="' + esc(n.title || '') + '" placeholder="如：周五复盘"></div></div>';
      if (n.type === 'kb') {
        var subOpts = NOTE_KB_SUBS.map(function (sub) { return '<option value="' + sub.key + '"' + (sub.key === n.sub ? ' selected' : '') + '>' + sub.icon + ' ' + sub.label + '</option>'; }).join('');
        html += '<div class="grid cols-2">' +
          '<div class="detail-section"><label>子分类</label><select class="select" id="editSub">' + subOpts + '</select></div>' +
          '<div class="detail-section"><label>标题</label><input class="input" id="editTitle" value="' + esc(n.title || '') + '" placeholder="知识条目标题"></div></div>';
        html += '<div class="detail-section"><label>相关链接</label><div id="linkBox">' + (n.links || []).map(function (l, i) {
          return '<div class="link-row"><input class="input" placeholder="标题" value="' + esc(l.title || '') + '" data-link-title="' + i + '"><input class="input" placeholder="https://..." value="' + esc(l.url || '') + '" data-link-url="' + i + '"></div>';
        }).join('') + '</div><button class="btn sm ghost" data-act="addLink">+ 添加链接</button></div>';
        html += '<div class="detail-section"><label>本地资料</label><div id="fileBox">' + (n.files || []).map(function (f, i) {
          return '<div class="link-row"><input class="input" placeholder="资料名称" value="' + esc(f.name || '') + '" data-file-name="' + i + '"><input class="input" placeholder="本地路径，如 D:/资料/文件.xlsx" value="' + esc(f.path || '') + '" data-file-path="' + i + '"></div>';
        }).join('') + '</div><button class="btn sm ghost" data-act="addFile">+ 添加资料</button></div>';
      }
      html += '<div class="detail-section"><label>内容</label><textarea class="textarea" id="editContent" rows="10" placeholder="' + cat.desc + '…">' + esc(n.content || '') + '</textarea></div>';
      return html;
    },
    acts: {
      openCat: function (el) { Notes._cat = el.dataset.cat; Notes._search = ''; Notes._tag = ''; renderPage('notes'); },
      backHome: function () { Notes._cat = ''; Notes._tag = ''; Notes._search = ''; renderPage('notes'); },
      setCat: function (el) { Notes._cat = el.dataset.cat || ''; if (Notes._cat) Notes._tag = ''; renderPage('notes'); },
      setTag: function (el) { Notes._tag = el.dataset.tag || ''; renderPage('notes'); },
      setKb: function (el) { Notes._kbTab = el.dataset.sub; Notes._search = ''; renderPage('notes'); },
      openNote: function (el) { Notes._detailId = el.dataset.id; Notes._mode = 'view'; renderPage('notes'); },
      closeNote: function () { Notes._detailId = null; renderPage('notes'); },
      editNote: function () { Notes._mode = 'edit'; renderPage('notes'); },
      delNote: function (el) {
        var id = el.dataset.id || Notes._detailId; if (!id) return;
        if (!ask('确定删除这条记录？')) return;
        state.notes = state.notes.filter(function (x) { return x.id !== id; });
        if (Notes._detailId === id) Notes._detailId = null;
        saveRender(); toast('已删除');
      },
      addNote: function (el) {
        var type = el.dataset.type || 'idea', sub = el.dataset.sub || 'industry';
        var base = { id: S.uid(), type: type, title: '', content: '', tags: [], created: Date.now(), updatedAt: Date.now() };
        if (type === 'diary') base.date = today();
        if (type === 'kb') { base.sub = sub; base.links = []; base.files = []; }
        if (type === 'excerpt') base.source = '';
        state.notes.unshift(base);
        Notes._cat = type; Notes._detailId = base.id; Notes._mode = 'edit';
        saveRender();
      },
      addLink: function () {
        var box = document.getElementById('linkBox'); if (!box) return;
        var i = box.querySelectorAll('.link-row').length;
        var div = document.createElement('div'); div.className = 'link-row';
        div.innerHTML = '<input class="input" placeholder="标题" data-link-title="' + i + '"><input class="input" placeholder="https://..." data-link-url="' + i + '">';
        box.appendChild(div);
      },
      addFile: function () {
        var box = document.getElementById('fileBox'); if (!box) return;
        var i = box.querySelectorAll('.link-row').length;
        var div = document.createElement('div'); div.className = 'link-row';
        div.innerHTML = '<input class="input" placeholder="资料名称" data-file-name="' + i + '"><input class="input" placeholder="本地路径" data-file-path="' + i + '">';
        box.appendChild(div);
      },
      saveNote: function () {
        var id = Notes._detailId; if (!id) return;
        var n = state.notes.find(function (x) { return x.id === id; }); if (!n) return;
        n.type = document.getElementById('editType').value;
        n.tags = parseTags(document.getElementById('editTags').value);
        n.content = document.getElementById('editContent').value;
        if (document.getElementById('editSource')) n.source = document.getElementById('editSource').value.trim();
        if (document.getElementById('editDate')) n.date = document.getElementById('editDate').value;
        if (document.getElementById('editTitle')) n.title = document.getElementById('editTitle').value.trim();
        if (document.getElementById('editSub')) n.sub = document.getElementById('editSub').value;
        var lb = document.getElementById('linkBox');
        if (lb) {
          n.links = [];
          lb.querySelectorAll('.link-row').forEach(function (row) {
            var title = row.querySelector('[data-link-title]').value.trim();
            var url = row.querySelector('[data-link-url]').value.trim();
            if (url) n.links.push({ title: title, url: url });
          });
        }
        var fb = document.getElementById('fileBox');
        if (fb) {
          n.files = [];
          fb.querySelectorAll('.link-row').forEach(function (row) {
            var name = row.querySelector('[data-file-name]').value.trim();
            var path = row.querySelector('[data-file-path]').value.trim();
            if (path) n.files.push({ name: name || path.split(/[\\/]/).pop(), path: path });
          });
        }
        n.updatedAt = Date.now();
        Notes._mode = 'view';
        saveRender(); toast('已保存');
      }
    },
    onRender: function () {
      var self = this;
      var ov = document.getElementById('noteOverlay');
      if (ov) ov.addEventListener('click', function (e) { if (e.target.id === 'noteOverlay') { self._detailId = null; self._mode = 'view'; renderPage('notes'); } });
      var si = document.getElementById('noteSearch');
      if (si) si.addEventListener('input', function () { self._search = si.value; var box = document.getElementById('noteList'); if (box) box.innerHTML = self.renderListHtml(state); });
    }
  };

  // ---- 备忘（原「复盘」板块重构） ----
  var MEMO_TAGS = [
    { key: 'life', label: '生活', icon: '🌿' },
    { key: 'work', label: '工作', icon: '💼' }
  ];
  function memoTag(k) { return MEMO_TAGS.find(function (t) { return t.key === k; }) || MEMO_TAGS[0]; }
  function fmtMemoDT(ts) {
    var d = new Date(ts || Date.now());
    var p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // 图片压缩：限制最大宽 1000px、jpeg 0.72，避免 localStorage 被照片撑爆
  function memoCompressImage(dataUrl, cb) {
    var img = new Image();
    img.onload = function () {
      var maxW = 1000, w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      try { cb(canvas.toDataURL('image/jpeg', 0.72)); } catch (e) { cb(dataUrl); }
    };
    img.onerror = function () { cb(dataUrl); };
    img.src = dataUrl;
  }
  function memoHandlePhotos(files) {
    if (!files || !files.length) return;
    Array.prototype.forEach.call(files, function (file) {
      if (!/^image\//.test(file.type)) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        memoCompressImage(e.target.result, function (dataUrl) {
          Memo._addPhotos.push(dataUrl);
          // 局部追加缩略图，不重建整页（避免清空已填的标题/内容）
          var wrap = document.getElementById('memoPhotosEdit');
          if (wrap) {
            var div = document.createElement('div');
            div.className = 'memo-thumb';
            div.innerHTML = '<img src="' + dataUrl + '"><button class="memo-photo-del" data-act="memoPhotoDel" data-i="' + (Memo._addPhotos.length - 1) + '">✕</button>';
            var add = wrap.querySelector('.memo-photo-add');
            wrap.insertBefore(div, add);
          }
        });
      };
      reader.readAsDataURL(file);
    });
  }

  var Memo = {
    key: 'review', label: '备忘', icon: '📝',
    _search: '', _filter: '', _detailId: null, _addMode: false, _editId: null, _addTag: 'life', _addPhotos: [],
    render: function (s) {
      var self = this;
      var searchBar = '<div class="memo-top">' +
        '<input class="input" id="memoSearch" placeholder="搜索备忘…" value="' + esc(self._search) + '">' +
        '<button class="btn primary" data-act="memoAdd">+ 新增备忘</button>' +
        '</div>';
      var filterBar = '<div class="memo-filter">' +
        MEMO_TAGS.map(function (t) {
          var active = self._filter === t.key ? ' active' : '';
          return '<button class="memo-tag ' + active + '" data-act="memoFilter" data-tag="' + t.key + '">' + t.icon + ' ' + t.label + '</button>';
        }).join('') +
        (self._filter ? '<button class="memo-tag-clear" data-act="memoFilterClear">全部</button>' : '') +
        '</div>';
      return section('备忘', '随手记录 · 生活 / 工作', '') + searchBar + filterBar +
        '<div id="memoList">' + this.renderListHtml(s) + '</div>' +
        this.renderEditor(s) + this.renderDetail(s);
    },
    renderListHtml: function (s) {
      var self = this;
      var list = (s.review || []).filter(function (x) {
        if (self._filter && x.tag !== self._filter) return false;
        if (self._search) {
          var q = self._search.toLowerCase();
          if (!((x.title || '').toLowerCase().indexOf(q) >= 0 || (x.content || '').toLowerCase().indexOf(q) >= 0)) return false;
        }
        return true;
      }).sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
      if (!list.length) return '<div class="empty">暂无备忘' + (self._filter ? '（该分类下）' : '') + '</div>';
      return '<div class="memo-list">' + list.map(function (x) {
        var t = memoTag(x.tag);
        var photos = (x.photos || []).slice(0, 1);
        var pc = (x.photos || []).length;
        return '<div class="memo-card" data-act="memoOpen" data-id="' + x.id + '">' +
          '<div class="memo-card-head"><span class="memo-badge ' + t.key + '">' + t.icon + ' ' + t.label + '</span>' +
          '<span class="memo-date">' + fmtMemoDT(x.created) + '</span></div>' +
          '<div class="memo-title">' + esc(x.title || '（无标题）') + '</div>' +
          (x.content ? '<div class="memo-content">' + esc(x.content) + '</div>' : '') +
          (photos.length ? '<div class="memo-photos"><div class="memo-thumb"><img src="' + photos[0] + '" alt=""></div>' +
            (pc > 1 ? '<span class="memo-more">+' + (pc - 1) + '</span>' : '') + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';
    },
    renderEditor: function (s) {
      var self = this;
      var editing = !!self._editId;
      var cur = editing ? (s.review || []).find(function (y) { return y.id === self._editId; }) : null;
      if (editing && !cur) { self._editId = null; return ''; }
      if (!self._addMode && !editing) return '';
      var tag = editing ? cur.tag : self._addTag;
      var photos = editing ? (cur.photos || []) : self._addPhotos;
      var tagBtns = MEMO_TAGS.map(function (t) {
        var active = tag === t.key ? ' active' : '';
        return '<button class="memo-tag ' + active + '" data-act="memoTagPick" data-tag="' + t.key + '">' + t.icon + ' ' + t.label + '</button>';
      }).join('');
      var photoHtml = photos.map(function (p, i) {
        return '<div class="memo-thumb"><img src="' + p + '"><button class="memo-photo-del" data-act="memoPhotoDel" data-i="' + i + '">✕</button></div>';
      }).join('');
      var createdLabel = editing ? fmtMemoDT(cur.created) : fmtMemoDT(Date.now());
      var titleVal = editing ? esc(cur.title || '') : '';
      var contentVal = editing ? esc(cur.content || '') : '';
      return '<div class="overlay open" id="memoEditorOverlay"><div class="detail memo-detail">' +
        '<div class="detail-head"><div class="detail-title">' + (editing ? '编辑备忘' : '新增备忘') + '</div><div class="head-actions"><button class="btn ghost" data-act="memoEditCancel">取消</button></div></div>' +
        '<div class="detail-body">' +
        '<div class="detail-section"><label>标题</label><input class="input" id="memoTitle" placeholder="如：周末采购清单" value="' + titleVal + '"></div>' +
        '<div class="detail-section memo-created">创建：' + createdLabel + '</div>' +
        '<div class="detail-section"><label>分类</label><div class="memo-tag-row">' + tagBtns + '</div></div>' +
        '<div class="detail-section"><label>内容</label><textarea class="textarea" id="memoContent" placeholder="写点什么…">' + contentVal + '</textarea></div>' +
        '<div class="detail-section"><label>照片</label>' +
        '<div class="memo-photos-edit" id="memoPhotosEdit">' + photoHtml +
        '<label class="memo-photo-add"><input type="file" id="memoPhotoInput" accept="image/*" multiple style="display:none"><span>+ 添加照片</span></label></div>' +
        '</div>' +
        '<div style="margin-top:10px;display:flex;justify-content:flex-end"><button class="btn primary" data-act="memoSave">' + (editing ? '保存修改' : '保存备忘') + '</button></div>' +
        '</div></div></div>';
    },
    renderDetail: function (s) {
      var self = this;
      var x = self._detailId ? (s.review || []).find(function (y) { return y.id === self._detailId; }) : null;
      if (!x) return '';
      var t = memoTag(x.tag);
      var photos = (x.photos || []).map(function (p) { return '<img class="memo-detail-photo" src="' + p + '">'; }).join('');
      return '<div class="overlay open" id="memoDetailOverlay"><div class="detail memo-detail">' +
        '<div class="detail-head"><div class="detail-title">' + esc(x.title || '（无标题）') + '</div><div class="head-actions">' +
        '<button class="btn ghost" data-act="memoEdit" data-id="' + x.id + '">编辑</button>' +
        '<button class="btn ghost danger" data-act="memoDel" data-id="' + x.id + '">删除</button>' +
        '<button class="btn ghost" data-act="memoClose">关闭</button></div></div>' +
        '<div class="detail-body">' +
        '<div class="detail-section"><span class="memo-badge ' + t.key + '">' + t.icon + ' ' + t.label + '</span> <span class="muted">' + fmtMemoDT(x.created) + '</span></div>' +
        (x.content ? '<div class="detail-section memo-detail-content">' + esc(x.content).replace(/\n/g, '<br>') + '</div>' : '') +
        (photos ? '<div class="detail-section memo-detail-photos">' + photos + '</div>' : '') +
        '</div></div></div>';
    },
    acts: {
      memoAdd: function () { Memo._addMode = true; Memo._editId = null; Memo._addTag = 'life'; Memo._addPhotos = []; renderPage('review'); },
      memoAddCancel: function () { Memo._addMode = false; Memo._editId = null; Memo._addPhotos = []; renderPage('review'); },
      memoEditCancel: function () { Memo._addMode = false; Memo._editId = null; Memo._addPhotos = []; renderPage('review'); },
      memoEdit: function (el) {
        var id = el.dataset.id;
        var x = (state.review || []).find(function (y) { return y.id === id; });
        if (!x) return;
        Memo._detailId = null;
        Memo._editId = id;
        Memo._addMode = false;
        Memo._addTag = x.tag || 'life';
        Memo._addPhotos = (x.photos || []).slice();
        renderPage('review');
      },
      memoTagPick: function (el) {
        Memo._addTag = el.dataset.tag;
        Array.prototype.forEach.call(document.querySelectorAll('.memo-tag-row .memo-tag'), function (b) {
          b.classList.toggle('active', b.dataset.tag === Memo._addTag);
        });
      },
      memoFilter: function (el) { Memo._filter = el.dataset.tag; renderPage('review'); },
      memoFilterClear: function () { Memo._filter = ''; renderPage('review'); },
      memoOpen: function (el) { Memo._detailId = el.dataset.id; Memo._detailId && renderPage('review'); },
      memoClose: function () { Memo._detailId = null; renderPage('review'); },
      memoPhotoDel: function (el) {
        var i = +el.dataset.i;
        Memo._addPhotos.splice(i, 1);
        var th = el.closest('.memo-thumb'); if (th) th.remove();
        // 重新编号剩余缩略图，保证与 _addPhotos 索引一致
        var wrap = document.getElementById('memoPhotosEdit');
        if (wrap) Array.prototype.forEach.call(wrap.querySelectorAll('.memo-photo-del'), function (btn, idx) { btn.dataset.i = idx; });
      },
      memoSave: function () {
        var title = (document.getElementById('memoTitle') || {}).value || '';
        var content = (document.getElementById('memoContent') || {}).value || '';
        title = title.trim(); content = content.trim();
        if (!title && !content) { toast('标题或内容至少填一项'); return; }
        if (Memo._editId) {
          var x = (state.review || []).find(function (y) { return y.id === Memo._editId; });
          if (x) {
            x.title = title; x.content = content; x.tag = Memo._addTag; x.photos = Memo._addPhotos.slice();
          }
          Memo._editId = null;
        } else {
          state.review.unshift({ id: S.uid(), title: title, content: content, tag: Memo._addTag, created: Date.now(), photos: Memo._addPhotos.slice() });
        }
        Memo._addMode = false; Memo._addPhotos = [];
        saveRender();
        toast('已保存');
      },
      memoDel: function (el) {
        if (!ask('删除该备忘？')) return;
        state.review = state.review.filter(function (x) { return x.id !== el.dataset.id; });
        Memo._detailId = null; saveRender(); toast('已删除');
      }
    },
    onRender: function () {
      var self = this;
      var si = document.getElementById('memoSearch');
      if (si) si.addEventListener('input', function () { self._search = si.value; var box = document.getElementById('memoList'); if (box) box.innerHTML = self.renderListHtml(state); });
      var pi = document.getElementById('memoPhotoInput');
      if (pi) pi.addEventListener('change', function () { memoHandlePhotos(pi.files); });
      var ao = document.getElementById('memoEditorOverlay');
      if (ao) ao.addEventListener('click', function (e) { if (e.target.id === 'memoEditorOverlay') { self._addMode = false; self._editId = null; self._addPhotos = []; renderPage('review'); } });
      var dvo = document.getElementById('memoDetailOverlay');
      if (dvo) dvo.addEventListener('click', function (e) { if (e.target.id === 'memoDetailOverlay') { self._detailId = null; renderPage('review'); } });
    }
  };

  // ---- 打卡 ----
  /* ---------- 打卡：日历视图 + 默认项快捷打卡 + 月度汇总 ---------- */
  var HABIT_COLORS = ['#4f8cff', '#f5a623', '#34c759', '#af52de', '#ff6b6b', '#26c6da', '#ff9f0a', '#7c5cff'];
  function habitColor(id) {
    var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return HABIT_COLORS[h % HABIT_COLORS.length];
  }
  var DOW = ['一', '二', '三', '四', '五', '六', '日'];
  function dowIdx(d) { return (d.getDay() + 6) % 7; } // 0=周一..6=周日
  function weekdayCN(d) { return '周' + DOW[dowIdx(d)]; }
  function shiftMonth(ym, delta) {
    var p = ym.split('-'); var y = +p[0], m = +p[1] - 1 + delta;
    var d = new Date(y, m, 1);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }
  function daysInMonth(ym) { var p = ym.split('-'); return new Date(+p[0], +p[1], 0).getDate(); }
  function monthCells(ym) {
    var first = new Date(+ym.split('-')[0], +ym.split('-')[1] - 1, 1);
    var dim = daysInMonth(ym);
    var off = dowIdx(first);
    var total = Math.ceil((off + dim) / 7) * 7;
    var cells = [];
    for (var i = 0; i < total; i++) {
      var dayNum = i - off + 1;
      if (dayNum >= 1 && dayNum <= dim) cells.push({ d: dayNum, ds: ym + '-' + ('0' + dayNum).slice(-2), inMonth: true });
      else cells.push({ d: dayNum, ds: '', inMonth: false });
    }
    return cells;
  }

  var Habit = {
    key: 'habit', label: '打卡', icon: '◉',
    _viewMonth: today().slice(0, 7),
    _dayDate: null,
    _sumOpen: false,
    _sumMonth: null,
    render: function (s) {
      var self = this;
      var items = s.habit.items || [];
      var td = today();
      var punch = s.habit.punch || {};
      var td0 = new Date(td + 'T00:00:00');
      var doneToday = items.filter(function (it) { return (punch[it.id] || []).indexOf(td) >= 0; }).length;

      // 今日快捷打卡
      var chips = items.map(function (it) {
        var on = (punch[it.id] || []).indexOf(td) >= 0;
        return '<button class="qchip ' + (on ? 'on' : '') + '" data-act="togglePunch" data-id="' + it.id + '" data-date="' + td + '">' +
          '<span class="qcheck">' + (on ? '✓' : '') + '</span>' + esc(it.name) + '</button>';
      }).join('');

      // 日历
      var ym = self._viewMonth;
      var cells = monthCells(ym).map(function (c) {
        if (!c.inMonth) return '<div class="cal-cell out"></div>';
        var completed = items.filter(function (it) { return (punch[it.id] || []).indexOf(c.ds) >= 0; });
        var dots = completed.slice(0, 4).map(function (it) {
          return '<span class="cal-dot" style="background:' + habitColor(it.id) + '" title="' + esc(it.name) + '"></span>';
        }).join('');
        if (completed.length > 4) dots += '<span class="cal-more">+' + (completed.length - 4) + '</span>';
        return '<div class="cal-cell ' + (c.ds === td ? 'today' : '') + '" data-act="openDay" data-date="' + c.ds + '">' +
          '<span class="cal-num">' + c.d + '</span><div class="cal-dots">' + dots + '</div></div>';
      }).join('');
      var calDow = DOW.map(function (w) { return '<span class="cal-dow-c">' + w + '</span>'; }).join('');

      var mgr = items.length ? items.map(function (it) {
        return '<div class="habit-mgr-item"><span class="hm-name">' + esc(it.name) + '</span>' +
          (it.def ? '<span class="tag sm">默认</span>' : '') +
          '<button class="x" data-act="del" data-id="' + it.id + '" title="移除">✕</button></div>';
      }).join('') : '<div class="empty">还没有习惯</div>';

      var html = section('打卡', '坚持的小事', '') +
        '<div class="card habit-today">' +
          '<div class="today-head"><div class="today-date">' + (td0.getMonth() + 1) + '月' + td0.getDate() + '日</div>' +
          '<div class="today-dow">' + weekdayCN(td0) + '</div>' +
          '<div class="today-sub">今日已打卡 ' + doneToday + ' / ' + items.length + '</div></div>' +
          '<div class="quick-chips">' + chips + '</div>' +
        '</div>' +
        '<div class="card"><div class="cal-head">' +
          '<button class="btn sm ghost" data-act="calPrev">‹</button>' +
          '<div class="cal-title">' + ym.split('-')[0] + '年' + (+ym.split('-')[1]) + '月</div>' +
          '<button class="btn sm ghost" data-act="calNext">›</button>' +
        '</div><div class="cal-dow">' + calDow + '</div><div class="cal-grid">' + cells + '</div></div>' +
        '<div class="card habit-actions"><button class="btn" data-act="openSummary">查看月度汇总</button>' +
          '<div class="habit-add"><input class="input" id="habitName" placeholder="添加自定义习惯，如：读书"><button class="btn" data-act="add">添加</button></div></div>' +
        '<div class="card"><h2>习惯管理</h2>' + mgr + '</div>';

      // 当日编辑弹窗
      if (self._dayDate) {
        var dd = new Date(self._dayDate + 'T00:00:00');
        var rows = items.map(function (it) {
          var on = (punch[it.id] || []).indexOf(self._dayDate) >= 0;
          return '<div class="day-row ' + (on ? 'on' : '') + '" data-act="togglePunch" data-id="' + it.id + '" data-date="' + self._dayDate + '">' +
            '<span class="day-check ' + (on ? 'on' : '') + '">' + (on ? '✓' : '') + '</span><span class="day-name">' + esc(it.name) + '</span></div>';
        }).join('');
        html += '<div class="overlay open" id="habitDayOverlay"><div class="detail">' +
          '<div class="detail-head"><div class="detail-title">' + self._dayDate + ' ' + weekdayCN(dd) + '</div>' +
          '<button class="x" data-act="closeDay">✕</button></div>' +
          '<div class="detail-body" style="grid-template-columns:1fr"><div class="day-list">' + rows + '</div></div></div></div>';
      }

      // 月度汇总弹窗
      if (self._sumOpen) {
        var sym = self._sumMonth || ym;
        var dim = daysInMonth(sym);
        var perItem = items.map(function (it) {
          var cnt = (punch[it.id] || []).filter(function (d) { return d.indexOf(sym + '-') === 0; }).length;
          return { it: it, count: cnt };
        });
        var total = perItem.reduce(function (a, b) { return a + b.count; }, 0);
        var daysWith = [];
        for (var day = 1; day <= dim; day++) {
          var ds = sym + '-' + ('0' + day).slice(-2);
          var names = items.filter(function (it) { return (punch[it.id] || []).indexOf(ds) >= 0; }).map(function (it) { return it.name; });
          if (names.length) daysWith.push({ ds: ds, d: new Date(ds + 'T00:00:00'), names: names });
        }
        var statRows = perItem.map(function (p) {
          var pct = dim ? Math.round(p.count / dim * 100) : 0;
          return '<div class="sum-item"><span class="sum-name">' + esc(p.it.name) + '</span>' +
            '<span class="sum-bar"><span style="width:' + pct + '%;background:' + habitColor(p.it.id) + '"></span></span>' +
            '<span class="sum-num">' + p.count + ' 天</span></div>';
        }).join('');
        var dayRows = daysWith.length ? daysWith.map(function (dw) {
          return '<div class="sum-day"><span class="sum-day-d">' + dw.ds + ' ' + weekdayCN(dw.d) + '</span>' +
            '<div class="sum-day-tags">' + dw.names.map(function (n) { return '<span class="tag sm">' + esc(n) + '</span>'; }).join('') + '</div></div>';
        }).join('') : '<div class="empty">本月还没有打卡</div>';
        html += '<div class="overlay open" id="habitSummaryOverlay"><div class="detail">' +
          '<div class="detail-head"><div class="detail-title">月度汇总 · ' + sym + '</div>' +
          '<div class="sum-nav"><button class="btn sm ghost" data-act="sumPrev">‹</button>' +
          '<button class="btn sm ghost" data-act="sumNext">›</button>' +
          '<button class="x" data-act="closeSummary">✕</button></div></div>' +
          '<div class="detail-body" style="grid-template-columns:1fr">' +
          '<div class="sum-stat">本月共打卡 <b>' + total + '</b> 次 · 有打卡 <b>' + daysWith.length + '</b> / ' + dim + ' 天</div>' +
          '<h4>各习惯完成天数</h4><div class="sum-list">' + statRows + '</div>' +
          '<h4>每日明细</h4><div class="sum-days">' + dayRows + '</div>' +
          '</div></div></div>';
      }
      return html;
    },
    acts: {
      add: function () {
        var v = document.getElementById('habitName').value.trim(); if (!v) return;
        state.habit.items.push({ id: S.uid(), name: v });
        saveRender();
      },
      togglePunch: function (el) {
        var id = el.dataset.id, d = el.dataset.date;
        state.habit.punch[id] = state.habit.punch[id] || [];
        var arr = state.habit.punch[id];
        var i = arr.indexOf(d);
        if (i >= 0) arr.splice(i, 1); else arr.push(d);
        saveRender();
      },
      openDay: function (el) { Habit._dayDate = el.dataset.date; renderPage('habit'); },
      closeDay: function () { Habit._dayDate = null; renderPage('habit'); },
      openSummary: function () { Habit._sumOpen = true; Habit._sumMonth = Habit._viewMonth; renderPage('habit'); },
      closeSummary: function () { Habit._sumOpen = false; renderPage('habit'); },
      sumPrev: function () { Habit._sumMonth = shiftMonth(Habit._sumMonth || Habit._viewMonth, -1); renderPage('habit'); },
      sumNext: function () { Habit._sumMonth = shiftMonth(Habit._sumMonth || Habit._viewMonth, 1); renderPage('habit'); },
      calPrev: function () { Habit._viewMonth = shiftMonth(Habit._viewMonth, -1); renderPage('habit'); },
      calNext: function () { Habit._viewMonth = shiftMonth(Habit._viewMonth, 1); renderPage('habit'); },
      del: function (el) {
        var id = el.dataset.id;
        var it = state.habit.items.find(function (x) { return x.id === id; });
        var name = it ? it.name : '该习惯';
        if (!ask('移除「' + name + '」？' + (it && it.def ? '（默认项，之后不再自动补回）' : '（含其打卡记录）'))) return;
        if (it && it.def) {
          state.habit.removedDefaults = state.habit.removedDefaults || [];
          if (state.habit.removedDefaults.indexOf(id) < 0) state.habit.removedDefaults.push(id);
        }
        state.habit.items = state.habit.items.filter(function (x) { return x.id !== id; });
        delete state.habit.punch[id];
        saveRender();
      }
    },
    onRender: function () {
      var dv = document.getElementById('habitDayOverlay');
      if (dv) dv.addEventListener('click', function (e) { if (e.target.id === 'habitDayOverlay') { Habit._dayDate = null; renderPage('habit'); } });
      var sv = document.getElementById('habitSummaryOverlay');
      if (sv) sv.addEventListener('click', function (e) { if (e.target.id === 'habitSummaryOverlay') { Habit._sumOpen = false; renderPage('habit'); } });
    }
  };

  // ---- 理财 ----
  var Finance = {
    key: 'finance', label: '理财', icon: '¥',
    render: function (s) {
      var recs = s.finance.records || [];
      var month = today().slice(0, 7);
      var inSum = 0, outSum = 0;
      recs.forEach(function (r) {
        if (r.date && r.date.indexOf(month) === 0) {
          if (r.type === 'in') inSum += Number(r.amount) || 0; else outSum += Number(r.amount) || 0;
        }
      });
      var list = recs.length ? recs.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).map(function (r) {
        return '<div class="item"><div class="body"><div class="title">' + esc(r.cat || '') + (r.note ? ' · ' + esc(r.note) : '') + '</div>' +
          '<div class="meta">' + esc(r.date || '') + ' · ' + (r.type === 'in' ? '收入' : '支出') + '</div></div>' +
          '<div style="font-weight:700">' + money(r.type === 'in' ? Number(r.amount) : -Number(r.amount)) + '</div>' +
          '<button class="x" data-act="del" data-id="' + r.id + '">✕</button></div>';
      }).join('') : '<div class="empty">还没有记账</div>';
      return section('理财', '收支记录 · 本月', '') +
        '<div class="stat-row" style="margin-bottom:16px">' +
        '<div class="stat"><div class="n money in">' + money(inSum) + '</div><div class="l">本月收入</div></div>' +
        '<div class="stat"><div class="n money out">' + money(-outSum) + '</div><div class="l">本月支出</div></div>' +
        '<div class="stat"><div class="n">' + money(inSum - outSum) + '</div><div class="l">本月结余</div></div></div>' +
        '<div class="card"><div class="grid cols-2">' +
        '<div class="field" style="margin:0"><label>类型</label><select class="select" id="fType"><option value="out">支出</option><option value="in">收入</option></select></div>' +
        '<div class="field" style="margin:0"><label>分类</label><input class="input" id="fCat" placeholder="餐饮/差旅/货款…"></div>' +
        '<div class="field" style="margin:0"><label>金额</label><input class="input" id="fAmount" type="number" placeholder="0.00" step="0.01"></div>' +
        '<div class="field" style="margin:0"><label>日期</label><input class="input" id="fDate" type="date" value="' + today() + '"></div>' +
        '<div class="field" style="margin:0 0 12px"><label>备注</label><input class="input" id="fNote" placeholder="选填"></div>' +
        '<div style="display:flex;justify-content:flex-end"><button class="btn" data-act="add">记一笔</button></div></div></div>' +
        '<div class="card"><h2>明细</h2>' + list + '</div>';
    },
    acts: {
      add: function () {
        var amt = parseFloat(document.getElementById('fAmount').value);
        if (!(amt > 0)) { toast('请输入正确金额'); return; }
        state.finance.records.unshift({
          id: S.uid(), type: document.getElementById('fType').value,
          cat: document.getElementById('fCat').value.trim() || '其他',
          amount: amt, note: document.getElementById('fNote').value.trim(),
          date: document.getElementById('fDate').value || today()
        });
        saveRender();
      },
      del: function (el) {
        if (!ask('删除该记录？')) return;
        state.finance.records = state.finance.records.filter(function (x) { return x.id !== el.dataset.id; });
        saveRender();
      }
    }
  };

  /* ================= 模块注册 ================= */
  var modules = [Focus, Todo, Project, Strategy, Contacts, Notes, Habit, Finance, Memo];
  var byKey = {};
  modules.forEach(function (m) { byKey[m.key] = m; });

  /* ================= 渲染 / 路由 ================= */
  function renderNav() {
    navEl.innerHTML = modules.map(function (m) {
      return '<button class="nav-item ' + (m.key === currentKey ? 'active' : '') + '" data-nav="' + m.key + '">' +
        '<span class="ico">' + m.icon + '</span><span class="label">' + m.label + '</span></button>';
    }).join('');
  }
  function renderPage(key) {
    if (!byKey[key]) key = 'focus';
    currentKey = key;
    var mod = byKey[key];
    pageHost.innerHTML = mod.render(state);
    state._meta.lastPage = key; S.save(false); // 仅持久化当前页，不触发整档推送（避免切页面误覆盖对端数据）
    renderNav();
    if (mod.onRender) mod.onRender(); // 模块自定义后绑定（人脉的图谱/省-市/实时搜索等）
  }

  // 事件委托：导航
  navEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-nav]'); if (!b) return;
    renderPage(b.dataset.nav);
  });
  // 事件委托：页面内点击
  pageHost.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var mod = byKey[currentKey];
    if (mod && mod.acts && mod.acts[t.dataset.act]) mod.acts[t.dataset.act](t);
  });
  // 事件委托：日期切换（聚焦）
  pageHost.addEventListener('change', function (e) {
    if (e.target.id === 'focusDate' && currentKey === 'focus') { if (Focus.onDate) Focus.onDate(); }
  });
  // 回车提交（聚焦在主输入/金额框时）
  pageHost.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.target.tagName === 'TEXTAREA') return;
    if (!/(Input|Text|Name|Title|Amount)$/.test(e.target.id)) return;
    var mod = byKey[currentKey];
    if (mod && mod.acts && mod.acts.add) { e.preventDefault(); mod.acts.add({ dataset: {} }); }
  });

  /* ================= 同步 / 设置 ================= */
  var syncDot = document.getElementById('syncDot');
  var syncText = document.getElementById('syncText');
  var lastSyncOkTs = 0; // 上次成功同步时间，用于节流自动拉取，避免耗尽免费额度
  function setSync(status) {
    syncDot.className = 'dot' + (status ? ' ' + status : '');
    syncText.textContent = { ok: '已同步', err: '同步失败', syncing: '同步中…' }[status] || '未同步';
    if (status === 'ok') lastSyncOkTs = Date.now();
  }
  // 未配置同步时给出明确提示（区别于"已配置但未同步成功"）
  function refreshSyncLabel() {
    if (!synced()) { syncDot.className = 'dot'; syncText.textContent = '未配置同步'; }
  }
  // 在设置里展示当前后端与连接状态
  function updateSyncInfo() {
    var s = S.getSettings();
    var jsonEl = document.getElementById('jsonBinDisplay');
    if (jsonEl) {
      if (s.backend === 'gitee') {
        jsonEl.textContent = '当前使用 Gitee 同步';
        jsonEl.className = 'sync-info ok';
      } else if (s.jsonBinId) {
        jsonEl.textContent = '已连接存档 ID：' + s.jsonBinId;
        jsonEl.className = 'sync-info ok';
      } else if (s.jsonKey && s.syncPass) {
        jsonEl.textContent = '尚未连接（同步一次后自动生成）';
        jsonEl.className = 'sync-info';
      } else {
        jsonEl.textContent = '未配置同步';
        jsonEl.className = 'sync-info';
      }
    }
    var giteeEl = document.getElementById('giteeFileDisplay');
    if (giteeEl && s.backend === 'gitee') {
      giteeEl.textContent = '仓库 ' + (s.giteeRepo || '(未填写)') + ' 中的 inaka-state.json';
      giteeEl.className = s.giteeRepo ? 'sync-info ok' : 'sync-info';
    }
  }
  function synced() {
    var s = S.getSettings();
    if (s.backend === 'gitee') return !!(s.giteeToken && s.giteeRepo && s.syncPass);
    return !!(s.jsonKey && s.syncPass);
  }
  function syncBackend() { return S.getSettings().backend || 'jsonbin'; }
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('同步请求超时，请检查网络')); }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }
  var syncing = false, syncRetry = false;
  // 单次同步尝试：拉取合并（变化则采纳并集；无变化则上传本地兜底）→ 否则首次上传
  function attemptSync() {
    return S.syncPull().then(function (remote) {
      if (remote) {
        var m = S.mergeState(state, remote);
        if (m.changed) {
          S.setState(m.state);
          state = S.getState(); // 合并后让本地引用指向新对象，避免后续编辑丢失
          renderPage(currentKey);
          // setState 已触发上传（合并后的并集），云端成为权威副本
        } else {
          // 合并无变化：说明本地可能含有云端没有的独有改动（且此前即时推送未送达），
          // 上传本地以保证云端也包含，避免数据只留在一端
          return S.syncPush();
        }
        setSync('ok');
      } else {
        // 云端还没有数据（首次/重连后）→ 上传本地，建立共享存档
        return S.syncPush().then(function () { setSync('ok'); });
      }
      updateSyncInfo();
    });
  }
  function showSyncError(err) {
    setSync('err'); console.warn(err);
    var backend = syncBackend();
    var msg = (err && err.message) || String(err);
    if (err && err.code === 'CONFLICT') {
      toast('同步冲突：云端刚被其他设备更新，请再点一次「同步」完成合并');
      return;
    }
    if (backend === 'gitee') {
      toast('同步失败：' + giteeErrText(err, S.getSettings().giteeRepo));
      return;
    }
    if (err && err.status === 400 && /requests?\s+exhausted/i.test(msg)) {
      toast('同步失败：jsonbin 本月免费请求额度已用完，请明天再试或升级套餐（jsonbin.io/pricing）');
    } else if (err && err.status === 401) {
      toast('同步失败：jsonbin 密钥无效，请在设置中检查 X-Master-Key');
    } else if (/Failed to fetch|NetworkError|network/i.test(msg)) {
      toast('同步失败：无法连接 jsonbin（国内网络常不稳定，建议改用 Gitee 后端）');
    } else {
      toast('同步失败：' + msg);
    }
  }
  function finishSync() {
    syncing = false; syncRetry = false;
    updateSyncInfo();
  }
  // 把 Gitee 错误码翻译成可操作中文，定位到底是哪一步错
  function giteeErrText(err, repo) {
    var status = err && err.status, msg = (err && err.message) || String(err);
    var repoHint = repo ? '（实际请求：' + repo + '）' : '';
    if (status === 401) return 'Gitee 令牌无效或已过期——去 gitee.com → 设置 → 私人令牌 重新生成（只显示一次，需复制完整）';
    if (status === 403) return 'Gitee 权限不足——生成令牌时请勾选 projects 权限';
    if (status === 404) {
      var pageHint = repo && repo.indexOf('/') !== -1 ? '；可打开 https://gitee.com/' + repo + ' 核对仓库是否存在' : '';
      return 'Gitee 仓库不存在、当前令牌无权访问，或名称格式应为 用户名/仓库名（注意大小写，不要带 https:// 前缀）' + pageHint + repoHint;
    }
    if (status === 0 || /Failed to fetch|NetworkError|network/i.test(msg)) return '网络无法连接 Gitee（检查网络/代理/防火墙）';
    return msg;
  }
  // 从设置弹窗输入框读取当前值（连接自检无需先保存）
  function readSyncInputs() {
    return {
      backend: backendSelect ? backendSelect.value : 'jsonbin',
      jsonKey: (document.getElementById('jsonKeyInput') || {}).value || '',
      giteeToken: (document.getElementById('giteeTokenInput') || {}).value || '',
      giteeRepo: (document.getElementById('giteeRepoInput') || {}).value || '',
      syncPass: (document.getElementById('syncPassInput') || {}).value || ''
    };
  }
  // 若仓库名只填了 repo，则用 token 对应的用户名补全为 owner/repo
  function normalizeGiteeRepo(token, repo) {
    if (!window.GiteeSync || !window.GiteeSync.normalizeRepo) return Promise.resolve(repo);
    return window.GiteeSync.normalizeRepo(token, repo);
  }
  // 连接自检：填完直接告诉你哪一步错，不必再靠猜
  function testConnection() {
    var inp = readSyncInputs();
    var el = document.getElementById('syncTestResult');
    if (!el) return;
    function set(cls, text) { el.className = 'sync-test-result ' + cls; el.textContent = text; }
    if (inp.backend === 'gitee') {
      if (!(inp.giteeToken && inp.giteeRepo)) { set('err', '请先填写 私人令牌 与 仓库名'); return; }
      set('', '正在验证 Gitee 令牌…');
      var fullRepo = '', tokenUser = '';
      // 第一步：验证 token 并拿到用户名（避免把 token 无效误判成仓库不存在）
      window.GiteeSync.whoami(inp.giteeToken).then(function (login) {
        tokenUser = login;
        set('', '令牌有效（用户：' + login + '），正在补全/检查仓库…');
        return normalizeGiteeRepo(inp.giteeToken, inp.giteeRepo);
      }).then(function (repo) {
        fullRepo = repo;
        document.getElementById('giteeRepoInput').value = fullRepo;
        inp.giteeRepo = fullRepo;
        return window.GiteeSync.checkRepo(inp.giteeToken, fullRepo);
      }).then(function (r) {
        if (r.ok) {
          var belongs = tokenUser && fullRepo.indexOf(tokenUser + '/') === 0 ? '' : '（注意：该仓库不属于当前令牌用户）';
          set('ok', '✓ 连接成功：用户 ' + tokenUser + '，仓库 ' + fullRepo + ' 与令牌有效' + belongs);
        }
        else if (r.status === 401) set('err', '✗ ' + giteeErrText({ status: 401 }, fullRepo));
        else if (r.status === 403) set('err', '✗ ' + giteeErrText({ status: 403 }, fullRepo));
        else if (r.status === 404) set('err', '✗ ' + giteeErrText({ status: 404 }, fullRepo));
        else set('err', '✗ ' + (r.msg || '未知错误') + '（实际请求：' + fullRepo + '）');
      }).catch(function (err) {
        if (!tokenUser && err && err.status === 401) {
          set('err', '✗ Gitee 令牌无效或已过期——请重新生成并完整复制');
        } else {
          set('err', '✗ ' + giteeErrText(err, fullRepo || inp.giteeRepo));
        }
      });
    } else {
      if (!inp.jsonKey) { set('err', '请先填写 jsonbin API Key'); return; }
      set('', '正在测试连接 jsonbin…');
      fetch('https://api.jsonbin.io/v3/c', { headers: { 'X-Master-Key': inp.jsonKey } })
        .then(function (res) {
          if (res.ok) set('ok', '✓ jsonbin 连接成功');
          else if (res.status === 401) set('err', '✗ jsonbin 密钥无效，请检查 X-Master-Key');
          else set('err', '✗ jsonbin 返回 HTTP ' + res.status);
        })
        .catch(function () { set('err', '✗ 网络无法连接 jsonbin（国内可能不稳定，建议改用 Gitee 后端）'); });
    }
  }
  // 统一策略：先拉取并安全合并 → 需要时上传。带 15s 超时，避免网络卡住导致「同步中」永久灰色。
  function runSync() {
    if (!synced()) return Promise.resolve();
    if (syncing) return Promise.resolve();
    syncing = true; setSync('syncing');
    return withTimeout(S.ensureBin().then(function () {
      return attemptSync();
    }), 15000).catch(function (err) {
      // 共享存档失效（bin 或集合 id 失联）→ 已断开重连，重试一次以本地数据为准重建
      if (err && err.code === 'BIN_MISSING' && !syncRetry) {
        syncRetry = true;
        return withTimeout(attemptSync(), 15000);
      }
      // Gitee 冲突：云端已被其他设备更新，拉取合并后重推一次
      if (err && err.code === 'CONFLICT' && !syncRetry) {
        syncRetry = true;
        return withTimeout(attemptSync(), 15000);
      }
      showSyncError(err);
    }).then(finishSync, finishSync);
  }
  function doSync() {
    if (!synced()) { openSettings(); toast('请先在设置中填写同步信息'); return; }
    runSync();
  }
  document.getElementById('syncBtn').addEventListener('click', doSync);

  // 自动同步：本地改动即推 + 定时拉取 + 切回页面拉取
  var autoStarted = false, visStarted = false, autoTimer = null;
  function startAutoSync() {
    if (!synced()) return;
    if (!autoStarted) {
      // 本地有改动时只推送（不先拉），由定时器和切回页面负责拉取，节省请求次数
      // 用 pendingPush 兜底：推送进行中若又有新改动，推送完成后会再推一次，避免最后几次编辑漏传云端
      var pendingPush = false, lastPushTs = 0;
      function doPush() {
        syncing = true; setSync('syncing');
        withTimeout(S.syncPush(), 15000).then(function () { setSync('ok'); lastPushTs = Date.now(); }).catch(function (err) {
          showSyncError(err);
        }).then(function () {
          syncing = false;
          if (pendingPush) { pendingPush = false; doPush(); }
        });
      }
      S.onSave(function () {
        if (syncing) { pendingPush = true; return; }
        // 5s 内合并为一次推送，避免连续编辑瞬间刷爆请求额度
        if (Date.now() - lastPushTs < 5000) { pendingPush = true; return; }
        doPush();
      });
      autoStarted = true;
    }
    if (autoTimer) clearInterval(autoTimer);
    // 拉取节流：定时 120s，且距上次成功同步不足 60s 时跳过，避免耗尽 jsonbin 免费额度
    autoTimer = setInterval(function () {
      if (!document.hidden && Date.now() - lastSyncOkTs > 60000) runSync();
    }, 120000);
    if (!visStarted) {
      // 切回页面（手机从后台回来）拉一次，但不短于 60s 节流
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && Date.now() - lastSyncOkTs > 60000) runSync();
      });
      visStarted = true;
    }
    runSync();
  }

  function exportNow() {
    var data = JSON.stringify(S.exportJson(), null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'inaka工作台备份-' + today() + '.json';
    a.click();
    toast('已导出 ' + (data.length / 1024).toFixed(1) + ' KB');
  }

  var modal = document.getElementById('settingsModal');
  var backendSelect = document.getElementById('syncBackendSelect');
  var jsonbinSection = document.getElementById('jsonbinSection');
  var giteeSection = document.getElementById('giteeSection');
  function renderBackendUI() {
    var backend = backendSelect ? backendSelect.value : 'jsonbin';
    if (jsonbinSection) jsonbinSection.style.display = backend === 'jsonbin' ? 'block' : 'none';
    if (giteeSection) giteeSection.style.display = backend === 'gitee' ? 'block' : 'none';
  }
  if (backendSelect) backendSelect.addEventListener('change', renderBackendUI);
  function openSettings() {
    var s = S.getSettings();
    if (backendSelect) backendSelect.value = s.backend || 'jsonbin';
    renderBackendUI();
    document.getElementById('jsonKeyInput').value = s.jsonKey || '';
    document.getElementById('giteeTokenInput').value = s.giteeToken || '';
    document.getElementById('giteeRepoInput').value = s.giteeRepo || '';
    document.getElementById('syncPassInput').value = s.syncPass || '';
    updateSyncInfo();
    modal.classList.add('open');
  }
  function closeSettings() { modal.classList.remove('open'); }
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('settingsCancel').addEventListener('click', closeSettings);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeSettings(); });
  document.getElementById('settingsSave').addEventListener('click', function () {
    var s = S.getSettings();
    s.backend = backendSelect ? backendSelect.value : 'jsonbin';
    s.jsonKey = document.getElementById('jsonKeyInput').value.trim();
    s.giteeToken = document.getElementById('giteeTokenInput').value.trim();
    var rawRepo = document.getElementById('giteeRepoInput').value.trim();
    s.syncPass = document.getElementById('syncPassInput').value.trim();
    // 重置 bin/集合 id：改为"按 API Key + 口令自动发现同一存档"，避免沿用旧的独立 bin
    s.jsonBinId = '';
    s.jsonCollectionId = '';

    function finishSave(repo) {
      if (repo) s.giteeRepo = repo;
      S.setSettings(s);
      updateSyncInfo();
      if (synced()) startAutoSync();
      toast('设置已保存，正在测试连接…');
      testConnection(); // 立即自检，结果直接显示在弹窗里（不关闭弹窗，方便照提示修正）
    }

    // Gitee 后端且只填了仓库名：自动补全为 用户名/仓库名 再保存
    if (s.backend === 'gitee' && s.giteeToken && rawRepo && rawRepo.indexOf('/') === -1) {
      normalizeGiteeRepo(s.giteeToken, rawRepo).then(function (fullRepo) {
        document.getElementById('giteeRepoInput').value = fullRepo;
        finishSave(fullRepo);
      }).catch(function (err) {
        toast('保存失败：' + giteeErrText(err, rawRepo));
        testConnection();
      });
    } else {
      s.giteeRepo = rawRepo;
      finishSave();
    }
  });
  var testBtn = document.getElementById('syncTestBtn');
  if (testBtn) testBtn.addEventListener('click', testConnection);
  var relinkBtn = document.getElementById('relinkBtn');
  if (relinkBtn) relinkBtn.addEventListener('click', function () {
    S.resetSyncLink();
    toast('已重置同步连接，下次同步将重新定位共享存档');
    updateSyncInfo();
  });
  document.getElementById('exportBtn').addEventListener('click', exportNow);
  var exportBtn2 = document.getElementById('exportBtn2');
  if (exportBtn2) exportBtn2.addEventListener('click', exportNow);
  document.getElementById('importBtn').addEventListener('click', function () {
    var file = document.getElementById('importInput').files[0];
    if (!file) { toast('请先选择文件'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        S.importJson(obj);
        renderPage(currentKey);
        toast('导入成功');
      } catch (e) { toast('导入失败：文件格式不正确'); }
    };
    reader.readAsText(file);
  });
  document.getElementById('resetBtn').addEventListener('click', function () {
    if (!ask('将清空全部本地数据，且无法撤销。确认？')) return;
    S.reset(); state = S.getState(); renderPage(currentKey); toast('已清空');
  });

  /* ================= 初始化 ================= */
  function init() {
    // 本地存储配额超限提示（多见于备忘里照片过多）
    window.__onSaveError = function () {
      toast('⚠️ 本地存储空间已满，部分内容可能未保存。请删除一些带照片的备忘，或清理数据。');
    };
    var hasLocal = false;
    try { hasLocal = !!localStorage.getItem('inaka_workbench_state_v1'); } catch (e) {}
    if (migrateProjectCats()) S.save(false);
    function go() { renderPage(currentKey); }
    if (!hasLocal) {
      fetch('data/seed.json').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j) { S.importJson(j); state = S.getState(); } })
        .catch(function () {}).then(go);
    } else {
      go();
    }
    // 已配置同步则自动开始（未配置则填完设置后由 settingsSave 启动）
    startAutoSync();
    refreshSyncLabel();
    // 注册 Service Worker（PWA：手机可添加到主屏幕、离线可用）
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW 注册失败', e); });
      // 新版本 SW 接管时自动刷新一次，避免手机端一直显示旧缓存页面
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!window.__wbReloaded) { window.__wbReloaded = true; location.reload(); }
      });
    }
  }
  init();
})();
