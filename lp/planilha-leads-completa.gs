/**
 * Planilha de Leads Movia — versão completa (v4)
 * ------------------------------------------------
 * COMO USAR:
 * 1. Planilha -> Extensões -> Apps Script
 * 2. Apagar TODO o código e colar este arquivo inteiro.
 * 3. Salvar (Cmd+S).
 * 4. ⚠️ Propriedade obrigatória (uma vez, ANTES de reimplantar):
 *    Configurações do projeto -> Propriedades do script -> Adicionar
 *    Propriedade: LEAD_TOKEN   Valor: o mesmo FORM_TOKEN de lp/index.html
 *    Sem essa propriedade o webhook recusa TODOS os envios (ver
 *    tokenValido_ abaixo — falha fechada, de propósito).
 * 5. ⚠️ REIMPLANTAR (obrigatório sempre que o código muda):
 *    Implantar -> Gerenciar implantações -> ✏️ editar -> Versão: "Nova versão"
 *    -> Implantar. A URL /exec continua a mesma; sem esse passo o webhook
 *    continua rodando a versão antiga.
 * 6. No menu suspenso de funções, escolher "configurarPlanilha" e Executar
 *    (só na primeira vez; é seguro rodar de novo, não apaga leads).
 *
 * v3: valida o payload, normaliza telefone/email e bloqueia duplicata
 * (mesmo telefone OU email nos últimos 30 dias). Responde JSON:
 * {"status":"ok"} | {"status":"duplicate"} | {"status":"invalid"}
 * v4: token compartilhado + honeypot. Mesmos três status — o cliente não
 * ganhou branch nova.
 */

// ===== 1. WEBHOOK (recebe os leads da landing) =====
var DEDUP_JANELA_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// Campo isca do formulario. Fica escondido no HTML; humano nao ve, nao tabula
// ate ele e leitor de tela ignora. Bot que preenche tudo que tem name cai.
var HONEYPOT_CAMPO = 'website';

// O token NAO e autenticacao. Ele viaja no HTML publico da landing, entao
// qualquer um que abrir o fonte le o valor. O que ele corta e o custo baixo:
// bot generico que faz POST no /exec sem ler a pagina, e script kiddie que
// copia a URL do devtools sem copiar o payload. Atacante determinado passa —
// pra barrar de verdade seria preciso servidor proprio assinando a requisicao,
// que e outro projeto. Vale pelo que custa: uma linha no cliente, uma
// propriedade no Apps Script.
//
// Falha fechada: sem a propriedade LEAD_TOKEN configurada nada e gravado.
// Um controle de seguranca que se desliga sozinho quando alguem esquece de
// configurar nao e controle nenhum — e essa falha aparece no primeiro teste
// de envio (o form mostra "confira os campos"), enquanto falha aberta ficaria
// invisivel pra sempre.
function tokenValido_(recebido) {
  var esperado = PropertiesService.getScriptProperties().getProperty('LEAD_TOKEN');
  if (!esperado) return false;
  return String(recebido == null ? '' : recebido) === esperado;
}

// Honeypot preenchido = bot. Qualquer conteudo nao vazio conta.
function honeypotPreenchido_(d) {
  return corta_(d[HONEYPOT_CAMPO], 200).trim().length > 0;
}

