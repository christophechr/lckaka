# Discord Team Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au service LCK un vrai bot Discord multi-serveurs qui gère les abonnements par rôles, un rappel 30 minutes avant les matchs et un résultat final sous spoiler.

**Architecture:** Le processus Node.js existant conserve son cron et son webhook hebdomadaire, puis démarre en plus un client Discord et trois boucles de travail isolées. PostgreSQL stocke les configurations de serveurs, les associations de rôles, les matchs et l'état des livraisons ; les rôles Discord restent la source de vérité des abonnements individuels.

**Tech Stack:** Node.js 22, TypeScript strict, discord.js 14, node-postgres, PostgreSQL 18, Luxon, node-cron, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-04-discord-team-subscriptions-design.md`

## Global Constraints

- Le planning hebdomadaire continue d'utiliser `LCK_MATCH_CALENDAR_WEBHOOK_URL` et le webhook existant.
- Les commandes de configuration exigent `ManageGuild` et ne fonctionnent que dans un serveur.
- Le rappel est éligible 30 minutes avant le match et jamais après son début prévu.
- Les résultats exigent un vainqueur et deux scores valides ; score et vainqueur sont entourés par `||spoiler||`.
- Les messages n'autorisent que les mentions des rôles des deux équipes concernées.
- Les rôles créés n'ont aucune permission, aucune couleur, ne sont pas séparés et ne sont pas mentionnables.
- Les calculs et données persistées utilisent UTC ; `Europe/Paris` ne sert qu'au cron hebdomadaire et à la lisibilité des journaux.
- Les tests automatisés ne publient jamais sur un serveur Discord réel.
- Le workspace ne contient actuellement aucun dépôt Git. Les étapes de commit ci-dessous ne doivent être exécutées qu'après initialisation volontaire d'un dépôt ; sinon, elles servent de frontières de revue.

## File Structure

### Existing files to modify

- `package.json` — dépendances, scripts de migrations, commandes et tests PostgreSQL.
- `.env.example` — variables Discord, PostgreSQL et Docker sans secret réel.
- `.gitignore` — fichiers locaux PostgreSQL et de couverture.
- `src/config.ts` — configuration du webhook conservée et nouvelle configuration complète du bot.
- `src/leaguepedia.ts` — état de match enrichi et requête incluant résultats/annulations.
- `src/index.ts` — composition de l'application et arrêt gracieux.
- `README.md` — création de l'application Discord et exploitation Docker Compose.
- `tests/config.test.ts` et `tests/leaguepedia.test.ts` — contrats étendus.

### New production files

- `migrations/001_discord_bot.sql` — tables PostgreSQL initiales.
- `src/db/pool.ts` — création et fermeture du pool.
- `src/db/migrate.ts` — application transactionnelle des fichiers SQL.
- `src/db/guild-config-repository.ts` — salons et message du panneau.
- `src/db/team-role-repository.ts` — association équipe/rôle.
- `src/db/match-repository.ts` — cache persistant des matchs et recherches temporelles.
- `src/db/delivery-repository.ts` — réservation et suivi des notifications.
- `src/bot/types.ts` — types d'équipe, de cible et interfaces de ports.
- `src/bot/messages.ts` — panneau, rappel et résultat Discord.
- `src/bot/role-service.ts` — création/réutilisation et bascule des rôles.
- `src/bot/panel-service.ts` — publication ou restauration du panneau.
- `src/bot/commands.ts` — définition et traitement des commandes `/config`.
- `src/bot/interactions.ts` — routage des commandes et menus.
- `src/bot/discord-adapter.ts` — opérations discord.js derrière les ports métier.
- `src/bot/register-commands.ts` — enregistrement REST en serveur de test ou global.
- `src/bot/match-sync.ts` — synchronisation Leaguepedia vers PostgreSQL.
- `src/bot/notification-worker.ts` — rappel/résultat et livraisons idempotentes.
- `src/bot/runtime.ts` — client Discord, crons du bot et cycle de vie.
- `Dockerfile`, `.dockerignore`, `compose.yaml` — image et services VPS.

### New test files

- `tests/db.integration.test.ts` — migrations et contraintes sur PostgreSQL réel.
- `tests/messages.test.ts` — payloads, spoilers et mentions.
- `tests/role-service.test.ts` — bascule et création des rôles.
- `tests/panel-service.test.ts` — création/mise à jour du panneau.
- `tests/commands.test.ts` — permissions et configuration.
- `tests/match-sync.test.ts` — synchronisation et annulations.
- `tests/notification-worker.test.ts` — échéances, résultats, reprises et isolation des serveurs.
- `tests/helpers/fakes.ts` — doubles en mémoire des ports Discord et des dépôts.

---

### Task 1: Dependencies and configuration boundaries

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env): WebhookConfig` inchangé pour `pnpm send`.
- Produces: `loadBotConfig(env): BotConfig` avec `webhookUrl`, `discordToken`, `discordClientId`, `discordGuildId?`, `databaseUrl`.

- [ ] **Step 1: Install runtime and type dependencies**

Run:

```bash
pnpm add discord.js@^14.25.1 pg
pnpm add -D @types/pg
```

Add scripts:

