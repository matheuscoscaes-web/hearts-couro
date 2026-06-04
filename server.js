require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Mercado Pago
const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const mpPayment = new Payment(mp);
const mpPreference = new Preference(mp);

const PRECO_PRODUTO = 229.00; // fallback

const PRODUTOS = {
  'Paola':   229.00,
  'Carol':   289.00,
  'Modelo4': 199.00, // Celina
  'Lara':    209.00,
  'Adriana': 189.00,
  'Miranda': 259.00,
  'Manuela': 259.00,
  'Maria':   269.00,
  'Modelo3': 189.00, // Denise
  'Julia':   299.00,
  'Renata':  279.00,
  'Megan':   289.00,
  'Michele': 259.00,
};

// Embalagem padrão
const PACOTE = { height: 11, width: 30, length: 32, weight: 1.0 };

// Dimensões específicas por produto (sobrescreve o padrão)
const PACOTE_PRODUTO = {
  'Maria': { height: 11, width: 35, length: 35, weight: 1.0 },
};

// Estoque inicial por produto_cor
const ESTOQUE_INICIAL = {
  'Paola_White':            7,
  'Paola_Whiskey':          8,
  'Paola_Preto':            1,
  'Paola_Cafe':             0,
  'Paola_Azul':             0,
  'Paola_Argila':          16,
  'Paola_Pink':             3,
  'Paola_Caramelo':         4,
  'Carol_Preto':           20,
  'Carol_Caramelo_brilho': 20,
};

// E-mail
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_TO   = process.env.EMAIL_TO || EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

const transporter = (EMAIL_USER && EMAIL_PASS) ? nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
}) : null;

// ── Segurança: hash de senha (scrypt nativo) ──
function hashSenha(senha) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(senha, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

function verificarSenha(senha, hash) {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':');
    if (!salt || !key) return resolve(false);
    crypto.scrypt(senha, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey));
    });
  });
}

function gerarTokenSessao() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Auth: campos públicos (sem senha e token) ──
const CAMPOS_PUBLICOS = 'id, email, nome, sobrenome, cpf, whatsapp, cep, logradouro, numero, complemento, bairro, cidade, estado';

async function validarSessao(req, res) {
  const id    = req.headers['x-conta-id'];
  const token = req.headers['x-conta-token'];
  if (!id || !token) { res.status(401).json({ erro: 'Não autenticado.' }); return null; }
  const { data } = await supabase.from('contas').select('id').eq('id', id).eq('token_sessao', token).single();
  if (!data) { res.status(401).json({ erro: 'Sessão inválida.' }); return null; }
  return data;
}

function enviarBackupPorEmail(pedido) {
  if (!transporter) return;
  transporter.sendMail({
    from: `"Hearts Backup" <${EMAIL_USER}>`,
    to: EMAIL_TO,
    subject: `📦 NOVO PEDIDO: ${pedido.nome}`,
    html: `
      <div style="font-family: sans-serif;">
        <h2 style="color: #c9963c;">Novo pedido - Hearts Couro</h2>
        <p><strong>Nome:</strong> ${pedido.nome} ${pedido.sobrenome || ''}</p>
        <p><strong>WhatsApp:</strong> ${pedido.whatsapp}</p>
        <p><strong>Endereço:</strong> ${pedido.logradouro}, ${pedido.numero} - ${pedido.bairro}</p>
        <p><strong>Cidade:</strong> ${pedido.cidade}/${pedido.estado} - CEP: ${pedido.cep}</p>
        <p><strong>Cor:</strong> ${pedido.cor} | <strong>Pagamento:</strong> ${pedido.pagamento}</p>
      </div>
    `
  }).catch(err => console.error('Erro e-mail:', err));
}

function enviarEmailConfirmacaoPagamento(pedido) {
  if (!transporter || !pedido.email) return;
  const fmtValor = v => 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
  transporter.sendMail({
    from: `"Hearts Couro" <${EMAIL_USER}>`,
    to: pedido.email,
    subject: `✅ Pagamento confirmado — Hearts Couro`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:1.5rem;">
      <h2 style="color:#c9963c;">Pagamento confirmado! 🎉</h2>
      <p>Olá, <strong>${pedido.nome}</strong>!</p>
      <p>Seu pagamento foi confirmado. Estamos preparando sua bolsa com muito carinho.</p>
      <table style="width:100%;border-collapse:collapse;margin:1rem 0;font-size:0.9rem;">
        <tr><td style="padding:5px 0;color:#888;">Produto</td><td style="padding:5px 0;"><strong>${pedido.produto || 'Bolsa'} — ${pedido.cor || ''}</strong></td></tr>
        <tr><td style="padding:5px 0;color:#888;">Total</td><td style="padding:5px 0;"><strong>${fmtValor(pedido.valor_total)}</strong></td></tr>
        <tr><td style="padding:5px 0;color:#888;">Envio</td><td style="padding:5px 0;">${pedido.frete_nome || 'A confirmar'}</td></tr>
      </table>
      <p>Em breve você receberá o código de rastreio da sua entrega. 💛</p>
      <p style="color:#aaa;font-size:0.8rem;">Hearts Couro Legítimo</p>
    </div>`
  }).catch(err => console.error('Erro e-mail confirmação:', err));
}

function enviarEmailRastreio(pedido, codigoRastreio) {
  if (!transporter || !pedido.email) return;
  transporter.sendMail({
    from: `"Hearts Couro" <${EMAIL_USER}>`,
    to: pedido.email,
    subject: `📦 Sua bolsa Hearts Couro foi enviada!`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:1.5rem;">
      <h2 style="color:#c9963c;">Sua bolsa está a caminho! 🚚</h2>
      <p>Olá, <strong>${pedido.nome}</strong>!</p>
      <p>Sua <strong>${pedido.produto || 'bolsa'} — ${pedido.cor || ''}</strong> foi enviada!</p>
      ${codigoRastreio ? `<div style="background:#f8f8f8;border-left:4px solid #c9963c;padding:1rem;margin:1rem 0;border-radius:4px;">
        <p style="margin:0;color:#555;font-size:0.85rem;">Código de Rastreio:</p>
        <p style="margin:0.4rem 0 0;font-size:1.4rem;font-weight:700;letter-spacing:0.08em;">${codigoRastreio}</p>
      </div>
      <p>Rastreie em: <a href="https://rastreamento.correios.com.br" style="color:#c9963c;">rastreamento.correios.com.br</a></p>` : '<p>Em breve você poderá rastrear sua entrega.</p>'}
      <p>Obrigada pela sua compra! 💛</p>
      <p style="color:#aaa;font-size:0.8rem;">Hearts Couro Legítimo</p>
    </div>`
  }).catch(err => console.error('Erro e-mail rastreio:', err));
}

