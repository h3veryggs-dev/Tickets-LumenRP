require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  AttachmentBuilder,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function escapeHTML(text = "") {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function criarTranscript(channel) {
  let messages = [];
  let lastId;

  while (true) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      before: lastId,
    });

    if (fetched.size === 0) break;

    messages.push(...fetched.values());
    lastId = fetched.last().id;
  }

  messages = messages.reverse();

  let html = `
  <html>
  <head>
    <meta charset="UTF-8" />
    <style>
      body { font-family: Arial; background: #111; color: #eee; padding: 20px; }
      .msg { margin-bottom: 15px; padding: 10px; background: #1e1e1e; border-radius: 8px; }
      .author { font-weight: bold; color: #4da3ff; }
      .time { color: #aaa; font-size: 12px; }
      .content { margin-top: 5px; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <h1>Transcript - ${channel.name}</h1>
  `;

  for (const msg of messages) {
    html += `
      <div class="msg">
        <div class="author">${escapeHTML(msg.author.tag)}</div>
        <div class="time">${msg.createdAt.toLocaleString("pt-BR")}</div>
        <div class="content">${escapeHTML(msg.content || "[sem texto]")}</div>
      </div>
    `;
  }

  html += `</body></html>`;

  return Buffer.from(html, "utf-8");
}

client.once("ready", () => {
  console.log(`Bot online como ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "ticket") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("abrir_ticket")
          .setLabel("Abrir Ticket")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({
        content: "Clique no botão abaixo para abrir um ticket.",
        components: [row],
      });
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === "abrir_ticket") {
      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
        ],
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("fechar_ticket")
          .setLabel("Fechar Ticket")
          .setStyle(ButtonStyle.Danger)
      );

      await channel.send({
        content: `Olá ${interaction.user}, explique seu problema aqui.`,
        components: [row],
      });

      await interaction.reply({
        content: `Ticket criado: ${channel}`,
        ephemeral: true,
      });
    }

    if (interaction.customId === "fechar_ticket") {
      await interaction.reply("Gerando transcript...");

      const transcript = await criarTranscript(interaction.channel);

      const file = new AttachmentBuilder(transcript, {
        name: `${interaction.channel.name}.html`,
      });

      const logChannel = interaction.guild.channels.cache.get(
        process.env.LOG_CHANNEL_ID
      );

      if (logChannel) {
        await logChannel.send({
          content: `Transcript do ticket **${interaction.channel.name}**`,
          files: [file],
        });
      }

      await interaction.channel.delete().catch(() => {});
    }
  }
});

const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Envia o painel de tickets"),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
})();

client.login(process.env.TOKEN);