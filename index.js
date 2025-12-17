client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const today = new Date().toDateString();

  try {
    // ---------- ADMIN / TRUSTED ----------
    const adminCmds = ["faction-create", "faction-delete", "faction-leader", "faction-rename", "member-add", "member-remove"];
    if (adminCmds.includes(interaction.commandName)) {
      if (!(await hasAdminAccess(interaction.member))) {
        return await interaction.reply({ content: "❌ No permission", ephemeral: true });
      }
    }

    // ---------- FACTION CREATE ----------
    if (interaction.commandName === "faction-create") {
      const name = interaction.options.getString("name");
      await dbRun("INSERT OR REPLACE INTO factions(name) VALUES(?)", [name]);
      await createFactionStructure(interaction.guild, name);
      return await interaction.reply(`✅ Faction **${name}** created`);
    }

    // ---------- FACTION DELETE ----------
    if (interaction.commandName === "faction-delete") {
      const name = interaction.options.getString("name");
      await dbRun("DELETE FROM factions WHERE name = ?", [name]);
      await dbRun("UPDATE users SET faction = NULL WHERE faction = ?", [name]);
      await deleteFactionStructure(interaction.guild, name);
      return await interaction.reply(`❌ Faction **${name}** deleted`);
    }

    // ---------- FACTION JOIN ----------
    if (interaction.commandName === "faction-join") {
      const name = interaction.options.getString("name");
      const user = await dbGet("SELECT faction FROM users WHERE user_id = ?", [userId]);
      if (user && user.faction) return await interaction.reply({ content: "❌ Leave your faction first", ephemeral: true });

      const role = interaction.guild.roles.cache.find(r => r.name === name);
      if (!role) return await interaction.reply({ content: "❌ Faction not found", ephemeral: true });

      await interaction.member.roles.add(role);
      await dbRun("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [userId, name, today]);
      return await interaction.reply(`✅ Joined **${name}**`);
    }

    // ---------- FACTION LEAVE ----------
    if (interaction.commandName === "faction-leave") {
      const user = await dbGet("SELECT faction FROM users WHERE user_id = ?", [userId]);
      if (!user || !user.faction) return await interaction.reply("❌ Not in faction");

      const role = interaction.guild.roles.cache.find(r => r.name === user.faction);
      if (role) await interaction.member.roles.remove(role);

      await dbRun("UPDATE users SET faction = NULL WHERE user_id = ?", [userId]);
      return await interaction.reply("✅ You left your faction");
    }

    // ---------- FACTION INFO ----------
    if (interaction.commandName === "faction-info") {
      const name = interaction.options.getString("name");
      const faction = await dbGet("SELECT * FROM factions WHERE name = ?", [name]);
      if (!faction) return await interaction.reply({ content: "❌ Faction not found", ephemeral: true });

      const membersCount = await dbGet("SELECT COUNT(*) as c FROM users WHERE faction = ?", [name]);
      const embed = new EmbedBuilder()
        .setTitle(`🏰 ${faction.name}`)
        .addFields(
          { name: "👑 Leader", value: faction.leader ? `<@${faction.leader}>` : "None", inline: true },
          { name: "👥 Members", value: `${membersCount.c}`, inline: true },
          { name: "⭐ Points", value: `${faction.points}`, inline: true }
        )
        .setColor(0x2ecc71);

      return await interaction.reply({ embeds: [embed] });
    }

    // ---------- FACTION MEMBERS ----------
    if (interaction.commandName === "faction-members") {
      const name = interaction.options.getString("name");
      const rows = await dbAll("SELECT user_id FROM users WHERE faction = ?", [name]);
      if (!rows || rows.length === 0) return await interaction.reply({ content: "❌ No members found", ephemeral: true });

      const members = rows.map(u => `<@${u.user_id}>`).join("\n");
      const embed = new EmbedBuilder()
        .setTitle(`👥 Members of ${name}`)
        .setDescription(members)
        .setColor(0x3498db);

      return await interaction.reply({ embeds: [embed] });
    }

    // ---------- FACTION RENAME ----------
    if (interaction.commandName === "faction-rename") {
      const oldName = interaction.options.getString("old_name");
      const newName = interaction.options.getString("new_name");

      const faction = await dbGet("SELECT * FROM factions WHERE name = ?", [oldName]);
      if (!faction) return await interaction.reply({ content: "❌ Faction not found", ephemeral: true });

      await dbRun("UPDATE factions SET name = ? WHERE name = ?", [newName, oldName]);
      await dbRun("UPDATE users SET faction = ? WHERE faction = ?", [newName, oldName]);

      const role = interaction.guild.roles.cache.find(r => r.name === oldName);
      if (role) await role.setName(newName);

      const category = interaction.guild.channels.cache.find(c => c.name === `${oldName.toUpperCase()} FACTION`);
      if (category) await category.setName(`${newName.toUpperCase()} FACTION`);

      return await interaction.reply(`✅ Faction renamed from **${oldName}** to **${newName}**`);
    }

    // ---------- MEMBER ADD ----------
    if (interaction.commandName === "member-add") {
      const target = interaction.options.getUser("user");
      const faction = interaction.options.getString("faction");

      const user = await dbGet("SELECT faction FROM users WHERE user_id = ?", [target.id]);
      if (user && user.faction) return await interaction.reply({ content: "❌ User already in a faction", ephemeral: true });

      const role = interaction.guild.roles.cache.find(r => r.name === faction);
      if (!role) return await interaction.reply({ content: "❌ Faction not found", ephemeral: true });

      await interaction.guild.members.cache.get(target.id).roles.add(role);
      await dbRun("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [target.id, faction, today]);

      return await interaction.reply(`✅ <@${target.id}> added to **${faction}**`);
    }

    // ---------- MEMBER REMOVE ----------
    if (interaction.commandName === "member-remove") {
      const target = interaction.options.getUser("user");
      const user = await dbGet("SELECT faction FROM users WHERE user_id = ?", [target.id]);
      if (!user || !user.faction) return await interaction.reply({ content: "❌ User not in any faction", ephemeral: true });

      const role = interaction.guild.roles.cache.find(r => r.name === user.faction);
      if (role) await interaction.guild.members.cache.get(target.id).roles.remove(role);

      await dbRun("UPDATE users SET faction = NULL WHERE user_id = ?", [target.id]);
      return await interaction.reply(`✅ <@${target.id}> removed from **${user.faction}**`);
    }

    // ---------- CHECKIN ----------
    if (interaction.commandName === "checkin") {
      const user = await dbGet("SELECT * FROM users WHERE user_id = ?", [userId]);
      if (!user || !user.faction) return await interaction.reply("❌ No faction");
      if (user.last_checkin === today) return await interaction.reply("⏳ Already done");

      await dbRun("UPDATE users SET last_checkin = ? WHERE user_id = ?", [today, userId]);
      await dbRun("UPDATE factions SET points = points + 10 WHERE name = ?", [user.faction]);

      return await interaction.reply("🔥 +10 points added");
    }

    // ---------- LEADERBOARD ----------
    if (interaction.commandName === "leaderboard") {
      const rows = await dbAll("SELECT * FROM factions ORDER BY points DESC", []);
      const text = rows.map((f, i) => `${i + 1}. **${f.name}** — ${f.points}`).join("\n");

      const embed = new EmbedBuilder()
        .setTitle("🏆 Faction Leaderboard")
        .setDescription(text)
        .setColor(0xf1c40f);

      return await interaction.reply({ embeds: [embed] });
    }

    // ---------- TRUSTED ROLES ----------
    if (interaction.commandName === "trust-role") {
      const role = interaction.options.getRole("role");
      await dbRun("INSERT OR REPLACE INTO trusted_roles VALUES (?)", [role.id]);
      return await interaction.reply(`✅ Role **${role.name}** is now trusted`);
    }

    if (interaction.commandName === "untrust-role") {
      const role = interaction.options.getRole("role");
      await dbRun("DELETE FROM trusted_roles WHERE role_id = ?", [role.id]);
      return await interaction.reply(`❌ Role **${role.name}** removed from trusted`);
    }

    if (interaction.commandName === "trusted-list") {
      const rows = await dbAll("SELECT role_id FROM trusted_roles", []);
      if (!rows || rows.length === 0) return await interaction.reply("❌ No trusted roles");

      const roles = rows.map(r => `<@&${r.role_id}>`).join("\n");
      const embed = new EmbedBuilder()
        .setTitle("🛡️ Trusted Roles")
        .setDescription(roles)
        .setColor(0x9b59b6);

      return await interaction.reply({ embeds: [embed] });
    }

    // ---------- HELP ----------
    if (interaction.commandName === "help") {
      const embed = new EmbedBuilder()
        .setTitle("📜 UN Faction Bot Commands")
        .setDescription(
          "**Faction**\n/faction-join\n/faction-leave\n/faction-info\n/faction-members\n/checkin\n/leaderboard\n\n" +
          "**Admin / Trusted**\n/faction-create\n/faction-delete\n/faction-leader\n/faction-rename\n/member-add\n/member-remove\n\n" +
          "**Admin Only**\n/trust-role\n/untrust-role\n/trusted-list"
        )
        .setColor(0x95a5a6);

      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

  } catch (err) {
    console.error(err);
    if (!interaction.replied) await interaction.reply({ content: "❌ Something went wrong", ephemeral: true });
  }
});
