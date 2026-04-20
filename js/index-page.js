(function () {
  const DEFAULTS = {
    backgroundColor: '#f5f2ec',
    textColor: '#1a1814',
    fontPrimary: 'Cormorant Garant',
    fontSecondary: 'Inter',
    fontPrimaryWeight: 300,
    fontSecondaryWeight: 300,
    fontPrimaryItalic: false,
    fontSecondaryItalic: false,
    sizeBannerTitle: 100,
    sizeBannerSubtitle: 100,
    sizeBio: 100,
    sizePubs: 100,
    sizeTalks: 100,
    sizePhotoIntro: 100,
    sizeLabels: 100,
    sizeFooter: 100,
    bioLineHeight: 178,
    heroStyle: 'e',
  };

  const FONT_CSS = {
    'EB Garamond': "'EB Garamond', serif",
    'New Computer Modern': "'New Computer Modern', serif",
    'Libre Baskerville': "'Libre Baskerville', serif",
    'Playfair Display': "'Playfair Display', serif",
    'Cormorant Garant': "'Cormorant Garant', serif",
    'Spectral': "'Spectral', serif",
    'Lato': "'Lato', sans-serif",
    'Inter': "'Inter', sans-serif",
    'Source Sans Pro': "'Source Sans 3', sans-serif",
    'DM Mono': "'DM Mono', monospace",
  };

  function setMultilineText(el, value) {
    if (!el || value == null) return;
    const lines = String(value).split(/\n/);
    el.replaceChildren();
    lines.forEach((line, index) => {
      if (index > 0) el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(line));
    });
  }

  function applyColors(bgColor, textColor, logoVariant) {
    const root = document.documentElement;
    const bg = bgColor || DEFAULTS.backgroundColor;
    const ink = textColor || DEFAULTS.textColor;

    root.style.setProperty('--page-bg', bg);
    document.body.style.background = bg;
    root.style.setProperty('--page-ink', ink);

    const hex = ink.replace('#', '');
    const bgHex = bg.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const br = parseInt(bgHex.slice(0, 2), 16) || 245;
    const bg2 = parseInt(bgHex.slice(2, 4), 16) || 242;
    const bb = parseInt(bgHex.slice(4, 6), 16) || 236;
    const mix = (value, target, alpha) => Math.round(value * alpha + target * (1 - alpha));

    root.style.setProperty('--page-ink2', `rgb(${mix(r, br, 0.7)},${mix(g, bg2, 0.7)},${mix(b, bb, 0.7)})`);
    root.style.setProperty('--page-ink3', `rgb(${mix(r, br, 0.45)},${mix(g, bg2, 0.45)},${mix(b, bb, 0.45)})`);
    root.style.setProperty('--page-rule', `rgb(${mix(r, br, 0.18)},${mix(g, bg2, 0.18)},${mix(b, bb, 0.18)})`);

    if (logoVariant !== undefined) {
      document.querySelectorAll('.logo-mark').forEach((img) => {
        img.style.filter = logoVariant === 'dark' ? 'invert(1) brightness(0)' : 'none';
      });
    }
  }

  function applyTypography(settings) {
    const root = document.documentElement;
    root.style.setProperty('--font-primary', FONT_CSS[settings.fontPrimary] || settings.fontPrimary || FONT_CSS[DEFAULTS.fontPrimary]);
    root.style.setProperty('--font-secondary', FONT_CSS[settings.fontSecondary] || settings.fontSecondary || FONT_CSS[DEFAULTS.fontSecondary]);
    root.style.setProperty('--wt-primary', settings.fontPrimaryWeight ?? DEFAULTS.fontPrimaryWeight);
    root.style.setProperty('--wt-secondary', settings.fontSecondaryWeight ?? DEFAULTS.fontSecondaryWeight);
    root.style.setProperty('--fs-primary', settings.fontPrimaryItalic ? 'italic' : 'normal');
    root.style.setProperty('--fs-secondary', settings.fontSecondaryItalic ? 'italic' : 'normal');
    root.style.setProperty('--sz-banner-title', (settings.sizeBannerTitle ?? DEFAULTS.sizeBannerTitle) / 100);
    root.style.setProperty('--sz-banner-sub', (settings.sizeBannerSubtitle ?? DEFAULTS.sizeBannerSubtitle) / 100);
    root.style.setProperty('--sz-bio', (settings.sizeBio ?? DEFAULTS.sizeBio) / 100);
    root.style.setProperty('--sz-pubs', (settings.sizePubs ?? DEFAULTS.sizePubs) / 100);
    root.style.setProperty('--sz-talks', (settings.sizeTalks ?? DEFAULTS.sizeTalks) / 100);
    root.style.setProperty('--sz-photo', (settings.sizePhotoIntro ?? DEFAULTS.sizePhotoIntro) / 100);
    root.style.setProperty('--sz-labels', (settings.sizeLabels ?? DEFAULTS.sizeLabels) / 100);
    root.style.setProperty('--sz-footer', (settings.sizeFooter ?? DEFAULTS.sizeFooter) / 100);
    root.style.setProperty('--lh-bio', (settings.bioLineHeight ?? DEFAULTS.bioLineHeight) / 100);
  }

  function applyHeroStyle(style) {
    ['hero-a', 'hero-b', 'hero-c', 'hero-d', 'hero-e'].forEach((className) => document.body.classList.remove(className));
    const normalized = (style || DEFAULTS.heroStyle).toLowerCase();
    document.body.classList.add(`hero-${normalized}`);
  }

  function renderPubList(id, pubs) {
    const ul = document.getElementById(id);
    if (!ul || !pubs.length) return;
    ul.replaceChildren();

    pubs.forEach((pub) => {
      const li = document.createElement('li');
      const year = document.createElement('span');
      year.className = 'pub-year';
      year.textContent = pub.year || '';

      const titleWrap = document.createElement('span');
      titleWrap.className = 'pub-title';

      if (pub.link) {
        const a = document.createElement('a');
        a.href = pub.link;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = pub.title || '';
        titleWrap.appendChild(a);
      } else {
        titleWrap.appendChild(document.createTextNode(pub.title || ''));
      }

      if (pub.forthcoming) {
        const tag = document.createElement('span');
        tag.className = 'pub-tag';
        tag.textContent = 'forthcoming';
        titleWrap.appendChild(document.createTextNode(' '));
        titleWrap.appendChild(tag);
      }

      if (pub.venue) {
        const venue = document.createElement('span');
        venue.className = 'pub-venue';
        venue.textContent = pub.venue;
        titleWrap.appendChild(document.createTextNode(' '));
        titleWrap.appendChild(venue);
      }

      li.appendChild(year);
      li.appendChild(titleWrap);
      ul.appendChild(li);
    });
  }

  function renderTalkList(id, talks) {
    const ul = document.getElementById(id);
    if (!ul || !talks.length) return;
    ul.replaceChildren();

    talks.forEach((talk) => {
      const li = document.createElement('li');
      const year = document.createElement('span');
      year.className = 'talk-year';
      year.textContent = talk.year || '';

      const body = document.createElement('span');
      body.appendChild(document.createTextNode(talk.title || ''));

      if (talk.upcoming) {
        const tag = document.createElement('span');
        tag.className = 'pub-tag';
        tag.textContent = 'upcoming';
        body.appendChild(document.createTextNode(' '));
        body.appendChild(tag);
      }

      if (talk.talkType && talk.talkType !== 'regular') {
        const tag = document.createElement('span');
        tag.className = 'pub-tag';
        tag.textContent = talk.talkType;
        body.appendChild(document.createTextNode(' '));
        body.appendChild(tag);
      }

      if (talk.venue) {
        const venue = document.createElement('span');
        venue.className = 'talk-venue';
        venue.textContent = talk.venue;
        body.appendChild(document.createTextNode(' '));
        body.appendChild(venue);
      }

      li.appendChild(year);
      li.appendChild(body);
      ul.appendChild(li);
    });
  }

  async function loadSite() {
    applyColors(DEFAULTS.backgroundColor, DEFAULTS.textColor, 'light');
    applyTypography(DEFAULTS);
    applyHeroStyle(DEFAULTS.heroStyle);

    if (!CF.isConnected()) return;

    try {
      const key = CF.cfg().settingsKey;
      const [contentItems, settingsItems, pubs, talks] = await Promise.all([
        CF.get('siteContent', { 'fields.key': key }),
        CF.get('siteSettings', { 'fields.key': key }),
        CF.get('publication', { order: '-fields.year,-fields.order' }),
        CF.get('talk', { order: '-fields.year,-fields.order' }),
      ]);

      const content = contentItems?.[0] || {};
      const settings = settingsItems?.[0] || {};

      if (content.nameplateSubtitle) {
        const el = document.getElementById('nameplateSubtitle');
        if (el) el.textContent = content.nameplateSubtitle;
      }
      setMultilineText(document.getElementById('bioText'), content.bioText);
      if (content.photoIntro) {
        const photoIntro = document.getElementById('photoIntro');
        if (photoIntro) photoIntro.textContent = content.photoIntro;
      }
      setMultilineText(document.getElementById('contactInfo'), content.contactInfo);

      if (content.heroPosX !== undefined && content.heroPosY !== undefined) {
        document.documentElement.style.setProperty('--hero-pos', `${content.heroPosX}% ${content.heroPosY}%`);
      }

      applyTypography({
        ...DEFAULTS,
        ...content,
        fontPrimary: settings.fontPrimary || content.fontPrimary || DEFAULTS.fontPrimary,
        sizeBio: settings.fontSizeBio ?? content.sizeBio ?? DEFAULTS.sizeBio,
        sizePubs: settings.fontSizePubs ?? content.sizePubs ?? DEFAULTS.sizePubs,
      });

      applyColors(
        settings.backgroundColor || DEFAULTS.backgroundColor,
        settings.textColor || DEFAULTS.textColor,
        content.logoVariant || 'light'
      );
      applyHeroStyle(content.heroStyle || DEFAULTS.heroStyle);

      const heroImage = document.getElementById('heroBannerImg');
      if (heroImage && settings.heroBanner) heroImage.src = settings.heroBanner;

      const articlePubs = (pubs || []).filter((pub) => pub.pubType === 'article' || !pub.pubType);
      const chapterPubs = (pubs || []).filter((pub) => pub.pubType === 'chapter');
      renderPubList('pubListArticles', articlePubs);
      renderPubList('pubListChapters', chapterPubs);
      const chaptersSection = document.getElementById('pubChaptersSection');
      if (chaptersSection && !chapterPubs.length) chaptersSection.style.display = 'none';

      renderTalkList('talkList', talks || []);
    } catch (error) {
      console.warn('Content load error', error);
    }
  }

  function initContactForm() {
    const form = document.getElementById('contactForm');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = document.getElementById('cfSubmit');
      if (button) {
        button.disabled = true;
        button.textContent = 'Sending…';
      }

      try {
        await fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(new FormData(form)).toString(),
        });
        form.style.display = 'none';
        const success = document.getElementById('formSuccess');
        if (success) success.style.display = 'block';
      } catch (error) {
        if (button) {
          button.disabled = false;
          button.textContent = 'Send →';
        }
        alert('Something went wrong — please try again.');
      }
    });
  }

  document.addEventListener('contextmenu', (event) => {
    if (event.target.tagName === 'IMG') event.preventDefault();
  });
  document.addEventListener('dragstart', (event) => {
    if (event.target.tagName === 'IMG') event.preventDefault();
  });

  initContactForm();
  loadSite();
})();
