ALTER TABLE positions ADD COLUMN display_name TEXT;

UPDATE positions
SET display_name = normalized_name
WHERE display_name IS NULL;
