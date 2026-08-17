# LP Form Validation + Lead Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `/subagent-driven-development` (recommended for parallelizable tasks) or `/executing-plans` (sequential with checkpoints) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the funnel LP lead form (real phone/email validation, all fields bounded) and make the Apps Script webhook reject duplicates within 30 days, with the form reading the webhook response instead of blind-redirecting.

**Architecture:** Three surfaces, one contract. The Apps Script `doPost` becomes the single source of truth (validate → normalize → dedup under `LockService` → JSON `{status}`); the LP form gains field hardening (mask, `type=tel`, autocomplete, labels — issue #10) and a submit flow that awaits the webhook response with retry ×2 on network failure (issue #7). CORS works because Apps Script already sends `Access-Control-Allow-Origin: *` and `text/plain` avoids preflight.

**Tech Stack:** Static HTML/vanilla JS (`lp/index.html`, no build step), Google Apps Script (`lp/planilha-leads-completa.gs`), served by Caddy on Railway. No JS test harness exists in `lp/` — Verify uses `node --check` syntax gates, grep assertions, and a local-serve browser smoke (same approach PR #12 used).

**Spec:** `docs/superpowers/specs/2026-08-17-lp-form-validation-dedup-design.md`

**Workflow mode:** `pr` (repo convention — PRs #6/#12/#14; branch `feat/lp-form-validation-dedup` already exists from the spec commit).

---

### Task 1: Apps Script `doPost` v3 — validate, dedup, JSON response

**Files:**
- Modify: `lp/planilha-leads-completa.gs` (header comment lines 1-15; `doPost` lines 17-30)
- Modify: `lp/planilha-setup.md` (no content change needed — line 35 is already correct; re-read it to confirm it stays the canonical redeploy instruction)

#### Test (Red)

- [ ] **Step 1: Confirm the defects exist before changing anything**

```bash
grep -n "NÃO precisa reimplantar" lp/planilha-leads-completa.gs
grep -c "duplicate\|LockService" lp/planilha-leads-completa.gs
```

Expected: first grep matches line ~6 (the wrong doc); second prints `0` (no dedup, no lock).

#### Implement (Green)

- [ ] **Step 2: Replace the header comment block (lines 1-15)**

New header (replaces the whole `/** ... */` block):

```js
/**
 * Planilha de Leads Movia — versão completa (v3)
 * ------------------------------------------------
 * COMO USAR:
 * 1. Planilha -> Extensões -> Apps Script
 * 2. Apagar TODO o código e colar este arquivo inteiro.
 * 3. Salvar (Cmd+S).
 * 4. ⚠️ REIMPLANTAR (obrigatório sempre que o código muda):
 *    Implantar -> Gerenciar implantações -> ✏️ editar -> Versão: "Nova versão"
 *    -> Implantar. A URL /exec continua a mesma; sem esse passo o webhook
 *    continua rodando a versão antiga.
 * 5. No menu suspenso de funções, escolher "configurarPlanilha" e Executar
 *    (só na primeira vez; é seguro rodar de novo, não apaga leads).
 *
 * v3: valida o payload, normaliza telefone/email e bloqueia duplicata
 * (mesmo telefone OU email nos últimos 30 dias). Responde JSON:
 * {"status":"ok"} | {"status":"duplicate"} | {"status":"invalid"}
 */
```

- [ ] **Step 3: Replace `doPost` (currently lines 17-30) with v3 + helpers**

```js
// ===== 1. WEBHOOK (recebe os leads da landing) =====
var DEDUP_JANELA_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var d;
    try { d = JSON.parse(e.postData.contents); } catch (err) { return resposta_('invalid'); }

    var nome = corta_(d.nome, 80).trim();
    var empresa = corta_(d.empresa, 80).trim();
    var email = corta_(d.email, 120).trim().toLowerCase();
    var fone = String(d.telefone == null ? '' : d.telefone).replace(/\D/g, '');

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
    var foneLinha = String(linhas[i][2] || '').replace(/\D/g, '');
    var emailLinha = String(linhas[i][3] || '').trim().toLowerCase();
    if ((fone && foneLinha === fone) || (email && emailLinha === email)) return true;
  }
  return false;
}
```

Notes for the implementer:
- The stored `Telefone` cell keeps the visitor's formatting (`corta_(d.telefone, 20)`); normalization is compare-only, so dedup still matches rows written by the v2 script.
- Everything below `// ===== 2. SETUP` (`configurarPlanilha`, `marcarLeadsNovos_`, etc.) stays untouched.

#### Verify

- [ ] **Step 4: Syntax gate + doc-fix greps**

```bash
cp lp/planilha-leads-completa.gs /tmp/gs-syntax-check.js && node --check /tmp/gs-syntax-check.js && echo GS-SYNTAX-OK
grep -c "NÃO precisa reimplantar" lp/planilha-leads-completa.gs || true
grep -c "LockService\|duplicado_\|resposta_" lp/planilha-leads-completa.gs
sed -n '35p' lp/planilha-setup.md
```

Expected: `GS-SYNTAX-OK`; first grep prints `0`; second prints ≥ 6; the setup.md line still reads "Se editar o script depois, precisa **Implantar → Gerenciar implantações → editar → Nova versão**".

#### Commit

- [ ] **Step 5: Stage the exact paths and commit with the verbatim trailer**

```bash
MSG_FILE=/tmp/msg-gs-v3-$(date +%s).txt
cat > $MSG_FILE <<'EOF'
feat(lp): doPost v3 — valida payload, dedup 30d e resposta JSON

Server-side validation (nome/empresa 2-80, fone 10-11 digitos, email
regex, teto de tamanho em tudo), dedup por telefone OU email nos ultimos
30 dias sob LockService, e resposta JSON {status} legivel pelo form.
Corrige o header que mandava NAO reimplantar (reimplantar e obrigatorio).

Refs #7
EOF
git add lp/planilha-leads-completa.gs
git commit -F $MSG_FILE --trailer "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
rm -f $MSG_FILE
```

---

### Task 2: Form markup hardening (labels, tel, autocomplete, limits)

**Files:**
- Modify: `lp/index.html` — form fields (lines 834-886), CSS block (insert after `.form-card .btn` rule, line ~124)

#### Test (Red)

- [ ] **Step 1: Confirm the gaps exist**

```bash
grep -c 'autocomplete=' lp/index.html || true
grep -c 'type="tel"' lp/index.html || true
grep -c 'id="formMsg"' lp/index.html || true
```

Expected: all three print `0`.

#### Implement (Green)

- [ ] **Step 2: Replace the four text fields (lines 836-847)**

Current markup → new markup (labels visible, matching the style the three selects already use):

```html
            <div class="field">
              <label for="leadNome">Seu nome</label>
<input required id="leadNome" name="nome" autocomplete="name" maxlength="80" minlength="2" placeholder="Seu nome">
            </div>
            <div class="field">
              <label for="leadTelefone">WhatsApp com DDD</label>
<input required id="leadTelefone" type="tel" inputmode="numeric" name="telefone" autocomplete="tel-national" maxlength="16" placeholder="(00) 00000-0000">
            </div>
            <div class="field">
              <label for="leadEmail">Email</label>
<input required id="leadEmail" type="email" name="email" autocomplete="email" maxlength="120" placeholder="seu@email.com">
            </div>
            <div class="field">
              <label for="leadEmpresa">Empresa</label>
<input required id="leadEmpresa" name="empresa" autocomplete="organization" maxlength="80" minlength="2" placeholder="Nome da empresa">
            </div>
```

- [ ] **Step 3: Add the status-message element after the submit button (line ~885)**

```html
          <button class="btn" type="submit">Receber mais informações</button>
          <div id="formMsg" class="form-msg" role="status" hidden></div>
</form>
```

- [ ] **Step 4: Add the `.form-msg` styles right after the `.form-card .btn` rule (line ~124)**

```css
.form-msg{margin-top:12px;padding:12px 14px;border-radius:8px;font-size:14px;font-weight:600;background:#D9EAD3;color:#1E4620}
.form-msg--erro{background:#FDE7D7;color:#8A2E00}
```

#### Verify

- [ ] **Step 5: Grep assertions + local render check**

```bash
grep -c 'autocomplete=' lp/index.html          # expected: 4
grep -c 'type="tel"' lp/index.html             # expected: 1
grep -c 'id="formMsg"' lp/index.html           # expected: 1
grep -c 'form-msg--erro' lp/index.html         # expected: ≥1 (CSS rule)
python3 -m http.server 8080 -d lp &  SERVER=$!
sleep 1 && curl -s http://localhost:8080/ | grep -c 'leadTelefone'   # expected: 1
kill $SERVER
```

Open `http://localhost:8080/` in a browser before killing the server if you want a visual pass: four labeled inputs, phone field shows numeric keyboard on mobile emulation.

#### Commit

- [ ] **Step 6: Stage and commit**

```bash
MSG_FILE=/tmp/msg-form-fields-$(date +%s).txt
cat > $MSG_FILE <<'EOF'
fix(lp): campos do form com label, type=tel, autocomplete e limites

Telefone vira type=tel + inputmode numeric + maxlength 16; email/nome/
empresa ganham autocomplete e teto de tamanho; todos os campos de texto
ganham label visivel. Adiciona o elemento #formMsg (e estilos) que o
fluxo de envio da Task 3 usa para duplicata/erro.

Closes #10
EOF
git add lp/index.html
git commit -F $MSG_FILE --trailer "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
rm -f $MSG_FILE
```

---

### Task 3: Submit flow — mask, await response, retry, no blind redirect

**Files:**
- Modify: `lp/index.html` — the lead-form IIFE `<script>` at the end of the file (currently lines ~1190-1224, starting `(function(){` with `var WEBHOOK_URL =`)

#### Test (Red)

- [ ] **Step 1: Confirm the old flow is present**

```bash
grep -n "no-cors" lp/index.html                          # expected: 1 match (old fetch)
grep -n "setTimeout(function(){ window.location.href" lp/index.html   # expected: 1 match (blind redirect)
```

#### Implement (Green)

- [ ] **Step 2: Replace the entire lead-form IIFE with the new flow**

The `WEBHOOK_URL` value is unchanged — copy it from the existing file. Marker comments (`>>> lead-form >>>`) exist so Verify can extract the block for a syntax check.

```html
<script>
// >>> lead-form >>>
(function(){
  // Destino do lead. Trocar por CRM depois = trocar esta linha.
  var WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyePYxReeqSJ18DEA73ctlPNSytNH6NDKeyZQqQ_qGKruDFOnIRzb0U_rZH3uOcaTKBhA/exec';
  var form = document.getElementById('leadForm');
  if(!form) return;
  var tel = document.getElementById('leadTelefone');
  var msg = document.getElementById('formMsg');
  var btn = form.querySelector('button[type="submit"]');
  var BTN_TEXTO = btn.textContent;

  function digitos(s){ return (s || '').replace(/\D/g, ''); }

  // Máscara (00) 00000-0000 enquanto digita; trava em 11 dígitos.
  tel.addEventListener('input', function(){
    var d = digitos(tel.value).slice(0, 11);
    var out = d;
    if(d.length > 2){
      var resto = d.slice(2);
      if(resto.length > 4){
        var corte = resto.length > 8 ? 5 : 4;
        out = '(' + d.slice(0, 2) + ') ' + resto.slice(0, corte) + '-' + resto.slice(corte);
      } else {
        out = '(' + d.slice(0, 2) + ') ' + resto;
      }
    }
    tel.value = out;
  });

  function telValido(v){
    var d = digitos(v);
    return (d.length === 10 || d.length === 11) && d.charAt(0) !== '0';
  }

  function mostrar(texto, erro){
    msg.textContent = texto;
    msg.className = 'form-msg' + (erro ? ' form-msg--erro' : '');
    msg.hidden = false;
  }

  // Envia com retry: erro de rede/HTTP tenta de novo (2x, ~1.5s de espera).
  // Resposta 200 nunca é re-enviada (evita linha duplicada na planilha).
  function enviar(corpo, tentativa){
    return fetch(WEBHOOK_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: corpo,
      keepalive: true
    }).then(function(r){
      if(!r.ok) throw new Error('http ' + r.status);
      return r.text().then(function(t){
        try { return JSON.parse(t); }
        catch(e){ return t.trim() === 'ok' ? { status: 'ok' } : { status: 'erro-resposta' }; }
      });
    }).catch(function(err){
      if(tentativa < 3){
        return new Promise(function(res){ setTimeout(res, 1500); })
          .then(function(){ return enviar(corpo, tentativa + 1); });
      }
      throw err;
    });
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();
    if(!form.checkValidity()){ form.reportValidity(); return; }
    if(!telValido(tel.value)){
      mostrar('Confira o telefone: DDD + número, ex.: (11) 99999-0000.', true);
      tel.focus();
      return;
    }
    var data = {};
    new FormData(form).forEach(function(v, k){ data[k] = String(v).trim(); });
    data.pagina = location.href;

    btn.disabled = true; btn.textContent = 'Enviando...';
    msg.hidden = true;

    function falha(){
      mostrar('Não conseguimos enviar agora. Tente novamente em instantes.', true);
      btn.disabled = false; btn.textContent = BTN_TEXTO;
    }

    enviar(JSON.stringify(data), 1).then(function(resp){
      if(resp.status === 'ok'){
        // Conversão só com gravação confirmada — métrica limpa no GTM.
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          event: 'form_submit_funil',
          segmento: data.segmento || '',
          faturamento: data.faturamento || '',
          trafego: data.trafego || ''
        });
        window.location.href = '/obrigado';
      } else if(resp.status === 'duplicate'){
        Array.prototype.forEach.call(form.querySelectorAll('input,select'), function(el){ el.disabled = true; });
        btn.textContent = 'Cadastro já recebido';
        mostrar('Já recebemos seus dados — nossa equipe vai te chamar 👍', false);
      } else if(resp.status === 'invalid'){
        mostrar('Confira os campos preenchidos e tente de novo.', true);
        btn.disabled = false; btn.textContent = BTN_TEXTO;
      } else {
        falha();
      }
    }).catch(falha);
  });
})();
// <<< lead-form <<<
</script>
```

Behavior notes baked into the code above (do not "improve" them away):
- Legacy `ok` text body is mapped to `{status:'ok'}` so the LP is safe even if it deploys before the script's new version.
- Retry fires ONLY on network error / non-2xx (`throw` paths). A 200 with a weird body shows the error message WITHOUT retrying — retrying a request the server may have processed is how duplicate rows happen.
- `dataLayer.push` moved from pre-send to confirmed-`ok` (was firing even when the webhook was down).

#### Verify

- [ ] **Step 3: Extract the block and syntax-check it**

```bash
sed -n '/>>> lead-form >>>/,/<<< lead-form <<</p' lp/index.html > /tmp/lead-form-check.js
node --check /tmp/lead-form-check.js && echo LEADFORM-SYNTAX-OK
grep -c "no-cors" lp/index.html    # expected: 0
grep -c "mode: 'cors'" lp/index.html   # expected: 1
```

- [ ] **Step 4: Browser smoke against the real webhook**

```bash
python3 -m http.server 8080 -d lp
```

In the browser at `http://localhost:8080/`:
1. Type letters + 100 chars in the phone field → mask keeps only `(00) 00000-0000` shape, max 11 digits.
2. Submit with phone `(00) 0000` → inline error, no request sent.
3. Submit a valid TEST lead (`nome: TESTE plano - pode apagar`) → redirected to `/obrigado` (may 404 locally — the redirect itself is the pass signal) and row appears in the sheet.
4. Go back, submit the SAME data again → if the script v3 is already deployed: duplicate notice, no redirect. If v3 not yet deployed: legacy `ok` → redirect (expected until rollout Step, see Task 4).
5. Delete the TESTE row(s) from the sheet.

#### Commit

- [ ] **Step 5: Stage and commit**

```bash
MSG_FILE=/tmp/msg-submit-flow-$(date +%s).txt
cat > $MSG_FILE <<'EOF'
fix(lp): envio aguarda resposta do webhook — fim do redirect cego

Mascara de telefone BR (10-11 digitos com DDD), fetch mode cors lendo o
JSON {status} do Apps Script: ok redireciona, duplicate mostra "ja
recebemos seus dados" sem redirect, falha de rede tenta 2x e depois
mostra erro com botao reativado. Evento GTM form_submit_funil passa a
disparar so com gravacao confirmada.

Closes #7
EOF
git add lp/index.html
git commit -F $MSG_FILE --trailer "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
rm -f $MSG_FILE
```

---

### Task 4 (final): Branch + PR + rollout checklist

#### Verify

- [ ] **Step 1: Full local gate**

```bash
cp lp/planilha-leads-completa.gs /tmp/gs-final.js && node --check /tmp/gs-final.js
sed -n '/>>> lead-form >>>/,/<<< lead-form <<</p' lp/index.html > /tmp/lf-final.js && node --check /tmp/lf-final.js
grep -c "no-cors" lp/index.html                      # 0
grep -c 'autocomplete=' lp/index.html                # 4
grep -c "NÃO precisa reimplantar" lp/planilha-leads-completa.gs || true   # 0
echo GATE-OK
```

#### Commit

- [ ] **Step 2: Invoke `/finishing-a-development-branch`**

The branch `feat/lp-form-validation-dedup` already exists and carries the spec + 3 task commits. The skill detects `pgWorkflow: pr`, pushes, and opens the PR via `gh pr create`. The PR body MUST include this operator rollout checklist (script-first ordering, per the spec):

```markdown
## Rollout (ordem importa — script primeiro)

- [ ] 1. Planilha → Extensões → Apps Script → colar `lp/planilha-leads-completa.gs` inteiro → Salvar
- [ ] 2. Implantar → Gerenciar implantações → ✏️ → **Nova versão** → Implantar (URL /exec não muda)
- [ ] 3. Smoke do script (antes do merge):
      `curl -sL 'https://script.google.com/macros/s/AKfycbyePYxReeqSJ18DEA73ctlPNSytNH6NDKeyZQqQ_qGKruDFOnIRzb0U_rZH3uOcaTKBhA/exec' -H 'Content-Type: text/plain' --data '{"nome":"x"}'` → `{"status":"invalid"}` (não usar `-X POST` junto com `-L`: o Apps Script responde 302 e o `-X` forçaria POST no redirect → 405)
      POST de lead TESTE válido → `{"status":"ok"}`; repetir o mesmo POST → `{"status":"duplicate"}`; apagar a linha TESTE
- [ ] 4. Merge → Railway rebuilda só o `movia-form` (watch paths do #14)
- [ ] 5. Smoke no ar: form em `form.moviaautomacoes.com.br` → envio válido cai no `/obrigado` + linha na planilha; reenvio mostra "já recebemos seus dados"
```

Operator confirms the PR title + summary before the skill returns.

---

Before claiming the plan complete, run `/verification-before-completion` against the final commit.
