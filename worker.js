/**
 * Cloudflare Worker — himanshuanand.com
 *
 * Dynamic site: HTML is rendered from a template at request time.
 *   - Blog posts:     fetched from blog.himanshuanand.com/index.json (auto-updates)
 *   - Everything else: read from Cloudflare KV (update via ./update-content.sh)
 *   - Static files:    inlined (robots.txt, security.txt, etc.)
 *
 * To update content (talks, projects, patents, etc.):
 *   1. Edit content.json
 *   2. Run: ./update-content.sh
 *   3. Site updates within 60s
 *
 * Blog posts update automatically when you publish on your Hugo blog.
 */

// ─── Security Headers ───────────────────────────────────────────
const SEC = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '0',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' https://avatars.githubusercontent.com data:",
    "frame-src https://www.youtube.com https://challenges.cloudflare.com",
    "connect-src 'self' https://cloudflareinsights.com",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

// ─── Blog API Config ────────────────────────────────────────────
const BLOG_API = 'https://blog.himanshuanand.com/index.json';
const BLOG_CACHE_TTL = 3600;   // 1 hour
const KV_KEY = 'SITE_CONTENT';
const HTML_CACHE_TTL = 60;     // 1 min — fast updates after KV push

// ─── Static Files (inlined) ────────────────────────────────────
const STATIC = {
  '/robots.txt': { type: 'text/plain; charset=utf-8', cache: 86400, body: `# himanshuanand.com
# If you're reading this, you're my kind of person.

User-agent: *
Allow: /
Disallow: /api/
Disallow: /cdn-cgi/

User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: ClaudeBot
Disallow: /

# Welcome, human. You passed the first test.
# Now try: curl -s https://himanshuanand.com/.well-known/security.txt

Sitemap: https://himanshuanand.com/sitemap.xml` },

  '/.well-known/security.txt': { type: 'text/plain; charset=utf-8', cache: 86400, body: `# Security Policy for himanshuanand.com
# https://securitytxt.org/

Contact: mailto:me@himanshuanand.com
Contact: https://twitter.com/anand_himanshu
Expires: 2027-05-04T00:00:00.000Z
Preferred-Languages: en
Canonical: https://himanshuanand.com/.well-known/security.txt
Policy: https://himanshuanand.com/security-policy

# If you find a vulnerability, I'd appreciate a heads-up before disclosure.` },

  '/sitemap.xml': { type: 'application/xml; charset=utf-8', cache: 86400, body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://himanshuanand.com/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
  <url><loc>https://blog.himanshuanand.com/</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>https://promptinjection.himanshuanand.com/</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://cloudintel.info/</loc><changefreq>daily</changefreq><priority>0.7</priority></url>
</urlset>` },

  '/humans.txt': { type: 'text/plain; charset=utf-8', cache: 86400, body: `/* TEAM */
Name: Himanshu Anand
Role: Security Researcher & Engineer
Site: https://himanshuanand.com
Twitter: @anand_himanshu
GitHub: unknownhad

/* SITE */
Platform: Cloudflare Workers + KV
Font: Inter, JetBrains Mono
Colors: #4ade80 (muted green), #0a0a0f (dark)

/* NOTE */
If you're reading this, you probably know what you're doing.
me[at]himanshuanand.com` },

  '/site.webmanifest': { type: 'application/manifest+json', cache: 86400,
    body: JSON.stringify({ name:'Himanshu Anand', short_name:'HA', start_url:'/', display:'standalone', background_color:'#0a0a0f', theme_color:'#4ade80', icons:[{src:'/favicon.svg',sizes:'any',type:'image/svg+xml'}] }) },

  '/favicon.svg': { type: 'image/svg+xml', cache: 604800, body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="#0a0a0f"/><text x="50" y="38" font-family="monospace" font-size="22" font-weight="bold" fill="#4ade80" text-anchor="middle">$_</text><text x="50" y="68" font-family="system-ui,sans-serif" font-size="32" font-weight="800" fill="#e2e8f0" text-anchor="middle">HA</text></svg>` },

  '/favicon.ico': { type: 'image/svg+xml', cache: 604800, get body() { return STATIC['/favicon.svg'].body; } },
};

