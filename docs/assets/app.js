(function(){
  var y = document.getElementById('y');
  if (y) y.textContent = String(new Date().getFullYear());

  // Simple placeholder check to prevent shipping broken buttons.
  var placeholders = [
    '__CHROME_WEB_STORE_URL__',
    '__EDGE_ADDONS_URL__',
    '__DOWNLOAD_MAC_LINUX_URL__',
    '__GITHUB_REPO_URL__',
    '__SUPPORT_EMAIL__'
  ];

  var links = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
  var missing = [];
  links.forEach(function(a){
    placeholders.forEach(function(p){
      if (a.getAttribute('href') === p) missing.push(p);
    });
  });

  if (missing.length){
    console.warn('Landing placeholders are not set. Replace in index.html:', Array.from(new Set(missing)));
  }
})();
