<task>
You are a world-class frontend engineer with deep expertise in Apple's Human Interface Guidelines and a refined aesthetic sense. You work exclusively with vanilla HTML/CSS/JS — no frameworks, no build tools. Your mission is to add three sophisticated, Apple-level design features to a Hexo static blog. Every line of code you write must be production-ready, responsive, accessible, and performant.
</task>

<context>

## The Blog Tech Stack

- **Static site generator**: Hexo 8.1.1 (Node.js)
- **Templating**: EJS (all templates in `themes/clean-blog/layout/`)
- **CSS**: Single vanilla file at `themes/clean-blog/source/css/clean-blog.css` (1262 lines)
- **JavaScript**: Single vanilla file at `themes/clean-blog/source/js/clean-blog.js` (783 lines, IIFE-wrapped, `'use strict'`)
- **No frameworks**: No Tailwind, no Bootstrap JS, no jQuery, no React
- **Fonts**: Google Fonts Lora (serif body), system font stack for UI chrome
- **Extras**: Prism.js for syntax highlighting, Giscus for comments, KaTeX (conditional)
- **Deployment**: GitHub Pages via GitHub Actions

## Layout Architecture (current state)

The blog is a purely single-column design. There is NO sidebar anywhere currently. The layout is:

```
layout.ejs (shell)
  └── head.ejs        → <head> with meta, fonts, CSS link
  └── nav.ejs         → fixed/absolute navbar, frosted glass on scroll
  └── masthead.ejs    → hero header with SVG background images
  └── <body content>  → page-specific content (post.ejs, index.ejs, etc.)
  └── footer.ejs      → site footer
  └── scripts.ejs     → single <script> tag for clean-blog.js
```

**Article pages** (`post.ejs`):
- Content wrapped in `.container > .row.justify-content-center > .col`
- The `.col` goes from 100% (mobile) to 58.333% width at >=1200px
- The article body is rendered via `<%- page.content %>` inside `.post-body`
- Headings are plain `h1, h2, h3` etc. in the rendered markdown — **no IDs, no anchor links**
- No TOC (Table of Contents) exists anywhere

**Homepage** (`index.ejs`):
- Uses CSS Grid `.home-layout` single column
- Iterates `post-preview.ejs` partial for each post
- Pagination at the bottom

**Existing scroll-driven features** (all vanilla JS):
1. Navbar shrink: position absolute → fixed + frosted glass when scrollY > 60px
2. Reading progress bar: thin teal bar at top of viewport on post pages
3. Back-to-top button: appears at scrollY > 400

**Masthead/hero backgrounds**: Currently SVG files (home-bg.svg, post-bg.svg, about-bg.svg), 1600x900, referenced via `_config.clean-blog.yml`.

## Key File Paths (absolute)

| File | Role |
|------|------|
| `themes/clean-blog/layout/layout.ejs` | Base HTML shell — body classes, main structure |
| `themes/clean-blog/layout/post.ejs` | Article page — `.post-body` content, tags, prev/next |
| `themes/clean-blog/layout/index.ejs` | Homepage — post preview loop |
| `themes/clean-blog/layout/_partial/masthead.ejs` | Hero header — background image, heading/subheading |
| `themes/clean-blog/layout/_partial/nav.ejs` | Navbar |
| `themes/clean-blog/layout/_partial/post-preview.ejs` | Post card on homepage |
| `themes/clean-blog/layout/_partial/head.ejs` | `<head>` meta, Google Fonts, CSS link |
| `themes/clean-blog/layout/_partial/scripts.ejs` | JS script tag |
| `themes/clean-blog/source/css/clean-blog.css` | All styles |
| `themes/clean-blog/source/js/clean-blog.js` | All JS (IIFE, strict mode) |
| `themes/clean-blog/_config.yml` | Theme defaults |
| `_config.clean-blog.yml` | User's site config overrides |

</context>

<design_principles>
## Apple-Inspired Design Language — Your North Star

Every visual decision should be guided by these principles:

