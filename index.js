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
const fetch = require("node-fetch");

// ================= CONFIG =================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const TOKEN = process.env.TOKEN;
const PNW_API_KEY = process.env.PNW_KEY; // Optional: server-wide PnW API key

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
    last_checkin TEXT,
    nation_id TEXT
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

// ================= PnW API =================
async function fetchNation(nationId) {
  const url = `https://www.politicsandwar.com/api/nation/id=${nationId}&key=${PNW_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch nation data");
  const data = await res.json();
  return data;
}

// ================= READY =================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    // --- Faction Commands ---
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

    new SlashCommandBuilder().setName("faction-rename").setDescription("Rename a faction")
      .addStringOption(o => o.setName("old_name").setDescription("Current name").setRequired(true))
      .addStringOption(o => o.setName("new_name").setDescription("New name").setRequired(true)),

    // --- Member Management ---
    new SlashCommandBuilder().setName("member-add").setDescription("Add a member to a faction")
      .addUserOption(o => o.setName("user").setDescription("User to add").setRequired(true))
      .addStringOption(o => o.setName("faction").setDescription("Faction name").setRequired(true)),

    new SlashCommandBuilder().setName("member-remove").setDescription("Remove a member from a faction")
      .addUserOption(o => o.setName("user").setDescription("User to remove").setRequired(true)),

    // --- Trusted Roles ---
    new SlashCommandBuilder().setName("trust-role").setDescription("Add trusted role")
      .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),

    new SlashCommandBuilder().setName("untrust-role").setDescription("Remove trusted role")
      .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),

    new SlashCommandBuilder().setName("trusted-list").setDescription("List all trusted roles"),

    // --- Check-in & Leaderboard ---
    new SlashCommandBuilder().setName("checkin").setDescription("Daily check-in"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("View leaderboard"),

    // --- Help ---
    new SlashCommandBuilder().setName("help").setDescription("Show commands"),

    // --- PnW API ---
    new SlashCommandBuilder().setName("register-nation").setDescription("Register your PnW nation")
      .addStringOption(o => o.setName("nation_id").setDescription("Your nation ID").setRequired(true)),

    new SlashCommandBuilder().setName("unregister-nation").setDescription("Unregister your PnW nation"),

    new SlashCommandBuilder().setName("nation-info").setDescription("Get info about a nation")
      .addStringOption(o => o.setName("nation_id").setDescription("Nation ID (optional)").setRequired(false)),

    new SlashCommandBuilder().setName("raid-target").setDescription("Suggest best raid target")
      .addStringOption(o => o.setName("faction").setDescription("Optional faction to avoid").setRequired(false))
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Commands registered");
});

// ================= COMMAND HANDLER =================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const today = new Date().toDateString();

  // ---------- ADMIN/TRUSTED CHECK ----------
  const adminCmds = ["faction-create","faction-delete","faction-leader","faction-rename","member-add","member-remove"];
  if (adminCmds.includes(interaction.commandName)) {
    if (!(await hasAdminAccess(interaction.member))) {
      return interaction.reply({ content: "❌ No permission", ephemeral: true });
    }
  }

  // ---------- FACTION JOIN ----------
  if (interaction.commandName === "faction-join") {
    const name = interaction.options.getString("name");
    db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (e,r) => {
      if (r && r.faction) return interaction.reply({ content: "❌ Leave your faction first", ephemeral: true });

      const role = interaction.guild.roles.cache.find(r => r.name === name);
      if (!role) return interaction.reply({ content: "❌ Faction not found", ephemeral: true });

      await interaction.member.roles.add(role);
      db.run("INSERT OR REPLACE INTO users VALUES (?, ?, ?, ?)", [userId, name, today, null]);
      interaction.reply(`✅ Joined **${name}**`);
    });
  }

  // ---------- FACTION LEAVE ----------
  if (interaction.commandName === "faction-leave") {
    db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (e,u) => {
      if (!u || !u.faction) return interaction.reply("❌ Not in faction");

      const role = interaction.guild.roles.cache.find(r => r.name === u.faction);
      if (role) await interaction.member.roles.remove(role);

      db.run("UPDATE users SET faction = NULL WHERE user_id = ?", [userId]);
      interaction.reply("✅ You left your faction");
    });
  }

  // ---------- FACTION INFO ----------
  if (interaction.commandName === "faction-info") {
    const name = interaction.options.getString("name");
    db.get("SELECT * FROM factions WHERE name = ?", [name], (e,f) => {
      if (!f) return interaction.reply({ content: "❌ Faction not found", ephemeral: true });
      db.get("SELECT COUNT(*) as c FROM users WHERE faction = ?", [name], (e,c) => {
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

  // ---------- FACTION MEMBERS ----------
  if (interaction.commandName === "faction-members") {
    const name = interaction.options.getString("name");
    db.all("SELECT user_id FROM users WHERE faction = ?", [name], (e,rows) => {
      if (!rows || rows.length === 0) return interaction.reply({ content: "❌ No members found", ephemeral: true });
      const members = rows.map(u => `<@${u.user_id}>`).join("\n");
      const embed = new EmbedBuilder()
        .setTitle(`👥 Members of ${name}`)
        .setDescription(members)
        .setColor(0x3498db);
      interaction.reply({ embeds: [embed] });
    });
  }

  // ---------- FACTION RENAME ----------
  if (interaction.commandName === "faction-rename") {
    const oldName = interaction.options.getString("old_name");
    const newName = interaction.options.getString("new_name");
    db.get("SELECT * FROM factions WHERE name = ?", [oldName], async (e,f) => {
      if (!f) return interaction.reply({ content: "❌ Faction not found", ephemeral: true });

      db.run("UPDATE factions SET name = ? WHERE name = ?", [newName, oldName]);
      db.run("UPDATE users SET faction = ? WHERE faction = ?", [newName, oldName]);

      const role = interaction.guild.roles.cache.find(r => r.name === oldName);
      if (role) await role.setName(newName);

      const category = interaction.guild.channels.cache.find(c => c.name === `${oldName.toUpperCase()} FACTION`);
      if (category) await category.setName(`${newName.toUpperCase()} FACTION`);

      interaction.reply(`✅ Faction renamed from **${oldName}** to **${newName}**`);
    });
  }

  // ---------- MEMBER ADD ----------
  if (interaction.commandName === "member-add") {
    const target = interaction.options.getUser("user");
    const faction = interaction.options.getString("faction");

    db.get("SELECT faction FROM users WHERE user_id = ?", [target.id], async (e,u) => {
      if (u && u.faction) return interaction.reply({ content: "❌ User already in a faction", ephemeral: true });

      const role = interaction.guild.roles.cache.find(r => r.name === faction);
      if (!role) return interaction.reply({ content: "❌ Faction not found", ephemeral: true });

      await interaction.guild.members.cache.get(target.id).roles.add(role);
      db.run("INSERT OR REPLACE INTO users VALUES (?, ?, ?, ?)", [target.id, faction, today, null]);
      interaction.reply(`✅ <@${target.id}> added to **${faction}**`);
    });
  }

  // ---------- MEMBER REMOVE ----------
  if (interaction.commandName === "member-remove") {
    const target = interaction.options.getUser("user");

    db.get("SELECT faction FROM users WHERE user_id = ?", [target.id], async (e,u) => {
      if (!u || !u.faction) return interaction.reply({ content: "❌ User not in any faction", ephemeral: true });

      const role = interaction.guild.roles.cache.find(r => r.name === u.faction);
      if (role) await interaction.guild.members.cache.get(target.id).roles.remove(role);

      db.run("UPDATE users SET faction = NULL WHERE user_id = ?", [target.id]);
      interaction.reply(`✅ <@${target.id}> removed from **${u.faction}**`);
    });
  }

  // ---------- CHECK-IN ----------
  if (interaction.commandName === "checkin") {
    db.get("SELECT * FROM users WHERE user_id = ?", [userId], (e,u) => {
      if (!u || !u.faction) return interaction.reply("❌ No faction");
      if (u.last_checkin === today) return interaction.reply("⏳ Already done");

      db.run("UPDATE users SET last_checkin = ? WHERE user_id = ?", [today, userId]);
      db.run("UPDATE factions SET points = points + 10 WHERE name = ?", [u.faction]);
      interaction.reply("🔥 +10 points added");
    });
  }

  // ---------- LEADERBOARD ----------
  if (interaction.commandName === "leaderboard") {
    db.all("SELECT * FROM factions ORDER BY points DESC", [], (e, rows) => {
      const text = rows.map((f,i) => `${i+1}. **${f.name}** — ${f.points}`).join("\n");
      const embed = new EmbedBuilder()
        .setTitle("🏆 Faction Leaderboard")
        .setDescription(text)
        .setColor(0xf1c40f);
      interaction.reply({ embeds: [embed] });
    });
  }

  // ---------- TRUSTED ROLES ----------
  if (interaction.commandName === "trust-role") {
    const role = interaction.options.getRole("role");
    db.run("INSERT OR REPLACE INTO trusted_roles VALUES (?)", [role.id]);
    interaction.reply(`✅ Role **${role.name}** is now trusted`);
  }

  if (interaction.commandName === "untrust-role") {
    const role = interaction.options.getRole("role");
    db.run("DELETE FROM trusted_roles WHERE role_id = ?", [role.id]);
    interaction.reply(`❌ Role **${role.name}** removed from trusted`);
  }

  if (interaction.commandName === "trusted-list") {
    db.all("SELECT role_id FROM trusted_roles", [], (err, rows) => {
      if (!rows || rows.length === 0) return interaction.reply("❌ No trusted roles");
      const roles = rows.map(r => `<@&${r.role_id}>`).join("\n");
      const embed = new EmbedBuilder()
        .setTitle("🛡️ Trusted Roles")
        .setDescription(roles)
        .setColor(0x9b59b6);
      interaction.reply({ embeds: [embed] });
    });
  }

  // ---------- HELP ----------
  if (interaction.commandName === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📜 UN Faction Bot Commands")
      .setDescription(
        "**Faction**\n" +
        "/faction-join\n/faction-leave\n/faction-info\n/faction-members\n/checkin\n/leaderboard\n\n" +
        "**Admin / Trusted**\n" +
        "/faction-create\n/faction-delete\n/faction-leader\n/faction-rename\n/member-add\n/member-remove\n\n" +
        "**Trusted/Admin**\n" +
        "/trust-role\n/untrust-role\n/trusted-list\n\n" +
        "**PnW API**\n" +
        "/register-nation\n/unregister-nation\n/nation-info\n/raid-target"
      )
      .setColor(0x95a5a6);
    interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ---------- REGISTER NATION ----------
  if (interaction.commandName === "register-nation") {
    const nationId = interaction.options.getString("nation_id");
    db.run("INSERT OR REPLACE INTO users(user_id,nation_id) VALUES (?,?)", [userId, nationId]);
    interaction.reply(`✅ Your nation ID **${nationId}** is now registered`);
  }

  if (interaction.commandName === "unregister-nation") {
    db.run("UPDATE users SET nation_id = NULL WHERE user_id = ?", [userId]);
    interaction.reply("❌ Your nation registration has been removed");
  }

  // ---------- NATION INFO ----------
  if (interaction.commandName === "nation-info") {
    let nationId = interaction.options.getString("nation_id");

    if (!nationId) {
      // Use registered nation
      db.get("SELECT nation_id FROM users WHERE user_id = ?", [userId], (e,r) => {
        if (!r || !r.nation_id) return interaction.reply("❌ Nation not registered, use /register-nation");
        nationId = r.nation_id;
      });
    }

    if (!nationId) return; // user has no nation
    try {
      const nation = await fetchNation(nationId);
      const embed = new EmbedBuilder()
        .setTitle(`🏛️ ${nation.name}`)
        .addFields(
          { name: "💰 Money", value: `$${nation.money}`, inline: true },
          { name: "🛢️ Resources", value: `$${nation.resources}`, inline: true },
          { name: "🪖 Army", value: `${nation.army}`, inline: true },
          { name: "🏙️ Cities", value: `${nation.cities}`, inline: true },
          { name: "📅 Last Activity", value: nation.last_activity || "Unknown", inline: true }
        )
        .setColor(0xe67e22);
      interaction.reply({ embeds: [embed] });
    } catch (err) {
      interaction.reply("❌ Failed to fetch nation info");
    }
  }

  // ---------- RAID TARGET ----------
  if (interaction.commandName === "raid-target") {
    // Fetch all users registered nations in DB
    db.all("SELECT user_id,nation_id FROM users WHERE nation_id IS NOT NULL", async (err, rows) => {
      if (!rows || rows.length === 0) return interaction.reply("❌ No registered nations");

      const nationsData = [];
      for (const r of rows) {
        try {
          const n = await fetchNation(r.nation_id);
          nationsData.push(n);
        } catch {}
      }

      // Filter: exclude active today, high army vs money/resources
      const candidates = nationsData
        .filter(n => n.last_activity && (new Date() - new Date(n.last_activity)) / (1000*60*60*24) >= 3)
        .sort((a,b) => (b.money + b.resources) - (a.money + a.resources));

      if (!candidates[0]) return interaction.reply("❌ No good raid target found");

      const t = candidates[0];
      const embed = new EmbedBuilder()
        .setTitle("⚔️ Suggested Raid Target")
        .addFields(
          { name: "Nation", value: t.name, inline: true },
          { name: "💰 Money", value: `$${t.money}`, inline: true },
          { name: "🛢️ Resources", value: `$${t.resources}`, inline: true },
          { name: "🪖 Army", value: `${t.army}`, inline: true },
          { name: "📅 Last Activity", value: t.last_activity || "Unknown", inline: true }
        )
        .setColor(0xe74c3c);
      interaction.reply({ embeds: [embed] });
    });
  }
});

// ================= LOGIN =================
client.login(TOKEN);
