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
| **In a note** | Pin it, give it a colour, add tags, add **photos**, or use **⋮** to copy, share, duplicate or delete |

The toolbar at the bottom of a note scrolls sideways — bold, italic, strikethrough,
heading, bullets, numbers, **checklists**, **photo**, quote, monospace, divider,
clear formatting.

Tap the square at the left of a checklist line to tick it off.

### Photos

The picture button in a note's toolbar offers **Take a photo** or **Choose from
gallery**, and you can pick several at once. You can also paste an image straight
into a note.

Photos are shrunk to fit a note as they go in — a 12-megapixel camera shot lands as
a few hundred kilobytes rather than four megabytes — so a notebook full of them
still opens instantly. Tap a photo in a note to **view it full size**, **save it to
your device**, or **remove** it. Removing one can be undone.

Notes with photos show them on their card in the library.

Photos live on the phone with everything else, and they are included in **Export
backup**, so one `.json` file really is the whole notebook. That also makes the file
much bigger — check the size the toast reports after an export.

Deleted notes sit in **Trash** for 30 days, then clear themselves. Nothing is lost
by accident.

---

## Where your notes live — read this bit

Notes and photos are stored **in your phone's browser storage, on that phone
only**. Nothing is
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

## Updating the app on your phone

**Side menu → Update app.** It fetches the newest version straight away and
restarts into it. Your notes, photos and settings are untouched — they live in the
phone's own storage, not in the app files.

You never need to uninstall and reinstall. If the button says *Could not reach the
network*, nothing has been changed and the app carries on as it was; try again when
you have a connection.

The app also checks when you open it. If it finds a new version it asks, with a
**Update available** dialog offering *Update now* or *Later* — it never swaps
itself out underneath you, and it will not interrupt a note you are in the middle
of writing: the question waits until you close the editor. Choose *Later* and the
side menu says one is waiting, ready whenever you are.

> Why a button at all: an installed PWA serves itself out of its own cache, and the
> browser will happily answer the app's own script and stylesheet requests from a
> copy it already has without consulting that cache. That is why a freshly deployed
> change can seem to need a reinstall — and why `index.html` can arrive new while
> `js/app.js` is still last month's, leaving buttons on screen that do nothing.
> Update app forces the whole shell to be re-fetched and then relaunches through a
> URL the browser has not seen, so the new files are the ones that run. The same
> relaunch is what the start-up check uses when it notices a mismatched build.

## Changing it

- **Anything that floats over the app** — the bottom sheets, the dialog, the photo
  viewer and the toast are positioned against the *visual* viewport
  (`--vvh`, `--vvt`, `--kb`), not the window. An open keyboard shrinks the visual
  viewport but leaves the window its full height, so anything pinned to the bottom
  of the window opens behind the keyboard. Keep new overlays on those variables.
- **Colours and sizes** — the tokens at the top of [`css/style.css`](css/style.css).
  `--accent` is the green; change that one line to recolour the whole app.
- **App name** — the `<title>` in `index.html`, the `.brand` text, and `name` /
  `short_name` in `manifest.webmanifest`.
- **Icons** — replace the PNGs in `icons/`. They are 192, 512, a 512 maskable
  (keep the artwork inside the middle 80%, Android crops the rest), and a 180 for iOS.
- The service worker caches a new build and then **waits** rather than taking
  over. The page is what asks the question and sends `skip-waiting` on a yes.
- **After any change**, bump the version in all three files so they agree:
  `VERSION` in [`sw.js`](sw.js), `APP_VERSION` in [`js/app.js`](js/app.js) and
  `STORE_VERSION` in [`js/store.js`](js/store.js). The cache is named after
  `VERSION`, so bumping it is what tells every phone to take the new files.

  The three are compared at start-up, by a short script at the bottom of
  `index.html`. If a phone ends up running scripts that do not match the build the
  worker is serving, the page quietly relaunches itself onto the right ones — so a
  half-updated app repairs itself instead of showing buttons that do nothing. That
  check is also why the numbers have to match: leave one behind and every launch
  will try to mend a page that was never broken.

## Previewing on your computer

```bash
python -m http.server 8777
```

Then open <http://127.0.0.1:8777/>. Opening `index.html` by double-clicking will not
work properly — service workers and storage need a real `http://` origin.

## What is in here

```
index.html              markup, the inline SVG icons, and the start-up check
                        that repairs a half-updated app
css/style.css           the whole look, light and dark
js/store.js             IndexedDB storage for notes and photos, export/import
                        (falls back to localStorage)
js/app.js               everything else: rendering, editor, search, settings
sw.js                   offline cache and the in-place update
manifest.webmanifest    name, icons, share target, home-screen shortcut
icons/                  app icons
.nojekyll               stops GitHub Pages from filtering files
```

Fonts (Fraunces and Inter) load from Google Fonts on the first visit and are cached
after that. If they never load, the app falls back to the system fonts and still
looks fine.
