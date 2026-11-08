// Applies the saved theme before the first paint (no light/dark flash).
// A separate file rather than an inline script: the CSP allows only same-origin scripts.
try {
  var theme = localStorage.getItem('tutor.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch (e) {
  /* storage unavailable: follow the system theme */
}
