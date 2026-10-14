import { PermissionFlagsBits, type Client, type MessageCreateOptions } from "discord.js";
import { describe, expect, it } from "vitest";

import { DiscordAdapter } from "../src/bot/discord-adapter.js";

describe("DiscordAdapter", () => {
  it("maps role and message operations onto one guild", async () => {
    const memberRoleIds = new Set<string>();
    const sent: MessageCreateOptions[] = [];
    const edited: MessageCreateOptions[] = [];
    const permissionChecks: bigint[][] = [];
    const role = { id: "role-1", name: "LCK · T1", editable: true };
    const member = {
      roles: {
        cache: { has: (id: string) => memberRoleIds.has(id) },
        add: async (id: string) => memberRoleIds.add(id),
        remove: async (id: string) => memberRoleIds.delete(id),
      },
    };
    const channel = {
      isTextBased: () => true,
      isSendable: () => true,
      send: async (payload: MessageCreateOptions) => {
        sent.push(payload);
        return { id: "message-1" };
      },
      messages: {
        fetch: async () => ({ edit: async (payload: MessageCreateOptions) => edited.push(payload) }),
      },
      permissionsFor: () => ({
        has: (permissions: bigint[]) => {
          permissionChecks.push(permissions);
          return true;
        },
      }),
    };
    const guild = {
      roles: {
        fetch: async () => role,
        cache: { find: () => role },
        create: async () => role,
      },
      members: {
        fetch: async () => member,
        fetchMe: async () => ({ id: "bot" }),
      },
      channels: { fetch: async () => channel },
    };
    const client = {
      guilds: { fetch: async () => guild },
      channels: { fetch: async () => channel },
      application: {
        emojis: {
          fetch: async () =>
            new Map([
              ["emoji-1", { id: "emoji-1", name: "lck_t1" }],
            ]),
          create: async ({ name }: { name: string }) => ({ id: "emoji-2", name }),
          delete: async () => undefined,
        },
      },
    } as unknown as Client;
    const adapter = new DiscordAdapter(client);

    expect(await adapter.findRole("guild-1", "role-1")).toEqual({
      id: "role-1",
      name: "LCK · T1",
    });
    await adapter.addRole("guild-1", "user-1", "role-1");
    expect(await adapter.memberHasRole("guild-1", "user-1", "role-1")).toBe(true);
    await adapter.removeRole("guild-1", "user-1", "role-1");
    expect(await adapter.memberHasRole("guild-1", "user-1", "role-1")).toBe(false);

    expect(await adapter.sendMessage("channel-1", { content: "test" })).toBe("message-1");
    expect(await adapter.editMessage("channel-1", "message-1", { content: "updated" })).toBe(
      true,
    );
    expect(sent).toEqual([{ content: "test" }]);
    expect(edited).toEqual([{ content: "updated" }]);

    await adapter.ensureUsableTextChannel("guild-1", "channel-1", true);
    expect(permissionChecks.at(-1)).toContain(PermissionFlagsBits.MentionEveryone);

    expect(await adapter.listApplicationEmojis()).toEqual([
      { id: "emoji-1", name: "lck_t1" },
    ]);
    expect(await adapter.createApplicationEmoji("lck_geng", Buffer.from("image"))).toEqual({
      id: "emoji-2",
      name: "lck_geng",
    });
    await expect(adapter.deleteApplicationEmoji("emoji-1")).resolves.toBeUndefined();
  });
  it("treats a deleted subscription channel as successful panel cleanup", async () => {
    const client = { channels: { fetch: async () => { throw { code: 10003 }; } } } as unknown as Client;
    await expect(new DiscordAdapter(client).deleteMessage("deleted-channel", "old-panel")).resolves.toBeUndefined();
  });

  it("retains permission failures when removing a panel", async () => {
    const client = { channels: { fetch: async () => { throw { code: 50001 }; } } } as unknown as Client;
    await expect(new DiscordAdapter(client).deleteMessage("private-channel", "old-panel")).rejects.toEqual({ code: 50001 });
  });

});
