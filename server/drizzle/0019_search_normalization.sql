-- PostgreSQL 16's normalize() handles NFKC/NFKD; unaccent supplies the
-- Latin-diacritic folding used by the application-side music normalizer.
-- `unaccent` is a trusted extension in the official PostgreSQL image, so the
-- application database owner can install it without a superuser grant.
CREATE EXTENSION IF NOT EXISTS unaccent;
