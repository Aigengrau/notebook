# Inkwell

A note app for your phone. It is a web page, but once you add it to your home screen
it opens full-screen with its own icon, works with no signal, and behaves like any
other Android app.

No build step, no dependencies, no server, no account. Four files and some icons.

---

## 1. Put it on GitHub

Open a terminal **inside this `Inkwell` folder** and run:

```bash
git init
git add .
git commit -m "Inkwell"
git branch -M main
```

Create an empty repository on GitHub (no README, no .gitignore), then:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

## 2. Turn on GitHub Pages

In the repository: **Settings → Pages**

- **Source:** Deploy from a branch
- **Branch:** `main`, folder `/ (root)`
- **Save**

Wait about a minute. Your app is now at:

```
https://<your-username>.github.io/<repo-name>/
```

> It must be `https://` — the offline support and the install prompt only work on a
> secure origin. GitHub Pages gives you that for free.

## 3. Install it on your phone

1. Open that URL in **Chrome on Android**.
2. Tap the **⋮** menu → **Add to Home screen** (sometimes called *Install app*).
3. Confirm.

You now have an Inkwell icon in your app drawer. It opens without the browser bar,
and after the first visit it loads with no connection at all.

There is also an **Add to home screen** button inside the app's side menu when
Chrome offers it.

### Extras you get once it is installed

- **Long-press the icon** → *New note* jumps straight into a blank note.
- **Share anything into it.** Share a page, a message or selected text from any app,
  pick Inkwell, and it opens as a new note with the text already in it.

---

## Using it

| | |
|---|---|
| **+** | New note |
| **Tap a note** | Open and edit — it saves as you type, there is no save button |
| **☰** | Side menu: pinned, trash, tags, theme, sort, backups |
| **🔍** | Search across every title, body and tag |
| **Grid icon** | Switch between two columns and a single list |
| **In a note** | Pin it, give it a colour, add tags, or use **⋮** to copy, share, duplicate or delete |

The toolbar at the bottom of a note scrolls sideways — bold, italic, strikethrough,
heading, bullets, numbers, **checklists**, quote, monospace, divider, clear formatting.

Tap the square at the left of a checklist line to tick it off.

Deleted notes sit in **Trash** for 30 days, then clear themselves. Nothing is lost
by accident.

---

## Where your notes live — read this bit

Notes are stored **in your phone's browser storage, on that phone only**. Nothing is
uploaded, there is no account, and nobody else can read them. The flip side is that
nothing syncs, and the notes are gone if you:

- clear Chrome's site data or storage for that site,
- uninstall the app *and* clear its data,
- or switch to a different phone.

So: **Side menu → Export backup** writes every note to a single `.json` file in your
Downloads. Do it now and then. **Import backup** merges a file back in — notes with
the same id keep whichever copy was edited last, so importing an old backup will
never overwrite newer work.

That same export/import pair is how you move your notes to a new phone.

---

## Changing it

- **Colours and sizes** — the tokens at the top of [`css/style.css`](css/style.css).
  `--accent` is the green; change that one line to recolour the whole app.
- **App name** — the `<title>` in `index.html`, the `.brand` text, and `name` /
  `short_name` in `manifest.webmanifest`.
- **Icons** — replace the PNGs in `icons/`. They are 192, 512, a 512 maskable
  (keep the artwork inside the middle 80%, Android crops the rest), and a 180 for iOS.
- **After any change**, bump `CACHE` in [`sw.js`](sw.js) (`inkwell-v1` → `inkwell-v2`).
  Otherwise phones keep serving the old cached copy. With the bump, the app notices
  the new version and offers a *Reload* button.

## Previewing on your computer

```bash
python -m http.server 8777
```

Then open <http://127.0.0.1:8777/>. Opening `index.html` by double-clicking will not
work properly — service workers and storage need a real `http://` origin.

## What is in here

```
index.html              markup and the inline SVG icons
css/style.css           the whole look, light and dark
js/store.js             IndexedDB storage, export/import (falls back to localStorage)
js/app.js               everything else: rendering, editor, search, settings
sw.js                   offline cache
manifest.webmanifest    name, icons, share target, home-screen shortcut
icons/                  app icons
.nojekyll               stops GitHub Pages from filtering files
```

Fonts (Fraunces and Inter) load from Google Fonts on the first visit and are cached
after that. If they never load, the app falls back to the system fonts and still
looks fine.
