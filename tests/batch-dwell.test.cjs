const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync(path.join(__dirname, '..', 'welearn-auto.user.js'), 'utf8');
const directory = 'https://welearn.sflep.com/student/course_info.aspx?cid=293&classid=1';
const lesson = 'https://welearn.sflep.com/student/StudyCourse.aspx?cid=293&classid=1&sco=ITEM-demo';
const storageKey = 'welearn-auto-v4-293';

function batchFixture(t, complete = false) {
  const dom = new JSDOM('<iframe name="contentFrame"></iframe>', { runScripts: 'outside-only', url: lesson });
  const { window } = dom;
  t.after(() => window.close());
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.setInterval = setInterval;
  window.clearInterval = clearInterval;
  Object.defineProperty(window.performance, 'now', { value: () => Date.now() });

  window.localStorage.setItem(storageKey, JSON.stringify({
    active: true, cid: '293', classid: '1', directory, queue: [{ id: 'ITEM-demo', name: 'Demo', complete }],
    index: 0, phase: 'work', log: [], started: 123,
  }));
  const visits = [];
  const location = new URL(lesson);
  location.assign = url => visits.push(url);
  location.reload = () => visits.push(lesson);
  window.Function('location', script)(location);

  const frame = window.document.querySelector('iframe');
  const sent = [];
  frame.contentWindow.postMessage = data => sent.push(data.type);
  const message = data => window.dispatchEvent(new window.MessageEvent('message', {
    source: frame.contentWindow,
    origin: 'https://centercourseware.sflep.com',
    data: { channel: 'welearn-auto-v4', ...data },
  }));
  return {
    visits,
    sent,
    progress: () => window.document.querySelector('#welearn-auto-dwell-progress'),
    countdown: () => window.document.querySelector('#welearn-auto-dwell-countdown')?.textContent,
    advance: ms => t.mock.timers.tick(ms),
    ready: (id = 'udemo') => message({ type: 'ready', ids: [id] }),
    result: ok => message({ type: 'result', id: 'ITEM-demo', ok, reason: '未识别题型' }),
    stop: () => window.document.querySelector('#welearn-auto-stop').click(),
    state: () => JSON.parse(window.localStorage.getItem(storageKey)),
  };
}

test('shows the elapsed dwell and remaining seconds from readiness through the return to the directory', t => {
  const batch = batchFixture(t, true);
  batch.advance(12_000);
  assert.equal(batch.progress(), null);
  batch.ready();
  assert.equal(batch.progress()?.value, 0);
  assert.match(batch.countdown(), /剩余 60 秒/);
  batch.advance(30_000);
  assert.equal(batch.progress().value / batch.progress().max, 0.5);
  assert.match(batch.countdown(), /剩余 30 秒/);
  batch.advance(30_000);
  assert.equal(batch.progress().value, batch.progress().max);
  assert.match(batch.countdown(), /剩余 0 秒/);
  assert.deepEqual(batch.visits, [directory]);
});

test('visits a completed lesson for 60 seconds without requesting another submission', t => {
  const batch = batchFixture(t, true);
  batch.ready();
  batch.advance(59_999);
  assert.deepEqual(batch.visits, []);
  assert.equal(batch.sent.includes('run'), false);
  batch.advance(1);
  assert.deepEqual(batch.visits, [directory]);
  assert.equal(batch.state().phase, 'verify');
});

for (const ok of [true, false]) {
  test(`keeps the lesson open for 60 seconds after readiness when processing ${ok ? 'succeeds' : 'fails'}`, t => {
    const batch = batchFixture(t);
    batch.advance(50_000);
    batch.ready();
    batch.advance(12_000);
    batch.ready();
    batch.result(ok);
    batch.advance(47_999);
    assert.deepEqual(batch.visits, []);
    assert.equal(batch.state().phase, 'work');
    assert.equal(batch.state().index, 0);
    batch.advance(1);
    assert.deepEqual(batch.visits, [directory]);
    assert.equal(batch.state().phase, ok ? 'verify' : 'work');
    assert.equal(batch.state().index, ok ? 0 : 1);
  });
}

test('stopping during the dwell cancels the scheduled return to the directory', t => {
  const batch = batchFixture(t);
  batch.ready();
  batch.advance(5_000);
  batch.result(true);
  const progressBeforeStop = batch.progress()?.value;
  batch.stop();
  batch.advance(60_000);
  assert.equal(batch.progress()?.value, progressBeforeStop);
  assert.deepEqual(batch.visits, []);
  assert.equal(batch.state().active, false);
  assert.equal(batch.state().phase, 'work');
});

test('waits for 60 seconds before reloading a mismatched lesson', t => {
  const batch = batchFixture(t);
  batch.ready('uanother');
  batch.advance(59_999);
  assert.deepEqual(batch.visits, []);
  batch.advance(1);
  assert.deepEqual(batch.visits, [lesson]);
});

test('skips a lesson that never becomes ready after the loading timeout', t => {
  const batch = batchFixture(t);
  batch.advance(59_999);
  assert.deepEqual(batch.visits, []);
  batch.advance(1);
  assert.deepEqual(batch.visits, [directory]);
  assert.equal(batch.state().index, 1);
  assert.equal(batch.state().log[0].ok, false);
});
