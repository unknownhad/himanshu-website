#!/usr/bin/env bash
#
# Update site content without touching Worker code.
#
# Usage:
#   ./update-content.sh                    # push content.json to KV
#   ./update-content.sh --preview          # push to preview KV (for wrangler dev)
#   ./update-content.sh --purge            # push + purge cached HTML
#
# Prerequisites:
#   - wrangler CLI installed: npm i -g wrangler
#   - wrangler authenticated: wrangler login
#   - KV namespace ID set in wrangler.toml
#
# To add a new talk, project, patent, etc.:
#   1. Edit content.json
#   2. Run: ./update-content.sh
#   3. Site updates within 60 seconds (cache TTL)
#
# Blog posts update AUTOMATICALLY — they're fetched from
# blog.himanshuanand.com/index.json at request time.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTENT_FILE="$SCRIPT_DIR/content.json"

if [ ! -f "$CONTENT_FILE" ]; then
  echo "Error: content.json not found at $CONTENT_FILE"
  exit 1
fi

# Validate JSON
if ! python3 -c "import json; json.load(open('$CONTENT_FILE'))" 2>/dev/null; then
  echo "Error: content.json is not valid JSON"
  exit 1
fi

echo "Validated content.json"

# Determine flags
PREVIEW_FLAG=""
if [[ "${1:-}" == "--preview" ]]; then
  PREVIEW_FLAG="--preview"
  echo "Pushing to preview KV..."
fi

# Push to KV
wrangler kv:key put \
  --namespace-id "$(grep 'id = ' "$SCRIPT_DIR/wrangler.toml" | head -1 | sed 's/.*= "//;s/"//')" \
  "SITE_CONTENT" \
  --path "$CONTENT_FILE" \
  $PREVIEW_FLAG

echo "Content pushed to KV successfully."

# Purge cache if requested
if [[ "${1:-}" == "--purge" ]]; then
  echo "Purging cached HTML..."
  curl -s "https://himanshuanand.com/api/purge?secret=${ADMIN_SECRET:-}" > /dev/null
  echo "Cache purged."
fi

echo ""
echo "Done. Changes will appear within 60 seconds."
echo ""
echo "Sections updated:"
python3 -c "
import json
c = json.load(open('$CONTENT_FILE'))
print(f'  Employer posts: {len(c[\"employer_posts\"])}')
print(f'  Talks:          {len(c[\"talks\"])}')
print(f'  Media:          {len(c[\"media\"])}')
print(f'  Patents:        {len(c[\"patents\"])}')
print(f'  Papers:         {len(c[\"papers\"])}')
print(f'  Projects:       {len(c[\"projects\"])}')
print(f'  Skills:         {len(c[\"about\"][\"skills\"])}')
"
