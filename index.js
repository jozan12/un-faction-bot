
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  REST,
  Routes
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
    faction TEXT
  )`);
});

// ================= FACTION STRUCTURE =================
async function createFactionStructure(guild, name) {
  const role = await guild.roles.create({
    name,
    mentionable: true
  });

  const category = await guild.channels.create({
    name: `${name.toUpperCase()} FACTION`,
    type: 4,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
      { id: role.id, allow: ["ViewChannel"] }
    ]
  });

  await guild.channels.create({
    name: "chat",
    type: 0,
    parent: category.id
  });
}

// ================= BOT READY =================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("faction-create")
      .setDescription("Create a faction")
      .addStringOption(o =>
        o.setName("name").setDescription("Faction name").setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("faction-join")
      .setDescription("Join a faction")
      .addStringOption(o =>
        o.setName("name").setDescription("Faction name").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("faction-leave")
      .setDescription("Leave your faction"),

    new SlashCommandBuilder()
      .setName("faction-info")
      .setDescription("View faction information")
      .addStringOption(o =>
        o.setName("name").setDescription("Faction name").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("faction-members")
      .setDescription("List faction members")
      .addStringOption(o =>
        o.setName("name").setDescription("Faction name").setRequired(true)
      )
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Slash commands registered");
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // 🔴 THIS LINE FIXES YOUR PROBLEM
  await interaction.deferReply();

  const userId = interaction.user.id;

  // ===== CREATE FACTION =====
  if (interaction.commandName === "faction-create") {
    const name = interaction.options.getString("name");

    db.run("INSERT INTO factions (name) VALUES (?)", [name], async err => {
      if (err) {
        return interaction.editReply("❌ Faction already exists.");
      }

      await createFactionStructure(interaction.guild, name);
      await interaction.editReply(`✅ Faction **${name}** created.`);
    });
  }

  // ===== JOIN FACTION (NO DOUBLE MEMBERSHIP) =====
  if (interaction.commandName === "faction-join") {
    const name = interaction.options.getString("name");

    db.get(
      "SELECT faction FROM users WHERE user_id = ?",
      [userId],
      async (_, row) => {
        if (row && row.faction) {
          return interaction.editReply(
            "❌ You are already in a faction. Leave it first."
          );
        }

        const role = interaction.guild.roles.cache.find(r => r.name === name);
        if (!role) {
          return interaction.editReply("❌ That faction does not exist.");
        }

        await interaction.member.roles.add(role);
        db.run("INSERT INTO users (user_id, faction) VALUES (?, ?)", [
          userId,
          name
        ]);

        await interaction.editReply(`✅ You joined **${name}**.`);
      }
    );
  }

  // ===== LEAVE FACTION =====
  if (interaction.commandName === "faction-leave") {
    db.get(
      "SELECT faction FROM users WHERE user_id = ?",
      [userId],
      async (_, row) => {
        if (!row || !row.faction) {
          return interaction.editReply("❌ You are not in a faction.");
        }

        const role = interaction.guild.roles.cache.find(
          r => r.name === row.faction
        );
        if (role) await interaction.member.roles.remove(role);

        db.run("DELETE FROM users WHERE user_id = ?", [userId]);
        await interaction.editReply("✅ You left your faction.");
      }
    );
  }

  // ===== FACTION INFO =====
  if (interaction.commandName === "faction-info") {
    const name = interaction.options.getString("name");

    db.get(
      "SELECT * FROM factions WHERE name = ?",
      [name],
      async (_, faction) => {
        if (!faction) {
          return interaction.editReply("❌ Faction not found.");
        }

        const embed = new EmbedBuilder()
          .setTitle(`🏳️ ${faction.name}`)
          .addFields(
            { name: "Points", value: String(faction.points), inline: true },
            {
              name: "Leader",
              value: faction.leader
                ? `<@${faction.leader}>`
                : "Not assigned",
              inline: true
            }
          )
          .setColor(0x2ecc71);

        await interaction.editReply({ embeds: [embed] });
      }
    );
  }

  // ===== FACTION MEMBERS =====
  if (interaction.commandName === "faction-members") {
    const name = interaction.options.getString("name");

    db.all(
      "SELECT user_id FROM users WHERE faction = ?",
      [name],
      async (_, rows) => {
        if (!rows.length) {
          return interaction.editReply("❌ No members found.");
        }

        const members = rows
          .map(r => `<@${r.user_id}>`)
          .join("\n");

        const embed = new EmbedBuilder()
          .setTitle(`👥 Members of ${name}`)
          .setDescription(members)
          .setColor(0x3498db);

        await interaction.editReply({ embeds: [embed] });
      }
    );
  }
});

// ================= LOGIN =================
client.login(TOKEN);
