/**
 * Vigia de fora: decide os alarmes a partir do pulso-publico.json que a maquina publica de hora em hora.
 *
 * Fonte deste arquivo: repositorio privado da maquina (pasta batimento-publico), com teste na CI de la; o
 * repositorio publico recebe so a copia. A logica e a mesma do vigia privado, com textos neutros porque aqui e
 * publico.
 *
 * Tres alarmes independentes, cada um com a sua issue:
 *   pulso-morto      a maquina nao da sinal (ou o pulso esta ilegivel ou sem data)   -> critico
 *   frota-parada     o pulso chega, mas as rotinas pararam                          -> critico
 *   observador-cego  o pulso chega, mas um vigia da maquina esta com problema       -> atencao
 * Com a maquina muda, frota e vigias ficam DESCONHECIDOS: nem abre nem fecha nada sobre eles.
 * Campo ausente ou torto e DESCONHECIDO: fechar alarme exige prova de saude, nao falta de dado.
 */
const TETO_H = 4;

const ALARMES = {
  'pulso-morto': 'A máquina parou de dar sinal de vida',
  'frota-parada': 'A máquina está ligada, mas as rotinas pararam',
  'observador-cego': 'Um vigia da máquina está com problema',
};

const ativo = (rotulo, motivo) => ({ rotulo, titulo: ALARMES[rotulo], estado: 'ativo', motivo });
const inativo = (rotulo) => ({ rotulo, titulo: ALARMES[rotulo], estado: 'inativo', motivo: null });
const desconhecido = (rotulo) => ({ rotulo, titulo: ALARMES[rotulo], estado: 'desconhecido', motivo: null });

/** @param textoDoPulso conteudo do pulso-publico.json, ou null se o arquivo nao existe */
function decidir(textoDoPulso, agoraMs) {
  const morta = (motivo) => [ativo('pulso-morto', motivo), desconhecido('frota-parada'), desconhecido('observador-cego')];
  if (textoDoPulso === null || textoDoPulso === undefined) return morta('o arquivo de pulso nao existe no repositorio');
  let p;
  try { p = JSON.parse(textoDoPulso); } catch (e) { return morta('o arquivo de pulso esta ilegivel: ' + e.message); }
  if (!p || typeof p !== 'object') return morta('o arquivo de pulso nao e um objeto');
  const quando = Date.parse(p.gerado_em_utc);
  if (!Number.isFinite(quando)) return morta('o pulso nao tem data valida');
  const horas = (agoraMs - quando) / 3_600_000;
  if (horas > TETO_H) return morta(`a maquina nao da sinal de vida ha ${horas.toFixed(1)}h (limite ${TETO_H}h). Ultimo pulso: ${p.gerado_em_utc}`);

  const idade = `pulso de ${Math.max(0, horas).toFixed(1)}h atras`;
  let frota;
  if (!p.frota || typeof p.frota !== 'object' || typeof p.frota.parada !== 'boolean') frota = desconhecido('frota-parada');
  else if (p.frota.parada) {
    const motivos = Array.isArray(p.frota.motivos) && p.frota.motivos.length ? p.frota.motivos.join(' | ') : 'sem motivo informado';
    frota = ativo('frota-parada', `${motivos} (${idade})`);
  } else frota = inativo('frota-parada');

  const cego = typeof p.observador_saudavel !== 'boolean' ? desconhecido('observador-cego')
    : p.observador_saudavel === false
      ? ativo('observador-cego', (Array.isArray(p.problemas_do_observador) && p.problemas_do_observador.length ? p.problemas_do_observador.join(' | ') : 'sem detalhe') + ` (${idade})`)
      : inativo('observador-cego');
  return [inativo('pulso-morto'), frota, cego];
}

/** Comentar de novo so quando o problema MUDOU (sem contar a idade do pulso). Comparacao por igualdade. */
function mudou(motivoNovo, ultimoComentario) {
  if (!ultimoComentario) return true;
  const motivoDe = (t) => String(t || '').split(/\r?\n/)[0].replace(/^\s*(\*\*Motivo:\*\*|Mudou:)\s*/, '');
  const normal = (s) => String(s || '').replace(/\(pulso de [\d.]+h atras\)/g, '').replace(/\bha [\d.]+h\b/g, 'ha Nh').replace(/\s+/g, ' ').trim();
  return normal(motivoDe(ultimoComentario)) !== normal(motivoNovo);
}

/**
 * O grito por e-mail: o e-mail de issue nao chega ao dono, o de "Run failed" chega. Com alarme CRITICO ativo a
 * conferencia FALHA de proposito, com o motivo numa anotacao que vai no corpo do e-mail. Vigia com problema
 * (atencao) nao grita: so a issue. `ensaio` forca o grito com texto de teste.
 */
const CRITICOS = new Set(['pulso-morto', 'frota-parada']);
function grito(alarmes, ensaio = false) {
  const limpar = (s) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/::/g, ': :').slice(0, 900);
  if (ensaio) {
    return { falhar: true, linhas: ['::error title=ENSAIO do alarme da maquina::Este e-mail e um TESTE. Se ele chegou, o alarme de maquina parada tambem chega. Nada esta quebrado.'] };
  }
  const ativos = (Array.isArray(alarmes) ? alarmes : []).filter((a) => a && a.estado === 'ativo' && CRITICOS.has(a.rotulo));
  return { falhar: ativos.length > 0, linhas: ativos.map((a) => `::error title=${limpar(a.titulo)}::${limpar(a.motivo)}`) };
}

module.exports = { decidir, mudou, grito, ALARMES, TETO_H };

if (require.main === module && process.argv.includes('--gritar')) {
  let alarmes = [];
  try { alarmes = JSON.parse(process.env.ALARMES || '[]'); } catch { alarmes = null; }
  // Decisao ilegivel tambem grita: o vigia mudo e exatamente o que este arquivo existe para impedir.
  const g = alarmes === null || (Array.isArray(alarmes) && !alarmes.length && process.env.ENSAIO !== 'true')
    ? { falhar: true, linhas: ['::error title=O vigia de fora nao conseguiu decidir::A conferencia de pulso nao produziu alarmes legiveis.'] }
    : grito(alarmes, process.env.ENSAIO === 'true');
  for (const l of g.linhas) console.log(l);
  process.exitCode = g.falhar ? 1 : 0;
} else if (require.main === module) {
  const fs = require('fs');
  const CAMINHO = process.env.PULSO_ARQUIVO || 'pulso-publico.json';
  const texto = fs.existsSync(CAMINHO) ? fs.readFileSync(CAMINHO, 'utf8') : null;
  const alarmes = decidir(texto, Date.now());
  for (const a of alarmes) console.log(`${a.rotulo}: ${a.estado}${a.motivo ? ' - ' + a.motivo : ''}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `alarmes=${JSON.stringify(alarmes)}\n`);
}
