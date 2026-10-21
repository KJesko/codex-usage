'use strict';

globalThis.WebLanguage = {
  month: day => document.documentElement.lang.startsWith('en')
    ? new Intl.DateTimeFormat('en-US', {month:'short', timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'))
    : Number(day.slice(5,7))+'月',
};

// A browser preference only. Reloading retains the route and all URL filters;
// existing theme and hidden-project preferences use independent storage keys.
document.addEventListener('DOMContentLoaded', () => {
  const selector = document.getElementById('language');
  if (!selector) return;
  selector.value = document.documentElement.lang.startsWith('en') ? 'en' : 'zh-CN';
  selector.addEventListener('change', () => {
    if (document.documentElement.dataset.demoRoot) {
      const root = new URL(document.documentElement.dataset.demoRoot, location.href);
      const destination = new URL(selector.value === 'en' ? 'en/' : './', root);
      destination.search = location.search;
      destination.hash = location.hash;
      location.href = destination.href;
      return;
    }
    document.cookie = `codex-usage-language=${selector.value}; Path=/; Max-Age=31536000; SameSite=Strict`;
    if (!document.cookie.split(';').some(c => c.trim() === `codex-usage-language=${selector.value}`)) {
      selector.value = document.documentElement.lang.startsWith('en') ? 'en' : 'zh-CN';
      window.alert('Please enable cookies to save the display language. / 请允许 Cookie 以保存界面语言。');
      return;
    }
    location.reload();
  });
});
