require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');
const { v4: uuidv4 } = require('uuid');

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
  'Paola':    229.00,
  'Carol':    289.00,
  'Modelo3':  189.00,
  'Modelo4':  189.00,
  'Modelo5':  249.00,
  'Modelo6':  279.00,
  'Modelo7':  259.00,
  'Modelo8':  269.00,
  'Modelo9':  249.00,
  'Modelo10': 289.00,
  'Lara':     209.00,
  'Adriana':  189.00,
  'Julia':    299.00,
};

// Embalagem da bolsa (para cálculo de frete)
const PACOTE = { height: 10, width: 35, length: 40, weight: 0.8 };

// Estoque inicial por produto_cor
const ESTOQUE_INICIAL = {
  'Paola_White':           13,
  'Paola_Whiskey':         22,
  'Paola_Preto':           35,
  'Paola_Cafe':            16,
  'Paola_Azul_claro':       8,
  'Paola_Argila':          22,
  'Paola_Pink':             6,
  'Paola_Caramelo':        25,
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

// ── ROTA: Calcular Frete (Melhor Envio) ──
app.post('/api/calcular-frete', async (req, res) => {
  const cepDestino = (req.body.cep || '').replace(/\D/g, '');
  if (cepDestino.length !== 8) return res.status(400).json({ erro: 'CEP inválido.' });

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
        package: PACOTE,
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

    const SERVICOS_PERMITIDOS = [2]; // somente PAC
    const TAXA_EMBALAGEM = 7.00;

    const opcoes = data
      .filter(s => !s.error && s.price && SERVICOS_PERMITIDOS.includes(s.id))
      .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
      .map(s => ({
        id: s.id,
        nome: `${s.company.name} ${s.name}`,
        preco: parseFloat(s.price) + TAXA_EMBALAGEM,
        dias: s.delivery_time
      }));

    console.log('ME opções válidas:', opcoes.length);
    res.json(opcoes);
  } catch (err) {
    console.error('Erro ao calcular frete:', err.message);
    res.status(500).json({ erro: 'Erro ao calcular frete.' });
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
        itens: itens.length > 1 ? JSON.stringify(itens) : null,
        status: 'aguardando_pagamento'
      }])
      .select()
      .single();

    if (error) throw error;
    pedidoId = data.id;
    enviarBackupPorEmail(data);
  } catch (err) {
    console.error('Erro ao salvar pedido:', err);
    return res.status(500).json({ erro: 'Erro ao registrar pedido.' });
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
            ? `Bolsa Hearts Couro - Ref: ${itens[0].produto} (${itens[0].cor})`
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
    console.error('Erro ao criar pagamento MP:', err?.cause || err);
    return res.status(500).json({ erro: 'Erro ao gerar pagamento. Tente novamente.' });
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
      return res.json({ status: 'approved', mensagem: 'Pagamento confirmado! Pedido atualizado.' });
    }

    const emProcesso = pagamentos.find(p => p.status === 'pending' || p.status === 'in_process');
    if (emProcesso) {
      return res.json({ status: 'pending', mensagem: 'Pagamento ainda em processamento no Mercado Pago.' });
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

// ── ROTA: Estoque por Cor ──
app.get('/api/estoque', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .select('produto, cor, status')
      .in('status', ['approved', 'enviado']);

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
  const { id, status } = req.body;
  try {
    const { error } = await supabase
      .from('pedidos')
      .update({ status })
      .eq('id', id);
    if (error) throw error;
    res.send('ok');
  } catch {
    res.status(500).send('erro');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Hearts Online na porta ${PORT}`));