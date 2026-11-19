-- Effects run functions by their path (docs/design/stateui-hard-ip.md): Magnetic's HTTP effect moved from the name
-- `http` to `$.functions.host.http`, and an effect that still names `http` does not run. This rewrites the effects of
-- the stored logic modules (`effects.<name>.run`) and of the apps' own logic (`logic.effects.<name>.run`); nothing
-- else in a body changes, a `run` of `http` elsewhere included. Bodies are json, whose key order is part of the value,
-- so each changed object is rebuilt with its keys in their order (`json_each ... WITH ORDINALITY`). A changed part
-- takes the next revision.
--
-- Row-level security holds the table's owner too (FORCE), and a migration sets no workspace, so the owner is let
-- through for this transaction only and held again before it ends.

-- The object with the value of one key replaced, the keys in their order. The parameters are named apart from
-- json_each's columns (key, value), which would win over them
CREATE FUNCTION pg_temp.with_key(target json, wanted text, replacement json) RETURNS json
    LANGUAGE sql IMMUTABLE
    AS $fn$
        SELECT json_object_agg(e.key, CASE WHEN e.key = wanted THEN replacement ELSE e.value END ORDER BY e.n)
          FROM json_each(target) WITH ORDINALITY AS e(key, value, n)
    $fn$;

-- True when `effects` is an object with an effect that names `http`
CREATE FUNCTION pg_temp.names_http(effects json) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $fn$
        SELECT coalesce(json_typeof(effects) = 'object', false)
           AND EXISTS (
               SELECT 1
                 FROM json_each(CASE WHEN json_typeof(effects) = 'object' THEN effects ELSE '{}'::json END) AS e
                WHERE json_typeof(e.value) = 'object' AND e.value->>'run' = 'http'
           )
    $fn$;

-- The effects, each one that names `http` naming `$.functions.host.http` in its place
CREATE FUNCTION pg_temp.on_function_paths(effects json) RETURNS json
    LANGUAGE sql IMMUTABLE
    AS $fn$
        SELECT json_object_agg(
                   e.key,
                   CASE WHEN json_typeof(e.value) = 'object' AND e.value->>'run' = 'http'
                        THEN pg_temp.with_key(e.value, 'run', to_json('$.functions.host.http'::text))
                        ELSE e.value END
                   ORDER BY e.n)
          FROM json_each(effects) WITH ORDINALITY AS e(key, value, n)
    $fn$;

ALTER TABLE part NO FORCE ROW LEVEL SECURITY;

UPDATE part
   SET body = pg_temp.with_key(body, 'effects', pg_temp.on_function_paths(body->'effects')),
       revision = revision + 1,
       updated_at = now()
 WHERE kind = 'logic'
   AND json_typeof(body) = 'object'
   AND pg_temp.names_http(body->'effects');

UPDATE part
   SET body = pg_temp.with_key(body, 'logic', pg_temp.with_key(body->'logic', 'effects', pg_temp.on_function_paths(body->'logic'->'effects'))),
       revision = revision + 1,
       updated_at = now()
 WHERE kind = 'apps'
   AND json_typeof(body) = 'object'
   AND json_typeof(body->'logic') = 'object'
   AND pg_temp.names_http(body->'logic'->'effects');

ALTER TABLE part FORCE ROW LEVEL SECURITY;

DROP FUNCTION pg_temp.on_function_paths(json);
DROP FUNCTION pg_temp.names_http(json);
DROP FUNCTION pg_temp.with_key(json, text, json);
