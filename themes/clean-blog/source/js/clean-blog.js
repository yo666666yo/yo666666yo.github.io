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
    const searchPageUrl = searchForm.getAttribute('data-search-page-url') || '/search/';
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

    function goToSearchPage(query) {
      const target = new URL(searchPageUrl, window.location.origin);
      if (query) target.searchParams.set('q', query);
      window.location.href = target.pathname + target.search;
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

      searchResults.innerHTML = items.map(function (item) {
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
      goToSearchPage(searchInput.value.trim());
    });

    document.addEventListener('click', function (event) {
      if (!searchForm.contains(event.target)) closeSearchResults();
    });
  }

  // --- full search page ---
  const searchPage = document.querySelector('[data-search-page]');
  if (searchPage) {
    const pageInput = searchPage.querySelector('.search-page-input');
    const pageResults = searchPage.querySelector('[data-search-page-results]');
    const pageStatus = searchPage.querySelector('[data-search-page-status]');
    const pageForm = searchPage.querySelector('.search-page-form');
    const pageSearchUrl = searchPage.getAttribute('data-search-url') || '/search.xml';
    const pageLoadingText = searchPage.getAttribute('data-loading') || 'Searching...';
    const pageEmptyText = searchPage.getAttribute('data-empty') || 'Enter a keyword to search.';
    const pageNoResultsText = searchPage.getAttribute('data-no-results') || 'No matching posts';
    const pageErrorText = searchPage.getAttribute('data-error') || 'Search index is unavailable';
    let pageSearchIndexPromise = null;
    let latestPageQuery = '';

    function pageEscapeHtml(value) {
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

    function pageNormalize(value) {
      return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function pageStripHtml(value) {
      const div = document.createElement('div');
      div.innerHTML = value || '';
      return div.textContent || div.innerText || '';
    }

    function pageReadText(entry, selector) {
      const node = entry.querySelector(selector);
      return node ? node.textContent.trim() : '';
    }

    function pageReadList(entry, selector) {
      return Array.prototype.slice.call(entry.querySelectorAll(selector)).map(function (node) {
        return node.textContent.trim();
      }).filter(Boolean);
    }

    function loadPageSearchIndex() {
      if (pageSearchIndexPromise) return pageSearchIndexPromise;

      pageSearchIndexPromise = fetch(pageSearchUrl, { cache: 'force-cache' })
        .then(function (response) {
          if (!response.ok) throw new Error('Failed to load search index');
          return response.text();
        })
        .then(function (xmlText) {
          const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
          return Array.prototype.slice.call(xml.querySelectorAll('entry')).map(function (entry) {
            const linkNode = entry.querySelector('link');
            const title = pageReadText(entry, 'title');
            const url = pageReadText(entry, 'url') || (linkNode ? linkNode.getAttribute('href') : '#') || '#';
            const content = pageStripHtml(pageReadText(entry, 'content'));
            const categories = pageReadList(entry, 'categories category');
            const tags = pageReadList(entry, 'tags tag');
            const meta = categories.concat(tags).join(' / ');

            return {
              title: title,
              url: url,
              content: content,
              meta: meta,
              searchText: pageNormalize([title, content, meta].join(' '))
            };
          });
        });

      return pageSearchIndexPromise;
    }

    function makePageExcerpt(item, terms) {
      const source = item.content || item.title;
      const lowerSource = source.toLowerCase();
      let firstMatch = -1;

      terms.forEach(function (term) {
        const index = lowerSource.indexOf(term);
        if (index !== -1 && (firstMatch === -1 || index < firstMatch)) {
          firstMatch = index;
        }
      });

      const start = firstMatch > 70 ? firstMatch - 70 : 0;
      const excerpt = source.slice(start, start + 180).replace(/\s+/g, ' ').trim();
      return (start > 0 ? '...' : '') + excerpt + (source.length > start + 180 ? '...' : '');
    }

    function scorePageItem(item, terms) {
      const title = pageNormalize(item.title);
      const meta = pageNormalize(item.meta);
      let score = 0;

      terms.forEach(function (term) {
        if (title.indexOf(term) !== -1) score += 12;
        if (meta.indexOf(term) !== -1) score += 6;
        if (item.searchText.indexOf(term) !== -1) score += 2;
      });

      return score;
    }

    function setPageStatus(text) {
      pageStatus.textContent = text;
    }

    function renderPageResults(items, terms, query) {
      if (!items.length) {
        setPageStatus(pageNoResultsText);
        pageResults.innerHTML = '';
        return;
      }

      setPageStatus('找到 ' + items.length + ' 篇与“' + query + '”相关的文章');
      pageResults.innerHTML = items.map(function (item) {
        const excerpt = makePageExcerpt(item, terms);
        return [
          '<article class="search-page-result">',
          '<a class="search-page-result-title" href="', pageEscapeHtml(item.url), '">', pageEscapeHtml(item.title), '</a>',
          excerpt ? '<p class="search-page-result-excerpt">' + pageEscapeHtml(excerpt) + '</p>' : '',
          item.meta ? '<div class="search-page-result-meta">' + pageEscapeHtml(item.meta) + '</div>' : '',
          '</article>'
        ].join('');
      }).join('');
    }

    function runPageSearch(query) {
      latestPageQuery = query;
      const normalizedQuery = pageNormalize(query);
      const terms = normalizedQuery.split(' ').filter(Boolean);

      if (!terms.length) {
        setPageStatus(pageEmptyText);
        pageResults.innerHTML = '';
        return;
      }

      setPageStatus(pageLoadingText);
      loadPageSearchIndex()
        .then(function (index) {
          if (latestPageQuery !== query) return;
          const matches = index.filter(function (item) {
            return terms.every(function (term) {
              return item.searchText.indexOf(term) !== -1;
            });
          }).map(function (item) {
            return { item: item, score: scorePageItem(item, terms) };
          }).sort(function (a, b) {
            return b.score - a.score;
          }).map(function (match) {
            return match.item;
          });

          renderPageResults(matches, terms, query);
        })
        .catch(function () {
          setPageStatus(pageErrorText);
          pageResults.innerHTML = '';
        });
    }

    pageForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const query = pageInput.value.trim();
      const target = new URL(window.location.href);
      if (query) target.searchParams.set('q', query);
      else target.searchParams.delete('q');
      window.history.pushState({}, '', target.pathname + target.search);
      runPageSearch(query);
    });

    window.addEventListener('popstate', function () {
      const query = (new URLSearchParams(window.location.search).get('q') || '').trim();
      pageInput.value = query;
      runPageSearch(query);
    });

    const initialQuery = (new URLSearchParams(window.location.search).get('q') || '').trim();
    pageInput.value = initialQuery;
    runPageSearch(initialQuery);
  }

  // --- tag cloud hover collisions ---
  document.querySelectorAll('.tag-cloud-figure').forEach(function (figure) {
    const svg = figure.querySelector('.tag-cloud-svg');
    const links = Array.prototype.slice.call(figure.querySelectorAll('[data-tag-cloud-word]'));
    if (!svg || links.length < 2) return;

    const words = links.map(function (link, fallbackIndex) {
      return {
        link: link,
        body: link.querySelector('.tag-cloud-word'),
        x: parseFloat(link.getAttribute('data-cloud-x')) || 0,
        y: parseFloat(link.getAttribute('data-cloud-y')) || 0,
        width: parseFloat(link.getAttribute('data-cloud-width')) || 0,
        height: parseFloat(link.getAttribute('data-cloud-height')) || 0,
        index: parseInt(link.getAttribute('data-cloud-index') || fallbackIndex, 10)
      };
    }).filter(function (word) {
      return word.body;
    });
    if (words.length < 2) return;

    let activeWord = null;

    function setWordTransform(word, dx, dy, scale) {
      if (!word.body) return;
      if (!dx && !dy && (!scale || scale === 1)) {
        word.body.style.transform = '';
        return;
      }

      const nextScale = scale || 1;
      word.body.style.transform = 'translate(' + dx.toFixed(2) + 'px, ' + dy.toFixed(2) + 'px) scale(' + nextScale.toFixed(3) + ')';
    }

    function readRise(word) {
      const raw = window.getComputedStyle(word.link).getPropertyValue('--tcf-rise');
      return parseFloat(raw) || 8;
    }

    function makeRect(word, move, target) {
      const isTarget = word === target;
      const scale = isTarget ? 1.075 : (move.scale || 1);
      const rise = isTarget ? readRise(word) : 0;
      const width = word.width * scale + 6;
      const height = word.height * scale + 6 + rise * 1.7;
      const centerX = word.x + move.dx;
      const centerY = word.y + move.dy - rise * 0.9;

      return {
        left: centerX - width / 2,
        right: centerX + width / 2,
        top: centerY - height / 2,
        bottom: centerY + height / 2,
        centerX: centerX,
        centerY: centerY,
        width: width,
        height: height
      };
    }

    function resolveOverlaps(moves, target) {
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;

        for (let i = 0; i < words.length; i++) {
          for (let j = i + 1; j < words.length; j++) {
            const first = words[i];
            const second = words[j];
            const firstRect = makeRect(first, moves[i], target);
            const secondRect = makeRect(second, moves[j], target);
            const overlapX = Math.min(firstRect.right, secondRect.right) - Math.max(firstRect.left, secondRect.left);
            const overlapY = Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top);

            if (overlapX <= 0 || overlapY <= 0) continue;

            const firstFixed = first === target;
            const secondFixed = second === target;
            if (firstFixed && secondFixed) continue;

            const gap = 2;
            const alongX = overlapX < overlapY;
            let sign = alongX
              ? (secondRect.centerX >= firstRect.centerX ? 1 : -1)
              : (secondRect.centerY >= firstRect.centerY ? 1 : -1);
            if (sign === 0) sign = ((first.index + second.index) % 2) ? 1 : -1;
            const amount = (alongX ? overlapX : overlapY) + gap;

            if (firstFixed || secondFixed) {
              const movingIndex = firstFixed ? j : i;
              const direction = firstFixed ? sign : -sign;
              if (alongX) {
                moves[movingIndex].dx += direction * amount;
              } else {
                moves[movingIndex].dy += direction * amount;
              }
            } else {
              if (alongX) {
                moves[i].dx -= sign * amount * 0.5;
                moves[j].dx += sign * amount * 0.5;
              } else {
                moves[i].dy -= sign * amount * 0.5;
                moves[j].dy += sign * amount * 0.5;
              }
            }

            changed = true;
          }
        }

        if (!changed) break;
      }
    }

    function resetCloud() {
      activeWord = null;
      figure.classList.add('is-resetting');
      figure.classList.remove('is-colliding');
      words.forEach(function (word) {
        word.link.classList.remove('is-active', 'is-repelled');
        setWordTransform(word, 0, 0, 1);
      });
      figure.offsetWidth;
      figure.classList.remove('is-resetting');
    }

    function pushFrom(target) {
      activeWord = target;
      figure.classList.add('is-colliding');
      const targetRise = readRise(target);
      const targetCenterY = target.y - targetRise * 1.15;
      const moves = words.map(function () {
        return { dx: 0, dy: 0, scale: 1 };
      });

      words.forEach(function (word, index) {
        word.link.classList.remove('is-active', 'is-repelled');

        if (word === target) {
          word.link.classList.add('is-active');
          return;
        }

        const dx = word.x - target.x;
        const dy = word.y - targetCenterY;
        const influenceX = Math.max(120, target.width * 0.9 + word.width * 0.5 + 72);
        const influenceY = Math.max(96, target.height * 1.35 + word.height * 0.8 + targetRise * 2 + 56);
        const normalizedX = dx / influenceX;
        const normalizedY = dy / influenceY;
        const normalizedDistance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);

        if (normalizedDistance >= 1.12) {
          return;
        }

        const rawDistance = Math.sqrt(dx * dx + dy * dy);
        const fallbackAngle = word.index * 2.399963229728653 + 0.45;
        const unitX = rawDistance > 0.01 ? dx / rawDistance : Math.cos(fallbackAngle);
        const unitY = rawDistance > 0.01 ? dy / rawDistance : Math.sin(fallbackAngle);
        const strength = Math.pow((1.12 - normalizedDistance) / 1.12, 1.35);
        const push = 4 + strength * (14 + Math.min(10, target.width * 0.06));
        moves[index].dx = unitX * push * 0.7;
        moves[index].dy = unitY * push * 0.55;
      });

      resolveOverlaps(moves, target);

      words.forEach(function (word, index) {
        const move = moves[index];
        if (word === target) {
          return;
        }

        if (Math.abs(move.dx) > 0.6 || Math.abs(move.dy) > 0.6) {
          word.link.classList.add('is-repelled');
        }
        setWordTransform(word, move.dx, move.dy, move.scale);
      });
    }

    words.forEach(function (word) {
      word.link.addEventListener('pointerenter', function () {
        pushFrom(word);
      });

      word.link.addEventListener('focus', function () {
        pushFrom(word);
      });

      word.link.addEventListener('blur', function () {
        resetCloud();
      });
    });

    figure.addEventListener('pointerleave', resetCloud);
    window.addEventListener('blur', resetCloud);

    if (activeWord) pushFrom(activeWord);
  });

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
