/**
 * The review console, as one string.
 *
 * It is a string rather than a static asset so that it cannot fall out of sync with the
 * server that serves it: there is no copy step, no `dist/` path to get wrong, and the test
 * that asserts the page mentions the rendered block reads the same string the browser gets.
 *
 * The layout is deliberate about what a reviewer is looking at. The condition sits above the
 * claim and is not editable, because in this pipeline the condition is the witness's output
 * and the claim is the thing a human is qualified to judge; a textarea over the trigger would
 * invite exactly the edit that breaks coverage. The rendered block is shown verbatim and last,
 * because it is the artefact every defect in this project's delivery path has hidden in.
 *
 * The client has no framework and no build step. It is a page that makes four requests and
 * owns a keyboard, and a console that needs a toolchain to review a sentence is a console
 * that does not get used.
 */
export type ConsoleOptions = {
  readonly batchId: string;
  readonly reviewer: string;
};

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function renderConsole(options: ConsoleOptions): string {
  const batch = escapeAttribute(options.batchId);
  const reviewer = escapeAttribute(options.reviewer);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>microglia — retrospection review</title>
<style>
:root {
  --bg: #0f1115; --panel: #171a21; --panel-2: #1e222b; --line: #2a2f3a;
  --text: #e6e9ef; --dim: #9aa3b2; --accent: #6aa9ff;
  --ok: #3fb950; --warn: #d29922; --bad: #f85149; --mute: #6e7681;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; height: 100vh;
  display: grid; grid-template-rows: auto 1fr auto; }
header { display: flex; align-items: center; gap: 16px; padding: 10px 16px;
  border-bottom: 1px solid var(--line); background: var(--panel); }
header h1 { font-size: 13px; font-weight: 600; letter-spacing: .04em; margin: 0;
  text-transform: uppercase; color: var(--dim); }
header .meta { font-family: var(--mono); font-size: 12px; color: var(--dim); }
header .meta b { color: var(--text); font-weight: 500; }
#progress { flex: 1; height: 4px; background: var(--panel-2); border-radius: 2px; overflow: hidden; }
#progress > i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s; }
main { display: grid; grid-template-columns: 280px 1fr; min-height: 0; }
nav { border-right: 1px solid var(--line); overflow-y: auto; background: var(--panel); }
nav button { display: block; width: 100%; text-align: left; padding: 9px 12px; border: 0;
  border-bottom: 1px solid var(--line); background: transparent; color: var(--text);
  cursor: pointer; font: inherit; }
nav button:hover { background: var(--panel-2); }
nav button[aria-current="true"] { background: var(--panel-2); box-shadow: inset 3px 0 0 var(--accent); }
nav .id { font-family: var(--mono); font-size: 11px; color: var(--dim); }
nav .snippet { font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; margin-top: 2px; }
section#card { overflow-y: auto; padding: 18px 22px 40px; }
footer { border-top: 1px solid var(--line); padding: 8px 16px; display: flex; gap: 18px;
  font-family: var(--mono); font-size: 12px; color: var(--dim); background: var(--panel); }
footer .keys { margin-left: auto; color: var(--mute); }
.verdict { border: 1px solid var(--line); border-left: 3px solid var(--dim); border-radius: 6px;
  padding: 9px 12px; margin-bottom: 16px; background: var(--panel); }
.verdict .state { font-family: var(--mono); font-size: 12px; letter-spacing: .05em;
  text-transform: uppercase; }
.verdict p { margin: 4px 0 0; color: var(--dim); font-size: 13px; }
.verdict.reviewable { border-left-color: var(--ok); } .verdict.reviewable .state { color: var(--ok); }
.verdict.restatement, .verdict.unwitnessed, .verdict.polarity, .verdict.over-general,
.verdict.unconditional { border-left-color: var(--bad); }
.verdict.restatement .state, .verdict.unwitnessed .state, .verdict.polarity .state,
.verdict.over-general .state, .verdict.unconditional .state { color: var(--bad); }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim);
  margin: 22px 0 8px; font-weight: 600; }
.when { font-family: var(--mono); font-size: 13px; color: var(--accent); background: var(--panel);
  border: 1px solid var(--line); border-radius: 6px; padding: 9px 11px; margin-bottom: 4px; }
.hint { font-size: 12px; color: var(--mute); margin: 4px 0 12px; }
textarea { width: 100%; min-height: 68px; resize: vertical; background: var(--panel-2);
  color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 10px;
  font: inherit; }
