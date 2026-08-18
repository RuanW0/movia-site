# Planilha de leads — setup e manutenção

Atualizado em 2026-08-18, para o script **v4** (`lp/planilha-leads-completa.gs`).

Todo envio do formulário vira uma linha na planilha, na hora. Sem custo, sem servidor.

> O código do webhook mora em `lp/planilha-leads-completa.gs`. Este documento
> não repete o script — copie sempre do arquivo, nunca de uma cópia colada aqui.
> (Esta página já ficou meses mostrando a v1 enquanto a produção rodava a v3.)

## O que a v4 faz

| Situação | Resposta | Grava? |
|---|---|---|
| Lead válido | `{"status":"ok"}` | sim |
| Mesmo telefone ou email nos últimos 30 dias | `{"status":"duplicate"}` | não |
| JSON malformado, campo inválido **ou token errado/ausente** | `{"status":"invalid"}` | não |
| Honeypot preenchido (bot) | `{"status":"ok"}` | **não** |

O honeypot responde `ok` de propósito: devolver erro só ensinaria o bot a
descobrir qual campo é a isca.

## Setup inicial (planilha nova)

1. Crie uma planilha no Google Sheets (sugestão: **Leads Funil Movia**).
2. **Extensões → Apps Script**. Apague o conteúdo e cole
   `lp/planilha-leads-completa.gs` inteiro. Salve (Cmd+S).
3. **Configure o token** (passo 3 do bloco abaixo — obrigatório, senão nada grava).
4. **Implantar → Nova implantação → tipo: App da web**
   - **Executar como:** Eu
   - **Quem pode acessar:** Qualquer pessoa
5. Autorize quando pedir e copie a URL gerada (termina em `/exec`).
6. Coloque essa URL em `WEBHOOK_URL` (`lp/index.html`, bloco `lead-form`) e redeploy da LP.
7. No editor do Apps Script, escolha a função `configurarPlanilha` e Executar
   (só na primeira vez; é seguro rodar de novo, não apaga leads).

## Token compartilhado — passos manuais no Apps Script

O `doPost` recusa qualquer envio cujo campo `token` não bata com a propriedade
`LEAD_TOKEN` do script. **Não existe fallback**: sem a propriedade, todos os
envios viram `invalid` e nenhum lead é gravado. É proposital — um controle que
se desliga sozinho quando alguém esquece de configurar não protege nada.

1. Pegue o valor de `FORM_TOKEN` em `lp/index.html` (bloco `lead-form`, perto
   do `WEBHOOK_URL`). Hoje: `mv_4a44f20e6050b4e500f8b748`.
2. No editor do Apps Script: **⚙️ Configurações do projeto → Propriedades do
   script → Adicionar propriedade do script**.
   - Propriedade: `LEAD_TOKEN`
   - Valor: exatamente o mesmo `FORM_TOKEN`, sem espaço antes ou depois.
   - **Salvar propriedades do script**.
3. **Implantar → Gerenciar implantações → ✏️ editar → Versão: "Nova versão" →
   Implantar.** A URL `/exec` continua a mesma. Sem esse passo o webhook segue
   rodando a versão antiga do código.
4. **Teste de fumaça**, na LP em produção: preencha o formulário com dados
   reais e envie.
   - Foi pro `/obrigado` e a linha apareceu na planilha → token OK.
   - Apareceu "Confira os campos preenchidos e tente de novo" → o `LEAD_TOKEN`
     não bate com o `FORM_TOKEN`, ou a implantação não foi republicada.

### Trocar o token

Token queimado (spam voltou, alguém copiou o payload) — a troca é atômica na
prática, mas tem uma janela de segundos em que os dois lados divergem:

1. Gere um valor novo: `node -e "console.log('mv_' + require('crypto').randomBytes(12).toString('hex'))"`
2. Atualize `LEAD_TOKEN` no Apps Script (a propriedade vale na hora, sem
   republicar — só o **código** exige nova versão).
3. Atualize `FORM_TOKEN` em `lp/index.html`, commit e redeploy da LP.

Entre 2 e 3 os envios reais são recusados com `invalid`. Faça fora do horário
comercial ou inverta a ordem se preferir uma janela sem proteção em vez de uma
janela sem leads.

### Honestidade sobre o que o token protege

O `FORM_TOKEN` está no HTML público de uma página indexável. **Isso não é
autenticação.** Quem abrir o fonte da página lê o valor e continua conseguindo
POSTar. O que o token corta é o volume barato: bot genérico que dispara POST no
`/exec` sem ler a página, e quem copia a URL do devtools sem copiar o corpo da
requisição. Contra um atacante determinado ele não faz nada — pra isso seria
preciso um servidor próprio assinando a requisição, que é outro projeto.

## Rate limit — por que não tem

Avaliado e descartado. O objeto `e` do `doPost` não expõe IP nem nada que
identifique o cliente, então a única chave possível com `CacheService` ou
`PropertiesService` é global (o script inteiro). Um teto global vira arma do
atacante: ele estoura a cota de propósito e os leads reais passam a ser
recusados junto — troca planilha poluída por formulário morto, que é pior. O
que já limita repetição é o dedup por telefone/email em 30 dias. Rate limit de
verdade só com servidor próprio na frente.

## Preview local da LP

**Use o container.** É o único jeito de reproduzir o funil localmente — medido,
não suposto.

```bash
docker build -t lp-preview lp/
docker run --rm -p 8080:8080 lp-preview
```

O `lp/index.html` redireciona com `window.location.href = '/obrigado'` — caminho
root-absoluto, correto em produção, onde a LP fica na raiz do domínio
(`form.moviaautomacoes.com.br`).

Duas armadilhas com `python3 -m http.server`, ambas verificadas:

| Como você serve | `/lp/` | `/obrigado` | Por quê |
|---|---|---|---|
| repo inteiro pela raiz | 200 | **404** | a LP vive em `/lp/`, e o redirect aponta pra `/obrigado` na raiz |
| de dentro de `lp/` | — | **404** | `http.server` não faz `try_files`, então só `/obrigado.html` resolve |
| container (Caddy) | — | **200** | o `try_files {path} {path}.html` do Caddyfile resolve a rota sem extensão |

Ou seja: servir de dentro de `lp/` conserta o prefixo mas **não** basta — a rota
sem extensão só existe porque o Caddyfile a cria. Testar o funil fora do
container leva a um 404 que não existe em produção.

Vindo da #13 (item 3). Documentado em vez de virar mudança de código: trocar o
redirect por caminho relativo quebraria produção pra consertar só o preview.

## Manutenção

- Mudou o **código** do `.gs`? → **Implantar → Gerenciar implantações → editar
  → Nova versão**. A URL continua a mesma.
- Mudou só uma **propriedade do script** (`LEAD_TOKEN`)? → vale na hora, sem
  republicar.
- Migrar pro CRM da Movia depois = trocar `WEBHOOK_URL` na página (e levar
  token + honeypot pro endpoint novo).
