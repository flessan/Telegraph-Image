# Manual QA — sequential Push and MIME-aware output

Run against the live preview (`npm start`, then open the workspace at `/` and the
console at `/admin.html`). Deterministic behaviour is already covered by
`npm test`; this list is for the things only a human at a browser can judge.

Tip: the two push intervals are preferences, so a slow batch can be made easy to
observe. In the browser console:

```js
const p = JSON.parse(localStorage.getItem('ti.prefs') || '{}');
localStorage.setItem('ti.prefs', JSON.stringify({ ...p, pushDelayMs: 2500 }));  // default 1200
```

## 1. Push queue

- [ ] Stage 5–20 mixed files (drag-and-drop and the file picker). **No network
      request is made** — check DevTools → Network, it stays empty until Push.
- [ ] Press **Push changes**. Exactly one `/upload` request is in flight at any
      moment (Network panel, waterfall is a staircase, never parallel bars).
- [ ] The queue panel shows the phase, `n of N`, transferred bytes and a real
      progress bar for the current file.
- [ ] The ETA starts as `estimating…`, then becomes `~Ns remaining` and updates
      smoothly without flickering between values.
- [ ] Between files the phase reads **Waiting** with a visible countdown
      (`Waiting 2.4s before next upload`).
- [ ] File chips move through `Queued → Uploading → Synced`; the footer hairline
      progress advances.
- [ ] Completion shows `x uploaded · y failed · z skipped` and a **Done** button
      that dismisses the panel.

## 2. Failures, retries, rate limiting

- [ ] Simulate a transient failure: DevTools → Network → **Offline** for a
      moment mid-batch, or block `/upload` with a request-blocking rule and set
      it to fail. The queue shows `Retrying … in Ns` and retries with a growing
      delay, up to 3 retries, then `Failed`.
- [ ] The batch **continues** past a permanently failed file (e.g. an upload
      rejected with 4xx); later files still upload.
- [ ] **Retry failed** re-sends only the failed files; already-synced files are
      not re-uploaded (verify in the Network panel).
- [ ] A failed file keeps its thumbnail/preview and can be pushed again later —
      its local copy was not discarded.

## 3. Pause / cancel / offline

- [ ] **Pause** mid-batch: the in-flight request completes, then the queue parks
      at `Paused` with `n files still staged`. **Resume** continues in order.
- [ ] **Cancel** mid-batch: no new request starts, remaining files stay staged
      and visible (`Not sent`), and the summary reports them as skipped.
- [ ] Go offline *before* Push: pressing Push shows the offline message, no
      request is attempted, and every staged file survives a page reload.
- [ ] Go offline *during* a batch: the queue stops cleanly, staged files remain.

## 4. MIME-aware previews

Upload or stage one of each: PNG/JPEG, MP3, MP4, PDF, TXT, ZIP, and a file with
an unknown/incorrect extension.

- [ ] Image → image viewer (click to zoom).
- [ ] Audio → audio player with controls.
- [ ] Video → video player with controls.
- [ ] PDF → embedded document view plus “Open in a new tab”.
- [ ] TXT / ZIP / unknown → clean generic surface with type, size and Download —
      never a broken image.
- [ ] A file whose *extension lies* (e.g. an MP3 named `x.png`) previews as
      audio: the MIME type wins locally.
- [ ] Same checks in the console detail sheet (`/admin.html` → open an object).
      Remote objects have no stored MIME type, so the extension is used there.

## 5. MIME-aware links

For each of the files above, copy all four formats (workspace: format tabs +
`Copy all`; console: object menu → Copy URL/Markdown/BBCode/HTML).

- [ ] **URL** is byte-identical to the public `/file/...` URL for every type.
- [ ] **HTML**: image → `<img …>`, audio → `<audio controls …>`, video →
      `<video controls …>`, PDF → `<iframe …>`, other → `<a … download>`.
- [ ] **Markdown**: only images use `![…](…)`; everything else is `[…](…)`.
- [ ] **BBCode**: only images use `[img]…[/img]`; everything else is
      `[url=…]name[/url]`.
- [ ] Upload a file named `"><b>x</b> [a](b) & 'quotes' 🇮🇩.png` and confirm the
      snippets are escaped (paste into a text editor: no raw `<b>`, brackets are
      escaped in Markdown, `&#91;`/`&#93;` in BBCode).

## 6. Presentation

- [ ] Both languages: switch to Bahasa Indonesia and repeat §1 quickly — phase,
      countdown, retry and summary strings are all translated; filenames, URLs,
      MIME types and snippets are **not**.
- [ ] Light and dark theme: the queue panel and preview surfaces stay legible.
- [ ] Mobile widths (320 / 375 / 430) and tablet (768): the queue panel wraps,
      controls stay reachable, long filenames truncate.
- [ ] Keyboard: Tab reaches Pause/Cancel/Retry/Done; Escape closes the preview;
      focus returns to the trigger.
- [ ] `prefers-reduced-motion: reduce` (DevTools → Rendering): progress bars
      update without animation, nothing springs or bounces.
- [ ] Console has no errors during a full batch.
