const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const config = require("./config.json");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

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

client.once("ready", async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("faction-create")
      .setDescription("Create a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder()
      .setName("faction-join")
      .setDescription("Join a faction")
      .addStringOption(o => o.setName("name").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder()
      .setName("checkin")
      .setDescription("Daily faction check-in"),

    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("Faction leaderboard")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(config.token);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Slash commands registered");
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const today = new Date().toDateString();

  if (interaction.commandName === "faction-create") {
    const name = interaction.options.getString("name");

    db.run("INSERT INTO factions (name) VALUES (?)", [name], err => {
      if (err) return interaction.reply({ content: "❌ Faction already exists", ephemeral: true });
      interaction.reply(`✅ Faction **${name}** created`);
    });
  }

  if (interaction.commandName === "faction-join") {
    const name = interaction.options.getString("name");

    db.get("SELECT * FROM factions WHERE name = ?", [name], (err, row) => {
      if (!row) return interaction.reply({ content: "❌ Faction not found", ephemeral: true });

      db.run(
        "INSERT OR REPLACE INTO users (user_id, faction, last_checkin) VALUES (?, ?, ?)",
        [userId, name, ""]
      );

      interaction.reply(`✅ You joined **${name}**`);
    });
  }

  if (interaction.commandName === "checkin") {
    db.get("SELECT * FROM users WHERE user_id = ?", [userId], (err, user) => {
      if (!user) return interaction.reply({ content: "❌ You are not in a faction", ephemeral: true });
      if (user.last_checkin === today)
        return interaction.reply({ content: "⏳ You already checked in today", ephemeral: true });

      db.run("UPDATE users SET last_checkin = ? WHERE user_id = ?", [today, userId]);
      db.run("UPDATE factions SET points = points + 10 WHERE name = ?", [user.faction]);

      interaction.reply(`🔥 Check-in successful! **${user.faction}** gains +10 points`);
    });
  }

  if (interaction.commandName === "leaderboard") {
    db.all("SELECT * FROM factions ORDER BY points DESC", [], (err, rows) => {
      let msg = "**🏆 Faction Leaderboard**\n";
      rows.forEach((f, i) => msg += `${i + 1}. ${f.name} — ${f.points} pts\n`);
      interaction.reply(msg);
    });
  }
});

client.login(config.token);
