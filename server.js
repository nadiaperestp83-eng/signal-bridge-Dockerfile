const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

const CONFIG_DIR = '/data/signal-cli-config';
const PORT = process.env.PORT || 8080;

function rodarSignalCli(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'signal-cli',
      ['--config', CONFIG_DIR, ...args],
      { timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) {
          reject({ error: error.message, stdout, stderr });
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
  });
}

app.get('/status', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ erro: 'phone é obrigatório' });

  try {
    const resultado = await rodarSignalCli(['-a', phone, 'listAccounts']);
    const registrado = (resultado.stdout || '').includes(phone);
    res.json({ registrado });
  } catch (e) {
    res.json({ registrado: false });
  }
});

app.post('/register', async (req, res) => {
  const { phone, captchaToken } = req.body;
  if (!phone) return res.status(400).json({ erro: 'phone é obrigatório' });

  const args = ['-a', phone, 'register'];
  if (captchaToken) args.push('--captcha', captchaToken);

  try {
    const resultado = await rodarSignalCli(args);
    res.json({ sucesso: true, detalhe: resultado.stdout || resultado.stderr });
  } catch (e) {
    const stderrTexto = (e.stderr || '').toLowerCase();
    const jaRegistrado = stderrTexto.includes('already registered');
    const precisaCaptcha = stderrTexto.includes('captcha');

    res.status(422).json({
      sucesso: false,
      jaRegistrado,
      precisaCaptcha,
      captchaUrl: precisaCaptcha
        ? 'https://signalcaptchas.org/registration/generate.html'
        : undefined,
      erro: e.stderr || e.error,
    });
  }
});

app.post('/verify', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ erro: 'phone e code são obrigatórios' });
  }

  try {
    const resultado = await rodarSignalCli(['-a', phone, 'verify', code]);
    res.json({ sucesso: true, detalhe: resultado.stdout || resultado.stderr });
  } catch (e) {
    res.status(422).json({ sucesso: false, erro: e.stderr || e.error });
  }
});

app.post('/send', async (req, res) => {
  const { phone, to, message } = req.body;
  if (!phone || !to || !message) {
    return res.status(400).json({ erro: 'phone, to e message são obrigatórios' });
  }

  try {
    const resultado = await rodarSignalCli(['-a', phone, 'send', '-m', message, to]);
    res.json({ sucesso: true, detalhe: resultado.stdout });
  } catch (e) {
    res.status(422).json({ sucesso: false, erro: e.stderr || e.error });
  }
});

app.get('/receive', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ erro: 'phone é obrigatório' });

  try {
    const resultado = await rodarSignalCli(['-a', phone, 'receive', '--json']);
    res.json({ sucesso: true, mensagens: resultado.stdout });
  } catch (e) {
    res.status(422).json({ sucesso: false, erro: e.stderr || e.error });
  }
});

// POST /updateProfile  { "phone": "+numero", "name": "opcional", "about": "opcional", "avatarBase64": "opcional" }
app.post('/updateProfile', async (req, res) => {
  const { phone, name, about, avatarBase64 } = req.body;
  if (!phone) return res.status(400).json({ erro: 'phone é obrigatório' });

  const args = ['-a', phone, 'updateProfile'];
  if (name) args.push('--given-name', name);
  if (about) args.push('--about', about);

  let avatarPath;
  if (avatarBase64) {
    avatarPath = path.join(os.tmpdir(), `avatar_${Date.now()}.jpg`);
    fs.writeFileSync(avatarPath, Buffer.from(avatarBase64, 'base64'));
    args.push('--avatar', avatarPath);
  }

  try {
    const resultado = await rodarSignalCli(args);
    if (avatarPath) fs.unlinkSync(avatarPath);
    res.json({ sucesso: true, detalhe: resultado.stdout || resultado.stderr });
  } catch (e) {
    if (avatarPath) {
      try {
        fs.unlinkSync(avatarPath);
      } catch (_) {}
    }
    res.status(422).json({ sucesso: false, erro: e.stderr || e.error });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bridge Server rodando na porta ${PORT}`);
});
