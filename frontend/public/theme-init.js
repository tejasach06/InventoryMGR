(() => {
  try {
    const stored = window.localStorage.getItem('inventorymgr-theme');
    const theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = theme === 'dark' || (theme === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch {
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }
})();
