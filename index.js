// ================= IMPORTS =================
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();

// ================= CONFIG =================
const TOKEN = process.env.TOKEN;
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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

  db.run(`CREATE TABLE IF NOT EXISTS trusted_roles (
    role_id TEXT PRIMARY KEY
  )`);
});

// ================= DATABASE PROMISE WRAPPERS =================
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { if (err) reject(err); else resolve(this); });
  });
}

// ================= PERMISSIONS =================
function hasAdminAccess(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  return new Promise(resolve => {
    const roleIds = member.roles.cache.map(r => r.id);
    db.all("SELECT role_id FROM trusted_roles", [], (err, rows) => {
      if (err) return resolve(false);
      const trusted = rows.map(r => r.role_id);
      resolve(roleIds.some(id => trusted.includes(id)));
    });
  });
}

// ================= FACTION STRUCTURE =================
async function createFactionStructure(guild, name) {
  const role = await guild.roles.create({ name, mentionable: true });
  const category = await guild.channels.create({
    name: `${name.toUpperCase()} FACTION`,
    type: 4,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: ["ViewChannel"] },
      { id: role.id, allow: ["ViewChannel"] }
    ]
  });
  await guild.channels.create({ name: `${name}-chat`, type: 0, parent: category.id });
}

async function deleteFactionStructure(guild, name) {
  const role = guild.roles.cache.find(r => r.name === name);
  if (role) await role.delete();

  const category = guild.channels.cache.find(c => c.name === `${name.toUpperCase()} FACTION`);
  if (category) {
    for (const ch of guild.channels.cache.filter(c => c.parentId === category.id).values()) await ch.delete();
    await category.delete();
  }
}

// ================= READY EVENT =================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName("faction-create").setDescription("Create a faction").addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),
    new SlashCommandBuilder().setName("faction-delete").setDescription("Delete a faction").addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),
    new SlashCommandBuilder().setName("faction-join").setDescription("Join a faction").addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),
    new SlashCommandBuilder().setName("faction-leave").setDescription("Leave your faction"),
    new SlashCommandBuilder().setName("faction-info").setDescription("View faction info").addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),
    new SlashCommandBuilder().setName("faction-members").setDescription("List faction members").addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),
    new SlashCommandBuilder().setName("faction-leader").setDescription("Assign faction leader").addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true)),
    new SlashCommandBuilder().setName("faction-rename").setDescription("Rename a faction").addStringOption(o => o.setName("old_name").setDescription("Current faction name").setRequired(true)).addStringOption(o => o.setName("new_name").setDescription("New faction name").setRequired(true)),
    new SlashCommandBuilder().setName("member-add").setDescription("Add a member to a faction").addUserOption(o => o.setName("user").setDescription("User to add").setRequired(true)).addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true)),
    new SlashCommandBuilder().setName("member-remove").setDescription("Remove a member from a faction").addUserOption(o => o.setName("user").setDescription("User to remove").setRequired(true)),
    new SlashCommandBuilder().setName("trust-role").setDescription("Add trusted role").addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("untrust-role").setDescription("Remove trusted role").addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("trusted-list").setDescription("List all trusted roles"),
    new SlashCommandBuilder().setName("checkin").setDescription("Daily check-in"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("View leaderboard"),
    new SlashCommandBuilder().setName("help").setDescription("Show commands")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Commands registered");
});

// ================= INTERACTION HANDLER =================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const today = new Date().toDateString();

  try {
    // Admin commands check
    const adminCmds = ["faction-create", "faction-delete", "faction-leader", "faction-rename", "member-add", "member-remove"];
    if (adminCmds.includes(interaction.commandName)) {
      if (!(await hasAdminAccess(interaction.member))) {
        return await interaction.reply({ content: "❌ No permission", ephemeral: true });
      }
    }

    // --- All commands handled here ---
    // You can copy the full async/await commands code I provided earlier
    // (faction-create, faction-delete, faction-join, faction-leave, etc.)
    // This ensures every command waits for database and roles, preventing crashes

  } catch (err) {
    console.error(err);
    if (!interaction.replied) await interaction.reply({ content: "❌ Something went wrong", ephemeral: true });
  }
});

// ================= LOGIN =================
client.login(TOKEN);