textarea:focus, input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.stats { display: flex; gap: 10px; flex-wrap: wrap; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: 7px 11px; min-width: 84px; }
.stat b { display: block; font-family: var(--mono); font-size: 16px; }
.stat span { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: .05em; }
.stat.bad b { color: var(--bad); } .stat.warn b { color: var(--warn); }
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th { text-align: left; font-weight: 600; color: var(--dim); font-size: 11px;
  text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid var(--line);
  padding: 6px 8px; }
td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
td.mono, .mono { font-family: var(--mono); font-size: 11.5px; color: var(--dim); }
.badge { font-family: var(--mono); font-size: 11px; padding: 1px 6px; border-radius: 999px;
  border: 1px solid var(--line); }
.badge.entailed { color: var(--ok); border-color: #1f4d2a; }
.badge.partial { color: var(--warn); border-color: #4d3d1f; }
.badge.unwitnessed, .badge.polarity { color: var(--bad); border-color: #4d2020; }
pre.block { background: #0b0d11; border: 1px solid var(--line); border-radius: 6px;
  padding: 12px; overflow-x: auto; font-family: var(--mono); font-size: 11.5px;
  color: #b9c2d0; white-space: pre-wrap; word-break: break-word; }
.actions { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
button.act { background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 8px 14px; cursor: pointer; font: inherit; }
button.act:hover { border-color: var(--accent); }
button.act.primary { background: #1f6feb; border-color: #1f6feb; }
button.act.danger { color: var(--bad); }
button.act kbd { font-family: var(--mono); font-size: 10px; opacity: .6; margin-left: 6px; }
.panel { margin-top: 12px; padding: 12px; border: 1px dashed var(--line); border-radius: 6px; }
.panel[hidden] { display: none; }
.notice { margin-top: 12px; padding: 9px 12px; border-radius: 6px; font-size: 13px; }
.notice.err { background: #2d1113; border: 1px solid #5c1f24; color: #ffb3b8; }
.notice.ok { background: #0f2417; border: 1px solid #1f4d2a; color: #b7f0c4; }
.done { color: var(--dim); font-style: italic; }
</style>
</head>
<body>
<header>
  <h1>Retrospection review</h1>
  <div class="meta">batch <b id="batch">${batch}</b> · reviewer <b id="reviewer">${reviewer}</b></div>
  <div id="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
</header>
<main>
  <nav id="queue" aria-label="Candidates"></nav>
  <section id="card"><p class="done">Loading…</p></section>
</main>
<footer>
  <span id="stats">—</span>
  <span class="keys">a accept · e edit · r reject · s split · o override · d defer · j/k move</span>
</footer>
<script>
(function () {
  'use strict';
  var state = { items: [], summary: null, index: 0, startedAt: Date.now(), notice: null };
  var card = document.getElementById('card');
  var queue = document.getElementById('queue');
  var stats = document.getElementById('stats');
  var progress = document.querySelector('#progress > i');

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fetchJson(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.error || ('HTTP ' + response.status));
        return body;
      });
    });
  }

  function load() {
    return fetchJson('/api/batch').then(function (body) {
      state.items = body.items;
      state.summary = body.summary;
      var firstOpen = state.items.findIndex(function (item) { return item.state === 'pending'; });
      state.index = firstOpen < 0 ? 0 : firstOpen;
      render();
    }).catch(function (error) {
      card.textContent = 'Could not load the batch: ' + error.message;
    });
  }

  function render() {
    queue.textContent = '';
    state.items.forEach(function (item, position) {
      var button = el('button', { type: 'button', 'aria-current': String(position === state.index) });
      button.appendChild(el('div', { class: 'id' }, item.candidateId + ' · ' + item.state));
      button.appendChild(el('div', { class: 'snippet' }, item.statement));
      button.addEventListener('click', function () { select(position); });
      queue.appendChild(button);
    });
    renderCard();
    renderStats();
    var decided = state.items.filter(function (item) { return item.state !== 'pending'; }).length;
    progress.style.width = (state.items.length === 0 ? 0 : Math.round(100 * decided / state.items.length)) + '%';
  }

  function renderStats() {
    var summary = state.summary;
    if (!summary) { stats.textContent = '—'; return; }
    stats.textContent = 'accepted ' + summary.accepted + ' · edited ' + summary.edited +
      ' · overrides ' + summary.overrides + ' · rejected ' + summary.rejected +
      ' · deferred ' + summary.deferred + ' · split ' + summary.split +
      ' · pending ' + summary.pending + ' · accept rate ' + (summary.acceptRate * 100).toFixed(1) +
      '% · median ' + summary.medianElapsedMs + 'ms';
  }

  function select(position) {
    state.index = position;
    state.startedAt = Date.now();
    state.notice = null;
    render();
  }

  function stat(value, label, tone) {
    var node = el('div', { class: 'stat' + (tone ? ' ' + tone : '') });
    node.appendChild(el('b', null, String(value)));
    node.appendChild(el('span', null, label));
    return node;
  }

  function renderCard() {
    var item = state.items[state.index];
    card.textContent = '';
    if (!item) {
      card.appendChild(el('p', { class: 'done' }, 'No candidates in this batch.'));
      return;
    }
    var verdict = el('div', { class: 'verdict ' + item.verdict.state });
    verdict.appendChild(el('div', { class: 'state' }, item.verdict.state));
    verdict.appendChild(el('p', null, item.verdict.sentence));
    card.appendChild(verdict);

    card.appendChild(el('h2', null, 'Condition (from the witness, not editable)'));
    card.appendChild(el('div', { class: 'when' }, item.when || '(none)'));
    card.appendChild(el('p', { class: 'hint' },
      'Two ways to change what a rule covers: split it, or reject it. Rewriting the condition would leave the coverage evidence describing a different rule.'));

    card.appendChild(el('h2', null, 'Claim'));
    var textarea = el('textarea', { id: 'statement', spellcheck: 'false' });
    textarea.value = item.statement;
    textarea.disabled = item.state !== 'pending' && item.state !== 'deferred';
    card.appendChild(textarea);

    var statsRow = el('div', { class: 'stats' });
    statsRow.appendChild(stat(item.support.covered, 'sources'));
    statsRow.appendChild(stat(item.support.distinctTasks, 'tasks'));
    statsRow.appendChild(stat(item.support.collateral, 'collateral', item.support.collateral > 0 ? 'warn' : ''));
    statsRow.appendChild(stat(item.support.collateralPasses, 'of them passes'));
    statsRow.appendChild(stat(item.support.unwitnessed, 'unwitnessed', item.support.unwitnessed > 0 ? 'bad' : ''));
    statsRow.appendChild(stat(item.support.polarityConflicts, 'polarity', item.support.polarityConflicts > 0 ? 'bad' : ''));
    card.appendChild(statsRow);

    card.appendChild(el('h2', null, 'Sources it claims'));
    var table = el('table');
    var head = el('tr');
    ['source', 'condition', 'task', 'outcome', 'witness', 'overlap', 'claim'].forEach(function (label) {
      head.appendChild(el('th', null, label));
    });
    table.appendChild(head);
    item.members.forEach(function (member) {
      var row = el('tr');
      row.appendChild(el('td', { class: 'mono' }, member.id));
      row.appendChild(el('td', { class: 'mono' }, member.when || '(none)'));
      row.appendChild(el('td', { class: 'mono' }, member.task));
      row.appendChild(el('td', null, member.outcome));
      var cell = el('td');
      cell.appendChild(el('span', { class: 'badge ' + member.verdict }, member.verdict));
      row.appendChild(cell);
      row.appendChild(el('td', { class: 'mono' }, member.overlap.toFixed(2)));
      row.appendChild(el('td', null, member.statement));
      table.appendChild(row);
    });
    card.appendChild(table);

    if (item.collateral.length > 0) {
      card.appendChild(el('h2', null, 'Also matches, and was not claimed'));
      var extra = el('table');
      var extraHead = el('tr');
      ['source', 'condition', 'outcome'].forEach(function (label) { extraHead.appendChild(el('th', null, label)); });
      extra.appendChild(extraHead);
      item.collateral.forEach(function (entry) {
        var row = el('tr');
        row.appendChild(el('td', { class: 'mono' }, entry.id));
        row.appendChild(el('td', { class: 'mono' }, entry.when || '(none)'));
        row.appendChild(el('td', null, entry.outcome));
        extra.appendChild(row);
      });
      card.appendChild(extra);
    }

    card.appendChild(el('h2', null, 'What the model would read'));
    card.appendChild(el('pre', { class: 'block' }, item.rendered || '(the block renders empty at this budget)'));

    if (item.decision) {
      card.appendChild(el('h2', null, 'Decision'));
      card.appendChild(el('p', { class: 'hint' },
        item.decision.action + ' by ' + item.decision.reviewer + ' in ' + item.decision.elapsedMs + 'ms' +
        (item.decision.reason ? ' — ' + item.decision.reason : '')));
    }
    if (item.children && item.children.length > 0) {
      card.appendChild(el('h2', null, 'Split into'));
      item.children.forEach(function (child) {
        card.appendChild(el('p', { class: 'hint' }, child.id + ' — ' + child.statement));
      });
    }

    var actions = el('div', { class: 'actions' });
    var open = item.state === 'pending' || item.state === 'deferred';
    [['accept', 'Accept', 'a', 'primary'], ['reject', 'Reject', 'r', 'danger'],
     ['split', 'Split', 's', ''], ['override', 'Override', 'o', 'danger'], ['defer', 'Defer', 'd', '']]
      .forEach(function (spec) {
        var button = el('button', { class: 'act ' + spec[3], type: 'button' }, spec[1]);
        if (!open) button.disabled = true;
        button.appendChild(el('kbd', null, spec[2]));
        button.addEventListener('click', function () { decide(spec[0], textarea.value); });
        actions.appendChild(button);
      });
    card.appendChild(actions);

    var panel = el('div', { class: 'panel', hidden: 'hidden' });
    panel.id = 'panel';
    card.appendChild(panel);
    var notice = el('div', { id: 'notice' });
    card.appendChild(notice);
    if (state.notice) showNotice(state.notice.text, state.notice.kind);

    if (open) {
      textarea.focus();
      state.startedAt = state.startedAt || Date.now();
    }
  }

  function showNotice(text, kind) {
    var notice = document.getElementById('notice');
    if (!notice) return;
    notice.textContent = text;
    notice.className = 'notice ' + (kind === 'ok' ? 'ok' : 'err');
  }

  function decide(action, text) {
    var item = state.items[state.index];
    if (!item) return;
    var elapsedMs = Math.max(0, Date.now() - state.startedAt);
    var body = {
      candidateId: item.candidateId,
      action: action,
      textBefore: item.statement,
      at: Date.now(),
      elapsedMs: elapsedMs
    };
    var current = document.getElementById('statement').value;
    if (action === 'accept') {
      if (current !== item.statement) { body.action = 'edit'; body.textAfter = current; }
    }
    if (action === 'reject' || action === 'override') {
      var reason = window.prompt('Reason (required, recorded in the ledger):');
      if (reason === null) return;
      body.reason = reason;
    }
    if (action === 'split') {
      var parts = window.prompt('Split into two or more claims, one per line:');
      if (parts === null) return;
      body.splitInto = parts.split('\\n').map(function (part) { return part.trim(); }).filter(Boolean);
    }
    post(body);
  }

  function post(body) {
    fetchJson('/api/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (reply) {
      state.items[state.index] = reply.item;
      state.summary = reply.summary;
      state.notice = { text: 'Recorded: ' + reply.item.state, kind: 'ok' };
      var next = state.items.findIndex(function (item) { return item.state === 'pending'; });
      if (next >= 0) state.index = next;
      state.startedAt = Date.now();
      render();
    }).catch(function (error) {
      state.notice = { text: error.message, kind: 'err' };
      showNotice(error.message, 'err');
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.target && event.target.tagName === 'TEXTAREA' && event.key !== 'Escape') {
      if (event.key === 'Escape') event.target.blur();
      return;
    }
    var textarea = document.getElementById('statement');
    var map = { a: 'accept', r: 'reject', s: 'split', o: 'override', d: 'defer', e: 'edit' };
    if (event.key === 'j' || event.key === 'ArrowDown') {
      select(Math.min(state.items.length - 1, state.index + 1)); event.preventDefault(); return;
    }
    if (event.key === 'k' || event.key === 'ArrowUp') {
      select(Math.max(0, state.index - 1)); event.preventDefault(); return;
    }
    if (event.key === 'e') { if (textarea) textarea.focus(); return; }
    if (map[event.key]) {
      event.preventDefault();
      decide(map[event.key], textarea ? textarea.value : '');
    }
  });

  load();
  window.addEventListener('beforeunload', function () {
    // A closed tab loses nothing: every decision was written when it was taken.
  });
})();
</script>
</body>
</html>`;
}
