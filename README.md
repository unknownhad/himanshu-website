# himanshuanand.com

Personal website running on Cloudflare Workers. Blog posts are fetched automatically from the Hugo blog API. Everything else (talks, projects, patents, papers, media, experience) is stored in Cloudflare KV and updated without touching Worker code.

## Architecture

```
                    ┌─────────────────────────┐
                    │   himanshuanand.com/*    │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │     Cloudflare Worker    │
                    │       (worker.js)        │
                    └──┬──────────────────┬───┘
                       │                  │
          ┌────────────▼───┐    ┌─────────▼─────────┐
          │  Cloudflare KV │    │ blog.himanshuanand │
          │ (content.json) │    │  .com/index.json   │
          │                │    │   (Hugo JSON API)  │
          │ talks          │    │                    │
          │ projects       │    │  auto-updates on   │
          │ patents        │    │  new blog post     │
          │ papers         │    │                    │
          │ media          │    └────────────────────┘
          │ experience     │
          │ skills         │
          │ hero config    │
          └────────────────┘
```

## Files

| File | Purpose |
|---|---|
| `worker.js` | Main Worker — routing, HTML templating, security headers, static files (robots.txt, security.txt, etc.) |
| `content.json` | All non-blog site content. Edit this to update talks, projects, patents, etc. |
| `wrangler.toml` | Worker deployment config and KV namespace binding |
| `update-content.sh` | Push content.json to KV in one command |
| `.gitignore` | Ignores node_modules, .wrangler, local preview files |

## Setup (one-time)

```bash
# Install wrangler CLI
npm i -g wrangler

# Authenticate
wrangler login

# Create the KV namespace
wrangler kv:namespace create SITE_KV
# Output: { binding = "SITE_KV", id = "abc123..." }

# Paste the id into wrangler.toml:
#   id = "abc123..."

# Push initial content to KV
./update-content.sh

# Deploy the Worker
wrangler deploy
```

## Updating content

### Blog posts (automatic)

Blog posts are fetched from `blog.himanshuanand.com/index.json` at request time and cached for 1 hour. Publish a new Hugo post and the main site picks it up automatically.

### Talks, projects, patents, papers, media, etc.

1. Edit `content.json`
2. Run `./update-content.sh`
3. Site updates within 60 seconds

### Examples

**Add a new talk:**

```json
// In content.json → "talks" array, add:
{
  "title": "BSides London 2026 — My New Talk",
  "desc": "Description of the talk.",
  "pdf": "https://example.com/slides.pdf",
  "video": "https://www.youtube.com/embed/VIDEO_ID"
}
```

**Add a new project:**

```json
// In content.json → "projects" array, add:
{
  "title": "Project Name",
  "url": "https://github.com/unknownhad/project",
  "desc": "What the project does.",
  "tags": ["Security", "Workers"]
}
```

**Add a new patent:**

```json
// In content.json → "patents" array, add:
{
  "title": "Patent Title",
  "url": "https://patents.justia.com/patent/XXXXXXX",
  "number": "US XX,XXX,XXX"
}
```

**Add a media mention:**

```json
// In content.json → "media" array, add:
{
  "outlet": "Wired",
  "title": "Article headline",
  "url": "https://wired.com/..."
}
```

**Update your employer or role:**

```json
// In content.json → "hero":
{
  "tagline": "Security Researcher & Engineer",
  "current": "New Company Name",
  "achievement": "3× DEF CON Finalist",
  "ctf_team": "Water Paddlers CTF",
  "ctf_url": "https://ctftime.org/user/144614"
}
```

**Add a new skill tag:**

```json
// In content.json → "about" → "skills" array, add:
"New Skill"
```

Then run:

```bash
./update-content.sh
```

## content.json schema

```
content.json
├── hero            # Name, tagline, current employer, achievements
├── about
│   ├── bio_html    # HTML bio (supports <strong>, <a>, etc.)
│   └── skills[]    # Skill tag strings
├── experience[]    # Role, company, period, description
├── stats[]         # Number + label pairs for the stats strip
├── employer_posts[]# Published articles (featured: true shows above fold)
├── talks[]         # Conference talks (title, desc, pdf, video, github)
├── media[]         # Press mentions (outlet, title, url)
├── patents[]       # Patents (title, url, number)
├── papers[]        # Papers (title, url, publisher)
├── projects[]      # Side projects (title, url, desc, tags)
└── social[]        # Social links (name, url, icon)
```

## Routing

| Path | Response |
|---|---|
| `/` | Dynamic HTML (rendered from KV + blog API) |
| `/robots.txt` | Blocks AI crawlers, links to sitemap |
| `/.well-known/security.txt` | RFC 9116 security contact info |
| `/security-policy` | Responsible disclosure policy page |
| `/sitemap.xml` | XML sitemap for search engines |
| `/humans.txt` | Site credits and stack info |
| `/site.webmanifest` | PWA manifest |
| `/favicon.svg` | SVG favicon |
| `/favicon.ico` | Redirects to SVG |
| `/security.txt` | 301 → `/.well-known/security.txt` |
| `/index.html` | 301 → `/` |
| Everything else | 404 page |

## Security headers

Every response includes:

- `Strict-Transport-Security` (HSTS with preload)
- `Content-Security-Policy` (restricts scripts, frames, fonts, images)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` (disables camera, mic, geolocation)

## Design

- Dark theme default, auto light mode via `prefers-color-scheme`
- Muted green accent (`#4ade80`)
- Terminal-style section headers (`$ cat ~/about.md`)
- JetBrains Mono for monospace accents, Inter for body
- Zero external dependencies (no jQuery, no FontAwesome, no animate.css)
- Inline SVG icons
- `IntersectionObserver` fade-in animations
- Respects `prefers-reduced-motion`

## Cache behavior

| Content | TTL | Notes |
|---|---|---|
| HTML (home page) | 60s | Fast updates after KV push |
| Blog posts (API) | 1 hour | Auto-refreshes from Hugo |
| Static files | 24 hours | robots.txt, security.txt, etc. |
| Favicon | 7 days | Rarely changes |

## Local preview

The static prototype can be previewed locally:

```bash
cd public/
python3 -m http.server 8080
open http://localhost:8080
```

This shows the design and layout. Dynamic content (KV + blog API) only works when deployed to Workers.
