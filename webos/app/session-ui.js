(function (root) {
  'use strict';
  function time(value) {
    value = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    return (value >= 3600 ? Math.floor(value / 3600) + ':' + String(Math.floor(value / 60) % 60).padStart(2, '0') : Math.floor(value / 60)) + ':' + String(value % 60).padStart(2, '0');
  }
  function chapterAt(chapters, position) {
    var index = -1;
    for (var i = 0; i < chapters.length; i++) { if (chapters[i].position <= position) index = i; else break; }
    return index;
  }
  function text(node, value) { if (node.textContent !== value) node.textContent = value; }
  function Session(element, send, television) {
    var state, queueKey = '', chapterKey = '', bookmarkKey = '', activeChapter = -2;
    // This template is static. All track names, chapters and labels use textContent.
    element.innerHTML = '<div class="session-heading"><div><div class="eyebrow">RESONA CONNECT</div><h2>Je sessie</h2></div><button class="session-close" aria-label="Sessie sluiten">×</button></div>' +
      '<p class="session-status" role="status"></p><div class="session-recovery" hidden><button data-tool="retry">Stream opnieuw proberen</button><button data-tool="next">Volgende proberen</button></div>' +
      '<section><h3>Hoofdstukken</h3><p class="chapter-current">Geen tijdcodes in deze trackbeschrijving.</p><div class="chapter-navigation"><button data-chapter="previous">Vorig hoofdstuk</button><button data-chapter="next">Volgend hoofdstuk</button></div><ol class="chapter-list"></ol></section>' +
      '<section><div class="session-section-title"><h3>Bladwijzers</h3><button data-tool="bookmark-add">Bewaar dit moment</button></div><button class="resume-position" hidden></button><ul class="bookmark-list"></ul><p class="bookmark-empty">Bewaar een moment om hier later terug te komen.</p></section>' +
      '<section><h3>Wachtrij</h3><ol class="session-queue"></ol><p class="session-queue-more"></p></section>' +
      '<section><h3>Sfeer</h3><div class="session-presets"><button data-preset="gallery">Gallery</button><button data-preset="studio">DJ-set</button><button data-preset="night">Nacht</button></div></section>' +
      '<section><h3>Slaaptimer</h3><div class="session-sleep"><button class="sleep-choice">Timer: uit</button><button class="sleep-off">Timer uitzetten</button></div><p class="session-timer-hint">Pauzeert de audio. De tv blijft aan.</p></section>';
    var close = element.querySelector('.session-close'); close.hidden = !television;
    close.addEventListener('click', function () { if (element.onSessionClose) element.onSessionClose(); });
    function action(type, extra) {
      if (!state) return;
      send(Object.assign({ type: type, generation: state.generation, trackId: state.track && state.track.id }, extra));
    }
    function restoreFocus(container, render) {
      var focus = container.contains(document.activeElement) ? document.activeElement.dataset.focus : '';
      container.replaceChildren(); render(container);
      if (focus) Array.from(container.querySelectorAll('button')).some(function (button) { if (button.dataset.focus === focus) { button.focus(); return true; } return false; });
    }
    function button(title, focus, callback) {
      var result = document.createElement('button'); result.textContent = title; result.dataset.focus = focus; result.addEventListener('click', callback); return result;
    }
    element.querySelectorAll('[data-tool]').forEach(function (node) { node.addEventListener('click', function () { action(node.dataset.tool); }); });
    element.querySelectorAll('[data-preset]').forEach(function (node) { node.addEventListener('click', function () { action('preset', { name: node.dataset.preset }); }); });
    element.querySelector('.resume-position').addEventListener('click', function () { action('resume'); });
    element.querySelectorAll('[data-chapter]').forEach(function (node) {
      node.addEventListener('click', function () {
        var chapters = state.track && state.track.chapters || [], index = chapterAt(chapters, state.position);
        var target = node.dataset.chapter === 'next' ? index + 1 : Math.max(0, index - 1);
        if (chapters[target]) action('chapter', { index: target });
      });
    });
    var timers = ['off', '15', '30', '60', '90', 'end-track'];
    element.querySelector('.sleep-choice').addEventListener('click', function () {
      var next = timers[(timers.indexOf(element.querySelector('.sleep-choice').dataset.choice || 'off') + 1) % timers.length];
      action('sleep', { mode: next === 'end-track' || next === 'off' ? next : 'minutes', minutes: Number(next) || undefined });
    });
    element.querySelector('.sleep-off').addEventListener('click', function () { action('sleep', { mode: 'off' }); });
    this.render = function (snapshot, track, position) {
      if (television && element.hidden) return;
      state = Object.assign({}, snapshot, { track: track || null, position: position });
      var tools = snapshot.session || {}, chapters = track && track.chapters || [], index = chapterAt(chapters, position);
      var online = snapshot.receiverOnline, active = !!track;
      text(element.querySelector('.session-status'), snapshot.error || (track ? track.title : 'Kies een nummer vanuit Resona.'));
      element.querySelector('.session-recovery').hidden = snapshot.state !== 'error';
      var nextChapterKey = (track && track.id || '') + JSON.stringify(chapters);
      if (nextChapterKey !== chapterKey) {
        chapterKey = nextChapterKey; activeChapter = -2;
        restoreFocus(element.querySelector('.chapter-list'), function (list) {
          chapters.forEach(function (chapter, index) {
            var row = document.createElement('li');
            row.appendChild(button(time(chapter.position) + ' · ' + chapter.title, 'chapter-' + index, function () { action('chapter', { index: index }); })); list.appendChild(row);
          });
        });
      }
      text(element.querySelector('.chapter-current'), index >= 0 ? chapters[index].title : chapters.length ? 'Hoofdstuk begint op ' + time(chapters[0].position) : 'Geen tijdcodes in deze trackbeschrijving.');
      if (index !== activeChapter) {
        activeChapter = index;
        element.querySelectorAll('.chapter-list li').forEach(function (row, i) { row.classList.toggle('current', i === index); });
      }
      var nextQueueKey = snapshot.queueRevision + '|' + snapshot.index;
      if (nextQueueKey !== queueKey) {
        queueKey = nextQueueKey;
        restoreFocus(element.querySelector('.session-queue'), function (list) {
          (snapshot.queue || []).slice(Math.max(0, snapshot.index), Math.max(0, snapshot.index) + 6).forEach(function (item) {
            var row = document.createElement('li'); row.className = item.current ? 'current' : '';
            row.appendChild(button(item.title, 'queue-' + item.id, function () { action('queue-play', { trackId: item.id, queueRevision: state.queueRevision }); })); list.appendChild(row);
          });
        });
        var more = Math.max(0, (snapshot.queue || []).length - Math.max(0, snapshot.index) - 6);
        text(element.querySelector('.session-queue-more'), more ? '+ ' + more + ' nummers in de wachtrij · volledig bewerken op je telefoon' : '');
      }
      var bookmarks = tools.bookmarks || [], nextBookmarkKey = (track && track.id || '') + JSON.stringify(bookmarks);
      if (nextBookmarkKey !== bookmarkKey) {
        bookmarkKey = nextBookmarkKey;
        restoreFocus(element.querySelector('.bookmark-list'), function (list) {
          bookmarks.forEach(function (bookmark) {
            var row = document.createElement('li');
            row.appendChild(button(time(bookmark.position) + (bookmark.label ? ' · ' + bookmark.label : ''), 'bookmark-' + bookmark.id, function () { action('bookmark-play', { id: bookmark.id }); }));
            var remove = button('×', 'remove-' + bookmark.id, function () { action('bookmark-remove', { id: bookmark.id }); });
            remove.setAttribute('aria-label', 'Verwijder bladwijzer op ' + time(bookmark.position)); row.appendChild(remove); list.appendChild(row);
          });
        });
      }
      element.querySelector('.bookmark-empty').hidden = bookmarks.length > 0;
      var resume = element.querySelector('.resume-position'); resume.hidden = !tools.resumePosition;
      text(resume, 'Hervatten op ' + time(tools.resumePosition || 0));
      var timer = tools.sleepTimer, choice = timer ? timer.mode === 'end-track' ? 'end-track' : String(Math.ceil(Math.max(0, timer.deadline - Date.now()) / 60000)) : 'off';
      var sleep = element.querySelector('.sleep-choice');
      // Preserve the original duration while the same deadline counts down.
      var timerKey = timer ? timer.mode + ':' + (timer.deadline || timer.trackId) : '';
      if (sleep.dataset.timer !== timerKey) { sleep.dataset.timer = timerKey; sleep.dataset.choice = timers.indexOf(choice) >= 0 ? choice : '30'; }
      if (!timer) sleep.dataset.choice = 'off';
      text(sleep, !timer ? 'Timer: uit' : timer.mode === 'end-track' ? 'Na dit nummer' : 'Nog ' + choice + ' min');
      element.querySelectorAll('button:not(.session-close)').forEach(function (node) { node.disabled = !online; });
      element.querySelectorAll('[data-tool], .sleep-choice').forEach(function (node) { node.disabled = !online || !active; });
      element.querySelector('[data-chapter=previous]').disabled = !online || !chapters.length || index <= 0;
      element.querySelector('[data-chapter=next]').disabled = !online || index + 1 >= chapters.length;
      element.querySelector('.sleep-off').disabled = !online || !timer;
      element.querySelector('[data-tool=next]').disabled = !online || snapshot.index + 1 >= (snapshot.queue || []).length;
    };
  }
  root.ResonaSession = Session;
  root.ResonaChapterAt = chapterAt;
}(window));
