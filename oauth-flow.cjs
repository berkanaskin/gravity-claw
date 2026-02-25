const fs = require('fs');
const http = require('http');
const { google } = require('googleapis');

const credsPath = process.argv[2] || 'client_secret_845717305996-mtcbcfgn782o7h211v84g7v8pnhb94bg.apps.googleusercontent.com.json';
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
const { client_id, client_secret } = creds.installed;

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive.readonly',
];

const oAuth2 = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3939/callback');

const authUrl = oAuth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
console.log('\n=== OPEN THIS URL IN YOUR BROWSER ===');
console.log(authUrl);
console.log('=====================================\n');

const server = http.createServer(async (req, res) => {
  if (req.url && req.url.startsWith('/callback')) {
    const url = new URL(req.url, 'http://localhost:3939');
    const code = url.searchParams.get('code');
    if (code) {
      try {
        const { tokens } = await oAuth2.getToken(code);
        fs.writeFileSync('token.json', JSON.stringify(tokens, null, 2));
        console.log('\n✅ token.json saved successfully!');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Success! You can close this tab.</h1>');
        setTimeout(() => process.exit(0), 1000);
      } catch (err) {
        console.error('Token error:', err.message);
        res.writeHead(500);
        res.end('Token exchange failed: ' + err.message);
      }
    }
  }
});

server.listen(3939, () => console.log('Waiting for OAuth callback on port 3939...'));
