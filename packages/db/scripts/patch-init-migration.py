"""One-off helper used while the schema is pre-release: patches the generated init migration with
raw SQL Prisma can't express (extensions, sequences, Event partitioning). Kept for reference;
after the first deploy, write new migrations instead of regenerating init."""
import sys
p = sys.argv[1]
s = open(p).read()
pre = '''-- Raw SQL that Prisma can't express (docs/04): extensions and sequences must exist before tables.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Human-facing numbers: F-10001…, C-10001…
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 10001;
CREATE SEQUENCE IF NOT EXISTS customer_public_seq START WITH 10001;

'''
old = '''    CONSTRAINT "Event_pkey" PRIMARY KEY ("id","ts")
);'''
assert old in s
s = pre + s.replace(old, '''    CONSTRAINT "Event_pkey" PRIMARY KEY ("id","ts")
) PARTITION BY RANGE ("ts");''')
s += open(__file__.replace('patch-init-migration.py', 'event-partitions.sql')).read()
open(p, 'w').write(s)
