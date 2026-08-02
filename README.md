# Ref Pages – Clinical Web Utilities

## Overview
**Ref-page** is a collection of browser-based utilities for medical students and clinicians.  
It includes multiple standalone web apps—each focused on a distinct clinical workflow—but unified by a shared theme engine (`core_app.js`) and a modular design.  
Everything runs entirely in the browser with no backend dependencies.

### Included Apps
| Module | Description | Entry Point |
|:--|:--|:--|
| **NoteWriter** | Structured SOAP note builder with Subjective, ROS, PE, and MSE tabs. | `v1_writer/writer.html` |
| **Differential Explorer** | Symptom-based lookup of causes from the *Pocketbook of Differential Diagnosis*. | `differentials/differentials_index.html` |
| **Clinical Calculators** | Quick bedside calculators and common clinical conversions. | `pages/calculators.html` |

---

## Features
- 🌗 **Persistent Light/Dark Theme** – Stored in `localStorage("ui-theme")` and shared across all tools.  
- 🧠 **Manifest-based UI** – Each tool loads panels and forms from JSON templates.  
- 💾 **Offline & Static** – Fully functional without a server; ideal for GitHub Pages.  
- 🧩 **Unified Framework** – Common layout, app bar, and settings drawer.  
- 🧰 **Built for Medical Students** – Focused on speed and structure for clerkships and COMAT prep.

---

## File Structure
```
index.html                        – Home page linking all tools
core_app.js                       – Shared logic (theme, settings, utilities)
v1_writer/                        – NoteWriter app and templates
  ├── writer.html
  └── templates/...
differentials/                    – Differential Diagnosis Explorer
  ├── differentials_index.html
  ├── differentials_app.js
  └── data/presentations/...
pharm/                            – Pharmacology reference app and datasets
pages/calculators.html            – Clinical calculators page
styles.css, core_style.css        – Global styling and layout
assets/                           – Icons, JSON configs, and metadata
```

---

## Setup
1. Clone or download this repository.  
2. Open `index.html` in your browser.  
3. Select a module from the home page to launch it.  
4. All data loads dynamically from local JSON—no backend required.

---

## Theme & Settings
- The selected theme is saved to `localStorage` under the key `ui-theme`.  
- Default theme is **light** when no preference is set.  
- The shared file `core_app.js` automatically applies the theme across all pages.  
- To switch manually, use:
  ```js
  setTheme('light');
  setTheme('dark');
  setTheme('system');
  ```

---

## Deployment
This project is GitHub Pages–ready.  
To deploy:
1. Go to **Settings → Pages** in your repository.  
2. Choose “Deploy from branch: main, folder: / (root)”.  
3. Visit your deployed site:  
   ```
   https://<username>.github.io/Ref-pages_v3/
   ```

---

## Roadmap
- 🧾 Export notes to DOCX/PDF  
- 📋 Additional calculators and clinical score tools  
- 🔗 Cross-app data caching  
- ⚙️ Optional PWA (offline installation)

---

## License
© 2026 SharperDragon 
For personal and educational use only.
Redistribution or commercial use is strictly prohibited.

---
