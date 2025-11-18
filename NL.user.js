// ==UserScript==
// @name         论坛自动刷帖（全站巡航+后台保活版）
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  新增后台保活功能，确保浏览器在后台时脚本也能正常运行 | 新增跨区自动导航 | 新增重置配置按钮
// @author       levi & ChatGPT & AI-Refactor
// @match        https://www.nodeloc.com/*
// @match        https://meta.discourse.org/*
// @grant        GM_setValue
// @grant        GM_getValue
// @license      MIT
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nodeloc.com
// @noframes
// @downloadURL https://update.greasyfork.org/scripts/553171/linuxdo%E4%BF%9D%E6%B4%BB%E4%BC%98%E5%8C%96%E7%89%88%EF%BC%88%E9%AB%98%E6%80%A7%E8%83%BD%E7%89%88%EF%BC%89.user.js
// @updateURL https://update.greasyfork.org/scripts/553171/linuxdo%E4%BF%9D%E6%B4%BB%E4%BC%98%E5%8C%96%E7%89%88%EF%BC%88%E9%AB%98%E6%80%A7%E8%83%BD%E7%89%88%EF%BC%89.meta.js
// ==/UserScript==

(() => {
  'use strict';

  /** ========== 配置 & 状态 ========== **/
  const MAX_HISTORY_SIZE = 1000;

  const defaultConfig = {
    scrollInterval: 1200, scrollStep: 800, scrollDuration: 30,
    maxTopics: 999999, maxRunMins: 999999, showPreview: true,
  };
  let cfg = { ...defaultConfig, ...GM_getValue('linuxdoConfig', {}) };
  let visitedTopics = GM_getValue('linuxdoVisitedTopics', []);

  const categoryUrls = [
    "https://www.nodeloc.com/latest",
    "https://www.nodeloc.com/c/internet/5",
    "https://www.nodeloc.com/c/internet/review/11",
    "https://www.nodeloc.com/c/technology/7",
    "https://www.nodeloc.com/c/digital/6",
    "https://www.nodeloc.com/c/information/10",
    "https://www.nodeloc.com/c/life/9",
    "https://www.nodeloc.com/c/trade/13",
    "https://www.nodeloc.com/c/events/lottery/12",
    "https://www.nodeloc.com/tag/AI"
  ];

  const log = (t, ...a) => console[t](`[论坛助手]`, ...a);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const randomWait = (min = 2000, max = 5000) => wait(Math.random() * (max - min) + min);
  const shuffle = arr => arr.sort(() => Math.random() - 0.5);

  let isEnabled = false;
  let isPaused = false;
  const session = { start: Date.now(), views: 0 };

  const getAutoNav = () => GM_getValue('linuxdoAutoNav', false);
  const setAutoNav = (state) => GM_setValue('linuxdoAutoNav', state);

  let uiState = {
    x: window.innerWidth - 240, y: window.innerHeight - 400,
    minimized: false, ...GM_getValue('linuxdoUiState', {})
  };
  const saveUiState = () => GM_setValue('linuxdoUiState', uiState);
  const saveConfig = () => GM_setValue('linuxdoConfig', cfg);
  const saveVisitedTopics = () => GM_setValue('linuxdoVisitedTopics', visitedTopics);

  // [AI-MODIFIED] 新增：后台保活功能
  let keepAliveAudio = null;
  const silentAudioDataUri = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

  function manageKeepAlive(start) {
      if (start) {
          if (keepAliveAudio) return; // 已经在播放
          log('info', '启动后台保活功能。');
          keepAliveAudio = new Audio(silentAudioDataUri);
          keepAliveAudio.loop = true;
          keepAliveAudio.play().catch(e => log('warn', '后台保活音频播放失败，可能需要用户与页面交互一次。', e));
      } else {
          if (!keepAliveAudio) return; // 已经停止
          log('info', '停止后台保活功能。');
          keepAliveAudio.pause();
          keepAliveAudio = null;
      }
  }

  /** ========== UI 面板 ========== **/
  function initPanel() {
    if (document.getElementById('ld-panel-container')) return;

    const styles = `
      :root {
        --ld-bg-dark: #2c3e50; --ld-bg-panel: #f7f9fc; --ld-text-light: #ecf0f1;
        --ld-text-dark: #34495e; --ld-primary: #3498db; --ld-success: #2ecc71;
        --ld-danger: #e74c3c; --ld-warning: #f39c12; --ld-border: #e0e0e0;
        --ld-shadow: 0 5px 15px rgba(0,0,0,0.1);
      }
      .ld-common { position: fixed; box-shadow: var(--ld-shadow); z-index: 99999; font-family: "Segoe UI", sans-serif; user-select: none; }
      #ld-panel { width: 220px; border-radius: 12px; background: var(--ld-bg-panel); overflow: hidden; display: ${uiState.minimized ? 'none' : 'block'}; }
      .ld-header { display: flex; justify-content: space-between; align-items: center; cursor: move; background: var(--ld-bg-dark); color: var(--ld-text-light); padding: 8px 12px; font-size: 14px; font-weight: 600; }
      .ld-header-btn { cursor: pointer; font-weight: bold; padding: 0 5px; }
      .ld-body { padding: 12px; font-size: 13px; display: grid; gap: 10px; }
      .ld-body-row { display: flex; justify-content: space-between; align-items: center; }
      .ld-button { width: 100%; padding: 8px; border: none; border-radius: 6px; color: var(--ld-text-light); cursor: pointer; font-weight: 500; transition: all 0.2s ease; }
      .ld-button:active { transform: scale(0.98); }
      #ld-start { background: var(--ld-success); }
      #ld-start.running { background: var(--ld-danger); }
      #ld-pause { background: var(--ld-primary); }
      #ld-pause.paused { background: var(--ld-success); }
      #ld-state { font-weight: bold; }
      #ld-settings { display: none; border-top: 1px solid var(--ld-border); margin-top: 10px; padding-top: 10px; }
      .ld-settings-row { margin-bottom: 8px; }
      .ld-settings-row label { font-size: 12px; color: #555; }
      .ld-settings-row input[type="number"] { width: 100%; box-sizing: border-box; border: 1px solid var(--ld-border); border-radius: 4px; padding: 4px 6px; margin-top: 2px; }
      #ld-ball { width: 60px; height: 60px; border-radius: 50%; background: var(--ld-bg-dark); color: var(--ld-text-light); display: ${uiState.minimized ? 'flex' : 'none'}; align-items: center; justify-content: center; cursor: move; font-size: 28px; transition: transform 0.2s ease; }
      #ld-ball:hover { transform: scale(1.1); }
      .ld-toggle-row { display: flex; align-items: center; justify-content: space-between; }
      .ld-switch { position: relative; display: inline-block; width: 34px; height: 20px; }
      .ld-switch input { opacity: 0; width: 0; height: 0; }
      .ld-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 20px; }
      .ld-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
      input:checked + .ld-slider { background-color: var(--ld-success); }
      input:checked + .ld-slider:before { transform: translateX(14px); }
      #ld-clear-history, #ld-reset-config { background-color: var(--ld-warning); margin-top: 5px; }
    `;
    document.head.appendChild(Object.assign(document.createElement("style"), { innerText: styles }));

    const container = document.body.appendChild(document.createElement('div'));
    container.id = 'ld-panel-container';
    container.innerHTML = `
      <div id="ld-panel" class="ld-common">
        <div class="ld-header"><span>🧩 论坛助手</span><div><span id="ld-toggle-settings" class="ld-header-btn">⚙️</span><span id="ld-min" class="ld-header-btn">—</span></div></div>
        <div class="ld-body">
          <div class="ld-body-row"><span>🕒 运行时间:</span> <span id="ld-time">0:00</span></div>
          <div class="ld-body-row"><span>👀 本次浏览:</span> <span id="ld-views">0</span></div>
          <div class="ld-body-row"><span>⚙️ 当前状态:</span> <span id="ld-state"></span></div>
          <div id="ld-settings">
            <div class="ld-settings-row"><label for="ld-max-mins">最大运行时长 (分钟)</label><input type="number" id="ld-max-mins" value="${cfg.maxRunMins}"></div>
            <div class="ld-settings-row"><label for="ld-max-topics">最大浏览帖子数</label><input type="number" id="ld-max-topics" value="${cfg.maxTopics}"></div>
            <div class="ld-settings-row ld-toggle-row"><label for="ld-show-preview">显示预览窗口</label><label class="ld-switch"><input type="checkbox" id="ld-show-preview" ${cfg.showPreview ? 'checked' : ''}><span class="ld-slider"></span></label></div>
            <button id="ld-clear-history" class="ld-button">清空已读历史</button>
            <button id="ld-reset-config" class="ld-button">重置配置为默认</button>
          </div>
          <button id="ld-start" class="ld-button">▶️ 开始</button>
          <button id="ld-pause" class="ld-button">⏸ 暂停</button>
        </div>
      </div>
      <div id="ld-ball" class="ld-common">🧩</div>
    `;

    const panel = container.querySelector('#ld-panel'), ball = container.querySelector('#ld-ball');
    const els = {
      t: panel.querySelector('#ld-time'), v: panel.querySelector('#ld-views'), s: panel.querySelector('#ld-state'),
      start: panel.querySelector('#ld-start'), pause: panel.querySelector('#ld-pause'),
      settings: panel.querySelector('#ld-settings'), maxMins: panel.querySelector('#ld-max-mins'),
      maxTopics: panel.querySelector('#ld-max-topics'), showPreview: panel.querySelector('#ld-show-preview'),
      clearHistory: panel.querySelector('#ld-clear-history'),
      resetConfig: panel.querySelector('#ld-reset-config'),
    };

    const setPosition = (el, x, y) => { el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.right = 'auto'; el.style.bottom = 'auto'; };
    setPosition(panel, uiState.x, uiState.y); setPosition(ball, uiState.x, uiState.y);

    const makeDraggable = (handle, target) => {
      handle.onmousedown = e => {
        e.preventDefault();
        let sx = e.clientX, sy = e.clientY, sl = target.offsetLeft, st = target.offsetTop;
        document.onmousemove = ev => { uiState.x = sl + ev.clientX - sx; uiState.y = st + ev.clientY - sy; setPosition(target, uiState.x, uiState.y); };
        document.onmouseup = () => { document.onmousemove = null; document.onmouseup = null; saveUiState(); };
      };
    };
    makeDraggable(panel.querySelector('.ld-header'), panel); makeDraggable(ball, ball);

    panel.querySelector('#ld-min').onclick = () => { uiState.minimized = true; panel.style.display = 'none'; ball.style.display = 'flex'; setPosition(ball, panel.offsetLeft, panel.offsetTop); saveUiState(); };
    ball.onclick = () => { uiState.minimized = false; ball.style.display = 'none'; panel.style.display = 'block'; setPosition(panel, ball.offsetLeft, ball.offsetTop); saveUiState(); };
    panel.querySelector('#ld-toggle-settings').onclick = () => { els.settings.style.display = els.settings.style.display === 'none' ? 'block' : 'none'; };

    els.maxMins.oninput = () => { cfg.maxRunMins = parseInt(els.maxMins.value) || 999999; saveConfig(); };
    els.maxTopics.oninput = () => { cfg.maxTopics = parseInt(els.maxTopics.value) || 999999; saveConfig(); };
    els.showPreview.onchange = () => { cfg.showPreview = els.showPreview.checked; saveConfig(); };
    els.clearHistory.onclick = () => { visitedTopics = []; saveVisitedTopics(); log('info', '已读历史已清空！'); alert('已读历史已清空！'); };
    els.resetConfig.onclick = () => {
        if (confirm('确定要重置所有设置为默认值吗？这会将时长和帖子数恢复为999999。')) {
            cfg = { ...defaultConfig };
            saveConfig();
            els.maxMins.value = cfg.maxRunMins;
            els.maxTopics.value = cfg.maxTopics;
            els.showPreview.checked = cfg.showPreview;
            log('info', '配置已重置为默认值！');
            alert('配置已重置为默认值！');
        }
    };

    els.pause.onclick = () => {
        if (isEnabled) {
            isPaused = !isPaused;
            // [AI-MODIFIED] 暂停时也停止保活，恢复时再启动
            if (isPaused) {
                manageKeepAlive(false);
            } else {
                manageKeepAlive(true);
            }
            log('info', `助手已${isPaused ? '暂停' : '恢复'}`);
        }
    };
    els.start.onclick = async () => {
      if (isEnabled) {
        isEnabled = false;
        setAutoNav(false);
        manageKeepAlive(false); // [AI-MODIFIED] 手动停止时，停止后台保活
        log('info', '助手已手动停止');
      } else {
        isPaused = false; session.start = Date.now(); session.views = 0;
        cfg.maxRunMins = parseInt(els.maxMins.value); cfg.maxTopics = parseInt(els.maxTopics.value); cfg.showPreview = els.showPreview.checked;
        isEnabled = true;
        setAutoNav(true);
        manageKeepAlive(true); // [AI-MODIFIED] 手动开始时，启动后台保活
        log('info', '助手已启动，配置：', cfg);
        runMain();
      }
    };

    setInterval(() => {
      const running = isEnabled;
      const st = running ? (isPaused ? '暂停中' : '运行中') : (session.views > 0 ? '已完成' : '停止');
      const clr = running ? (isPaused ? 'var(--ld-warning)' : 'var(--ld-success)') : 'var(--ld-danger)';
      els.s.textContent = st; els.s.style.color = clr;
      els.v.textContent = `${session.views} / ${cfg.maxTopics}`;
      if (running) { const e = Math.floor((Date.now() - session.start) / 1000); els.t.textContent = `${Math.floor(e / 60)}:${(e % 60).toString().padStart(2, '0')}`; }
      els.start.textContent = running ? '🛑 停止' : '▶️ 开始'; els.start.classList.toggle('running', running);
      els.pause.textContent = isPaused ? '▶️ 恢复' : '⏸ 暂停'; els.pause.classList.toggle('paused', isPaused); els.pause.disabled = !running;
    }, 500);
  }

  /** ========== 核心功能 ========== **/
  async function browseTopic(topic) {
    while (isPaused) await wait(1000);
    if (!isEnabled) return;

    log('info', `正在浏览: ${topic.title}`);
    const iframe = document.body.appendChild(document.createElement('iframe'));

    iframe.sandbox = 'allow-scripts allow-same-origin';
    const visibleStyle = `position: fixed; top: 70px; left: 8px; width: 320px; height: 480px; z-index: 99998; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 0 8px rgba(0,0,0,0.2); background: white;`;
    const hiddenStyle = `position:fixed; top:-9999px; left:-9999px; opacity:0;`;
    iframe.style.cssText = cfg.showPreview ? visibleStyle : hiddenStyle;

    iframe.src = `${topic.url}?_=${Date.now()}`;

    try {
      await Promise.race([new Promise(r => (iframe.onload = r)), wait(10000)]);
      session.views++;

      if (!visitedTopics.includes(topic.url)) {
        visitedTopics.push(topic.url);
        if (visitedTopics.length > MAX_HISTORY_SIZE) visitedTopics.shift();
        saveVisitedTopics();
      }

      const endTime = Date.now() + cfg.scrollDuration * 1000;
      while (Date.now() < endTime && isEnabled) {
        if (isPaused) { await wait(1000); continue; }
        if (iframe.contentWindow) iframe.contentWindow.scrollBy(0, cfg.scrollStep);
        await wait(cfg.scrollInterval);
      }
    } catch (e) { log('error', '浏览帖子时发生错误', e); }
    finally { iframe.remove(); await randomWait(); }
  }

  const stopScript = () => {
      isEnabled = false;
      setAutoNav(false);
      manageKeepAlive(false); // [AI-MODIFIED] 统一的停止函数，确保停止保活
  }

  const shouldStop = () => {
    if (!isEnabled) {
      log('info', '任务已停止。');
      stopScript();
      return true;
    }
    if (session.views >= cfg.maxTopics) {
      log('info', `已达到最大浏览数 (${cfg.maxTopics})。`);
      stopScript();
      return true;
    }
    if ((Date.now() - session.start) / 60000 >= cfg.maxRunMins) {
      log('info', `已达到最大运行时长 (${cfg.maxRunMins}分钟)。`);
      stopScript();
      return true;
    }
    return false;
  };

  /** ========== 主循环 ========== **/
  async function runMain() {
    const allTopics = await (async () => [...document.querySelectorAll('#list-area a.title')].filter(el => !el.closest('tr')?.querySelector('.pinned')).map(el => ({ title: el.textContent.trim(), url: el.href })))();

    const unreadTopics = allTopics.filter(t => !visitedTopics.includes(t.url));
    log('info', `获取到 ${allTopics.length} 个帖子，其中 ${unreadTopics.length} 个是未读的。`);

    const topicsToBrowse = shuffle(unreadTopics);

    for (const topic of topicsToBrowse) {
      if (shouldStop()) break;
      await browseTopic(topic);
    }

    if (shouldStop()) return; // 再次检查，防止在循环结束后继续执行

    // 任务完成后检查是否需要导航到新页面
    if (isEnabled) {
      log('info', '当前页面帖子已浏览完毕。');
      const nextUrlOptions = categoryUrls.filter(url => url !== window.location.href);
      if (nextUrlOptions.length > 0) {
          const nextUrl = nextUrlOptions[Math.floor(Math.random() * nextUrlOptions.length)];
          log('info', `准备导航到新页面: ${nextUrl}`);
          await wait(2000);
          window.location.href = nextUrl;
      } else {
          log('info', '所有可用分区都已尝试，没有其他页面可导航。任务结束。');
          stopScript();
      }
    }
  }

  /** ========== 启动入口 ========== **/
  window.addEventListener('load', () => {
    initPanel();

    if (getAutoNav()) {
        log('info', '检测到自动导航会话，1秒后将自动开始...');
        setTimeout(() => {
            const startButton = document.getElementById('ld-start');
            if (startButton && !isEnabled) {
                startButton.click();
            }
        }, 1000);
    }
  });

})();
