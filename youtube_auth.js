const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
const TOKEN_PATH = 'youtube_token.json';
const CREDENTIALS_PATH =
  process.env.YOUTUBE_CLIENT_SECRET_PATH || 'client_secret.local.json';

async function authorize() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing OAuth client secret file at ${CREDENTIALS_PATH}. ` +
      `Use an untracked local file or Secret Manager-backed production flow. ` +
      `See client_secret.example.json for the expected shape.`
    );
  }
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // forces refresh_token even if you authenticated before
  });

  console.log('\nOPEN THIS URL IN YOUR BROWSER:\n');
  console.log(authUrl);
  console.log('\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Paste the code here: ', async (code) => {
    rl.close();
    const { tokens } = await oAuth2Client.getToken(code.trim());
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('\nSaved:', TOKEN_PATH);
  });
}

authorize().catch(console.error);
