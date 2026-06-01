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
  'Paola':   229.00,
  'Carol':   289.00,
  'Modelo4': 199.00, // Celina
  'Lara':    209.00,
  'Adriana': 189.00,
  'Miranda': 259.00,
  'Modelo3': 189.00, // Denise
  'Julia':   299.00,
  'Renata':  279.00,
  'Megan':   289.00,
  'Michele': 259.00,
};

// Embalagem da bolsa (para cálculo de frete)
const PACOTE = { height: 11, width: 30, length: 32, weight: 1.0 };

// Estoque inicial por produto_cor
const ESTOQUE_INICIAL = {
  'Paola_White':            6,
  'Paola_Whiskey':          7,
  'Paola_Preto':            3,
  'Paola_Cafe':             0,
  'Paola_Azul_claro':       0,
  'Paola_Argila':          16,
  'Paola_Pink':             2,
  'Paola_Caramelo':         3,
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
  const pacoteCalc = {
    height: Math.min(PACOTE.height * qtd, 70),
    width:  PACOTE.width,
    length: PACOTE.length,
    weight: PACOTE.weight * qtd
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
        status: 'aguardando_pagamento'
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
      .in('status', ['approved', 'enviado', 'entregue', 'retirado']);

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
    // 1. Descobre o ID do serviço PAC para este CEP
    const calcResp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/calculate', {
      method: 'POST', headers: meHeaders,
      body: JSON.stringify({
        from: { postal_code: process.env.CEP_ORIGEM },
        to:   { postal_code: pedido.cep.replace(/\D/g, '') },
        package: PACOTE,
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
        volumes: [PACOTE],
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
    const { data: pedido } = await supabase.from('pedidos').select('*').eq('id', id).single();
    if (pedido) enviarEmailRastreio(pedido, codigo_rastreio || '');
    res.send('ok');
  } catch {
    res.status(500).send('erro');
  }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Hearts Online na porta ${PORT}`));