'use strict';
/**
 * VIGIA DE FORA DO FORMULARIO (15/10/2026). Roda no GitHub, nunca na maquina que serve o formulario.
 *
 * Em 14/10 a maquina desligou as 13h29 e o formulario ficou ~13h30 fora do ar; o unico aviso de fora saiu 5 h
 * depois, porque este repositorio so olhava o pulso de 3 em 3 horas e nunca o endereco publico. Aqui, a cada 10
 * minutos:
 *   1. GET no endereco publico: 200 e a marca estrutural da pagina (a pagina de erro da Cloudflare tambem tem o
 *      nome do dominio, entao o nome nao serve de prova);
 *   2. POST de um evento de telemetria marcado `sonda_externa`: prova que o caminho de gravacao funciona. Nao e
 *      lead e nao vai ao CRM;
 *   3. ate 3 tentativas na mesma rodada (40 s entre elas): um soluço de rede nao vira alarme, e nao precisa
 *      guardar estado entre rodadas.
 * O alarme abre uma issue e FALHA a rodada de proposito (o e-mail de "Run failed" chega; o de issue nao). Com a
 * issue aberta, so grita de novo a cada 2 h; quando volta, a issue fecha.
 */
const URL_PADRAO = 'https://formulario.valeur.com.br/';
const MARCA = 'id="definicao-formulario"';
const ROTULO = 'formulario-fora';
const GRITAR_DE_NOVO_MS = 2 * 60 * 60 * 1000;

async function sondarUmaVez(url, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'vigia-de-fora bot/1.0 (sonda)' } });
    const corpo = await r.text();
    if (r.status !== 200) return { ok: false, motivo: `a pagina respondeu HTTP ${r.status}` };
    if (!corpo.includes(MARCA)) return { ok: false, motivo: 'a pagina respondeu 200 mas sem o formulario dentro' };
  } catch (e) {
    return { ok: false, motivo: `a pagina nao respondeu (${String((e && e.name) || 'erro')})` };
  }
  try {
    const agora = new Date().toISOString();
    const r = await fetchImpl(new URL('eventos', url).href, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json', origin: new URL(url).origin, 'user-agent': 'vigia-de-fora bot/1.0 (sonda)' },
      body: JSON.stringify({ eventos: [{ event_id: `sonda-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        session_id: 'sonda-externa', tipo: 'sonda_externa', seq: 0, cliente_ts: agora }] }),
    });
    const j = await r.json().catch(() => null);
    if (r.status !== 200 || !j || j.ok !== true) return { ok: false, motivo: `a pagina abre, mas o envio falha (HTTP ${r.status})` };
  } catch (e) {
    return { ok: false, motivo: `a pagina abre, mas o envio nao respondeu (${String((e && e.name) || 'erro')})` };
  }
  return { ok: true };
}

async function sondar({ url = URL_PADRAO, tentativas = 3, intervaloMs = 40000, fetchImpl = fetch,
  esperar = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const motivos = [];
  for (let i = 0; i < tentativas; i += 1) {
    if (i) await esperar(intervaloMs);
    const r = await sondarUmaVez(url, fetchImpl);
    if (r.ok) return { ok: true, motivos };
    motivos.push(r.motivo);
  }
  return { ok: false, motivos };
}

/** O que fazer com a issue e se a rodada grita. `ultimoGritoMs`: data do ultimo comentario (ou da abertura). */
function decidirAlarme({ ok, issueAberta, ultimoGritoMs = 0, agoraMs = Date.now() }) {
  if (ok) return { acao: issueAberta ? 'fechar' : 'nada', gritar: false };
  if (!issueAberta) return { acao: 'abrir', gritar: true };
  if (agoraMs - ultimoGritoMs >= GRITAR_DE_NOVO_MS) return { acao: 'comentar', gritar: true };
  return { acao: 'nada', gritar: false };
}

module.exports = { sondar, sondarUmaVez, decidirAlarme, URL_PADRAO, MARCA, ROTULO, GRITAR_DE_NOVO_MS };

if (require.main === module) {
  sondar({ url: process.env.URL_FORMULARIO || URL_PADRAO }).then((r) => {
    console.log(r.ok ? 'formulario no ar' : `formulario FORA: ${r.motivos.join(' | ')}`);
    if (process.env.GITHUB_OUTPUT) {
      require('fs').appendFileSync(process.env.GITHUB_OUTPUT, `resultado=${JSON.stringify(r)}\n`);
    }
  });
}