// ── ROTA: Calcular Frete (Melhor Envio) ──
app.post('/api/calcular-frete', async (req, res) => {
  const cepDestino = (req.body.cep || '').replace(/\D/g, '');
  if (cepDestino.length !== 8) return res.status(400).json({ erro: 'CEP inválido.' });

  const qtd = Math.max(1, parseInt(req.body.quantidade) || 1);
  const itens = Array.isArray(req.body.itens) ? req.body.itens : [];

  // Busca dimensões de produtos novos (não hardcoded) no banco
  const chavesNovos = itens.map(i => i.produto).filter(c => c && !PACOTE_PRODUTO[c]);
  let dbDimensoes = {};
  if (chavesNovos.length > 0) {
    const { data: dbProds } = await supabase
      .from('produtos').select('chave, altura, largura, comprimento, peso')
      .in('chave', chavesNovos);
    (dbProds || []).forEach(p => {
      if (p.altura && p.largura && p.comprimento && p.peso)
        dbDimensoes[p.chave] = { height: p.altura, width: p.largura, length: p.comprimento, weight: p.peso };
    });
  }

  // Usa a maior embalagem entre os produtos do carrinho
  const base = itens.reduce((maior, item) => {
    const p = PACOTE_PRODUTO[item.produto] || dbDimensoes[item.produto] || PACOTE;
    return (p.width * p.length > maior.width * maior.length) ? p : maior;
  }, PACOTE);

  const pacoteCalc = {
    height: Math.min(base.height * qtd, 70),
    width:  base.width,
    length: base.length,
    weight: base.weight * qtd
  };

  try {
    const resp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/calculate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ME_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': `Hearts Couro (${process.env.EMAIL_USER || 'contato@heartscouro.com.br'})`
      },
      body: JSON.stringify({
        from: { postal_code: process.env.CEP_ORIGEM },
        to:   { postal_code: cepDestino },
        package: pacoteCalc,
        options: {
          insurance_value: PRECO_PRODUTO,
          receipt: false,
          own_hand: false
        }
      })
    });

    const texto = await resp.text();
    console.log('ME status:', resp.status);
    console.log('ME resposta:', texto);

    let data;
    try { data = JSON.parse(texto); } catch { data = texto; }

    if (!Array.isArray(data)) {
      return res.status(502).json({ erro: 'Erro ao consultar frete.' });
    }

    // Log de todos os serviços retornados para diagnóstico
    data.forEach(s => console.log(`[ME] id:${s.id} | ${s.company?.name} ${s.name} | R$${s.price} | erro:${s.error || 'nenhum'}`));

    const TAXA_EMBALAGEM = 7.00;

    const disponiveis = data.filter(s => !s.error && s.price);

    const servicosFiltrar = (nomes, excluir = []) =>
      disponiveis
        .filter(s => nomes.some(n => s.name?.toUpperCase().includes(n)) && !excluir.some(e => s.name?.toUpperCase().includes(e)))
        .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
        .map(s => ({
          id: s.id,
          nome: `${s.company.name} ${s.name}`,
          preco: parseFloat(s.price) + TAXA_EMBALAGEM,
          dias: s.delivery_time
        }));

    let opcoes = servicosFiltrar(['PAC'], ['PACKAGE']);
    if (opcoes.length === 0) opcoes = servicosFiltrar(['SEDEX']);

    console.log('ME opções válidas:', opcoes.length);
    if (opcoes.length === 0) return res.status(400).json({ erro: 'Não foi possível calcular o frete para este CEP.' });
    res.json(opcoes);
  } catch (err) {
    console.error('Erro ao calcular frete:', err.message);
    res.status(500).json({ erro: 'Erro ao calcular frete.', detalhe: err.message });
  }
});

// ── ROTA: Chave Pública MP (para Bricks no frontend) ──
app.get('/api/mp-public-key', (req, res) => {
  res.json({ publicKey: process.env.MP_PUBLIC_KEY });
});

