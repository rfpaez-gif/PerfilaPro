(async () => {
  try {
    const res = await fetch('/.netlify/functions/legal-settings');
    if (!res.ok) return;
    const d = await res.json();

    const fill = (sel, val) => {
      document.querySelectorAll(sel).forEach(el => {
        if (val) { el.textContent = val; el.classList.remove('placeholder'); }
      });
    };

    fill('[data-legal="name"]',    d.legal_name);
    fill('[data-legal="nif"]',     d.legal_nif);
    fill('[data-legal="address"]', d.legal_address);
    fill('[data-legal="email"]',   d.legal_email);

    const emailLinks = document.querySelectorAll('[data-legal-href="email"]');
    emailLinks.forEach(el => {
      if (d.legal_email) el.href = `mailto:${d.legal_email}`;
    });
  } catch (_) {}
})();
