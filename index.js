const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
} = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const config = { token: process.env.TOKEN };

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const db = new sqlite3.Database("./database.db");

// ================= DATABASE =================
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
  // Check if role exists
  let role = guild.roles.cache.find(r => r.name === name);
  if (!role) role = await guild.roles.create({ name, mentionable: true });

  // Check if category exists
  let category = guild.channels.cache.find(c => c.name === `${name.toUpperCase()} FACTION`);
  if (!category) {
    category = await guild.channels.create({
      name: `${name.toUpperCase()} FACTION`,
      type: 4,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
        { id: role.id, allow: ["ViewChannel"] }
      ]
    });
  }

  // Create text channel if missing
  if (!guild.channels.cache.find(c => c.name === `${name}-chat` && c.parentId === category.id)) {
    await guild.channels.create({
      name: `${name}-chat`,
      type: 0,
      parent: category.id
    });
  }
}

async function deleteFactionStructure(guild, name) {
  const role = guild.roles.cache.find(r => r.name === name);
  if (role) await role.delete();

  const category = guild.channels.cache.find(c => c.name === `${name.toUpperCase()} FACTION`);
  if (category) {
    for (const ch of guild.channels.cache.filter(c => c.parentId === category.id).values()) {
      await ch.delete();
    }
    await category.delete();
  }
}

