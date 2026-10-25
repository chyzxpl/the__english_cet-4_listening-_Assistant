/**
 * 知识问答 Agent · 本地前端
 * 通过 iframe 嵌入本地部署的 Dify Chatflow / Workflow WebApp
 * 纯静态页面，无需构建工具。
 */
(function () {
  'use strict';

  const STORE_KEY = 'dify-agent-config-v1';
  const USER_KEY = 'dify-agent-uid-v1';
  const LOAD_TIMEOUT = 10000;

  const DEFAULTS = {
    baseUrl: 'http://localhost',
    appType: 'chatbot',
    token: '',
    userId: '',
    userName: '同学',
    inputs: '',
    chips: [
      '这个知识库主要覆盖哪些内容？',
      '帮我总结一下核心要点',
      '有没有相关的示例或案例？',
      '这个概念和另一个有什么区别？',
      '用一句话解释给我听'
    ]
  };

  /* ---------------- 工具 ---------------- */

  const $ = (id) => document.getElementById(id);

  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    $('toastWrap').appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 250);
    }, type === 'err' ? 3600 : 2400);
  }

  function randomId() {
    return 'user_' + Math.random().toString(36).slice(2, 10);
  }

  function normalizeBase(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  /** 从粘贴的 WebApp / iframe 链接中解析出 {baseUrl, appType, token} */
  function parseEmbedUrl(raw) {
    const input = String(raw || '').trim();
    if (!input) return null;

    const m = input.match(/(https?:\/\/[^/]+)\/?(?:.*?)\/(chatbot|workflow|completion|chat)\/([A-Za-z0-9_-]{4,})/);
    if (m) {
      return {
        baseUrl: normalizeBase(m[1]),
        appType: m[2] === 'chat' ? 'chatbot' : m[2],
        token: m[3]
      };
    }
    // 只有 token 的情况
    if (/^[A-Za-z0-9_-]{6,}$/.test(input)) {
      return { token: input };
    }
    // 只有地址的情况
    if (/^https?:\/\//i.test(input)) {
      return { baseUrl: normalizeBase(input) };
    }
    return null;
  }

  function originOf(baseUrl) {
    try {
      return new URL(baseUrl).origin;
    } catch (e) {
      return '*';
    }
  }

  /* ---------------- 配置读写 ---------------- */

  let cfg = Object.assign({}, DEFAULTS, readStore());
  if (!cfg.userId) {
    cfg.userId = localStorage.getItem(USER_KEY) || randomId();
    localStorage.setItem(USER_KEY, cfg.userId);
  }

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveStore(obj) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(obj));
    } catch (e) { /* 忽略隐私模式写入失败 */ }
  }

  function persist() {
    const data = Object.assign({}, cfg);
    saveStore(data);
    localStorage.setItem(USER_KEY, cfg.userId);
  }

  /* ---------------- 构建 iframe 地址 ---------------- */

  function buildSrc(freshConversation) {
    const base = normalizeBase(cfg.baseUrl);
    const url = new URL(`/${cfg.appType}/${cfg.token}`, base.endsWith('/') ? base : base + '/');

    if (cfg.userId) url.searchParams.set('sys.user_id', cfg.userId);
    if (cfg.userName) url.searchParams.set('sys.user_name', cfg.userName);
    if (freshConversation) url.searchParams.set('_t', String(Date.now()));

    const extra = safeInputs();
    if (extra) {
      if (cfg.appType === 'workflow') {
        url.searchParams.set('sys.inputs', JSON.stringify(extra));
      } else {
        Object.keys(extra).forEach((k) => url.searchParams.set(k, String(extra[k])));
      }
    }
    return url.toString();
  }

  function safeInputs() {
    if (!cfg.inputs) return null;
    try {
      const obj = JSON.parse(cfg.inputs);
      return obj && typeof obj === 'object' ? obj : null;
    } catch (e) {
      return null;
    }
  }

  /* ---------------- 状态与渲染 ---------------- */

  let loadTimer = null;

  function setStatus(state, text) {
    const pill = $('statusPill');
    pill.className = 'status-pill status-' + state;
    $('statusText').textContent = text;
  }

  function showOverlay(which) {
    ['overlayLoading', 'overlayEmpty', 'overlayError'].forEach((id) => {
      $(id).classList.toggle('hidden', id !== which);
    });
  }

  function hideOverlays() {
    ['overlayLoading', 'overlayEmpty', 'overlayError'].forEach((id) => $(id).classList.add('hidden'));
  }

  function renderInfo() {
    $('infoBase').textContent = normalizeBase(cfg.baseUrl) || '—';
    $('infoType').textContent = cfg.appType || '—';
    $('infoToken').textContent = cfg.token || '—';
    $('infoUser').textContent = cfg.userId || '—';
  }

  function renderChips() {
    const box = $('chips');
    box.innerHTML = '';
    (cfg.chips || []).forEach((q) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = q;
      b.addEventListener('click', () => sendQuestion(q));
      box.appendChild(b);
    });
  }

  /* ---------------- iframe 生命周期 ---------------- */

  function mountIframe(freshConversation) {
    clearTimeout(loadTimer);
    const frame = $('difyFrame');

    if (!cfg.token) {
      frame.removeAttribute('src');
      setStatus('idle', '未配置');
      showOverlay('overlayEmpty');
      renderInfo();
      return;
    }

    const src = buildSrc(freshConversation);
    $('loadingUrl').textContent = src;
    setStatus('loading', '连接中');
    showOverlay('overlayLoading');

    frame.onload = () => {
      clearTimeout(loadTimer);
      hideOverlays();
      setStatus('ok', '已就绪');
      pushContext();
    };
    frame.onerror = () => fail('iframe 加载失败');

    frame.src = src;

    loadTimer = setTimeout(() => {
      // Dify 首屏较慢，命中超时时再做一次可达性探测来判断真实原因
      probe().then((ok) => {
        if (ok) {
          clearTimeout(loadTimer);
          hideOverlays();
          setStatus('ok', '已就绪（响应较慢）');
        } else {
          fail('无法访问 ' + normalizeBase(cfg.baseUrl) + '，请确认 Dify 已启动');
        }
      });
    }, LOAD_TIMEOUT);
  }

  function fail(msg) {
    clearTimeout(loadTimer);
    $('errorMsg').textContent = msg;
    setStatus('error', '连接失败');
    showOverlay('overlayError');
  }

  /** 轻量可达性探测：no-cors 请求能被响应即视为服务在线 */
  function probe() {
    const base = normalizeBase(cfg.baseUrl);
    return new Promise((resolve) => {
      const done = (v) => resolve(v);
      const t = setTimeout(() => done(false), 5000);
      fetch(base + '/', { mode: 'no-cors', cache: 'no-store' })
        .then(() => { clearTimeout(t); done(true); })
        .catch(() => { clearTimeout(t); done(false); });
    });
  }

  /* ---------------- 与 iframe 通信 ---------------- */

  /** 尝试把用户标识推给工作流（Dify 支持时生效，不支持时静默忽略） */
  function pushContext() {
    const win = $('difyFrame').contentWindow;
    if (!win) return;
    const origin = originOf(cfg.baseUrl);
    [
      { type: 'dify:set-user-context', user_id: cfg.userId, user_name: cfg.userName },
      { type: 'USER_CONTEXT_UPDATE', payload: { userId: cfg.userId, userName: cfg.userName } }
    ].forEach((msg) => {
      try { win.postMessage(msg, origin); } catch (e) { /* 忽略 */ }
    });
  }

  /** 向 iframe 投递一条提问；成功投递返回 true */
  function deliver(text) {
    const win = $('difyFrame').contentWindow;
    if (!win) return false;
    const origin = originOf(cfg.baseUrl);
    const variants = [
      { type: 'dify-chatbot-send-message', message: text },
      { type: 'dify:send-message', payload: { message: text } },
      { type: 'SEND_MESSAGE', payload: { text: text } }
    ];
    let sent = false;
    variants.forEach((msg) => {
      try { win.postMessage(msg, origin); sent = true; } catch (e) { /* 忽略 */ }
    });
    return sent;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    ta.remove();
  }

  function sendQuestion(text) {
    const q = String(text || '').trim();
    if (!q) return;
    if (!cfg.token) {
      toast('请先配置 Dify 应用', 'err');
      openModal();
      return;
    }
    copyText(q);
    deliver(q);
    toast('已发送；如未出现，直接粘贴即可（已复制）', 'ok');
  }

  // 接收来自 Dify iframe 的消息（可用于扩展：埋点、同步标题等）
  window.addEventListener('message', (e) => {
    const origin = originOf(cfg.baseUrl);
    if (origin !== '*' && e.origin !== origin) return;
    const t = e.data && e.data.type;
    if (t && /ready|message|conversation/i.test(String(t))) {
      clearTimeout(loadTimer);
      if ($('statusPill').className.indexOf('status-ok') === -1) setStatus('ok', '已就绪');
    }
  });

  /* ---------------- 设置弹窗 ---------------- */

  function openModal() {
    $('cfgEmbedUrl').value = '';
    $('cfgBaseUrl').value = cfg.baseUrl;
    $('cfgAppType').value = cfg.appType;
    $('cfgToken').value = cfg.token;
    $('cfgUserId').value = cfg.userId;
    $('cfgUserName').value = cfg.userName;
    $('cfgInputs').value = cfg.inputs || '';
    $('cfgError').classList.add('hidden');
    $('modal').classList.remove('hidden');
    setTimeout(() => $('cfgEmbedUrl').focus(), 50);
  }

  function closeModal() {
    $('modal').classList.add('hidden');
  }

  function submitModal() {
    const embedRaw = $('cfgEmbedUrl').value.trim();
    let base = $('cfgBaseUrl').value.trim();
    let type = $('cfgAppType').value;
    let token = $('cfgToken').value.trim();

    if (embedRaw) {
      const p = parseEmbedUrl(embedRaw);
      if (!p) {
        $('cfgError').textContent = '无法识别这个链接，请粘贴形如 http://localhost/chatbot/xxxx 的地址。';
        $('cfgError').classList.remove('hidden');
        return;
      }
      if (p.baseUrl) base = p.baseUrl;
      if (p.appType) type = p.appType;
      if (p.token) token = p.token;
    }

    if (!base) {
      $('cfgError').textContent = '请填写 Dify 地址，例如 http://localhost';
      $('cfgError').classList.remove('hidden');
      return;
    }
    if (!token) {
      $('cfgError').textContent = '请填写应用 Token（WebApp 链接最后一段）';
      $('cfgError').classList.remove('hidden');
      return;
    }

    cfg.baseUrl = normalizeBase(base);
    cfg.appType = type;
    cfg.token = token;
    cfg.userId = $('cfgUserId').value.trim() || randomId();
    cfg.userName = $('cfgUserName').value.trim() || '同学';
    cfg.inputs = $('cfgInputs').value.trim();

    persist();
    renderInfo();
    closeModal();
    mountIframe(false);
    toast('配置已保存，正在连接', 'ok');
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    $('btnSettings').addEventListener('click', openModal);
    $('btnEmptyConfig').addEventListener('click', openModal);
    $('btnErrConfig').addEventListener('click', openModal);
    $('btnCloseModal').addEventListener('click', closeModal);
    $('btnCancel').addEventListener('click', closeModal);
    $('btnSave').addEventListener('click', submitModal);
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

    $('btnQuickSend').addEventListener('click', () => {
      const v = $('quickInput').value;
      if (!String(v).trim()) { toast('先写点什么吧'); return; }
      sendQuestion(v);
      $('quickInput').value = '';
    });
    $('quickInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('btnQuickSend').click();
    });

    $('btnNewChat').addEventListener('click', () => {
      if (!cfg.token) { toast('请先配置 Dify 应用', 'err'); openModal(); return; }
      mountIframe(true);
      toast('已开启新会话', 'ok');
    });
    $('btnReload').addEventListener('click', () => mountIframe(false));

    $('btnProbe').addEventListener('click', () => {
      toast('正在检测 ' + normalizeBase(cfg.baseUrl) + ' …');
      probe().then((ok) => {
        toast(ok ? 'Dify 服务可访问，问题多半在 Token 或 iframe 拦截' : 'Dify 服务不可达，请先启动容器', ok ? 'ok' : 'err');
      });
    });

    $('btnFullscreen').addEventListener('click', () => {
      const layout = $('layout');
      layout.classList.toggle('focus');
      toast(layout.classList.contains('focus') ? '专注模式：再次点击退出' : '已退出专注模式');
    });

    $('btnEmbed').addEventListener('click', () => {
      if (!cfg.token) { toast('请先配置 Dify 应用', 'err'); openModal(); return; }
      const code =
        '<iframe\n' +
        '  src="' + buildSrc(false) + '"\n' +
        '  style="width: 100%; height: 100%; min-height: 700px"\n' +
        '  frameborder="0"\n' +
        '  allow="microphone">\n' +
        '</iframe>';
      copyText(code);
      toast('嵌入代码已复制', 'ok');
    });

    $('btnErrRetry').addEventListener('click', () => mountIframe(false));

    $('btnReset').addEventListener('click', () => {
      cfg = Object.assign({}, DEFAULTS, { userId: cfg.userId });
      persist();
      openModal();
      toast('已恢复默认设置');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal();
    });

    // 支持通过 URL 快速初始化：?token=xxx&base=http://localhost:8088
    const q = new URLSearchParams(location.search);
    if (q.get('token')) { cfg.token = q.get('token'); }
    if (q.get('base')) { cfg.baseUrl = normalizeBase(q.get('base')); }
    if (q.get('type')) { cfg.appType = q.get('type'); }
    if (q.get('token') || q.get('base')) persist();
  }

  /* ---------------- 启动 ---------------- */

  bind();
  renderChips();
  renderInfo();
  mountIframe(false);
})();
