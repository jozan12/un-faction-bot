const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits
} = require("discord.js");
const sqlite3 = require("sqlite3").verbose();

// ================= CONFIG =================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const config = { token: process.env.TOKEN };

// ================= DATABASE =================
const db = new sqlite3.Database("./database.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS factions (
    name TEXT PRIMARY KEY,
    points INTEGER DEFAULT 0,
    leader TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    faction TEXT,
    last_checkin TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wars (
    faction1 TEXT,
    faction2 TEXT,
    active INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS trusted_roles (
    guild_id TEXT PRIMARY KEY,
    role_id TEXT
  )`);
});

// ================= FACTION STRUCTURE =================
async function createFactionStructure(guild, name) {
  const role = await guild.roles.create({ name, mentionable: true });

  const category = await guild.channels.create({
    name: `${name.toUpperCase()} FACTION`,
    type: 4,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
      { id: role.id, allow: ["ViewChannel"] }
    ]
  });

  await guild.channels.create({
    name: `${name}-chat`,
    type: 0,
    parent: category.id
  });
}

async function deleteFactionStructure(guild, name) {
  const role = guild.roles.cache.find(r => r.name === name);
  if (role) await role.delete();

  const category = guild.channels.cache.find(
    c => c.name === `${name.toUpperCase()} FACTION`
  );
  if (category) {
    for (const ch of guild.channels.cache.filter(c => c.parentId === category.id).values()) {
      await ch.delete();
    }
    await category.delete();
  }
}

// ================= PERMISSION CHECK =================
async function canUseCommand(interaction) {
  const member = interaction.member;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  return new Promise(resolve => {
    db.get(
      "SELECT role_id FROM trusted_roles WHERE guild_id = ?",
      [interaction.guild.id],
      (e, row) => {
        if (!row) return resolve(false);
        resolve(member.roles.cache.has(row.role_id));
      }
    );
  });
}

// ================= BOT READY =================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("faction-create")
      .setDescription("Create a faction")
      .addStringOption(o => o.setName("name").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("faction-delete")
      .setDescription("Delete a faction")
      .addStringOption(o => o.setName("name").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("faction-leader")
      .setDescription("Assign faction leader")
      .addUserOption(o => o.setName("user").setRequired(true))
      .addStringOption(o => o.setName("faction").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("faction-join")
      .setDescription("Join a faction")
      .addStringOption(o => o.setName("name").setRequired(true)),

    new SlashCommandBuilder()
      .setName("faction-leave")
      .setDescription("Leave your faction"),

    new SlashCommandBuilder()
      .setName("faction-add")
      .setDescription("Add a member to a faction")
      .addUserOption(o => o.setName("user").setRequired(true))
      .addStringOption(o => o.setName("faction").setRequired(true)),

    new SlashCommandBuilder()
      .setName("faction-remove")
      .setDescription("Remove a member from their faction")
      .addUserOption(o => o.setName("user").setRequired(true)),

    new SlashCommandBuilder()
      .setName("faction-info")
      .setDescription("Get info about a faction")
      .addStringOption(o => o.setName("name").setRequired(true)),

    // ✅ NEW COMMAND (SAFE ADDITION)
    new SlashCommandBuilder()
      .setName("faction-members")
      .setDescription("List all members of a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("checkin").setDescription("Daily faction check-in"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("View faction leaderboard"),
    new SlashCommandBuilder().setName("weekly-reset").setDescription("Reset faction points weekly")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("war-declare")
      .setDescription("Declare war")
      .addStringOption(o => o.setName("enemy").setRequired(true)),

    new SlashCommandBuilder().setName("war-list").setDescription("View all active wars"),

    new SlashCommandBuilder()
      .setName("set-trusted-role")
      .setDescription("Set trusted role")
      .addRoleOption(o => o.setName("role").setRequired(true)),

    new SlashCommandBuilder().setName("remove-trusted-role").setDescription("Remove trusted role"),
    new SlashCommandBuilder().setName("help").setDescription("Show help")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(config.token);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Commands registered");
});

// ================= COMMAND HANDLER =================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {

    // ✅ NEW HANDLER (SAFE)
    if (interaction.commandName === "faction-members") {
      const name = interaction.options.getString("name");

      db.all(
        "SELECT user_id FROM users WHERE faction = ?",
        [name],
        (err, rows) => {
          if (!rows || rows.length === 0)
            return interaction.reply(`❌ No members found in **${name}**`);

          const list = rows.map(r => `<@${r.user_id}>`).join("\n");
          interaction.reply(`**👥 ${name} Members (${rows.length})**\n${list}`);
        }
      );
    }

  } catch (err) {
    console.error(err);
    interaction.reply({ content: "❌ Something went wrong", ephemeral: true });
  }
});

// ================= LOGIN =================
client.login(config.token);