// ── ROTA: Preparar Pedido (Step 1 — Bricks) ──
app.post('/api/preparar-pedido', async (req, res) => {
  const body = req.body;

  const itens = Array.isArray(body.itens) && body.itens.length > 0
    ? body.itens
    : [{ produto: body.produto, cor: body.cor, quantidade: 1, preco: PRODUTOS[body.produto] || PRECO_PRODUTO }];

  const freteValor = parseFloat(body.frete_valor) || 0;
  const subtotal = itens.reduce((s, i) => s + (PRODUTOS[i.produto] || i.preco || PRECO_PRODUTO) * (i.quantidade || 1), 0);
  const total = Math.round((subtotal + freteValor) * 100) / 100;

  body.produto = itens[0].produto;
  body.cor     = itens[0].cor;

  // Verifica estoque
  try {
    const reservaDesde = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const [{ data: confirmados }, { data: pendentes }] = await Promise.all([
      supabase.from('pedidos').select('produto, cor')
        .in('status', ['approved', 'etiqueta_criada', 'enviado', 'entregue', 'retirado'])
        .gte('created_at', ESTOQUE_RESET_DATA),
      supabase.from('pedidos').select('produto, cor')
        .eq('status', 'aguardando_pagamento')
        .gte('created_at', reservaDesde)
    ]);

    const ocupados = {};
    [...(confirmados || []), ...(pendentes || [])].forEach(p => {
      if (p.produto && p.cor) {
        const k = `${p.produto}_${p.cor}`;
        ocupados[k] = (ocupados[k] || 0) + 1;
      }
    });

    for (const item of itens) {
      const key = `${item.produto}_${item.cor}`;
      if (key in ESTOQUE_INICIAL) {
        const disponivel = Math.max(0, ESTOQUE_INICIAL[key] - (ocupados[key] || 0));
        if (disponivel < (item.quantidade || 1)) {
          return res.status(409).json({
            erro: `Essa bolsa (${item.produto} — ${item.cor}) não está mais disponível no momento.`
          });
        }
      }
    }
  } catch (err) {
    console.error('Erro ao verificar estoque:', err);
    return res.status(500).json({ erro: 'Erro ao verificar estoque.' });
  }

  // Cria pedido no Supabase
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .insert([{
        nome: body.nome, sobrenome: body.sobrenome,
        whatsapp: body.whatsapp, email: body.email, cpf: body.cpf,
        cep: body.cep, logradouro: body.logradouro, numero: body.numero,
        complemento: body.complemento, bairro: body.bairro,
        cidade: body.cidade, estado: body.estado,
        cor: body.cor, pagamento: 'aguardando', obs: body.obs,
        frete_nome: body.frete_nome || null, frete_valor: freteValor || null,
        frete_prazo: body.frete_prazo || null, valor_total: total,
        produto: body.produto || null, status: 'aguardando_pagamento',
        itens: itens.length > 1 ? itens : null
      }])
      .select().single();

    if (error) throw error;
    enviarBackupPorEmail(data);
    return res.json({ pedidoId: data.id, total });
  } catch (err) {
    console.error('Erro ao preparar pedido:', err);
    return res.status(500).json({ erro: 'Erro ao registrar pedido.', detalhe: String(err?.message || err) });
  }
});

// ── ROTA: Processar Pagamento Brick (Step 2) ──
app.post('/api/processar-pagamento', async (req, res) => {
  const { pedidoId, formData } = req.body;
  if (!pedidoId || !formData) return res.status(400).json({ erro: 'Dados incompletos.' });

  const { data: pedido, error: errPedido } = await supabase
    .from('pedidos').select('*').eq('id', pedidoId).single();
  if (errPedido || !pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });

  const total  = parseFloat(pedido.valor_total);
  const isPix  = formData.payment_method_id === 'pix';
  const metodo = isPix ? 'Pix' : 'Cartão';

  try {
    const cpfLimpo = (pedido.cpf || '').replace(/\D/g, '');
    const payerIdent = cpfLimpo.length === 11
      ? { type: 'CPF', number: cpfLimpo }
      : (formData.payer?.identification || {});

    const paymentBody = {
      transaction_amount: total,
      description: `Bolsa Hearts Couro — ${pedido.produto || 'Bolsa'} (${pedido.cor || ''})`,
      payment_method_id: formData.payment_method_id,
      external_reference: String(pedidoId),
      payer: {
        email: pedido.email,
        first_name: pedido.nome,
        last_name: pedido.sobrenome || '',
        identification: payerIdent
      }
    };

    if (!isPix) {
      paymentBody.token               = formData.token;
      paymentBody.installments        = parseInt(formData.installments) || 1;
      paymentBody.three_d_secure_mode = 'optional';
      if (formData.issuer_id) paymentBody.issuer_id = formData.issuer_id;
    }

    const pagamento = await mpPayment.create({
      body: paymentBody,
      requestOptions: { idempotencyKey: uuidv4() }
    });

    const status = pagamento.status;
    const novoStatus = status === 'approved' ? 'approved'
      : status === 'rejected' ? 'rejected'
      : 'aguardando_pagamento';
    await supabase.from('pedidos').update({
      status: novoStatus,
      pagamento: metodo
    }).eq('id', pedidoId);

    if (status === 'approved') {
      enviarEmailConfirmacaoPagamento({ ...pedido, pagamento: metodo });
    }

    if (isPix) {
      const txData = pagamento.point_of_interaction?.transaction_data;
      return res.json({
        tipo: 'pix', status, pedidoId, total,
        qrCode: txData?.qr_code,
        qrCodeBase64: txData?.qr_code_base64
      });
    }

    return res.json({ tipo: 'card', status, pedidoId });
  } catch (err) {
    const causes = err?.cause ?? err;
    const mpErro = Array.isArray(causes)
      ? causes.map(c => `${c.code}: ${c.description}`).join(' | ')
      : (err?.message || String(causes));
    console.error('Erro ao processar pagamento brick:', JSON.stringify(causes, null, 2));
    return res.status(500).json({ erro: 'Erro ao processar pagamento.', detalhe: mpErro });
  }
});