// ─── Redirects ──────────────────────────────────────────────────
const REDIRECTS = { '/index.html': '/', '/security.txt': '/.well-known/security.txt' };

// ─── Helpers ────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function respond(body, type, status = 200, cache = 300) {
  return new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': `public, max-age=${cache}`, ...SEC } });
}

// ─── Fetch blog posts (cached) ──────────────────────────────────
async function fetchBlogPosts() {
  try {
    const resp = await fetch(BLOG_API, { cf: { cacheTtl: BLOG_CACHE_TTL, cacheEverything: true } });
    if (!resp.ok) return [];
    return await resp.json();
  } catch { return []; }
}

// ─── Fetch KV content ───────────────────────────────────────────
async function fetchContent(env) {
  try {
    const raw = await env.SITE_KV.get(KV_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── SVG Icons (inline, no external deps) ───────────────────────
const ICONS = {
  blog:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.855z"/></svg>',
  github:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>',
  twitter:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  mastodon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.327 8.566c0-4.339-2.843-5.61-2.843-5.61-1.433-.658-3.894-.935-6.451-.956h-.063c-2.557.021-5.016.298-6.45.956 0 0-2.843 1.271-2.843 5.61 0 .993-.019 2.181.012 3.441.103 4.243.778 8.425 4.701 9.463 1.809.479 3.362.579 4.612.51 2.268-.126 3.541-.809 3.541-.809l-.075-1.646s-1.621.511-3.441.449c-1.804-.062-3.707-.194-3.999-2.409a4.523 4.523 0 0 1-.04-.621s1.77.432 4.014.535c1.372.063 2.658-.08 3.965-.236 2.506-.299 4.688-1.843 4.962-3.254.431-2.223.396-5.424.396-5.424z"/></svg>',
  flag:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  mail:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  send:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  up:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>',
};

// ─── HTML Renderers ─────────────────────────────────────────────
function renderCard(title, url, desc, tags = []) {
  const tagHtml = tags.map(t => `<span class="card-tag">${esc(t)}</span>`).join('');
  return `<div class="card">
    <span class="card-title"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a></span>
    ${desc ? `<p class="card-desc">${esc(desc)}</p>` : ''}
    ${tagHtml ? `<div class="card-meta">${tagHtml}</div>` : ''}
  </div>`;
}

function renderBlogCard(post) {
  const year = post.date ? post.date.slice(0, 4) : '';
  const tags = (post.tags || []).filter(t => !['security','blog'].includes(t.toLowerCase())).slice(0, 2);
  return renderCard(post.title, post.url, post.summary?.split('\n')[0]?.slice(0, 120) + '...', [...tags, year].filter(Boolean));
}

function renderTalk(t) {
  const links = [
    t.pdf ? `<a href="${esc(t.pdf)}" target="_blank" rel="noopener noreferrer">[PDF]</a>` : '',
    t.github ? `<a href="${esc(t.github)}" target="_blank" rel="noopener noreferrer">[GitHub]</a>` : '',
  ].filter(Boolean).join(' &middot; ');
  const video = t.video ? `<div class="video-wrap"><iframe src="${esc(t.video)}" title="${esc(t.title)}" loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : '';
  return `<div class="card">
    <span class="card-title">${esc(t.title)}</span>
    <p class="card-desc">${esc(t.desc)} ${links}</p>
    ${video}
  </div>`;
}

// ─── Full Page Template ─────────────────────────────────────────
function renderPage(content, blogPosts) {
  const c = content;
  const featured = c.employer_posts.filter(p => p.featured);
  const rest = c.employer_posts.filter(p => !p.featured);
  const restCount = rest.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Himanshu Anand — ${esc(c.hero.tagline)}. Threat intel, reverse engineering, client-side security, and WAF engineering.">
  <meta name="author" content="Himanshu Anand">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://himanshuanand.com/">
  <meta property="og:title" content="Himanshu Anand — ${esc(c.hero.tagline)}">
  <meta property="og:description" content="Threat intel, reverse engineering, client-side security, and WAF engineering.">
  <meta name="twitter:card" content="summary_large_image">
  <title>Himanshu Anand — ${esc(c.hero.tagline)}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#4ade80">
  <link rel="author" href="/humans.txt">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
:root{--bg:#0a0a0f;--bg-alt:#0f1117;--card:#13151c;--card-hover:#181b24;--text:#e2e8f0;--text-muted:#8892a4;--accent:#4ade80;--accent-dim:rgba(74,222,128,0.12);--accent-ring:rgba(74,222,128,0.3);--border:#1e2330;--link:#4ade80;--link-hover:#86efac;--radius:12px;--radius-sm:8px;--shadow:0 4px 16px rgba(0,0,0,0.3);--font-body:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--font-mono:'JetBrains Mono','Fira Code','Consolas',monospace;--container:68ch;--nav-h:56px}
@media(prefers-color-scheme:light){:root{--bg:#f8f9fb;--bg-alt:#f1f3f7;--card:#fff;--card-hover:#f5f7fa;--text:#1a1d26;--text-muted:#5a6377;--accent:#16a34a;--accent-dim:rgba(22,163,74,0.08);--accent-ring:rgba(22,163,74,0.25);--border:#e2e5ec;--link:#16a34a;--link-hover:#15803d;--shadow:0 4px 16px rgba(0,0,0,0.06)}}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth;scroll-padding-top:calc(var(--nav-h) + 1rem)}body{font-family:var(--font-body);font-size:16px;line-height:1.7;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased}img{max-width:100%;display:block}a{color:var(--link);text-decoration:none;transition:color .15s}a:hover{color:var(--link-hover)}
nav{position:sticky;top:0;z-index:100;background:rgba(10,10,15,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);height:var(--nav-h);display:flex;align-items:center;justify-content:center}@media(prefers-color-scheme:light){nav{background:rgba(248,249,251,0.88)}}.nav-inner{display:flex;align-items:center;gap:.25rem;max-width:var(--container);width:100%;padding:0 1rem;overflow-x:auto;scrollbar-width:none}.nav-inner::-webkit-scrollbar{display:none}.nav-brand{font-family:var(--font-mono);font-weight:700;font-size:14px;color:var(--accent);margin-right:auto;white-space:nowrap;flex-shrink:0}.nav-link{font-size:13px;font-weight:500;color:var(--text-muted);padding:6px 10px;border-radius:6px;white-space:nowrap;transition:color .15s,background .15s}.nav-link:hover{color:var(--accent);background:var(--accent-dim)}
.hero{padding:4rem 1rem 3rem;text-align:center;border-bottom:1px solid var(--border);background:radial-gradient(ellipse 60% 40% at 50% 0%,rgba(74,222,128,0.06),transparent),var(--bg)}.hero-avatar{width:100px;height:100px;border-radius:50%;border:2px solid var(--accent);box-shadow:0 0 24px rgba(74,222,128,0.15);margin:0 auto 1.25rem;object-fit:cover}.hero h1{font-family:var(--font-mono);font-size:clamp(24px,4vw,36px);font-weight:700;letter-spacing:-.5px;margin-bottom:.35rem}.hero h1 .cursor{display:inline-block;width:2px;height:1em;background:var(--accent);margin-left:4px;vertical-align:text-bottom;animation:blink 1s step-end infinite}@keyframes blink{50%{opacity:0}}.hero-tagline{font-size:17px;color:var(--text-muted);margin-bottom:.5rem}.hero-tagline .role{color:var(--accent);font-weight:600}.hero-now{font-family:var(--font-mono);font-size:13px;color:var(--text-muted);margin-bottom:1.5rem}.hero-now .prompt{color:var(--accent)}.hero-now .val{color:var(--text)}.hero-ctas{display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:13px;font-weight:600;padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);transition:all .15s;cursor:pointer}.btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-dim);text-decoration:none}.btn-primary{background:var(--accent);color:#0a0a0f;border-color:var(--accent)}.btn-primary:hover{background:var(--link-hover);color:#0a0a0f}.btn svg{width:16px;height:16px}
.stats{display:flex;justify-content:center;flex-wrap:wrap;gap:1.5rem 2.5rem;padding:2rem 1rem;border-bottom:1px solid var(--border);background:var(--bg-alt)}.stat{text-align:center}.stat-num{font-family:var(--font-mono);font-size:22px;font-weight:700;color:var(--accent)}.stat-label{font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px}
.container{max-width:var(--container);width:100%;margin:0 auto;padding:0 1rem}.section{padding:3rem 0;border-bottom:1px solid var(--border)}.section:last-child{border-bottom:0}.section-header{font-family:var(--font-mono);font-size:13px;color:var(--text-muted);margin-bottom:.35rem}.section-header .prompt{color:var(--accent)}.section h2{font-size:clamp(20px,2.5vw,26px);font-weight:800;margin-bottom:1.25rem;color:var(--text)}
.about-text{color:var(--text-muted);line-height:1.8}.about-text strong{color:var(--text)}.skills-grid{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}.skill-tag{font-family:var(--font-mono);font-size:12px;padding:4px 10px;border-radius:6px;background:var(--accent-dim);color:var(--accent);border:1px solid rgba(74,222,128,0.15)}@media(prefers-color-scheme:light){.skill-tag{color:#15803d}}
.timeline{position:relative;padding-left:1.5rem}.timeline::before{content:'';position:absolute;left:0;top:.5rem;bottom:.5rem;width:2px;background:var(--border)}.timeline-item{position:relative;padding-bottom:1.5rem}.timeline-item:last-child{padding-bottom:0}.timeline-item::before{content:'';position:absolute;left:-1.5rem;top:.5rem;width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid var(--bg);transform:translateX(-4px)}.timeline-role{font-weight:700;font-size:15px}.timeline-company{color:var(--accent);font-weight:600}.timeline-period{font-family:var(--font-mono);font-size:12px;color:var(--text-muted)}.timeline-desc{font-size:14px;color:var(--text-muted);margin-top:.25rem}
.card-grid{display:grid;grid-template-columns:1fr;gap:.75rem}.card-grid--two{grid-template-columns:1fr}@media(min-width:640px){.card-grid--two{grid-template-columns:1fr 1fr}}.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.15rem;transition:border-color .15s,background .15s,transform .15s}.card:hover{border-color:rgba(74,222,128,0.25);background:var(--card-hover);transform:translateY(-1px)}.card-title{font-size:15px;font-weight:600;color:var(--text);display:block;margin-bottom:.25rem}.card-title a{color:var(--text)}.card-title a:hover{color:var(--accent)}.card-desc{font-size:14px;color:var(--text-muted);line-height:1.5}.card-meta{font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-top:.5rem;display:flex;gap:.75rem;flex-wrap:wrap}.card-tag{font-family:var(--font-mono);font-size:11px;color:var(--accent);background:var(--accent-dim);padding:2px 8px;border-radius:4px}
.toggle-section{display:none}.toggle-btn{font-family:var(--font-mono);font-size:13px;color:var(--accent);background:var(--accent-dim);border:1px solid rgba(74,222,128,0.2);padding:8px 18px;border-radius:8px;cursor:pointer;margin-top:1rem;display:inline-block;transition:background .15s}.toggle-btn:hover{background:rgba(74,222,128,0.18)}
.social-row{display:flex;flex-wrap:wrap;gap:.5rem}.social-chip{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:13px;padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);transition:all .15s}.social-chip:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-dim);text-decoration:none}.social-chip svg{width:16px;height:16px}
.video-wrap{margin-top:.75rem;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border)}.video-wrap iframe{width:100%;aspect-ratio:16/9;border:0;display:block}
.contact-grid{display:grid;grid-template-columns:1fr;gap:2rem}@media(min-width:640px){.contact-grid{grid-template-columns:1fr 1fr}}.form-group{margin-bottom:1rem}.form-group label{display:block;font-family:var(--font-mono);font-size:12px;color:var(--text-muted);margin-bottom:.35rem;text-transform:uppercase;letter-spacing:.5px}.form-group input,.form-group textarea{width:100%;font-family:var(--font-body);font-size:14px;padding:10px 12px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg);color:var(--text);transition:border-color .15s;outline:none}.form-group input:focus,.form-group textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-ring)}.form-group textarea{min-height:120px;resize:vertical}
.contact-info-list{list-style:none;display:flex;flex-direction:column;gap:1rem}.contact-info-item{display:flex;align-items:center;gap:.75rem;font-size:14px;color:var(--text-muted)}.contact-info-item svg{width:18px;height:18px;color:var(--accent);flex-shrink:0}.contact-info-item a{color:var(--text)}.contact-info-item a:hover{color:var(--accent)}
footer{text-align:center;padding:2rem 1rem;font-family:var(--font-mono);font-size:12px;color:var(--text-muted);border-top:1px solid var(--border)}
.btt{position:fixed;bottom:1.25rem;right:1.25rem;width:40px;height:40px;border-radius:50%;background:var(--accent);color:#0a0a0f;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transform:translateY(10px);transition:opacity .2s,transform .2s;z-index:90}.btt.visible{opacity:1;transform:translateY(0)}.btt svg{width:18px;height:18px}
.fade-in{opacity:0;transform:translateY(16px);transition:opacity .5s ease,transform .5s ease}.fade-in.visible{opacity:1;transform:translateY(0)}@media(prefers-reduced-motion:reduce){.fade-in{opacity:1;transform:none;transition:none}}
@media(max-width:480px){.hero{padding:2.5rem 1rem 2rem}.stats{gap:1rem 1.5rem;padding:1.5rem 1rem}.stat-num{font-size:18px}.section{padding:2rem 0}.nav-link{font-size:12px;padding:4px 8px}}
  </style>
</head>
<body>
  <nav><div class="nav-inner">
    <span class="nav-brand">~/himanshu</span>
    <a class="nav-link" href="#about">About</a>
    <a class="nav-link" href="#research">Research</a>
    <a class="nav-link" href="#talks">Talks</a>
    <a class="nav-link" href="#projects">Projects</a>
    <a class="nav-link" href="#patents">Patents</a>
    <a class="nav-link" href="#contact">Contact</a>
  </div></nav>

  <header class="hero">
    <img class="hero-avatar" src="https://avatars.githubusercontent.com/u/441098?v=4" alt="Himanshu Anand" width="100" height="100" loading="eager">
    <h1>Himanshu Anand<span class="cursor"></span></h1>
    <p class="hero-tagline"><span class="role">${esc(c.hero.tagline)}</span></p>
    <p class="hero-now">
      <span class="prompt">$</span> cat ~/.now &rarr;
      <span class="val">${esc(c.hero.current)}</span> &middot;
      ${esc(c.hero.achievement)} &middot;
      <a href="${esc(c.hero.ctf_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${esc(c.hero.ctf_team)}</a>
    </p>
    <div class="hero-ctas">
      <a class="btn btn-primary" href="https://blog.himanshuanand.com" target="_blank" rel="noopener noreferrer">${ICONS.blog} Blog</a>
      <a class="btn" href="https://github.com/unknownhad" target="_blank" rel="noopener noreferrer">${ICONS.github} GitHub</a>
      <a class="btn" href="https://twitter.com/anand_himanshu" target="_blank" rel="noopener noreferrer">${ICONS.twitter} X / Twitter</a>
      <a class="btn" href="#contact">${ICONS.mail} Contact</a>
    </div>
  </header>

  <div class="stats fade-in">
    ${c.stats.map(s => `<div class="stat"><div class="stat-num">${esc(s.num)}</div><div class="stat-label">${esc(s.label)}</div></div>`).join('')}
  </div>

  <main class="container">
    <section id="about" class="section fade-in">
      <div class="section-header"><span class="prompt">$</span> cat ~/about.md</div>
      <h2>About</h2>
      <div class="about-text">
        ${c.about.bio_html}
        <div class="skills-grid">
          ${c.about.skills.map(s => `<span class="skill-tag">${esc(s)}</span>`).join('')}
        </div>
      </div>
    </section>

    <section id="experience" class="section fade-in">
      <div class="section-header"><span class="prompt">$</span> cat ~/experience.log</div>
      <h2>Experience</h2>
      <div class="timeline">
        ${c.experience.map(e => `<div class="timeline-item">
          <div class="timeline-role">${esc(e.role)}</div>
          <div class="timeline-company">${esc(e.company)}</div>
          <div class="timeline-period">${esc(e.period)}</div>
          <div class="timeline-desc">${esc(e.desc)}</div>
        </div>`).join('')}
      </div>
    </section>

    <section id="research" class="section fade-in">
      <div class="section-header"><span class="prompt">$</span> ls ~/research/latest/</div>
      <h2>Latest Research</h2>
      <div class="card-grid">
        ${blogPosts.slice(0, 5).map(renderBlogCard).join('')}
      </div>
      <a class="btn" href="https://blog.himanshuanand.com" target="_blank" rel="noopener noreferrer" style="margin-top:1rem;">View all posts &rarr;</a>
    </section>

    <section class="section fade-in">
      <div class="section-header"><span class="prompt">$</span> ls ~/published/</div>
      <h2>Published at Cloudflare, c/side & Symantec</h2>
      <div class="card-grid">
        ${featured.map(p => renderCard(p.title, p.url, p.desc, p.tags)).join('')}
      </div>
      <div class="toggle-section" id="more-blogs">
        <div class="card-grid" style="margin-top:.75rem;">
          ${rest.map(p => renderCard(p.title, p.url, p.desc, p.tags)).join('')}
        </div>
      </div>
      ${restCount > 0 ? `<button class="toggle-btn" onclick="toggleBlogs()">Show all ${restCount + featured.length} posts &darr;</button>` : ''}
    </section>

    <section id="talks" class="section fade-in">
      <div class="section-header"><span class="prompt">$</span> ls ~/talks/</div>
      <h2>Conference Talks</h2>
      <div class="card-grid">${c.talks.map(renderTalk).join('')}</div>
    </section>

    <section class="section fade-in">
      <div class="section-header"><span class="prompt">$</span> grep -r "himanshu" ~/media/</div>
      <h2>In The Media</h2>
      <div class="card-grid card-grid--two">
        ${c.media.map(m => `<div class="card"><span class="card-title"><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.outlet)}</a></span><p class="card-desc">${esc(m.title)}</p></div>`).join('')}
      </div>
    </section>

    <section id="patents" class="section fade-in">
      <div class="section-header"><span class="prompt">$</span> ls ~/patents/ ~/papers/</div>
      <h2>Patents & Papers</h2>
      <div class="card-grid card-grid--two">
        ${c.patents.map(p => `<div class="card"><div class="card-meta" style="margin-bottom:.4rem"><span class="card-tag">Patent</span></div><span class="card-title"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a></span><p class="card-desc">${esc(p.number)}</p></div>`).join('')}
        ${c.papers.map(p => `<div class="card"><div class="card-meta" style="margin-bottom:.4rem"><span class="card-tag">Paper</span></div><span class="card-title"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a></span><p class="card-desc">${esc(p.publisher)}</p></div>`).join('')}
      </div>
    </section>

    <section id="projects" class="section fade-in">
      <div class="section-header"><span class="prompt">$</span> ls ~/projects/</div>
      <h2>Projects</h2>
      <div class="card-grid card-grid--two">
        ${c.projects.map(p => renderCard(p.title, p.url, p.desc, p.tags)).join('')}
      </div>
    </section>

    <section class="section fade-in">
      <div class="section-header"><span class="prompt">$</span> cat ~/.social</div>
      <h2>Find Me Online</h2>
      <div class="social-row">
        ${c.social.map(s => `<a class="social-chip" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${ICONS[s.icon] || ''} ${esc(s.name)}</a>`).join('')}
      </div>
    </section>

    <section id="contact" class="section fade-in">
      <div class="section-header"><span class="prompt">$</span> cat ~/contact.md</div>
      <h2>Get In Touch</h2>
      <div class="contact-grid">
        <form id="contact-form" onsubmit="handleSubmit(event)">
          <div class="form-group"><label for="name">Name</label><input type="text" id="name" name="name" required placeholder="Your name"></div>
          <div class="form-group"><label for="email">Email</label><input type="email" id="email" name="email" required placeholder="you@example.com"></div>
          <div class="form-group"><label for="message">Message</label><textarea id="message" name="message" required placeholder="What's on your mind?"></textarea></div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">${ICONS.send} Send Message</button>
        </form>
        <div>
          <ul class="contact-info-list">
            <li class="contact-info-item">${ICONS.mail} <a href="mailto:me@himanshuanand.com">me[at]himanshuanand.com</a></li>
            <li class="contact-info-item">${ICONS.github} <a href="https://github.com/unknownhad" target="_blank" rel="noopener noreferrer">github.com/unknownhad</a></li>
            <li class="contact-info-item">${ICONS.twitter} <a href="https://twitter.com/anand_himanshu" target="_blank" rel="noopener noreferrer">@anand_himanshu</a></li>
          </ul>
          <div style="margin-top:1.5rem;padding:1rem;border-radius:var(--radius-sm);background:var(--accent-dim);border:1px solid rgba(74,222,128,0.15)">
            <p style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);margin:0"><span style="color:var(--accent)">$</span> For speaking engagements, research collaboration, or security consulting.</p>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer><p>&copy; ${new Date().getFullYear()} Himanshu Anand &middot; Built with Cloudflare Workers</p></footer>
  <button class="btt" aria-label="Back to top" onclick="window.scrollTo({top:0})">${ICONS.up}</button>

  <script>
    function toggleBlogs(){const s=document.getElementById('more-blogs'),b=event.currentTarget,v=s.style.display==='block';s.style.display=v?'none':'block';b.textContent=v?'Show all ${featured.length + restCount} posts \\u2193':'Show fewer \\u2191';}
    const btt=document.querySelector('.btt');window.addEventListener('scroll',()=>{btt.classList.toggle('visible',window.scrollY>200)},{passive:true});
    if(!window.matchMedia('(prefers-reduced-motion:reduce)').matches){const o=new IntersectionObserver(e=>{e.forEach(x=>{if(x.isIntersecting){x.target.classList.add('visible');o.unobserve(x.target)}})},{threshold:.1});document.querySelectorAll('.fade-in').forEach(el=>o.observe(el))}else{document.querySelectorAll('.fade-in').forEach(el=>el.classList.add('visible'))}
    function handleSubmit(e){e.preventDefault();const b=e.target.querySelector('button[type="submit"]');b.textContent='Sent!';b.disabled=true;setTimeout(()=>{b.innerHTML='${ICONS.send.replace(/'/g,"\\'")} Send Message';b.disabled=false;e.target.reset()},2000)}
    console.log('%c$ whoami','color:#4ade80;font-family:monospace;font-size:14px;font-weight:bold');
    console.log('%cHimanshu Anand — Security Researcher & Engineer','color:#e2e8f0;font-family:monospace;font-size:12px');
    console.log('%cCheck /robots.txt, /.well-known/security.txt, /humans.txt','color:#8892a4;font-family:monospace;font-size:12px');
  </script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Himanshu Anand","url":"https://himanshuanand.com","jobTitle":"${esc(c.hero.tagline)}","worksFor":{"@type":"Organization","name":"${esc(c.hero.current)}"},"sameAs":${JSON.stringify(c.social.map(s=>s.url))}}</script>
</body>
</html>`;
}

// ─── 404 Page ───────────────────────────────────────────────────
const NOT_FOUND = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><style>body{font-family:monospace;max-width:50ch;margin:6rem auto;padding:1rem;color:#e2e8f0;background:#0a0a0f;text-align:center}.code{font-size:64px;font-weight:bold;color:#4ade80}a{color:#4ade80}.p{margin-top:2rem;color:#8892a4;font-size:14px}</style></head><body><div class="code">404</div><p>$ ls: no such file or directory</p><p class="p"><a href="/">cd ~/himanshu</a> &middot; <a href="https://blog.himanshuanand.com">cd ~/blog</a></p></body></html>`;

// ─── Security policy page ───────────────────────────────────────
const SECURITY_POLICY_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Security Policy</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><style>body{font-family:-apple-system,sans-serif;max-width:60ch;margin:4rem auto;padding:1rem;line-height:1.7;color:#e2e8f0;background:#0a0a0f}h1{font-family:monospace;color:#4ade80}h2{margin-top:2rem}a{color:#4ade80}code{background:#1e2330;padding:2px 6px;border-radius:4px;font-size:14px}.back{display:inline-block;margin-bottom:2rem;font-family:monospace;font-size:13px}</style></head><body><a class="back" href="/">&larr; ~/himanshu</a><h1>$ cat security-policy.md</h1><h2>Scope</h2><p>This policy applies to <code>himanshuanand.com</code> and its subdomains.</p><h2>Reporting</h2><p>Email: <a href="mailto:me@himanshuanand.com">me@himanshuanand.com</a> | Twitter: <a href="https://twitter.com/anand_himanshu">@anand_himanshu</a></p><h2>Guidelines</h2><ul><li>Provide sufficient detail to reproduce the issue</li><li>Allow reasonable time for a fix before disclosure</li><li>Do not harm availability or access others' data</li></ul><h2>Recognition</h2><p>I credit researchers unless they prefer anonymity.</p></body></html>`;

// ─── Main Handler ───────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;
    if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);

    // Redirects
    if (REDIRECTS[path]) return Response.redirect(new URL(REDIRECTS[path], request.url).toString(), 301);

    // Static files
    const s = STATIC[path];
    if (s) return respond(s.body, s.type, 200, s.cache);

    // Security policy
    if (path === '/security-policy') return respond(SECURITY_POLICY_HTML, 'text/html; charset=utf-8', 200, 86400);

    // Home page — dynamic render
    if (path === '/') {
      const [blogPosts, content] = await Promise.all([
        fetchBlogPosts(),
        fetchContent(env),
      ]);

      if (!content) {
        return respond('<h1>Site loading... push content.json to KV first.</h1>', 'text/html; charset=utf-8', 503);
      }

      const html = renderPage(content, blogPosts);
      return respond(html, 'text/html; charset=utf-8', 200, HTML_CACHE_TTL);
    }

    // 404
    return respond(NOT_FOUND, 'text/html; charset=utf-8', 404);
  },
};
