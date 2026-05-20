(function () {
  try {
    if (localStorage.getItem("mc_theme") === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  } catch {
    // Ignore storage access errors during bootstrap so startup still proceeds.
  }
})();
