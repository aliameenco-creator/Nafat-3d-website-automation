// Plays YouTube videos inside the page. A thumbnail (.yt, from videoHtml) turns into the player when pressed,
// and any other link to that video in the text scrolls to it and plays it. Links to videos that are not on
// the page are left to VideoModal, which opens them in a popup. Ctrl/Cmd-click still opens YouTube.

function play(box: HTMLElement) {
  if (box.classList.contains('on')) return;
  const id = box.dataset.yt!;
  const frame = document.createElement('iframe');
  frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1`;
  frame.title = box.querySelector('img')?.alt || 'YouTube video';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.allowFullscreen = true;
  box.replaceChildren(frame);
  box.classList.add('on');
}

// Capture phase, so this runs before VideoModal's handler and can stop it for videos that are on the page.
document.addEventListener(
  'click',
  (e) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-video]');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const box = document.querySelector<HTMLElement>(`.yt[data-yt="${CSS.escape(link.dataset.video!)}"]`);
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    if (!box.contains(link)) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    play(box);
  },
  true,
);
