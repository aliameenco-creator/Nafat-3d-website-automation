// Every piece of text the blog and resources sections show lives here.
// Nafay's homepage itself is public/index.html and is not driven by this file.

export const site = {
  name: 'Nafay 3D',
  url: 'https://nafay3d.com',
  tagline: 'AI tools, 3D and building income online',
  // One sentence used as the default meta description.
  description:
    'Nafay 3D: videos about AI tools, 3D and building income online. Free motion graphics styles for Claude, a weekly AI newsletter and more.',
  jobTitle: 'AI and 3D creator',
  // Replies to resource emails go here. Fill it in before turning on email (see README → Email).
  email: '',
  // Shown at the bottom of email broadcasts when filled in. Anti-spam laws like CAN-SPAM (US) expect
  // a postal address (a P.O. box is fine) in marketing emails, and most email tools require one.
  postalAddress: '',
};

// The weekly newsletter. Sign-ups from the resources are also copied into this Kit form (see KIT_FORM_ID).
export const newsletter = {
  name: "Nafay's AI Brief",
  url: 'https://nafay-s-ai-brief.kit.com/ea1f1b6f14',
  // The Kit form on the homepage. Every resource sign-up is copied into it.
  kitFormId: '10095875',
};

// Shown under every "get it free" form and saved with each sign-up as proof of what the person agreed to.
// If you change the wording, change the version too, so older sign-ups keep the wording they saw.
export const emailConsent = {
  version: '2026-11-15',
  text: `By continuing you agree to get emails from ${site.name} with free resources and ${newsletter.name}, a short weekly email on new AI tools. Unsubscribe anytime.`,
};

export const youtube = {
  handle: '@nafay3d',
  url: 'https://www.youtube.com/@nafay3d',
  channelId: 'UCu6dZ7Tvlhw1BkUUDWJngqw',
};

// Also feeds the Person schema "sameAs", which helps Google connect your profiles.
export const socials = [{ id: 'youtube', label: 'YouTube', handle: '@nafay3d', url: youtube.url }];

export const nav = [
  { label: 'Home', href: '/' },
  { label: 'Blog', href: '/blog/' },
  { label: 'Resources', href: '/resources/' },
];
