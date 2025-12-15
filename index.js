const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();

// Read token from Railway environment variable
const config = { token: process.env.TOKEN };

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ================= DATABASE =================
const db = new sqlite3.Database("./database.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS factions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    points INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    faction TEXT,
    last_checkin TEXT
  )`);
});

// ================= HELPER FUNCTION =================
async function createFactionStructure(guild, factionName) {
  // Create role
  const role = await guild.roles.create({
    name: factionName,
    mentionable: true
  });

  // Create private category
  const category = await guild.channels.create({
    name: `${factionName.toUpperCase()} FACTION`,
    type: 4, // Category
    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        deny: ["ViewChannel"]
      },
      {
        id: role.id,
        allow: ["ViewChannel"]
      }
    ]
  });

  // Create private text channel
  await guild.channels.create({
    name: `${factionName}-chat`,
    type: 0, // Text channel
    parent: category.id
  });

  return role;
}

// ================= BOT READY =================
client.once("ready", async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("faction-create")
      .setDescription("Create a faction")
      .addStringOption(o =>
        o.setName("name").setDescription("Faction name").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("faction-join")
      .setDescription("Join a faction")
      .addStringOption(o =>
        o.setName("name").setDescription("Faction name").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("checkin")
      .setDescription("Daily faction check-in"),

    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("View faction leaderboard")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(config.token);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Slash commands registered");
});

// ================= COMMAND HANDLER =================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const today = new Date().toDateString();

  // ---------- CREATE FACTION ----------
  if (interaction.commandName === "faction-create") {
    const name = interaction.options.getString("name");
    const guild = interaction.guild;

    db.run("INSERT INTO factions (name) VALUES (?)", [name], async err => {
      if (err) {
        return interaction.reply({ content: "❌ Faction already exists", ephemeral: true });
      }

      await createFactionStructure(guild, name);

      interaction.reply(`✅ Faction **${name}** created with role and private channels`);
    });
  }

  // ---------- JOIN FACTION ----------
  if (interaction.commandName === "faction-join") {
    const name = interaction.options.getString("name");
    const guild = interaction.guild;
    const member = interaction.member;

    db.get("SELECT * FROM factions WHERE name = ?", [name], async (err, row) => {
      if (!row) {
        return interaction.reply({ content: "❌ Faction not found", ephemeral: true });
      }

      const role = guild.roles.cache.find(r => r.name === name);
      if (role) {
        await member.roles.add(role);
      }

      db.run(
        "INSERT OR REPLACE INTO users (user_id, faction, last_checkin) VALUES (?, ?, ?)",
        [userId, name, ""]
      );

      interaction.reply(`✅ You joined **${name}**`);
    });
  }

  // ---------- DAILY CHECK-IN ----------
  if (interaction.commandName === "checkin") {
    db.get("SELECT * FROM users WHERE user_id = ?", [userId], (err, user) => {
      if (!user) {
        return interaction.reply({ content: "❌ You are not in a faction", ephemeral: true });
      }

      if (user.last_checkin === today) {
        return interaction.reply({ content: "⏳ You already checked in today", ephemeral: true });
      }

      db.run("UPDATE users SET last_checkin = ? WHERE user_id = ?", [today, userId]);
      db.run("UPDATE factions SET points = points + 10 WHERE name = ?", [user.faction]);

      interaction.reply(`🔥 Check-in successful! **${user.faction}** gains +10 points`);
    });
  }

  // ---------- LEADERBOARD ----------
  if (interaction.commandName === "leaderboard") {
    db.all("SELECT * FROM factions ORDER BY points DESC", [], (err, rows) => {
      let msg = "**🏆 Faction Leaderboard**\n\n";
      rows.forEach((f, i) => {
        msg += `${i + 1}. **${f.name}** — ${f.points} pts\n`;
      });

      interaction.reply(msg);
    });
  }
});

// ================= LOGIN =================
client.login(config.token);
