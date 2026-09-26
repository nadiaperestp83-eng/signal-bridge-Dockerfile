const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Sem isso, um erro não tratado derruba o processo Node inteiro no meio de
// uma resposta — e o cliente vê exatamente "connection abort" sem nenhuma
// pista do que houve. Com isso, pelo menos fica logado no Render.
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

// Token pra proteger /backup — só quem souber esse valor consegue baixar
// as chaves da conta Signal. Defina BRIDGE_BACKUP_TOKEN nas env vars do
// Render com um valor aleatório grande (ex: gerado com `openssl rand -hex 32`).
const BRIDGE_BACKUP_TOKEN = process.env.BRIDGE_BACKUP_TOKEN;

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

// Health-check leve — não toca no signal-cli, só confirma que o processo
// Node está de pé.
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

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

app.post('/getUserStatus', async (req, res) => {
  const { phone, recipient } = req.body;

  if (!phone) return res.status(400).json({ erro: 'phone é obrigatório' });
  if (!recipient) return res.status(400).json({ erro: 'recipient é obrigatório' });

  try {
    const resultado = await rodarSignalCli(['-o', 'json', '-a', phone, 'getUserStatus', recipient]);

    let detalhe = null;
    let registrado = false;
    try {
      const parsed = JSON.parse(resultado.stdout);
      detalhe = Array.isArray(parsed) ? parsed[0] : parsed;
      registrado = detalhe?.isRegistered === true;
    } catch (_) {}

    res.json({ sucesso: true, registrado, detalhe: detalhe ?? resultado.stdout });
  } catch (e) {
    res.status(422).json({ sucesso: false, erro: e.stderr || e.error });
  }
});

const MAX_RECIPIENTS_POR_CHAMADA = 100;

app.post('/getUsersStatus', async (req, res) => {
  const { phone, recipients } = req.body;

  if (!phone) return res.status(400).json({ erro: 'phone é obrigatório' });
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ erro: 'recipients deve ser um array não vazio' });
  }
  if (recipients.length > MAX_RECIPIENTS_POR_CHAMADA) {
    return res.status(400).json({
      erro: `no máximo ${MAX_RECIPIENTS_POR_CHAMADA} números por chamada — quebre em lotes menores`,
    });
  }

  try {
    const resultado = await rodarSignalCli([
      '-o', 'json',
      '-a', phone,
      'getUserStatus',
      ...recipients,
    ]);

    let bruto;
    try {
      bruto = JSON.parse(resultado.stdout);
    } catch (_) {
      return res.status(502).json({
        sucesso: false,
        erro: 'signal-cli não retornou JSON válido pro lote',
        detalheCru: resultado.stdout,
      });
    }

    const lista = Array.isArray(bruto) ? bruto : [bruto];
    const resultados = lista.map((item) => ({
      numero: item.number,
      registrado: item.isRegistered === true,
      uuid: item.uuid ?? null,
      username: item.username ?? null,
    }));

    res.json({ sucesso: true, resultados });
  } catch (e) {
    res.status(422).json({ sucesso: false, erro: e.stderr || e.error });
  }
});

app.get('/backup', (req, res) => {
  if (!BRIDGE_BACKUP_TOKEN) {
    return res.status(500).json({ erro: 'BRIDGE_BACKUP_TOKEN não configurado no servidor' });
  }
  if (req.query.token !== BRIDGE_BACKUP_TOKEN) {
    return res.status(401).json({ erro: 'token inválido' });
  }

  if (!fs.existsSync(CONFIG_DIR) || fs.readdirSync(CONFIG_DIR).length === 0) {
    return res.status(404).json({ erro: `Nada pra exportar: ${CONFIG_DIR} está vazio` });
  }

  const tarPath = path.join(os.tmpdir(), `state_${Date.now()}.tar.gz`);

  execFile('tar', ['czf', tarPath, '-C', CONFIG_DIR, '.'], { timeout: 30000 }, (error) => {
    if (error) {
      return res.status(500).json({ erro: 'falha ao gerar backup', detalhe: error.message });
    }

    try {
      const base64 = fs.readFileSync(tarPath).toString('base64');
      fs.unlinkSync(tarPath);
      res.json({ sucesso: true, estadoBase64: base64 });
    } catch (e) {
      res.status(500).json({ erro: 'falha ao ler/limpar backup', detalhe: e.message });
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bridge Server rodando na porta ${PORT}`);
});