// SEM rate limit por janela, de proposito. O objeto `e` do doPost nao traz IP
// nem nada que identifique o cliente, entao a unica chave possivel com
// CacheService/PropertiesService e global (o script inteiro). Um teto global
// vira arma do atacante: ele estoura a cota de proposito e os leads reais
// passam a ser recusados junto — troca uma planilha poluida por um formulario
// morto, que e pior. O que ja limita repeticao aqui e o dedup por
// telefone/email em 30 dias (duplicado_). Rate limit de verdade so com
// servidor proprio na frente, que e outro projeto.
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var d;
    try { d = JSON.parse(e.postData.contents); } catch (err) { return resposta_('invalid'); }

    // Token antes de qualquer leitura ou escrita na planilha.
    if (!tokenValido_(d.token)) return resposta_('invalid');

    // Honeypot: responde 'ok' e nao grava. O bot precisa acreditar que
    // funcionou; devolver erro so ensinaria ele a achar o campo isca.
    if (honeypotPreenchido_(d)) return resposta_('ok');

    var nome = corta_(d.nome, 80).trim();
    var empresa = corta_(d.empresa, 80).trim();
    var email = corta_(d.email, 120).trim().toLowerCase();
    var fone = fone_(d.telefone);

    if (nome.length < 2 || empresa.length < 2) return resposta_('invalid');
    if (fone.length < 10 || fone.length > 11) return resposta_('invalid');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resposta_('invalid');

    var planilha = SpreadsheetApp.getActiveSpreadsheet();
    var aba = planilha.getSheetByName('Leads') || planilha.insertSheet('Leads');
    if (aba.getLastRow() === 0) {
      aba.appendRow(['Data', 'Nome', 'Telefone', 'Email', 'Empresa', 'Segmento', 'Faturamento', 'Trafego/mes', 'Pagina']);
    }
    if (duplicado_(aba, fone, email)) return resposta_('duplicate');

    aba.appendRow([
      new Date(), nome, corta_(d.telefone, 20), email, empresa,
      corta_(d.segmento, 100), corta_(d.faturamento, 100),
      corta_(d.trafego, 100), corta_(d.pagina, 300)
    ]);
    return resposta_('ok');
  } finally {
    lock.releaseLock();
  }
}

// Corta qualquer valor para no máximo `max` caracteres (nunca lança).
function corta_(v, max) { return String(v == null ? '' : v).slice(0, max); }

// Telefone só em dígitos. "+55 11 99999-0000" chega com 13: os dois primeiros
// são DDI, não DDD. Só descarta acima de 11 — DDD 55 (RS) cabe em 10-11.
// Mesma regra do cliente; é o que faz o dedup casar com linhas antigas.
function fone_(v) {
  var d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length > 11 && d.indexOf('55') === 0) d = d.slice(2);
  return d;
}

function resposta_(status) {
  return ContentService.createTextOutput(JSON.stringify({ status: status }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Duplicata = mesmo telefone (só dígitos) OU mesmo email (lowercase)
// em linha com Data dentro da janela de 30 dias.
function duplicado_(aba, fone, email) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return false;
  var linhas = aba.getRange(2, 1, ultima - 1, 4).getValues(); // Data, Nome, Telefone, Email
  var limite = Date.now() - DEDUP_JANELA_MS;
  for (var i = linhas.length - 1; i >= 0; i--) {
    var data = linhas[i][0];
    if (!(data instanceof Date) || data.getTime() < limite) continue;
    var foneLinha = fone_(linhas[i][2]);
    var emailLinha = String(linhas[i][3] || '').trim().toLowerCase();
    if ((fone && foneLinha === fone) || (email && emailLinha === email)) return true;
  }
  return false;
}

// ===== 2. SETUP (rodar uma vez no editor) =====
function configurarPlanilha() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Config ---
  var config = ss.getSheetByName('Config') || ss.insertSheet('Config');
  config.getRange('A1:D1').setValues([['Status', 'Vendedores', '', 'SLA alvo (min)']]).setFontWeight('bold');
  config.getRange('A2:A8').setValues([['Novo'], ['Chamado'], ['Em conversa'], ['Demo marcada'], ['Proposta'], ['Fechado'], ['Perdido']]);
  if (!config.getRange('B2').getValue()) {
    config.getRange('B2:B3').setValues([['Igor'], ['Ruan']]); // editar à vontade
  }
  if (!config.getRange('D2').getValue()) config.getRange('D2').setValue(30);

  // --- Leads ---
  var aba = ss.getSheetByName('Leads') || ss.insertSheet('Leads');
  var cab = ['Data', 'Nome', 'Telefone', 'Email', 'Empresa', 'Segmento', 'Faturamento',
             'Trafego/mes', 'Pagina', 'Status', 'Data 1º contato', 'Tempo resposta (min)', 'Vendedor', 'Obs'];
  aba.getRange(1, 1, 1, cab.length).setValues([cab])
     .setFontWeight('bold').setBackground('#002B86').setFontColor('#FFFFFF');
  aba.setFrozenRows(1);
  aba.getRange('A2:A2000').setNumberFormat('dd/mm/yyyy hh:mm');
  aba.getRange('K2:K2000').setNumberFormat('dd/mm/yyyy hh:mm');
  aba.getRange('L2:L2000').setNumberFormat('0');
  aba.setColumnWidth(14, 320); // Obs mais larga

  // Dropdowns
  var vStatus = SpreadsheetApp.newDataValidation()
    .requireValueInRange(config.getRange('A2:A8'), true).setAllowInvalid(false).build();
  aba.getRange('J2:J2000').setDataValidation(vStatus);
  var vVend = SpreadsheetApp.newDataValidation()
    .requireValueInRange(config.getRange('B2:B15'), true).setAllowInvalid(true).build();
  aba.getRange('M2:M2000').setDataValidation(vVend);

  // Formatação condicional: lead esperando = laranja; fechado = verde; perdido = cinza
  var faixa = [aba.getRange('A2:N2000')];
  var regras = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A2<>"",OR($J2="",$J2="Novo"))')
      .setBackground('#FDE7D7').setRanges(faixa).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$J2="Fechado"')
      .setBackground('#D9EAD3').setRanges(faixa).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$J2="Perdido"')
      .setBackground('#EFEFEF').setFontColor('#999999').setRanges(faixa).build()
  ];
  aba.setConditionalFormatRules(regras);

  // Leads antigos sem status viram "Novo"
  marcarLeadsNovos_();

  // Trigger: quando o webhook adiciona linha, marca "Novo" automaticamente
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'aoMudarPlanilha') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('aoMudarPlanilha').forSpreadsheet(ss).onChange().create();

  // --- Dashboard ---
  montarDashboard_(ss);
  SpreadsheetApp.getUi().alert('Planilha configurada. Dashboard pronto na aba "Dashboard".');
}

