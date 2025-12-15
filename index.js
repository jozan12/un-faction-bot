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
});

// ================= FACTION STRUCTURE =================
async function createFactionStructure(guild, name) {
  const role = await guild.roles.create({ name, mentionable: true });

  const category = await guild.channels.create({
    name: `${name.toUpperCase()} FACTION`,
    type: 4, // Category
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
      { id: role.id, allow: ["ViewChannel"] }
    ]
  });

  await guild.channels.create({
    name: `${name}-chat`,
    type: 0, // Text channel
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

// ================= BOT READY =================
client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("faction-create")
      .setDescription("Create a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("faction-delete")
      .setDescription("Delete a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("faction-join")
      .setDescription("Join a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder()
      .setName("faction-leave")
      .setDescription("Leave your faction"),

    new SlashCommandBuilder()
      .setName("faction-leader")
      .setDescription("Assign faction leader")
      .addUserOption(o => o.setName("user").setDescription("New leader").setRequired(true))
      .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("checkin")
      .setDescription("Daily faction check-in"),

    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("View faction leaderboard"),

    new SlashCommandBuilder()
      .setName("weekly-reset")
      .setDescription("Reset faction points weekly")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("war-declare")
      .setDescription("Declare war on another faction")
      .addStringOption(o => o.setName("enemy").setDescription("Enemy faction").setRequired(true)),

    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Show a list of all commands and their uses")
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
    // CREATE FACTION
    if (interaction.commandName === "faction-create") {
      const name = interaction.options.getString("name");
      db.run("INSERT INTO factions (name) VALUES (?)", [name], async err => {
        if (err) return interaction.reply({ content: "❌ Faction already exists", ephemeral: true });
        await createFactionStructure(interaction.guild, name);
        interaction.reply(`✅ Faction **${name}** created`);
      });
    }

    // DELETE FACTION
    if (interaction.commandName === "faction-delete") {
      const name = interaction.options.getString("name");
      await deleteFactionStructure(interaction.guild, name);
      db.run("DELETE FROM factions WHERE name = ?", [name]);
      db.run("UPDATE users SET faction = NULL WHERE faction = ?", [name]);
      interaction.reply(`🗑️ **${name}** deleted`);
    }

    // JOIN
    if (interaction.commandName === "faction-join") {
      const name = interaction.options.getString("name");

      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (e, u) => {
        if (u && u.faction === name) {
          return interaction.reply("❌ You are already in this faction");
        }

        if (u && u.faction) {
          return interaction.reply(`❌ You are already in faction **${u.faction}**. Leave it first using /faction-leave`);
        }

        const role = interaction.guild.roles.cache.find(r => r.name === name);
        if (!role) return interaction.reply(`❌ Faction **${name}** does not exist`);

        await interaction.member.roles.add(role);
        db.run("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [userId, name, u ? u.last_checkin : ""]);

        interaction.reply(`✅ Joined **${name}**`);
      });
    }

    // LEAVE
    if (interaction.commandName === "faction-leave") {
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ Not in a faction");
        const role = interaction.guild.roles.cache.find(r => r.name === u.faction);
        if (role) await interaction.member.roles.remove(role);
        db.run("UPDATE users SET faction = NULL WHERE user_id = ?", [userId]);
        interaction.reply("✅ You left your faction");
      });
    }

    // LEADER ASSIGN
    if (interaction.commandName === "faction-leader") {
      const user = interaction.options.getUser("user");
      const faction = interaction.options.getString("faction");
      db.run("UPDATE factions SET leader = ? WHERE name = ?", [user.id, faction]);
      interaction.reply(`👑 <@${user.id}> is now leader of **${faction}**`);
    }

    // CHECK-IN
    if (interaction.commandName === "checkin") {
      db.get("SELECT * FROM users WHERE user_id = ?", [userId], (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ You are not in a faction");
        if (u.last_checkin === today) return interaction.reply("⏳ Already checked in today");
        db.run("UPDATE users SET last_checkin = ? WHERE user_id = ?", [today, userId]);
        db.run("UPDATE factions SET points = points + 10 WHERE name = ?", [u.faction]);
        interaction.reply("🔥 +10 points added to your faction");
      });
    }

    // WEEKLY RESET
    if (interaction.commandName === "weekly-reset") {
      db.run("UPDATE factions SET points = 0");
      interaction.reply("♻️ Weekly reset complete");
    }

    // LEADERBOARD
    if (interaction.commandName === "leaderboard") {
      db.all("SELECT * FROM factions ORDER BY points DESC", [], (e, rows) => {
        let msg = "**🏆 Faction Leaderboard**\n\n";
        rows.forEach((f, i) => msg += `${i + 1}. ${f.name} — ${f.points}\n`);
        interaction.reply(msg);
      });
    }

    // WAR
    if (interaction.commandName === "war-declare") {
      const enemy = interaction.options.getString("enemy");
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ You are not in a faction");
        db.run("INSERT INTO wars VALUES (?, ?, 1)", [u.faction, enemy]);
        interaction.reply(`⚔️ **${u.faction}** declared war on **${enemy}**`);
      });
    }

    // HELP
    if (interaction.commandName === "help") {
      const helpMessage = `
**📜 Faction Bot Commands**

**/faction-create [name]** – Create a new faction (Admin only)  
**/faction-delete [name]** – Delete a faction (Admin only)  
**/faction-join [name]** – Join a faction (must leave old faction first)  
**/faction-leave** – Leave your current faction  
**/faction-leader [user] [faction]** – Assign a faction leader (Admin only)  
**/checkin** – Daily faction check-in to earn points  
**/leaderboard** – View the faction leaderboard  
**/weekly-reset** – Reset all faction points (Admin only)  
**/war-declare [enemy]** – Declare war on another faction  
**/help** – Show this help message
      `;
      interaction.reply({ content: helpMessage, ephemeral: true });
    }

  } catch (err) {
    console.error("Error handling interaction:", err);
    interaction.reply({ content: "❌ Something went wrong", ephemeral: true });
  }
});

// ================= LOGIN =================
client.login(config.token);
