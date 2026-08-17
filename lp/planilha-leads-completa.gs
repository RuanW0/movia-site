/**
 * Planilha de Leads Movia — versão completa (v2)
 * ------------------------------------------------
 * COMO USAR (uma vez só):
 * 1. Planilha -> Extensões -> Apps Script
 * 2. Apagar TODO o código e colar este arquivo inteiro (o doPost do webhook
 *    está incluído, idêntico ao que já roda — NÃO precisa reimplantar nada).
 * 3. Salvar (Cmd+S).
 * 4. No menu suspenso de funções (barra de cima), escolher "configurarPlanilha"
 *    e clicar em Executar. Autorizar com sua conta quando pedir.
 * Pronto: abas Leads/Config/Dashboard estruturadas, gráficos criados.
 *
 * Pode rodar configurarPlanilha de novo quando quiser: é seguro, não apaga leads.
 */

// ===== 1. WEBHOOK (não mexer — é o que recebe os leads da landing) =====
function doPost(e) {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var aba = planilha.getSheetByName('Leads') || planilha.insertSheet('Leads');
  var d = JSON.parse(e.postData.contents);
  if (aba.getLastRow() === 0) {
    aba.appendRow(['Data', 'Nome', 'Telefone', 'Email', 'Empresa', 'Segmento', 'Faturamento', 'Trafego/mes', 'Pagina']);
  }
  aba.appendRow([
    new Date(), d.nome || '', d.telefone || '', d.email || '', d.empresa || '',
    d.segmento || '', d.faturamento || '', d.trafego || '', d.pagina || ''
  ]);
  return ContentService.createTextOutput('ok');
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
