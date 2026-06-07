#!/usr/bin/env python3
"""Strip InboxPilot @down / @end blocks from a migration file.

The project's migration convention is `-- @down` ... `-- @end`. The InsForge
migration runner drops the @down block before applying; raw `psql -f` does
not. We split the file on the first `-- @down` line and keep only the up
section. Used by the RLS test runner to apply migrations via plain psql.
"""
import re
import sys

if len(sys.argv) != 2:
    print("usage: strip-down.py <migration.sql>", file=sys.stderr)
    sys.exit(2)

path = sys.argv[1]
with open(path) as f:
    text = f.read()

m = re.search(r"^\s*--\s*@down\b", text, flags=re.MULTILINE | re.IGNORECASE)
if m:
    text = text[:m.start()]

text = text.rstrip() + "\n"
sys.stdout.write(text)
