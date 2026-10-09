import {actions} from './view-model.js';

export function batchEligible(job, action) {
  if (job.hiddenInQueue) return false;
  if (action === 'phone') return job.status === 'done' && Boolean(job.file);
  // Live recordings have a separate stop-and-save action.
  if (job.live && job.status === 'running') return false;
  return actions(job.status).includes(action);
}

export async function runBatch(ids, action, getJobs, execute) {
  const result = {completed:[], skipped:[], failed:[]};
  for (const id of new Set(ids)) {
    const job = getJobs().find(item => item.id === id);
    if (!job || !batchEligible(job, action)) { result.skipped.push(id); continue; }
    try { await execute(job, action); result.completed.push(id); }
    catch (error) { result.failed.push({id, error}); }
  }
  return result;
}

export function wireQueueSelection({root, rows, t, getJobs, execute, refresh, report, afterPhone}) {
  const selected = new Set();
  let enabled = false, busy = false, visible = [];
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'outline small queue-select-toggle';
  toggle.id = 'queue-select';
  root.querySelector('.queue-filters').append(toggle);
  const bar = document.createElement('div');
  bar.className = 'queue-selection'; bar.hidden = true;
  bar.setAttribute('role', 'group');
  const allLabel = document.createElement('label');
  const all = document.createElement('input'); all.type = 'checkbox'; all.id = 'queue-select-all';
  const count = document.createElement('span');
  allLabel.append(all, count); bar.append(allLabel);
  const buttons = new Map();
  const labels = {pause:'Pause', resume:'Resume', retry:'Retry', cancel:'Cancel', phone:'To phone'};
  for (const [action, label] of Object.entries(labels)) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'outline small'; button.dataset.batch = action;
    button.addEventListener('click', () => run(action));
    buttons.set(action, {button, label}); bar.append(button);
  }
  const status = document.createElement('p');
  status.className = 'queue-selection-result'; status.hidden = true;
  status.setAttribute('role', 'status');
  root.querySelector('.queue-filters').after(bar, status);
  toggle.addEventListener('click', () => {
    enabled = !enabled; selected.clear(); status.hidden = true; sync();
  });
  all.addEventListener('change', () => {
    for (const job of visible) all.checked ? selected.add(job.id) : selected.delete(job.id);
    sync();
  });
  function sync() {
    toggle.textContent = t(enabled ? 'Finish selecting' : 'Select tasks');
    toggle.setAttribute('aria-pressed', String(enabled)); toggle.disabled = busy;
    bar.hidden = !enabled; bar.setAttribute('aria-label', t('Selected tasks'));
    bar.setAttribute('aria-busy', String(busy));
    all.checked = visible.length > 0 && selected.size === visible.length;
    all.indeterminate = selected.size > 0 && selected.size < visible.length;
    all.disabled = busy || !visible.length; all.setAttribute('aria-label', t('Select visible tasks'));
    count.textContent = t('{count} selected', {count:selected.size});
    for (const [action, {button, label}] of buttons) {
      const eligible = visible.filter(job => selected.has(job.id) && batchEligible(job, action)).length;
      button.textContent = `${t(label)} (${eligible})`; button.disabled = busy || !eligible;
    }
    for (const row of rows.children) {
      const id = Number(row.dataset.id);
      let box = row.querySelector('.job-select');
      if (!box) {
        box = document.createElement('input'); box.type = 'checkbox'; box.className = 'job-select';
        box.addEventListener('change', () => { box.checked ? selected.add(id) : selected.delete(id); sync(); });
        row.prepend(box);
      }
      box.hidden = !enabled; box.checked = selected.has(id); box.disabled = busy;
      const name = row.querySelector('.job-title')?.textContent || id;
      box.setAttribute('aria-label', t('Select task: {name}', {name}));
      row.classList.toggle('is-selected', selected.has(id)); row.classList.toggle('is-selectable', enabled);
    }
  }
  async function run(action) {
    if (busy) return;
    busy = true; status.hidden = true; sync();
    try {
      const ids = visible.filter(job => selected.has(job.id) && batchEligible(job, action)).map(job => job.id);
      const result = await runBatch(ids, action, getJobs, execute);
      for (const id of result.completed) selected.delete(id);
      await refresh();
      status.textContent = t('Completed: {done}. Skipped: {skipped}. Failed: {failed}.', {
        done:result.completed.length, skipped:result.skipped.length, failed:result.failed.length,
      });
      status.hidden = false;
      if (result.failed.length) report(result.failed[0].error);
      if (action === 'phone' && result.completed.length) await afterPhone();
    } catch (error) { report(error); }
    finally { busy = false; sync(); }
  }
  return {update(jobs) {
    visible = jobs;
    const ids = new Set(jobs.map(job => job.id));
    for (const id of selected) if (!ids.has(id)) selected.delete(id);
    sync();
  }};
}