1. **Generous whitespace**: Elements need room to breathe. Padding and margins should feel spacious but not wasteful.
2. **Typography-first**: Let the text carry the experience. Lora for long-form reading, system font stack for UI. Clean hierarchy through size, weight, and spacing — never through heavy decoration.
3. **Frosted glass**: Use `backdrop-filter: blur()` and semi-transparent backgrounds for overlays and UI panels. Saturation boost (`saturate(180%)`) for vibrancy — exactly like the existing navbar.
4. **Subtle transitions**: 0.25s–0.4s durations. Easing should feel refined: `cubic-bezier(0.4, 0, 0.2, 1)` for standard, `cubic-bezier(0.2, 0, 0, 1)` for entrances. Nothing bouncy, nothing abrupt.
5. **Dark sophistication**: The existing palette is white background + #212529 ink + #0085a1 teal accent. Extend this language. Use rgba layering for depth.
6. **No harsh shadows**: Shadows should be soft and ambient — `box-shadow: 0 1px 3px rgba(0,0,0,0.04)` not `0 4px 12px rgba(0,0,0,0.3)`. Use layered shadows for elevation when needed.
7. **Rounded corners**: Subtle radiuses — 4px for small elements, 8px–12px for panels, 999px for pills. Never sharp corners on UI surfaces.
8. **Native feel**: Animations should feel like they're driven by physics, not math. The page should feel responsive and alive, not gimmicky.
</design_principles>

<requirements>
## What You Must Build — Three Features

### Feature 1: Collapsible TOC Sidebar on Article Pages

**The problem**: Long articles have no navigation. Readers can't see the structure or jump to sections.

**What to build**:
1. Extract all h2 and h3 headings from `.post-body` on article pages. Inject anchor IDs into each heading so they become linkable targets.
2. Build a sticky sidebar TOC that sits in a left sidebar column alongside the main article content.
3. The TOC must:
   - Show a nested list: h2 as top-level items, h3 indented beneath their parent h2
   - Highlight the currently visible section as the user scrolls (Intersection Observer)
   - Smooth-scroll to the target heading when a TOC item is clicked
   - Be collapsible (toggle between expanded and a minimal indicator)

**Desktop layout (>=1200px)**:
- Transform the article page from single-column to two-column: TOC sidebar on the left (~200px–240px), article content in the center (~640px–700px max-width)
- The TOC should be sticky within the viewport (position: sticky, top offset accounting for the shrunken navbar height ~60px)
- The TOC should NOT overlap the navbar or footer
- The TOC should have its own scroll if it's taller than the viewport

**Mobile layout (<992px)**:
- TOC collapses into a floating circular button (bottom-right, above the back-to-top button)
- The button shows a list icon (three lines with dots, similar to a list-ul icon)
- Tapping the button opens a frosted-glass overlay/drawer from the bottom or right that shows the full TOC
- The drawer has a close button and tapping outside it closes it
- The drawer should have a subtle backdrop blur background

**Active heading tracking**:
- Use Intersection Observer with `rootMargin: '-80px 0px -40% 0px'` to detect which heading is currently "active"
- The active TOC item should have a subtle left border accent (teal) and slightly bolder text
- Transitions between active states should be smooth (transition on border-color and font-weight)

**Edge cases to handle**:
- Posts with no h2/h3 headings: TOC should not render at all (no empty sidebar, no floating button)
- Posts with only one heading: TOC should still render but look minimal
- Very long TOC items: text should truncate with ellipsis
- The TOC must be keyboard accessible (Tab through items, Enter to activate)

### Feature 2: Scroll-Driven Fade-In for Homepage Article Cards

**The problem**: The homepage article list appears all at once, feeling static.

**What to build**:
1. Each `.post-preview` card on the homepage should fade in and slide up slightly as it enters the viewport.
2. Use Intersection Observer (NOT scroll event listeners) for optimal performance.
3. Stagger the animation: no artificial delay, just let each card animate independently as it crosses the threshold.

**Animation specifications**:
- Initial state (invisible): `opacity: 0; transform: translateY(24px);`
- Visible state: `opacity: 1; transform: translateY(0);`
- Transition: `opacity 0.5s cubic-bezier(0.2, 0, 0, 1), transform 0.5s cubic-bezier(0.2, 0, 0, 1)`
- Observer threshold: 0.15 (card is 15% visible before animating)
- Root margin: `0px 0px -40px 0px` (trigger slightly before the card enters)
- Once animated, unobserve the element (no re-animation when scrolling back up)
- Critical: the first 1-2 cards that are already visible above the fold on page load should appear immediately (no animation delay — check `entry.boundingClientRect.top < window.innerHeight` on initial load)

