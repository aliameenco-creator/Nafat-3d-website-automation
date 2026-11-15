// The "get it free" forms (markup from gateFormHtml). Sends the form without leaving the page, shows problems
// inline, suggests a fix for common email typos (gmial.com → gmail.com), and gives people who already signed up
// on this browser a one-click button instead of the form. Without JavaScript the form still posts normally.

const DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'live.com', 'aol.com', 'proton.me', 'protonmail.com', 'msn.com', 'ymail.com'];

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

function suggest(email: string) {
  const [user, domain] = email.trim().toLowerCase().split('@');
  if (!user || !domain || DOMAINS.includes(domain)) return null;
  const fixed = domain.replace(/\.(con|cmo|ocm|vom|comm)$/, '.com');
  const best = DOMAINS.map((d) => ({ d, n: distance(fixed, d) })).sort((a, b) => a.n - b.n)[0];
  if (best.n > 0 && best.n <= 2) return `${user}@${best.d}`;
  return fixed !== domain ? `${user}@${fixed}` : null;
}

const cookie = (name: string) => {
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
};

document.querySelectorAll<HTMLFormElement>('form[data-gate]').forEach((form) => {
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const error = form.querySelector<HTMLElement>('.gate-error')!;
  const hint = form.querySelector<HTMLElement>('.gate-hint')!;
  const name = form.elements.namedItem('name') as HTMLInputElement;
  const email = form.elements.namedItem('email') as HTMLInputElement;
  const open = form.dataset.open!;

  // Cards in blog posts: someone who signed up on this browser just opens the resource.
  const known = cookie('rk_n');
  if (known && form.closest('.res-card')) {
    const box = document.createElement('div');
    box.className = 'gate-known';
    box.innerHTML = '<p>Welcome back, <b></b>. It is free for you too.</p><a class="btn accent"></a><a class="not-you">Not you?</a>';
    box.querySelector('b')!.textContent = known;
    const go = box.querySelector<HTMLAnchorElement>('.btn')!;
    go.href = open;
    go.textContent = `Open the ${form.dataset.word ?? 'resource'}`;
    box.querySelector<HTMLAnchorElement>('.not-you')!.href = `${open}?forget=1`;
    form.hidden = true;
    form.after(box);
  }

  const show = (message: string, field?: HTMLInputElement) => {
    error.textContent = message;
    error.hidden = false;
    field?.focus();
  };

  email.addEventListener('blur', () => {
    const better = suggest(email.value);
    hint.hidden = !better;
    if (!better) return;
    hint.textContent = 'Did you mean ';
    const fix = document.createElement('button');
    fix.type = 'button';
    fix.textContent = better;
    fix.addEventListener('click', () => {
      email.value = better;
      hint.hidden = true;
    });
    hint.append(fix, '?');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    if (!name.value.trim()) return show('Please enter your name.', name);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) return show('Please enter a valid email address.', email);
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Unlocking…';
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      location.href = data.redirect;
    } catch (err) {
      show((err as Error).message);
      button.disabled = false;
      button.textContent = label;
    }
  });
});
