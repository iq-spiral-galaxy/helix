(() => {
  try {
    const theme = localStorage.getItem("helix.theme");
    const resolvedTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = resolvedTheme;
    document.getElementById("theme-color").content =
      resolvedTheme === "dark" ? "#1e1f20" : "#f7f7f6";
    if (localStorage.getItem("helix.sidebar") === "collapsed") {
      document.documentElement.dataset.sidebar = "collapsed";
    }
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
