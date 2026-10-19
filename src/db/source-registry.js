import { sourceDefinitions } from '../../config/sources.js';

export { sourceDefinitions };

/**
 * @param {import('better-sqlite3').Database} database
 * @param {ReadonlyArray<object>} definitions
 */
export function syncSourceDefinitions(database, definitions) {
  const sync = database.transaction(() => {
    const upsertProvider = database.prepare(`
      INSERT INTO providers (id, name, homepage)
      VALUES (@providerId, @providerName, @providerHomepage)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        homepage = excluded.homepage,
        updated_at = CURRENT_TIMESTAMP
    `);
    const upsertSource = database.prepare(`
      INSERT INTO sources (id, provider_id, name, url, kind, enabled, parser_key)
      VALUES (@id, @providerId, @name, @url, @kind, @enabled, @parserKey)
      ON CONFLICT(id) DO UPDATE SET
        provider_id = excluded.provider_id,
        name = excluded.name,
        url = excluded.url,
        kind = excluded.kind,
        enabled = excluded.enabled,
        parser_key = excluded.parser_key,
        updated_at = CURRENT_TIMESTAMP
    `);

    for (const definition of definitions) {
      upsertProvider.run(definition);
      upsertSource.run({ ...definition, enabled: definition.enabled ? 1 : 0 });
    }
  });

  sync();
}
