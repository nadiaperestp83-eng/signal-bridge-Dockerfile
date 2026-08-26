const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Sem isso, um erro não tratado derruba o processo Node inteiro no meio de
// uma resposta — e o cliente vê exatamente "connection abort" sem nenhuma
// pista do que houve. Com isso, pelo menos fica logado no Railway.
process.on('uncaughtException', (erro) => {
  console.error('[uncaughtException]', erro);
});
process.on('unhandledRejection', (erro) => {
  console.error('[unhandledRejection]', erro);
});

const app = express();
app.use(express.json({ limit: '20mb' }));

app.use((req, res, next) => {
  const tamanho = req.headers['content-length'];
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} content-length=${tamanho ?? '?'}`);
  next();
});

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

// ===================== STORIES =====================
//
// signal-cli não tem (nas versões estáveis atuais) flags de "story de texto puro"
// documentadas de forma consistente entre versões (--text-story-background-color etc.
// mudou de nome/existência entre releases). Pra não depender de flags frágeis,
// tratamos TODA story (com fundo colorido + texto OU com foto) como um "sendStory
// de attachment": o Flutter renderiza o texto sobre o fundo/foto e manda o PNG
// resultante já pronto. O bridge só recebe a imagem final e chama:
//
//   signal-cli -a <phone> sendStory -a <arquivo> [-g <groupId>]
//
// Sem -g, a story vai pra "My Story" (todos os contatos), conforme decidido.
//
// POST /uploadStory
// body: {
//   "phone": "+numero",          // obrigatório
//   "imageBase64": "...",        // obrigatório, PNG/JPEG em base64 (sem o prefixo data:)
//   "groupId": "opcional",       // se ausente -> My Story
//   "mimeType": "image/png"      // opcional, default image/png
// }
app.post('/uploadStory', async (req, res) => {
  const { phone, imageBase64, groupId, mimeType } = req.body;

  if (!phone) return res.status(400).json({ erro: 'phone é obrigatório' });
  if (!imageBase64) return res.status(400).json({ erro: 'imageBase64 é obrigatório' });

  const extensao = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const storyPath = path.join(os.tmpdir(), `story_${Date.now()}.${extensao}`);

  try {
    fs.writeFileSync(storyPath, Buffer.from(imageBase64, 'base64'));
  } catch (e) {
    return res.status(400).json({ erro: 'imageBase64 inválido', detalhe: e.message });
  }

  const args = ['-a', phone, 'sendStory', '-a', storyPath];
  if (groupId) args.push('-g', groupId);

  try {
    const resultado = await rodarSignalCli(args);
    res.json({
      sucesso: true,
      destino: groupId ? `grupo:${groupId}` : 'My Story',
      detalhe: resultado.stdout || resultado.stderr,
    });
  } catch (e) {
    res.status(422).json({ sucesso: false, erro: e.stderr || e.error });
  } finally {
    try {
      fs.unlinkSync(storyPath);
    } catch (_) {}
  }
});

// POST /addContact  { "phone": "+numero_da_conta", "recipient": "+numero_do_contato", "name": "opcional" }
//
// Usa `updateContact`: se o recipient ainda não existe na lista de contatos
// dessa conta, ele é criado. É isso que faz "Meu status" (Todos os contatos
// do Signal) ter alguém elegível pra receber a story.
app.post('/addContact', async (req, res) => {
  const { phone, recipient, name } = req.body;

  if (!phone) return res.status(400).json({ erro: 'phone é obrigatório' });
  if (!recipient) return res.status(400).json({ erro: 'recipient é obrigatório' });

  const args = ['-a', phone, 'updateContact', recipient];
  if (name) args.push('--given-name', name);

  try {
    const resultado = await rodarSignalCli(args);
    res.json({ sucesso: true, detalhe: resultado.stdout || resultado.stderr });
  } catch (e) {
    res.status(422).json({ sucesso: false, erro: e.stderr || e.error });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bridge Server rodando na porta ${PORT}`);
});
