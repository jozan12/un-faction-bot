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
    role_id TEXT PRIMARY KEY
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

// ================= UTILITY =================
async function isTrusted(interaction) {
  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const roles = await new Promise(resolve => {
    db.all("SELECT role_id FROM trusted_roles", [], (err, rows) => resolve(rows || []));
  });
  return interaction.member.roles.cache.some(r => roles.some(tr => tr.role_id === r.id));
}

// ================= SYNC EXISTING FACTIONS =================
async function syncFactionsWithDB(guild) {
  guild.roles.cache.forEach(role => {
    if (role.name === "@everyone") return;
    const category = guild.channels.cache.find(c => c.name === `${role.name.toUpperCase()} FACTION`);
    if (!category) return;
    db.run("INSERT OR IGNORE INTO factions (name, points) VALUES (?, ?)", [role.name, 0], err => {
      if (err) console.error("Error syncing faction:", role.name, err);
    });
  });
  console.log("✅ Faction roles synced with database");
}

// ================= BOT READY =================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.first(); // Your main server
  await syncFactionsWithDB(guild);

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
      .setDescription("Show a list of all commands and their uses"),

    new SlashCommandBuilder()
      .setName("faction-add-member")
      .setDescription("Add a member to a faction")
      .addUserOption(o => o.setName("user").setDescription("Member to add").setRequired(true))
      .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder()
      .setName("faction-remove-member")
      .setDescription("Remove a member from a faction")
      .addUserOption(o => o.setName("user").setDescription("Member to remove").setRequired(true))
      .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder()
      .setName("faction-info")
      .setDescription("Get info about a faction")
      .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder()
      .setName("faction-members")
      .setDescription("List all members of a faction")
      .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder()
      .setName("trust-role")
      .setDescription("Add a role that can use all commands")
      .addRoleOption(o => o.setName("role").setDescription("Role to trust").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
    // ===== CORE COMMANDS =====
    if (interaction.commandName === "faction-create") {
      const name = interaction.options.getString("name");
      db.run("INSERT INTO factions (name) VALUES (?)", [name], async err => {
        if (err) return interaction.reply({ content: "❌ Faction already exists", ephemeral: true });
        await createFactionStructure(interaction.guild, name);
        interaction.reply(`✅ Faction **${name}** created`);
      });
    }
    else if (interaction.commandName === "faction-delete") {
      const name = interaction.options.getString("name");
      await deleteFactionStructure(interaction.guild, name);
      db.run("DELETE FROM factions WHERE name = ?", [name]);
      db.run("UPDATE users SET faction = NULL WHERE faction = ?", [name]);
      interaction.reply(`🗑️ **${name}** deleted`);
    }
    else if (interaction.commandName === "faction-join") {
      const name = interaction.options.getString("name");
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (e, u) => {
        if (u && u.faction === name) return interaction.reply("❌ Already in this faction");
        if (u && u.faction) return interaction.reply(`❌ Already in **${u.faction}**. Leave first`);
        const role = interaction.guild.roles.cache.find(r => r.name === name);
        if (!role) return interaction.reply(`❌ Faction **${name}** does not exist`);
        await interaction.member.roles.add(role);
        db.run("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [userId, name, u ? u.last_checkin : ""]);
        interaction.reply(`✅ Joined **${name}**`);
      });
    }
    else if (interaction.commandName === "faction-leave") {
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ Not in a faction");
        const role = interaction.guild.roles.cache.find(r => r.name === u.faction);
        if (role) await interaction.member.roles.remove(role);
        db.run("UPDATE users SET faction = NULL WHERE user_id = ?", [userId]);
        interaction.reply("✅ Left your faction");
      });
    }
    else if (interaction.commandName === "faction-leader") {
      const user = interaction.options.getUser("user");
      const faction = interaction.options.getString("faction");
      db.run("UPDATE factions SET leader = ? WHERE name = ?", [user.id, faction]);
      interaction.reply(`👑 <@${user.id}> is now leader of **${faction}**`);
    }
    else if (interaction.commandName === "checkin") {
      db.get("SELECT * FROM users WHERE user_id = ?", [userId], (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ Not in a faction");
        if (u.last_checkin === today) return interaction.reply("⏳ Already checked in today");
        db.run("UPDATE users SET last_checkin = ? WHERE user_id = ?", [today, userId]);
        db.run("UPDATE factions SET points = points + 10 WHERE name = ?", [u.faction]);
        interaction.reply("🔥 +10 points added to your faction");
      });
    }
    else if (interaction.commandName === "weekly-reset") {
      db.run("UPDATE factions SET points = 0");
      interaction.reply("♻️ Weekly reset complete");
    }
    else if (interaction.commandName === "leaderboard") {
      db.all("SELECT * FROM factions ORDER BY points DESC", [], (e, rows) => {
        let msg = "**🏆 Faction Leaderboard**\n\n";
        rows.forEach((f, i) => msg += `${i + 1}. ${f.name} — ${f.points}\n`);
        interaction.reply(msg);
      });
    }
    else if (interaction.commandName === "war-declare") {
      const enemy = interaction.options.getString("enemy");
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ Not in a faction");
        db.run("INSERT INTO wars VALUES (?, ?, 1)", [u.faction, enemy]);
        interaction.reply(`⚔️ **${u.faction}** declared war on **${enemy}**`);
      });
    }
    else if (interaction.commandName === "help") {
      const helpMessage = `
**📜 Faction Bot Commands**

**/faction-create [name]** – Create a new faction (Admin only)  
**/faction-delete [name]** – Delete a faction (Admin only)  
**/faction-join [name]** – Join a faction  
**/faction-leave** – Leave your faction  
**/faction-leader [user] [faction]** – Assign a faction leader (Admin only)  
**/checkin** – Daily faction check-in  
**/leaderboard** – View faction leaderboard  
**/weekly-reset** – Reset all faction points (Admin only)  
**/war-declare [enemy]** – Declare war  
**/faction-add-member [user] [faction]** – Add member (Admin/Trusted)  
**/faction-remove-member [user] [faction]** – Remove member (Admin/Trusted)  
**/faction-info [faction]** – Faction details  
**/faction-members [faction]** – List all members  
**/trust-role [role]** – Assign trusted role (Admin only)  
**/help** – Show this help message
      `;
      interaction.reply({ content: helpMessage, ephemeral: true });
    }

    // ===== ADMIN/TRUSTED COMMANDS =====
    else if (interaction.commandName === "faction-add-member") {
      if (!(await isTrusted(interaction))) return interaction.reply("❌ You cannot use this command");
      const user = interaction.options.getUser("user");
      const faction = interaction.options.getString("faction");
      db.get("SELECT faction FROM users WHERE user_id = ?", [user.id], async (e, u) => {
        if (u && u.faction) return interaction.reply(`❌ Already in **${u.faction}**`);
        const role = interaction.guild.roles.cache.find(r => r.name === faction);
        if (!role) return interaction.reply("❌ Faction not found");
        await interaction.guild.members.fetch(user.id);
        await interaction.guild.members.cache.get(user.id).roles.add(role);
        db.run("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [user.id, faction, ""]);
        interaction.reply(`✅ Added <@${user.id}> to **${faction}**`);
      });
    }
    else if (interaction.commandName === "faction-remove-member") {
      if (!(await isTrusted(interaction))) return interaction.reply("❌ You cannot use this command");
      const user = interaction.options.getUser("user");
      const faction = interaction.options.getString("faction");
      db.get("SELECT faction FROM users WHERE user_id = ?", [user.id], async (e, u) => {
        if (!u || u.faction !== faction) return interaction.reply("❌ Member not in this faction");
        const role = interaction.guild.roles.cache.find(r => r.name === faction);
        if (role) await interaction.guild.members.fetch(user.id).then(m => m.roles.remove(role));
        db.run("UPDATE users SET faction = NULL WHERE user_id = ?", [user.id]);
        interaction.reply(`🗑️ Removed <@${user.id}> from **${faction}**`);
      });
    }
    else if (interaction.commandName === "faction-info") {
      const faction = interaction.options.getString("faction");
      db.get("SELECT * FROM factions WHERE name = ?", [faction], (e, f) => {
        if (!f) return interaction.reply("❌ Faction not found");
        db.all("SELECT user_id FROM users WHERE faction = ?", [faction], (err, members) => {
          interaction.reply(`
**Faction:** ${f.name}
**Leader:** ${f.leader ? `<@${f.leader}>` : "None"}
**Points:** ${f.points}
**Members:** ${members.length}
          `);
        });
      });
    }
    else if (interaction.commandName === "faction-members") {
      const faction = interaction.options.getString("faction");
      db.all("SELECT user_id FROM users WHERE faction = ?", [faction], (err, members) => {
        if (!members || members.length === 0) return interaction.reply("❌ No members found");
        interaction.reply(`**Members of ${faction}:**\n${members.map(m => `<@${m.user_id}>`).join("\n")}`);
      });
    }
    else if (interaction.commandName === "trust-role") {
      const role = interaction.options.getRole("role");
      db.run("INSERT OR REPLACE INTO trusted_roles VALUES (?)", [role.id]);
      interaction.reply(`✅ Role **${role.name}** is now trusted`);
    }

  } catch (err) {
    console.error("Error handling interaction:", err);
    interaction.reply({ content: "❌ Something went wrong", ephemeral: true });
  }
});

// ================= LOGIN =================
client.login(config.token);
