# Planilha de leads — setup (5 min)

Todo envio do formulário vira uma linha na planilha, na hora. Sem custo, sem servidor.

## Passo a passo (ação sua, no navegador)

1. Crie uma planilha nova no Google Sheets (sugestão de nome: **Leads Funil Movia**).
2. Menu **Extensões → Apps Script**. Apague o conteúdo e cole o script abaixo.
3. Clique em **Implantar → Nova implantação → tipo: App da web**.
   - **Executar como:** Eu
   - **Quem pode acessar:** Qualquer pessoa
4. Autorize quando pedir e **copie a URL** gerada (termina em `/exec`).
5. Me manda essa URL — eu preencho o `WEBHOOK_URL` da página e redeployo. Pronto.

## Script (colar no Apps Script)

```javascript
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
```

## Notas

- Se editar o script depois, precisa **Implantar → Gerenciar implantações → editar → Nova versão** (a URL continua a mesma).
- Migrar pro CRM da Movia depois = trocar 1 linha na página (`WEBHOOK_URL`).