// ===== 3. AUTOMAÇÕES =====

// Vendedor muda o Status -> carimba Data 1º contato e calcula o tempo (1ª mudança apenas)
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== 'Leads') return;
  var linha = e.range.getRow(), col = e.range.getColumn();
  if (col !== 10 || linha < 2) return;
  var status = e.value;
  if (!status || status === 'Novo') return;
  var celContato = sh.getRange(linha, 11);
  if (celContato.getValue()) return; // já carimbado — não sobrescreve
  var agora = new Date();
  celContato.setValue(agora);
  var entrada = sh.getRange(linha, 1).getValue();
  if (entrada instanceof Date) {
    sh.getRange(linha, 12).setValue(Math.round((agora - entrada) / 60000));
  }
}

// Linha nova do webhook -> Status "Novo"
function aoMudarPlanilha(e) { marcarLeadsNovos_(); }

function marcarLeadsNovos_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads');
  if (!aba) return;
  var ultima = aba.getLastRow();
  if (ultima < 2) return;
  var dados = aba.getRange(2, 1, ultima - 1, 10).getValues();
  for (var i = 0; i < dados.length; i++) {
    if (dados[i][0] && !dados[i][9]) aba.getRange(i + 2, 10).setValue('Novo');
  }
}

// ===== 4. DASHBOARD =====
function montarDashboard_(ss) {
  var d = ss.getSheetByName('Dashboard') || ss.insertSheet('Dashboard');
  d.getCharts().forEach(function (c) { d.removeChart(c); });
  d.clear();

  // Métricas gerais
  d.getRange('A1').setValue('MÉTRICAS').setFontWeight('bold');
  d.getRange('A2:B9').setValues([
    ['Total de leads', '=COUNTA(Leads!$A$2:$A)'],
    ['Aguardando 1º contato', '=COUNTIFS(Leads!$A$2:$A,"<>",Leads!$K$2:$K,"")'],
    ['Tempo médio de resposta (min)', '=IFERROR(ROUND(AVERAGE(Leads!$L$2:$L),0),"-")'],
    ['Tempo mediano (min)', '=IFERROR(ROUND(MEDIAN(Leads!$L$2:$L),0),"-")'],
    ['% dentro do SLA', '=IFERROR(ROUND(COUNTIFS(Leads!$L$2:$L,"<="&Config!$D$2)/COUNT(Leads!$L$2:$L)*100,0)&"%","-")'],
    ['Demos marcadas', '=COUNTIF(Leads!$J$2:$J,"Demo marcada")'],
    ['Fechados', '=COUNTIF(Leads!$J$2:$J,"Fechado")'],
    ['Perdidos', '=COUNTIF(Leads!$J$2:$J,"Perdido")']
  ]);
  d.getRange('A2:A9').setFontWeight('bold');

  // Funil por status
  d.getRange('D1').setValue('FUNIL').setFontWeight('bold');
  var statusList = ['Novo', 'Chamado', 'Em conversa', 'Demo marcada', 'Proposta', 'Fechado', 'Perdido'];
  d.getRange('D2:D8').setValues(statusList.map(function (s) { return [s]; }));
  d.getRange('E2:E8').setFormulas(statusList.map(function (s, i) {
    return ['=COUNTIF(Leads!$J$2:$J,$D$' + (i + 2) + ')'];
  }));

  // Distribuição por faixa de tempo
  d.getRange('G1').setValue('TEMPO DE RESPOSTA').setFontWeight('bold');
  d.getRange('G2:H6').setValues([
    ['Até 15 min', ''], ['16 a 60 min', ''], ['1 a 4 h', ''], ['4 a 24 h', ''], ['Mais de 24 h', '']
  ]);
  d.getRange('H2:H6').setFormulas([
    ['=COUNTIFS(Leads!$L$2:$L,"<=15")'],
    ['=COUNTIFS(Leads!$L$2:$L,">15",Leads!$L$2:$L,"<=60")'],
    ['=COUNTIFS(Leads!$L$2:$L,">60",Leads!$L$2:$L,"<=240")'],
    ['=COUNTIFS(Leads!$L$2:$L,">240",Leads!$L$2:$L,"<=1440")'],
    ['=COUNTIFS(Leads!$L$2:$L,">1440")']
  ]);

  // Últimos 14 dias: volume + tempo médio
  d.getRange('J1:L1').setValues([['Dia', 'Leads', 'Tempo médio (min)']]).setFontWeight('bold');
  var fDia = [], fCont = [], fMed = [];
  for (var i = 0; i < 14; i++) {
    var linha = i + 2;
    fDia.push(['=TODAY()-' + (13 - i)]);
    fCont.push(['=COUNTIFS(Leads!$A$2:$A,">="&$J' + linha + ',Leads!$A$2:$A,"<"&$J' + linha + '+1)']);
    fMed.push(['=IFERROR(ROUND(AVERAGEIFS(Leads!$L$2:$L,Leads!$A$2:$A,">="&$J' + linha + ',Leads!$A$2:$A,"<"&$J' + linha + '+1),0),)']);
  }
  d.getRange('J2:J15').setFormulas(fDia).setNumberFormat('dd/mm');
  d.getRange('K2:K15').setFormulas(fCont);
  d.getRange('L2:L15').setFormulas(fMed);

  // Gráficos
  d.insertChart(d.newChart().setChartType(Charts.ChartType.LINE)
    .addRange(d.getRange('J1:J15')).addRange(d.getRange('L1:L15'))
    .setPosition(17, 1, 0, 0).setOption('title', 'Tempo médio de resposta por dia (min)')
    .setOption('width', 460).setOption('height', 300).build());
  d.insertChart(d.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(d.getRange('G1:H6'))
    .setPosition(17, 7, 0, 0).setOption('title', 'Leads por faixa de tempo de resposta')
    .setOption('width', 460).setOption('height', 300).build());
  d.insertChart(d.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(d.getRange('D1:E8'))
    .setPosition(33, 1, 0, 0).setOption('title', 'Funil por status')
    .setOption('width', 460).setOption('height', 300).build());
  d.insertChart(d.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(d.getRange('J1:K15'))
    .setPosition(33, 7, 0, 0).setOption('title', 'Leads por dia (14 dias)')
    .setOption('width', 460).setOption('height', 300).build());
}
