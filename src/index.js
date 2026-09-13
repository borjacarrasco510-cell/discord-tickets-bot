const fs = require('fs');

const path = require('path');
require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;
const categoryId = process.env.TICKET_CATEGORY_ID;
const supportRoleId = process.env.SUPPORT_ROLE_ID;
const ticketLogChannelId = process.env.TICKET_LOG_CHANNEL_ID;
const ticketBannerUrl = process.env.TICKET_BANNER_URL;
const donationSupportRoleId = process.env.DONATION_SUPPORT_ROLE_ID;
const parseIds = (value) => (value || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const ticketRoleIds = {
  dudas: parseIds(process.env.TICKET_ROLE_DUDAS_ID || supportRoleId),
  postulacion: parseIds(process.env.TICKET_ROLE_POSTULACION_ID || supportRoleId),
  soporte: parseIds(process.env.TICKET_ROLE_SOPORTE_ID || supportRoleId),
  narracion: parseIds(process.env.TICKET_ROLE_NARRACION_ID || supportRoleId),
  reportes: parseIds(process.env.TICKET_ROLE_REPORTES_ID || supportRoleId),
  ficha_pj: parseIds(process.env.TICKET_ROLE_FICHA_PJ_ID || supportRoleId),
  aportaciones: parseIds(process.env.TICKET_ROLE_APORTACIONES_ID || donationSupportRoleId),
};
const localBannerPath = path.join(__dirname, '..', 'assets', 'banner.png');
const ticketCategoryIds = {
  dudas: process.env.TICKET_CATEGORY_DUDAS_ID || categoryId,
  postulacion: process.env.TICKET_CATEGORY_POSTULACION_ID || categoryId,
  aportaciones: process.env.TICKET_CATEGORY_APORTACIONES_ID
    || process.env.TICKET_CATEGORY_DONACIONES_ID
    || categoryId,
  soporte: process.env.TICKET_CATEGORY_SOPORTE_ID
    || process.env.TICKET_CATEGORY_APELAR_ID
    || categoryId,
  narracion: process.env.TICKET_CATEGORY_NARRACION_ID || categoryId,
  reportes: process.env.TICKET_CATEGORY_REPORTES_ID || categoryId,
  ficha_pj: process.env.TICKET_CATEGORY_FICHA_PJ_ID || categoryId,
};
const donationStaffIds = (process.env.DONATION_STAFF_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const ticketCategories = {
  dudas: {
    label: 'Dudas',
    description: 'Preguntas sobre el servidor',
    emoji: '🛠️',
    color: 0x2f80ed,
  },
  postulacion: {
    label: 'Postulación',
    description: 'Únete al equipo del servidor',
    emoji: '📋',
    color: 0x3498db,
  },
  soporte: {
    label: 'Soporte',
    description: 'Ayuda general con el servidor',
    emoji: '🛠️',
    color: 0x8e44ad,
  },
  narracion: {
    label: 'Narración',
    description: 'Ayuda con la narración o rol',
    emoji: '📖',
    color: 0xe67e22,
  },
  reportes: {
    label: 'Reportes',
    description: 'Reporta un problema o usuario',
    emoji: '🚩',
    color: 0xe74c3c,
  },
  ficha_pj: {
    label: 'Ficha PJ',
    description: 'Crea o revisa tu ficha de personaje',
    emoji: '🧾',
    color: 0x1abc9c,
  },
  aportaciones: {
    label: 'Aportaciones',
    description: 'Ayuda con aportaciones y beneficios',
    emoji: '💝',
    color: 0xf1c40f,
  },
};

async function getTicketCategory(guild, categoryKey) {
  if (ticketCategoryIds[categoryKey]) {
    return ticketCategoryIds[categoryKey];
  }

  const categoryName = `Tickets - ${ticketCategories[categoryKey].label}`;
  let category = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory
      && (channel.name === categoryName || channel.name === ticketCategories[categoryKey].label),
  );

  if (!category) {
    category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
    });
  }

  return category.id;
}

