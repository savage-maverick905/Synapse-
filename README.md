# Synapse Beta — *Turn curiosity into a course.*

A static, framework-free web app (HTML + CSS + vanilla JS). Tell it what you want to learn; it generates a
structured course with Gemini, lets you read it like a textbook, and exports a typeset PDF or an offline ZIP package.

## Run it
Service workers (offline mode / install) need **HTTPS or localhost**. From this folder:

    python3 -m http.server 8000      # then open http://localhost:8000

Or upload the folder to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages…). Opening `index.html`
straight from disk works for the app itself, but offline mode and install are disabled there.

Then: **Settings → AI providers**. Add a key for one or more of Groq (free, easiest — sign in with Google at
console.groq.com/keys, no card), Mistral, OpenRouter, Google Gemini, or any OpenAI-compatible endpoint. Pick
one as the **writer** and, optionally, turn others on as **backups**: if the writer runs out of free quota or
is overloaded mid-course, Synapse switches to a backup automatically. Only Gemini currently offers live web
search, so it can be turned on as the **references** source even when it isn't the writer.

On the home screen, **Generate now** starts right away; **Add to queue** saves the request without calling any
AI until you tap Start from the **Pending** tab — nothing generates until you say so. A course keeps generating
in the background while you use the rest of the app, as long as the tab stays open; turn on notifications in
Settings to hear about it if you look away. Use **Explore a sample
course** on the home screen to try the reader and exports without a key.

> Client-side keys are fine for personal use, **not** for a public deployment: anyone who opens the page can read them.

## Files
    index.html  style.css  app.js        shell, design system, UI / router / reader
    manifest.json  service-worker.js     PWA (installable, offline shell, cached CDN libs)
    js/util.js        helpers, SynapseError, script loader
    js/markdown.js    safe Markdown-subset parser → HTML and PDF
    js/diagrams.js    validates AI diagram specs, draws SVG (flow, cycle, layers) / CSS (comparison)
    js/schema.js      JSON recovery + validation + normalisation of courses
    js/providers.js   AI provider registry; Gemini implementation (with live web-search grounding)
    js/openai.js      OpenAI-compatible providers: Groq, Mistral, OpenRouter, Custom (retries, quota fallback)
    (generator.js)    also runs the multi-AI chain: switches writer on quota/overload, keeps a background queue
    js/generator.js   resumable multi-step generation pipeline
    js/images.js      Wikimedia Commons photo lookup (with licence + attribution), JPEG optimisation
    js/storage.js     localStorage prefs / key, IndexedDB courses + progress
    js/pdf.js         pdfmake document definition → real selectable-text PDF (6×9 in book)
    js/certificate.js one-page "Certificate of Completion" PDF, reuses the pdf.js engine
    js/stats.js       XP, levels, streaks, achievements — pure local logic, zero AI calls
    js/discover.js    real "did you know" facts (Wikipedia) and quotes, as shareable PNG cards
    js/zip.js         JSZip package builder
    js/mock.js        hand-written sample course

## CDN libraries (loaded lazily, then cached for offline use)
pdfmake 0.2.10 (jsDelivr, cdnjs fallback) · JSZip 3.10.1 · Google Fonts (Bricolage Grotesque, Newsreader) ·
IBM Plex TTFs for the PDF (falls back to bundled Roboto if unreachable).

## Course JSON (what the app stores and renders)
    { title, subtitle, description, level, estimatedTime, objectives[], prerequisites[],
      modules: [{ title, description,
                  lessons: [{ title, summary, content /*Markdown subset*/, keyPoints[],
                              examples:[{title,body}], exercise:{prompt,hint}, reflection[],
                              quiz:{questions:[{question,options[],answerIndex,explanation}]},
                              images:[{type:"diagram",description,caption,diagram:{kind,…}} |
                                      {type:"photo",description,caption,searchQuery,dataUrl,attribution,license,sourceUrl}],
                              sources:[{title,website,url,description}] }],
                  project:{title,brief,steps[],deliverable} | null }],
      references:[{title,website,url,description,verified,via}],
      suggestedTopics:[{title,description,query,url}] }

## How honesty is enforced
* URLs are never taken from the model's memory. Verified references come from Gemini's Google Search grounding;
  everything else is listed as *Suggested topics* (not verified).
* Lessons can only cite indexes into that verified list.
* The model never supplies image URLs; photos come from Wikimedia Commons with licence and attribution, or are omitted.
* Progress is reported as real counts (module 3 of 6), never a percentage.

## Real-web facts & quotes
The home screen has a "Did you know?" / quote-of-the-day card. Facts come from Wikipedia's public
REST API, picked around a topic from a course already in the library when one exists (otherwise a
random Wikipedia fact); quotes come from a free public quotes API. Both are real web content, not
AI-generated, and both gracefully fall back to a small bundled set if the network or the source is
unavailable — including fully offline. "Save as image" renders the card as a Synapse-styled PNG
(1080×1080, canvas-drawn) for sharing.

## Streaks, XP, achievements & certificates
Reading a lesson, finishing a project, or completing a course earns XP and keeps a daily study
streak (a calendar heatmap and 15 achievements live on the **Progress** tab). A "Get certificate"
button appears once a course reaches 100%, generating a one-page PDF diploma with the learner's
name (set once in Settings → Profile, reused after that). A "Concept map" button on any multi-module
course draws a small diagram of how its modules connect. **None of this ever calls an AI provider** —
everything is derived from courses already sitting in the browser, so it costs zero API credits to use.

## Design system
Hie Technologies palette: `#1E1E1E` dark surfaces, `#F2F2F2` light surfaces, `#ED6627` orange as the one
recognizable accent (buttons, brand, key emphasis), `#00ADEF` blue used sparingly (links, progress, info),
`#FFAD80` light orange for hover/highlight only. Diagrams and PDF pull from the same tokens so a course looks
the same in the reader and in print. Pinch-zoom is disabled per product request; the reader has its own text-size
control (the "Aa" button) as the accessible way to read larger text.

## Known limits
* AI-written courses can contain mistakes.
* PDF fonts cover Latin, Greek and Cyrillic; CJK text will not render in the PDF.
* Very large courses: use "one PDF per module" in the package dialog.
* "Background" generation means "keeps running while this browser tab is open" — there is no true OS-level
  background service in a static frontend. If the tab or browser fully closes mid-course, the item pauses and
  needs a tap on Start to resume; nothing is lost, since progress is saved after every module.
* Disabling pinch-zoom trades off some accessibility; the in-reader text-size control is the alternative.
