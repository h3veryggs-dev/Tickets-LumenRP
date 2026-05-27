require("dotenv").config();

const fs = require("fs");
const path = require("path");

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

// =========================
// CONFIG
// =========================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

// Coloque no .env ou deixe esse ID fixo
const CATEGORIA_WHITELIST =
  process.env.CATEGORIA_WHITELIST_ID || "1507828200896729139";

// IMPORTANTE:
// Se os dois bots estiverem em pastas diferentes, use no .env dos DOIS bots:
// TICKETS_DB_PATH=/caminho/completo/tickets.json
const TICKETS_DB_PATH =
  process.env.TICKETS_DB_PATH || path.join(__dirname, "tickets.json");

// =========================
// BANCO JSON
// =========================
function garantirBanco() {
  if (!fs.existsSync(TICKETS_DB_PATH)) {
    fs.writeFileSync(TICKETS_DB_PATH, JSON.stringify({}, null, 2));
  }
}

function lerBanco() {
  garantirBanco();

  try {
    return JSON.parse(fs.readFileSync(TICKETS_DB_PATH, "utf8"));
  } catch {
    return {};
  }
}

function salvarBanco(data) {
  fs.writeFileSync(TICKETS_DB_PATH, JSON.stringify(data, null, 2));
}

function salvarTicket(userId, info) {
  const banco = lerBanco();

  banco[userId] = {
    userId,
    channelId: info.channelId,
    messageId: info.messageId,
    guildId: info.guildId,
    channelName: info.channelName,
    createdAt: new Date().toISOString(),
    status: "aberto",
  };

  salvarBanco(banco);
}

function marcarTicketFechado(channelId) {
  const banco = lerBanco();

  for (const userId of Object.keys(banco)) {
    if (banco[userId].channelId === channelId) {
      banco[userId].status = "fechado";
      banco[userId].closedAt = new Date().toISOString();
    }
  }

  salvarBanco(banco);
}

// =========================
// CLIENT
// =========================
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
    <h1>Transcript - ${escapeHTML(channel.name)}</h1>
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
  garantirBanco();
  console.log(`Bot de ticket online como ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
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

  if (!interaction.isButton()) return;

  if (interaction.customId === "abrir_ticket") {
    const existente = Object.values(lerBanco()).find(
      (t) =>
        t.userId === interaction.user.id &&
        t.guildId === interaction.guild.id &&
        t.status === "aberto"
    );

    if (existente) {
      return interaction.reply({
        content: `Você já tem um ticket aberto: <#${existente.channelId}>`,
        ephemeral: true,
      });
    }

    const channel = await interaction.guild.channels.create({
      name: `wl-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, ""),
      type: ChannelType.GuildText,
      parent: CATEGORIA_WHITELIST,
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

    const ticketMessage = await channel.send({
      content: `Olá ${interaction.user}, explique seu problema aqui ou inicie a whitelist no botão que aparecer abaixo.`,
      components: [row],
    });

    salvarTicket(interaction.user.id, {
      guildId: interaction.guild.id,
      channelId: channel.id,
      channelName: channel.name,
      messageId: ticketMessage.id,
    });

    await interaction.reply({
      content:
        `Ticket criado: ${channel}\n` +
        `ID da mensagem do ticket: \`${ticketMessage.id}\``,
      ephemeral: true,
    });
  }

  if (interaction.customId === "fechar_ticket") {
    await interaction.reply("Gerando transcript...");

    const transcript = await criarTranscript(interaction.channel);

    const file = new AttachmentBuilder(transcript, {
      name: `${interaction.channel.name}.html`,
    });

    const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);

    if (logChannel) {
      await logChannel.send({
        content: `Transcript do ticket **${interaction.channel.name}**`,
        files: [file],
      });
    }

    marcarTicketFechado(interaction.channel.id);

    await interaction.channel.delete().catch(() => {});
  }
});

// =========================
// SLASH COMMANDS
// =========================
const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Envia o painel de tickets"),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });

    console.log("Comando /ticket registrado.");
  } catch (err) {
    console.error("Erro ao registrar comandos:", err);
  }
})();

client.login(TOKEN);