**Edge cases**:
- Works with pagination: any `.post-preview` on any page gets the animation
- If JS is disabled, all cards are visible (the CSS defaults to visible state)
- Respect `prefers-reduced-motion`: if the user has reduced motion preference, skip the animation (cards appear instantly)
- The horizontal `<hr class="post-divider">` between cards should NOT animate separately — it should just appear with its adjacent card

### Feature 3: Apple-Style Photography Hero Backgrounds

**The problem**: SVG gradient backgrounds feel generic and dated. Apple uses dark, moody photography for visual depth.

**What to build**:
1. Replace the SVG masthead backgrounds with high-quality photographic images.
2. Add a subtle parallax/depth effect on scroll.

**Image sourcing**:
- Use royalty-free images from Unsplash
- Provide specific Unsplash photo URLs that match the Apple aesthetic
- Each page type gets a different image: home, post, about, archive
- Images should share a consistent mood: dark, atmospheric, minimal, natural — think foggy forests, misty mountains, still water at dusk, minimalist desert

**Recommended image characteristics**:
- Dark or muted tones (so white text remains readable)
- Negative space for text to sit over
- Natural landscapes or abstract nature — avoid urban scenes, avoid people
- Resolution: at least 1600x900, preferably 2400x1350 for retina

**Technical implementation**:
- Update `_config.clean-blog.yml` masthead section to reference new image URLs
- Add a subtle parallax effect: on scroll, the masthead background translates slightly slower than the page content (scale transform on the masthead itself or translateY on the background)
- The parallax should be restrained — Apple's parallax is subtle, not dramatic. Maximum ~8% scale change or ~30px translation across the full scroll range.
- Use `transform: scale()` in JS on the masthead element (read scroll position, apply small scale factor)
- Keep the existing `.masthead-overlay` dark overlay for text readability (or adjust its opacity)
- Ensure text contrast: the overlay should be dark enough that white text on top of the photo is clearly readable (WCAG AA at minimum — contrast ratio >= 4.5:1)

**Specific Unsplash URLs to use (provide these as the recommendation)**:
- Find and recommend specific Unsplash photo URLs or Unsplash collection URLs
- Use the format `https://images.unsplash.com/photo-XXXXX?w=2400&q=85` for direct image links
- Describe what to search for on Unsplash if the user wants to find their own

