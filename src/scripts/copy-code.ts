// Adds a bar with a Copy button to every code block. Resources put prompts in code blocks, so visitors can
// copy a prompt in one click; a container with data-label="Prompt" names them "Prompt 1", "Prompt 2"…

document.querySelectorAll<HTMLElement>('.prose pre').forEach((pre) => {
  if (pre.parentElement?.classList.contains('code-box')) return;
  const scope = pre.closest<HTMLElement>('[data-label]');
  const blocks = scope ? scope.querySelectorAll('pre') : [];
  const lang = pre.querySelector('code')?.className.match(/language-([\w-]+)/)?.[1];
  const name = scope?.dataset.label
    ? `${scope.dataset.label}${blocks.length > 1 ? ` ${Array.from(blocks).indexOf(pre) + 1}` : ''}`
    : lang && lang !== 'text'
      ? lang
      : 'Code';

  const box = document.createElement('div');
  box.className = 'code-box';
  const bar = document.createElement('div');
  bar.className = 'code-bar';
  const label = document.createElement('span');
  label.textContent = name;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Copy';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.innerText.replace(/\n$/, ''));
      button.textContent = 'Copied';
    } catch {
      // No clipboard access: select the text so it can be copied by hand.
      getSelection()?.selectAllChildren(pre);
      button.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => (button.textContent = 'Copy'), 1800);
  });
  bar.append(label, button);
  pre.replaceWith(box);
  box.append(bar, pre);
});
