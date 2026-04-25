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
