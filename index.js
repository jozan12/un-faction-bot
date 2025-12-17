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
  // Factions
  db.run(`CREATE TABLE IF NOT EXISTS factions (
    name TEXT PRIMARY KEY,
    points INTEGER DEFAULT 0,
    leader TEXT
  )`);

  // Users
  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    faction TEXT,
    last_checkin TEXT
  )`);

  // Wars
  db.run(`CREATE TABLE IF NOT EXISTS wars (
    faction1 TEXT,
    faction2 TEXT,
    active INTEGER
  )`);

  // Trusted Roles
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
    db.get("SELECT role_id FROM trusted_roles WHERE guild_id = ?", [interaction.guild.id], (e, row) => {
      if (!row) return resolve(false);
      const role = interaction.guild.roles.cache.get(row.role_id);
      if (role && member.roles.cache.has(role.id)) return resolve(true);
      resolve(false);
    });
  });
}

// ================= BOT READY =================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    // Factions
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
      .setName("faction-leader")
      .setDescription("Assign faction leader")
      .addUserOption(o => o.setName("user").setDescription("New leader").setRequired(true))
      .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("faction-join")
      .setDescription("Join a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder()
      .setName("faction-leave")
      .setDescription("Leave your faction"),

    new SlashCommandBuilder()
      .setName("faction-add")
      .setDescription("Add a member to a faction")
      .addUserOption(o => o.setName("user").setDescription("User to add").setRequired(true))
      .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder()
      .setName("faction-remove")
      .setDescription("Remove a member from their faction")
      .addUserOption(o => o.setName("user").setDescription("User to remove").setRequired(true)),

    new SlashCommandBuilder()
      .setName("faction-info")
      .setDescription("Get info about a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    // Check-ins
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

    // Wars
    new SlashCommandBuilder()
      .setName("war-declare")
      .setDescription("Declare war on another faction")
      .addStringOption(o => o.setName("enemy").setDescription("Enemy faction").setRequired(true)),

    new SlashCommandBuilder()
      .setName("war-list")
      .setDescription("View all active wars"),

    // Trusted role
    new SlashCommandBuilder()
      .setName("set-trusted-role")
      .setDescription("Set a role that can use all admin commands")
      .addRoleOption(o => o.setName("role").setDescription("Role to grant permissions").setRequired(true)),

    new SlashCommandBuilder()
      .setName("remove-trusted-role")
      .setDescription("Remove the trusted role"),

    // Help
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
    // ======= FACTION CREATE =======
    if (interaction.commandName === "faction-create") {
      if (!await canUseCommand(interaction)) return interaction.reply({ content: "❌ You do not have permission", ephemeral: true });
      const name = interaction.options.getString("name");
      db.run("INSERT INTO factions (name) VALUES (?)", [name], async err => {
        if (err) return interaction.reply({ content: "❌ Faction already exists", ephemeral: true });
        await createFactionStructure(interaction.guild, name);
        interaction.reply(`✅ Faction **${name}** created`);
      });
    }

    // ======= FACTION DELETE =======
    if (interaction.commandName === "faction-delete") {
      if (!await canUseCommand(interaction)) return interaction.reply({ content: "❌ You do not have permission", ephemeral: true });
      const name = interaction.options.getString("name");
      await deleteFactionStructure(interaction.guild, name);
      db.run("DELETE FROM factions WHERE name = ?", [name]);
      db.run("UPDATE users SET faction = NULL WHERE faction = ?", [name]);
      interaction.reply(`🗑️ **${name}** deleted`);
    }

    // ======= ASSIGN LEADER =======
    if (interaction.commandName === "faction-leader") {
      if (!await canUseCommand(interaction)) return interaction.reply({ content: "❌ You do not have permission", ephemeral: true });
      const user = interaction.options.getUser("user");
      const faction = interaction.options.getString("faction");
      db.run("UPDATE factions SET leader = ? WHERE name = ?", [user.id, faction]);
      interaction.reply(`👑 <@${user.id}> is now leader of **${faction}**`);
    }

    // ======= JOIN FACTION =======
    if (interaction.commandName === "faction-join") {
      const name = interaction.options.getString("name");
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (e, u) => {
        if (u && u.faction === name) return interaction.reply("❌ You are already in this faction");
        if (u && u.faction) return interaction.reply(`❌ You are already in faction **${u.faction}**. Leave first using /faction-leave`);
        const role = interaction.guild.roles.cache.find(r => r.name === name);
        if (!role) return interaction.reply(`❌ Faction **${name}** does not exist`);
        await interaction.member.roles.add(role);
        db.run("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [userId, name, u ? u.last_checkin : ""]);
        interaction.reply(`✅ Joined **${name}**`);
      });
    }

    // ======= LEAVE FACTION =======
    if (interaction.commandName === "faction-leave") {
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ Not in a faction");
        const role = interaction.guild.roles.cache.find(r => r.name === u.faction);
        if (role) await interaction.member.roles.remove(role);
        db.run("UPDATE users SET faction = NULL WHERE user_id = ?", [userId]);
        interaction.reply("✅ You left your faction");
      });
    }

    // ======= ADD MEMBER =======
    if (interaction.commandName === "faction-add") {
      if (!await canUseCommand(interaction)) return interaction.reply({ content: "❌ You do not have permission", ephemeral: true });
      const user = interaction.options.getUser("user");
      const faction = interaction.options.getString("faction");
      db.get("SELECT faction FROM users WHERE user_id = ?", [user.id], async (e, u) => {
        if (u && u.faction) return interaction.reply("❌ User is already in a faction");
        const role = interaction.guild.roles.cache.find(r => r.name === faction);
        if (!role) return interaction.reply("❌ Faction does not exist");
        await interaction.guild.members.fetch(user.id).then(m => m.roles.add(role));
        db.run("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [user.id, faction, ""]);
        interaction.reply(`✅ Added <@${user.id}> to **${faction}**`);
      });
    }

    // ======= REMOVE MEMBER =======
    if (interaction.commandName === "faction-remove") {
      if (!await canUseCommand(interaction)) return interaction.reply({ content: "❌ You do not have permission", ephemeral: true });
      const user = interaction.options.getUser("user");
      db.get("SELECT faction FROM users WHERE user_id = ?", [user.id], async (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ User is not in a faction");
        const role = interaction.guild.roles.cache.find(r => r.name === u.faction);
        if (role) await interaction.guild.members.fetch(user.id).then(m => m.roles.remove(role));
        db.run("UPDATE users SET faction = NULL WHERE user_id = ?", [user.id]);
        interaction.reply(`✅ Removed <@${user.id}> from **${u.faction}**`);
      });
    }

    // ======= FACTION INFO =======
    if (interaction.commandName === "faction-info") {
      const name = interaction.options.getString("name");
      db.get("SELECT * FROM factions WHERE name = ?", [name], (err, f) => {
        if (!f) return interaction.reply("❌ Faction not found");
        db.get("SELECT COUNT(*) AS count FROM users WHERE faction = ?", [name], (err2, u) => {
          interaction.reply(`**Faction:** ${f.name}\n**Leader:** ${f.leader ? `<@${f.leader}>` : "None"}\n**Points:** ${f.points}\n**Members:** ${u.count}`);
        });
      });
    }

    // ======= CHECK-IN =======
    if (interaction.commandName === "checkin") {
      db.get("SELECT * FROM users WHERE user_id = ?", [userId], (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ You are not in a faction");
        if (u.last_checkin === today) return interaction.reply("⏳ Already checked in today");
        db.run("UPDATE users SET last_checkin = ? WHERE user_id = ?", [today, userId]);
        db.run("UPDATE factions SET points = points + 10 WHERE name = ?", [u.faction]);
        interaction.reply("🔥 +10 points added to your faction");
      });
    }

    // ======= WEEKLY RESET =======
    if (interaction.commandName === "weekly-reset") {
      if (!await canUseCommand(interaction)) return interaction.reply({ content: "❌ You do not have permission", ephemeral: true });
      db.run("UPDATE factions SET points = 0");
      interaction.reply("♻️ Weekly reset complete");
    }

    // ======= LEADERBOARD =======
    if (interaction.commandName === "leaderboard") {
      db.all("SELECT * FROM factions ORDER BY points DESC", [], (e, rows) => {
        let msg = "**🏆 Faction Leaderboard**\n\n";
        rows.forEach((f, i) => msg += `${i + 1}. ${f.name} — ${f.points}\n`);
        interaction.reply(msg);
      });
    }

    // ======= WAR DECLARE =======
    if (interaction.commandName === "war-declare") {
      const enemy = interaction.options.getString("enemy");
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ You are not in a faction");
        if (u.faction === enemy) return interaction.reply("❌ Cannot declare war on your own faction");

        db.get("SELECT * FROM wars WHERE (faction1 = ? AND faction2 = ?) OR (faction1 = ? AND faction2 = ?)", 
          [u.faction, enemy, enemy, u.faction], (err, war) => {
            if (war) return interaction.reply("❌ War already exists between these factions");
            db.run("INSERT INTO wars VALUES (?, ?, 1)", [u.faction, enemy]);
            interaction.reply(`⚔️ **${u.faction}** declared war on **${enemy}**`);
        });
      });
    }

    // ======= WAR LIST =======
    if (interaction.commandName === "war-list") {
      db.all("SELECT * FROM wars WHERE active = 1", [], (err, wars) => {
        if (wars.length === 0) return interaction.reply("✅ No active wars");
        let msg = "**⚔️ Active Wars:**\n";
        wars.forEach(w => msg += `• ${w.faction1} vs ${w.faction2}\n`);
        interaction.reply(msg);
      });
    }

    // ======= SET TRUSTED ROLE =======
    if (interaction.commandName === "set-trusted-role") {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can set trusted role", ephemeral: true });
      const role = interaction.options.getRole("role");
      db.run("INSERT OR REPLACE INTO trusted_roles (guild_id, role_id) VALUES (?, ?)", [interaction.guild.id, role.id]);
      interaction.reply(`✅ **${role.name}** is now the trusted role`);
    }

    // ======= REMOVE TRUSTED ROLE =======
    if (interaction.commandName === "remove-trusted-role") {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can remove trusted role", ephemeral: true });
      db.run("DELETE FROM trusted_roles WHERE guild_id = ?", [interaction.guild.id]);
      interaction.reply("✅ Trusted role removed");
    }

    // ======= HELP =======
    if (interaction.commandName === "help") {
      const helpMessage = `
**📜 Faction Bot Commands**

**/faction-create [name]** – Create a faction (Admin only)  
**/faction-delete [name]** – Delete a faction (Admin only)  
**/faction-leader [user] [faction]** – Assign a faction leader (Admin only)  
**/faction-join [name]** – Join a faction  
**/faction-leave** – Leave your current faction  
**/faction-add [user] [faction]** – Add member to a faction (Admin/Trusted)  
**/faction-remove [user]** – Remove member from a faction (Admin/Trusted)  
**/faction-info [name]** – View faction info  
**/checkin** – Daily check-in to earn points  
**/leaderboard** – View faction leaderboard  
**/weekly-reset** – Reset all faction points (Admin/Trusted)  
**/war-declare [enemy]** – Declare war on another faction  
**/war-list** – View all active wars  
**/set-trusted-role [role]** – Set a role to allow all admin commands (Admin only)  
**/remove-trusted-role** – Remove the trusted role (Admin only)  
**/help** – Show this message
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
