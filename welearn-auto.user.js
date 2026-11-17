// ==UserScript==
// @name         WE Learn 自动填写提交 v4
// @namespace    local.welearn.auto
// @version      4.2.0
// @description  填空、选择、判断题；自动提交并回目录核验；批量处理未完成项
// @match        https://welearn.sflep.com/*
// @match        https://centercourseware.sflep.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==
(() => {
  'use strict';
  if (!document.body || document.getElementById('welearn-auto-v4')) return;
  const isCourse = location.hostname === 'welearn.sflep.com';
  const CHANNEL = 'welearn-auto-v4';
  const courseOrigin = 'https://welearn.sflep.com';
  const childOrigin = 'https://centercourseware.sflep.com';
  const params = new URL(location.href).searchParams;
  const storageKey = CHANNEL + '-' + (params.get('cid') || '294');
  let busy = false, cancelled = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const panel = document.createElement('section');
  panel.id = CHANNEL;
  panel.style.cssText = 'position:fixed;left:12px;bottom:16px;z-index:2147483647;width:300px;padding:12px;background:white;color:#183153;border:2px solid #2463a6;border-radius:8px;font:14px/1.6 sans-serif;box-shadow:0 3px 15px #0003';
  const title = document.createElement('strong'); title.textContent = '自动填写提交 v4.2 加速版';
  const status = document.createElement('div'); status.id = 'welearn-auto-status';
  panel.append(title, status); document.body.append(panel);
  const show = text => { status.textContent = text; };
  function button(id, label, handler) {
    const b = document.createElement('button'); b.id = id; b.textContent = label;
    b.style.cssText = 'margin:6px 6px 0 0;padding:7px;background:#2463a6;color:white;border:0;border-radius:4px;cursor:pointer';
    b.onclick = handler; panel.append(b); return b;
  }
  function controller(el, name) {
    const angular = el.ownerDocument.defaultView.angular;
    if (!angular?.element) return null;
    return angular.element(el).controller(name) || null;
  }
  function fillOne(el) {
    const type = el.tagName.toLowerCase();
    if (type === 'et-blank') {
      const ctrl = controller(el, 'etBlank');
      if (!ctrl?.hasKey || !Array.isArray(ctrl.key) || typeof ctrl.key[0] !== 'string' || !ctrl.key[0].trim()) return false;
      const root = window.angular.element(el).injector()?.get('$rootScope');
      if (!root) return false;
      const write = () => { ctrl.value = ctrl.key[0]; };
      if (root.$$phase) write(); else root.$apply(write);
      return ctrl.isCorrect === true;
    }
    if (type === 'et-choice') {
      const ctrl = controller(el, 'etChoice');
      let options = [...el.querySelectorAll('li')];
      if (!options.length) options = [...el.querySelectorAll('.wrapper > span')];
      const keys = ctrl?.key;
      if (!ctrl?.hasKey || !Array.isArray(keys) || !keys.length || !keys.every(i => Number.isInteger(i) && i >= 0 && i < options.length)) return false;
      const selected = i => ctrl.value?.includes(i);
      if (ctrl.multiple) {
        options.forEach((o, i) => { if (selected(i) && !keys.includes(i)) o.click(); });
        keys.forEach(i => { if (!selected(i)) options[i].click(); });
      } else {
        if (keys.length !== 1) return false;
        if (!selected(keys[0])) options[keys[0]].click();
      }
      return ctrl.isCorrect === true;
    }
    const ctrl = controller(el, 'etTof');
    const key = ctrl?.key?.[0], options = el.querySelectorAll('.controls > span');
    if (!ctrl?.hasKey || !['t', 'f'].includes(key) || options.length !== 2) return false;
    if (ctrl.value?.[0] !== key) options[key === 't' ? 0 : 1].click();
    return ctrl.isCorrect === true;
  }
  function fillPage() {
    const elements = [...document.querySelectorAll('et-blank, et-choice, et-tof')];
    let correct = 0;
    for (const el of elements) {
      try { if (fillOne(el)) correct++; }
      catch (error) { console.warn('[WE Learn v4]', el.id, error.message); }
    }
    const unsupported = document.querySelectorAll('et-recorder,et-follow-me,et-talk,et-matching,et-sort,et-multi-blank,et-select,et-mark,et-tick-list').length;
    const result = {total: elements.length, correct, unsupported};
    show(`已填写并核对 ${correct}/${elements.length} 题；未识别 ${elements.length - correct} 题；其他题型 ${unsupported} 项。`);
    return result;
  }
  function isVisible(element) {
    if (!element?.isConnected) return false;
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || node.classList.contains('ng-hide')) return false;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  }
  const isPendingSubmit = b => b.textContent.trim().toLowerCase() === 'submit' && isVisible(b);
  const submitButtons = () => [...document.querySelectorAll('button')].filter(isPendingSubmit);
  function waitUntil(predicate, timeout = 12000) {
    return new Promise(resolve => {
      let observer, deadline, poll;
      const finish = result => { observer?.disconnect(); clearTimeout(deadline); clearInterval(poll); resolve(result); };
      const check = () => {
        if (cancelled) { finish(false); return; }
        if (predicate()) finish(true);
      };
      observer = new MutationObserver(check);
      observer.observe(document.body, {subtree: true, childList: true, attributes: true, characterData: true});
      deadline = setTimeout(() => finish(false), timeout);
      poll = setInterval(check, 250);
      check();
    });
  }
  async function submitPage() {
    if (busy) return {ok: false, reason: '正在处理'};
    busy = true; cancelled = false;
    const originalConfirm = window.confirm;
    try {
      const result = fillPage();
      if (!result.total || result.correct !== result.total || result.unsupported) return {ok: false, reason: status.textContent};
      const buttons = submitButtons();
      if (!buttons.length) {
        if ([...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Reset' && isVisible(b))) {
          show('页面已提交，等待目录核验。');
          return {ok: true, reason: '页面已提交，等待目录核验'};
        }
        return {ok: false, reason: '未找到提交按钮'};
      }
      window.confirm = message => /客观题的作答只能提交一次.*是否继续提交/.test(String(message)) ? true : originalConfirm.call(window, message);
      for (const b of buttons) {
        if (cancelled) return {ok: false, reason: '用户停止'};
        if (!isPendingSubmit(b)) continue;
        if (!b.disabled) b.click();
        if (!await waitUntil(() => !isPendingSubmit(b))) {
          show(cancelled ? '已停止本页自动处理。' : '提交未得到确认，已停止本页。');
          return {ok: false, reason: cancelled ? '用户停止' : '提交未得到确认'};
        }
      }
      if (!submitButtons().length) { show('页面已提交，等待目录核验。'); return {ok: true, reason: '页面已提交，等待目录核验'}; }
      show('提交未得到确认，已停止本页。');
      return {ok: false, reason: '提交未得到确认'};
    } catch (error) { show(error.message); return {ok: false, reason: error.message}; }
    finally { window.confirm = originalConfirm; busy = false; }
  }
  if (!isCourse) {
    button('welearn-auto-submit', '填写并提交本页', () => submitPage());
    button('welearn-auto-fill', '仅填写', fillPage);
    button('welearn-auto-stop', '停止', () => { cancelled = true; show('已停止本页自动处理。'); });
    show('支持填空、选择、判断；批量模式请从课程目录开始。');
    let expected = '', lastRoute = '', seenHost = false;
    if (window.parent !== window) {
      panel.hidden = true;
      setTimeout(() => { if (!seenHost) panel.hidden = false; }, 1200);
    }
    function ready() {
      if (window.parent === window) return;
      const route = location.hash;
      if (route !== lastRoute) { expected = ''; lastRoute = route; }
      const ids = [...document.querySelectorAll('et-item[id]')].map(e => e.id);
      if (ids.length) window.parent.postMessage({channel: CHANNEL, type: 'ready', ids, route}, courseOrigin);
    }
    window.addEventListener('message', async event => {
      if (event.origin !== courseOrigin || event.source !== window.parent || event.data?.channel !== CHANNEL) return;
      if (event.data.type === 'batch-state') { seenHost = true; panel.hidden = !!event.data.active; return; }
      if (event.data.type === 'stop') { cancelled = true; panel.hidden = false; return; }
      if (event.data.type !== 'run' || expected === event.data.id || busy) return;
      panel.hidden = true;
      expected = event.data.id;
      const result = await submitPage();
      window.parent.postMessage({channel: CHANNEL, type: 'result', id: expected, ...result}, courseOrigin);
    });
    setInterval(ready, 200); ready();
    return;
  }
  const read = () => { try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; } };
  const save = state => localStorage.setItem(storageKey, JSON.stringify(state));
  function rows() {
    return [...document.querySelectorAll('div[id^="collapse_ITEM-"] li[onclick*="StartSCO"]')].map(el => {
      const id = el.getAttribute('onclick').match(/StartSCO\('([^']+)'\)/)?.[1];
      return {id, name: el.querySelector('span')?.textContent.trim() || id, complete: !!el.querySelector('i.fa-check-circle-o')};
    }).filter(x => x.id);
  }
  function goDirectory(state) { location.assign(state.directory); }
  function goTask(state) {
    const item = state.queue[state.index];
    if (!item) { state.active = false; save(state); show(`批量结束：目录确认 ${state.log.filter(x => x.ok).length} 项；待处理 ${state.log.filter(x => !x.ok).length} 项。可导出记录。`); return; }
    const target = new URL('/student/StudyCourse.aspx', courseOrigin);
    target.searchParams.set('cid', state.cid); target.searchParams.set('classid', state.classid); target.searchParams.set('sco', item.id);
    state.phase = 'work'; state.started = Date.now(); save(state); location.assign(target.href);
  }
  button('welearn-auto-start', '从目录批量开始 / 继续', () => {
    const list = rows();
    if (!list.length) { show('请先回到课程目录页，再点批量开始。'); return; }
    const existing = read();
    if (existing && existing.index < existing.queue.length && !existing.finished) { existing.active = true; save(existing); goTask(existing); return; }
    const classid = params.get('classid') || document.querySelector('a[href*="quitClass"]')?.getAttribute('href')?.match(/quitClass\('([0-9]+)'/)?.[1];
    if (!classid) { show('没有找到班级编号，已停止。'); return; }
    const state = {active: true, cid: params.get('cid'), classid, directory: location.href, queue: list.filter(x => !x.complete), index: 0, phase: 'work', log: [], verify: 0};
    save(state); goTask(state);
  });
  button('welearn-auto-stop', '停止批量', () => {
    const state = read(); if (state) { state.active = false; save(state); }
    document.querySelector('iframe[name="contentFrame"]')?.contentWindow?.postMessage({channel: CHANNEL, type: 'stop'}, childOrigin);
    show('已停止批量处理。');
    if (/StudyCourse\.aspx/i.test(location.pathname)) panel.hidden = true;
  });
  button('welearn-auto-export', '导出结果', () => {
    const data = read(); if (!data) { show('暂无记录。'); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'welearn-results.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener('message', event => {
    const frame = document.querySelector('iframe[name="contentFrame"]');
    if (event.origin !== childOrigin || event.source !== frame?.contentWindow || event.data?.channel !== CHANNEL) return;
    const state = read();
    if (event.data.type === 'ready') frame.contentWindow.postMessage({channel: CHANNEL, type: 'batch-state', active: !!state?.active}, childOrigin);
    if (!state?.active || state.phase !== 'work') return;
    const item = state.queue[state.index]; if (!item || params.get('sco') !== item.id) return;
    if (event.data.type === 'ready') {
      const uuid = item.id.replace(/^ITEM-/, '');
      if (!event.data.ids.some(id => id === 'u' + uuid)) {
        state.routeErrors = (state.routeErrors || 0) + 1; save(state);
        if (state.routeErrors === 1) location.reload();
        else { state.log.push({...item, ok: false, reason: '章节内容与目录目标不一致'}); state.index++; state.routeErrors = 0; save(state); goDirectory(state); }
        return;
      }
      frame.contentWindow.postMessage({channel: CHANNEL, type: 'run', id: item.id}, childOrigin);
    } else if (event.data.type === 'result' && event.data.id === item.id) {
      state.routeErrors = 0;
      if (event.data.ok) { state.phase = 'verify'; state.verify = 0; }
      else { state.log.push({...item, ok: false, reason: event.data.reason}); state.index++; }
      save(state); goDirectory(state);
    }
  });
  async function boot() {
    const state = read();
    if (!state?.active) {
      show('请在课程目录点击批量开始。');
      if (/StudyCourse\.aspx/i.test(location.pathname)) panel.hidden = true;
      return;
    }
    show(`批量处理中 ${Math.min(state.index + 1, state.queue.length)}/${state.queue.length}：${state.queue[state.index]?.name || ''}`);
    if (/course_info\.aspx/i.test(location.pathname)) {
      for (let n = 0; n < 100 && !rows().length; n++) await sleep(100);
      if (!rows().length) { state.active = false; save(state); show('目录未加载，已暂停。'); return; }
      if (state.phase === 'verify') {
        const item = state.queue[state.index], row = rows().find(x => x.id === item.id);
        if (!row?.complete && state.verify < 1) { state.verify++; save(state); await sleep(1800); if (read()?.active) location.reload(); return; }
        state.log.push({...item, ok: !!row?.complete, reason: row?.complete ? '课程目录已确认完成' : '提交后目录仍未确认完成'});
        state.index++; state.phase = 'work'; save(state);
      }
      if (read()?.active) goTask(state);
    } else if (/StudyCourse\.aspx/i.test(location.pathname)) {
      setTimeout(() => {
        const current = read();
        if (current?.active && current.index === state.index && current.phase === 'work') {
          current.log.push({...current.queue[current.index], ok: false, reason: '练习未就绪或处理超时'}); current.index++; save(current); goDirectory(current);
        }
      }, 60000);
    }
  }
  boot();
})();
