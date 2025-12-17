// ================= COMMAND HANDLER =================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const today = new Date().toDateString();

  try {
    // ---------- ADMIN / TRUSTED GATE ----------
    const adminCmds = [
      "faction-create",
      "faction-delete",
      "faction-leader",
      "faction-rename",
      "member-add",
      "member-remove",
    ];
    if (adminCmds.includes(interaction.commandName)) {
      if (!(await hasAdminAccess(interaction.member)))
        return interaction.reply({ content: "❌ No permission", ephemeral: true });
    }

    // ---------- DEFER REPLY ----------
    await interaction.deferReply({ ephemeral: true });

    // ---------- JOIN (NO DOUBLE) ----------
    if (interaction.commandName === "faction-join") {
      const name = interaction.options.getString("name");

      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (err, row) => {
        if (row && row.faction) return interaction.editReply("❌ Leave your faction first");

        const role = interaction.guild.roles.cache.find((r) => r.name === name);
        if (!role) return interaction.editReply("❌ Faction not found");

        await interaction.member.roles.add(role);
        db.run("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [userId, name, today]);
        interaction.editReply(`✅ Joined **${name}**`);
      });
    }

    // ---------- LEAVE ----------
    if (interaction.commandName === "faction-leave") {
      db.get("SELECT faction FROM users WHERE user_id = ?", [userId], async (err, row) => {
        if (!row || !row.faction) return interaction.editReply("❌ Not in faction");

        const role = interaction.guild.roles.cache.find((r) => r.name === row.faction);
        if (role) await interaction.member.roles.remove(role);

        db.run("UPDATE users SET faction = NULL WHERE user_id = ?", [userId]);
        interaction.editReply("✅ You left your faction");
      });
    }

    // ---------- FACTION INFO ----------
    if (interaction.commandName === "faction-info") {
      const name = interaction.options.getString("name");
      db.get("SELECT * FROM factions WHERE name = ?", [name], (err, faction) => {
        if (!faction) return interaction.editReply("❌ Faction not found");

        db.get("SELECT COUNT(*) as c FROM users WHERE faction = ?", [name], (err, count) => {
          const embed = new EmbedBuilder()
            .setTitle(`🏰 ${faction.name}`)
            .addFields(
              { name: "👑 Leader", value: faction.leader ? `<@${faction.leader}>` : "None", inline: true },
              { name: "👥 Members", value: `${count.c}`, inline: true },
              { name: "⭐ Points", value: `${faction.points}`, inline: true }
            )
            .setColor(0x2ecc71);

          interaction.editReply({ embeds: [embed] });
        });
      });
    }

    // ---------- FACTION MEMBERS ----------
    if (interaction.commandName === "faction-members") {
      const name = interaction.options.getString("name");
      db.all("SELECT user_id FROM users WHERE faction = ?", [name], (err, rows) => {
        if (!rows || rows.length === 0) return interaction.editReply("❌ No members found");

        const members = rows.map((u) => `<@${u.user_id}>`).join("\n");
        const embed = new EmbedBuilder()
          .setTitle(`👥 Members of ${name}`)
          .setDescription(members)
          .setColor(0x3498db);

        interaction.editReply({ embeds: [embed] });
      });
    }

    // ---------- FACTION RENAME ----------
    if (interaction.commandName === "faction-rename") {
      const oldName = interaction.options.getString("old_name");
      const newName = interaction.options.getString("new_name");

      db.get("SELECT * FROM factions WHERE name = ?", [oldName], async (err, f) => {
        if (!f) return interaction.editReply("❌ Faction not found");

        db.run("UPDATE factions SET name = ? WHERE name = ?", [newName, oldName]);
        db.run("UPDATE users SET faction = ? WHERE faction = ?", [newName, oldName]);

        const role = interaction.guild.roles.cache.find((r) => r.name === oldName);
        if (role) await role.setName(newName);

        const category = interaction.guild.channels.cache.find(
          (c) => c.name === `${oldName.toUpperCase()} FACTION`
        );
        if (category) await category.setName(`${newName.toUpperCase()} FACTION`);

        interaction.editReply(`✅ Faction renamed from **${oldName}** to **${newName}**`);
      });
    }

    // ---------- MEMBER ADD ----------
    if (interaction.commandName === "member-add") {
      const target = interaction.options.getUser("user");
      const faction = interaction.options.getString("faction");

      db.get("SELECT faction FROM users WHERE user_id = ?", [target.id], async (err, u) => {
        if (u && u.faction) return interaction.editReply("❌ User already in a faction");

        const role = interaction.guild.roles.cache.find((r) => r.name === faction);
        if (!role) return interaction.editReply("❌ Faction not found");

        await interaction.guild.members.cache.get(target.id).roles.add(role);
        db.run("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [target.id, faction, today]);
        interaction.editReply(`✅ <@${target.id}> added to **${faction}**`);
      });
    }

    // ---------- MEMBER REMOVE ----------
    if (interaction.commandName === "member-remove") {
      const target = interaction.options.getUser("user");

      db.get("SELECT faction FROM users WHERE user_id = ?", [target.id], async (err, u) => {
        if (!u || !u.faction) return interaction.editReply("❌ User not in any faction");

        const role = interaction.guild.roles.cache.find((r) => r.name === u.faction);
        if (role) await interaction.guild.members.cache.get(target.id).roles.remove(role);

        db.run("UPDATE users SET faction = NULL WHERE user_id = ?", [target.id]);
        interaction.editReply(`✅ <@${target.id}> removed from **${u.faction}**`);
      });
    }

    // ---------- CHECKIN ----------
    if (interaction.commandName === "checkin") {
      db.get("SELECT * FROM users WHERE user_id = ?", [userId], (err, u) => {
        if (!u || !u.faction) return interaction.editReply("❌ No faction");
        if (u.last_checkin === today) return interaction.editReply("⏳ Already done");

        db.run("UPDATE users SET last_checkin = ? WHERE user_id = ?", [today, userId]);
        db.run("UPDATE factions SET points = points + 10 WHERE name = ?", [u.faction]);
        interaction.editReply("🔥 +10 points added");
      });
    }

    // ---------- LEADERBOARD ----------
    if (interaction.commandName === "leaderboard") {
      db.all("SELECT * FROM factions ORDER BY points DESC", [], (err, rows) => {
        const text = rows.map((f, i) => `${i + 1}. **${f.name}** — ${f.points}`).join("\n");
        const embed = new EmbedBuilder()
          .setTitle("🏆 Faction Leaderboard")
          .setDescription(text)
          .setColor(0xf1c40f);

        interaction.editReply({ embeds: [embed] });
      });
    }

    // ---------- TRUSTED ROLES ----------
    if (interaction.commandName === "trust-role") {
      const role = interaction.options.getRole("role");
      db.run("INSERT OR REPLACE INTO trusted_roles VALUES (?)", [role.id]);
      interaction.editReply(`✅ Role **${role.name}** is now trusted`);
    }

    if (interaction.commandName === "untrust-role") {
      const role = interaction.options.getRole("role");
      db.run("DELETE FROM trusted_roles WHERE role_id = ?", [role.id]);
      interaction.editReply(`❌ Role **${role.name}** removed from trusted`);
    }

    if (interaction.commandName === "trusted-list") {
      db.all("SELECT role_id FROM trusted_roles", [], (err, rows) => {
        if (!rows || rows.length === 0) return interaction.editReply("❌ No trusted roles");

        const roles = rows.map((r) => `<@&${r.role_id}>`).join("\n");
        const embed = new EmbedBuilder()
          .setTitle("🛡️ Trusted Roles")
          .setDescription(roles)
          .setColor(0x9b59b6);

        interaction.editReply({ embeds: [embed] });
      });
    }

    // ---------- HELP ----------
    if (interaction.commandName === "help") {
      const embed = new EmbedBuilder()
        .setTitle("📜 UN Faction Bot Commands")
        .setDescription(
          "Faction\n" +
            "/faction-join\n/faction-leave\n/faction-info\n/faction-members\n/checkin\n/leaderboard\n\n" +
            "Admin / Trusted\n" +
            "/faction-create\n/faction-delete\n/faction-leader\n/faction-rename\n/member-add\n/member-remove\n\n" +
            "Admin Only\n" +
            "/trust-role\n/untrust-role\n/trusted-list"
        )
        .setColor(0x95a5a6);

      interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied && !interaction.deferred)
      interaction.reply({ content: "❌ An error occurred", ephemeral: true });
  }
});