// ── ROTA: Criar Pedido + Pagamento Mercado Pago ──
app.post('/api/criar-pagamento', async (req, res) => {
  const body = req.body;

  // Suporte a carrinho (itens[]) ou pedido único legado (produto/cor)
  const itens = Array.isArray(body.itens) && body.itens.length > 0
    ? body.itens
    : [{ produto: body.produto, cor: body.cor, quantidade: 1, preco: PRODUTOS[body.produto] || PRECO_PRODUTO }];

  const freteValor = parseFloat(body.frete_valor) || 0;
  const subtotal = itens.reduce((s, i) => s + (PRODUTOS[i.produto] || i.preco || PRECO_PRODUTO) * (i.quantidade || 1), 0);
  const total = Math.round((subtotal + freteValor) * 100) / 100;

  // Campos legado para compatibilidade com Supabase
  const precoProduto = PRODUTOS[itens[0].produto] || PRECO_PRODUTO;
  body.produto = itens[0].produto;
  body.cor     = itens[0].cor;

  // 0. Verifica estoque antes de criar o pedido
  // Conta confirmados + aguardando dos últimos 20 min (reserva contra compra simultânea)
  try {
    const reservaDesde = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    const [{ data: confirmados }, { data: pendentes }] = await Promise.all([
      supabase.from('pedidos').select('produto, cor')
        .in('status', ['approved', 'etiqueta_criada', 'enviado', 'entregue', 'retirado'])
        .gte('created_at', ESTOQUE_RESET_DATA),
      supabase.from('pedidos').select('produto, cor')
        .eq('status', 'aguardando_pagamento')
        .gte('created_at', reservaDesde)
    ]);

    const ocupados = {};
    [...(confirmados || []), ...(pendentes || [])].forEach(p => {
      if (p.produto && p.cor) {
        const k = `${p.produto}_${p.cor}`;
        ocupados[k] = (ocupados[k] || 0) + 1;
      }
    });

    for (const item of itens) {
      const key = `${item.produto}_${item.cor}`;
      if (key in ESTOQUE_INICIAL) {
        const disponivel = Math.max(0, ESTOQUE_INICIAL[key] - (ocupados[key] || 0));
        const solicitado = item.quantidade || 1;
        if (disponivel < solicitado) {
          return res.status(409).json({
            erro: `Essa bolsa (${item.produto} — ${item.cor}) não está mais disponível no momento. Tente outra cor ou entre em contato.`
          });
        }
      }
    }
  } catch (err) {
    console.error('Erro ao verificar estoque:', err);
    return res.status(500).json({ erro: 'Erro ao verificar estoque.' });
  }

  // 1. Salva pedido no Supabase
  let pedidoId = null;
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .insert([{
        nome: body.nome,
        sobrenome: body.sobrenome,
        whatsapp: body.whatsapp,
        email: body.email,
        cpf: body.cpf,
        cep: body.cep,
        logradouro: body.logradouro,
        numero: body.numero,
        complemento: body.complemento,
        bairro: body.bairro,
        cidade: body.cidade,
        estado: body.estado,
        cor: body.cor,
        pagamento: body.pagamento,
        parcelas: body.parcelas,
        obs: body.obs,
        frete_nome: body.frete_nome || null,
        frete_valor: freteValor || null,
        frete_prazo: body.frete_prazo || null,
        valor_total: total,
        produto: body.produto || process.env.NOME_PRODUTO || null,
        status: 'aguardando_pagamento',
        itens: itens.length > 1 ? itens : null
      }])
      .select()
      .single();

    if (error) throw error;
    pedidoId = data.id;
    enviarBackupPorEmail(data);
  } catch (err) {
    console.error('Erro ao salvar pedido:', JSON.stringify(err, null, 2));
    return res.status(500).json({ erro: 'Erro ao registrar pedido.', detalhe: String(err?.message || err) });
  }

  // 2. Cria pagamento no Mercado Pago
  try {
    if (body.pagamento === 'Pix') {
      const pixPayer = {
        email: body.email,
        first_name: body.nome,
        last_name: body.sobrenome || ''
      };
      const cpfLimpo = body.cpf ? body.cpf.replace(/\D/g, '') : '';
      if (cpfLimpo.length === 11) {
        pixPayer.identification = { type: 'CPF', number: cpfLimpo };
      }

      const pix = await mpPayment.create({
        body: {
          transaction_amount: total,
          description: itens.length === 1
            ? `Bolsa Hearts Couro - Ref: ${itens[0].produto || 'Bolsa'} (${itens[0].cor || 'cor'})`
            : `Hearts Couro - ${itens.length} bolsas`,
          payment_method_id: 'pix',
          payer: pixPayer,
          external_reference: String(pedidoId)
        },
        requestOptions: { idempotencyKey: uuidv4() }
      });

      return res.json({
        tipo: 'pix',
        qrCode: pix.point_of_interaction.transaction_data.qr_code,
        qrCodeBase64: pix.point_of_interaction.transaction_data.qr_code_base64,
        total,
        pedidoId
      });

    } else {
      const parcelas = parseInt(body.parcelas) || 6;
      const baseUrl = process.env.BASE_URL || '';

      const pref = await mpPreference.create({
        body: {
          items: [
            ...itens.map((it, idx) => ({
              id: `hearts-${(it.produto||'bolsa').toLowerCase()}-${pedidoId}-${idx}`,
              title: `Bolsa Hearts Couro - Ref: ${it.produto} (${it.cor})`,
              quantity: it.quantidade || 1,
              unit_price: PRODUTOS[it.produto] || it.preco || PRECO_PRODUTO,
              currency_id: 'BRL'
            })),
            ...(freteValor > 0 ? [{
              id: `frete-${pedidoId}`,
              title: `Frete — ${body.frete_nome || 'Entrega'}`,
              quantity: 1,
              unit_price: freteValor,
              currency_id: 'BRL'
            }] : [])
          ],
          payer: {
            name: body.nome,
            surname: body.sobrenome || '',
            email: body.email
          },
          payment_methods: { installments: parcelas },
          external_reference: String(pedidoId),
          ...(baseUrl && {
            notification_url: `${baseUrl}/api/webhook/mercadopago`,
            back_urls: {
              success: `${baseUrl}/?pago=ok`,
              failure: `${baseUrl}/?pago=erro`,
              pending: `${baseUrl}/?pago=pendente`
            },
            auto_return: 'approved'
          })
        }
      });

      return res.json({
        tipo: 'link',
        checkoutUrl: pref.init_point,
        pedidoId
      });
    }
  } catch (err) {
    const detalhe = err?.cause || err;
    console.error('Erro ao criar pagamento MP:', JSON.stringify(detalhe, null, 2));
    return res.status(500).json({ erro: 'Erro ao gerar pagamento. Tente novamente.', detalhe: String(detalhe?.message || detalhe) });
  }
});

