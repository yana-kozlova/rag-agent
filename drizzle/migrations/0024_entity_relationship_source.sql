-- Whose word an entity's relationship is.
--
-- `entities.relationship` means "how this node relates to THE USER", and
-- extraction fills it from whatever relation the sentence stated. A note saying
-- a child is somebody else's godson lands here as the user's godson, printed
-- beside the name as fact wherever the graph is shown.
-- Nothing could correct it: the column is a projection, rewritten by
-- syncEntitiesForResource from every note that mentions the node, so an edit
-- would hold until the next mention and then silently revert.
--
-- Same mechanism as entity_aliases, one step smaller. A name needs its own
-- table because identity is (user_id, normalized_name, type) and the node is
-- recreated under a new key; a relationship rides on a row that survives the
-- sync untouched, so a flag on that row is enough.
--
-- Defaults to 'model' because that is what every existing value is.
ALTER TABLE "entities"
  ADD COLUMN IF NOT EXISTS "relationship_source" text DEFAULT 'model' NOT NULL;
