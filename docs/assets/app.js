(function(){
  var y = document.getElementById('y');
  if (y) y.textContent = String(new Date().getFullYear());

  var fallbackLinks = {
    chrome: '#setup',
    edge: '#setup',
    macLinux: '#download',
    github: '../README_EN.md',
    support: '#faq'
  };

  var configuredLinks = (window.LMT_LANDING_URLS && typeof window.LMT_LANDING_URLS === 'object')
    ? window.LMT_LANDING_URLS
    : {};

  Array.prototype.slice.call(document.querySelectorAll('[data-landing-link]')).forEach(function(a){
    var key = a.getAttribute('data-landing-link');
    var fallback = a.getAttribute('data-landing-fallback') || fallbackLinks[key] || '';
    var href = configuredLinks[key] || fallback;
    if (href) {
      a.setAttribute('href', href);
      if (href.indexOf('#') !== 0) {
        a.setAttribute('rel', 'noopener');
      } else {
        a.removeAttribute('rel');
        a.removeAttribute('target');
      }
    } else {
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
      a.className = (a.className || '') + ' is-disabled';
    }
  });
})();
