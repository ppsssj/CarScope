// If one file of the page's module graph fails to load, the whole graph never runs: nothing starts and nothing says why. Seen as a transient
// net::ERR_NO_BUFFER_SPACE on Windows runners, and any network blip on a phone can do the same. docs/p12-e-bonnet-part-detection.md
// A classic script on purpose: it has to work when the modules do not. It reloads once, and then says so and leaves it to the person.
// Reloading is safe because the entry has not run: a QR invite in the address has not been used. history.state remembers the try: no storage.
(function () {
  var RETRIED = 'carscopeStartRetried';
  function fail() {
    document.body.dataset.startFailed = 'true';
    var box = document.createElement('div'), text = document.createElement('p'), again = document.createElement('button');
    box.id = 'page-start-failed'; box.className = 'card warn'; box.setAttribute('role', 'alert');
    text.textContent = '화면을 다 불러오지 못했어요. 인터넷 연결을 확인하고 다시 불러와 주세요.';
    again.id = 'page-start-reload'; again.type = 'button'; again.textContent = '다시 불러오기';
    again.addEventListener('click', function () { location.reload(); });
    box.append(text, again);
    (document.querySelector('main') || document.body).prepend(box);
  }
  // Load errors do not bubble, so this listens on the way down. Only the page's own module script counts, and its error means its graph failed.
  document.addEventListener('error', function (event) {
    var target = event.target;
    if (!target || target.tagName !== 'SCRIPT' || target.type !== 'module') return;
    if (history.state && history.state[RETRIED]) { fail(); return; }
    var state = {}; state[RETRIED] = true;
    history.replaceState(state, ''); // No URL: the address, with any QR fragment, stays exactly as it is.
    location.reload();
  }, true);
  // A start that worked leaves no trace of the try. A failed one keeps it, so a tap on the button cannot turn into a reload loop.
  addEventListener('load', function () {
    if (history.state && history.state[RETRIED] && !document.body.dataset.startFailed) history.replaceState(null, '');
  });
})();