// ── ROTA: Webhook Mercado Pago (atualiza status do pedido) ──
app.post('/api/webhook/mercadopago', async (req, res) => {
  res.sendStatus(200);

  const { type, data } = req.body || {};
  if (type !== 'payment' || !data?.id) return;

  try {
    const pagamento = await mpPayment.get({ id: data.id });
    const pedidoId = pagamento.external_reference;
    const status   = pagamento.status; // approved | pending | rejected

    if (pedidoId) {
      await supabase.from('pedidos').update({ status }).eq('id', pedidoId);
      console.log(`✅ Pedido ${pedidoId} → status: ${status}`);
      if (status === 'approved') {
        const { data: pd } = await supabase.from('pedidos').select('*').eq('id', pedidoId).single();
        if (pd) enviarEmailConfirmacaoPagamento(pd);
      }
    }
  } catch (err) {
    console.error('Erro no webhook MP:', err);
  }
});

// ── ROTA: Verificar Pagamento no Mercado Pago ──
app.get('/api/verificar-pagamento/:id', async (req, res) => {
  const pedidoId = req.params.id;
  try {
    const resp = await fetch(
      `https://api.mercadopago.com/v1/payments/search?external_reference=${pedidoId}&sort=date_created&criteria=desc`,
      { headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );
    const data = await resp.json();
    const pagamentos = data.results || [];

    const aprovado = pagamentos.find(p => p.status === 'approved');
    if (aprovado) {
      await supabase.from('pedidos').update({ status: 'approved' }).eq('id', pedidoId);
      const { data: pd } = await supabase.from('pedidos').select('*').eq('id', pedidoId).single();
      if (pd) enviarEmailConfirmacaoPagamento(pd);
      return res.json({ status: 'approved', mensagem: 'Pagamento confirmado! Pedido atualizado.' });
    }

    const emProcesso = pagamentos.find(p => p.status === 'pending' || p.status === 'in_process');
    if (emProcesso) {
      return res.json({ status: 'pending', mensagem: 'Pagamento ainda em processamento no Mercado Pago.' });
    }

    // Cancelado, reembolsado ou estornado → remove o pedido automaticamente
    const cancelado = pagamentos.find(p =>
      p.status === 'cancelled' || p.status === 'refunded' || p.status === 'charged_back'
    );
    if (cancelado) {
      await supabase.from('pedidos').delete().eq('id', pedidoId);
      return res.json({ status: 'removido', mensagem: `Pedido removido (${cancelado.status}).` });
    }

    if (pagamentos.length === 0) {
      return res.json({ status: 'nao_encontrado', mensagem: 'Nenhum pagamento encontrado para este pedido.' });
    }

    return res.json({ status: pagamentos[0].status, mensagem: `Status no Mercado Pago: ${pagamentos[0].status}` });
  } catch (err) {
    console.error('Erro ao verificar pagamento:', err);
    res.status(500).json({ status: 'erro', mensagem: 'Erro ao consultar o Mercado Pago.' });
  }
});

// Data em que o estoque foi zerado/reiniciado — só pedidos a partir daqui são descontados
const ESTOQUE_RESET_DATA = '2026-06-01';

// ── ROTA: Estoque por Cor ──
app.get('/api/estoque', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .select('produto, cor, status')
      .in('status', ['approved', 'etiqueta_criada', 'enviado', 'entregue', 'retirado'])
      .gte('created_at', ESTOQUE_RESET_DATA);

    if (error) throw error;

    const vendidos = {};
    (data || []).forEach(p => {
      if (p.produto && p.cor) {
        const key = `${p.produto}_${p.cor}`;
        vendidos[key] = (vendidos[key] || 0) + 1;
      }
    });

    const estoque = {};
    for (const [key, inicial] of Object.entries(ESTOQUE_INICIAL)) {
      estoque[key] = Math.max(0, inicial - (vendidos[key] || 0));
    }

    res.json(estoque);
  } catch (err) {
    console.error('Erro ao calcular estoque:', err);
    res.status(500).json({});
  }
});

// ── ROTA: Listar Pedidos ──
app.get('/api/pedidos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json([]);
  }
});

// ── ROTA: Mudar Status ──
app.post('/api/status', async (req, res) => {
  const { id, status, codigo_rastreio } = req.body;
  try {
    const update = { status };
    if (codigo_rastreio) update.codigo_rastreio = codigo_rastreio;
    const { error } = await supabase.from('pedidos').update(update).eq('id', id);
    if (error) throw error;
    res.send('ok');
  } catch {
    res.status(500).send('erro');
  }
});

// ── ROTA: Remover Pedido ──
app.delete('/api/pedidos/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { error } = await supabase.from('pedidos').delete().eq('id', id);
    if (error) throw error;
    res.send('ok');
  } catch {
    res.status(500).send('erro');
  }
});

