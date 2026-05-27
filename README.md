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
| `content.json` | All non-blog site content. Edit this to update talks, projects, patents, advisories, etc. |
| `wrangler.toml` | Worker deployment config and KV namespace binding |
| `update-content.sh` | Push content.json to KV in one command (local workflow) |
| `.github/workflows/deploy-content.yml` | GitHub Action — auto-deploys content.json to KV on push (web workflow) |
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

### Talks, projects, patents, papers, media, advisories, etc.

Pick whichever workflow is faster for you:

**Local workflow** (edit in any editor, push via terminal):

1. Edit `content.json`
2. Run `./update-content.sh`
3. Site updates within 60 seconds

**Web workflow** (edit on github.com from any device, auto-deploy):

1. Open https://github.com/unknownhad/himanshu-website/edit/main/content.json
2. Edit and click **Commit changes**
3. GitHub Actions pushes to KV automatically (~30 sec)
4. Site updates within 60 seconds

The web workflow requires a one-time setup: see [GitHub Actions setup](#github-actions-setup-one-time) below.

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

**Add a new CVE / advisory:**

```json
// In content.json → "advisories" array, add (at the top of the array
// to keep newest first):
{
  "cve": "CVE-2026-XXXXX",
  "severity": "Moderate",
  "vendor": "Vendor Name",
  "component": "Affected Component",
  "title": "One-line bug title",
  "desc": "1-2 sentence description of the root cause and impact.",
  "links": [
    { "label": "NVD",              "url": "https://nvd.nist.gov/vuln/detail/CVE-2026-XXXXX" },
    { "label": "MITRE",            "url": "https://www.cve.org/CVERecord?id=CVE-2026-XXXXX" },
    { "label": "GHSA",             "url": "https://github.com/<org>/<repo>/security/advisories/GHSA-..." },
    { "label": "Vendor Advisory",  "url": "https://example.com/advisory" }
  ]
}
```

`severity` must be one of `critical`, `high`, `moderate`, `low`, `info` (case-insensitive — it's lowercased for CSS class).

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
├── social[]        # Social links (name, url, icon)
└── advisories[]    # Reported CVEs (cve, severity, vendor, component, title, desc, links[])
```

## Routing

| Path | Response |
|---|---|
| `/` | Dynamic HTML (rendered from KV + blog API) |
| `/advisories` | Dynamic HTML — reported CVEs from KV |
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

## GitHub Actions setup (one-time)

`/.github/workflows/deploy-content.yml` watches `content.json` and pushes it to `SITE_KV` on every commit to `main`. After the one-time setup below, editing content.json on github.com triggers an automatic deploy to KV — no terminal required.

### 1. Create a scoped Cloudflare API token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token** → **Create Custom Token**
3. Token name: `github-actions-himanshu-website`
4. Permissions:
   - `Account` → `Workers KV Storage` → `Edit`
5. Account Resources: `Include` → your account
6. Click **Continue to summary** → **Create Token**
7. Copy the token (you only see it once).

### 2. Add the token to GitHub

1. Go to https://github.com/unknownhad/himanshu-website/settings/secrets/actions
2. Click **New repository secret**
3. Name: `CLOUDFLARE_API_TOKEN`
4. Value: paste the token from step 1
5. Click **Add secret**

### 3. Trigger the first run

After committing this workflow file, every future change to `content.json` (or a manual run from the **Actions** tab) will:

1. Validate that `content.json` parses as JSON
2. Show a summary of how many entries are in each section
3. Run `wrangler kv key put` against `SITE_KV` (id `663719dc881d4183b2c87ff3f185d2fd`)
4. Site updates within 60 seconds

If the API token is missing or wrong, the run fails with a clear error and KV is untouched.

### Quick edit shortcut

Bookmark this URL — it opens the file directly in GitHub's web editor:

```
https://github.com/unknownhad/himanshu-website/edit/main/content.json
```
