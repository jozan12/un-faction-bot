const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  EmbedBuilder
} = require("discord.js");
const sqlite3 = require("sqlite3").verbose();

// ================= CONFIG =================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const TOKEN = process.env.TOKEN;

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

// ================= READY =================
client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName("faction-create").setDescription("Create a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("faction-delete").setDescription("Delete a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("faction-join").setDescription("Join a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("faction-leave").setDescription("Leave your faction"),

    new SlashCommandBuilder().setName("faction-info").setDescription("View faction info")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("faction-members").setDescription("List faction members")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("faction-leader").setDescription("Assign faction leader")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
      .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("trust-role").setDescription("Add trusted role")
      .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder().setName("untrust-role").setDescription("Remove trusted role")
      .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder().setName("checkin").setDescription("Daily check-in"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("View leaderboard"),
    new SlashCommandBuilder().setName("war-declare").setDescription("Declare war")
      .addStringOption(o => o.setName("enemy").setDescription("Enemy faction").setRequired(true)),

    new SlashCommandBuilder().setName("help").setDescription("Show commands")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Commands registered");
});

// ================= COMMANDS =================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const today = new Date().toDateString();

  // ---------- ADMIN GATE ----------
  const adminCmds = ["faction-create", "faction-delete", "faction-leader"];
  if (adminCmds.includes(interaction.commandName)) {
    if (!(await hasAdminAccess(interaction.member)))
      return interaction.reply({ content: "❌ No permission", ephemeral: true });
  }

  // ---------- JOIN (NO DOUBLE) ----------
  if (interaction.commandName === "faction-join") {
    const name = interaction.options.getString("name");
    db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (e, r) => {
      if (r && r.faction)
        return interaction.reply({ content: "❌ Leave your faction first", ephemeral: true });

      const role = interaction.guild.roles.cache.find(r => r.name === name);
      if (!role)
        return interaction.reply({ content: "❌ Faction not found", ephemeral: true });

      await interaction.member.roles.add(role);
      db.run("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [userId, name, ""]);
      interaction.reply(`✅ Joined **${name}**`);
    });
  }

  // ---------- FACTION INFO (EMBED) ----------
  if (interaction.commandName === "faction-info") {
    const name = interaction.options.getString("name");
    db.get("SELECT * FROM factions WHERE name = ?", [name], (e, f) => {
      if (!f) return interaction.reply({ content: "❌ Faction not found", ephemeral: true });

      db.get("SELECT COUNT(*) as c FROM users WHERE faction = ?", [name], (e, c) => {
        const embed = new EmbedBuilder()
          .setTitle(`🏰 ${f.name}`)
          .addFields(
            { name: "👑 Leader", value: f.leader ? `<@${f.leader}>` : "None", inline: true },
            { name: "👥 Members", value: `${c.c}`, inline: true },
            { name: "⭐ Points", value: `${f.points}`, inline: true }
          )
          .setColor(0x2ecc71);

        interaction.reply({ embeds: [embed] });
      });
    });
  }

  // ---------- FACTION MEMBERS (EMBED) ----------
  if (interaction.commandName === "faction-members") {
    const name = interaction.options.getString("name");
    db.all("SELECT user_id FROM users WHERE faction = ?", [name], (e, rows) => {
      if (!rows || rows.length === 0)
        return interaction.reply({ content: "❌ No members found", ephemeral: true });

      const members = rows.map(u => `<@${u.user_id}>`).join("\n");
      const embed = new EmbedBuilder()
        .setTitle(`👥 Members of ${name}`)
        .setDescription(members)
        .setColor(0x3498db);

      interaction.reply({ embeds: [embed] });
    });
  }

  // ---------- LEADERBOARD (EMBED) ----------
  if (interaction.commandName === "leaderboard") {
    db.all("SELECT * FROM factions ORDER BY points DESC", [], (e, rows) => {
      const text = rows.map((f, i) => `${i + 1}. **${f.name}** — ${f.points}`).join("\n");
      const embed = new EmbedBuilder()
        .setTitle("🏆 Faction Leaderboard")
        .setDescription(text)
        .setColor(0xf1c40f);

      interaction.reply({ embeds: [embed] });
    });
  }

  // ---------- HELP (EMBED) ----------
  if (interaction.commandName === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📜 UN Faction Bot Commands")
      .setDescription(
        "**Faction**\n" +
        "/faction-join\n/faction-leave\n/faction-info\n/faction-members\n/checkin\n/leaderboard\n/war-declare\n\n" +
        "**Admin / Trusted**\n" +
        "/faction-create\n/faction-delete\n/faction-leader\n\n" +
        "**Admin Only**\n" +
        "/trust-role\n/untrust-role"
      )
      .setColor(0x95a5a6);

    interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// ================= LOGIN =================
client.login(TOKEN);
