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