// ── ROTA: Gerar Etiqueta Melhor Envio ──
app.post('/api/gerar-etiqueta/:id', async (req, res) => {
  const pedidoId = parseInt(req.params.id);

  const { data: pedido, error: errPedido } = await supabase
    .from('pedidos').select('*').eq('id', pedidoId).single();

  if (errPedido || !pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });

  const meHeaders = {
    'Authorization': `Bearer ${process.env.ME_TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': `Hearts Couro (${process.env.EMAIL_USER})`
  };

  try {
    // Busca dimensões do produto no banco se não estiver no mapa hardcoded
    let pacotePedido = PACOTE_PRODUTO[pedido.produto] || PACOTE;
    if (!PACOTE_PRODUTO[pedido.produto] && pedido.produto) {
      const { data: prodDb } = await supabase
        .from('produtos').select('altura, largura, comprimento, peso').eq('chave', pedido.produto).single();
      if (prodDb && prodDb.altura && prodDb.largura && prodDb.comprimento && prodDb.peso)
        pacotePedido = { height: prodDb.altura, width: prodDb.largura, length: prodDb.comprimento, weight: prodDb.peso };
    }

    // 1. Descobre o ID do serviço PAC para este CEP
    const calcResp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/calculate', {
      method: 'POST', headers: meHeaders,
      body: JSON.stringify({
        from: { postal_code: process.env.CEP_ORIGEM },
        to:   { postal_code: pedido.cep.replace(/\D/g, '') },
        package: pacotePedido,
        options: { insurance_value: PRODUTOS[pedido.produto] || PRECO_PRODUTO, receipt: false, own_hand: false }
      })
    });
    const calcData = await calcResp.json();
    if (Array.isArray(calcData)) {
      calcData.forEach(s => console.log(`[ETIQUETA] id:${s.id} | ${s.company?.name} ${s.name} | erro:${s.error || 'nenhum'}`));
    } else {
      console.log('[ETIQUETA] calcData inesperado:', JSON.stringify(calcData));
    }
    const disponiveis = Array.isArray(calcData) ? calcData.filter(s => !s.error && s.price) : [];
    const pac = disponiveis.find(s => s.name?.toUpperCase().includes('PAC') && !s.name?.toUpperCase().includes('PACKAGE'))
             || disponiveis.find(s => s.name?.toUpperCase().includes('SEDEX'));
    if (!pac) return res.status(400).json({ erro: 'Serviço PAC/SEDEX não disponível para este CEP.' });

    // 2. Adiciona ao carrinho ME
    const cartResp = await fetch('https://melhorenvio.com.br/api/v2/me/cart', {
      method: 'POST', headers: meHeaders,
      body: JSON.stringify({
        service: pac.id,
        from: {
          name:        process.env.ME_NOME_REMETENTE,
          phone:       (process.env.ME_TEL_REMETENTE || '').replace(/\D/g, ''),
          document:    (process.env.ME_CPF_REMETENTE || '').replace(/\D/g, ''),
          address:     process.env.ME_LOGRADOURO,
          number:      process.env.ME_NUMERO,
          complement:  process.env.ME_COMPLEMENTO || '',
          district:    process.env.ME_BAIRRO,
          city:        process.env.ME_CIDADE,
          state_abbr:  process.env.ME_ESTADO,
          country_id:  'BR',
          postal_code: (process.env.CEP_ORIGEM || '').replace(/\D/g, '')
        },
        to: {
          name:        `${pedido.nome} ${pedido.sobrenome || ''}`.trim(),
          phone:       (pedido.whatsapp || '').replace(/\D/g, ''),
          email:       pedido.email || '',
          document:    (pedido.cpf  || '').replace(/\D/g, ''),
          address:     pedido.logradouro || '',
          number:      pedido.numero     || '',
          complement:  pedido.complemento || '',
          district:    pedido.bairro     || '',
          city:        pedido.cidade     || '',
          state_abbr:  pedido.estado     || '',
          country_id:  'BR',
          postal_code: pedido.cep.replace(/\D/g, '')
        },
        products: [{
          name: `Bolsa Hearts Couro - ${pedido.produto || 'Paola'} (${pedido.cor || ''})`,
          quantity: 1,
          unitary_value: pedido.valor_total || PRECO_PRODUTO
        }],
        volumes: [pacotePedido],
        options: {
          insurance_value: pedido.valor_total || PRECO_PRODUTO,
          receipt: false, own_hand: false, collect: false, reverse: false, non_commercial: false
        }
      })
    });
    const cartData = await cartResp.json();
    console.log('[ETIQUETA CART]', JSON.stringify(cartData));
    if (!cartData.id) return res.status(502).json({ erro: 'Erro ao criar envio no Melhor Envio.', detalhe: cartData });

    const orderId = cartData.id;

    return res.json({ sucesso: true, orderId });

  } catch (err) {
    console.error('Erro ao gerar etiqueta:', err);
    return res.status(500).json({ erro: 'Erro ao gerar etiqueta.' });
  }
});

// ── ROTA: Enviar Código de Rastreio ao Cliente ──
app.post('/api/enviar-rastreio', async (req, res) => {
  const { id, codigo_rastreio } = req.body;
  try {
    if (codigo_rastreio) {
      await supabase.from('pedidos').update({ codigo_rastreio }).eq('id', id);
    }
    const { data: pedido } = await supabase.from('pedidos').select('*').eq('id', id).single();
    if (pedido) enviarEmailRastreio(pedido, codigo_rastreio || '');
    res.send('ok');
  } catch {
    res.status(500).send('erro');
  }
});

// ── ROTA: Pedidos do Cliente Logado ──
app.get('/api/conta/pedidos', async (req, res) => {
  const sess = await validarSessao(req, res);
  if (!sess) return;

  const { data: conta } = await supabase.from('contas').select('email, cpf').eq('id', sess.id).single();
  if (!conta) return res.status(404).json([]);

  try {
    const cpfLimpo = (conta.cpf || '').replace(/\D/g, '');
    let query = supabase.from('pedidos').select('id, produto, cor, valor_total, frete_nome, frete_valor, status, codigo_rastreio, created_at, pagamento').order('created_at', { ascending: false });

    if (cpfLimpo.length === 11) {
      query = query.or(`email.eq.${conta.email},cpf.ilike.%${cpfLimpo}%`);
    } else {
      query = query.eq('email', conta.email);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Erro ao buscar pedidos do cliente:', err);
    res.status(500).json([]);
  }
});

// ── ROTA: Upload de Imagem para Supabase Storage ──
app.post('/api/admin/upload-imagem', upload.single('imagem'), async (req, res) => {
  if (req.headers['senha'] !== process.env.ADMIN_SENHA) return res.status(401).json({ erro: 'Não autorizado.' });
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem enviada.' });

  // Cria o bucket se ainda não existir
  const { error: bucketErr } = await supabase.storage.createBucket('produtos-imgs', { public: true });
  if (bucketErr && !bucketErr.message.includes('already exists')) {
    return res.status(500).json({ erro: 'Erro ao preparar storage: ' + bucketErr.message });
  }

  const ext = req.file.originalname.split('.').pop().toLowerCase();
  const nome = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from('produtos-imgs')
    .upload(nome, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

  if (error) return res.status(500).json({ erro: error.message });

  const { data } = supabase.storage.from('produtos-imgs').getPublicUrl(nome);
  res.json({ url: data.publicUrl });
});

// ── ROTA: Remover Imagem do Supabase Storage ──
app.delete('/api/admin/imagem', async (req, res) => {
  if (req.headers['senha'] !== process.env.ADMIN_SENHA) return res.status(401).json({ erro: 'Não autorizado.' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ erro: 'URL obrigatória.' });

  const nome = url.split('/').pop();
  await supabase.storage.from('produtos-imgs').remove([nome]);
  res.json({ ok: true });
});

// ── ROTA: Listar Produtos (público — usado pelo index.html) ──
app.get('/api/produtos', async (req, res) => {
  try {
    const { data, error } = await supabase.from('produtos').select('*').order('ordem');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json([]);
  }
});

// ── ROTA: Atualizar Produto (admin) ──
app.put('/api/admin/produtos/:chave', async (req, res) => {
  const { senha } = req.headers;
  if (senha !== process.env.ADMIN_SENHA) return res.status(401).json({ erro: 'Não autorizado.' });

  const { chave } = req.params;
  const { nome, preco, ativo, desc, imgs, cores, altura, largura, comprimento, peso } = req.body;
  try {
    const update = {};
    if (nome        !== undefined) update.nome        = nome;
    if (preco       !== undefined) update.preco       = parseInt(preco);
    if (ativo       !== undefined) update.ativo       = ativo;
    if (desc        !== undefined) update.descricao   = desc;
    if (imgs        !== undefined) update.imgs        = imgs;
    if (cores       !== undefined) update.cores       = cores;
    if (altura      !== undefined) update.altura      = altura;
    if (largura     !== undefined) update.largura     = largura;
    if (comprimento !== undefined) update.comprimento = comprimento;
    if (peso        !== undefined) update.peso        = peso;

    const { error } = await supabase.from('produtos').update(update).eq('chave', chave);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── ROTA: Criar Produto (admin) ──
app.post('/api/admin/produtos', async (req, res) => {
  const { senha } = req.headers;
  if (senha !== process.env.ADMIN_SENHA) return res.status(401).json({ erro: 'Não autorizado.' });

  const { chave, nome, preco, ativo, desc, ordem, cores, altura, largura, comprimento, peso } = req.body;
  if (!chave || !nome || !preco) return res.status(400).json({ erro: 'chave, nome e preco são obrigatórios.' });
  try {
    const { error } = await supabase.from('produtos').insert([{
      chave, nome, preco: parseInt(preco),
      ativo: ativo !== false,
      descricao: desc || [],
      cores: cores || [],
      ordem: ordem || 99,
      altura:      altura      || 11,
      largura:     largura     || 30,
      comprimento: comprimento || 32,
      peso:        peso        || 1.0
    }]);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── ROTA: Login Gestão ──
app.post('/api/admin/login', (req, res) => {
  const { senha } = req.body;
  if (senha && senha === process.env.ADMIN_SENHA) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, erro: 'Senha incorreta.' });
});

// ── ROTA: Diagnóstico ──
app.get('/api/diagnostico', async (req, res) => {
  const resultado = {
    mp_token:    !!process.env.MP_ACCESS_TOKEN,
    supabase_url: !!process.env.SUPABASE_URL,
    supabase_key: !!process.env.SUPABASE_KEY,
    base_url:    process.env.BASE_URL || 'NÃO DEFINIDO',
  };

  try {
    const { data, error } = await supabase.from('pedidos').select('id').limit(1);
    resultado.supabase_ok = !error;
    resultado.supabase_erro = error?.message || null;
  } catch (e) {
    resultado.supabase_ok = false;
    resultado.supabase_erro = e.message;
  }

  try {
    const r = await fetch('https://api.mercadopago.com/v1/payment_methods', {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    resultado.mp_api_status = r.status;
    resultado.mp_ok = r.status === 200;
  } catch (e) {
    resultado.mp_ok = false;
    resultado.mp_api_erro = e.message;
  }

  res.json(resultado);
});

// ── ROTA: Registrar Conta ──
app.post('/api/conta/registrar', async (req, res) => {
  const { email, senha, nome, sobrenome, whatsapp, cpf, cep, logradouro, numero, complemento, bairro, cidade, estado } = req.body;
  if (!email || !senha || !nome) return res.status(400).json({ erro: 'Nome, e-mail e senha são obrigatórios.' });
  if (senha.length < 6) return res.status(400).json({ erro: 'Senha deve ter pelo menos 6 caracteres.' });

  try {
    const senhaHash = await hashSenha(senha);
    const token = gerarTokenSessao();

    // INSERT com campos básicos
    const { data: novo, error } = await supabase.from('contas').insert([{
      email: email.toLowerCase().trim(),
      senha_hash: senhaHash,
      token_sessao: token,
      nome: nome.trim(),
      sobrenome: (sobrenome || '').trim(),
      whatsapp: whatsapp || '',
      cpf: cpf || ''
    }]).select('id').single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ erro: 'E-mail já cadastrado. Tente entrar.' });
      throw error;
    }

    // UPDATE separado para endereço (contorna cache do PostgREST)
    const upd = await supabase.from('contas').update({
      cep: cep || null, logradouro: logradouro || null, numero: numero || null,
      complemento: complemento || null, bairro: bairro || null,
      cidade: cidade || null, estado: estado || null
    }).eq('id', novo.id);

    const { data } = await supabase.from('contas').select(CAMPOS_PUBLICOS).eq('id', novo.id).single();
    res.json({ ...data, token_sessao: token });
  } catch (err) {
    console.error('Erro ao registrar conta:', err);
    res.status(500).json({ erro: 'Erro ao criar conta.' });
  }
});

// ── ROTA: Login ──
app.post('/api/conta/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha são obrigatórios.' });

  try {
    const { data: conta } = await supabase.from('contas').select('*').eq('email', email.toLowerCase().trim()).single();
    if (!conta) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });

    const ok = await verificarSenha(senha, conta.senha_hash);
    if (!ok) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });

    const token = gerarTokenSessao();
    await supabase.from('contas').update({ token_sessao: token }).eq('id', conta.id);

    const { senha_hash, token_sessao, ...pub } = conta;
    res.json({ ...pub, token_sessao: token });
  } catch (err) {
    console.error('Erro ao fazer login:', err);
    res.status(500).json({ erro: 'Erro ao entrar.' });
  }
});

// ── ROTA: Perfil ──
app.get('/api/conta/perfil', async (req, res) => {
  const sess = await validarSessao(req, res);
  if (!sess) return;
  const { data } = await supabase.from('contas').select(CAMPOS_PUBLICOS).eq('id', sess.id).single();
  res.json(data || {});
});

// ── ROTA: Atualizar Perfil ──
app.put('/api/conta/perfil', async (req, res) => {
  const sess = await validarSessao(req, res);
  if (!sess) return;

  const permitido = ['nome', 'sobrenome', 'whatsapp', 'cpf', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado'];
  const update = {};
  permitido.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

  await supabase.from('contas').update(update).eq('id', sess.id);
  res.json({ ok: true });
});

// ── ROTA: Clientes CRM / Fidelidade ──
app.get('/api/clientes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;

    const STATUS_CONFIRMADO = ['approved', 'etiqueta_criada', 'enviado', 'entregue', 'retirado'];
    const mapa = {};

    (data || []).forEach(p => {
      const chave = (p.cpf || '').replace(/\D/g, '') || p.email || p.whatsapp;
      if (!chave) return;

      if (!mapa[chave]) {
        mapa[chave] = {
          cpf: p.cpf,
          nome: p.nome,
          sobrenome: p.sobrenome,
          email: p.email,
          whatsapp: p.whatsapp,
          cidade: p.cidade,
          estado: p.estado,
          primeira_compra: p.created_at,
          ultima_compra: p.created_at,
          pedidos: [],
          total_gasto: 0,
          pontos: 0
        };
      }

      const c = mapa[chave];
      if (p.nome) c.nome = p.nome;
      if (p.sobrenome) c.sobrenome = p.sobrenome;
      if (p.email) c.email = p.email;
      if (p.whatsapp) c.whatsapp = p.whatsapp;
      if (p.cidade) c.cidade = p.cidade;
      if (p.estado) c.estado = p.estado;
      c.ultima_compra = p.created_at;
      c.pedidos.push(p);

      if (STATUS_CONFIRMADO.includes(p.status)) {
        const valor = parseFloat(p.valor_total) || 0;
        c.total_gasto += valor;
        c.pontos += Math.floor(valor);
      }
    });

    const clientes = Object.values(mapa).map(c => ({
      ...c,
      num_pedidos: c.pedidos.length,
      compras_confirmadas: c.pedidos.filter(p => STATUS_CONFIRMADO.includes(p.status)).length,
      nivel: c.pontos >= 1000 ? 'Ouro' : c.pontos >= 300 ? 'Prata' : 'Bronze'
    })).sort((a, b) => b.pontos - a.pontos);

    res.json(clientes);
  } catch (err) {
    console.error('Erro ao carregar clientes:', err);
    res.status(500).json([]);
  }
});

// ── ROTA: Esqueci minha senha ──
app.post('/api/conta/esqueci-senha', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ erro: 'E-mail obrigatório.' });

  try {
    const { data: conta } = await supabase
      .from('contas').select('id, nome').eq('email', email.toLowerCase().trim()).single();

    // Sempre responde ok — não revela se o e-mail existe
    if (!conta) return res.json({ ok: true });

    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora

    await supabase.from('contas').update({
      reset_token: token,
      reset_token_expiry: expiry
    }).eq('id', conta.id);

    const link = `${process.env.BASE_URL || 'http://localhost:5000'}/?acao=redefinir&token=${token}`;

    if (transporter) {
      await transporter.sendMail({
        from: `"Hearts Couro" <${EMAIL_USER}>`,
        to: email,
        subject: 'Redefinição de senha — Hearts Couro',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:1.5rem;">
          <h2 style="color:#c9963c;">Redefinir senha</h2>
          <p>Olá, <strong>${conta.nome || ''}</strong>!</p>
          <p>Recebemos uma solicitação para redefinir a senha da sua conta Hearts Couro.</p>
          <p>Clique no botão abaixo para criar uma nova senha. O link é válido por <strong>1 hora</strong>.</p>
          <div style="text-align:center;margin:2rem 0;">
            <a href="${link}" style="background:#c9963c;color:#fff;padding:0.8rem 2rem;border-radius:8px;text-decoration:none;font-weight:600;font-size:1rem;display:inline-block;">Redefinir minha senha</a>
          </div>
          <p style="font-size:0.8rem;color:#aaa;">Se você não solicitou isso, ignore este e-mail. Sua senha não será alterada.</p>
          <p style="color:#aaa;font-size:0.8rem;">Hearts Couro Legítimo</p>
        </div>`
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao enviar e-mail de recuperação:', err);
    res.status(500).json({ erro: 'Erro ao processar solicitação.' });
  }
});

// ── ROTA: Redefinir Senha ──
app.post('/api/conta/redefinir-senha', async (req, res) => {
  const { token, novaSenha } = req.body;
  if (!token || !novaSenha) return res.status(400).json({ erro: 'Token e nova senha são obrigatórios.' });
  if (novaSenha.length < 6) return res.status(400).json({ erro: 'Senha deve ter pelo menos 6 caracteres.' });

  try {
    const { data: conta } = await supabase
      .from('contas').select('id, reset_token_expiry').eq('reset_token', token).single();

    if (!conta) return res.status(400).json({ erro: 'Link inválido ou expirado.' });
    if (new Date(conta.reset_token_expiry) < new Date()) {
      return res.status(400).json({ erro: 'Link expirado. Solicite um novo.' });
    }

    const novoHash = await hashSenha(novaSenha);
    await supabase.from('contas').update({
      senha_hash: novoHash,
      reset_token: null,
      reset_token_expiry: null
    }).eq('id', conta.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao redefinir senha:', err);
    res.status(500).json({ erro: 'Erro ao redefinir senha.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🔥 Hearts Online na porta ${PORT}`));