```json
{
  "register:commands": "tsx src/bot/register-commands.ts",
  "migrate": "tsx src/db/migrate.ts",
  "test:db": "vitest run tests/db.integration.test.ts"
}
```

- [ ] **Step 2: Write failing configuration tests**

Add tests that exercise the real parser:

```ts
it("loads the bot, database and existing webhook configuration", () => {
  expect(loadBotConfig({
    LCK_MATCH_CALENDAR_WEBHOOK_URL: "https://discord.com/api/webhooks/1/token",
    DISCORD_TOKEN: "discord-token",
    DISCORD_CLIENT_ID: "123456789",
    DISCORD_GUILD_ID: "987654321",
    DATABASE_URL: "postgresql://bot:secret@postgres:5432/lck",
  })).toEqual({
    webhookUrl: "https://discord.com/api/webhooks/1/token",
    discordToken: "discord-token",
    discordClientId: "123456789",
    discordGuildId: "987654321",
    databaseUrl: "postgresql://bot:secret@postgres:5432/lck",
  });
});

it.each(["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DATABASE_URL"])(
  "rejects a missing %s for the bot runtime",
  (missing) => {
    const env = {
      LCK_MATCH_CALENDAR_WEBHOOK_URL: "https://discord.com/api/webhooks/1/token",
      DISCORD_TOKEN: "discord-token",
      DISCORD_CLIENT_ID: "123456789",
      DATABASE_URL: "postgresql://bot:secret@postgres:5432/lck",
    } as Record<string, string | undefined>;
    delete env[missing];
    expect(() => loadBotConfig(env)).toThrow(missing);
  },
);
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/config.test.ts`

Expected: FAIL because `loadBotConfig` is not exported.

- [ ] **Step 4: Implement the minimal parser without breaking manual sends**

Keep `loadConfig` intact and add:

```ts
export interface BotConfig extends WebhookConfig {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  databaseUrl: string;
}

function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export function loadBotConfig(
  env: Record<string, string | undefined> = process.env,
): BotConfig {
  return {
    ...loadConfig(env),
    discordToken: requireEnv(env, "DISCORD_TOKEN"),
    discordClientId: requireEnv(env, "DISCORD_CLIENT_ID"),
    discordGuildId: env.DISCORD_GUILD_ID?.trim() || undefined,
    databaseUrl: requireEnv(env, "DATABASE_URL"),
  };
}
```

Document the five variables in `.env.example` with non-secret sample values.

- [ ] **Step 5: Verify GREEN and the existing webhook boundary**

Run: `pnpm exec vitest run tests/config.test.ts tests/publisher.test.ts tests/webhook.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 6: Commit or review checkpoint**

```bash
git add package.json pnpm-lock.yaml .env.example src/config.ts tests/config.test.ts
git commit -m "feat: add Discord bot runtime configuration"
```

---

### Task 2: PostgreSQL migration runner and schema

**Files:**
- Create: `migrations/001_discord_bot.sql`
- Create: `src/db/pool.ts`
- Create: `src/db/migrate.ts`
- Create: `tests/db.integration.test.ts`

**Interfaces:**
- Consumes: `BotConfig.databaseUrl`.
- Produces: `createPool(databaseUrl): Pool`, `closePool(pool): Promise<void>`.
- Produces: `runMigrations(pool, migrationsDirectory): Promise<void>`.

- [ ] **Step 1: Write the initial SQL migration**

Create tables with Discord snowflakes stored as `text` and times as `timestamptz`:

```sql
CREATE TABLE guild_configs (
  guild_id text PRIMARY KEY,
  notification_channel_id text,
  subscription_channel_id text,
  subscription_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_roles (
  guild_id text NOT NULL REFERENCES guild_configs(guild_id) ON DELETE CASCADE,
  team_key text NOT NULL,
  team_name text NOT NULL,
  role_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, team_key),
  UNIQUE (guild_id, role_id)
);

CREATE TABLE matches (
  match_id text PRIMARY KEY,
  team1_key text NOT NULL,
  team1_name text NOT NULL,
  team2_key text NOT NULL,
  team2_name text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  best_of integer NOT NULL CHECK (best_of > 0),
  overview_page text NOT NULL,
  is_nullified boolean NOT NULL DEFAULT false,
  winner smallint CHECK (winner IN (1, 2)),
  team1_score integer CHECK (team1_score >= 0),
  team2_score integer CHECK (team2_score >= 0),
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_deliveries (
  guild_id text NOT NULL REFERENCES guild_configs(guild_id) ON DELETE CASCADE,
  match_id text NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reminder', 'result')),
  status text NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  discord_message_id text,
  claimed_at timestamptz,
  sent_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, match_id, kind)
);

CREATE INDEX matches_reminder_due_idx ON matches (scheduled_at)
  WHERE is_nullified = false;
