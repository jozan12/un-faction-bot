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

// ================= PERMISSION CHECK =================
async function canUseCommand(interaction) {
  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  return new Promise(resolve => {
    db.get(
      "SELECT role_id FROM trusted_roles WHERE guild_id = ?",
      [interaction.guild.id],
      (e, row) => {
        if (!row) return resolve(false);
        resolve(interaction.member.roles.cache.has(row.role_id));
      }
    );
  });
}

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

  const category = guild.channels.cache.find(c => c.name === `${name.toUpperCase()} FACTION`);
  if (category) {
    guild.channels.cache
      .filter(c => c.parentId === category.id)
      .forEach(c => c.delete());
    await category.delete();
  }
}

// ================= BOT READY =================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName("faction-create").setDescription("Create a faction")
      .addStringOption(o => o.setName("name").setRequired(true)),

    new SlashCommandBuilder().setName("faction-delete").setDescription("Delete a faction")
      .addStringOption(o => o.setName("name").setRequired(true)),

    new SlashCommandBuilder().setName("faction-join").setDescription("Join a faction")
      .addStringOption(o => o.setName("name").setRequired(true)),

    new SlashCommandBuilder().setName("faction-leave").setDescription("Leave your faction"),

    new SlashCommandBuilder().setName("faction-add").setDescription("Add user to faction")
      .addUserOption(o => o.setName("user").setRequired(true))
      .addStringOption(o => o.setName("faction").setRequired(true)),

    new SlashCommandBuilder().setName("faction-remove").setDescription("Remove user from faction")
      .addUserOption(o => o.setName("user").setRequired(true)),

    new SlashCommandBuilder().setName("faction-leader").setDescription("Assign faction leader")
      .addUserOption(o => o.setName("user").setRequired(true))
      .addStringOption(o => o.setName("faction").setRequired(true)),

    new SlashCommandBuilder().setName("faction-info").setDescription("Faction info")
      .addStringOption(o => o.setName("name").setRequired(true)),

    new SlashCommandBuilder().setName("faction-members").setDescription("List faction members")
      .addStringOption(o => o.setName("name").setRequired(true)),

    new SlashCommandBuilder().setName("checkin").setDescription("Daily check-in"),

    new SlashCommandBuilder().setName("leaderboard").setDescription("View leaderboard"),

    new SlashCommandBuilder().setName("weekly-reset").setDescription("Reset points"),

    new SlashCommandBuilder().setName("war-declare").setDescription("Declare war")
      .addStringOption(o => o.setName("enemy").setRequired(true)),

    new SlashCommandBuilder().setName("war-list").setDescription("List wars"),

    new SlashCommandBuilder().setName("set-trusted-role").setDescription("Set trusted role")
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

  const userId = interaction.user.id;
  const today = new Date().toDateString();

  try {

    // ===== FACTION MEMBERS =====
    if (interaction.commandName === "faction-members") {
      const name = interaction.options.getString("name");

      db.all("SELECT user_id FROM users WHERE faction = ?", [name], async (e, rows) => {
        if (!rows || rows.length === 0)
          return interaction.reply(`❌ No members found in **${name}**`);

        let list = rows.map(r => `<@${r.user_id}>`).join("\n");
        interaction.reply(`**👥 ${name} Members (${rows.length})**\n${list}`);
      });
    }

    // ===== FACTION INFO =====
    if (interaction.commandName === "faction-info") {
      const name = interaction.options.getString("name");
      db.get("SELECT * FROM factions WHERE name = ?", [name], (e, f) => {
        if (!f) return interaction.reply("❌ Faction not found");
        db.get("SELECT COUNT(*) AS count FROM users WHERE faction = ?", [name], (e2, u) => {
          interaction.reply(
            `**Faction:** ${f.name}\n` +
            `**Leader:** ${f.leader ? `<@${f.leader}>` : "None"}\n` +
            `**Points:** ${f.points}\n` +
            `**Members:** ${u.count}`
          );
        });
      });
    }

    // ===== CHECK-IN =====
    if (interaction.commandName === "checkin") {
      db.get("SELECT * FROM users WHERE user_id = ?", [userId], (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ You are not in a faction");
        if (u.last_checkin === today) return interaction.reply("⏳ Already checked in today");
        db.run("UPDATE users SET last_checkin = ? WHERE user_id = ?", [today, userId]);
        db.run("UPDATE factions SET points = points + 10 WHERE name = ?", [u.faction]);
        interaction.reply("🔥 +10 points added");
      });
    }

    // ===== HELP =====
    if (interaction.commandName === "help") {
      interaction.reply({
        ephemeral: true,
        content: `
📜 **Faction Bot Commands**

/faction-create, /faction-delete  
/faction-join, /faction-leave  
/faction-add, /faction-remove  
/faction-leader  
/faction-info  
/faction-members  
/checkin  
/leaderboard  
/weekly-reset  
/war-declare, /war-list  
/set-trusted-role, /remove-trusted-role
        `
      });
    }

  } catch (err) {
    console.error(err);
    interaction.reply({ content: "❌ Error occurred", ephemeral: true });
  }
});

// ================= LOGIN =================
client.login(config.token);
