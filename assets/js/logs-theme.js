(function () {
  'use strict';
  const root = document.documentElement;
  const key = 'logs-theme';
  let theme = 'dark';
  try { if (localStorage.getItem(key) === 'light') theme = 'light'; } catch (_) {}
  root.dataset.logsTheme = theme;
  function mount() {
    const host = document.querySelector('.galaxy-tuner__heading, .article-region__actions');
    if (!host) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'logs-theme-toggle';
    button.dataset.logsThemeToggle = '';
    function apply(next) {
      theme = next;
      root.dataset.logsTheme = theme;
      button.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
      button.setAttribute('aria-label', theme === 'dark' ? 'Use light theme' : 'Use dark theme');
      button.setAttribute('aria-pressed', String(theme === 'light'));
    }
    button.addEventListener('click', () => {
      apply(theme === 'dark' ? 'light' : 'dark');
      try { localStorage.setItem(key, theme); } catch (_) {}
    });
    window.addEventListener('storage', event => {
      if (event.key === key) apply(event.newValue === 'light' ? 'light' : 'dark');
    });
    apply(theme);
    host.append(button);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