CREATE INDEX delivery_retry_idx ON notification_deliveries (status, next_attempt_at);
```

- [ ] **Step 2: Write a real PostgreSQL integration test**

The test reads `TEST_DATABASE_URL`, applies migrations twice, and asserts real constraints:

```ts
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("PostgreSQL migrations", () => {
  it("is repeatable and enforces one delivery per guild, match and kind", async () => {
    await runMigrations(pool, resolve("migrations"));
    await runMigrations(pool, resolve("migrations"));
    await pool.query("INSERT INTO guild_configs(guild_id) VALUES($1)", ["guild-1"]);
    await pool.query(
      `INSERT INTO matches(match_id, team1_key, team1_name, team2_key, team2_name,
       scheduled_at, best_of, overview_page)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      ["match-1", "t1", "T1", "geng", "Gen.G", new Date(), 3, "LCK/2026"],
    );
    await pool.query(
      "INSERT INTO notification_deliveries(guild_id,match_id,kind,status) VALUES($1,$2,$3,$4)",
      ["guild-1", "match-1", "reminder", "pending"],
    );
    await expect(pool.query(
      "INSERT INTO notification_deliveries(guild_id,match_id,kind,status) VALUES($1,$2,$3,$4)",
      ["guild-1", "match-1", "reminder", "pending"],
    )).rejects.toMatchObject({ code: "23505" });
  });
});
```

- [ ] **Step 3: Run the database test and verify RED**

Start a disposable PostgreSQL 18 container and run the test against it:

```bash
docker run --name lck-bot-postgres-test --rm -d -e POSTGRES_DB=lck_bot_test -e POSTGRES_USER=lck_bot -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:18-alpine
TEST_DATABASE_URL=postgresql://lck_bot:test@127.0.0.1:5433/lck_bot_test pnpm test:db
```

Expected: FAIL because the migration runner does not exist.

- [ ] **Step 4: Implement pool and transaction-safe migration runner**

`runMigrations` must create `schema_migrations`, sort `.sql` files lexically, and for each unapplied file execute `BEGIN`, SQL contents, insert filename, `COMMIT`; on error execute `ROLLBACK`. Always release the checked-out client.

Core implementation shape:

```ts
export async function runMigrations(pool: Pool, directory: string): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]);
    if (applied.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(join(directory, name), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
```

- [ ] **Step 5: Verify GREEN**

Run: `TEST_DATABASE_URL=postgresql://lck_bot:test@127.0.0.1:5433/lck_bot_test pnpm test:db`

Expected: migration applies twice and duplicate delivery assertion reports the expected caught error; test PASS.

- [ ] **Step 6: Commit or review checkpoint**

```bash
git add migrations src/db tests/db.integration.test.ts package.json
git commit -m "feat: add PostgreSQL schema and migrations"
```

---

### Task 3: Typed PostgreSQL repositories

**Files:**
- Create: `src/db/guild-config-repository.ts`
- Create: `src/db/team-role-repository.ts`
- Create: `src/db/match-repository.ts`
- Create: `src/db/delivery-repository.ts`
- Modify: `tests/db.integration.test.ts`

**Interfaces:**
- Produces: `GuildConfigRepository`, `TeamRoleRepository`, `MatchRepository`, `DeliveryRepository` classes.
- Produces data types `GuildConfig`, `TeamRole`, `StoredMatch`, `DeliveryKind`, `ClaimedDelivery`.
- Produces: `MatchRepository.listTeams(): Promise<Team[]>` from distinct stored team keys and names.

Use these shared shapes consistently:

```ts
export interface GuildConfig {
  guildId: string;
  notificationChannelId: string | null;
  subscriptionChannelId: string | null;
  subscriptionMessageId: string | null;
}

export interface TeamRole {
  guildId: string;
  teamKey: string;
  teamName: string;
  roleId: string;
}

export interface StoredMatch {
  matchId: string;
  team1Key: string;
  team1Name: string;
  team2Key: string;
  team2Name: string;
  scheduledAt: Date;
  bestOf: number;
  overviewPage: string;
  isNullified: boolean;
  winner: 1 | 2 | null;
  team1Score: number | null;
  team2Score: number | null;
}

export type DeliveryKind = "reminder" | "result";
```

- [ ] **Step 1: Add failing repository integration tests**

Cover these observable contracts with parameterized inputs:

```ts
await guilds.setNotificationChannel("guild-1", "channel-n");
await guilds.setSubscriptionPanel("guild-1", "channel-s", "message-s");
expect(await guilds.get("guild-1")).toMatchObject({
  notificationChannelId: "channel-n",
  subscriptionChannelId: "channel-s",
  subscriptionMessageId: "message-s",
});

await roles.upsert({ guildId: "guild-1", teamKey: "t1", teamName: "T1", roleId: "role-1" });
expect(await roles.find("guild-1", "t1")).toMatchObject({ roleId: "role-1" });

await matches.upsertMany([match]);
expect(await matches.findReminderDue(new Date("2026-09-05T09:30:00Z")))
  .toEqual([match]);

expect(await deliveries.claim("guild-1", "match-1", "reminder", now)).toBe(true);
expect(await deliveries.claim("guild-1", "match-1", "reminder", now)).toBe(false);
await deliveries.markSent("guild-1", "match-1", "reminder", "message-1", now);
```

Also assert that `markFailed` records a bounded error message and a future `next_attempt_at`, and that a stale `sending` record can be reclaimed.

- [ ] **Step 2: Run database tests and verify RED**

Run: `TEST_DATABASE_URL=postgresql://lck_bot:test@127.0.0.1:5433/lck_bot_test pnpm test:db`

Expected: FAIL because repository modules are missing.

- [ ] **Step 3: Implement repositories with parameterized SQL**

Use `pool.query(sql, values)` for isolated statements. Use one checked-out client for the delivery claim transaction. Convert snake_case rows explicitly rather than exposing database rows:

```ts
function toGuildConfig(row: GuildConfigRow): GuildConfig {
  return {
    guildId: row.guild_id,
    notificationChannelId: row.notification_channel_id,
    subscriptionChannelId: row.subscription_channel_id,
    subscriptionMessageId: row.subscription_message_id,
  };
}
```

`findReminderDue(now)` uses:

```sql
WHERE is_nullified = false
  AND scheduled_at > $1
  AND scheduled_at <= $1 + interval '30 minutes'
ORDER BY scheduled_at ASC
```

`claim` inserts a `sending` row with `ON CONFLICT DO NOTHING`; it can update a `failed` row whose `next_attempt_at <= now()` or a `sending` row whose `claimed_at` is older than ten minutes. Return `true` only when one row was inserted or updated.

- [ ] **Step 4: Verify GREEN**

Run: `TEST_DATABASE_URL=postgresql://lck_bot:test@127.0.0.1:5433/lck_bot_test pnpm test:db`

Expected: all migration and repository tests PASS.

- [ ] **Step 5: Stop the disposable test database**

Run: `docker stop lck-bot-postgres-test`

Expected: the named container stops and is removed because it was started with `--rm`.

- [ ] **Step 6: Commit or review checkpoint**

```bash
git add src/db tests/db.integration.test.ts
git commit -m "feat: add PostgreSQL repositories"
```

---

### Task 4: Leaguepedia match states and team catalog

**Files:**
- Modify: `src/leaguepedia.ts`
- Modify: `tests/leaguepedia.test.ts`
- Create: `src/bot/types.ts`

**Interfaces:**
- Produces: `MatchState extends Match` with `team1Key`, `team2Key`, `winner`, `team1Score`, `team2Score`, `isNullified`.
- Produces: `fetchLeaguepediaMatchStates(range, fetcher?): Promise<MatchState[]>`.
- Produces: `extractLckTeams(matches): Team[]`, where `Team` is `{ key: string; name: string }`.

- [ ] **Step 1: Write failing parser and catalog tests**

Use rendered Cargo HTML containing `Winner`, both scores and `IsNullified`:

```ts
expect(parseLeaguepediaMatchStates(response)).toEqual([{
  id: "match-1",
  team1: "T1",
  team2: "Gen.G",
  team1Key: "t1",
  team2Key: "gen-g",
  startsAt: new Date("2026-09-05T08:00:00.000Z"),
  bestOf: 5,
  tournament: "LCK/2026 Season/Playoffs",
  winner: 1,
  team1Score: 3,
  team2Score: 2,
  isNullified: false,
}]);

expect(extractLckTeams(matches)).toEqual([
  { key: "gen-g", name: "Gen.G" },
  { key: "t1", name: "T1" },
]);
```

Add cases for missing scores, invalid winner, nullified match, duplicate team names and placeholder team names.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/leaguepedia.test.ts`

Expected: FAIL because state parsing and catalog extraction are absent.

- [ ] **Step 3: Extend the controlled Cargo query and parser**

Create a second URL builder that does not exclude nullified rows and includes aliases:

```ts
const resultFields = [
  "MS.Team1=Team1", "MS.Team2=Team2", "MS.DateTime_UTC=DateTimeUTC",
  "MS.BestOf=BestOf", "MS.OverviewPage=OverviewPage", "MS.MatchId=MatchId",
  "MS.Winner=Winner", "MS.Team1Score=Team1Score",
  "MS.Team2Score=Team2Score", "MS.IsNullified=IsNullified",
].join(",");
```

Normalize team keys with Unicode NFKD, lowercase, removal of combining marks, replacement of non-alphanumerics by `-`, and trimming of separators. Preserve original team names for display. Map `Winner` only from integers `1` or `2`; represent incomplete values by `null`.

Keep `fetchLeaguepediaMatches` behavior and its nullified-match exclusion unchanged for the weekly webhook.

- [ ] **Step 4: Verify GREEN and run live preview boundary**

Run:

```bash
pnpm exec vitest run tests/leaguepedia.test.ts tests/embed.test.ts
pnpm preview
```

Expected: tests PASS; preview prints the weekly embed and sends nothing.

- [ ] **Step 5: Commit or review checkpoint**

```bash
git add src/leaguepedia.ts src/bot/types.ts tests/leaguepedia.test.ts
git commit -m "feat: fetch LCK match results and teams"
```

---

### Task 5: Discord message builders

**Files:**
- Create: `src/bot/messages.ts`
- Create: `tests/messages.test.ts`

**Interfaces:**
- Consumes: `Team`, `StoredMatch`.
- Produces: `buildSubscriptionPanel(teams): MessageCreateOptions`.
- Produces: `buildReminderMessage(match, roleIds): MessageCreateOptions`.
- Produces: `buildResultMessage(match, roleIds): MessageCreateOptions`.

- [ ] **Step 1: Write failing payload tests using literal expectations**

```ts
const reminder = buildReminderMessage(match, ["role-t1", "role-geng"]);
expect(reminder.content).toBe("<@&role-t1> <@&role-geng>");
expect(reminder.allowedMentions).toEqual({ parse: [], roles: ["role-t1", "role-geng"] });
expect(reminder.embeds?.[0]?.description).toContain("<t:1788595200:F>");

const result = buildResultMessage({ ...match, winner: 1, team1Score: 3, team2Score: 2 }, ["role-t1"]);
expect(result.content).toBe("<@&role-t1>");
expect(result.embeds?.[0]?.description).toBe("||**T1 3 – 2 Gen.G**\nVainqueur : **T1**||");
expect(result.allowedMentions).toEqual({ parse: [], roles: ["role-t1"] });
```

For the panel, assert sorted team options, `customId: "lck-team-toggle"`, one selection maximum, and chunks of at most 25 options.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/messages.test.ts`

Expected: FAIL because `src/bot/messages.ts` is absent.

- [ ] **Step 3: Implement pure builders**

Use discord.js builders but return serializable `MessageCreateOptions`. Deduplicate role IDs before both content and `allowedMentions`. Build the Leaguepedia URL safely:

```ts
function leaguepediaPageUrl(page: string): string {
  return `https://lol.fandom.com/wiki/${encodeURIComponent(page.replaceAll(" ", "_"))}`;
}

function discordTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1_000)}:F>`;
}
```

The reminder and result builders read `scheduledAt`, `overviewPage`, team names, keys and result fields from `StoredMatch`; the weekly webhook continues to use the existing `Match` shape independently.

Do not accept arbitrary mention strings; only format validated Discord role IDs supplied by the adapter.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/messages.test.ts`

Expected: all message payload tests PASS.

- [ ] **Step 5: Commit or review checkpoint**

```bash
git add src/bot/messages.ts tests/messages.test.ts
git commit -m "feat: build subscription and match notifications"
```

---

### Task 6: Team role subscription service

**Files:**
- Create: `src/bot/role-service.ts`
- Create: `src/bot/discord-adapter.ts`
- Create: `tests/helpers/fakes.ts`
- Create: `tests/role-service.test.ts`

**Interfaces:**
- Consumes: `TeamRoleRepository`, `Team`.
- Produces port `RoleGateway` with `findRole`, `findRoleByName`, `createRole`, `memberHasRole`, `addRole`, `removeRole`, `canManageRole`.
- Produces: `RoleService.toggle(guildId, userId, team): Promise<{ action: "added" | "removed"; roleId: string }>`.

Define the Discord role boundary explicitly:

```ts
export interface ManagedRole { id: string; name: string }

export interface CreateManagedRole {
  guildId: string;
  name: string;
  permissions: [];
  color: null;
  hoist: false;
  mentionable: false;
}

export interface RoleGateway {
  findRole(guildId: string, roleId: string): Promise<ManagedRole | null>;
  findRoleByName(guildId: string, name: string): Promise<ManagedRole | null>;
  createRole(input: CreateManagedRole): Promise<ManagedRole>;
  canManageRole(guildId: string, roleId: string): Promise<boolean>;
  memberHasRole(guildId: string, userId: string, roleId: string): Promise<boolean>;
  addRole(guildId: string, userId: string, roleId: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string): Promise<void>;
}
```

Define the Discord role boundary explicitly:

```ts
export interface ManagedRole { id: string; name: string }
export interface CreateManagedRole {
  guildId: string;
  name: string;
  permissions: [];
  color: null;
  hoist: false;
  mentionable: false;
}
export interface RoleGateway {
  findRole(guildId: string, roleId: string): Promise<ManagedRole | null>;
  findRoleByName(guildId: string, name: string): Promise<ManagedRole | null>;
  createRole(input: CreateManagedRole): Promise<ManagedRole>;
  canManageRole(guildId: string, roleId: string): Promise<boolean>;
  memberHasRole(guildId: string, userId: string, roleId: string): Promise<boolean>;
  addRole(guildId: string, userId: string, roleId: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing behavior tests against a stateful fake gateway**

```ts
it("creates a safe role and subscribes a member", async () => {
  const result = await service.toggle("guild-1", "user-1", { key: "t1", name: "T1" });
  expect(result).toEqual({ action: "added", roleId: "created-role-1" });
  expect(gateway.createdRoles).toEqual([{
    guildId: "guild-1", name: "LCK · T1", permissions: [], color: null,
    hoist: false, mentionable: false,
  }]);
  expect(gateway.rolesFor("guild-1", "user-1")).toContain("created-role-1");
});

it("removes an existing subscription on the next selection", async () => {
  await service.toggle("guild-1", "user-1", team);
  expect(await service.toggle("guild-1", "user-1", team))
    .toMatchObject({ action: "removed" });
});
```

Add tests for mapped role reuse, deleted role recreation, same-name role reuse, unmanageable hierarchy and isolation across guild IDs.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/role-service.test.ts`

Expected: FAIL because `RoleService` is absent.

- [ ] **Step 3: Implement the orchestration service**

Resolve a role in this order: mapped ID, exact safe name, creation. Verify manageability before changing the member. Persist a new or recovered mapping before assigning the role. Return a French, user-safe domain error for `ManageRoles` or hierarchy failures.

Adapter creation uses:

```ts
await guild.roles.create({
  name: `LCK · ${team.name}`,
  permissions: [],
  color: null,
  hoist: false,
  mentionable: false,
  reason: "Abonnement LCK créé par le bot",
});
```

Use Discord REST-backed role add/remove operations so the design does not require caching every guild member.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/role-service.test.ts`

Expected: all role lifecycle tests PASS.

- [ ] **Step 5: Commit or review checkpoint**

```bash
git add src/bot/role-service.ts src/bot/discord-adapter.ts tests/helpers/fakes.ts tests/role-service.test.ts
git commit -m "feat: toggle team subscriptions with Discord roles"
```

---

### Task 7: Admin commands, panel lifecycle, and interaction routing

**Files:**
- Create: `src/bot/panel-service.ts`
- Create: `src/bot/commands.ts`
- Create: `src/bot/interactions.ts`
- Create: `src/bot/register-commands.ts`
- Create: `tests/panel-service.test.ts`
- Create: `tests/commands.test.ts`

**Interfaces:**
- Consumes: repositories, `RoleService`, message builders, Leaguepedia team catalog.
- Produces: `CONFIG_COMMAND_JSON`, `handleConfigCommand(interaction, dependencies)`.
- Produces: `PanelService.publishOrUpdate(guildId, channelId, teams): Promise<string>`.
- Produces: `handleInteraction(interaction, dependencies): Promise<void>`.

- [ ] **Step 1: Write failing command and panel tests**

Assert the actual interaction-visible outcomes:

```ts
expect(CONFIG_COMMAND_JSON.name).toBe("config");
expect(CONFIG_COMMAND_JSON.default_member_permissions)
  .toBe(PermissionFlagsBits.ManageGuild.toString());

await handleConfigCommand(nonAdminInteraction, dependencies);
expect(nonAdminInteraction.lastReply).toEqual({
  content: "La permission « Gérer le serveur » est requise.", ephemeral: true,
});

await panel.publishOrUpdate("guild-1", "channel-1", teams);
expect(gateway.sentMessages).toHaveLength(1);
await panel.publishOrUpdate("guild-1", "channel-1", teams);
expect(gateway.editedMessages).toHaveLength(1);
```

Add tests for deleted panel recreation, wrong channel type, missing bot permissions, menu add/remove ephemeral confirmations and unknown team keys.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/commands.test.ts tests/panel-service.test.ts`

Expected: FAIL because commands and services are absent.

- [ ] **Step 3: Define `/config` and the persistent custom ID**

Use one command with two subcommands, each having one required channel option restricted to text-capable guild channels:

```ts
new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure les fonctionnalités LCK")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) => sub
    .setName("notifications")
    .setDescription("Choisit le salon des rappels et résultats")
    .addChannelOption((option) => option
      .setName("salon")
      .setDescription("Salon des notifications")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)))
  .addSubcommand((sub) => sub
    .setName("abonnements")
    .setDescription("Publie le panneau d'abonnement")
    .addChannelOption((option) => option
      .setName("salon")
      .setDescription("Salon du panneau")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)));
```

Use `lck-team-toggle` as a stable `custom_id`; no in-memory collector is allowed, so interactions keep working after restart.

- [ ] **Step 4: Implement handlers and REST registration**

`register-commands.ts` loads `loadBotConfig`, creates `REST({ version: "10" }).setToken(token)`, then writes either the guild route when `DISCORD_GUILD_ID` exists or the global application route otherwise. It prints only the registration scope and command count.

All replies to configuration and selection interactions are ephemeral. Defer the reply before any Leaguepedia, database or role network operation likely to exceed one second.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm exec vitest run tests/commands.test.ts tests/panel-service.test.ts tests/role-service.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 6: Commit or review checkpoint**

```bash
git add src/bot tests/commands.test.ts tests/panel-service.test.ts
git commit -m "feat: add subscription panel and admin commands"
```

---

### Task 8: Match synchronization and notification worker

**Files:**
- Create: `src/bot/match-sync.ts`
- Create: `src/bot/notification-worker.ts`
- Create: `tests/match-sync.test.ts`
- Create: `tests/notification-worker.test.ts`
- Modify: `tests/helpers/fakes.ts`

**Interfaces:**
- Consumes: `fetchLeaguepediaMatchStates`, all repositories, Discord notification adapter and message builders.
- Produces: `MatchSync.sync(now): Promise<{ matches: number; teams: number }>`.
- Produces: `NotificationWorker.sendDueReminders(now): Promise<number>`.
- Produces: `NotificationWorker.refreshAndSendResults(now): Promise<number>`.

- [ ] **Step 1: Write failing synchronization tests**

```ts
const result = await sync.sync(new Date("2026-09-05T07:00:00Z"));
expect(result).toEqual({ matches: 2, teams: 3 });
expect(matches.values()).toContainEqual(expect.objectContaining({
  matchId: "match-1", scheduledAt: new Date("2026-09-05T08:00:00Z"),
}));
```

Add a second sync where the same match moves by one hour and a third where it becomes nullified. Assert the stored row is updated rather than duplicated.

- [ ] **Step 2: Write failing reminder and result tests**

Use a fixed clock and two configured guilds:

```ts
expect(await worker.sendDueReminders(new Date("2026-09-05T07:29:59Z"))).toBe(0);
expect(await worker.sendDueReminders(new Date("2026-09-05T07:30:00Z"))).toBe(2);
expect(await worker.sendDueReminders(new Date("2026-09-05T07:31:00Z"))).toBe(0);

expect(await worker.refreshAndSendResults(new Date("2026-09-05T10:00:00Z"))).toBe(2);
expect(notifier.messages[0]?.payload.embeds?.[0]?.description)
  .toContain("||**T1 3 – 2 Gen.G**");
```

Add cases for: no result yet, incomplete scores, annulled match, missing notification channel, only one known role, Discord send failure followed by retry, stale `sending` recovery, and failure in one guild not blocking another.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/match-sync.test.ts tests/notification-worker.test.ts`

Expected: FAIL because both worker classes are absent.

- [ ] **Step 4: Implement synchronization windows**

`sync(now)` fetches from 24 hours before `now` through 30 days after `now`, upserts every returned match, and returns the deduplicated catalog derived from the stored recent/upcoming matches. The result refresh fetches from 24 hours before `now` through `now`, so one Leaguepedia call updates every match currently susceptible de finir.

- [ ] **Step 5: Implement per-guild delivery flow**

For each due match and configured guild:

```ts
if (!(await deliveries.claim(guildId, match.matchId, kind, now))) continue;
try {
  const roles = await teamRoles.findForTeams(guildId, [match.team1Key, match.team2Key]);
  const messageId = await notifier.send(channelId, buildMessage(match, roles.map((r) => r.roleId)));
  await deliveries.markSent(guildId, match.matchId, kind, messageId, now);
  sent += 1;
} catch (error) {
  await deliveries.markFailed(guildId, match.matchId, kind, safeError(error), now);
}
```

Use a capped exponential retry schedule of 1, 2, 4, 8 then 15 minutes. Truncate stored errors to 1,000 characters. Continue the loop after a guild failure.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm exec vitest run tests/match-sync.test.ts tests/notification-worker.test.ts`

Expected: all scheduling, result and recovery tests PASS.

- [ ] **Step 7: Commit or review checkpoint**

```bash
git add src/bot/match-sync.ts src/bot/notification-worker.ts tests/match-sync.test.ts tests/notification-worker.test.ts tests/helpers/fakes.ts
git commit -m "feat: send LCK reminders and final results"
```

---

### Task 9: Runtime composition and graceful shutdown

**Files:**
- Create: `src/bot/runtime.ts`
- Modify: `src/index.ts`
- Create: `tests/runtime.test.ts`

**Interfaces:**
- Consumes: `BotConfig`, pool, repositories, Discord adapter and workers.
- Produces: `startBotRuntime(config): Promise<{ stop(): Promise<void> }>`.
- Keeps: Monday 08:00 `Europe/Paris` webhook cron in the same process.

- [ ] **Step 1: Write failing lifecycle tests**

Inject fake client, cron scheduler and pool boundaries:

```ts
const runtime = await startBotRuntime(config, fakes);
expect(fakes.client.loginTokens).toEqual(["discord-token"]);
expect(fakes.sync.calls).toHaveLength(1);
expect(fakes.crons.map((cron) => cron.expression)).toEqual([
  "*/15 * * * *", "* * * * *", "*/5 * * * *",
]);
await runtime.stop();
expect(fakes.crons.every((cron) => cron.stopped)).toBe(true);
expect(fakes.client.destroyed).toBe(true);
expect(fakes.poolClosed).toBe(true);
```

Also assert a second `stop()` is harmless and that an initial Leaguepedia failure is logged but does not prevent Discord startup.

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm exec vitest run tests/runtime.test.ts`

Expected: FAIL because `startBotRuntime` is absent.

- [ ] **Step 3: Implement runtime schedules with overlap protection**

Create named node-cron tasks:

```ts
cron.schedule("*/15 * * * *", () => guarded("match-sync", () => sync.sync(new Date())), { noOverlap: true });
cron.schedule("* * * * *", () => guarded("reminders", () => worker.sendDueReminders(new Date())), { noOverlap: true });
cron.schedule("*/5 * * * *", () => guarded("results", () => worker.refreshAndSendResults(new Date())), { noOverlap: true });
```

The real client uses only `GatewayIntentBits.Guilds`. Route `Events.InteractionCreate` into `handleInteraction`. Do not enable the privileged full member-list intent. Before constructing repositories, call `runMigrations(pool, resolve(process.cwd(), "migrations"))` so a fresh database is ready without a separate manual step.

Refactor `src/index.ts` so the existing weekly cron still calls `publishSchedule`, then start the bot runtime. Register `SIGINT` and `SIGTERM` handlers that call `stop` once and set a nonzero exit code only when shutdown fails.

- [ ] **Step 4: Verify GREEN and full unit suite**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: all tests PASS, TypeScript emits no error, build exits 0.

- [ ] **Step 5: Commit or review checkpoint**

```bash
git add src/index.ts src/bot/runtime.ts tests/runtime.test.ts
git commit -m "feat: run Discord bot alongside weekly webhook"
```

---

### Task 10: Docker Compose VPS deployment

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `compose.yaml`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces: `docker compose up -d --build` deployment.
- Consumes: compiled `dist/index.js`, `/app/migrations`, PostgreSQL volume `postgres_data`.

- [ ] **Step 1: Add a production multi-stage Dockerfile**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Add Compose with health and persistence**

```yaml
services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: lck_bot
      POSTGRES_USER: lck_bot
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lck_bot -d lck_bot"]
      interval: 5s
      timeout: 5s
      retries: 10
    volumes:
      - postgres_data:/var/lib/postgresql

  app:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgresql://lck_bot:${POSTGRES_PASSWORD}@postgres:5432/lck_bot
      TZ: Europe/Paris
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
```

Do not expose PostgreSQL to the public network. Add `node_modules`, `dist`, `.env`, `.git` and local logs to `.dockerignore`.

- [ ] **Step 3: Document Discord setup and operations**

README commands must be exact:

```bash
docker compose build
docker compose run --rm app node dist/bot/register-commands.js
docker compose up -d
docker compose logs -f app
docker compose exec postgres pg_dump -U lck_bot lck_bot > lck_bot_backup.sql
```

Document scopes `bot applications.commands`, required permissions, role hierarchy, creation of the two channels, `/config notifications`, `/config abonnements`, volume backup, upgrades and secret rotation. Keep `pnpm send` and `pnpm preview` documented for the existing webhook.

- [ ] **Step 4: Validate Docker artifacts**

Run:

```bash
docker compose config
docker compose build
docker compose up -d postgres
```

Expected: Compose configuration is valid, image builds, PostgreSQL reaches `healthy`, and no database port is published.

- [ ] **Step 5: Commit or review checkpoint**

```bash
git add Dockerfile .dockerignore compose.yaml .env.example README.md
git commit -m "chore: add Docker Compose deployment"
```

---

### Task 11: End-to-end verification in a private Discord guild

**Files:**
- Modify if needed: `README.md`
- Create: `scripts/verify-discord.ts`
- No automated test may contain production Discord credentials.

**Interfaces:**
- Verifies all user-visible acceptance criteria from the approved spec.

- [ ] **Step 1: Run every automated check with fresh output**

```bash
docker run --name lck-bot-postgres-test --rm -d -e POSTGRES_DB=lck_bot_test -e POSTGRES_USER=lck_bot -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:18-alpine
pnpm test
TEST_DATABASE_URL=postgresql://lck_bot:test@127.0.0.1:5433/lck_bot_test pnpm test:db
pnpm typecheck
pnpm build
pnpm preview
docker compose config
docker stop lck-bot-postgres-test
```

Expected: zero failed tests, typecheck/build exit 0, preview contains real LCK matches and sends nothing, Compose config exits 0.

- [ ] **Step 2: Register commands in the private test guild**

Set `DISCORD_GUILD_ID` to the test guild only, then run `pnpm register:commands`. Confirm `/config` appears immediately. Never use a production guild during this step.

- [ ] **Step 3: Exercise configuration and role lifecycle**

1. Run `/config notifications` with the private notification channel.
2. Run `/config abonnements` with the private subscription channel.
3. Select `T1`; confirm role `LCK · T1` is created safely and assigned.
4. Select `T1` again; confirm the same role is removed and no duplicate role exists.
5. Select two different teams successively; confirm both roles are held.
6. Delete one managed role, select the team again and confirm recreation.

- [ ] **Step 4: Create and run a guarded visual verification script**

The script must refuse to send unless `ALLOW_DISCORD_TEST_SEND=yes`, accept only `DISCORD_TEST_CHANNEL_ID`, and reuse the production message builders. Its fixed fixture is:

```ts
const fixture: StoredMatch = {
  matchId: "manual-visual-check",
  team1Key: "t1",
  team1Name: "T1",
  team2Key: "gen-g",
  team2Name: "Gen.G",
  scheduledAt: new Date(Date.now() + 30 * 60 * 1_000),
  bestOf: 5,
  overviewPage: "LCK/2026 Season",
  isNullified: false,
  winner: 1,
  team1Score: 3,
  team2Score: 2,
};

if (process.env.ALLOW_DISCORD_TEST_SEND !== "yes") {
  throw new Error("Envoi de test Discord non autorisé");
}
```

Send one reminder payload and one result payload to the private channel with an empty role list. The script never reads the production notification channel from PostgreSQL. Run it only after explicit confirmation:

```bash
ALLOW_DISCORD_TEST_SEND=yes pnpm tsx scripts/verify-discord.ts
```

Confirm:

- one reminder and one result appear in the private channel ;
- the score and winner remain hidden until the spoiler is clicked ;
- the date is localized by Discord.

The automated worker tests from Task 8, rather than this visual script, prove duplicate suppression and restricted role mentions.

- [ ] **Step 5: Restore production-safe state and inspect logs**

Remove fixture deliveries and test roles only from the private guild, restart the Compose stack, and confirm logs contain no Discord token, webhook secret or PostgreSQL password.

- [ ] **Step 6: Final commit or review checkpoint**

```bash
git add README.md scripts/verify-discord.ts
git commit -m "docs: add Discord bot verification runbook"
```
