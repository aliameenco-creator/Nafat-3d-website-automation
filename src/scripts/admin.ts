// Browser helpers shared by dashboard pages.

// The dashboard's secret address (see ADMIN_PATH), passed down by the Admin layout.
export const adminUrl = (path = '/') => (document.body.dataset.admin || '/admin') + path;

export function toast(message: string, bad = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(Number(el.dataset.t));
  el.dataset.t = String(window.setTimeout(() => el.classList.remove('show'), 2600));
}

// fetch wrapper: JSON in, JSON out, server errors thrown as Error(message).
export async function api<T = any>(url: string, method = 'GET', data?: unknown): Promise<T> {
  const isForm = data instanceof FormData;
  const res = await fetch(url, {
    method,
    headers: data && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: data === undefined ? undefined : isForm ? data : JSON.stringify(data),
  });
  if (res.status === 401) {
    location.href = adminUrl(`/login/?next=${encodeURIComponent(location.pathname)}`);
    throw new Error('Signed out');
  }
  const json = res.headers.get('content-type')?.includes('json') ? await res.json() : {};
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export async function copy(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast('Could not copy. Select the text and copy it yourself.', true);
  }
}

// Shrinks big photos in the browser before upload: max 2000px wide, WebP. Keeps GIF, SVG and small files as they are.
export async function prepareImage(file: File): Promise<{ file: File; width?: number; height?: number }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { file };
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { file };
  const scale = Math.min(1, 2000 / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  if (scale === 1 && file.size < 400_000) return { file, width, height };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.85));
  if (!blob || blob.size >= file.size) return { file, width, height };
  const name = file.name.replace(/\.[^.]+$/, '') + '.webp';
  return { file: new File([blob], name, { type: 'image/webp' }), width, height };
}

export async function uploadImage(file: File, alt = '') {
  const { file: f, width, height } = await prepareImage(file);
  const form = new FormData();
  form.append('file', f);
  form.append('alt', alt);
  if (width) form.append('width', String(width));
  if (height) form.append('height', String(height));
  const { media } = await api<{ media: { id: string; url: string; filename: string; alt: string } }>('/api/admin/media', 'POST', form);
  return media;
}

export function confirmDialog(message: string, action = 'Confirm', danger = true): Promise<boolean> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<p style="margin:0 0 4px;font-size:1rem"></p><div class="dialog-actions"><button class="b" value="no">Cancel</button><button class="b ${danger ? 'danger' : 'primary'}" value="yes"></button></div>`;
    d.querySelector('p')!.textContent = message;
    d.querySelector('[value=yes]')!.textContent = action;
    d.addEventListener('click', (e) => {
      const v = (e.target as HTMLButtonElement).value;
      if (v || e.target === d) {
        d.close();
        resolve(v === 'yes');
      }
    });
    d.addEventListener('close', () => (d.remove(), resolve(false)));
    document.body.append(d);
    d.showModal();
  });
}

export const timeAgo = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString();
};
