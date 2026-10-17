const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');
require('dotenv').config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('DISCORD_TOKEN, DISCORD_CLIENT_ID and DISCORD_GUILD_ID must be set to deploy commands');
  process.exit(1);
}

const commands = [
  {
    name: 'help',
    description: 'Show help for RIVAL ASSET BOT'
  },
  {
    name: 'publish-audio',
    description: 'Upload an audio file to Roblox Open Cloud Assets',
    options: [
      {
        name: 'file',
        description: 'Audio file to upload',
        type: ApplicationCommandOptionType.Attachment,
        required: true
      }
    ]
  },
  {
    name: 'publish-image',
    description: 'Upload an image (decal) to Roblox Open Cloud Assets',
    options: [
      {
        name: 'file',
        description: 'Image file to upload',
        type: ApplicationCommandOptionType.Attachment,
        required: true
      }
    ]
  },
  {
    name: 'publish-model',
    description: 'Upload a model file to Roblox Open Cloud Assets',
    options: [
      {
        name: 'file',
        description: 'Model file to upload (fbx, glb, rbxm, etc)',
        type: ApplicationCommandOptionType.Attachment,
        required: true
      }
    ]
  },
  {
    name: 'my-uploads',
    description: 'Show your recent uploads recorded by the bot'
  }
];

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering application (guild) commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();
