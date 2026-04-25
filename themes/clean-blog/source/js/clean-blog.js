/*
 * Clean Blog — small runtime niceties.
 * 1. Shrinks the navbar into a solid bar once the user scrolls past the hero.
 * 2. Toggles mobile menu open/closed.
 * 3. Paints a reading-progress bar along the top while on a post.
 * 4. Reveals a back-to-top button after the user scrolls down.
 */

(function () {
  'use strict';

  const nav = document.getElementById('mainNav');

  // --- navbar shrink on scroll ---
  function updateNavState() {
    if (!nav) return;
    const shrinkThreshold = 60;
    const scrolled = window.scrollY > shrinkThreshold;
    nav.classList.toggle('is-shrunk', scrolled);
  }
  updateNavState();
  window.addEventListener('scroll', updateNavState, { passive: true });

  // --- mobile menu toggle ---
  const toggler = document.querySelector('.navbar-toggler');
  const collapse = document.getElementById('navbarResponsive');
  if (toggler && collapse) {
    toggler.addEventListener('click', function () {
      const isOpen = collapse.classList.toggle('is-open');
      toggler.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  // --- local search ---
  const searchForm = document.querySelector('.site-search');
  if (searchForm) {
    const searchInput = searchForm.querySelector('.site-search-input');
    const searchResults = searchForm.querySelector('.site-search-results');
    const searchUrl = searchForm.getAttribute('data-search-url') || '/search.xml';
    const loadingText = searchForm.getAttribute('data-loading') || 'Searching...';
    const noResultsText = searchForm.getAttribute('data-no-results') || 'No matching posts';
    const errorText = searchForm.getAttribute('data-error') || 'Search index is unavailable';
    let searchIndexPromise = null;
    let searchTimer = null;
    let activeResultIndex = -1;
    let latestQuery = '';

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, function (char) {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[char];
      });
    }

    function normalize(value) {
      return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function stripHtml(value) {
      const div = document.createElement('div');
      div.innerHTML = value || '';
      return div.textContent || div.innerText || '';
    }

    function readText(entry, selector) {
      const node = entry.querySelector(selector);
      return node ? node.textContent.trim() : '';
    }

    function readList(entry, selector) {
      return Array.prototype.slice.call(entry.querySelectorAll(selector)).map(function (node) {
        return node.textContent.trim();
      }).filter(Boolean);
    }

    function loadSearchIndex() {
      if (searchIndexPromise) return searchIndexPromise;

      searchIndexPromise = fetch(searchUrl, { cache: 'force-cache' })
        .then(function (response) {
          if (!response.ok) throw new Error('Failed to load search index');
          return response.text();
        })
        .then(function (xmlText) {
          const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
          return Array.prototype.slice.call(xml.querySelectorAll('entry')).map(function (entry) {
            const linkNode = entry.querySelector('link');
            const title = readText(entry, 'title');
            const url = readText(entry, 'url') || (linkNode ? linkNode.getAttribute('href') : '#') || '#';
            const content = stripHtml(readText(entry, 'content'));
            const categories = readList(entry, 'categories category');
            const tags = readList(entry, 'tags tag');
            const meta = categories.concat(tags).join(' / ');

            return {
              title: title,
              url: url,
              content: content,
              meta: meta,
              searchText: normalize([title, content, meta].join(' '))
            };
          });
        });

      return searchIndexPromise;
    }

    function openSearchResults() {
      searchResults.hidden = false;
      searchInput.setAttribute('aria-expanded', 'true');
    }

    function closeSearchResults() {
      searchResults.hidden = true;
      searchInput.setAttribute('aria-expanded', 'false');
      activeResultIndex = -1;
    }

    function setSearchStatus(text) {
      searchResults.innerHTML = '<div class="site-search-status">' + escapeHtml(text) + '</div>';
      openSearchResults();
    }

    function makeExcerpt(item, terms) {
      const source = item.content || item.title;
      const lowerSource = source.toLowerCase();
      let firstMatch = -1;

      terms.forEach(function (term) {
        const index = lowerSource.indexOf(term);
        if (index !== -1 && (firstMatch === -1 || index < firstMatch)) {
          firstMatch = index;
        }
      });

      const start = firstMatch > 45 ? firstMatch - 45 : 0;
      const excerpt = source.slice(start, start + 120).replace(/\s+/g, ' ').trim();
      return (start > 0 ? '...' : '') + excerpt + (source.length > start + 120 ? '...' : '');
    }

    function scoreItem(item, terms) {
      const title = normalize(item.title);
      const meta = normalize(item.meta);
      let score = 0;

      terms.forEach(function (term) {
        if (title.indexOf(term) !== -1) score += 12;
        if (meta.indexOf(term) !== -1) score += 6;
        if (item.searchText.indexOf(term) !== -1) score += 2;
      });

      return score;
    }

    function updateActiveResult(nextIndex) {
      const links = Array.prototype.slice.call(searchResults.querySelectorAll('[data-search-result]'));
      if (!links.length) return;

      activeResultIndex = (nextIndex + links.length) % links.length;
      links.forEach(function (link, index) {
        const isActive = index === activeResultIndex;
        link.classList.toggle('is-active', isActive);
        link.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      links[activeResultIndex].scrollIntoView({ block: 'nearest' });
    }

    function renderSearchResults(items, terms) {
      if (!items.length) {
        setSearchStatus(noResultsText);
        return;
      }

      searchResults.innerHTML = items.slice(0, 8).map(function (item) {
        const excerpt = makeExcerpt(item, terms);
        return [
          '<a class="site-search-result" href="', escapeHtml(item.url), '" role="option" aria-selected="false" data-search-result>',
          '<span class="site-search-title">', escapeHtml(item.title), '</span>',
          excerpt ? '<span class="site-search-excerpt">' + escapeHtml(excerpt) + '</span>' : '',
          item.meta ? '<span class="site-search-meta">' + escapeHtml(item.meta) + '</span>' : '',
          '</a>'
        ].join('');
      }).join('');
      activeResultIndex = -1;
      openSearchResults();
    }

    function runSearch(query) {
      latestQuery = query;
      const normalizedQuery = normalize(query);
      const terms = normalizedQuery.split(' ').filter(Boolean);

      if (!terms.length) {
        closeSearchResults();
        return;
      }

      setSearchStatus(loadingText);
      loadSearchIndex()
        .then(function (index) {
          if (latestQuery !== query) return;
          const matches = index.filter(function (item) {
            return terms.every(function (term) {
              return item.searchText.indexOf(term) !== -1;
            });
          }).map(function (item) {
            return { item: item, score: scoreItem(item, terms) };
          }).sort(function (a, b) {
            return b.score - a.score;
          }).map(function (match) {
            return match.item;
          });

          renderSearchResults(matches, terms);
        })
        .catch(function () {
          setSearchStatus(errorText);
        });
    }

    searchInput.addEventListener('input', function () {
      window.clearTimeout(searchTimer);
      const query = searchInput.value.trim();
      if (!query) {
        closeSearchResults();
        return;
      }
      searchTimer = window.setTimeout(function () {
        runSearch(query);
      }, 120);
    });

    searchInput.addEventListener('focus', function () {
      const query = searchInput.value.trim();
      if (query) runSearch(query);
    });

    searchInput.addEventListener('keydown', function (event) {
      const links = Array.prototype.slice.call(searchResults.querySelectorAll('[data-search-result]'));
      if (event.key === 'Escape') {
        closeSearchResults();
        searchInput.blur();
        return;
      }
      if (!links.length) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        updateActiveResult(activeResultIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        updateActiveResult(activeResultIndex - 1);
      } else if (event.key === 'Enter' && activeResultIndex >= 0) {
        event.preventDefault();
        window.location.href = links[activeResultIndex].href;
      }
    });

    searchForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const firstResult = searchResults.querySelector('[data-search-result]');
      if (firstResult) {
        window.location.href = firstResult.href;
        return;
      }
      runSearch(searchInput.value.trim());
    });

    document.addEventListener('click', function (event) {
      if (!searchForm.contains(event.target)) closeSearchResults();
    });
  }

  // --- code block copy buttons ---
  function getCodeText(pre) {
    const code = pre.querySelector('code');
    if (!code) return pre.textContent || '';
    const clone = code.cloneNode(true);
    clone.querySelectorAll('.line-numbers-rows').forEach(function (row) {
      row.remove();
    });
    return clone.textContent.replace(/\n$/, '');
  }

  function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();

      try {
        const ok = document.execCommand('copy');
        textarea.remove();
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (err) {
        textarea.remove();
        reject(err);
      }
    });
  }

  document.querySelectorAll('.post-body pre').forEach(function (pre) {
    if (pre.closest('.code-block')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const language = (pre.getAttribute('data-language') || '').trim();
    if (language) {
      const label = document.createElement('span');
      label.className = 'code-language';
      label.textContent = language;
      wrapper.appendChild(label);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy-button';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码');
    wrapper.appendChild(button);

    button.addEventListener('click', function () {
      writeClipboard(getCodeText(pre)).then(function () {
        button.textContent = '已复制';
        button.classList.add('is-copied');
        window.setTimeout(function () {
          button.textContent = '复制';
          button.classList.remove('is-copied');
        }, 1400);
      }).catch(function () {
        button.textContent = '复制失败';
        window.setTimeout(function () {
          button.textContent = '复制';
        }, 1400);
      });
    });
  });

  // --- reading progress bar (posts only) ---
  if (document.body.classList.contains('is-post')) {
    const bar = document.createElement('div');
    bar.className = 'reading-progress';
    document.body.appendChild(bar);

    const updateProgress = function () {
      const docEl = document.documentElement;
      const scrollTop = window.scrollY || docEl.scrollTop;
      const scrollHeight = docEl.scrollHeight - docEl.clientHeight;
      const pct = scrollHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / scrollHeight) * 100)) : 0;
      bar.style.width = pct + '%';
    };
    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
  }

  // --- back-to-top ---
  const btt = document.createElement('a');
  btt.className = 'back-to-top';
  btt.href = '#page-top';
  btt.innerHTML = '↑';
  btt.setAttribute('aria-label', 'Back to top');
  document.body.appendChild(btt);

  const updateBtt = function () {
    btt.classList.toggle('is-visible', window.scrollY > 400);
  };
  updateBtt();
  window.addEventListener('scroll', updateBtt, { passive: true });

  btt.addEventListener('click', function (e) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
