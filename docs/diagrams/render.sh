#!/bin/sh
# Re-render both diagrams to PNG and SVG. Run from anywhere: sh docs/diagrams/render.sh
# Needs mermaid-cli (mmdc). Uses mermaid-config.json (18px Helvetica) so output matches the current images.
cd "$(dirname "$0")" || exit 1
echo '{"args":["--no-sandbox"]}' > /tmp/mmdc-puppeteer.json
for n in project-flow call-sequence; do
  for e in png svg; do
    timeout 120 mmdc -i "$n.mmd" -o "$n.$e" -s 2 -w 1800 -b white -c mermaid-config.json -p /tmp/mmdc-puppeteer.json || exit 1
  done
done
rm -f /tmp/mmdc-puppeteer.json