**Fallback**: If images fail to load, fall back to the existing dark background color (#212529) so text remains readable.
</requirements>

<current_code_reference>
## Current Code — What You're Working With

Here are the exact current states of the files you'll modify. Study these carefully.

### `layout.ejs` (the HTML shell)
```ejs
<%
  const lang = page.lang || page.language || config.language || 'default';
  const bodyClasses = [];
  if (is_home()) bodyClasses.push('is-home');
  if (is_post()) bodyClasses.push('is-post');
  if (is_archive()) bodyClasses.push('is-archive');
  if (is_category()) bodyClasses.push('is-category');
  if (is_tag()) bodyClasses.push('is-tag');
  if (page.type) bodyClasses.push('type-' + page.type);
%>
<!doctype html>
<html lang="<%= lang %>">
<head>
  <%- partial('_partial/head') %>
</head>
<body id="page-top" class="<%= bodyClasses.join(' ') %>">
  <%- partial('_partial/nav') %>
  <%- partial('_partial/masthead') %>

  <main id="main-content">
    <%- body %>
  </main>

  <hr class="section-divider" />

  <%- partial('_partial/footer') %>
  <%- partial('_partial/scripts') %>
</body>
</html>
```

### `post.ejs` (article page — where TOC goes)
```ejs
<article class="article article-post mb-4">
  <div class="container">
    <div class="row justify-content-center">
      <div class="col">
        <div class="post-body"><%- page.content %></div>

        <% if (page.tags && page.tags.length) { %>
        <div class="post-tags">
          <span class="post-tags-label"><%= __('post.tags') %>:</span>
          <% page.tags.each(function (t) { %>
            <a class="post-tag" href="<%- url_for(t.path) %>">#<%= t.name %></a>
          <% }); %>
        </div>
        <% } %>

        <nav class="post-pager" aria-label="post navigation">
          <% if (page.prev) { %>
            <a class="post-pager-item post-pager-prev" href="<%- url_for(page.prev.path) %>">
              <span class="post-pager-label"><%= __('post.prev') %></span>
              <span class="post-pager-title"><%= page.prev.title %></span>
            </a>
          <% } else { %>
            <span></span>
          <% } %>
          <% if (page.next) { %>
            <a class="post-pager-item post-pager-next" href="<%- url_for(page.next.path) %>">
              <span class="post-pager-label"><%= __('post.next') %></span>
              <span class="post-pager-title"><%= page.next.title %></span>
            </a>
          <% } %>
        </nav>

        <%- partial('_partial/comments') %>
      </div>
    </div>
  </div>
</article>
```

### `index.ejs` (homepage — where scroll animations go)
```ejs
<div class="container home-container">
  <div class="home-layout">
    <section class="home-posts" aria-label="Recent posts">
      <% if (page.posts && page.posts.length) { %>
        <% page.posts.each(function (post) { %>
          <%- partial('_partial/post-preview', { post: post }) %>
        <% }); %>
        <%- partial('_partial/pagination') %>
      <% } else { %>
        <p class="empty-state"><%= __('index.empty') %></p>
      <% } %>
    </section>
  </div>
</div>
```

### `post-preview.ejs` (individual card)
```ejs
<%
  const postPath = url_for(post.path);
  const authorName = (theme.author && theme.author.name) || config.author || 'Yoyo_Lee';
  const excerptLen = (theme.index && theme.index.excerpt_length) || 180;

  let blurb = '';
  if (post.excerpt) {
    blurb = post.excerpt.replace(/<[^>]+>/g, '').trim();
  } else if (post.description) {
    blurb = post.description.toString().trim();
  } else if (post.content) {
    blurb = post.content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }
  if (blurb.length > excerptLen) blurb = blurb.slice(0, excerptLen).trimEnd() + '…';
%>
<div class="post-preview">
  <a href="<%- postPath %>">
    <h2 class="post-title"><%= post.title %></h2>
    <% if (post.subtitle || post.description) { %>
      <h3 class="post-subtitle"><%= post.subtitle || post.description %></h3>
    <% } else if (blurb) { %>
      <h3 class="post-subtitle"><%= blurb %></h3>
    <% } %>
  </a>
  <p class="post-meta">
    <%= __('post.posted_by') %>
    <a href="<%- url_for('/about/') %>"><%= authorName %></a>
    <%= __('post.posted_on') %>
    <time datetime="<%= date_xml(post.date) %>"><%= date(post.date, config.date_format) %></time>
    <% if (post.categories && post.categories.length) { %>
      <span class="post-meta-sep">·</span>
      <% post.categories.each(function (cat) { %><a class="post-meta-cat" href="<%- url_for(cat.path) %>"><%= cat.name %></a><% }); %>
    <% } %>
  </p>
</div>
<hr class="post-divider" />
```

### `masthead.ejs` background logic (lines 43-53)
```ejs
function pickBg() {
  if (page.cover) return page.cover;
  if (page.top_img) return page.top_img;
  if (page.masthead) return page.masthead;
  if (is_post()) return masthead.post_bg || masthead.default_bg;
  if (page.type === 'about') return masthead.about_bg || masthead.default_bg;
  if (is_archive() || is_category() || is_tag() || page.type === 'categories' || page.type === 'tags') {
    return masthead.archive_bg || masthead.default_bg;
  }
  return masthead.default_bg || '/img/home-bg.svg';
}

const bg = pickBg();
```

The background is applied inline:
```ejs
<header class="masthead masthead-<%= kind %>"<% if (bg) { %> style="background-image: url('<%- url_for(bg) %>')"<% } %>>
```

### `_config.clean-blog.yml` masthead section
```yaml
masthead:
  default_bg: /img/home-bg.svg
  post_bg: /img/post-bg.svg
  about_bg: /img/about-bg.svg
  archive_bg: /img/post-bg.svg
```

### Current navbar state on scroll (JS lines 15-22)
```js
function updateNavState() {
  if (!nav) return;
  const shrinkThreshold = 60;
  const scrolled = window.scrollY > shrinkThreshold;
  nav.classList.toggle('is-shrunk', scrolled);
}
updateNavState();
window.addEventListener('scroll', updateNavState, { passive: true });
```

### Current navbar CSS when shrunk
```css
#mainNav.is-shrunk,
#mainNav.nav-solid {
  position: fixed;
  padding: .5rem 0;
  background-color: rgba(255,255,255,.78);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom-color: rgba(0,0,0,.08);
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
```

### Current `.col` width breakpoints
```css
/* At 768px: 83.333% */
/* At 992px: 66.666% */
/* At 1200px: 58.333% */
```

### Existing back-to-top button (CSS lines 1231-1250)
```css
.back-to-top {
  position: fixed;
  right: 1.5rem;
  bottom: 1.5rem;
  width: 2.75rem; height: 2.75rem;
  /* ... */
  z-index: 1040;
}
```

### Existing script structure (JS lines 1-10)
```js
(function () {
  'use strict';

  const nav = document.getElementById('mainNav');
  // ... everything inside this IIFE
})();
```
All your new JS code must go inside this same IIFE, preserving `'use strict'` mode.
</current_code_reference>

<implementation_constraints>
## Hard Constraints — Do NOT Violate These

1. **Zero new dependencies**: No npm packages, no CDN libraries, no frameworks. Vanilla CSS and vanilla JS only. Triple-check every line of code you write.
2. **No breaking changes**: The existing navbar shrink, reading progress bar, back-to-top button, search functionality, code copy buttons, tag cloud physics, Giscus comments, Prism highlighting, and KaTeX rendering must all continue working exactly as they do now.
3. **Single CSS file**: Add all new styles to `clean-blog.css`. Do NOT create a new CSS file unless you have a compelling technical reason (state it explicitly if so).
4. **Single JS file**: Add all new JS to `clean-blog.js` inside the existing IIFE. Do NOT create a new JS file. Maintain `'use strict'`.
5. **Responsive**: Every feature must work on mobile (320px), tablet (768px), and desktop (1200px+). Test your mental model at each breakpoint.
6. **Accessible**: TOC must be keyboard-navigable. Animations must respect `prefers-reduced-motion`. Use semantic HTML (nav, aside, button, etc.) and appropriate ARIA attributes where they add value.
7. **Performance**: No scroll event listeners for animations (use Intersection Observer). No forced synchronous layouts. Use `will-change` sparingly and only where profiling would justify it. Debounce or throttle resize handlers.
8. **No inline styles** (except the masthead background-image which is already inline via EJS — maintain that pattern for the background but nowhere else).
9. **Preserve EJS template logic**: Don't change how `is_post()`, `is_home()`, `url_for()`, `__()`, `partial()` etc. work.
10. **Do NOT over-engineer**: If a simpler solution achieves the same Apple-quality result, prefer it. Don't build an elaborate state machine when a CSS class toggle will do.
</implementation_constraints>

<output_specification>
## What You Must Produce — Output Format

Deliver your complete solution in this exact order:

### Section 1: Implementation Plan (thinking aloud)
Walk through your implementation strategy in prose. Explain:
- The layout change for the TOC sidebar (how you'll modify the grid/row/col structure)
- How you'll generate heading IDs and build the TOC DOM from JS
- The Intersection Observer strategy for both TOC tracking and card animations
- The parallax approach for the masthead
- The order of implementation and any dependencies between features

### Section 2: EJS Template Changes
For each file you modify, show the COMPLETE final file content. Do not use "..." or "rest stays the same" — I need to be able to copy-paste the entire file. Files to modify:
- `layout.ejs` (if needed for new body classes or structure)
- `post.ejs` (TOC sidebar structure)
- `index.ejs` (if needed for animation classes)
- `_partial/post-preview.ejs` (if adding data attributes or wrapper classes)
- `_partial/masthead.ejs` (if modifying background logic)
- Any NEW partial files (e.g., `_partial/toc.ejs`)
- Any other EJS files that need changes

### Section 3: CSS Additions
Provide the EXACT CSS to append to `clean-blog.css`. Include:
- All TOC sidebar/overlay styles (desktop and mobile)
- Toggle button styles
- Scroll animation styles (`.post-preview` initial/visible states, reduced-motion override)
- Masthead parallax styles
- Any new utility classes or modifications to existing selectors
- All responsive breakpoint overrides
- Include clear section comments matching the existing style (e.g., `/* ============ TOC Sidebar ============ */`)

### Section 4: JavaScript Additions
Provide the EXACT JavaScript to add to `clean-blog.js` inside the existing IIFE. Include:
- TOC generation function (extract headings, inject IDs, build DOM)
- TOC toggle logic (mobile button + overlay)
- Intersection Observer for active heading tracking
- Intersection Observer for post-preview scroll animations
- Masthead parallax effect
- Reduced motion detection
- Include clear section comments matching the existing style

### Section 5: Configuration Changes
Show the exact changes to `_config.clean-blog.yml` (or `_config.yml` if needed).

### Section 6: Image Recommendations
Provide:
- 4 specific Unsplash photo URLs (or Unsplash direct image URLs) for home, post, about, and archive mastheads
- Search terms for finding similar images
- Instructions for downloading and hosting the images locally (since this is a static site)

### Section 7: Testing Checklist
A bulleted list of manual tests the developer should perform after applying your changes.
</output_specification>

<apple_specific_guidance>
## Apple-Style CSS Values to Use

When writing CSS, bias toward these specific values for an authentic Apple feel:

**Transitions**:
- Standard: `0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- Entrance (fade in): `0.5s cubic-bezier(0.2, 0, 0, 1)`
- Exit: `0.25s cubic-bezier(0.4, 0, 1, 1)`
- Spring-like (for toggle buttons): `0.35s cubic-bezier(0.34, 1.56, 0.64, 1)`

**Blur/Backdrop**:
- Panels/overlays: `backdrop-filter: blur(24px) saturate(180%)`
- Lighter surfaces: `backdrop-filter: blur(12px) saturate(160%)`

**Shadows**:
- Subtle elevation: `0 1px 3px rgba(0,0,0,0.04)`
- Medium elevation (dropdowns, drawers): `0 8px 32px rgba(0,0,0,0.12)`
- High elevation: `0 16px 48px rgba(0,0,0,0.16)`

**Border radius**:
- Small elements: `4px` (matches existing)
- Cards/panels: `8px`
- Buttons/pills: `999px` (matches existing)
- Drawer/modal: `12px` (top corners only for bottom sheet on mobile)

**Colors** (extending existing palette):
- Primary teal: `#0085a1`
- Teal hover: `#00657b`
- Ink/text: `#212529`
- Secondary text: `#6c757d`
- Tertiary text: `#adb5bd`
- Border subtle: `rgba(0,0,0,0.08)`
- Border medium: `rgba(0,0,0,0.12)`
- Overlay dark: `rgba(33,37,41,0.5)` (matches existing masthead overlay)
- Surface frosted: `rgba(255,255,255,0.78)` (matches existing shrunk navbar)

**Typography for TOC**:
- Font family: system font stack (not Lora — the TOC is UI, not reading content)
- Size: `0.82rem` for h2 items, `0.76rem` for h3 items
- Weight: `500` normal, `600` active
- Line height: `1.4`
- Letter spacing: `-0.01em`

**Z-index layers** (be very careful here):
- Navbar: `1039` (existing)
- Back-to-top: `1040` (existing)
- TOC floating button (mobile): `1038` (below back-to-top so they don't conflict)
- TOC overlay/drawer (mobile): `1045` (above navbar when open)
- Reading progress bar: `2000` (existing, fine as-is)
</apple_specific_guidance>

<final_reminder>
Before you write a single line of code, think through these questions silently:

1. How will the post.ejs layout change to accommodate a sidebar? The current `.col` uses flexbox percentage widths. Should you switch to CSS Grid for the article container? Or add a sidebar column alongside the existing `.col`?
2. Where exactly in the DOM will the TOC live? Should it be rendered by EJS (server-side) or built by JS (client-side)? Consider: the headings are inside `<%- page.content %>` which is raw HTML — EJS cannot parse it. Therefore, heading extraction MUST happen in JS.
3. How will you handle the TOC floating button position relative to the back-to-top button? They should not overlap.
4. How will the masthead parallax interact with the existing `background-size: cover`? Consider using a scale transform on the masthead element itself.
5. Does the scroll animation CSS default to visible (for no-JS fallback)?
6. Have you checked that every new CSS selector is scoped properly so it doesn't affect non-article pages?

Now produce the complete solution. Every file, every line, production-ready.
</final_reminder>
