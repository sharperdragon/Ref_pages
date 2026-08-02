(function (global) {
  const STORAGE_KEY = "ref_pages_settings";
  const THEME_KEY = "ui-theme"; // "light" | "dark"
  const THEME_CHANGED_EVENT = "core-theme-changed";

  // Default settings
  const DEFAULTS = {
    hideLocked: true,
    showEmpty: false,
    section: "", // section filter
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    } catch (e) {
      console.warn("Settings load failed", e);
      return { ...DEFAULTS };
    }
  }

  function save(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn("Settings save failed", e);
    }
  }

  function readSavedTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "dark" || saved === "light" ? saved : "light";
  }

  function applyTheme(mode) {
    const theme = mode === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    return theme;
  }

  function syncThemeRadios() {
    const theme = readSavedTheme();
    const radios = document.querySelectorAll('input[name="theme"]');
    if (!radios.length) return;
    radios.forEach((radio) => {
      radio.checked = radio.value === theme;
    });
  }

  function emitThemeChanged(theme) {
    document.dispatchEvent(
      new CustomEvent(THEME_CHANGED_EVENT, {
        detail: { theme },
      })
    );
  }

  function setTheme(mode) {
    const theme = mode === "dark" ? "dark" : "light";
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    syncThemeRadios();
    emitThemeChanged(theme);
    return theme;
  }

  // Public theme API used by individual pages.
  global.getTheme = function () {
    return readSavedTheme();
  };

  global.setTheme = function (mode) {
    if (mode === "system") {
      localStorage.removeItem(THEME_KEY);
      const theme = applyTheme(readSavedTheme());
      syncThemeRadios();
      emitThemeChanged(theme);
      return theme;
    }
    return setTheme(mode);
  };

  function wireThemeControls() {
    const radios = document.querySelectorAll('input[name="theme"]');
    if (!radios.length) return;

    syncThemeRadios();
    radios.forEach((radio) => {
      radio.addEventListener("change", (event) => {
        if (event.target.checked) {
          global.setTheme(event.target.value);
        }
      });
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== THEME_KEY) return;
      const theme = applyTheme(readSavedTheme());
      syncThemeRadios();
      emitThemeChanged(theme);
    });
  }

  function wireSettingsPanel() {
    const settingsButton = document.getElementById("settings-button");
    const settingsPanel = document.getElementById("settings-panel");
    const closeSettings = document.getElementById("close-settings");
    const panelContent = settingsPanel
      ? settingsPanel.querySelector(".settings-panel-content")
      : null;

    // Guard if the page does not include the settings side panel.
    if (!settingsButton || !settingsPanel || !closeSettings || !panelContent) return;

    function setPanelOpen(isOpen) {
      settingsPanel.classList.toggle("open", isOpen);
      settingsButton.setAttribute("aria-expanded", String(isOpen));
      settingsPanel.setAttribute("aria-hidden", String(!isOpen));
    }

    setPanelOpen(false);

    settingsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setPanelOpen(true);
    });

    closeSettings.addEventListener("click", (event) => {
      event.stopPropagation();
      setPanelOpen(false);
      settingsButton.focus();
    });

    // The overlay is part of settingsPanel, so close when click lands outside content.
    settingsPanel.addEventListener("click", (event) => {
      if (!panelContent.contains(event.target)) {
        setPanelOpen(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && settingsPanel.classList.contains("open")) {
        setPanelOpen(false);
        settingsButton.focus();
      }
    });
  }

  // Public API
  const CoreApp = {
    settings: load(),
    save() {
      save(this.settings);
    },
    reset() {
      this.settings = { ...DEFAULTS };
      this.save();
    },
    toggleTheme() {
      const current = readSavedTheme();
      const next = current === "light" ? "dark" : "light";
      return global.setTheme(next);
    },
  };

  // Single initialization path for theme apply + control sync.
  applyTheme(readSavedTheme());
  global.CoreApp = CoreApp;

  document.addEventListener("DOMContentLoaded", () => {
    wireThemeControls();
    wireSettingsPanel();
  });
})(window);
