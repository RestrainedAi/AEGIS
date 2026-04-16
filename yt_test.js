const fs = require('fs');
const { google } = require('googleapis');

const TOKEN_PATH = '/home/aegis/.secrets/youtube_token.json';
const CREDS_PATH = '/home/aegis/client_secret.json';

async function main() {
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8')).installed;
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));

  const oAuth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    creds.redirect_uris[0]
  );

  oAuth2Client.setCredentials(tokens);

  const yt = google.youtube({ version: 'v3', auth: oAuth2Client });

  const res = await yt.channels.list({
    part: ['snippet'],
    mine: true,
  });

  console.log(JSON.stringify(res.data, null, 2));
}

main().catch(console.error);
