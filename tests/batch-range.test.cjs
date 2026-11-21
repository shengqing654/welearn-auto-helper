const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync(path.join(__dirname, '..', 'welearn-auto.user.js'), 'utf8');
const directory = 'https://welearn.sflep.com/student/course_info.aspx?cid=293&classid=1';
const storageKey = 'welearn-auto-v4-293';
const html = `
  <div id="collapse_ITEM-unit">
    <ul>
      <li onclick="StartSCO('ITEM-a')"><span>第一项</span></li>
      <li onclick="StartSCO('ITEM-b')"><span>第二项</span><i class="fa-check-circle-o"></i></li>
      <li onclick="StartSCO('ITEM-c')"><span>第三项</span></li>
      <li onclick="StartSCO('ITEM-d')"><span>第四项</span></li>
    </ul>
  </div>`;

function directoryFixture(t, savedBatch) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: directory });
  const { window } = dom;
  t.after(() => window.close());
  if (savedBatch) window.localStorage.setItem(storageKey, JSON.stringify(savedBatch));

  const visits = [];
  const location = new URL(directory);
  location.assign = url => visits.push(new URL(url).searchParams.get('sco'));
  window.Function('location', script)(location);

  const control = id => window.document.getElementById('welearn-auto-' + id);
  return {
    visits,
    control,
    state: () => JSON.parse(window.localStorage.getItem(storageKey)),
    select: (start, end) => {
      control('range-start').value = start;
      control('range-end').value = end;
    },
  };
}

test('starts the inclusive directory range with completed tasks included by default', t => {
  const batch = directoryFixture(t);
  assert.match(batch.control('range-start').options[1].textContent, /已完成/);
  assert.equal(batch.control('range-completed').checked, true);
  batch.select('ITEM-b', 'ITEM-c');
  batch.control('start').click();
  assert.deepEqual(batch.state().queue.map(item => [item.id, item.complete]), [
    ['ITEM-b', true],
    ['ITEM-c', false],
  ]);
  assert.deepEqual(batch.visits, ['ITEM-b']);
});

test('can select just one already completed task', t => {
  const batch = directoryFixture(t);
  batch.select('ITEM-b', 'ITEM-b');
  batch.control('start').click();
  assert.deepEqual(batch.state().queue.map(item => item.id), ['ITEM-b']);
  assert.deepEqual(batch.visits, ['ITEM-b']);
});

test('can exclude completed tasks within the selected range', t => {
  const batch = directoryFixture(t);
  batch.select('ITEM-b', 'ITEM-c');
  batch.control('range-completed').checked = false;
  batch.control('start').click();
  assert.deepEqual(batch.state().queue.map(item => item.id), ['ITEM-c']);
  assert.deepEqual(batch.visits, ['ITEM-c']);
});

test('keeps the directory open when the selected range is reversed', t => {
  const batch = directoryFixture(t);
  batch.select('ITEM-c', 'ITEM-b');
  batch.control('start').click();
  assert.equal(batch.state(), null);
  assert.deepEqual(batch.visits, []);
});

test('defaults to 60 seconds and saves the selected 30-second increment with the batch', t => {
  const batch = directoryFixture(t);
  const dwell = batch.control('dwell-seconds');
  assert.equal(dwell.valueAsNumber, 60);
  dwell.stepUp();
  assert.equal(dwell.valueAsNumber, 90);
  batch.control('start').click();
  assert.equal(batch.state().dwellSeconds, 90);
});

test('does not start a batch for a time that is not a multiple of 30 seconds', t => {
  const batch = directoryFixture(t);
  batch.control('dwell-seconds').value = '45';
  batch.control('start').click();
  assert.equal(batch.state(), null);
  assert.deepEqual(batch.visits, []);
});

test('resumes the saved range at its current task independently of the selectors', t => {
  const queue = [{ id: 'ITEM-b', complete: true }, { id: 'ITEM-c', complete: false }];
  const batch = directoryFixture(t, {
    active: false, cid: '293', classid: '1', directory, queue, index: 1, phase: 'work', log: [], dwellSeconds: 90,
  });
  batch.select('ITEM-d', 'ITEM-d');
  assert.equal(batch.control('dwell-seconds')?.valueAsNumber, 90);
  batch.control('dwell-seconds').value = '30';
  assert.equal(batch.control('resume').hidden, false);
  batch.control('resume').click();
  assert.deepEqual(batch.state().queue, queue);
  assert.equal(batch.state().dwellSeconds, 90);
  assert.deepEqual(batch.visits, ['ITEM-c']);
});

test('verifies the final selected task and leaves other directory tasks untouched', t => {
  const batch = directoryFixture(t, {
    active: true, cid: '293', classid: '1', directory,
    queue: [{ id: 'ITEM-b', complete: true }], index: 0, phase: 'verify', log: [],
  });
  assert.equal(batch.state().active, false);
  assert.deepEqual(batch.state().log.map(item => [item.id, item.ok]), [['ITEM-b', true]]);
  assert.deepEqual(batch.visits, []);
  assert.equal(batch.control('start').matches(':disabled'), false);
});
