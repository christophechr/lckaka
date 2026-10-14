import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it } from "vitest";

import {
  ALL_COMMANDS_JSON,
  CONFIG_COMMAND_JSON,
  getCommandRoute,
  handleConfigCommand,
  type ConfigCommandDependencies,
} from "../src/bot/commands.js";

interface FakeOptions {
  getSubcommand(): string;
  getChannel(): { id: string };
}

function fakeInteraction(input: {
  admin: boolean;
  subcommand?: string;
}): ChatInputCommandInteraction & { replies: unknown[] } {
  const replies: unknown[] = [];
  return {
    guildId: "guild-1",
    memberPermissions: {
      has: (permission: bigint) => input.admin && permission === PermissionFlagsBits.ManageGuild,
    },
    options: {
      getSubcommand: () => input.subcommand ?? "notifications",
      getChannel: () => ({ id: "channel-1" }),
    } as FakeOptions,
    reply: async (payload: unknown) => {
      replies.push(payload);
      return undefined;
    },
    deferReply: async (payload: unknown) => {
      replies.push(payload);
      return undefined;
    },
    editReply: async (payload: unknown) => {
      replies.push(payload);
      return undefined;
    },
    replies,
  } as unknown as ChatInputCommandInteraction & { replies: unknown[] };
}

function dependencies(): ConfigCommandDependencies & {
  notificationChannels: string[];
  panelChannels: string[];
} {
  const notificationChannels: string[] = [];
  const panelChannels: string[] = [];
  return {
    notificationChannels,
    panelChannels,
    guildConfigs: {
      setNotificationChannel: async (_guildId, channelId) => {
        notificationChannels.push(channelId);
      },
    },
    matchCatalog: {
      listTeams: async () => [
        { key: "gen-g", name: "Gen.G" },
        { key: "t1", name: "T1" },
      ],
    },
    panels: {
      publishOrUpdate: async (_guildId, channelId) => {
        panelChannels.push(channelId);
        return "message-1";
      },
      ensureChannel: async () => undefined,
    },
  };
}

describe("Discord config command", () => {
  it("declares ManageGuild and both channel subcommands", () => {
    expect(CONFIG_COMMAND_JSON.name).toBe("config");
    expect(CONFIG_COMMAND_JSON.default_member_permissions).toBe(
      PermissionFlagsBits.ManageGuild.toString(),
    );
    expect(CONFIG_COMMAND_JSON.options?.map((option) => option.name)).toEqual([
      "notifications",
      "abonnements",
    ]);
  });

  it("registers config and all public counter commands", () => {
    expect(ALL_COMMANDS_JSON.map((command) => command.name)).toEqual([
      "config",
      "ping",
      "add_drooler",
      "drooler",
      "add_hans",
      "hans_maga",
      "classement",
    ]);
    expect(
      ALL_COMMANDS_JSON.find((command) => command.name === "add_drooler")
        ?.default_member_permissions,
    ).toBeUndefined();
  });

  it("uses a guild route for development and a global route otherwise", () => {
    expect(getCommandRoute("client-1", "guild-1")).toBe(
      "/applications/client-1/guilds/guild-1/commands",
    );
    expect(getCommandRoute("client-1")).toBe("/applications/client-1/commands");
  });

  it("rejects a member without ManageGuild", async () => {
    const interaction = fakeInteraction({ admin: false });

    await handleConfigCommand(interaction, dependencies());

    expect(interaction.replies).toEqual([
      {
        content: "La permission « Gérer le serveur » est requise.",
        flags: 64,
      },
    ]);
  });

  it("stores the notification channel for an administrator", async () => {
    const interaction = fakeInteraction({ admin: true, subcommand: "notifications" });
    const deps = dependencies();

    await handleConfigCommand(interaction, deps);

    expect(deps.notificationChannels).toEqual(["channel-1"]);
    expect(interaction.replies.at(-1)).toEqual({
      content: "Salon de notifications configuré : <#channel-1>.",
    });
  });

  it("publishes the subscription panel for an administrator", async () => {
    const interaction = fakeInteraction({ admin: true, subcommand: "abonnements" });
    const deps = dependencies();

    await handleConfigCommand(interaction, deps);

    expect(deps.panelChannels).toEqual(["channel-1"]);
    expect(interaction.replies.at(-1)).toEqual({
      content: "Panneau d'abonnement configuré : <#channel-1>.",
    });
  });
});