async function getTranscriptChannel(guild) {
  if (ticketLogChannelId) {
    return guild.channels.cache.get(ticketLogChannelId)
      || await guild.channels.fetch(ticketLogChannelId).catch(() => null);
  }

  let channel = guild.channels.cache.find(
    (candidate) => candidate.type === ChannelType.GuildText
      && candidate.name === 'ticket-transcripts',
  );

  if (!channel) {
    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
    ];

    if (supportRoleId) {
      permissionOverwrites.push({
        id: supportRoleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      });
    }

    channel = await guild.channels.create({
      name: 'ticket-transcripts',
      type: ChannelType.GuildText,
      permissionOverwrites,
    });
  }

  return channel;
}

function createTranscript(channel, messages) {
  const lines = [
    `Transcripción: #${channel.name}`,
    `Creado: ${channel.createdAt.toISOString()}`,
    `Tema: ${channel.topic || 'Sin tema'}`,
    '',
  ];

  for (const message of [...messages.values()].reverse()) {
    const timestamp = message.createdAt.toISOString();
    const content = message.content || '[sin texto]';
    const attachments = message.attachments.size
      ? ` | Archivos: ${[...message.attachments.values()].map((file) => file.url).join(', ')}`
      : '';
    lines.push(`[${timestamp}] ${message.author.tag}: ${content}${attachments}`);
  }

  return lines.join('\n');
}

if (!token) {
  throw new Error('Falta DISCORD_TOKEN en el archivo .env');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = [
  new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Publica el panel para abrir tickets')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
    console.log('Comando registrado en el servidor configurado.');
    return;
  }

  for (const guild of client.guilds.cache.values()) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
    console.log(`Comando registrado en ${guild.name}.`);
  }
}

function ticketName(user) {
  return user.username.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 24);
}

function ticketPanel() {
  const categoryButtons = Object.entries(ticketCategories).map(([value, category]) => (
    new ButtonBuilder()
      .setCustomId(`ticket-category:${value}`)
      .setLabel(category.label)
      .setEmoji(category.emoji)
      .setStyle(ButtonStyle.Secondary)
  ));

  const panelEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Tickets')
    .setDescription('¿Necesitas ayuda? Selecciona una categoría y nuestro equipo te atenderá de forma privada.')
    .addFields(
      ...Object.values(ticketCategories).map((category) => ({
        name: `${category.emoji} ${category.label}`,
        value: category.description,
        inline: false,
      })),
    )
    .setFooter({ text: 'Selecciona una categoría para abrir tu ticket' });

  if (fs.existsSync(localBannerPath)) {
    panelEmbed.setImage('attachment://banner.png');
  } else if (ticketBannerUrl) {
    panelEmbed.setImage(ticketBannerUrl);
  }

  const panel = {
    embeds: [panelEmbed],
    components: [
      new ActionRowBuilder().addComponents(categoryButtons.slice(0, 3)),
      new ActionRowBuilder().addComponents(categoryButtons.slice(3, 6)),
      new ActionRowBuilder().addComponents(categoryButtons.slice(6)),
    ],
  };

  if (fs.existsSync(localBannerPath)) {
    panel.files = [{ attachment: localBannerPath, name: 'banner.png' }];
  }

  return panel;
}

