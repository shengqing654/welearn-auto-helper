// ==UserScript==
// @name         WE Learn 自动填写提交 v4
// @namespace    local.welearn.auto
// @version      4.3.1
// @description  填空、选择、判断题；自动提交并回目录核验；支持按目录范围批量处理
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
  const title = document.createElement('strong'); title.textContent = '自动填写提交 v4.3.1';
  const status = document.createElement('div'); status.id = 'welearn-auto-status';
  panel.append(title, status); document.body.append(panel);
  const show = text => { status.textContent = text; };
  function button(id, label, handler, group = panel) {
    const b = document.createElement('button'); b.id = id; b.textContent = label;
    b.style.cssText = 'margin:6px 6px 0 0;padding:7px;background:#2463a6;color:white;border:0;border-radius:4px;cursor:pointer';
    b.onclick = handler; group.append(b); return b;
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
  const LESSON_DWELL_MS = 60_000;
  const LESSON_TIMEOUT_MS = 60_000;
  let batchTimer, lessonReadyAt;
  let dwellProgressTimer, refreshDwellProgress;
  let lessonClosing = false, sawWrongRoute = false;
  function rows() {
    return [...document.querySelectorAll('div[id^="collapse_ITEM-"] li[onclick*="StartSCO"]')].map(el => {
      const id = el.getAttribute('onclick').match(/StartSCO\('([^']+)'\)/)?.[1];
      return {id, name: el.querySelector('span')?.textContent.trim() || id, complete: !!el.querySelector('i.fa-check-circle-o')};
    }).filter(x => x.id);
  }
  function goDirectory(state) { location.assign(state.directory); }
  function goTask(state) {
    const item = state.queue[state.index];
    if (!item) {
      state.active = false; save(state); syncRangeControls(state);
      show(`批量结束：目录确认 ${state.log.filter(x => x.ok).length} 项；待处理 ${state.log.filter(x => !x.ok).length} 项。可导出记录。`);
      return;
    }
    const target = new URL('/student/StudyCourse.aspx', courseOrigin);
    target.searchParams.set('cid', state.cid); target.searchParams.set('classid', state.classid); target.searchParams.set('sco', item.id);
    state.phase = 'work'; state.started = Date.now(); save(state); location.assign(target.href);
  }
  function activeLesson(expected) {
    const current = read();
    if (current?.active && current.phase === 'work' && current.index === expected.index &&
        current.started === expected.started && current.queue[current.index]?.id === params.get('sco')) return current;
    return null;
  }
  function startDwellProgress() {
    const countdown = document.createElement('div');
    countdown.id = 'welearn-auto-dwell-countdown';
    countdown.style.cssText = 'margin-top:6px;font-variant-numeric:tabular-nums';
    const progress = document.createElement('progress');
    progress.id = 'welearn-auto-dwell-progress';
    progress.max = LESSON_DWELL_MS;
    progress.setAttribute('aria-label', '本页停留进度');
    progress.style.cssText = 'display:block;width:100%;height:8px;margin:4px 0 6px;accent-color:#2463a6';
    status.after(countdown, progress);

    refreshDwellProgress = () => {
      const elapsed = Math.min(LESSON_DWELL_MS, performance.now() - lessonReadyAt);
      const seconds = Math.ceil((LESSON_DWELL_MS - elapsed) / 1000);
      progress.value = elapsed;
      countdown.textContent = `本页停留 · 剩余 ${seconds} 秒`;
      if (seconds === 0) clearInterval(dwellProgressTimer);
    };
    dwellProgressTimer = setInterval(refreshDwellProgress, 1000);
    refreshDwellProgress();
  }
  function finishLesson(state, {ok, reason}) {
    refreshDwellProgress?.();
    clearInterval(dwellProgressTimer);
    state.routeErrors = 0;
    if (ok) { state.phase = 'verify'; state.verify = 0; }
    else { state.log.push({...state.queue[state.index], ok: false, reason}); state.index++; }
    save(state); goDirectory(state);
  }
  function finishAfterDwell(state, result) {
    lessonClosing = true;
    clearTimeout(batchTimer);
    const remaining = Math.ceil(LESSON_DWELL_MS - (performance.now() - lessonReadyAt));
    if (remaining > 0) {
      const completed = state.queue[state.index].complete;
      show(`${completed ? '该任务已完成' : '本页处理已结束'}，停留满 60 秒后返回目录核验。`);
    }
    batchTimer = setTimeout(() => {
      const current = activeLesson(state);
      if (current) finishLesson(current, result);
    }, Math.max(0, remaining));
  }
  function watchLesson(state) {
    clearTimeout(batchTimer);
    batchTimer = setTimeout(() => {
      const current = activeLesson(state);
      if (!current) return;
      lessonClosing = true;
      if (sawWrongRoute && lessonReadyAt === undefined) {
        if (!current.routeErrors) {
          current.routeErrors = 1; save(current); location.reload(); return;
        }
        finishLesson(current, {ok: false, reason: '章节内容与目录目标不一致'});
      } else {
        finishLesson(current, {ok: false, reason: '练习未就绪或处理超时'});
      }
    }, LESSON_TIMEOUT_MS);
  }
  function rangeSelect(fields, id, text) {
    const label = document.createElement('label');
    label.textContent = text;
    label.style.cssText = 'display:block;margin:4px 0';
    const select = document.createElement('select');
    select.id = id;
    select.style.cssText = 'display:block;width:100%;margin-top:2px;font:inherit';
    label.append(select); fields.append(label);
    return select;
  }
  function createRangeControls() {
    const fields = document.createElement('fieldset');
    fields.style.cssText = 'margin:8px 0 0;padding:6px 8px 8px;min-width:0;border:1px solid #bfd0ec;border-radius:6px';
    fields.disabled = true;
    const legend = document.createElement('legend');
    legend.textContent = '批量范围';
    fields.append(legend); panel.append(fields);
    const start = rangeSelect(fields, 'welearn-auto-range-start', '起始任务');
    const end = rangeSelect(fields, 'welearn-auto-range-end', '结束任务');
    const label = document.createElement('label');
    label.style.display = 'block';
    const includeCompleted = document.createElement('input');
    includeCompleted.id = 'welearn-auto-range-completed';
    includeCompleted.type = 'checkbox';
    includeCompleted.checked = true;
    label.append(includeCompleted, ' 包含已完成任务');
    fields.append(label);
    button('welearn-auto-start', '开始所选范围', () => startRange(start.value, end.value, includeCompleted.checked), fields);
    const resume = button('welearn-auto-resume', '继续上次批量', resumeBatch);
    resume.hidden = true;
    return {fields, start, end, resume};
  }
  const range = /course_info\.aspx/i.test(location.pathname) ? createRangeControls() : null;
  function populateRange(list) {
    list.forEach(({id, name, complete}, index) => {
      const label = `${index + 1}. ${name}${complete ? '（已完成）' : ''}`;
      range.start.add(new Option(label, id));
      range.end.add(new Option(label, id));
    });
    range.end.selectedIndex = list.length - 1;
  }
  const canResume = state => !state?.active && !state?.finished && !!state?.queue?.[state.index];
  function syncRangeControls(state) {
    if (!range) return;
    const hasTasks = range.start.options.length > 0;
    range.fields.disabled = !hasTasks || !!state?.active;
    range.resume.hidden = !hasTasks || !canResume(state);
  }
  function startRange(startId, endId, includeCompleted) {
    if (read()?.active) return;
    const list = rows();
    const start = list.findIndex(item => item.id === startId);
    const end = list.findIndex(item => item.id === endId);
    if (start < 0 || end < 0) { show('任务列表已变化，请刷新目录后重新选择。'); return; }
    if (start > end) { show('结束任务应位于起始任务之后，或与起始任务相同。'); return; }
    const queue = list.slice(start, end + 1).filter(item => includeCompleted || !item.complete);
    if (!queue.length) { show('所选范围内没有未完成任务。'); return; }
    const classid = params.get('classid') || document.querySelector('a[href*="quitClass"]')?.getAttribute('href')?.match(/quitClass\('([0-9]+)'/)?.[1];
    if (!classid) { show('没有找到班级编号，已停止。'); return; }
    const state = {active: true, cid: params.get('cid'), classid, directory: location.href, queue, index: 0, phase: 'work', log: [], verify: 0};
    syncRangeControls(state);
    goTask(state);
  }
  function resumeBatch() {
    const state = read();
    if (!canResume(state)) return;
    state.active = true;
    syncRangeControls(state);
    if (state.phase === 'verify') { save(state); location.reload(); }
    else goTask(state);
  }
  button('welearn-auto-stop', '停止批量', () => {
    const state = read(); if (state) { state.active = false; save(state); }
    syncRangeControls(state);
    clearTimeout(batchTimer);
    clearInterval(dwellProgressTimer);
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
    if (!state?.active || state.phase !== 'work' || lessonClosing) return;
    const item = state.queue[state.index]; if (!item || params.get('sco') !== item.id) return;
    if (event.data.type === 'ready') {
      const uuid = item.id.replace(/^ITEM-/, '');
      if (!Array.isArray(event.data.ids) || !event.data.ids.includes('u' + uuid)) {
        sawWrongRoute = true;
        return;
      }
      if (lessonReadyAt === undefined) {
        lessonReadyAt = performance.now();
        startDwellProgress();
        if (item.complete) {
          finishAfterDwell(state, {ok: true});
          return;
        }
        watchLesson(state);
      }
      frame.contentWindow.postMessage({channel: CHANNEL, type: 'run', id: item.id}, childOrigin);
    } else if (event.data.type === 'result' && event.data.id === item.id && lessonReadyAt !== undefined) {
      finishAfterDwell(state, event.data);
    }
  });
  async function boot() {
    let list;
    if (range) {
      show('正在读取课程目录…');
      list = rows();
      for (let n = 0; n < 100 && !list.length; n++) {
        await sleep(100);
        list = rows();
      }
      populateRange(list);
    }
    const state = read();
    syncRangeControls(state);
    if (range && !list.length) {
      if (state?.active) { state.active = false; save(state); }
      show('目录未加载，已暂停。');
      return;
    }
    if (!state?.active) {
      show(range ? '请选择起始任务和结束任务。' : '请在课程目录选择批量范围。');
      if (/StudyCourse\.aspx/i.test(location.pathname)) panel.hidden = true;
      return;
    }
    show(`批量处理中 ${Math.min(state.index + 1, state.queue.length)}/${state.queue.length}：${state.queue[state.index]?.name || ''}`);
    if (range) {
      if (state.phase === 'verify') {
        const item = state.queue[state.index], row = list.find(x => x.id === item.id);
        if (!row?.complete && state.verify < 1) {
          state.verify++;
          save(state);
          batchTimer = setTimeout(() => {
            const current = read();
            if (current?.active && current.phase === 'verify' && current.started === state.started && current.index === state.index) location.reload();
          }, 1800);
          return;
        }
        state.log.push({...item, ok: !!row?.complete, reason: row?.complete ? '课程目录已确认完成' : '提交后目录仍未确认完成'});
        state.index++; state.phase = 'work'; save(state);
      }
      if (read()?.active) goTask(state);
    } else if (/StudyCourse\.aspx/i.test(location.pathname) && activeLesson(state)) {
      watchLesson(state);
    }
  }
  boot();
})();