// ================= BOT READY =================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName("faction-create").setDescription("Create a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder().setName("faction-delete").setDescription("Delete a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder().setName("faction-join").setDescription("Join a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("faction-leave").setDescription("Leave your faction"),

    new SlashCommandBuilder().setName("faction-leader").setDescription("Assign faction leader")
      .addUserOption(o => o.setName("user").setDescription("New leader").setRequired(true))
      .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder().setName("checkin").setDescription("Daily faction check-in"),

    new SlashCommandBuilder().setName("leaderboard").setDescription("View faction leaderboard"),

    new SlashCommandBuilder().setName("weekly-reset").setDescription("Reset faction points weekly")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder().setName("war-declare").setDescription("Declare war on another faction")
      .addStringOption(o => o.setName("enemy").setDescription("Enemy faction").setRequired(true)),

    new SlashCommandBuilder().setName("faction-info").setDescription("Show info about a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("faction-members").setDescription("List members of a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("checkin-status").setDescription("Show check-in status of a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("add-trusted-role").setDescription("Add a trusted role that can use all commands")
      .addRoleOption(o => o.setName("role").setDescription("Role to add").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder().setName("remove-trusted-role").setDescription("Remove a trusted role")
      .addRoleOption(o => o.setName("role").setDescription("Role to remove").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder().setName("help").setDescription("Show a list of all commands and their uses")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(config.token);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Commands registered");
});

// ================= HELPER FUNCTIONS =================
function isAdminOrTrusted(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || 
    member.roles.cache.some(r => {
      let found = false;
      db.get("SELECT * FROM trusted_roles WHERE role_id = ?", [r.id], (err, row) => {
        if (row) found = true;
      });
      return found;
    });
}

// ================= AUTO REMINDER =================
setInterval(() => {
  const today = new Date().toDateString();
  db.all("SELECT * FROM users WHERE last_checkin != ?", [today], (err, rows) => {
    if (!rows) return;
    rows.forEach(user => {
      client.guilds.cache.forEach(guild => {
        const member = guild.members.cache.get(user.user_id);
        if (member) {
          member.send("⏰ Reminder: You haven't checked in to your faction today!");
        }
      });
    });
  });
}, 1000 * 60 * 60); // every hour

// ================= COMMAND HANDLER =================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const today = new Date().toDateString();
  const member = interaction.member;

  try {
    const adminOrTrusted = isAdminOrTrusted(member);

    // -------------- FACTION CREATE --------------
    if (interaction.commandName === "faction-create") {
      if (!adminOrTrusted) return interaction.reply("❌ You do not have permission");
      const name = interaction.options.getString("name");

      db.get("SELECT * FROM factions WHERE name = ?", [name], async (err, row) => {
        if (row) return interaction.reply("❌ Faction already exists");

        db.run("INSERT INTO factions (name) VALUES (?)", [name]);
        await createFactionStructure(interaction.guild, name);
        interaction.reply(`✅ Faction **${name}** created`);
      });
    }

    // -------------- FACTION DELETE --------------
    if (interaction.commandName === "faction-delete") {
      if (!adminOrTrusted) return interaction.reply("❌ You do not have permission");
      const name = interaction.options.getString("name");
      await deleteFactionStructure(interaction.guild, name);
      db.run("DELETE FROM factions WHERE name = ?", [name]);
      db.run("UPDATE users SET faction = NULL WHERE faction = ?", [name]);
      interaction.reply(`🗑️ **${name}** deleted`);
    }

    // -------------- FACTION JOIN --------------
    if (interaction.commandName === "faction-join") {
      const name = interaction.options.getString("name");
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (e, u) => {
        if (u && u.faction === name) return interaction.reply("❌ Already in this faction");
        if (u && u.faction) return interaction.reply(`❌ Leave **${u.faction}** first`);
        const role = interaction.guild.roles.cache.find(r => r.name === name);
        if (!role) return interaction.reply("❌ Faction does not exist");
        await member.roles.add(role);
        db.run("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [userId, name, u ? u.last_checkin : ""]);
        interaction.reply(`✅ Joined **${name}**`);
      });
    }

    // -------------- FACTION LEAVE --------------
    if (interaction.commandName === "faction-leave") {
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ Not in a faction");
        const role = interaction.guild.roles.cache.find(r => r.name === u.faction);
        if (role) await member.roles.remove(role);
        db.run("UPDATE users SET faction = NULL WHERE user_id = ?", [userId]);
        interaction.reply("✅ You left your faction");
      });
    }

    // -------------- FACTION LEADER --------------
    if (interaction.commandName === "faction-leader") {
      if (!adminOrTrusted) return interaction.reply("❌ You do not have permission");
      const user = interaction.options.getUser("user");
      const faction = interaction.options.getString("faction");
      db.run("UPDATE factions SET leader = ? WHERE name = ?", [user.id, faction]);
      interaction.reply(`👑 <@${user.id}> is now leader of **${faction}**`);
    }

    // -------------- CHECK-IN --------------
    if (interaction.commandName === "checkin") {
      db.get("SELECT * FROM users WHERE user_id = ?", [userId], (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ Not in a faction");
        if (u.last_checkin === today) return interaction.reply("⏳ Already checked in today");
        db.run("UPDATE users SET last_checkin = ? WHERE user_id = ?", [today, userId]);
        db.run("UPDATE factions SET points = points + 10 WHERE name = ?", [u.faction]);
        interaction.reply("🔥 +10 points added to your faction");
      });
    }

    // -------------- WEEKLY RESET --------------
    if (interaction.commandName === "weekly-reset") {
      if (!adminOrTrusted) return interaction.reply("❌ You do not have permission");
      db.run("UPDATE factions SET points = 0");
      interaction.reply("♻️ Weekly reset complete");
    }

    // -------------- LEADERBOARD --------------
    if (interaction.commandName === "leaderboard") {
      db.all("SELECT * FROM factions ORDER BY points DESC", [], (e, rows) => {
        let msg = "**🏆 Faction Leaderboard**\n\n";
        rows.forEach((f, i) => msg += `${i + 1}. ${f.name} — ${f.points}\n`);
        interaction.reply(msg);
      });
    }

    // -------------- WAR DECLARE --------------
    if (interaction.commandName === "war-declare") {
      const enemy = interaction.options.getString("enemy");
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], (e, u) => {
        if (!u || !u.faction) return interaction.reply("❌ Not in a faction");
        db.run("INSERT INTO wars VALUES (?, ?, 1)", [u.faction, enemy]);
        interaction.reply(`⚔️ **${u.faction}** declared war on **${enemy}**`);
      });
    }

    // -------------- FACTION INFO --------------
    if (interaction.commandName === "faction-info") {
      const name = interaction.options.getString("name");
      db.get("SELECT * FROM factions WHERE name = ?", [name], (e, f) => {
        if (!f) return interaction.reply("❌ Faction not found");
        db.all("SELECT user_id FROM users WHERE faction = ?", [name], (e2, members) => {
          const leaderMention = f.leader ? `<@${f.leader}>` : "No leader";
          const memberList = members.map(m => `<@${m.user_id}>`).join(", ") || "No members";
          interaction.reply(`**Faction:** ${f.name}\n**Points:** ${f.points}\n**Leader:** ${leaderMention}\n**Members:** ${memberList}`);
        });
      });
    }

    // -------------- FACTION MEMBERS --------------
    if (interaction.commandName === "faction-members") {
      const name = interaction.options.getString("name");
      db.all("SELECT user_id FROM users WHERE faction = ?", [name], (e, members) => {
        if (!members.length) return interaction.reply("❌ No members in this faction");
        const memberList = members.map(m => `<@${m.user_id}>`).join(", ");
        interaction.reply(`**Members of ${name}:**\n${memberList}`);
      });
    }

    // -------------- CHECK-IN STATUS --------------
    if (interaction.commandName === "checkin-status") {
      const name = interaction.options.getString("name");
      db.all("SELECT * FROM users WHERE faction = ?", [name], (e, members) => {
        if (!members.length) return interaction.reply("❌ No members in this faction");
        const checkedIn = members.filter(m => m.last_checkin === today).map(m => `<@${m.user_id}>`).join(", ") || "None";
        const notCheckedIn = members.filter(m => m.last_checkin !== today).map(m => `<@${m.user_id}>`).join(", ") || "None";
        interaction.reply(`**Checked in:** ${checkedIn}\n**Not checked in:** ${notCheckedIn}`);
      });
    }

    // -------------- ADD TRUSTED ROLE --------------
    if (interaction.commandName === "add-trusted-role") {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply("❌ Admin only");
      const role = interaction.options.getRole("role");
      db.run("INSERT OR IGNORE INTO trusted_roles VALUES (?)", [role.id]);
      interaction.reply(`✅ Role **${role.name}** added as trusted`);
    }

    // -------------- REMOVE TRUSTED ROLE --------------
    if (interaction.commandName === "remove-trusted-role") {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply("❌ Admin only");
      const role = interaction.options.getRole("role");
      db.run("DELETE FROM trusted_roles WHERE role_id = ?", [role.id]);
      interaction.reply(`✅ Role **${role.name}** removed from trusted`);
    }

    // -------------- HELP --------------
    if (interaction.commandName === "help") {
      const helpMessage = `
**📜 Faction Bot Commands**

**/faction-create [name]** – Create a new faction (Admin/Trusted only)  
**/faction-delete [name]** – Delete a faction (Admin/Trusted only)  
**/faction-join [name]** – Join a faction (must leave old faction first)  
**/faction-leave** – Leave your current faction  
**/faction-leader [user] [faction]** – Assign a faction leader (Admin/Trusted only)  
**/faction-info [name]** – Show faction details  
**/faction-members [name]** – List members of a faction  
**/checkin-status [name]** – Show check-in status  
**/checkin** – Daily faction check-in  
**/leaderboard** – View the faction leaderboard  
**/weekly-reset** – Reset all faction points (Admin/Trusted only)  
**/war-declare [enemy]** – Declare war on another faction  
**/add-trusted-role [role]** – Add a trusted role (Admin only)  
**/remove-trusted-role [role]** – Remove a trusted role (Admin only)  
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


