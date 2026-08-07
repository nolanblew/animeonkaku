ALTER TABLE "media_files" DROP CONSTRAINT "media_files_kind_ref_id_unique";--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN "variant" text DEFAULT 'DEFAULT' NOT NULL;--> statement-breakpoint
-- Existing audio rows hold the short (~90s AnimeThemes) cut; label them SHORT so
-- the canonical audio resolver (kind=AUDIO, variant=SHORT) keeps finding them.
UPDATE "media_files" SET "variant" = 'SHORT' WHERE "kind" = 'AUDIO';--> statement-breakpoint
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_kind_ref_id_variant_unique" UNIQUE("kind","ref_id","variant");
