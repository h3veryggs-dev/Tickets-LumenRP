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
  EmbedBuilder,
} = require("discord.js");

// =========================
// CONFIG
// =========================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const WORKER_URL =
  process.env.WORKER_URL ||
  "https://transcripts-whitelist.henrique-brantmourao.workers.dev";

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

  return html;
}

client.once("clientReady", () => {
  garantirBanco();
  console.log(`Bot de ticket online como ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "ticket") {
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("abrir_ticket_suporte")
          .setLabel("Suporte")
          .setEmoji("🛠️")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("abrir_ticket_denuncia_staff")
          .setLabel("Denunciar Staff")
          .setEmoji("🛡️")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("abrir_ticket_denuncia_player")
          .setLabel("Denunciar Player")
          .setEmoji("🚨")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("abrir_ticket_vip")
          .setLabel("Ticket VIP")
          .setEmoji("💎")
          .setStyle(ButtonStyle.Success)
      );

      const embedPainel = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🎫 Central de Atendimento — Lúmen RP")
        .setDescription(
          "Escolha abaixo o tipo de ticket que deseja abrir.\n\n" +
          "🛠️ **Suporte** — dúvidas, bugs e ajuda geral.\n" +
          "🛡️ **Denunciar Staff** — denúncias contra membros da equipe.\n" +
          "🚨 **Denunciar Player** — denúncias contra jogadores.\n" +
          "💎 **Ticket VIP** — compras, benefícios e suporte VIP."
        )
        .setFooter({ text: "Abra apenas um ticket por vez." })
        .setTimestamp();

      await interaction.reply({
        embeds: [embedPainel],
        components: [row1],
      });
    }
  }

  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("abrir_ticket_")) {
    await interaction.deferReply({ ephemeral: true });

    const tiposTicket = {
      abrir_ticket_suporte: {
        nome: "suporte",
        titulo: "🛠️ Suporte",
        descricao: "Explique sua dúvida, bug ou problema com o máximo de detalhes possível.",
        emoji: "🛠️",
      },
      abrir_ticket_denuncia_staff: {
        nome: "denuncia-staff",
        titulo: "🛡️ Denúncia contra Staff",
        descricao: "Descreva o ocorrido, informe o staff envolvido e envie provas, prints ou vídeos.",
        emoji: "🛡️",
      },
      abrir_ticket_denuncia_player: {
        nome: "denuncia-player",
        titulo: "🚨 Denúncia contra Player",
        descricao: "Informe o jogador denunciado, o motivo e envie provas, prints ou vídeos.",
        emoji: "🚨",
      },
      abrir_ticket_vip: {
        nome: "vip",
        titulo: "💎 Ticket VIP",
        descricao: "Use este ticket para compras, benefícios, dúvidas ou problemas relacionados ao VIP.",
        emoji: "💎",
      },
    };

    const tipoTicket = tiposTicket[interaction.customId];

    if (!tipoTicket) {
      return interaction.editReply({
        content: "Tipo de ticket inválido.",
      });
    }

    const existente = Object.values(lerBanco()).find(
      (t) =>
        t.userId === interaction.user.id &&
        t.guildId === interaction.guild.id &&
        t.status === "aberto"
    );

    if (existente) {
      return interaction.editReply({
        content: `Você já tem um ticket aberto: <#${existente.channelId}>`,
      });
    }

    const channel = await interaction.guild.channels.create({
      name: `${tipoTicket.nome}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, ""),
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

    const embedTicket = new EmbedBuilder()
      .setColor("#2F80ED")
      .setTitle(`${tipoTicket.titulo}`)
      .setDescription(
        `Olá ${interaction.user}!\n\n` +
        `${tipoTicket.descricao}\n\n` +
        "Quando terminar, aguarde a equipe responder. Para fechar, use o botão abaixo."
      )
      .addFields(
        { name: "👤 Usuário", value: `${interaction.user}`, inline: true },
        { name: "🆔 ID", value: `\`${interaction.user.id}\``, inline: true },
        { name: "📌 Tipo", value: `${tipoTicket.titulo}`, inline: true }
      )
      .setTimestamp();

    const ticketMessage = await channel.send({
      content: `${interaction.user}`,
      embeds: [embedTicket],
      components: [row],
    });

    salvarTicket(interaction.user.id, {
      guildId: interaction.guild.id,
      channelId: channel.id,
      channelName: channel.name,
      messageId: ticketMessage.id,
      tipo: tipoTicket.nome,
    });

    await interaction.editReply({
      content:
        `${tipoTicket.emoji} Ticket criado: ${channel}\n` +
        `ID da mensagem do ticket: \`${ticketMessage.id}\``,
    });
  }

  if (interaction.customId === "fechar_ticket") {
    await interaction.reply("Gerando transcript...");

    try {
      const html = await criarTranscript(interaction.channel);

      const resposta = await fetch(WORKER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ html }),
      });

      if (!resposta.ok) {
        throw new Error(`Worker respondeu com status ${resposta.status}`);
      }

      const data = await resposta.json();
      const link = data.url;

      if (!link) {
        throw new Error("O Worker não retornou o campo url.");
      }

      const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);

      if (logChannel) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel("🌐 Ver Transcript")
            .setStyle(ButtonStyle.Link)
            .setURL(link)
        );

        await logChannel.send({
          content: `📄 Transcript do ticket **${interaction.channel.name}**`,
          components: [row],
        });
      }

      marcarTicketFechado(interaction.channel.id);
      await interaction.channel.delete().catch(() => {});
    } catch (err) {
      console.error("Erro ao enviar transcript para o Worker:", err);
      await interaction.followUp({
        content: "Erro ao gerar/enviar o transcript. Veja o console do bot.",
        ephemeral: true,
      }).catch(() => {});
    }
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
