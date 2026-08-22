const express = require('express');
const { execFile } = require('child_process');

const app = express();
app.use(express.json());

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

// POST /register  { "phone": "+5511999999999", "captchaToken": "opcional" }
app.post('/register', async (req, res) => {
  const { phone, captchaToken } = req.body;
  if (!phone) return res.status(400).json({ erro: 'phone é obrigatório' });

  const args = ['-a', phone, 'register'];
  if (captchaToken) args.push('--captcha', captchaToken);

  try {
    const resultado = await rodarSignalCli(args);
    res.json({ sucesso: true, detalhe: resultado.stdout || resultado.stderr });
  } catch (e) {
    const precisaCaptcha =
      (e.stderr || '').toLowerCase().includes('captcha');
    res.status(422).json({
      sucesso: false,
      precisaCaptcha,
      captchaUrl: precisaCaptcha
        ? 'https://signalcaptchas.org/registration/generate.html'
        : undefined,
      erro: e.stderr || e.error,
    });
  }
});

// POST /verify  { "phone": "+5511999999999", "code": "123456" }
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

// POST /send  { "phone": "+remetente", "to": "+destino", "message": "texto" }
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

// GET /receive?phone=+numero
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bridge Server rodando na porta ${PORT}`);
});