function isTicketPanelMessage(message) {
  return message.author.id === client.user.id
    && message.embeds.some((embed) => ['Soporte', 'Tickets'].includes(embed.title));
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Conectado como ${readyClient.user.tag}`);
  await registerCommands();

  for (const guild of readyClient.guilds.cache.values()) {
    await getTranscriptChannel(guild);
  }
  console.log('Canal de transcripciones preparado.');
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-panel') {
      await interaction.deferReply({ ephemeral: true });
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const oldPanels = messages.filter(isTicketPanelMessage);
      await Promise.all(oldPanels.map((message) => message.delete().catch(() => {})));
      await interaction.channel.send(ticketPanel());
      await interaction.editReply({ content: 'Panel de tickets publicado.' });
      return;
    }

    if (
      (interaction.isStringSelectMenu() && interaction.customId === 'ticket-category')
      || (interaction.isButton() && interaction.customId.startsWith('ticket-category:'))
    ) {
      const selectedValue = interaction.isStringSelectMenu()
        ? interaction.values[0]
        : interaction.customId.split(':')[1];
      const categoryKey = selectedValue === 'apelar'
        ? 'soporte'
        : selectedValue === 'donaciones'
          ? 'aportaciones'
          : selectedValue;
      const selectedCategory = ticketCategories[categoryKey];

      if (!selectedCategory) {
        await interaction.reply({ content: 'Esta categoría ya no está disponible.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const categoryRoleIds = ticketRoleIds[categoryKey] || [];

      const permissionOverwrites = [
        {
          id: interaction.guild.roles.everyone.id,
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
      ];

      for (const roleId of categoryRoleIds) {
        permissionOverwrites.push({
          id: roleId,
          type: 0,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        });
      }

      if (categoryKey === 'aportaciones') {
        for (const staffId of donationStaffIds) {
          permissionOverwrites.push({
            id: staffId,
            type: 1,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          });
        }
      }

      const channel = await interaction.guild.channels.create({
        name: `${categoryKey}-${ticketName(interaction.user)}`,
        type: ChannelType.GuildText,
        parent: await getTicketCategory(interaction.guild, categoryKey),
        topic: `ticket-owner:${interaction.user.id} category:${categoryKey}`,
        permissionOverwrites,
      });

      await channel.send({
        content: categoryKey === 'aportaciones'
          ? donationStaffIds.map((id) => `<@${id}>`).join(' ')
          : `${interaction.user} ${categoryRoleIds.map((id) => `<@&${id}>`).join(' ')}`,
        embeds: [
          new EmbedBuilder()
            .setColor(selectedCategory.color)
            .setTitle(`${selectedCategory.emoji} ${selectedCategory.label}`)
            .setDescription('Gracias por contactarnos. Explica tu consulta con el mayor detalle posible.'),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('ticket-close')
              .setLabel('Cerrar ticket')
              .setStyle(ButtonStyle.Danger),
          ),
        ],
      });

      await interaction.editReply({ content: `Ticket de **${selectedCategory.label}** creado: ${channel}` });
      return;
    }

    if (!interaction.isButton()) return;

    if (interaction.customId === 'ticket-create') {
      await interaction.deferReply({ ephemeral: true });

      const permissionOverwrites = [
        {
          id: interaction.guild.roles.everyone.id,
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
      ];

      if (supportRoleId) {
        permissionOverwrites.push({
          id: supportRoleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        });
      }

      const channel = await interaction.guild.channels.create({
        name: ticketName(interaction.user),
        type: ChannelType.GuildText,
        parent: categoryId || undefined,
        topic: `ticket-owner:${interaction.user.id}`,
        permissionOverwrites,
      });

      await channel.send({
        content: `${interaction.user} ${supportRoleId ? `<@&${supportRoleId}>` : ''}`,
        embeds: [
          new EmbedBuilder()
            .setColor(0x27ae60)
            .setTitle('Ticket abierto')
            .setDescription('Explica tu consulta y el equipo te atenderá aquí.'),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('ticket-close')
              .setLabel('Cerrar ticket')
              .setStyle(ButtonStyle.Danger),
          ),
        ],
      });

      await interaction.editReply({ content: `Ticket creado: ${channel}` });
      return;
    }

    if (interaction.customId === 'ticket-close') {
      const ticketChannel = interaction.channel;
      let interactionAcknowledged = false;
      await interaction.deferReply({ ephemeral: true })
        .then(() => { interactionAcknowledged = true; })
        .catch(() => {});

      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const transcript = createTranscript(interaction.channel, messages);
      const transcriptChannel = await getTranscriptChannel(interaction.guild);

      if (!transcriptChannel) {
        throw new Error('No se pudo encontrar o crear el canal de transcripciones.');
      }

      await transcriptChannel.send({
        content: `Transcripción del ticket ${interaction.channel} cerrada por ${interaction.user}.`,
        files: [{
          attachment: Buffer.from(transcript, 'utf8'),
          name: `${interaction.channel.name}.txt`,
        }],
      });

      if (interactionAcknowledged) {
        await interaction.editReply('Transcripción guardada. Este ticket se cerrará en 5 segundos.');
      }
      setTimeout(() => ticketChannel?.delete().catch(() => {}), 5000);
    }
  } catch (error) {
    console.error(error);
    const response = { content: 'Ha ocurrido un error al gestionar el ticket.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
});

client.login(token);
