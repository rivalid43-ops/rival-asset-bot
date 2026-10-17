# RIVAL ASSET BOT

A Discord bot that uploads audio, images, and models to Roblox Open Cloud Assets using the official API.

Features
- /help — show available commands
- /publish-audio <file|asset> [play_speed] — upload audio or provide existing Roblox asset id/url; if an asset id is provided the bot will attempt to download and directly publish it under the configured creator id
- /publish-image <file|asset> — upload image/decal or provide existing asset id/url and the bot will attempt direct publish
- /publish-model <file|asset> — upload a model or provide existing asset id/url and the bot will attempt direct publish
- /my-uploads — show your upload history recorded by the bot

Environment variables
- DISCORD_TOKEN — Discord bot token (required)
- DISCORD_CLIENT_ID — Discord application client id (required for command deploy)
- DISCORD_GUILD_ID — Guild id to register commands to during development (required for deploy script)
- ROBLOX_API_KEY — Roblox Open Cloud Assets API key (required for uploads)
- ROBLOX_CREATOR_ID — Roblox creator/user id to attribute uploads to (required for direct publishing)
- ALLOWED_USER_IDS — comma-separated Discord user IDs who are allowed to use upload commands (recommended)
- PORT — Railway port (if needed)
- MAX_FILE_SIZE_BYTES — optional override for max upload size in bytes (default: 20MB)
- MAX_UPLOADS_PER_WINDOW — optional rate limit (default: 3)

Important behavior — Direct Publish
- If a user provides an existing Roblox asset ID or URL to the publish command, the bot will attempt to download the asset from Roblox and immediately publish it to the configured ROBLOX_CREATOR_ID using the Open Cloud Assets API.
- Only provide asset IDs that you have rights to republish. Republishing other creators' work may violate Roblox Terms of Service. The bot will log publish actions.
- If the asset cannot be downloaded (restricted, removed, or Roblox blocks access), the direct publish will fail and the bot will ask the user to provide the file manually.

Quick start (local)
1. Install dependencies: npm install
2. Create a .env file with the required variables (do NOT commit this file)
3. Register commands to a test guild: npm run deploy-commands
4. Start the bot: npm start

Railway deployment notes
- Railway will set environment variables via the project settings. Ensure you add DISCORD_TOKEN, ROBLOX_API_KEY, ROBLOX_CREATOR_ID, DISCORD_CLIENT_ID, DISCORD_GUILD_ID and ALLOWED_USER_IDS in Railway.
- Use the start command (npm start). The bot listens to Discord events and does not serve HTTP, so using a worker service is appropriate.
- process.env.PORT is respected if you later add a web server; the current app does not open ports by default.

Security and behavior
- Tokens and API keys are read from environment variables. They are never logged or returned to Discord responses.
- Only users listed in ALLOWED_USER_IDS can run upload commands. If ALLOWED_USER_IDS is empty, all users are allowed (not recommended).
- Uploads are recorded to uploads.json for simple history. This file is excluded from source control.
- File size and type checks are enforced. Final moderation/approval is handled asynchronously by Roblox and may take time.

Roblox integration
- The bot uses the official Roblox Open Cloud Assets API (https://apis.roblox.com/assets/v1/assets) and polls the operation status endpoint.
- When direct-publishing an existing Roblox asset, the bot uses Roblox's public asset delivery endpoint (https://assetdelivery.roblox.com/v1/asset?id=ASSETID) to attempt to fetch the file.
- The bot will only display an asset ID if the API returns one and indicates success. It will not claim success if the API fails or moderation is pending/failed.

Support
If you need help configuring the bot or deploying to Railway, include your error logs (without tokens) and I can help troubleshoot.
